using System.ServiceModel;
using CustomsContracts;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace SoapBridge.Tests;

public sealed class CustomsRegistrySoapTests : IClassFixture<CustomsRegistryFactory>
{
    private readonly CustomsRegistryFactory factory;

    public CustomsRegistrySoapTests(CustomsRegistryFactory factory)
    {
        this.factory = factory;
    }

    [Fact]
    public async Task Wsdl_contains_register_operation()
    {
        using var client = factory.CreateClient();
        var wsdl = await client.GetStringAsync("/CustomsRegistry.svc?wsdl");

        Assert.Contains("RegisterCertificate", wsdl);
    }

    [Fact]
    public async Task Soap_client_registers_certificate()
    {
        using var httpClient = factory.CreateClient();
        var address = new EndpointAddress(new Uri(httpClient.BaseAddress!, "CustomsRegistry.svc"));
        var binding = new BasicHttpBinding();
        var channelFactory = new ChannelFactory<ITestCustomsRegistry>(binding, address);
        var channel = channelFactory.CreateChannel();
        var response = await channel.RegisterCertificateAsync(new CertificateRegistrationRequest
        {
            CertificateNumber = Guid.NewGuid().ToString(),
            IssueDate = new DateTime(2026, 10, 1),
            ImporterCountry = "EC",
            ImporterId = "EC-123",
            Items = [new CertificateItem { Line = 1, Description = "Goods" }]
        });

        Assert.Equal(RegistrationStatus.Accepted, response.Status);
        ((IClientChannel)channel).Close();
        channelFactory.Close();
    }

    [ServiceContract(Namespace = CustomsNamespaces.Registry, Name = "ICustomsRegistry")]
    internal interface ITestCustomsRegistry
    {
        [OperationContract]
        Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request);
    }
}

public sealed class CustomsRegistryFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");

    // A real socket instead of TestServer, because the WCF client opens its own HTTP connection.
    public CustomsRegistryFactory() => UseKestrel(0);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        connection.Open();
        builder.ConfigureServices(services =>
        {
            // EF Core 9+ keeps the provider setup in IDbContextOptionsConfiguration<T>, so both registrations must go.
            var sqlServer = services
                .Where(service => service.ServiceType == typeof(DbContextOptions<LegacyCustoms.CustomsDbContext>)
                    || service.ServiceType == typeof(IDbContextOptionsConfiguration<LegacyCustoms.CustomsDbContext>))
                .ToList();
            sqlServer.ForEach(service => services.Remove(service));
            services.AddDbContext<LegacyCustoms.CustomsDbContext>(options => options.UseSqlite(connection));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        connection.Dispose();
    }
}
