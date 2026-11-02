namespace IntercomBridge;

public sealed class BridgeOptions
{
    public string Country { get; set; } = string.Empty;
    public string AmqpUrl { get; set; } = string.Empty;
    public string HubUrl { get; set; } = string.Empty;
    public string TokenUrl { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public int MaxAttempts { get; set; } = 3;
    public string CustomsSoapUrl { get; set; } = string.Empty;
}
