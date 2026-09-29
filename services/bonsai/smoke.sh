#!/bin/sh
set -eu

BASE_URL="${1:-http://127.0.0.1:${BONSAI_PORT:-8080}}"
MODEL_ALIAS="${BONSAI_MODEL_ALIAS:-inspector-bonsai-2-27b}"

curl --fail --silent --show-error "$BASE_URL/health" >/dev/null
response="$(curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data-binary "{\"model\":\"$MODEL_ALIAS\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with READY only.\"}],\"temperature\":0,\"max_tokens\":32,\"stream\":false}" \
  "$BASE_URL/v1/chat/completions")"

printf '%s' "$response" | grep -q '"choices"' || {
  printf '%s\n' 'Bonsai smoke failed: response has no choices' >&2
  exit 1
}
printf '%s\n' 'Bonsai health and text inference smoke passed.'
