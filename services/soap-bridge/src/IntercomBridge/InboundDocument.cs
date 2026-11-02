using System.Text.Json;
using System.Text.Json.Serialization;

namespace IntercomBridge;

public sealed record InboundDocument(
    [property: JsonPropertyName("documentId")] string DocumentId,
    [property: JsonPropertyName("documentType")] string DocumentType,
    [property: JsonPropertyName("originCountry")] string OriginCountry,
    [property: JsonPropertyName("destinationCountry")] string DestinationCountry,
    [property: JsonPropertyName("format")] string Format,
    [property: JsonPropertyName("payload")] JsonElement? Payload,
    [property: JsonPropertyName("payloadXml")] string? PayloadXml);
