FROM python:3.13-slim@sha256:cc9dffa47c8294ba9bb795a8dfaeb7b76f2b30acade2c52a461a2999d127eb00
WORKDIR /worker
COPY pyproject.toml ./
COPY inspector_worker inspector_worker
COPY rules rules
ENV INSPECTOR_RULES_DIR=/worker/rules
RUN pip install --no-cache-dir .
CMD ["inspector-worker", "--queue", "rules.evaluate"]
