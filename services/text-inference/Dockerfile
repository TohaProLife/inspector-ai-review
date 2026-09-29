# syntax=docker/dockerfile:1.7
FROM python:3.12.11-slim-bookworm@sha256:c00fc7b44d844b6da22861ec24af43968a5200eac4ec607b4725d585165d6b49 AS cpu

RUN python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.8.0" \
    && python -m pip install --no-cache-dir \
      "sentence-transformers==6.1.0" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
    && groupadd --gid 10001 inspector \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin inspector

WORKDIR /opt/text-inference
COPY app.py ./
ENV TEXT_RUNTIME_DEVICE=cpu HOME=/tmp HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20m --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"
CMD ["python", "/opt/text-inference/app.py"]

FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime@sha256:417bd75df6365104c283ea4c1651fb3530d9eb5a4c2fafa51943cff2a94e6385 AS gpu

RUN python -m pip install --no-cache-dir \
      "sentence-transformers==6.1.0" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
    && groupadd --gid 10001 inspector \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin inspector

WORKDIR /opt/text-inference
COPY app.py ./
ENV TEXT_RUNTIME_DEVICE=cuda HOME=/tmp HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20m --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"
CMD ["python", "/opt/text-inference/app.py"]
