using CustomsContracts;
using IntercomBridge;

namespace SoapBridge.Tests;

public sealed class AckDecisionTests
{
    [Fact]
    public void Accepted_registration_becomes_accepted_ack()
    {
        var decision = AckDecision.From(new CertificateRegistrationResponse
        {
            Status = RegistrationStatus.Accepted,
            RegistrationNumber = "EC-REG-2026-000001"
        });

        Assert.Equal("accepted", decision.Result);
        Assert.Null(decision.Reason);
    }

    [Fact]
    public void Rejected_registration_keeps_reason()
    {
        var decision = AckDecision.From(new CertificateRegistrationResponse
        {
            Status = RegistrationStatus.Rejected,
            Reason = "certificate expired"
        });

        Assert.Equal("rejected", decision.Result);
        Assert.Equal("certificate expired", decision.Reason);
    }
}
