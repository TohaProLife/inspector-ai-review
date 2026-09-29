FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50

# Both independent extractors run this one immutable Poppler installation.
RUN apk add --no-cache python3 poppler-utils=25.12.0-r1 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0"

WORKDIR /review
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --ignore-scripts

COPY apps/api/src/canonical-json.ts apps/api/src/canonical-json.ts
COPY apps/api/src/trusted-page-words.ts apps/api/src/trusted-page-words.ts
COPY apps/api/src/poppler-page-words.ts apps/api/src/poppler-page-words.ts
COPY apps/api/src/zu127-window-table-poppler-v2.ts apps/api/src/zu127-window-table-poppler-v2.ts
COPY infra/zu127-review/worker_init.py services/worker/inspector_worker/__init__.py
COPY services/worker/inspector_worker/zu127_window_table_poppler_v2.py services/worker/inspector_worker/zu127_window_table_poppler_v2.py
COPY infra/zu127-review/run.sh infra/zu127-review/run_worker.py infra/zu127-review/run_verifier.ts ./

ENV PYTHONPATH=/review/services/worker
CMD ["sh", "/review/run.sh"]
