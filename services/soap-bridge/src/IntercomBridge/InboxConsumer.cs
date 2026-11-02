using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace IntercomBridge;

public sealed class InboxConsumer(
    IOptions<BridgeOptions> options,
    CustomsGateway customsGateway,
    HubClient hubClient,
    ILogger<InboxConsumer> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly BridgeOptions options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var factory = new ConnectionFactory
        {
            Uri = new Uri(options.AmqpUrl)
        };
        var queue = $"entity.{options.Country}.inbox";

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var connection = await factory.CreateConnectionAsync(stoppingToken);
                await using var channel = await connection.CreateChannelAsync(
                    new CreateChannelOptions(
                        publisherConfirmationsEnabled: true,
                        publisherConfirmationTrackingEnabled: true),
                    stoppingToken);

                await channel.QueueDeclarePassiveAsync(queue, stoppingToken);
                await channel.BasicQosAsync(0, 5, false, stoppingToken);

                var consumer = new AsyncEventingBasicConsumer(channel);
                consumer.ReceivedAsync += (_, message) => HandleAsync(channel, message, stoppingToken);
                await channel.BasicConsumeAsync(queue, autoAck: false, consumer, stoppingToken);

                logger.LogInformation("Consuming queue {Queue}", queue);
                while (connection.IsOpen && !stoppingToken.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
                }

                if (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning("Broker connection closed");
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Broker unavailable; retrying in 3 seconds");
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task HandleAsync(IChannel channel, BasicDeliverEventArgs message, CancellationToken cancellationToken)
    {
        var headers = message.BasicProperties.Headers ?? new Dictionary<string, object?>();
        var attempt = HeaderAsInt(headers, "x-attempt", 1);
        var correlationId = HeaderAsString(headers, "x-correlation-id");
        InboundDocument? document = null;
        var settled = false;

        try
        {
            document = JsonSerializer.Deserialize<InboundDocument>(message.Body.Span, JsonOptions)
                ?? throw new PermanentException("message body is empty");

            using var scope = logger.BeginScope(new Dictionary<string, object?>
            {
                ["documentId"] = document.DocumentId,
                ["correlationId"] = correlationId,
                ["attempt"] = attempt
            });

            try
            {
                var request = DocumentMapper.ToRegistrationRequest(document, correlationId);
                var response = await customsGateway.RegisterAsync(request);
                var decision = AckDecision.From(response);
                await hubClient.SendAckAsync(document.DocumentId, decision, correlationId, cancellationToken);
                settled = true;
                logger.LogInformation("Document processed with result {result}", decision.Result);
            }
            catch (UnmappableDocumentException exception)
            {
                var decision = AckDecision.Rejected($"unreadable document: {exception.FieldName}");
                await hubClient.SendAckAsync(document.DocumentId, decision, correlationId, cancellationToken);
                settled = true;
                logger.LogInformation("Document processed with result {result}", decision.Result);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var action = exception is TransientException
                ? RetryPolicy.OnTransientFailure(attempt, options.MaxAttempts)
                : new RetryAction(false, attempt);
            try
            {
                await PublishFailureAsync(channel, message, headers, action, exception.Message, cancellationToken);
                settled = true;
            }
            catch (Exception publishException)
            {
                // Without a confirmed retry or dead-letter copy, acking would lose the document: leave it for redelivery.
                logger.LogError(publishException, "Could not republish document {documentId}; leaving it unacknowledged", document?.DocumentId);
                return;
            }

            using var scope = logger.BeginScope(new Dictionary<string, object?>
            {
                ["documentId"] = document?.DocumentId ?? "unknown",
                ["correlationId"] = correlationId,
                ["attempt"] = attempt,
                ["result"] = action.ShouldRetry ? "retry" : "dead-letter"
            });
            logger.LogWarning(
                exception,
                action.ShouldRetry ? "Document processing failed; retry scheduled" : "Document processing failed; sent to dead letters");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Shutting down mid-delivery: the broker redelivers the unacknowledged message.
            return;
        }

        if (settled)
        {
            await channel.BasicAckAsync(message.DeliveryTag, multiple: false, CancellationToken.None);
        }
    }

    private static async Task PublishFailureAsync(
        IChannel channel,
        BasicDeliverEventArgs message,
        IDictionary<string, object?> originalHeaders,
        RetryAction action,
        string reason,
        CancellationToken cancellationToken)
    {
        var headers = new Dictionary<string, object?>(originalHeaders)
        {
            ["x-attempt"] = action.Attempt,
            ["x-failure-reason"] = reason
        };
        var properties = new BasicProperties
        {
            Persistent = true,
            ContentType = message.BasicProperties.ContentType ?? "application/json",
            Headers = headers
        };

        await channel.BasicPublishAsync(
            action.Exchange,
            message.RoutingKey,
            mandatory: false,
            properties,
            message.Body,
            cancellationToken);
    }

    private static int HeaderAsInt(IDictionary<string, object?> headers, string name, int fallback)
    {
        if (!headers.TryGetValue(name, out var value))
        {
            return fallback;
        }

        return value switch
        {
            int number => number,
            long number when number is >= int.MinValue and <= int.MaxValue => (int)number,
            byte[] bytes when int.TryParse(Encoding.UTF8.GetString(bytes), out var parsed) => parsed,
            string text when int.TryParse(text, out var parsed) => parsed,
            _ => fallback
        };
    }

    private static string HeaderAsString(IDictionary<string, object?> headers, string name)
    {
        if (!headers.TryGetValue(name, out var value))
        {
            return string.Empty;
        }

        return value switch
        {
            byte[] bytes => Encoding.UTF8.GetString(bytes),
            ReadOnlyMemory<byte> bytes => Encoding.UTF8.GetString(bytes.Span),
            _ => Convert.ToString(value) ?? string.Empty
        };
    }
}
