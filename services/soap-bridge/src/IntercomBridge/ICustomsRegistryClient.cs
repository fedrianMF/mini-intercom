using System.ServiceModel;
using CustomsContracts;

namespace IntercomBridge;

[ServiceContract(Namespace = CustomsNamespaces.Registry, Name = "ICustomsRegistry")]
public interface ICustomsRegistryClient
{
    [OperationContract]
    Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request);
}
