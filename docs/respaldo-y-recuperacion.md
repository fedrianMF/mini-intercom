# Respaldo y recuperación

## Qué se respalda

| Elemento | Cómo | Por qué |
|---|---|---|
| PostgreSQL completo | `pg_dump` en formato *custom* | Documentos, trazas, outbox y versión de esquema |
| Definiciones de RabbitMQ | `rabbitmqctl export_definitions` | Exchanges, colas, bindings, usuarios y políticas |
| Realm de Keycloak | Exportación del realm (o la base de Keycloak) | Clientes, mapeos y roles de cada entidad |
| Configuración y chart | El propio repositorio Git | Todo lo demás se reconstruye por GitOps |

Los mensajes en vuelo no se respaldan: si se pierde el broker, el outbox y los estados en PostgreSQL permiten saber qué documentos quedaron en `ROUTED` sin acuse y republicarlos.

## Uso

```sh
./scripts/backup.sh                                  # crea backups/<fecha>/ con SHA256SUMS
./scripts/restore.sh backups/<fecha>                 # restauración de prueba en una base aparte
TARGET_DB=intercom ./scripts/restore.sh backups/<fecha>   # restauración real, con el hub detenido
RESTORE_BROKER=true ./scripts/restore.sh backups/<fecha>  # también importa las definiciones del broker
```

La restauración de prueba verifica las sumas de control, restaura en `intercom_restore_check` y cuenta documentos, eventos y migraciones. Resultado de la última ejecución en este entorno:

```
-> checksums ok
-> database restored into intercom_restore_check
documents=3
events=9
migrations=1
```

## Política propuesta

- Respaldo diario completo y retención de 30 días, más uno mensual por un año.
- Copia fuera del servidor (almacenamiento de objetos o un segundo sitio).
- Restauración de prueba automática semanal; si falla, alerta.
- En producción, PostgreSQL con WAL continuo (por ejemplo CloudNativePG con Barman) para recuperar a un punto en el tiempo.

## Plan de recuperación

| Escenario | Objetivo | Pasos |
|---|---|---|
| Cae un nodo del hub | Sin corte | Kubernetes reprograma; PDB y dos réplicas mantienen el servicio |
| Cae RabbitMQ | Sin pérdida | El outbox retiene; al volver, el relay publica lo pendiente |
| Se corrompe la base | RPO 24 h (minutos con WAL) | Detener hub, restaurar, revisar documentos `ROUTED` sin acuse y republicar |
| Se pierde el clúster | RTO de horas | Nuevo clúster, Argo CD sincroniza desde Git, restaurar base, Keycloak y definiciones |
