# Full source audit V4, operations v1

Explicit source reading, `SOURCE_AUDIT_ONLY`. Profile `SOURCE_AUDIT_V4_FULL_SOURCE_V1`, artifact `document-text-v4`, resource policy `document-text-v4-full-source-bounds-v1`. Existing V3 and matrix V13 remain immutable and refuse sources above512 pages. V4 does not produce matrix findings, engineering equivalence, project authority or calibrated probability.

Current accepted application: `37281628828bb98695a818e2d328291a6e357d72`; [handoff package v4](FINAL_PACKAGE_V4_20261020.md), [installed CPU receipt](evidence/final-qa-20261020/installed-cpu-3728162.json). Unpack the source ZIP into an empty directory and work from its root containing `package.json` and `infra/`; it has no nested `source/`. Unpack the real-PDF companion separately. References to a `source/` directory in older review-package instructions are historical.

Prerequisites: apply all 51 migrations of this accepted application, including 046 for the V4 audit and 051 for separate OCR imports; API and document worker installed from the same source tree; durable PostgreSQL/RabbitMQ/outbox pipeline running; original uploaded/committed PDF marked CLEAN. Session needs object READ/RUN, RUN_START and valid CSRF. No environment switch automatically upgrades a matrix run to this source audit.

For Compose, append `-f infra/docker-compose.source-audit-v4.yml` **last** to the existing CPU or H100 Compose command, including its same project name and env file, for both `config` and `up`. It sets API2GiB/Node heap768MiB and document-worker3GiB. The ordinary V13 overlay uses a smaller384MiB Node heap. Do not start another stack or change model selectors to request V4; this overlay changes only resource limits. Apply all migrations with the same stack before starting the audit.

Fixed limits: 1..1024 physical pages, 64MiB per original, 1..64 sources, 32,000,000 canonical bytes and1,400,000 native nodes per artifact; 100,000 located+unlocated records; complete result aggregate32,000,000 bytes; wire33,554,432 bytes. Batch limit1..128 pages. Over-budget input refuses whole completion; no truncation or automatic OCR fallback. Recommend document worker at least3GiB, API2GiB with Node heap768MiB. Heartbeats must remain active during extraction; the final timed F0201 direct CPU replay took88.17seconds with maximum RSS267420KiB and no swaps. Earlier process measurements differed. These measurements are local, not a universal runtime guarantee or the peak of the complete queue stack.

Start explicit audit. `BASE_URL`, `OBJECT_ID`, `COOKIE`, `CSRF` come from the running local application; never commit session values.

```sh
curl --fail-with-body "$BASE_URL/api/objects/$OBJECT_ID/source-audit-v4-full-source-v1" \
  -H "Cookie: $COOKIE" -H "X-CSRF-Token: $CSRF" \
  -H "Idempotency-Key: source-v4-$(date +%s)" \
  -H 'Content-Type: application/json' --data '{}'
```

Response is201 with check `id`, `mode:NORMAL`, `purpose:SOURCE_AUDIT_ONLY`, `sourceAuditProfileVersion:SOURCE_AUDIT_V4_FULL_SOURCE_V1`. Reuse the same idempotency key only for replay of that same command. Poll ordinary `GET /api/checks/{id}` until sealed. Source-only run finishes PARTIAL with unsupported engineering coverage; nine source/scaffold jobs succeed. `OCR_REQUIRED` page quality remains metadata; it does not schedule an OCR job.

Fetch first batch after sealing:

```sh
curl --fail-with-body -H "Cookie: $COOKIE" \
  "$BASE_URL/api/checks/$CHECK_ID/source-text-v4-full-source-v1/pages?sourceFileId=$SOURCE_FILE_ID&startPage=1&pageLimit=128"
```

Response carries `wholeArtifactPageCount`, absolute `pages[].pageNumber`, immutable `textArtifactContentHash`, `nextPage`, whole source SHA and manifest/release provenance. For every continuation, pass the prior hash:

```sh
curl --fail-with-body -H "Cookie: $COOKIE" \
  "$BASE_URL/api/checks/$CHECK_ID/source-text-v4-full-source-v1/pages?sourceFileId=$SOURCE_FILE_ID&startPage=$NEXT_PAGE&pageLimit=128&expectedArtifactContentHash=$ARTIFACT_CONTENT_HASH"
```

