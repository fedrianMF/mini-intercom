#!/usr/bin/env bash
# Restores a backup made by backup.sh into a scratch database and checks it,
# so restores are rehearsed regularly without touching production data.
#   ./scripts/restore.sh backups/<stamp>            # verify into intercom_restore_check
#   TARGET_DB=intercom ./scripts/restore.sh <dir>   # real restore (stop the hub first)
set -euo pipefail

readonly COMPOSE="${COMPOSE:-docker compose}"
readonly TARGET_DB="${TARGET_DB:-intercom_restore_check}"

main() {
  local dir="${1:?usage: restore.sh <backup-dir>}"
  (cd "${dir}" && sha256sum --check --quiet SHA256SUMS)
  echo "-> checksums ok"

  ${COMPOSE} exec -T postgres psql -U intercom -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS ${TARGET_DB}" -c "CREATE DATABASE ${TARGET_DB}"
  ${COMPOSE} exec -T postgres pg_restore -U intercom -d "${TARGET_DB}" --no-owner --exit-on-error < "${dir}/intercom.dump"
  echo "-> database restored into ${TARGET_DB}"

  ${COMPOSE} exec -T postgres psql -U intercom -d "${TARGET_DB}" -At -c \
    "SELECT 'documents=' || count(*) FROM documents UNION ALL SELECT 'events=' || count(*) FROM document_events UNION ALL SELECT 'migrations=' || count(*) FROM schema_migrations"

  if [[ "${RESTORE_BROKER:-false}" == "true" ]]; then
    ${COMPOSE} exec -T rabbitmq rabbitmqctl import_definitions - < "${dir}/rabbitmq-definitions.json"
    echo "-> broker definitions imported"
  fi
}

main "$@"
