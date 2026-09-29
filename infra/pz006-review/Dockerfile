FROM node:22-alpine@sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50

# Shared immutable Poppler installation for the independent API extraction.
RUN apk add --no-cache python3 poppler-utils=25.12.0-r1 \
    && test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0"

# Worker deliberately uses its pinned PyMuPDF version; installation is hash checked.
RUN python3 -m venv /opt/pz006-venv \
    && printf '%s\n' 'PyMuPDF==1.27.2.2 --hash=sha256:8b4bbfa6ef347fade678771a93f6364971c51a2cdc44cd2400dc4eeed1ddb4e6' > /tmp/pz006-requirements.txt \
    && /opt/pz006-venv/bin/pip install --no-cache-dir --require-hashes -r /tmp/pz006-requirements.txt \
    && /opt/pz006-venv/bin/python -c 'import fitz; assert fitz.VersionBind == "1.27.2.2"' \
    && rm /tmp/pz006-requirements.txt

WORKDIR /review
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --ignore-scripts

COPY apps/api/src/canonical-json.ts apps/api/src/canonical-json.ts
COPY apps/api/src/trusted-page-words.ts apps/api/src/trusted-page-words.ts
COPY apps/api/src/poppler-page-words.ts apps/api/src/poppler-page-words.ts
COPY apps/api/src/pz006-building-levels-proposals.ts apps/api/src/pz006-building-levels-proposals.ts
COPY infra/pz006-review/worker_init.py services/worker/inspector_worker/__init__.py
COPY services/worker/inspector_worker/pz006_building_levels_proposals.py services/worker/inspector_worker/pz006_building_levels_proposals.py
COPY infra/pz006-review/run.sh infra/pz006-review/run_worker.py infra/pz006-review/run_verifier.ts ./

ENV PYTHONPATH=/review/services/worker
CMD ["sh", "/review/run.sh"]
