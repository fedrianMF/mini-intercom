# Informe de revisión · Tarea 01 · Sistema aduanero simulado

| | |
|---|---|
| Entregable | Commit `15ba272` "Implement legacy customs SOAP registry" |
| Requisito | [docs/plan/01-legacy-customs.md](../plan/01-legacy-customs.md) |
| Fecha | 19/10/2026 |
| Resultado | **No conforme** en la entrega. Corregido durante la revisión; conforme con observaciones tras las correcciones. |

## Lo que el proveedor declaró

Implementación completa. Las pruebas no se pudieron correr por un problema de paquetes NuGet en su ambiente (`NETSDK1064`), "no por un error del código".

## Lo que se encontró al ejecutar en un ambiente limpio

| # | Severidad | Hallazgo | Corrección |
|---|---|---|---|
| 1 | Bloqueante | **No compilaba.** `Program.cs` usaba `CustomsDbContext`, `CertificateRegistrar` y el servicio sin `using LegacyCustoms;`. | Se agregó el `using`. |
| 2 | Bloqueante | **El servicio SOAP fallaba en cada llamada** con un fault genérico. CoreWCF resuelve el servicio por su tipo concreto, y solo estaba registrado por su interfaz. | `AddScoped<CustomsRegistryService>()`. |
| 3 | Alta | **Las pruebas SOAP no probaban nada real.** Fallaban al reemplazar la base de datos (EF Core 9+ guarda la configuración del proveedor en `IDbContextOptionsConfiguration<T>`), usaban `TestServer` aunque el cliente WCF abre su propia conexión, y el contrato del cliente tenía otro nombre que el del servidor. | Se quitan las dos registraciones, se usa `UseKestrel(0)` de .NET 10 y el contrato del cliente lleva `Name = "ICustomsRegistry"`. |
| 4 | Alta | **Dependencias vulnerables.** CoreWCF y `System.ServiceModel` traen versiones de `System.Security.Cryptography.Pkcs` y `.Xml` con avisos de severidad alta. No aparecían en la lista directa, solo con `--include-transitive`. | Se fijan las versiones parcheadas (10.0.13) en `Directory.Build.props`, con un comentario del porqué. |
| 5 | Baja | Advertencias del analizador: una prueba bloqueaba con `.GetAwaiter().GetResult()` y una interfaz de prueba era privada. | Prueba asíncrona e interfaz `internal`. |

Resultado tras las correcciones: compilación sin advertencias, **7 de 7 pruebas en verde** y `dotnet list package --vulnerable --include-transitive` sin hallazgos.

## Observaciones (no bloquean, pasan a tareas siguientes)

- **Concurrencia en la idempotencia.** Si dos mensajes con el mismo número de certificado llegan a la vez, el índice único rechaza el segundo con una excepción. El puente la recibiría como un fault permanente y mandaría el documento a la cola de muertos. Corrección sugerida: capturar `DbUpdateException` por clave duplicada, volver a leer y devolver el registro existente. Se incorpora a la tarea 02.
- El número de registro usa el año de emisión del certificado, no el año del registro. Aceptable; queda documentado.
- La validación de `ImporterCountry` está fija en `"EC"`. Aceptable para el simulador.

## Lección para la supervisión

"No se pudo probar por el ambiente" no es evidencia de que el código funciona. La aceptación exige una ejecución en un ambiente limpio, que es la que se automatiza en CI con la tarea 03.
