#!/usr/bin/env bash
set -euo pipefail

PROFILE=${1:-}
if [[ "$PROFILE" != "laptop" && "$PROFILE" != "server" ]]; then
  echo "usage: $0 laptop|server" >&2
  exit 64
fi

fail() {
  echo "preflight failed: $*" >&2
  exit 1
}

[[ "$(uname -m)" == "x86_64" ]] || fail "$PROFILE profile requires Linux x86_64"
command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"
engine_version=$(docker version --format '{{.Server.Version}}' 2>/dev/null | sed 's/[^0-9.].*$//')
[[ -n "$engine_version" ]] || fail "cannot determine Docker Engine version"
[[ "$(printf '%s\n' "24.0.0" "$engine_version" | sort -V | head -n1)" == "24.0.0" ]] \
  || fail "Docker Engine 24+ is required; found $engine_version"
compose_version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
[[ -n "$compose_version" ]] || fail "Docker Compose v2 is unavailable"
[[ "$(printf '%s\n' "2.30.0" "$compose_version" | sort -V | head -n1)" == "2.30.0" ]] \
  || fail "Docker Compose 2.30+ is required; found $compose_version"
docker info --format '{{range $name, $_ := .Runtimes}}{{println $name}}{{end}}' \
  | grep -qx nvidia \
  || fail "NVIDIA Docker runtime is not configured; run nvidia-ctk runtime configure --runtime=docker on the host"
command -v nvidia-smi >/dev/null 2>&1 || fail "NVIDIA driver/nvidia-smi is unavailable"

if [[ "$PROFILE" == "laptop" ]]; then
  minimum_disk_mib=20480
  minimum_ram_mib=14336
  minimum_gpu_mib=7800
else
  minimum_disk_mib=153600
  minimum_ram_mib=245760
  minimum_gpu_mib=78000
fi

root=${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
free_disk_mib=$(df -Pk "$root" | awk 'NR==2 {print int($4/1024)}')
total_ram_mib=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
gpu_device=${INSPECTOR_PREFLIGHT_GPU_DEVICE:-0}
gpu_memory_mib=$(
  nvidia-smi --id="$gpu_device" --query-gpu=memory.total --format=csv,noheader,nounits \
    | head -n1 | tr -d ' '
)
[[ "$free_disk_mib" =~ ^[0-9]+$ ]] || fail "cannot determine free disk"
[[ "$total_ram_mib" =~ ^[0-9]+$ ]] || fail "cannot determine system RAM"
[[ "$gpu_memory_mib" =~ ^[0-9]+$ ]] || fail "cannot determine GPU memory for device $gpu_device"
((free_disk_mib >= minimum_disk_mib)) \
  || fail "need at least ${minimum_disk_mib} MiB free disk; found ${free_disk_mib} MiB"
((total_ram_mib >= minimum_ram_mib)) \
  || fail "need at least ${minimum_ram_mib} MiB RAM; found ${total_ram_mib} MiB"
((gpu_memory_mib >= minimum_gpu_mib)) \
  || fail "GPU $gpu_device needs at least ${minimum_gpu_mib} MiB; found ${gpu_memory_mib} MiB"

echo "Preflight passed for $PROFILE: disk=${free_disk_mib}MiB ram=${total_ram_mib}MiB gpu=${gpu_memory_mib}MiB."
