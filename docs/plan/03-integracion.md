# 03 · Integración: imágenes, Compose, CI y Helm

Ecuador pasa a usar la pila .NET. Los otros países siguen con el adaptador Node.

## Imágenes

- `services/soap-bridge/LegacyCustoms.Dockerfile` y `services/soap-bridge/IntercomBridge.Dockerfile`, con contexto `services/soap-bridge`. Son multi-etapa:
  - compilación con `mcr.microsoft.com/dotnet/sdk:10.0` (`dotnet publish -c Release -o /app`, sin `--self-contained`);
  - ejecución de LegacyCustoms con `mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra` (incluye ICU, que necesita SqlClient);
  - ejecución del bridge con `mcr.microsoft.com/dotnet/runtime:10.0-noble-chiseled`.
  Las imágenes chiseled ya corren como usuario no root y no tienen shell.
- `services/soap-bridge/.dockerignore` con `**/bin`, `**/obj` y `tests`.

## Compose (`compose.yaml`)

- `sqlserver`:
  - imagen `mcr.microsoft.com/mssql/server:2022-latest`;
  - `ACCEPT_EULA: "Y"`, `MSSQL_PID: Developer`, `MSSQL_SA_PASSWORD: dev-only-Passw0rd`, `MSSQL_MEMORY_LIMIT_MB: "1024"`;
  - volumen `mssqldata`;
  - healthcheck con `/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$$MSSQL_SA_PASSWORD" -Q "SELECT 1"`.
- `legacy-customs-ec`:
  - depende de `sqlserver` sano;
  - `ConnectionStrings__Customs: Server=sqlserver;Database=CustomsEc;User Id=sa;Password=dev-only-Passw0rd;TrustServerCertificate=True`;
  - `Customs__FailRate: "0"`;
  - puerto `8085:8080`, para ver `?wsdl` y `/registrations` desde el host.
- `bridge-ec`:
  - reemplaza a `adapter-ec`;
  - mismas variables que `adapter-ec`, más `CUSTOMS_SOAP_URL: http://legacy-customs-ec:8080/CustomsRegistry.svc`;
  - depende de `hub` sano y de `legacy-customs-ec` iniciado.
- Agrega `mssqldata` a `volumes`.

## Procedimiento almacenado (SQL Server)

El TDR pide procedimientos almacenados y optimización en SQL Server. El sistema heredado los usa para su reporte diario, como es típico en una aduana.

- `services/soap-bridge/src/LegacyCustoms/Sql/001_index_received_status.sql`: índice `IX_Registrations_ReceivedAt_Status` sobre `Registrations (ReceivedAt, Status)`, creado solo si no existe (`IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)`).
- `services/soap-bridge/src/LegacyCustoms/Sql/002_usp_RegistrationSummary.sql`: `CREATE OR ALTER PROCEDURE dbo.usp_RegistrationSummary @From date, @To date`. Devuelve una fila por día y estado: `Day` (`date`), `Status`, `Total` (`int`), con el rango inclusivo en `@From` y exclusivo en `@To + 1 día`, para que use el índice. `SET NOCOUNT ON` al inicio.
- Los dos archivos van como `EmbeddedResource` y se ejecutan en orden al arrancar, después de `EnsureCreatedAsync()`, solo si `db.Database.IsSqlServer()` (en las pruebas con SQLite se omiten). Cada archivo es un solo lote: sin `GO`.
- Endpoint `GET /registrations/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` (por defecto, los últimos 7 días): `db.Database.SqlQuery<RegistrationSummaryRow>($"EXEC dbo.usp_RegistrationSummary @From = {from}, @To = {to}").ToListAsync()`. Con un proveedor que no sea SQL Server responde 501. Rango mayor a 92 días: 400.
- Prueba unitaria (SQLite): el endpoint responde 501 y el rango inválido responde 400. La prueba real contra SQL Server es el paso 5 de la demo.

## Demo (`scripts/demo.sh`)

Nuevo paso 5: "Certificado JSON, Bolivia → Ecuador, a través del puente SOAP". Envía la muestra JSON con `destinationCountry: "EC"` e `importador.pais = "EC"`, espera el estado final y luego muestra `curl -s localhost:8085/registrations?limit=1 | jq`. Debe verse `ACCEPTED` en el hub y el `registrationNumber` en el sistema aduanero. Al final, `curl -s localhost:8085/registrations/summary | jq` muestra el resumen que devuelve el procedimiento almacenado.

## CI (`.github/workflows/ci.yml`)

- Job `dotnet`, llamado "Test (soap-bridge)":
  - `actions/setup-dotnet@v5` con `dotnet-version: 10.0.x`;
  - `dotnet test services/soap-bridge --logger "console;verbosity=normal"`;
  - auditoría: `dotnet list services/soap-bridge/SoapBridge.sln package --vulnerable --include-transitive`, y fallar si la salida contiene `has the following vulnerable packages`.
- `images.needs` incluye `dotnet`. La matriz suma dos entradas:
  - `{ name: legacy-customs, context: services/soap-bridge, dockerfile: services/soap-bridge/LegacyCustoms.Dockerfile }`
  - `{ name: soap-bridge, context: services/soap-bridge, dockerfile: services/soap-bridge/IntercomBridge.Dockerfile }`
- En `docker/metadata-action`, agrega `type=raw,value=latest,enable={{is_default_branch}}` para que Dokploy pueda usar `latest`.
- `.github/dependabot.yml`: agrega el ecosistema `nuget` en `/services/soap-bridge` y los Dockerfiles .NET al grupo de docker, con el mismo esquema mensual, agrupado y sin versiones mayores.

## Helm (`deploy/helm/mini-intercom`)

- Valores nuevos `soapBridge`:
  - `enabled: false` por defecto, `true` en `values-production.yaml`;
  - `country: EC`, `clientId: ecuapass-ec`;
  - imágenes `mini-intercom-legacy-customs` y `mini-intercom-soap-bridge`, con la misma `tag` que el resto;
  - `existingSecret` con `CUSTOMS_CONNECTION_STRING` y `CLIENT_SECRET`;
  - recursos chicos.
- `templates/soap-bridge.yaml`: Deployment y Service de legacy-customs (probes en `/health`) y Deployment del bridge. Usa los helpers `mi.securityContext` y `mi.podSecurityContext`.
- En `adapters.yaml`, omite el país de `soapBridge.country` cuando `soapBridge.enabled`, para que no haya dos consumidores de la misma cola.
- SQL Server no va en el chart: se asume una instancia gestionada, como en producción.

## Verificación

```sh
docker compose up -d --build && ./scripts/demo.sh      # el paso 5 termina en ACCEPTED con registrationNumber y el resumen del procedimiento
helm lint deploy/helm/mini-intercom -f deploy/helm/mini-intercom/values-production.yaml
```

Después del push, el CI en verde con los 7 jobs.
