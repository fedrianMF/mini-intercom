# Informe de revisión · Tarea 02 · Puente INTERCOM ↔ SOAP

| | |
|---|---|
| Entregable | Commit `6cc8820` "Implement IntercomBridge with Customs Gateway and Document Mapping" (rama `feat/intercom-bridge`) |
| Requisito | [docs/plan/02-intercom-bridge.md](../plan/02-intercom-bridge.md) |
| Fecha | 02/11/2026 |
| Resultado | **Conforme con observaciones.** Dos correcciones de robustez hechas durante la revisión. |

## Lo que el proveedor entregó

Puente .NET completo: `BridgeOptions` validadas al arrancar, `DocumentMapper` para JSON y XML, cliente SOAP con `ChannelFactory`, `HubClient` con token cacheado, `RetryPolicy`, `AckDecision` e `InboxConsumer`. También trae la corrección pendiente de la tarea 01 (registro duplicado concurrente) y el renombre de la entidad de demo a `entidad-bo`.

## Lo que se encontró al ejecutar en un ambiente limpio

Contenedor `mcr.microsoft.com/dotnet/sdk:10.0` sin caché previa: **compila sin advertencias, 19 de 19 pruebas en verde** y `dotnet list package --vulnerable --include-transitive` sin hallazgos. Esta vez el proveedor sí entregó código que compila y pasa.

| # | Severidad | Hallazgo | Corrección |
|---|---|---|---|
| 1 | Alta | **Se podía perder un documento.** `InboxConsumer` confirmaba (`ack`) el mensaje original en un `finally`, aunque fallara la publicación en `intercom.retry` o `intercom.dead`, o aunque el servicio se estuviera apagando. En esos casos el mensaje desaparecía sin acuse al hub ni copia en la cola de muertos. El adaptador Node de referencia no confirma si la publicación falla. | El `ack` se hace solo cuando el documento quedó resuelto: acuse enviado al hub, o copia confirmada en reintento o cola de muertos. Si no, el mensaje queda sin confirmar y RabbitMQ lo vuelve a entregar. |
| 2 | Media | **Un 401 del hub se reintentaba con el mismo token.** Si Keycloak rota claves o revoca el token, los reintentos fallaban con el token cacheado hasta que venciera. | Un 401 descarta el token cacheado. Se agregó una prueba: después de un 401, el siguiente acuse pide token nuevo. |

Resultado tras las correcciones: **20 de 20 pruebas en verde**.

## Revisado y correcto

- Clasificación de errores SOAP: `Unavailable`, endpoint caído, timeout y errores de comunicación son transitorios; otro fault es permanente. `FaultException` se captura antes que `CommunicationException`, que es su clase base.
- `HubClient`: 2xx y 409 son éxito, 401 y 5xx transitorios, el resto permanente. El token se pide una sola vez para dos acuses, con un semáforo para que dos mensajes no lo pidan a la vez.
- `DocumentMapper`: cada campo faltante lanza `UnmappableDocumentException` con su nombre exacto (por ejemplo `mercancias[0].valorFob`), así el rechazo dice qué falta.
- Corrección de la tarea 01: la prueba simula el registro concurrente con un interceptor de EF Core que inserta el mismo número justo antes de `SaveChanges`. Prueba lo que dice probar.
- Renombre de `senavex-bo` a `entidad-bo` completo: no queda ninguna mención fuera de `docs/plan/`.

## Observaciones (no bloquean)

- `CustomsGateway` crea un `ChannelFactory` por mensaje. Es correcto, pero caro. Con el volumen de la demo no importa; en producción se reutilizaría la fábrica.
- Un `MAX_ATTEMPTS` mal escrito (por ejemplo `tres`) se ignora y usa 3, en lugar de fallar al arrancar.
- `Microsoft.Extensions.Http` se agregó fuera de la lista de paquetes de la tarea. Está justificado: `AddHttpClient` lo necesita.
- En la máquina de desarrollo aparece la advertencia `NU1510` por paquetes que .NET 10 ya incluye. Son los fijados a propósito en la tarea 01 por vulnerabilidades transitivas; se mantienen.
- El flujo completo con RabbitMQ y SQL Server reales se prueba en la tarea 03 con Compose.

## Lección para la supervisión

Que compile y pase las pruebas no basta. El hallazgo 1 no lo cubre ninguna prueba unitaria, y se encontró leyendo el manejo de errores línea por línea contra la implementación de referencia. En un sistema de mensajería, la pregunta clave es siempre: "¿en qué caso confirmo un mensaje que no quedó guardado en ningún lado?".
