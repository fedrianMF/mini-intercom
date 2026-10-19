using System.ServiceModel;
using CustomsContracts;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
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
    public void Soap_client_registers_certificate()
    {
        using var httpClient = factory.CreateClient();
        var address = new EndpointAddress(new Uri(httpClient.BaseAddress!, "CustomsRegistry.svc"));
        var binding = new BasicHttpBinding();
        var channelFactory = new ChannelFactory<ITestCustomsRegistry>(binding, address);
        var channel = channelFactory.CreateChannel();
        var response = channel.RegisterCertificateAsync(new CertificateRegistrationRequest
        {
            CertificateNumber = Guid.NewGuid().ToString(),
            IssueDate = new DateTime(2026, 10, 1),
            ImporterCountry = "EC",
            ImporterId = "EC-123",
            Items = [new CertificateItem { Line = 1, Description = "Goods" }]
        }).GetAwaiter().GetResult();

        Assert.Equal(RegistrationStatus.Accepted, response.Status);
        ((IClientChannel)channel).Close();
        channelFactory.Close();
    }

    [ServiceContract(Namespace = CustomsNamespaces.Registry)]
    private interface ITestCustomsRegistry
    {
        [OperationContract]
        Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request);
    }
}

public sealed class CustomsRegistryFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        connection.Open();
        builder.UseKestrel().UseUrls("http://127.0.0.1:0");
        builder.ConfigureServices(services =>
        {
            var descriptor = services.Single(service => service.ServiceType == typeof(DbContextOptions<LegacyCustoms.CustomsDbContext>));
            services.Remove(descriptor);
            services.AddDbContext<LegacyCustoms.CustomsDbContext>(options => options.UseSqlite(connection));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        connection.Dispose();
    }
}
