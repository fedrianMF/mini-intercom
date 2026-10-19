using CoreWCF;
using CoreWCF.Configuration;
using CoreWCF.Description;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.AddJsonConsole();
builder.Services.AddServiceModelServices();
builder.Services.AddServiceModelMetadata();
builder.Services.AddDbContext<CustomsDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Customs")));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<CertificateRegistrar>(services =>
    new CertificateRegistrar(
        services.GetRequiredService<CustomsDbContext>(),
        services.GetRequiredService<TimeProvider>(),
        builder.Configuration.GetValue<double>("Customs:FailRate", 0)));
builder.Services.AddScoped<ICustomsRegistry, CustomsRegistryService>();

var app = builder.Build();

await EnsureDatabaseAsync(app.Services, app.Logger);

var metadata = app.Services.GetRequiredService<ServiceMetadataBehavior>();
metadata.HttpGetEnabled = true;

app.UseServiceModel(serviceBuilder =>
{
    serviceBuilder.AddService<CustomsRegistryService>();
    serviceBuilder.AddServiceEndpoint<CustomsRegistryService, ICustomsRegistry>(
        new BasicHttpBinding(), "/CustomsRegistry.svc");
});

app.MapGet("/health", async (CustomsDbContext db, CancellationToken cancellationToken) =>
    await db.Database.CanConnectAsync(cancellationToken)
        ? Results.Ok()
        : Results.StatusCode(StatusCodes.Status503ServiceUnavailable));

app.MapGet("/registrations", async (CustomsDbContext db, int? limit, CancellationToken cancellationToken) =>
{
    var take = Math.Clamp(limit ?? 20, 1, 100);
    var registrations = await db.Registrations
        .AsNoTracking()
        .OrderByDescending(registration => registration.ReceivedAt)
        .Take(take)
        .Select(registration => new
        {
            certificateNumber = registration.CertificateNumber,
            status = registration.Status.ToString(),
            registrationNumber = registration.RegistrationNumber,
            reason = registration.Reason,
            receivedAt = registration.ReceivedAt
        })
        .ToListAsync(cancellationToken);
    return Results.Ok(registrations);
});

app.Run();

static async Task EnsureDatabaseAsync(IServiceProvider services, ILogger logger)
{
    await using var scope = services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<CustomsDbContext>();
    for (var attempt = 1; attempt <= 20; attempt++)
    {
        try
        {
            await db.Database.EnsureCreatedAsync();
            return;
        }
        catch (Exception exception) when (attempt < 20)
        {
            logger.LogWarning(exception, "Customs database is unavailable; retrying in 3 seconds (attempt {Attempt}/20)", attempt);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }

    // Migrations are intentionally absent because the legacy system owns its schema.
    await db.Database.EnsureCreatedAsync();
}

public partial class Program;
