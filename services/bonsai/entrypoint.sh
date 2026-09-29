#!/bin/sh
set -eu

MODEL_DIR="${BONSAI_MODEL_DIR:-/models}"
MODEL_FILE="${BONSAI_MODEL_FILE:-Ternary-Bonsai-2-27B-PTQ1_0.gguf}"
MMPROJ_FILE="${BONSAI_MMPROJ_FILE:-Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
MMPROJ_PATH="$MODEL_DIR/$MMPROJ_FILE"

MODEL_SIZE=5946648928
MODEL_SHA256=53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3
MMPROJ_SIZE=629246976
MMPROJ_SHA256=6807ede61d570bb86ba34b756a0fa109edc33668604de867c6ea6d8f1d631903

fail() {
  printf 'bonsai runtime error: %s\n' "$*" >&2
  exit 1
}

require_uint() {
  name="$1"
  value="$2"
  case "$value" in
    ''|*[!0-9]*) fail "$name must be an unsigned integer" ;;
  esac
}

verify_size() {
  path="$1"
  expected="$2"
  [ -r "$path" ] || fail "required artifact is missing or unreadable: $path"
  actual="$(stat -c '%s' "$path")"
  [ "$actual" = "$expected" ] || fail "artifact size mismatch for $path: $actual != $expected"
}

verify_sha256() {
  path="$1"
  expected="$2"
  actual="$(sha256sum "$path" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail "artifact sha256 mismatch for $path"
}

PORT="${BONSAI_PORT:-8080}"
CTX="${BONSAI_CONTEXT_SIZE:-8192}"
NGL="${BONSAI_NGL:-99}"
PARALLEL="${BONSAI_PARALLEL:-1}"
MAX_OUTPUT="${BONSAI_MAX_OUTPUT_TOKENS:-2048}"
IMAGE_TOKENS="${BONSAI_IMAGE_MAX_TOKENS:-4096}"
BATCH="${BONSAI_BATCH_SIZE:-512}"
UBATCH="${BONSAI_UBATCH_SIZE:-128}"
THREADS="${BONSAI_THREADS:-8}"

for pair in \
  "BONSAI_PORT:$PORT" \
  "BONSAI_CONTEXT_SIZE:$CTX" \
  "BONSAI_NGL:$NGL" \
  "BONSAI_PARALLEL:$PARALLEL" \
  "BONSAI_MAX_OUTPUT_TOKENS:$MAX_OUTPUT" \
  "BONSAI_IMAGE_MAX_TOKENS:$IMAGE_TOKENS" \
  "BONSAI_BATCH_SIZE:$BATCH" \
  "BONSAI_UBATCH_SIZE:$UBATCH" \
  "BONSAI_THREADS:$THREADS"
do
  require_uint "${pair%%:*}" "${pair#*:}"
done

[ "$PORT" -gt 0 ] && [ "$PORT" -le 65535 ] || fail "BONSAI_PORT is out of range"
[ "$CTX" -ge 1024 ] && [ "$CTX" -le 262144 ] || fail "BONSAI_CONTEXT_SIZE is out of range"
[ "$PARALLEL" -eq 1 ] || fail "laptop profile requires BONSAI_PARALLEL=1"
[ "$MAX_OUTPUT" -gt 0 ] && [ "$MAX_OUTPUT" -le "$CTX" ] || fail "BONSAI_MAX_OUTPUT_TOKENS must be within context"
[ "$IMAGE_TOKENS" -gt 0 ] && [ "$IMAGE_TOKENS" -lt "$CTX" ] || fail "BONSAI_IMAGE_MAX_TOKENS must be smaller than context"
[ "$BATCH" -gt 0 ] || fail "BONSAI_BATCH_SIZE must be greater than zero"
[ "$UBATCH" -gt 0 ] || fail "BONSAI_UBATCH_SIZE must be greater than zero"
[ "$BATCH" -ge "$UBATCH" ] || fail "BONSAI_BATCH_SIZE must be >= BONSAI_UBATCH_SIZE"
[ "$THREADS" -gt 0 ] || fail "BONSAI_THREADS must be greater than zero"
case "${BONSAI_VERIFY_SHA256_ON_START:-1}" in
  0|1) ;;
  *) fail "BONSAI_VERIFY_SHA256_ON_START must be 0 or 1" ;;
esac
case "${BONSAI_MMPROJ_CPU:-1}" in
  0|1) ;;
  *) fail "BONSAI_MMPROJ_CPU must be 0 or 1" ;;
esac

verify_size "$MODEL_PATH" "$MODEL_SIZE"
verify_size "$MMPROJ_PATH" "$MMPROJ_SIZE"
if [ "${BONSAI_VERIFY_SHA256_ON_START:-1}" = "1" ]; then
  printf '%s\n' 'Verifying Bonsai artifact SHA-256 values...'
  verify_sha256 "$MODEL_PATH" "$MODEL_SHA256"
  verify_sha256 "$MMPROJ_PATH" "$MMPROJ_SHA256"
fi

export LD_LIBRARY_PATH="/opt/llama${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

set -- /opt/llama/llama-server \
  -m "$MODEL_PATH" \
  --mmproj "$MMPROJ_PATH" \
  --alias "${BONSAI_MODEL_ALIAS:-inspector-bonsai-2-27b}" \
  --host 0.0.0.0 \
  --port "$PORT" \
  -ngl "$NGL" \
  -c "$CTX" \
  -np "$PARALLEL" \
  -n "$MAX_OUTPUT" \
  -b "$BATCH" \
  -ub "$UBATCH" \
  -t "$THREADS" \
  -fa on \
  --temp 0.0 \
  --top-p 1.0 \
  --top-k 20 \
  --seed 20260918 \
  --image-max-tokens "$IMAGE_TOKENS" \
  --jinja \
  --metrics \
  --no-webui

if [ "${BONSAI_MMPROJ_CPU:-1}" = "1" ]; then
  set -- "$@" --no-mmproj-offload
fi

printf 'Starting Bonsai 2 27B: context=%s parallel=%s ngl=%s mmproj_cpu=%s\n' \
  "$CTX" "$PARALLEL" "$NGL" "${BONSAI_MMPROJ_CPU:-1}"
exec "$@"
