using System.ServiceModel;
using CustomsContracts;
using Microsoft.Extensions.Options;

namespace IntercomBridge;

public sealed class CustomsGateway(IOptions<BridgeOptions> options)
{
    private readonly BridgeOptions options = options.Value;

    public async Task<CertificateRegistrationResponse> RegisterAsync(CertificateRegistrationRequest request)
    {
        var binding = new BasicHttpBinding
        {
            SendTimeout = TimeSpan.FromSeconds(10)
        };
        var factory = new ChannelFactory<ICustomsRegistryClient>(binding, new EndpointAddress(options.CustomsSoapUrl));
        var channel = factory.CreateChannel();
        var clientChannel = (IClientChannel)channel;

        try
        {
            var response = await channel.RegisterCertificateAsync(request);
            clientChannel.Close();
            factory.Close();
            return response;
        }
        catch (FaultException exception) when (exception.Code.Name == "Unavailable")
        {
            Abort(clientChannel, factory);
            throw new TransientException(exception.Message, exception);
        }
        catch (FaultException)
        {
            Abort(clientChannel, factory);
            throw;
        }
        catch (EndpointNotFoundException exception)
        {
            Abort(clientChannel, factory);
            throw new TransientException(exception.Message, exception);
        }
        catch (TimeoutException exception)
        {
            Abort(clientChannel, factory);
            throw new TransientException(exception.Message, exception);
        }
        catch (CommunicationException exception)
        {
            Abort(clientChannel, factory);
            throw new TransientException(exception.Message, exception);
        }
        catch
        {
            Abort(clientChannel, factory);
            throw;
        }
    }

    private static void Abort(IClientChannel channel, ChannelFactory factory)
    {
        channel.Abort();
        factory.Abort();
    }
}
