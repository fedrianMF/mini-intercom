namespace IntercomBridge;

public sealed record RetryAction(bool ShouldRetry, int Attempt)
{
    public string Exchange => ShouldRetry ? "intercom.retry" : "intercom.dead";
}

public static class RetryPolicy
{
    public static RetryAction OnTransientFailure(int attempt, int maxAttempts) =>
        attempt < maxAttempts ? new RetryAction(true, attempt + 1) : new RetryAction(false, attempt);
}
