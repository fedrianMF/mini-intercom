using CustomsContracts;
using CoreWCF;

namespace LegacyCustoms;

[ServiceContract(Namespace = CustomsNamespaces.Registry)]
public interface ICustomsRegistry
{
    [OperationContract]
    Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request);
}
