# 10 · Contrato OpenAPI y colección de Postman

El TDR pide documentar y probar los servicios con OpenAPI y Postman. Esta tarea escribe el contrato de la API pública del hub y una colección que lo prueba contra la plataforma levantada con Compose. Va después de la 03, porque la colección también prueba el envío a Ecuador.

## Contrato (`docs/api/openapi.yaml`)

- OpenAPI **3.1**, en inglés (como el código), con `info.description` breve en español.
- `servers`: `http://localhost:9080` (gateway local) y `https://intercom.fedrian.dev` (demo).
- Seguridad: esquema `oauth2` con flujo `clientCredentials` y `tokenUrl: /realms/intercom/protocol/openid-connect/token`. Cada operación indica el rol que necesita en su descripción (`documents:send` o `documents:receive`).
- Operaciones, iguales a `services/hub/src/app.ts` (léelo antes de escribir):
  - `GET /v1/document-types`;
  - `POST /v1/documents`, con las cabeceras `Idempotency-Key` y `X-Correlation-Id`, y respuestas 202 (aceptado para enrutar), 200 (repetición idempotente), 400, 401, 403, 422;
  - `GET /v1/documents` con `direction` y `status`;
  - `GET /v1/documents/{id}` con la traza;
  - `POST /v1/documents/{id}/acks`, con 200, 400, 404 y 409.
- Los errores usan un esquema `Problem` (`application/problem+json`), igual al que arma la función `problem()` del hub.
- El cuerpo del certificado no se copia: referencia `schemas/certificado-origen/v1/certificado-origen.schema.json` con `$ref` relativo. Un ejemplo por operación, tomado de `schemas/samples/`.
- No documentes `/health/*` ni `/metrics`: no pasan por el gateway.

## Prueba de que el contrato no se desvía

En `services/hub/test/openapi.test.ts`: lee `docs/api/openapi.yaml` (con el paquete `yaml`, versión exacta, solo en desarrollo), recorre las rutas registradas en Fastify (`app.printRoutes` o un hook `onRoute`) y falla si una ruta `/v1/...` del hub no está en el contrato, o si el contrato tiene una que el hub no tiene.

## Colección (`docs/api/postman/`)

- `mini-intercom.postman_collection.json` (formato v2.1) y `local.postman_environment.json` con `gateway`, `clientId`, `clientSecret` (los `dev-only-...` de Compose), y las variables que se llenan solas (`token`, `documentId`).
- Carpetas y peticiones, en orden, cada una con sus `pm.test`:
  1. **Token**: client credentials; guarda `token`.
  2. **Catálogo**: `GET /v1/document-types` lista `certificado-origen` v1.
  3. **Envío JSON BO → PE**: 202, guarda `documentId`; repetirlo con la misma `Idempotency-Key` devuelve 200 con el mismo `id`.
  4. **Envío XML BO → PE**: 202.
  5. **Errores**: sin token 401; documento que no cumple el esquema 422; destino igual al origen 422.
  6. **Traza**: `GET /v1/documents/{{documentId}}` hasta llegar a `ACCEPTED` (reintenta con `setNextRequest` hasta 10 veces, 1 s entre intentos) y verifica que la traza tiene `RECEIVED`, `ROUTED` y `ACCEPTED` en ese orden.
  7. **Ecuador por SOAP**: envío BO → EC y traza hasta `ACCEPTED`.
- `scripts/api-tests.sh`: corre la colección con `npx --yes newman@<versión exacta> run ...` contra el ambiente local y sale con el código de newman. Mismo estilo que `demo.sh`.

## CI

- En el job de pruebas del hub, valida el contrato con `npx --yes @redocly/cli@<versión exacta> lint docs/api/openapi.yaml`. Fija la versión y anótala en el resumen.
- La colección no corre en CI (necesita la plataforma completa): se corre en local y antes de cada demo.

## Documentación

- README: en la sección de la API, enlaza `docs/api/openapi.yaml` y explica cómo importar la colección en Postman y cómo correr `./scripts/api-tests.sh`.

## Verificación

```sh
(cd services/hub && npm test)                         # incluye openapi.test.ts
npx --yes @redocly/cli@<versión> lint docs/api/openapi.yaml
docker compose up -d --build && ./scripts/api-tests.sh   # todas las pruebas de la colección en verde
```
