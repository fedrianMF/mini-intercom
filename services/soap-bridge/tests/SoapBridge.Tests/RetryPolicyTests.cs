using IntercomBridge;

namespace SoapBridge.Tests;

public sealed class RetryPolicyTests
{
    [Fact]
    public void Transient_failure_before_limit_schedules_next_attempt()
    {
        var action = RetryPolicy.OnTransientFailure(1, 3);

        Assert.True(action.ShouldRetry);
        Assert.Equal(2, action.Attempt);
        Assert.Equal("intercom.retry", action.Exchange);
    }

    [Fact]
    public void Transient_failure_at_limit_goes_to_dead_letters()
    {
        var action = RetryPolicy.OnTransientFailure(3, 3);

        Assert.False(action.ShouldRetry);
        Assert.Equal(3, action.Attempt);
        Assert.Equal("intercom.dead", action.Exchange);
    }
}
