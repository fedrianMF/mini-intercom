# Plan de trabajo

Cada archivo es una tarea para un agente (Codex CLI u otro). Se hacen en orden, una por vez, y cada una termina con su verificación en verde y los cambios sin commit para revisión.

| # | Tarea | Resultado visible |
|---|---|---|
| 01 | [Sistema aduanero simulado (SOAP + SQL Server)](01-legacy-customs.md) | Servicio SOAP en C# con WSDL, reglas de negocio y SQL Server |
| 02 | [Puente INTERCOM ↔ SOAP](02-intercom-bridge.md) | Worker en C# que consume la cola de Ecuador y llama al sistema SOAP |
| 03 | [Integración: imágenes, Compose, CI y Helm](03-integracion.md) | Ecuador funciona de punta a punta con .NET; CI con job de .NET |
| 04 | [Kit de certificación (Python)](04-certification-kit.md) | CLI que certifica una entidad y página pública de prueba |
| 05 | [Despliegue en Dokploy](05-dokploy.md) | Demo pública en `intercom.fedrian.dev` |
| 06 | [Documentación](06-documentacion.md) | README, ADR y runbook al día |

## Por qué estas piezas

- **01 y 02** muestran el caso más común en interoperabilidad: conectar un sistema nacional heredado, que solo habla SOAP y guarda en SQL Server, sin cambiarlo. Cubren .NET/C#, SOAP y SQL Server, que el TDR pide.
- **04** cubre la función de acompañar la incorporación de entidades: una entidad nueva corre el kit y obtiene un informe de conformidad. También cubre Python.
- **05** deja una demo pública que el comité puede probar.

## Prompt para Codex

```
Lee AGENTS.md y luego implementa docs/plan/0N-<tarea>.md. No avances a la siguiente tarea.
```