Stop at `nextPage:null`. For676 pages, six batches start1,129,257,385,513,641; last contains36 pages ending676. Missing/wrong continuation hash, page outside actual source or limit129 refuses. Each request authenticates the complete stored artifact; batches are projections for reading, never admitted partial sources. Full response remains available at `GET /api/checks/{id}/source-text-v4-full-source-v1?sourceFileId=...`.

F0201 public original SHA256 is `0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd`, size43,033,348 bytes, physical pages676. Direct V4 replay read all676, emitted50,887 located lines and0 unlocated, quality664 candidate/12 OCR_REQUIRED. Mixed RD/ID source stays `stage:UNRESOLVED`; full text does not authorize assigning RD to every page. `renderedVisibility:UNVERIFIED`, `authorityStatus:SOURCE_DECLARED_UNVERIFIED`, `calibratedProbability:null` are intentional.

The current UI includes the V4 source workspace alongside historical V3. In source documents, choose the PDF, start «Полный аудит PDF до 1024 страниц», wait for sealing and select the saved full audit. The explorer reads all hash-bound batches before full-text search; matching text can open its original PDF page. Older saved V4 audits can also be opened by ID. Source-only native capacity/airflow comparisons have separate history and JSON; they do not add engineering coverage.

For pages still marked `OCR_REQUIRED`, open «Историю OCR пропусков» in that saved V4 workspace, choose a `source-ocr-import-bundle-v1` JSON for the exact same PDF and save the separate import. The companion provides `audits/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json`. Import requires RUN_START/RUN; transcription review requires SOURCE_REVIEW/REVIEW_DECIDE. Search, page navigation, literal line review with a basis, history and JSON download are available; [OCR operations and acceptance](SOURCE_OCR_IMPORT_ACCEPTANCE_20261020.md).

Import reuses saved responses and does not run an OCR provider or modify the sealed native artifact. Empty OCR pages remain UNRESOLVED. External raster coordinates do not become trusted PDF boxes. `IMPORTED_OCR_UNVERIFIED`, provider/render verification false, `p=null`, `factEligible=false` and `coverageDelta=0` remain explicit; human transcription review does not establish engineering equivalence, source authority or a matrix violation.

Verification commands from repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/worker:services/worker/tests \
  services/worker/.venv/bin/python -m unittest test_document_text_v4_full -v
npm exec -w @inspector-ai/api -- vitest run --maxWorkers=1 test/document-text-v4-full.test.ts
# INSPECTOR_POSTGRES_ADMIN_URL must name an owned disposable PostgreSQL admin database.
# Test creates/drops its own UUID database, never migrates the admin database.
npm exec -w @inspector-ai/api -- vitest run --maxWorkers=1 test/document-text-v4-full-source-postgres.integration.test.ts
```

PostgreSQL integration is explicitly optional when its external admin URL is absent. It exercises real SQL/API injection and actual Python extraction of a separately authored676-page PDF. Original F0201 replay and full RabbitMQ/container restart proof are separate evidence boundaries. The former browser SECURITY_HOLD described an earlier stage; current local browser acceptance covers [V4 full-text search in the viewer](PAIR_VIEWER_ACCEPTANCE_20261020.md) and the separate OCR import UI. Browser acceptance and installed queue acceptance remain distinct; neither proves text accuracy or engineering qualification.

Current full original F0201 queue acceptance passed on clean `3728162` API/web/worker images: real ClamAV upload, nine normal plus nine source-only jobs, 18 successful attempts/confirmed outbox records, 676 stored pages, six complete hash-bound batches, refusal cases and byte-exact full read after actual database/API/relay/four-worker restart. All 51 migration bytes were checked. The installed run did not execute OCR and retained all 12 native gaps. [Installed CPU receipt](evidence/final-qa-20261020/installed-cpu-3728162.json).

Historical evidence remains available: the earlier clean `a013c0bc` [queue receipt](evidence/cpu-normal-20261020/checkpoint-a013c0bc-full-source.json) and [direct/SQL stage-history receipt](evidence/full-source-v4-20261020/direct-and-postgres-v1.json). These establish their own earlier boundaries; statements there about V3-only UI or unavailable browser checks do not describe the current application.
