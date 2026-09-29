FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50

# Dedicated review consumer. The regular rules worker remains unchanged.
RUN apk add --no-cache python3 py3-pip poppler-utils=25.12.0-r1 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0" \
    && test "$(pdfinfo -v 2>&1 | head -n 1)" = "pdfinfo version 25.12.0"

WORKDIR /worker
COPY services/worker/pyproject.toml ./
COPY services/worker/inspector_worker inspector_worker
COPY services/worker/rules rules
RUN python3 -m venv /opt/inspector-worker \
    && /opt/inspector-worker/bin/pip install --no-cache-dir .

ENV PATH=/opt/inspector-worker/bin:$PATH \
    INSPECTOR_RULES_DIR=/worker/rules
CMD ["python", "-m", "inspector_worker.zu127_generic_consumer_v3"]
