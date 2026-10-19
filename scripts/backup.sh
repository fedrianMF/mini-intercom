#!/usr/bin/env bash
# Full backup of the platform state: PostgreSQL (custom format) and the
# RabbitMQ definitions (exchanges, queues, bindings, users), with checksums.
set -euo pipefail

readonly BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
readonly COMPOSE="${COMPOSE:-docker compose}"

main() {
  local stamp dir
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="${BACKUP_ROOT}/${stamp}"
  mkdir -p "${dir}"

  echo "-> PostgreSQL"
  ${COMPOSE} exec -T postgres pg_dump -U intercom -d intercom --format=custom --no-owner > "${dir}/intercom.dump"

  echo "-> RabbitMQ definitions"
  ${COMPOSE} exec -T rabbitmq rabbitmqctl export_definitions - --silent > "${dir}/rabbitmq-definitions.json"

  (cd "${dir}" && sha256sum intercom.dump rabbitmq-definitions.json > SHA256SUMS)
  echo "Backup written to ${dir}"
}

main "$@"
