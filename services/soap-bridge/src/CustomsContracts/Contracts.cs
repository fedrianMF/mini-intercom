using System.Runtime.Serialization;

namespace CustomsContracts;

public static class CustomsNamespaces
{
    public const string Registry = "urn:aduana-ec:registro:v1";
}

[DataContract(Namespace = CustomsNamespaces.Registry)]
public sealed class CertificateRegistrationRequest
{
    [DataMember(Order = 1)] public string CertificateNumber { get; set; } = string.Empty;
    [DataMember(Order = 2)] public DateTime IssueDate { get; set; }
    [DataMember(Order = 3)] public string OriginCountry { get; set; } = string.Empty;
    [DataMember(Order = 4)] public string ExporterName { get; set; } = string.Empty;
    [DataMember(Order = 5)] public string ExporterId { get; set; } = string.Empty;
    [DataMember(Order = 6)] public string ImporterName { get; set; } = string.Empty;
    [DataMember(Order = 7)] public string ImporterId { get; set; } = string.Empty;
    [DataMember(Order = 8)] public string ImporterCountry { get; set; } = string.Empty;
    [DataMember(Order = 9)] public string CorrelationId { get; set; } = string.Empty;
    [DataMember(Order = 10)] public List<CertificateItem> Items { get; set; } = new();
}

[DataContract(Namespace = CustomsNamespaces.Registry)]
public sealed class CertificateItem
{
    [DataMember(Order = 1)] public int Line { get; set; }
    [DataMember(Order = 2)] public string TariffCode { get; set; } = string.Empty;
    [DataMember(Order = 3)] public string Description { get; set; } = string.Empty;
    [DataMember(Order = 4)] public decimal Quantity { get; set; }
    [DataMember(Order = 5)] public string Unit { get; set; } = string.Empty;
    [DataMember(Order = 6)] public decimal FobValue { get; set; }
    [DataMember(Order = 7)] public string OriginCriterion { get; set; } = string.Empty;
}

[DataContract(Namespace = CustomsNamespaces.Registry)]
public sealed class CertificateRegistrationResponse
{
    [DataMember(Order = 1)] public RegistrationStatus Status { get; set; }
    [DataMember(Order = 2)] public string? RegistrationNumber { get; set; }
    [DataMember(Order = 3)] public string? Reason { get; set; }
}

[DataContract(Namespace = CustomsNamespaces.Registry)]
public enum RegistrationStatus
{
    [EnumMember] Accepted,
    [EnumMember] Rejected
}
