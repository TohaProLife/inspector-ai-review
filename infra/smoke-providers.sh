#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROFILE=${1:-}
if [[ "$PROFILE" != "laptop" && "$PROFILE" != "server" ]]; then
  echo "usage: $0 laptop|server" >&2
  exit 64
fi

"$ROOT/infra/stack.sh" "$PROFILE" init >/dev/null
ENV_FILE=${INSPECTOR_ENV_FILE:-$ROOT/infra/.env.$PROFILE}
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DOCUMENT_AI_PORT=${DOCUMENT_AI_PORT:-8090}
API_PORT=${API_PORT:-4100}
WEB_PORT=${WEB_PORT:-8080}
SMOKE_TIMEOUT=${SMOKE_INFERENCE_TIMEOUT_SECONDS:-900}
if [[ "$PROFILE" == "laptop" ]]; then
  VLM_PORT=${VLM_PORT:-8081}
  EMBEDDING_PORT=${EMBEDDING_PORT:-8091}
  EXPECTED_EMBEDDING_MODEL=inspector-qwen3-embedding-0.6b
  EXPECTED_VLM_MODEL=inspector-bonsai-2-27b
  PROVIDER_SERVICES=(document-ai-laptop embedding-laptop bonsai-vlm-cuda)
else
  VLM_PORT=${VLM_PORT:-8101}
  EMBEDDING_PORT=${EMBEDDING_PORT:-8102}
  EXPECTED_EMBEDDING_MODEL=inspector-qwen3-embedding-0.6b
  EXPECTED_VLM_MODEL=inspector-qwen3-vl-8b-fp8
  PROVIDER_SERVICES=(document-ai-server embedding-server qwen-vlm-server)
fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT

python3 - "$temporary/smoke.pdf" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
stream = b"BT /F1 18 Tf 24 45 Td (SMOKE 123) Tj ET\n"
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
]
payload = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(payload))
    payload.extend(f"{index} 0 obj\n".encode())
    payload.extend(obj)
    payload.extend(b"\nendobj\n")
xref = len(payload)
payload.extend(f"xref\n0 {len(objects) + 1}\n".encode())
payload.extend(b"0000000000 65535 f \n")
for offset in offsets[1:]:
    payload.extend(f"{offset:010d} 00000 n \n".encode())
payload.extend(
    f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
)
target.write_bytes(payload)
PY

curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/api/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${DOCUMENT_AI_PORT}/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${VLM_PORT}/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${EMBEDDING_PORT}/health" >/dev/null

curl --fail --silent --show-error --max-time "$SMOKE_TIMEOUT" \
  --form "file=@$temporary/smoke.pdf;type=application/pdf" \
  --form page=1 --form dpi=150 \
  "http://127.0.0.1:${DOCUMENT_AI_PORT}/v1/render" \
  --output "$temporary/smoke.png"
python3 - "$temporary/smoke.png" <<'PY'
from pathlib import Path
import sys

payload = Path(sys.argv[1]).read_bytes()
assert payload.startswith(b"\x89PNG\r\n\x1a\n") and len(payload) > 100
PY

for script in eslav latin; do
  curl --fail --silent --show-error --max-time "$SMOKE_TIMEOUT" \
    --form "file=@$temporary/smoke.png;type=image/png" \
    --form "script=$script" \
    "http://127.0.0.1:${DOCUMENT_AI_PORT}/v1/ocr" \
    --output "$temporary/ocr-$script.json"
  python3 - "$temporary/ocr-$script.json" "$script" <<'PY'
import json
from pathlib import Path
import sys

data = json.loads(Path(sys.argv[1]).read_text())
assert data["schemaVersion"] == "document-ai-ocr-response-v1"
assert data["script"] == sys.argv[2]
assert isinstance(data["results"], list)
PY
done

python3 - "$temporary/smoke.png" "$temporary/vlm-request.json" "$EXPECTED_VLM_MODEL" <<'PY'
import base64
import json
from pathlib import Path
import sys

image = base64.b64encode(Path(sys.argv[1]).read_bytes()).decode()
request = {
    "model": sys.argv[3],
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Read the short text in this image. Reply briefly."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
        ],
    }],
    "temperature": 0,
    "max_tokens": 32,
}
Path(sys.argv[2]).write_text(json.dumps(request))
PY
curl --fail --silent --show-error --max-time "$SMOKE_TIMEOUT" \
  --header 'Content-Type: application/json' \
  --data-binary "@$temporary/vlm-request.json" \
  "http://127.0.0.1:${VLM_PORT}/v1/chat/completions" \
  --output "$temporary/vlm-response.json"
