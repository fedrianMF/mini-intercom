#!/usr/bin/env bash
# End-to-end demo: Bolivia sends certificates of origin to Peru and Colombia
# through the gateway, then follows each document until it reaches a final state.
set -euo pipefail

readonly GATEWAY="${GATEWAY:-http://localhost:9080}"
readonly SAMPLES="$(cd "$(dirname "$0")/../schemas/samples" && pwd)"

get_token() {
  local client_id="$1"
  curl -fsS "${GATEWAY}/realms/intercom/protocol/openid-connect/token" \
    -d grant_type=client_credentials \
    -d "client_id=${client_id}" \
    -d "client_secret=dev-only-${client_id}-secret" | jq -r .access_token
}

send() {
  local token="$1" body="$2" key="$3"
  curl -sS "${GATEWAY}/v1/documents" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${key}" \
    -d "${body}"
}

wait_final() {
  local token="$1" id="$2" status=""
  for _ in $(seq 1 60); do
    status="$(curl -fsS "${GATEWAY}/v1/documents/${id}" -H "Authorization: Bearer ${token}" | jq -r .status)"
    case "${status}" in ACCEPTED|REJECTED|FAILED) break ;; esac
    sleep 1
  done
  curl -fsS "${GATEWAY}/v1/documents/${id}" -H "Authorization: Bearer ${token}" \
    | jq '{id, destinationCountry, status, events: [.events[] | {status, actor, detail}]}'
}

main() {
  local token run json_id xml_id xml_body bad_body
  token="$(get_token senavex-bo)"
  run="$(date +%s)"

  echo "== 1. Certificado en JSON, Bolivia -> Peru"
  json_id="$(send "${token}" "$(cat "${SAMPLES}/certificado-origen.json")" "demo-json-${run}" | jq -r .id)"
  wait_final "${token}" "${json_id}"

  echo "== 2. Certificado en XML (validado con XSD), Bolivia -> Colombia (adaptador inestable a proposito)"
  xml_body="$(jq -n --rawfile xml "${SAMPLES}/certificado-origen.xml" \
    '{documentType: "certificado-origen", schemaVersion: "1", destinationCountry: "CO", format: "xml", payloadXml: $xml}')"
  xml_id="$(send "${token}" "${xml_body}" "demo-xml-${run}" | jq -r .id)"
  wait_final "${token}" "${xml_id}"

  echo "== 3. Documento invalido: la subpartida NANDINA no tiene 8 digitos"
  bad_body="$(jq '.payload.mercancias[0].subpartidaNandina = "1008"' "${SAMPLES}/certificado-origen.json")"
  send "${token}" "${bad_body}" "demo-bad-${run}" | jq .

  echo "== 4. Mismo Idempotency-Key: devuelve el documento existente, no crea otro"
  send "${token}" "$(cat "${SAMPLES}/certificado-origen.json")" "demo-json-${run}" | jq '{id, status}'
}

main "$@"
