# 04 · Kit de certificación (Python)

Cuando una entidad nueva se conecta a INTERCOM, tiene que demostrar que cumple el protocolo antes de pasar a producción. El runbook describe esas pruebas en "Alta de una entidad nueva". Este kit las automatiza y genera un informe de conformidad. Además sirve la página pública de prueba de la demo.

Ubicación: `tools/certification-kit`. Python 3.12, empaquetado con `pyproject.toml` (hatchling), comando `intercom-cert`.

Dependencias, en versiones exactas:
- `httpx==0.28.1`, `fastapi==0.146.0`, `uvicorn==0.54.0`;
- desarrollo: `pytest==9.1.1`, `respx==0.23.1`, `ruff==0.17.1`.

## Casos de certificación (`intercom_cert/cases.py`)

Cada caso devuelve `CaseResult(id, title, passed, detail, document_id | None, trace | None)`. El `trace` son los eventos del documento.

1. `auth-required`: `POST /v1/documents` sin token devuelve 401.
2. `valid-document`: la muestra válida hacia `destination` llega a `ACCEPTED` en menos de `timeout` segundos (consulta cada 1 s).
3. `schema-error`: la subpartida `"1008"` devuelve 422 `application/problem+json` con al menos un error que menciona `subpartidaNandina`.
4. `idempotency`: dos envíos con la misma `Idempotency-Key` devuelven el mismo `id`.
5. `business-rejection`: `importador.pais` distinto del destino termina en `REJECTED`, con motivo no vacío en el último evento.

La muestra se carga de `schemas/samples/certificado-origen.json`. Se incluye como dato del paquete, copiada en `intercom_cert/samples/` durante el build. Cada envío cambia `numero` por uno único (`CERT-<timestamp>-<n>`) para que el idempotente del sistema destino no mezcle corridas.

## CLI (`intercom_cert/cli.py`, con argparse)

```
intercom-cert run --gateway URL --client-id ID --client-secret SECRET --destination PE \
                  [--timeout 30] [--json informe.json] [--markdown informe.md]
```

- Pide el token en `{gateway}/realms/intercom/protocol/openid-connect/token`.
- Imprime una tabla con ✔/✘ por caso.
- Sale con código 1 si algún caso falla.
- El informe Markdown lleva la fecha, la entidad, el gateway, el resultado global ("CONFORME" o "NO CONFORME") y el detalle por caso. Sirve como el "informe de conformidad" que pide el TDR.

## Página de prueba (`intercom-cert serve`, FastAPI)

- `GET /`: la página de prueba en español, hecha con **Vue 3** (el TDR pide un framework de frontend). FastAPI sirve el resultado compilado desde `intercom_cert/static/` con `StaticFiles(html=True)`. Tiene:
  - una explicación breve de la plataforma;
  - un selector de país destino (PE, CO, EC), con una nota de que EC pasa por el puente SOAP y CO falla a propósito la mitad de las veces;
  - el botón "Ejecutar certificación";
  - el resultado de cada caso, con la traza del documento (estado, actor, hora);
  - un enlace a Grafana (`GRAFANA_URL`) y al repositorio.
- Sección **"Qué demuestra"**, al inicio de la página y escrita para alguien no técnico:
  - una tabla "Función del puesto → dónde verlo", con enlaces a la parte de la página, a Grafana, a la carpeta del repo o al documento de `docs/` que lo muestra. Filas mínimas:
    - interoperabilidad entre entidades;
    - validación de esquemas JSON y XSD;
    - identidad y acceso (Keycloak);
    - mensajería con reintentos;
    - sistemas heredados (SOAP + SQL Server, .NET);
    - certificación de entidades nuevas;
    - firma digital XML;
    - monitoreo (Grafana);
    - CI/CD y DevSecOps;
    - GitOps (Argo CD/Helm);
    - respaldo y restauración;
    - supervisión de proveedores (`docs/supervision/`);
    - documentación y runbook.
  - El contenido de la tabla va en `web/public/evidence.json`, para editarlo sin tocar los componentes.
- La traza de cada documento se dibuja como **línea de tiempo** horizontal (RECEIVED → ROUTED → ACCEPTED/REJECTED/FAILED), con hora y actor en cada paso, como componente Vue y CSS propio (sin librerías de gráficos).
- `POST /api/runs {destination}`: corre los 5 casos con la entidad de demostración configurada en el servidor (`DEMO_CLIENT_ID` y `DEMO_CLIENT_SECRET`, que nunca se envían al navegador) y devuelve los resultados en JSON.
  - Límite: una corrida a la vez (`asyncio.Lock`) y una cada 30 s por IP. Usa el primer valor de `X-Forwarded-For` y, si no viene, `request.client.host`.
  - Si se pasa el límite, devuelve 429 con `Retry-After`.
