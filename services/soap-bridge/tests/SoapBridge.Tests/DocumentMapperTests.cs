using System.Text.Json;
using IntercomBridge;

namespace SoapBridge.Tests;

public sealed class DocumentMapperTests
{
    [Fact]
    public void Maps_json_sample()
    {
        using var sample = JsonDocument.Parse(File.ReadAllText(SamplePath("certificado-origen.json")));
        var root = sample.RootElement;
        var document = new InboundDocument(
            "document-1",
            root.GetProperty("documentType").GetString()!,
            "BO",
            root.GetProperty("destinationCountry").GetString()!,
            root.GetProperty("format").GetString()!,
            root.GetProperty("payload"),
            null);

        var request = DocumentMapper.ToRegistrationRequest(document, "correlation-1");

        Assert.Equal("BO-2026-000123", request.CertificateNumber);
        Assert.Equal("Distribuidora del Pacifico S.A.C.", request.ImporterName);
        var item = Assert.Single(request.Items);
        Assert.Equal(1, item.Line);
        Assert.Equal("10085090", item.TariffCode);
        Assert.Equal(52000m, item.FobValue);
    }

    [Fact]
    public void Maps_xml_sample()
    {
        var document = new InboundDocument(
            "document-2",
            "certificado-origen",
            "BO",
            "CO",
            "xml",
            null,
            File.ReadAllText(SamplePath("certificado-origen.xml")));

        var request = DocumentMapper.ToRegistrationRequest(document, "correlation-2");

        Assert.Equal("BO-2026-000124", request.CertificateNumber);
        Assert.Equal("Importadora Andina S.A.S.", request.ImporterName);
        var item = Assert.Single(request.Items);
        Assert.Equal(1, item.Line);
        Assert.Equal("10085090", item.TariffCode);
        Assert.Equal(39000m, item.FobValue);
    }

    [Fact]
    public void Missing_certificate_number_is_unmappable()
    {
        using var payload = JsonDocument.Parse("""
            {
              "fechaEmision": "2026-10-18",
              "exportador": {},
              "importador": {},
              "mercancias": []
            }
            """);
        var document = new InboundDocument(
            "document-3",
            "certificado-origen",
            "BO",
            "EC",
            "json",
            payload.RootElement,
            null);

        var exception = Assert.Throws<UnmappableDocumentException>(
            () => DocumentMapper.ToRegistrationRequest(document, "correlation-3"));

        Assert.Equal("numero", exception.FieldName);
    }

    private static string SamplePath(string name) => Path.Combine(AppContext.BaseDirectory, "samples", name);
}
