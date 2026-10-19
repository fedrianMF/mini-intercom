using CustomsContracts;

namespace LegacyCustoms;

public sealed class CustomsRegistryService(CertificateRegistrar registrar) : ICustomsRegistry
{
    public Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request) =>
        registrar.RegisterAsync(request);
}
