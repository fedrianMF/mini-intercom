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

- `GET /`: una sola página HTML estática (en `intercom_cert/static/index.html`, sin frameworks ni CDN) en español. Tiene:
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
  - El contenido de la tabla va en `intercom_cert/static/evidence.json`, para editarlo sin tocar el HTML.
- La traza de cada documento se dibuja como **línea de tiempo** horizontal (RECEIVED → ROUTED → ACCEPTED/REJECTED/FAILED), con hora y actor en cada paso, solo con HTML y CSS.
- `POST /api/runs {destination}`: corre los 5 casos con la entidad de demostración configurada en el servidor (`DEMO_CLIENT_ID` y `DEMO_CLIENT_SECRET`, que nunca se envían al navegador) y devuelve los resultados en JSON.
  - Límite: una corrida a la vez (`asyncio.Lock`) y una cada 30 s por IP. Usa el primer valor de `X-Forwarded-For` y, si no viene, `request.client.host`.
  - Si se pasa el límite, devuelve 429 con `Retry-After`.
- `GET /api/registrations`: proxy de solo lectura a `{CUSTOMS_URL}/registrations?limit=5`, para mostrar lo que guardó el sistema SOAP. Si `CUSTOMS_URL` no está definido, devuelve `[]`.
- `GET /health`.
- Variables: `GATEWAY_URL`, `DEMO_CLIENT_ID`, `DEMO_CLIENT_SECRET`, `CUSTOMS_URL`, `GRAFANA_URL`, `REPO_URL`.

## Imagen y Compose

- `tools/certification-kit/Dockerfile`: `python:3.12-slim`, `pip install --no-cache-dir .`, usuario no root y `CMD ["intercom-cert", "serve", "--host", "0.0.0.0", "--port", "8000"]`.
- Servicio `certification-kit` en `compose.yaml`:
  - `GATEWAY_URL=http://apisix:9080`;
  - `DEMO_CLIENT_ID=senavex-bo`;
  - `DEMO_CLIENT_SECRET=dev-only-senavex-bo-secret`;
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
- `images.needs` incluye `python`, y la matriz suma `{ name: certification-kit, context: tools/certification-kit, dockerfile: tools/certification-kit/Dockerfile }`. Si la muestra se copia desde `schemas/`, usa el contexto `.` y ajusta el Dockerfile.
- Dependabot: ecosistema `pip` en `/tools/certification-kit`, con el mismo esquema.

## Pruebas (pytest + respx, sin red)

- Cada caso, con su respuesta buena y una mala.
- El CLI sale con 1 si falla un caso y genera el Markdown.
- `POST /api/runs` responde 429 en la segunda llamada inmediata desde la misma IP. Usa el `TestClient` de FastAPI y simula los casos.

## Verificación

```sh
pip install -e "tools/certification-kit[dev]" && ruff check tools/certification-kit && pytest tools/certification-kit
docker compose up -d --build
intercom-cert run --gateway http://localhost:9080 --client-id senavex-bo --client-secret dev-only-senavex-bo-secret --destination PE --markdown /tmp/informe.md
# y abrir http://localhost:8000
```
