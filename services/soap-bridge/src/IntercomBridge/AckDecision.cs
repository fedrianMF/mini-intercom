using System.Text.Json.Serialization;
using CustomsContracts;

namespace IntercomBridge;

public sealed record AckDecision(
    [property: JsonPropertyName("result")] string Result,
    [property: JsonPropertyName("reason"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null)
{
    public static AckDecision From(CertificateRegistrationResponse response) => response.Status switch
    {
        RegistrationStatus.Accepted => new AckDecision("accepted"),
        RegistrationStatus.Rejected => new AckDecision("rejected", response.Reason),
        _ => throw new ArgumentOutOfRangeException(nameof(response), response.Status, "Unknown registration status")
    };

    public static AckDecision Rejected(string reason) => new("rejected", reason);
}
