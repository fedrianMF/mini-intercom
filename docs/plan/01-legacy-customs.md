# 01 · Sistema aduanero simulado (SOAP + SQL Server)

Simula el sistema heredado de la aduana de Ecuador: expone un servicio **SOAP 1.1** con WSDL y guarda en **SQL Server**. Representa un sistema nacional que la plataforma no puede cambiar.

El esqueleto ya existe en `services/soap-bridge` (solución `SoapBridge.sln`, proyectos `CustomsContracts`, `LegacyCustoms`, `IntercomBridge` y `SoapBridge.Tests`, con los paquetes instalados). No cambies las versiones:

- `CoreWCF.Http` 1.9.1
- `Microsoft.EntityFrameworkCore.SqlServer` 10.0.13
- `Microsoft.EntityFrameworkCore.Sqlite` 10.0.13 y `Microsoft.AspNetCore.Mvc.Testing` 10.0.13 (solo en pruebas)

## Qué construir

### `CustomsContracts` (data contracts compartidos)

Solo `System.Runtime.Serialization`, sin paquetes. Namespace XML: `urn:aduana-ec:registro:v1` (constante `CustomsNamespaces.Registry`).

- `CertificateRegistrationRequest`: `CertificateNumber`, `IssueDate` (`DateTime`, solo fecha), `OriginCountry`, `ExporterName`, `ExporterId`, `ImporterName`, `ImporterId`, `ImporterCountry`, `CorrelationId`, `Items` (`List<CertificateItem>`).
- `CertificateItem`: `Line`, `TariffCode`, `Description`, `Quantity` (`decimal`), `Unit`, `FobValue` (`decimal`), `OriginCriterion`.
- `CertificateRegistrationResponse`: `Status` (enum `RegistrationStatus { Accepted, Rejected }`, con `[EnumMember]`), `RegistrationNumber` (nullable), `Reason` (nullable).

Cada tipo lleva `[DataContract(Namespace = CustomsNamespaces.Registry)]` y cada miembro `[DataMember(Order = n)]`.

La interfaz del servicio **no** va aquí: el servidor usa los atributos de CoreWCF y el cliente los de `System.ServiceModel`, como pasa en la vida real cuando el cliente se genera desde el WSDL.

### `LegacyCustoms` (ASP.NET Core + CoreWCF)

- `ICustomsRegistry` con `[CoreWCF.ServiceContract(Namespace = CustomsNamespaces.Registry)]` y una operación `[OperationContract] Task<CertificateRegistrationResponse> RegisterCertificateAsync(CertificateRegistrationRequest request)`.
- `CustomsRegistryService` implementa la interfaz y delega en `CertificateRegistrar`.
- `CertificateRegistrar` tiene las reglas de negocio, recibe `CustomsDbContext` y `TimeProvider`, y aplica en este orden:
  1. Si ya hay un registro con el mismo `CertificateNumber`, devuelve **la misma respuesta** que la primera vez. Es idempotente: un reintento no duplica.
  2. `ImporterCountry != "EC"`: rechazado, `"importer is not registered in EC"`.
  3. `Items` vacío: rechazado, `"certificate has no items"`.
  4. `IssueDate` con más de 180 días respecto de hoy: rechazado, `"certificate expired"`.
  5. En otro caso: aceptado con `RegistrationNumber = $"EC-REG-{año}-{id:D6}"`.
  Los rechazos también se guardan, para que el reintento devuelva el mismo rechazo.
- Falla simulada: si `Customs:FailRate` (0 a 1, por defecto 0) es mayor que un aleatorio, lanza `FaultException` con código `"Unavailable"` antes de tocar la base. Sirve para mostrar reintentos.
- Persistencia (`CustomsDbContext`):
  - `Registration`: `Id` identity, `CertificateNumber` único, `Status`, `RegistrationNumber`, `Reason`, `ImporterId`, `CorrelationId`, `ReceivedAt`.
  - `RegistrationItem`: relación 1:N con `Registration`, con los campos del ítem.
  - `decimal` con precisión `(18,2)`.
  - Conexión desde `ConnectionStrings:Customs`.
  - Al arrancar, `Database.EnsureCreatedAsync()` con reintentos cada 3 s hasta 20 veces, porque SQL Server tarda en levantar. Comenta en una línea por qué no hay migraciones: el esquema lo controla el sistema heredado, no esta demo.
- `Program.cs`:
  - `AddServiceModelServices()` y `AddServiceModelMetadata()`.
  - Endpoint `BasicHttpBinding` en `/CustomsRegistry.svc`, con WSDL en `/CustomsRegistry.svc?wsdl` (`ServiceMetadataBehavior.HttpGetEnabled = true`).
  - `GET /health`: 200 si `Database.CanConnectAsync()`; si no, 503.
  - `GET /registrations?limit=20`: últimos registros en JSON (`certificateNumber`, `status`, `registrationNumber`, `reason`, `receivedAt`), para la página de prueba. `limit` va de 1 a 100.
  - Logs en JSON (`AddJsonConsole`).
  - `public partial class Program;` al final, para las pruebas.
- Puerto 8080 (el predeterminado de las imágenes .NET).

## Pruebas (`SoapBridge.Tests`)

- `CertificateRegistrarTests`, con SQLite en memoria (`DataSource=:memory:`, conexión abierta durante la prueba) y `FakeTimeProvider` o un `TimeProvider` propio fijo. Un caso por regla:
  - acepta y numera;
  - rechaza otro país;
  - rechaza sin ítems;
  - rechaza vencido;
  - el reintento devuelve la misma respuesta y no crea una segunda fila.
- `CustomsRegistrySoapTests`: levanta la app con `WebApplicationFactory<Program>` usando Kestrel en un puerto libre (`UseKestrel(0)` en .NET 10; si no está disponible, arranca la app con `UseUrls("http://127.0.0.1:0")`), con la base reemplazada por SQLite. Después:
  - `GET ?wsdl` contiene `RegisterCertificate`;
  - una llamada SOAP real con un cliente `ChannelFactory` definido en la prueba (interfaz con atributos `System.ServiceModel`) devuelve `Accepted`. Agrega `System.ServiceModel.Http` 10.0.652802 al proyecto de pruebas si hace falta.

## Verificación

```sh
docker run --rm -v "$PWD":/src -w /src/services/soap-bridge mcr.microsoft.com/dotnet/sdk:10.0 dotnet test
```

Todas las pruebas en verde y sin advertencias de nulabilidad nuevas.
