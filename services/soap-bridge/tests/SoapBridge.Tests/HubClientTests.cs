using System.Net;
using System.Text;
using IntercomBridge;
using Microsoft.Extensions.Options;

namespace SoapBridge.Tests;

public sealed class HubClientTests
{
    [Fact]
    public async Task Reuses_token_for_two_acknowledgements()
    {
        var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsolutePath.EndsWith("/token")
            ? JsonResponse(HttpStatusCode.OK, """{"access_token":"test-token","expires_in":60}""")
            : new HttpResponseMessage(HttpStatusCode.NoContent));
        var client = CreateClient(handler);

        await client.SendAckAsync("document-1", new AckDecision("accepted"), "correlation-1");
        await client.SendAckAsync("document-2", new AckDecision("accepted"), "correlation-2");

        Assert.Equal(1, handler.Requests.Count(request => request.RequestUri!.AbsolutePath.EndsWith("/token")));
        Assert.Equal(2, handler.Requests.Count(request => request.RequestUri!.AbsolutePath.EndsWith("/acks")));
    }

    [Fact]
    public async Task Conflict_acknowledgement_is_successful()
    {
        var client = CreateClient(HandlerReturning(HttpStatusCode.Conflict));

        await client.SendAckAsync("document-1", new AckDecision("accepted"), "correlation-1");
    }

    [Fact]
    public async Task Service_unavailable_is_transient()
    {
        var client = CreateClient(HandlerReturning(HttpStatusCode.ServiceUnavailable));

        await Assert.ThrowsAsync<TransientException>(
            () => client.SendAckAsync("document-1", new AckDecision("accepted"), "correlation-1"));
    }

    [Fact]
    public async Task Bad_request_is_permanent()
    {
        var client = CreateClient(HandlerReturning(HttpStatusCode.BadRequest));

        await Assert.ThrowsAsync<PermanentException>(
            () => client.SendAckAsync("document-1", new AckDecision("accepted"), "correlation-1"));
    }

    private static StubHttpMessageHandler HandlerReturning(HttpStatusCode ackStatus) =>
        new(request => request.RequestUri!.AbsolutePath.EndsWith("/token")
            ? JsonResponse(HttpStatusCode.OK, """{"access_token":"test-token","expires_in":60}""")
            : new HttpResponseMessage(ackStatus));

    private static HubClient CreateClient(HttpMessageHandler handler)
    {
        var options = Options.Create(new BridgeOptions
        {
            HubUrl = "https://hub.test",
            TokenUrl = "https://identity.test/token",
            ClientId = "client",
            ClientSecret = "secret"
        });
        return new HubClient(new HttpClient(handler), options);
    }

    private static HttpResponseMessage JsonResponse(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }
}
