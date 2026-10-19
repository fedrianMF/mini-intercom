# 06 · Reportes de estado para entidades (Node)

Cubre la función del TDR de "generar consultas de estado y reportes" para las entidades y la Secretaría.

## Base de datos (`services/hub/src/db/migrations/002_status_reports.sql`)

- Vista `document_status_daily`: `day` (fecha UTC de `created_at`), `origin_country`, `destination_country`, `document_type`, `status` y `total`.
- Índice si hace falta, sin tocar las tablas existentes. Las migraciones solo agregan, como dice el runbook.

## API (`services/hub/src/routes/reports.ts`)

`GET /v1/reports/status?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv`

- Requiere token. Una entidad ve solo las filas donde su país es origen o destino. El rol `reports:all` (agrégalo al realm local para un cliente nuevo, `sgcan-monitor`) ve todo.
- `from` y `to` son obligatorios y el rango es de 92 días como máximo. Si no se cumple, 422 problem+json, como los demás errores del hub.
- `format=csv`: `text/csv; charset=utf-8`, con `Content-Disposition: attachment; filename="estado-<from>-<to>.csv"`, encabezado en español (`dia,pais_origen,pais_destino,tipo_documento,estado,total`) y escapando comillas y comas.
- `format=json` (por defecto): `{from, to, rows: [...]}`.
- Lógica en `repository.ts`, con una consulta parametrizada.

## Grafana

- Datasource PostgreSQL de solo lectura en `deploy/observability/grafana/provisioning/datasources/`. Usa el usuario `grafana_reader` con `SELECT` solo sobre la vista; créalo en la migración con contraseña de desarrollo `dev-only-grafana-reader`, y en Dokploy desde una variable.
- Panel nuevo en el tablero existente: tabla "Documentos por país y estado (últimos 7 días)" y barras apiladas por estado y día.

## Pruebas (vitest)

- La consulta filtra por país del token. El rol `reports:all` ve todo.
- 422 por rango inválido.
- El CSV tiene el encabezado y el escapado correctos.
- Usa el repositorio en memoria de `test/helpers.ts`, extendido con el método nuevo.

## Kit de certificación

Caso nuevo `status-report`: después de la corrida, el reporte del día incluye los documentos enviados.

## Verificación

```sh
cd services/hub && npm run typecheck && npm test
docker compose up -d --build && ./scripts/demo.sh
curl -s "localhost:9080/v1/reports/status?from=$(date -u +%F)&to=$(date -u +%F)&format=csv" -H "Authorization: Bearer $TOKEN"
```
