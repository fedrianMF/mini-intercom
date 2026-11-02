using System.Globalization;
using System.Text.Json;
using System.Xml.Linq;
using CustomsContracts;

namespace IntercomBridge;

public static class DocumentMapper
{
    private static readonly XNamespace CertificateNamespace = "urn:mini-intercom:certificado-origen:v1";

    public static CertificateRegistrationRequest ToRegistrationRequest(InboundDocument document, string correlationId) =>
        document.Format switch
        {
            "json" => FromJson(document, correlationId),
            "xml" => FromXml(document, correlationId),
            _ => throw new UnmappableDocumentException("format")
        };

    private static CertificateRegistrationRequest FromJson(InboundDocument document, string correlationId)
    {
        if (document.Payload is not { ValueKind: JsonValueKind.Object } payload)
        {
            throw new UnmappableDocumentException("payload");
        }

        var exporter = RequiredObject(payload, "exportador", "exportador");
        var importer = RequiredObject(payload, "importador", "importador");
        var goods = RequiredArray(payload, "mercancias", "mercancias");

        return new CertificateRegistrationRequest
        {
            CertificateNumber = RequiredString(payload, "numero", "numero"),
            IssueDate = RequiredDate(payload, "fechaEmision", "fechaEmision"),
            OriginCountry = RequiredString(exporter, "pais", "exportador.pais"),
            ExporterName = RequiredString(exporter, "nombre", "exportador.nombre"),
            ExporterId = RequiredString(exporter, "identificacion", "exportador.identificacion"),
            ImporterName = RequiredString(importer, "nombre", "importador.nombre"),
            ImporterId = RequiredString(importer, "identificacion", "importador.identificacion"),
            ImporterCountry = RequiredString(importer, "pais", "importador.pais"),
            CorrelationId = correlationId,
            Items = goods.EnumerateArray().Select((item, index) => MapJsonItem(item, index)).ToList()
        };
    }

    private static CertificateItem MapJsonItem(JsonElement item, int index)
    {
        var prefix = $"mercancias[{index}]";
        if (item.ValueKind != JsonValueKind.Object)
        {
            throw new UnmappableDocumentException(prefix);
        }

        return new CertificateItem
        {
            Line = RequiredInt(item, "item", $"{prefix}.item"),
            TariffCode = RequiredString(item, "subpartidaNandina", $"{prefix}.subpartidaNandina"),
            Description = RequiredString(item, "descripcion", $"{prefix}.descripcion"),
            Quantity = RequiredDecimal(item, "cantidad", $"{prefix}.cantidad"),
            Unit = RequiredString(item, "unidad", $"{prefix}.unidad"),
            FobValue = RequiredDecimal(item, "valorFob", $"{prefix}.valorFob"),
            OriginCriterion = RequiredString(item, "criterioOrigen", $"{prefix}.criterioOrigen")
        };
    }

    private static CertificateRegistrationRequest FromXml(InboundDocument document, string correlationId)
    {
        if (string.IsNullOrWhiteSpace(document.PayloadXml))
        {
            throw new UnmappableDocumentException("payloadXml");
        }

        XDocument xml;
        try
        {
            xml = XDocument.Parse(document.PayloadXml);
        }
        catch (Exception exception) when (exception is System.Xml.XmlException or ArgumentException)
        {
            throw new UnmappableDocumentException("payloadXml");
        }

        var root = xml.Root;
        if (root?.Name != CertificateNamespace + "CertificadoOrigen")
        {
            throw new UnmappableDocumentException("CertificadoOrigen");
        }

        var exporter = RequiredElement(root, "Exportador", "Exportador");
        var importer = RequiredElement(root, "Importador", "Importador");
        var goods = RequiredElement(root, "Mercancias", "Mercancias");

        return new CertificateRegistrationRequest
        {
            CertificateNumber = RequiredValue(root, "Numero", "Numero"),
            IssueDate = RequiredDate(root, "FechaEmision", "FechaEmision"),
            OriginCountry = RequiredValue(exporter, "Pais", "Exportador.Pais"),
            ExporterName = RequiredValue(exporter, "Nombre", "Exportador.Nombre"),
            ExporterId = RequiredValue(exporter, "Identificacion", "Exportador.Identificacion"),
            ImporterName = RequiredValue(importer, "Nombre", "Importador.Nombre"),
            ImporterId = RequiredValue(importer, "Identificacion", "Importador.Identificacion"),
            ImporterCountry = RequiredValue(importer, "Pais", "Importador.Pais"),
            CorrelationId = correlationId,
            Items = goods.Elements(CertificateNamespace + "Mercancia")
                .Select((item, index) => MapXmlItem(item, index))
                .ToList()
        };
    }

