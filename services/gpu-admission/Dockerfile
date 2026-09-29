# syntax=docker/dockerfile:1.7
FROM python:3.12.11-slim-bookworm@sha256:c00fc7b44d844b6da22861ec24af43968a5200eac4ec607b4725d585165d6b49

LABEL org.opencontainers.image.title="Inspector AI GPU admission gate" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN groupadd --gid 10001 inspector \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin inspector

WORKDIR /opt/gpu-admission
COPY check.py ./

ENV GPU_DEVICE=0 \
    GPU_ADMISSION_FRACTION=0.85 \
    GPU_MIN_TOTAL_MIB=78000 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER 10001:10001
ENTRYPOINT ["python", "/opt/gpu-admission/check.py"]
