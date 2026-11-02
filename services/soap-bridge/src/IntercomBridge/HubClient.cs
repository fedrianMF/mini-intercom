using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace IntercomBridge;

public sealed class HubClient(HttpClient httpClient, IOptions<BridgeOptions> options)
{
    private readonly BridgeOptions options = options.Value;
    private readonly SemaphoreSlim tokenLock = new(1, 1);
    private CachedToken? cachedToken;

    public async Task SendAckAsync(
        string documentId,
        AckDecision decision,
        string correlationId,
        CancellationToken cancellationToken = default)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{options.HubUrl.TrimEnd('/')}/v1/documents/{Uri.EscapeDataString(documentId)}/acks")
        {
            Content = JsonContent.Create(decision)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("X-Correlation-Id", correlationId);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, cancellationToken);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TransientException($"hub request timed out: {exception.Message}", exception);
        }
        catch (HttpRequestException exception)
        {
            throw new TransientException($"hub unreachable: {exception.Message}", exception);
        }

        using (response)
        {
            if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict)
            {
                return;
            }

            if (response.StatusCode == HttpStatusCode.Unauthorized || (int)response.StatusCode >= 500)
            {
                throw new TransientException($"hub returned {(int)response.StatusCode}");
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new PermanentException($"hub refused ack with {(int)response.StatusCode}: {body}");
        }
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (cachedToken is { } current && current.ExpiresAt > DateTimeOffset.UtcNow.AddSeconds(10))
        {
            return current.Value;
        }

        await tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (cachedToken is { } refreshed && refreshed.ExpiresAt > DateTimeOffset.UtcNow.AddSeconds(10))
            {
                return refreshed.Value;
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, options.TokenUrl)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials",
                    ["client_id"] = options.ClientId,
                    ["client_secret"] = options.ClientSecret
                })
            };

            HttpResponseMessage response;
            try
            {
                response = await httpClient.SendAsync(request, cancellationToken);
            }
            catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                throw new TransientException($"token request timed out: {exception.Message}", exception);
            }
            catch (HttpRequestException exception)
            {
                throw new TransientException($"token endpoint unreachable: {exception.Message}", exception);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    throw new TransientException($"token endpoint returned {(int)response.StatusCode}");
                }

                var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken)
                    ?? throw new TransientException("token endpoint returned an empty response");
                cachedToken = new CachedToken(token.AccessToken, DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn));
                return cachedToken.Value;
            }
        }
        finally
        {
            tokenLock.Release();
        }
    }

    private sealed record CachedToken(string Value, DateTimeOffset ExpiresAt);

    private sealed record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);
}
