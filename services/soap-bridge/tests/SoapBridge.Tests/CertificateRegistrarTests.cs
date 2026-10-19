using CustomsContracts;
using LegacyCustoms;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace SoapBridge.Tests;

public sealed class CertificateRegistrarTests : IDisposable
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    private readonly CustomsDbContext db;
    private readonly CertificateRegistrar registrar;

    public CertificateRegistrarTests()
    {
        connection.Open();
        var options = new DbContextOptionsBuilder<CustomsDbContext>()
            .UseSqlite(connection)
            .Options;
        db = new CustomsDbContext(options);
        db.Database.EnsureCreated();
        registrar = new CertificateRegistrar(db, new FixedTimeProvider(new DateTimeOffset(2026, 10, 18, 12, 0, 0, TimeSpan.Zero)));
    }

    [Fact]
    public async Task Accepts_and_numbers_certificate()
    {
        var response = await registrar.RegisterAsync(Request());

        Assert.Equal(RegistrationStatus.Accepted, response.Status);
        Assert.Equal("EC-REG-2026-000001", response.RegistrationNumber);
    }

    [Fact]
    public async Task Rejects_importer_from_another_country()
    {
        var response = await registrar.RegisterAsync(Request(importerCountry: "PE"));

        Assert.Equal(RegistrationStatus.Rejected, response.Status);
        Assert.Equal("importer is not registered in EC", response.Reason);
    }

    [Fact]
    public async Task Rejects_certificate_without_items()
    {
        var response = await registrar.RegisterAsync(Request(items: []));

        Assert.Equal(RegistrationStatus.Rejected, response.Status);
        Assert.Equal("certificate has no items", response.Reason);
    }

    [Fact]
    public async Task Rejects_expired_certificate()
    {
        var response = await registrar.RegisterAsync(Request(issueDate: new DateTime(2026, 3, 1)));

        Assert.Equal(RegistrationStatus.Rejected, response.Status);
        Assert.Equal("certificate expired", response.Reason);
    }

    [Fact]
    public async Task Retry_returns_same_response_without_a_second_row()
    {
        var request = Request();
        var first = await registrar.RegisterAsync(request);
        var second = await registrar.RegisterAsync(request);

        Assert.Equal(first.Status, second.Status);
        Assert.Equal(first.RegistrationNumber, second.RegistrationNumber);
        Assert.Equal(first.Reason, second.Reason);
        Assert.Equal(1, await db.Registrations.CountAsync());
    }

    public void Dispose()
    {
        db.Dispose();
        connection.Dispose();
    }

    private static CertificateRegistrationRequest Request(
        string importerCountry = "EC",
        DateTime? issueDate = null,
        List<CertificateItem>? items = null) => new()
    {
        CertificateNumber = Guid.NewGuid().ToString(),
        IssueDate = issueDate ?? new DateTime(2026, 10, 1),
        OriginCountry = "BO",
        ImporterCountry = importerCountry,
        ImporterId = "EC-123",
        Items = items ?? [new CertificateItem { Line = 1, TariffCode = "0101", Description = "Goods" }]
    };

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
