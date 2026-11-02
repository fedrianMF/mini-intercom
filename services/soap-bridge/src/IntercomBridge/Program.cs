namespace IntercomBridge;

public static class BridgeProgram
{
    public static void Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);

        builder.Logging.AddJsonConsole();
        builder.Services
            .AddOptions<BridgeOptions>()
            .Configure(options =>
            {
                options.Country = builder.Configuration["COUNTRY"] ?? string.Empty;
                options.AmqpUrl = builder.Configuration["AMQP_URL"] ?? string.Empty;
                options.HubUrl = builder.Configuration["HUB_URL"] ?? string.Empty;
                options.TokenUrl = builder.Configuration["TOKEN_URL"] ?? string.Empty;
                options.ClientId = builder.Configuration["CLIENT_ID"] ?? string.Empty;
                options.ClientSecret = builder.Configuration["CLIENT_SECRET"] ?? string.Empty;
                options.CustomsSoapUrl = builder.Configuration["CUSTOMS_SOAP_URL"] ?? string.Empty;
                options.MaxAttempts = int.TryParse(builder.Configuration["MAX_ATTEMPTS"], out var maxAttempts)
                    ? maxAttempts
                    : 3;
            })
            .Validate(options => !string.IsNullOrWhiteSpace(options.Country), "COUNTRY is required")
            .Validate(options => Uri.TryCreate(options.AmqpUrl, UriKind.Absolute, out _), "AMQP_URL must be an absolute URL")
            .Validate(options => Uri.TryCreate(options.HubUrl, UriKind.Absolute, out _), "HUB_URL must be an absolute URL")
            .Validate(options => Uri.TryCreate(options.TokenUrl, UriKind.Absolute, out _), "TOKEN_URL must be an absolute URL")
            .Validate(options => !string.IsNullOrWhiteSpace(options.ClientId), "CLIENT_ID is required")
            .Validate(options => !string.IsNullOrWhiteSpace(options.ClientSecret), "CLIENT_SECRET is required")
            .Validate(options => options.MaxAttempts > 0, "MAX_ATTEMPTS must be greater than zero")
            .Validate(options => Uri.TryCreate(options.CustomsSoapUrl, UriKind.Absolute, out _), "CUSTOMS_SOAP_URL must be an absolute URL")
            .ValidateOnStart();

        builder.Services.AddHttpClient<HubClient>();
        builder.Services.AddSingleton<CustomsGateway>();
        builder.Services.AddHostedService<InboxConsumer>();

        var host = builder.Build();
        host.Run();
    }
}
