# syntax=docker/dockerfile:1.7
FROM python:3.12.11-alpine3.22@sha256:5e511b0e940def74dd23389510300c76017ca9bbc92484c40cff0951adf32245

LABEL org.opencontainers.image.title="Inspector AI model artifact provisioner" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN addgroup -g 10001 modelstore \
    && adduser -D -H -u 10001 -G modelstore modelstore

WORKDIR /opt/model-store
COPY provision_models.py ./
COPY locks ./locks

ENV MODEL_STORE_ROOT=/models \
    MODEL_STORE_SAFETY_BYTES=1073741824

USER 10001:10001
ENTRYPOINT ["python", "/opt/model-store/provision_models.py"]
