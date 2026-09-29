FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50

# Fixture-only image: hardcoded public F0152 object and source identity.
# Matches isolated F0152 proof runtime. APK repository is not snapshotted;
# any releasable build still needs package manifest and image digest attestation.
RUN apk add --no-cache python3 poppler-utils=25.12.0-r1 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0" \
    && test "$(pdfinfo -v 2>&1 | head -n 1)" = "pdfinfo version 25.12.0"

WORKDIR /worker
COPY infra/zu127-review/worker_init.py inspector_worker/__init__.py
COPY services/worker/inspector_worker/text_layer.py inspector_worker/text_layer.py
COPY services/worker/inspector_worker/zu127_window_table_poppler_v2.py inspector_worker/zu127_window_table_poppler_v2.py
COPY services/worker/inspector_worker/zu127_window_table_run_review.py inspector_worker/zu127_window_table_run_review.py
COPY services/worker/inspector_worker/zu127_specialist_consumer.py inspector_worker/zu127_specialist_consumer.py

ENV PYTHONPATH=/worker
# Startup checks Poppler, then exits closed. This is not a production consumer.
CMD ["python3", "-m", "inspector_worker.zu127_specialist_consumer"]
