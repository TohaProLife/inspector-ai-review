# syntax=docker/dockerfile:1.7
ARG DOCUMENT_AI_BASE_IMAGE=paddlepaddle/paddle:3.2.1@sha256:8254635f7ce817f2b4c31405a107e617a45f2038023dd2bd23201385080cf081
FROM ${DOCUMENT_AI_BASE_IMAGE}

ARG PADDLEOCR_VERSION=3.7.0
ARG PYPDFIUM2_VERSION=5.12.1

LABEL org.opencontainers.image.title="Inspector AI document renderer and OCR service" \
      org.opencontainers.image.licenses="Apache-2.0 AND BSD-3-Clause"

RUN python -m pip install --no-cache-dir \
      "paddlex[genai-client,ocr]==3.7.0" \
      "paddleocr[doc-parser]==${PADDLEOCR_VERSION}" \
      "pypdfium2==${PYPDFIUM2_VERSION}" \
      "fastapi==0.116.1" \
      "uvicorn==0.35.0" \
      "python-multipart==0.0.20" \
    && groupadd --gid 10001 inspector \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin inspector

WORKDIR /opt/document-ai
COPY app.py document_limits.py document_profile.py provision.py ./
COPY profiles ./profiles

ENV DOCUMENT_AI_PROFILE=/opt/document-ai/profiles/laptop.json \
    DOCUMENT_AI_HOST=0.0.0.0 \
    DOCUMENT_AI_PORT=8080 \
    DOCUMENT_AI_PRELOAD=1 \
    DOCUMENT_AI_MAX_UPLOAD_BYTES=67108864 \
    PADDLE_PDX_CACHE_HOME=/models/paddlex \
    FLAGS_allocator_strategy=auto_growth \
    HOME=/tmp

USER 10001:10001
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=20s --timeout=5s --start-period=30m --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["python", "/opt/document-ai/app.py"]
