# 05 · Despliegue en Dokploy

Demo pública en el VPS de Felix, que ya corre Dokploy v0.30 (Docker Swarm y Traefik 3 en los puertos 80 y 443).

Dominios:
- `intercom.fedrian.dev`: gateway APISIX, con la página de prueba y la API.
- `grafana.intercom.fedrian.dev`: tableros de solo lectura.

No se instala k3s en ese servidor, para no tocar la red de los servicios que ya están en producción. El chart de Helm se valida en CI.

## Archivos (`deploy/dokploy/`)

### `compose.yaml`

Distinto del `compose.yaml` local:
- Usa las imágenes de GHCR `ghcr.io/fedrianmf/mini-intercom-<servicio>:latest` en vez de `build:`. Las de terceros van con las mismas versiones que el compose local.
- Ningún `ports:`: solo Traefik expone. `apisix` y `grafana` se unen a la red externa `dokploy-network`; todo lo demás va solo en la red interna `intercom`.
- Secretos por variable de entorno con `${VAR:?}`, nunca escritos en el archivo:
  - `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `MSSQL_SA_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`;
  - `SENAVEX_BO_SECRET`, `VUCE_PE_SECRET`, `VUCE_CO_SECRET`, `ECUAPASS_EC_SECRET`.
- Keycloak en modo producción:
  - `start --import-realm` y base PostgreSQL propia (base `keycloak`, creada con un script en `deploy/dokploy/postgres-init/`);
  - `KC_HOSTNAME: https://intercom.fedrian.dev`, `KC_PROXY_HEADERS: xforwarded`, `KC_HTTP_ENABLED: "true"`, `KC_HEALTH_ENABLED: "true"`.
- `deploy/dokploy/realm-intercom.json`: copia del realm local en la que cada `secret` es un placeholder de variable de entorno (`${SENAVEX_BO_SECRET}`, etc.). Keycloak los reemplaza al importar; verifica que la versión 26.3 lo haga, y si no, usa un entrypoint que haga `envsubst`.
- El hub con `OIDC_ISSUER: https://intercom.fedrian.dev/realms/intercom` y JWKS por la red interna.
- Grafana con `GF_SERVER_ROOT_URL: https://grafana.intercom.fedrian.dev`, `GF_AUTH_ANONYMOUS_ENABLED: "true"` y `GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer`.
- `certification-kit` con `DEMO_CLIENT_ID: senavex-bo`, su secreto desde la variable, `GRAFANA_URL` público y `REPO_URL: https://github.com/fedrianMF/mini-intercom`.
- Límites de memoria (`deploy.resources.limits.memory`) en cada servicio. En total, menos de 5 GB:
  - sqlserver 1,5 GB, keycloak 768 MB;
  - rabbitmq, postgres, grafana y prometheus 256 a 512 MB;
  - servicios propios 256 MB.
- `restart: unless-stopped` en todo.

### `apisix.yaml` y `config.yaml`

Rutas públicas, y nada más:

| Ruta | Upstream | Notas |
|---|---|---|
| `/v1/*` | `hub:3000` | `limit-req` 5 r/s, ráfaga 10, por `http_x_forwarded_for` |
| `/realms/intercom/protocol/openid-connect/token` y `/certs` | `keycloak:8080` | solo POST en token y GET en certs |
| `/api/*`, `/health` y `/` | `certification-kit:8000` | |

La consola de administración de Keycloak, RabbitMQ y Prometheus no tiene ruta.

### `.env.example`

Todas las variables, con valores vacíos y una línea que dice cómo generarlas: `openssl rand -hex 24`.

## Pasos para Felix (ponlos al final de este archivo como checklist)

1. Crear en el DNS los registros A `intercom` y `grafana.intercom`, apuntando a la IP del VPS.
2. En GitHub, marcar como públicos los paquetes `mini-intercom-*` de GHCR (Package settings → Change visibility).
3. En Dokploy: Create Service → Compose → proveedor GitHub, repo `mini-intercom`, rama `main`, Compose Path `./deploy/dokploy/compose.yaml`.
4. En la pestaña Environment, pegar las variables generadas.
5. En Domains, crear `intercom.fedrian.dev` → servicio `apisix`, puerto 9080, HTTPS con Let's Encrypt, y `grafana.intercom.fedrian.dev` → servicio `grafana`, puerto 3000.
6. Deploy. Verificar:
   - `curl -fsS https://intercom.fedrian.dev/health`;
   - abrir la página y ejecutar la certificación hacia PE y EC;
   - `intercom-cert run --gateway https://intercom.fedrian.dev ...` desde tu equipo.
7. Respaldo diario de PostgreSQL con `scripts/backup.sh` en cron del VPS.

## Verificación en CI

Agrega al job `helm` (o a uno nuevo, "Dokploy compose") este paso:

```sh
docker compose -f deploy/dokploy/compose.yaml --env-file deploy/dokploy/.env.example config -q
```

Para que pase con valores vacíos, el `.env.example` del CI puede usar valores `ci-placeholder`.