- `GET /api/registrations`: proxy de solo lectura a `{CUSTOMS_URL}/registrations?limit=5`, para mostrar lo que guardó el sistema SOAP. Si `CUSTOMS_URL` no está definido, devuelve `[]`.
- `GET /health`.
- Variables: `GATEWAY_URL`, `DEMO_CLIENT_ID`, `DEMO_CLIENT_SECRET`, `CUSTOMS_URL`, `GRAFANA_URL`, `REPO_URL`.

## Frontend (`tools/certification-kit/web`, Vue 3 + Vite)

- Proyecto Vite con `vue`, `vite`, `@vitejs/plugin-vue` y, para pruebas, `vitest`, `@vue/test-utils` y `jsdom`. Fija versiones exactas (las estables actuales de Vue 3.5 y Vite) y anótalas en el resumen. JavaScript con `<script setup>`, sin TypeScript, sin router ni Pinia: es una sola página.
- `vite.config.js`: `build.outDir = '../intercom_cert/static'` y `emptyOutDir: true`; en desarrollo, `server.proxy` de `/api` a `http://localhost:8000`.
- Componentes en `web/src/components/`:
  - `EvidenceTable.vue`: carga `evidence.json` y muestra "Función del puesto → dónde verlo";
  - `RunPanel.vue`: selector de país, botón "Ejecutar certificación", estado de carga y mensaje claro si la API responde 429 (con los segundos de `Retry-After`);
  - `CaseResult.vue`: resultado de un caso (✔/✘ y detalle);
  - `TraceTimeline.vue`: la línea de tiempo de la traza;
  - `RegistrationsTable.vue`: lo que guardó el sistema SOAP (`GET /api/registrations`).
- `web/src/api.js`: las llamadas `fetch` a `/api/runs` y `/api/registrations`, en un solo lugar.
- Pruebas Vitest: `TraceTimeline` dibuja un paso por evento en orden y marca el estado final; `RunPanel` muestra el aviso cuando la API responde 429.
- `intercom_cert/static/` no se versiona (va en `.gitignore`); se genera con `npm run build`.

## Imagen y Compose

- `tools/certification-kit/Dockerfile`, multi-etapa: primero `node:22-alpine` con `npm ci && npm run build` en `web/`; después `python:3.12-slim`, copia `intercom_cert/static/` de la primera etapa, `pip install --no-cache-dir .`, usuario no root y `CMD ["intercom-cert", "serve", "--host", "0.0.0.0", "--port", "8000"]`.
- Servicio `certification-kit` en `compose.yaml`:
  - `GATEWAY_URL=http://apisix:9080`;
  - `DEMO_CLIENT_ID=entidad-bo`;
  - `DEMO_CLIENT_SECRET=dev-only-entidad-bo-secret`;
  - `CUSTOMS_URL=http://legacy-customs-ec:8080`;
  - `GRAFANA_URL=http://localhost:3001`;
  - puerto `8000:8000`.
- APISIX (`deploy/apisix/apisix.yaml`): no lo toques en esta tarea; la página se publica en la 05.

## CI

- Job `python`, "Test (certification-kit)":
  - `actions/setup-python@v6` con `3.12`;
  - `pip install -e "tools/certification-kit[dev]"`;
  - `ruff check tools/certification-kit`;
  - `pytest tools/certification-kit`.
- Job `web`, "Test (certification-kit web)": `actions/setup-node` con Node 22, y en `tools/certification-kit/web`: `npm ci`, `npm audit --audit-level=high`, `npm test` y `npm run build`. `images.needs` también incluye `web`.
- `images.needs` incluye `python`, y la matriz suma `{ name: certification-kit, context: tools/certification-kit, dockerfile: tools/certification-kit/Dockerfile }`. Si la muestra se copia desde `schemas/`, usa el contexto `.` y ajusta el Dockerfile.
- Dependabot: ecosistema `pip` en `/tools/certification-kit` y `npm` en `/tools/certification-kit/web`, con el mismo esquema.

## Pruebas (pytest + respx, sin red)

- Cada caso, con su respuesta buena y una mala.
- El CLI sale con 1 si falla un caso y genera el Markdown.
- `POST /api/runs` responde 429 en la segunda llamada inmediata desde la misma IP. Usa el `TestClient` de FastAPI y simula los casos.

## Verificación

```sh
(cd tools/certification-kit/web && npm ci && npm test && npm run build)
pip install -e "tools/certification-kit[dev]" && ruff check tools/certification-kit && pytest tools/certification-kit
docker compose up -d --build
intercom-cert run --gateway http://localhost:9080 --client-id entidad-bo --client-secret dev-only-entidad-bo-secret --destination PE --markdown /tmp/informe.md
# y abrir http://localhost:8000
```
