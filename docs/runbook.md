# Runbook de operación

Procedimientos para operar la plataforma día a día y atender incidencias. Cada alerta de [alerts.yml](../deploy/observability/alerts.yml) apunta a una sección de este documento.

## Revisión diaria

1. Tablero **INTERCOM · Intercambio de documentos** en Grafana: volumen por ruta, aceptados, rechazados y fallidos de las últimas 24 horas.
2. Colas `entity.*.inbox` cerca de cero y `intercom.dead-letters` vacía.
3. `intercom_outbox_pending` en cero o bajando.
4. Revisar los rechazos por país: un aumento suele indicar un cambio en un sistema nacional o en una versión de esquema.

## Diagnóstico por trazabilidad: "mi documento no llegó"

La entidad reporta un número de certificado, un `id` de documento o un `X-Correlation-Id`.

```sh
# 1. Estado y traza completa (como la entidad emisora)
curl -s "$GATEWAY/v1/documents/$ID" -H "Authorization: Bearer $TOKEN" | jq '{status, events}'

# 2. Por número de certificado, directo en la base
docker compose exec postgres psql -U intercom -d intercom -c \
  "SELECT id, status, destination_country, created_at FROM documents WHERE payload->>'numero' = 'BO-2026-000123'"

# 3. Todo lo que pasó con un ID de correlación, en los logs de todos los servicios
docker compose logs --no-log-prefix hub adapter-pe | grep "$CORRELATION_ID"
```

| Último estado | Qué significa | Qué hacer |
|---|---|---|
| Sin documento | Nunca entró: token inválido, sobre o esquema con errores | Pedir la respuesta `4xx` que recibió; trae la lista de errores |
| `RECEIVED` | Guardado, aún no publicado | Ver [El outbox crece](#el-outbox-crece) |
| `ROUTED` | En la cola del país destino o en reintento | Ver [Una cola de país no baja](#una-cola-de-país-no-baja) |
| `REJECTED` | El destino lo rechazó | El motivo está en `events[].detail.reason`; se comunica al emisor |
| `FAILED` | Se agotaron los reintentos | Ver [Documentos en FAILED](#documentos-en-failed) |

Respuesta al usuario: estado, hora de cada paso y siguiente acción, en el plazo acordado para el canal de atención. Si el caso es nuevo, se agrega a la base de conocimiento.

## El outbox crece

Alerta `OutboxBacklog`. Los documentos se reciben pero no salen hacia el broker.

1. `GET /health/ready` del hub: `checks.broker` en `down` confirma el problema.
2. Estado de RabbitMQ: `docker compose exec rabbitmq rabbitmq-diagnostics status` y alarmas de memoria o disco (`rabbitmq-diagnostics alarms`).
3. Último error registrado: `SELECT id, attempts, last_error FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 10;`
4. Al recuperarse el broker, el relay reanuda solo. La espera entre intentos crece hasta 5 minutos; para acelerar: `UPDATE outbox SET available_at = now() WHERE published_at IS NULL;`

No se pierde nada mientras dure: los documentos siguen en PostgreSQL.

## Una cola de país no baja

Alerta `InboxNotDraining`.

1. ¿El adaptador está vivo? `docker compose ps adapter-pe` y sus logs.
2. ¿Consume? En la consola de RabbitMQ, la cola debe tener al menos un consumidor.
3. ¿Falla al entregar? Los logs muestran `delivery failed, retry scheduled` con el motivo. Si es el sistema nacional, se coordina con la entidad y los mensajes esperan en la cola.
4. ¿Falla el acuse al hub? Un `401` repetido suele ser un secreto rotado y no actualizado en el adaptador.

## Documentos en FAILED

Alerta `DocumentsFailing`.

1. Motivo: `events[-1].detail.reason` del documento.
2. Corregida la causa, se reenvía: el emisor hace un nuevo `POST` con otra `Idempotency-Key`, o el operador republica el mensaje desde `intercom.dead-letters` con la consola de RabbitMQ (*Move messages* hacia `intercom.documents`).
3. Se registra el incidente con causa, impacto y documentos afectados:

```sql
SELECT d.id, d.payload->>'numero' AS numero, e.detail->>'reason' AS motivo, e.created_at
FROM documents d JOIN document_events e ON e.document_id = d.id AND e.status = 'FAILED'
WHERE e.created_at > now() - interval '1 day';
```

## Alta de una entidad nueva

1. Cliente confidencial en Keycloak con *service account*, mapeos `country`, `entity` y audiencia `intercom-hub`, y los roles que correspondan.
2. Secreto en la bóveda, en la ruta de adaptadores; External Secrets lo sincroniza.
3. Pruebas de certificación en staging: un documento válido, uno inválido por esquema, uno con idempotencia repetida y un rechazo con motivo. La entidad pasa a producción cuando las cuatro dan el resultado esperado.
4. Entregar a la entidad: URL del gateway, `client_id`, el secreto por un canal seguro, los esquemas vigentes y este procedimiento de soporte.

## Rotación de secretos

1. En Keycloak, regenerar el secreto del cliente (la entidad deja de poder pedir tokens nuevos; los vigentes duran hasta 5 minutos).
2. Guardar el nuevo valor en la bóveda. External Secrets actualiza el Secret en menos de una hora, o de inmediato forzando la sincronización.
3. Reiniciar el adaptador para que tome el valor: `kubectl rollout restart deploy/<release>-adapter-<país>`.
4. Anotar la fecha en el calendario de vencimientos.

## Desplegar en k3s local

```sh
# Imágenes construidas en local e importadas al clúster
docker build -t ghcr.io/fedrianmf/mini-intercom-hub:0.1.0 -f services/hub/Dockerfile .
docker build -t ghcr.io/fedrianmf/mini-intercom-entity-adapter:0.1.0 services/entity-adapter
docker save ghcr.io/fedrianmf/mini-intercom-hub:0.1.0 ghcr.io/fedrianmf/mini-intercom-entity-adapter:0.1.0 | sudo k3s ctr images import -

kubectl create namespace intercom
kubectl -n intercom create configmap keycloak-realm --from-file=deploy/keycloak/realm-intercom.json
kubectl -n intercom apply -f deploy/k8s-dev/infra.yaml
helm upgrade --install intercom deploy/helm/mini-intercom -n intercom -f deploy/k8s-dev/values-dev.yaml
kubectl -n intercom get pods -w
```

## Revertir un despliegue

- Con Argo CD: cambiar `targetRevision` de producción a la etiqueta anterior y sincronizar.
- Sin Argo CD: `helm rollback intercom <revisión> -n intercom`.
- Las migraciones solo agregan columnas o tablas, así que la versión anterior del código sigue funcionando con el esquema nuevo. Una migración que borra algo se publica en una versión posterior, cuando ya ningún despliegue la necesita.
