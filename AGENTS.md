# mini-INTERCOM: reglas para agentes

Plataforma de referencia para intercambiar documentos electrónicos de comercio exterior entre entidades de los países de la CAN. La lee el comité de una convocatoria: el código tiene que ser claro, probado y fácil de explicar en una entrevista.

## Cómo trabajar

- Las tareas están en `docs/plan/`. Implementa **una tarea por vez**, en el orden numerado, y solo lo que pide su archivo. Si algo del plan no funciona, haz el cambio mínimo que lo resuelva y anótalo en el resumen final.
- Antes de crear un archivo, mira uno hermano y copia su estructura y estilo.
- Código, nombres, comentarios y mensajes de log en inglés. Documentación (`docs/`, `README.md`) en español.
- Comentarios solo donde el porqué no es obvio. Sin código comentado ni TODO.
- No agregues dependencias fuera de las que nombra la tarea. Usa las versiones exactas que indica.
- Nunca pongas secretos reales en el repo. Los de desarrollo empiezan con `dev-only-`.
- No hagas push. Al terminar, deja los cambios sin commit y propone un mensaje de commit en inglés, en imperativo, de una línea.

## Al terminar cada tarea

1. Corre la verificación que indica la tarea y confirma que pasa.
2. Resume en español: qué cambiaste, archivos tocados, cómo probarlo y cualquier decisión no obvia.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `services/hub` | Hub en Node 22 + TypeScript (Fastify, PostgreSQL, RabbitMQ). Pruebas: `npm test`. |
| `services/entity-adapter` | Adaptador de país en Node. Consume `entity.<PAIS>.inbox` y responde el acuse al hub. |
| `services/soap-bridge` | .NET 10. Sistema aduanero simulado en SOAP + SQL Server, y el puente que lo conecta a INTERCOM. |
| `tools/certification-kit` | Python 3.12. Kit de certificación de entidades y página pública de prueba. |
| `schemas/` | JSON Schema, XSD y muestras del certificado de origen. |
| `deploy/` | APISIX, Keycloak, observabilidad, Helm, Argo CD y despliegue en Dokploy. |
| `docs/` | Arquitectura, runbook, seguridad, ADR y el plan de tareas. |

## Contrato del hub (lo que usan los adaptadores)

- Mensaje en la cola `entity.<PAIS>.inbox` (JSON): `{documentId, documentType, originCountry, destinationCountry, format: "json"|"xml", payload, payloadXml}`. Cabeceras AMQP: `x-attempt` (número de intento, empieza en 1) y `x-correlation-id`.
- Acuse: `POST {HUB_URL}/v1/documents/{documentId}/acks` con `Authorization: Bearer <token>` y `X-Correlation-Id`. El cuerpo es `{"result":"accepted"}` o `{"result":"rejected","reason":"..."}`. Un 409 significa que ya estaba registrado: trátalo como éxito.
- Token: OAuth 2.0 client credentials contra `TOKEN_URL`, con `CLIENT_ID` y `CLIENT_SECRET`.
- Falla transitoria: publicar el mismo mensaje en el exchange `intercom.retry` con `x-attempt + 1` y `x-failure-reason`. Agotados los intentos (`MAX_ATTEMPTS`), publicar en `intercom.dead`. En los dos casos se hace `ack` del original. La referencia es `services/entity-adapter/src/main.ts`.

## Entorno

- Docker Compose levanta todo: `docker compose up -d --build` y luego `./scripts/demo.sh`.
- .NET sin SDK local: `docker run --rm -v "$PWD":/src -w /src/services/soap-bridge mcr.microsoft.com/dotnet/sdk:10.0 dotnet test`.
