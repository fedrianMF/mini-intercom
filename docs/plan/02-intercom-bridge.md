# 02 · Puente INTERCOM ↔ SOAP

Worker en .NET (`services/soap-bridge/src/IntercomBridge`) que reemplaza al adaptador Node de Ecuador:

1. Consume `entity.EC.inbox`.
2. Traduce el documento al contrato SOAP.
3. Llama al sistema aduanero de la tarea 01.
4. Responde el acuse al hub.

Hace lo mismo que `services/entity-adapter/src/main.ts`: léelo antes de empezar y respeta el contrato del hub descrito en `AGENTS.md`.

Paquetes (ya instalados, sin cambiar versión): `RabbitMQ.Client` 7.2.2 (API asíncrona) y `System.ServiceModel.Http` 10.0.652802.

## Qué construir

- `BridgeOptions`, enlazado con `IOptions` desde variables de entorno:
  - `COUNTRY`, `AMQP_URL`, `HUB_URL`, `TOKEN_URL`, `CLIENT_ID`, `CLIENT_SECRET`;
  - `MAX_ATTEMPTS` (por defecto 3);
  - `CUSTOMS_SOAP_URL` (p. ej. `http://legacy-customs-ec:8080/CustomsRegistry.svc`).

  Usa los mismos nombres de variable que el adaptador Node. Valida al arrancar (`ValidateOnStart`).
- `InboundDocument`: record con los campos del mensaje. El payload es `JsonElement?` y `PayloadXml` es `string?`.
- `DocumentMapper.ToRegistrationRequest(InboundDocument doc, string correlationId)`:
  - `format = "json"`: lee el payload con los nombres de `schemas/samples/certificado-origen.json`. Mapeo: `numero`, `fechaEmision`, `exportador.*`, `importador.*`, `mercancias[]` con `item`, `subpartidaNandina`, `descripcion`, `cantidad`, `unidad`, `valorFob`, `criterioOrigen`.
  - `format = "xml"`: `XDocument` con el namespace `urn:mini-intercom:certificado-origen:v1`, con los mismos campos que `schemas/samples/certificado-origen.xml`.
  - Si falta un campo obligatorio, lanza `UnmappableDocumentException` con el nombre del campo.
- `ICustomsRegistryClient`: interfaz con atributos `System.ServiceModel` (`[ServiceContract(Namespace = CustomsNamespaces.Registry, Name = "ICustomsRegistry")]`). Tiene que coincidir con el contrato del servidor.
- `CustomsGateway`: crea el canal con `ChannelFactory` y `BasicHttpBinding`, con 10 s de timeout de envío. Clasifica los errores:
  - `FaultException` con código `Unavailable`, `EndpointNotFoundException`, `TimeoutException` y `CommunicationException` que no sea fault: `TransientException`.
  - Cualquier otro `FaultException`: error permanente.
- `HubClient` (cliente HTTP tipado):
  - pide el token con client credentials y lo guarda hasta 10 s antes de que venza;
  - envía el acuse;
  - `2xx` y `409`: éxito;
  - `401`, `5xx` y error de red: `TransientException`;
  - otro código: error permanente.
- `AckDecision.From(CertificateRegistrationResponse)`: `Accepted` → `{"result":"accepted"}`; `Rejected` → `{"result":"rejected","reason": Reason}`.
- `RetryPolicy.OnTransientFailure(int attempt, int maxAttempts)`: devuelve reintentar con `attempt + 1` o enviar a la cola de muertos. Es la misma regla de `logic.ts`.
- `InboxConsumer : BackgroundService`:
  - Conexión con reconexión cada 3 s.
  - Canal con confirmaciones de publicación: `CreateChannelOptions(publisherConfirmationsEnabled: true, publisherConfirmationTrackingEnabled: true)`.
  - `QueueDeclarePassiveAsync` (la topología la declara el hub) y `BasicQosAsync(0, 5, false)`.
  - `AsyncEventingBasicConsumer` con `autoAck: false`.
  - Por cada mensaje:
    1. Mapear. Si no se puede, enviar el acuse `rejected` con `"unreadable document: <campo>"`.
    2. Llamar al SOAP.
    3. Enviar el acuse.
    4. Si hay `TransientException`, aplicar `RetryPolicy`: reintento en `intercom.retry` o muerto en `intercom.dead`. Mantén la routing key y las cabeceras, con `x-attempt` y `x-failure-reason` actualizadas.
    5. Si hay error permanente, mandarlo directo a `intercom.dead`.
    6. Siempre `BasicAckAsync` del original al final.
  - Log JSON por mensaje, con `documentId`, `correlationId`, `attempt` y el resultado, usando `ILogger.BeginScope`.
- `Program.cs`: `Host.CreateApplicationBuilder`, opciones, `AddHttpClient<HubClient>`, `AddSingleton<CustomsGateway>`, `AddHostedService<InboxConsumer>`, `AddJsonConsole()`.

## Pruebas

- `DocumentMapperTests`: mapea las dos muestras de `schemas/samples` (cópialas a la salida desde el `.csproj` con `<None Include="..\..\..\..\schemas\samples\*" LinkBase="samples" CopyToOutputDirectory="PreserveNewest" />`) y verifica número, importador e ítems. Además, un JSON sin `numero` lanza `UnmappableDocumentException`.
- `HubClientTests`, con un `HttpMessageHandler` falso: token cacheado (una sola llamada al token en dos acuses), `409` es éxito, `503` es transitorio y `400` es permanente.
- `RetryPolicyTests` y `AckDecisionTests`.
- Sin pruebas que necesiten RabbitMQ real: el flujo completo se prueba en la tarea 03 con Compose.

## Verificación

```sh
docker run --rm -v "$PWD":/src -v nuget:/root/.nuget -w /src/services/soap-bridge mcr.microsoft.com/dotnet/sdk:10.0 sh -c "dotnet restore && dotnet test"
```

## Corrección pendiente de la tarea 01 (del informe de revisión)

En `CertificateRegistrar`, si `SaveChangesAsync` falla por la clave única de `CertificateNumber` (dos mensajes iguales a la vez), captura `DbUpdateException`, descarta los cambios del contexto (`db.ChangeTracker.Clear()`), vuelve a leer el registro y devuelve su respuesta. Agrega una prueba que inserte el registro antes del segundo `SaveChanges` y verifique que devuelve el existente sin lanzar.