python3 - "$temporary/vlm-response.json" <<'PY'
import json
from pathlib import Path
import sys

data = json.loads(Path(sys.argv[1]).read_text())
assert data.get("choices") and data["choices"][0].get("message", {}).get("content")
PY

embedding_response=$(curl --fail --silent --show-error --max-time "$SMOKE_TIMEOUT" \
  --header 'Content-Type: application/json' \
  --data-binary "{\"model\":\"${EXPECTED_EMBEDDING_MODEL}\",\"input\":\"health probe\",\"dimensions\":1024}" \
  "http://127.0.0.1:${EMBEDDING_PORT}/v1/embeddings")
python3 -c 'import json,sys; data=json.load(sys.stdin); assert len(data["data"][0]["embedding"]) == 1024' <<<"$embedding_response"

vector_version=$(
  "$ROOT/infra/stack.sh" "$PROFILE" exec -T postgres \
    psql -U "${POSTGRES_USER:-inspector}" -d "${POSTGRES_DB:-inspector}" -Atc \
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
)
[[ "$vector_version" == "0.8.6" ]]

for service in "${PROVIDER_SERVICES[@]}"; do
  container_id=$("$ROOT/infra/stack.sh" "$PROFILE" ps -q "$service")
  [[ -n "$container_id" ]]
  mapfile -t networks < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$container_id")
  [[ "${#networks[@]}" -eq 1 ]]
  [[ "$(docker network inspect --format '{{.Internal}}' "${networks[0]}")" == "true" ]]
done

if [[ "$PROFILE" == "server" ]]; then
  for service in document-ai-server qwen-vlm-server; do
    container_id=$("$ROOT/infra/stack.sh" "$PROFILE" ps -q "$service")
    [[ "$(docker inspect --format '{{.HostConfig.Runtime}}' "$container_id")" == "nvidia" ]]
    selected_devices=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
      | sed -n 's/^NVIDIA_VISIBLE_DEVICES=//p')
    [[ "$selected_devices" == "${SERVER_GPU_DEVICE:-0}" ]]
    visible_gpus=$("$ROOT/infra/stack.sh" "$PROFILE" exec -T "$service" \
      nvidia-smi --query-gpu=uuid --format=csv,noheader)
    [[ "$(printf '%s\n' "$visible_gpus" | sed '/^$/d' | wc -l)" -eq 1 ]]
  done
  container_id=$("$ROOT/infra/stack.sh" "$PROFILE" ps -q embedding-server)
  selected_devices=$(docker inspect --format '{{range .HostConfig.DeviceRequests}}{{range .DeviceIDs}}{{.}}{{end}}{{end}}' "$container_id")
  [[ -z "$selected_devices" ]]
else
  container_id=$("$ROOT/infra/stack.sh" "$PROFILE" ps -q bonsai-vlm-cuda)
  [[ "$(docker inspect --format '{{.HostConfig.Runtime}}' "$container_id")" == "nvidia" ]]
  selected_devices=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
    | sed -n 's/^NVIDIA_VISIBLE_DEVICES=//p')
  [[ "$selected_devices" == "${LAPTOP_GPU_DEVICE:-0}" ]]
  visible_gpus=$("$ROOT/infra/stack.sh" "$PROFILE" exec -T bonsai-vlm-cuda \
    nvidia-smi --query-gpu=uuid --format=csv,noheader)
  [[ "$(printf '%s\n' "$visible_gpus" | sed '/^$/d' | wc -l)" -eq 1 ]]
fi

for service in "${PROVIDER_SERVICES[@]}"; do
  if [[ "$service" == "bonsai-vlm-cuda" ]]; then
    "$ROOT/infra/stack.sh" "$PROFILE" exec -T "$service" sh -ec \
      'if curl --silent --max-time 3 https://example.com >/dev/null 2>&1; then exit 1; fi'
  else
    "$ROOT/infra/stack.sh" "$PROFILE" exec -T "$service" python -c \
      'import socket; s=socket.socket(); s.settimeout(3); rc=s.connect_ex(("1.1.1.1",443)); s.close(); raise SystemExit(1 if rc == 0 else 0)'
  fi
done

echo "Full provider smoke passed for ${PROFILE}; inference works and runtime egress is blocked."
