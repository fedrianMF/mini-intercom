# Plan de trabajo

Cada archivo es una tarea para un agente (Codex CLI u otro). Se hacen en el orden de la tabla, una por vez. Cada una termina con su verificación en verde y los cambios en un commit propio. Después, cada entrega se revisa como si viniera de un proveedor (ver [docs/supervision](../supervision/README.md)).

| Orden | Tarea | Lenguaje | Resultado visible | Estado |
|---|---|---|---|---|
| 1 | [01 · Sistema aduanero simulado](01-legacy-customs.md) | C# | Servicio SOAP con WSDL y SQL Server | Hecha y revisada |
| 2 | [02 · Puente INTERCOM ↔ SOAP](02-intercom-bridge.md) | C# | Ecuador recibe documentos a través de SOAP | |
| 3 | [03 · Integración](03-integracion.md) | C#, SQL, Compose, CI | Ecuador de punta a punta, procedimiento almacenado en SQL Server y job de .NET en CI | |
| 3b | [10 · Contrato OpenAPI y colección de Postman](10-openapi-postman.md) | OpenAPI, Postman | API documentada y probada con newman | |
| 4 | [04 · Kit de certificación y página "Qué demuestra"](04-certification-kit.md) | Python, Vue | Certificación de entidades y página pública en Vue 3 | |
| 5 | [05 · Despliegue en Dokploy](05-dokploy.md) | Compose | Demo en `intercom.fedrian.dev` | |
| 6 | [06 · Reportes de estado](06-reportes.md) | Node, SQL | Reporte por país y estado en CSV y Grafana | Opcional |
| 7 | [07 · Firma digital XML](07-firma-xml.md) | Node + Python | El hub rechaza XML alterados | Opcional |
| 8 | [08 · Documentación](08-documentacion.md) | | README, ADR y runbook al día | |
| 9 | [09 · Calendario de vencimientos](09-vencimientos.md) | Python | Aviso de certificados y secretos por vencer | Opcional |

Fuera del código, para Felix (opcional): grabar un **video de 2 minutos** con la página, la traza de un documento y Grafana, cuando la tarea 5 esté publicada.

## Prioridad

El expediente ya se envió. La convocatoria se extendió: entrevista técnica el **5 y 6/11** y prueba técnica el **9 y 10/11**.

Orden: 2, 3, 10 (la 3b de la tabla), 4, 5 y luego la 8. Las tareas 3, 4 y 10 cubren lo que el TDR pone como indispensable y la demo no tenía: procedimientos almacenados en SQL Server, un framework de frontend (Vue) y la documentación y prueba de la API (OpenAPI, Postman). Las opcionales (6, 7, 9 y el video) entran solo si sobra tiempo.

## Por qué tres lenguajes

Cada lenguaje está donde tiene sentido, no por sumar a la lista:

- **Node/TypeScript**: el hub (recibir, validar, firmar, enrutar, reportar).
- **C#/.NET**: el sistema nacional heredado y su puente. Es lo típico de una aduana con SOAP y SQL Server.
- **Python**: las herramientas de la entidad y de la Secretaría (firmar, certificar, vencimientos).

Y un frontend en **Vue 3**, solo para la página pública de prueba.

## Prompt para Codex

```
Lee AGENTS.md y luego implementa docs/plan/0N-<tarea>.md. No avances a la siguiente tarea.
```

Antes de dar la tarea por hecha, Codex tiene que correr la verificación de la tarea en un contenedor limpio. "No se pudo probar por el ambiente" no cuenta como hecho.
