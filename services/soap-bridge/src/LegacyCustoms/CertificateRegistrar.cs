using CustomsContracts;
using CoreWCF;
using Microsoft.EntityFrameworkCore;

namespace LegacyCustoms;

public sealed class CertificateRegistrar(CustomsDbContext db, TimeProvider timeProvider, double failRate = 0)
{
    public async Task<CertificateRegistrationResponse> RegisterAsync(
        CertificateRegistrationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (failRate > Random.Shared.NextDouble())
        {
            throw new FaultException("Customs registry is temporarily unavailable", new FaultCode("Unavailable"));
        }

        var existing = await db.Registrations
            .AsNoTracking()
            .SingleOrDefaultAsync(registration => registration.CertificateNumber == request.CertificateNumber, cancellationToken);
        if (existing is not null)
        {
            return ToResponse(existing);
        }

        var response = Validate(request, timeProvider.GetUtcNow().Date);
        var registration = new Registration
        {
            CertificateNumber = request.CertificateNumber,
            Status = response.Status,
            RegistrationNumber = response.RegistrationNumber,
            Reason = response.Reason,
            ImporterId = request.ImporterId,
            CorrelationId = request.CorrelationId,
            ReceivedAt = timeProvider.GetUtcNow().UtcDateTime,
            Items = request.Items.Select(item => new RegistrationItem
            {
                Line = item.Line,
                TariffCode = item.TariffCode,
                Description = item.Description,
                Quantity = item.Quantity,
                Unit = item.Unit,
                FobValue = item.FobValue,
                OriginCriterion = item.OriginCriterion
            }).ToList()
        };

        db.Registrations.Add(registration);
        await db.SaveChangesAsync(cancellationToken);
        if (registration.Status == RegistrationStatus.Accepted)
        {
            registration.RegistrationNumber = $"EC-REG-{request.IssueDate.Year}-{registration.Id:D6}";
            await db.SaveChangesAsync(cancellationToken);
            response.RegistrationNumber = registration.RegistrationNumber;
        }
        return response;
    }

    private static CertificateRegistrationResponse Validate(CertificateRegistrationRequest request, DateTime today)
    {
        if (request.ImporterCountry != "EC")
        {
            return Rejected("importer is not registered in EC");
        }

        if (request.Items.Count == 0)
        {
            return Rejected("certificate has no items");
        }

        if ((today - request.IssueDate.Date).TotalDays > 180)
        {
            return Rejected("certificate expired");
        }

        return new CertificateRegistrationResponse
        {
            Status = RegistrationStatus.Accepted
        };
    }

    private static CertificateRegistrationResponse Rejected(string reason) => new()
    {
        Status = RegistrationStatus.Rejected,
        Reason = reason
    };

    private static CertificateRegistrationResponse ToResponse(Registration registration) => new()
    {
        Status = registration.Status,
        RegistrationNumber = registration.RegistrationNumber,
        Reason = registration.Reason
    };
}