    private static CertificateItem MapXmlItem(XElement item, int index)
    {
        var prefix = $"Mercancias.Mercancia[{index}]";
        return new CertificateItem
        {
            Line = RequiredInt(item, "Item", $"{prefix}.Item"),
            TariffCode = RequiredValue(item, "SubpartidaNandina", $"{prefix}.SubpartidaNandina"),
            Description = RequiredValue(item, "Descripcion", $"{prefix}.Descripcion"),
            Quantity = RequiredDecimal(item, "Cantidad", $"{prefix}.Cantidad"),
            Unit = RequiredValue(item, "Unidad", $"{prefix}.Unidad"),
            FobValue = RequiredDecimal(item, "ValorFob", $"{prefix}.ValorFob"),
            OriginCriterion = RequiredValue(item, "CriterioOrigen", $"{prefix}.CriterioOrigen")
        };
    }

    private static JsonElement RequiredObject(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredProperty(parent, propertyName, fieldName);
        return value.ValueKind == JsonValueKind.Object ? value : throw new UnmappableDocumentException(fieldName);
    }

    private static JsonElement RequiredArray(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredProperty(parent, propertyName, fieldName);
        return value.ValueKind == JsonValueKind.Array ? value : throw new UnmappableDocumentException(fieldName);
    }

    private static string RequiredString(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredProperty(parent, propertyName, fieldName);
        if (value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new UnmappableDocumentException(fieldName);
        }
        return value.GetString()!;
    }

    private static int RequiredInt(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredProperty(parent, propertyName, fieldName);
        return value.TryGetInt32(out var parsed) ? parsed : throw new UnmappableDocumentException(fieldName);
    }

    private static decimal RequiredDecimal(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredProperty(parent, propertyName, fieldName);
        return value.TryGetDecimal(out var parsed) ? parsed : throw new UnmappableDocumentException(fieldName);
    }

    private static DateTime RequiredDate(JsonElement parent, string propertyName, string fieldName)
    {
        var value = RequiredString(parent, propertyName, fieldName);
        return DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : throw new UnmappableDocumentException(fieldName);
    }

    private static JsonElement RequiredProperty(JsonElement parent, string propertyName, string fieldName) =>
        parent.TryGetProperty(propertyName, out var value) && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
            ? value
            : throw new UnmappableDocumentException(fieldName);

    private static XElement RequiredElement(XElement parent, string elementName, string fieldName) =>
        parent.Element(CertificateNamespace + elementName) ?? throw new UnmappableDocumentException(fieldName);

    private static string RequiredValue(XElement parent, string elementName, string fieldName)
    {
        var value = RequiredElement(parent, elementName, fieldName).Value;
        return string.IsNullOrWhiteSpace(value) ? throw new UnmappableDocumentException(fieldName) : value;
    }

    private static DateTime RequiredDate(XElement parent, string elementName, string fieldName)
    {
        var value = RequiredValue(parent, elementName, fieldName);
        return DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : throw new UnmappableDocumentException(fieldName);
    }

    private static int RequiredInt(XElement parent, string elementName, string fieldName)
    {
        var value = RequiredValue(parent, elementName, fieldName);
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : throw new UnmappableDocumentException(fieldName);
    }

    private static decimal RequiredDecimal(XElement parent, string elementName, string fieldName)
    {
        var value = RequiredValue(parent, elementName, fieldName);
        return decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : throw new UnmappableDocumentException(fieldName);
    }
}
