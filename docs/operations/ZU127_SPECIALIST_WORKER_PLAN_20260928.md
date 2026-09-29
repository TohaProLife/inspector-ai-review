# ZU-127 F0152 fixture boundary, 28 September 2026

`services/worker/inspector_worker/zu127_specialist_consumer.py` is a **fixture-only** adapter for original public F0152, not a production consumer for arbitrary ZU-127 documents or customer objects. It hardcodes F0152 object ID, SHA-256 and size. Its only queue name is `rules.evaluate.zu127.poppler-v2`, matching API queue policy. `fixture_claim_payload()` includes that exact `queueName` and `RULE_EVALUATION` capability, but no consumer calls it. Default startup checks `pdftotext` and `pdfinfo` version `25.12.0`, then exits with an incomplete-contract error. It does not open RabbitMQ, claim, download, complete, fail, or acknowledge a job. `--check` performs runtime preflight only.

The fixture adapter accepts a claimed `RULE_EVALUATION` lease only with attempt ID, positive integer fence, exact F0152 SHA/size, public object ID, DRAFT no-network release and explicitly configured `zu127-window-table-poppler-review-v2` slot. It verifies the source download path and human source decision before fetching bytes through the fenced internal input endpoint. Missing review produces `ABSTAIN` without PDF access. Eligible input uses an ephemeral directory and the existing versioned review evaluator. That evaluator still verifies original bytes and full Poppler page word receipts. Output remains review navigation with no typed fact, finding, or coverage.

`infra/zu127-specialist/Dockerfile` pins the same Alpine base digest and Poppler package/version as the isolated one-shot proof. Its default command exits closed. The fixture image is not added to ordinary Compose, and no normal worker registry imports this adapter. Alpine package repository is not snapshotted; image ID and package manifest are needed for a reproducible release claim.

## Durable integration still required

1. Production profile must remove hardcoded public object/source identity and use an immutable release source selector with equivalent fail-closed identity, provenance and human review gates. The F0152 fixture must never serve as a general production worker.
2. API must route only an explicit immutable ZU v2 release to this dedicated queue, fence claim by queue name, and keep all other rule jobs on `rules.evaluate`. Existing jobs must not be silently rerouted.
3. API must independently re-extract *all* words on selected pages using a versioned Poppler runtime, compare page receipts, word text, indices and boxes, and reject altered or incomplete results. The current ordinary API and worker images differ in their Poppler availability.
4. API needs bounded append-only result schema and transaction for save/seal/GET, with source decision snapshot, current/approved/section gates, dedupe and stale-fence checks. UI can show navigation only after that read path exists. No proposal may become a fact or finding through this path.
5. Only after these contracts and failure/retry tests pass may a queue callback be added. It should reuse the ordinary lease heartbeat pattern, call a source-independent adapter, send a fenced `complete`, and ack only after a durable API receipt; ambiguous control-plane outcomes must redeliver safely.

Focused tests are synthetic. The separate original-F0152 one-shot Compose proof is documented in `ZU127_POPPLER_ONESHOT_PROOF_20260928.md`; it does not establish this durable path. No CURRENT/APPROVED F0152 source decision or authenticated ZU section exists in the public run, so present behavior remains `ABSTAIN`.

An isolated local build exposed an exact-version parser bug: Poppler `-v`
prints copyright lines after the version, so the previous full-output regex
rejected the pinned image. The parser now matches the complete first line.
The rebuilt fixture image
`sha256:853ecae3e151efaa1550400c58eb4c91dc373bc45a88d17c783a3b96306113c5`
passes `--check` under networkless/read-only Docker. Default startup still
exits closed with `F0152 fixture has no durable API contract or consumer`.
Focused worker tests: 21 run, two skipped when their optional source is absent.
