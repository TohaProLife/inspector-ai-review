# ZU-127 generic v3: fenced review-stage adapter

`services/worker/inspector_worker/zu127_generic_stage_v3.py` is an opt-in
adapter. It is **not** registered with the normal rule provider registry,
Rabbit consumer, release builder, outbox relay, or durable result API. It makes
no findings, facts, coverage or absence decision.

Contract:

1. A fenced `RULE_EVALUATION` lease must have matching attempt/fence, run,
   release, object, input manifest SHA and release manifest SHA. Its DRAFT,
   network-disabled `RULE_ENGINE` slot must select exactly
   `zu127-generic-poppler-page-review-v3` and local canonical config SHA.
2. The lease must carry an immutable source and decision snapshot. Each PDF
   source has unique ID, SHA, byte size and exact internal input path. A
   reviewed section must match the source snapshot. All PDFs receive their
   committed `document-text-v2` through the fenced artifact endpoint; its
   canonical SHA is bound into the selection output. Page count derives from
   that artifact and is cross-checked if source metadata also supplies it.
3. The pure v3 selector requires a CURRENT/APPROVED ZU PD decision with basis.
   It selects no more than four text-layer pages across sources, reports OCR
   deferrals and truncation, and always returns ABSTAIN. Missing review or no
   candidate means **no source PDF download or Poppler call**.
4. For selected pages only, the adapter downloads PDF bytes through the fenced
   internal path into a temporary file, checks size, signature and SHA, then
   invokes the pinned Poppler full-page provider. It binds the returned page
   numbers, source SHA, page count, receipt hashes and text-artifact SHA to the
   stage output, capped at 32 MiB. Result includes selection and full-page receipts, all
   review-only, plus release/input provenance and a canonical content hash.

The API currently does **not** independently authenticate this v3 stage by
re-extracting the original PDF at save, seal or GET. The lease snapshot is
trusted only because the fenced API produced it; a caller-supplied synthetic
lease is not proof of a human approval. No real approved source or PD/RD pair
exists in the public test set. Durable storage, queue routing, UI and a
source-independent ZU-127 table extractor remain separate work. The older
F0152-specific v2 fixture and normal rule profile are unchanged.

Focused synthetic tests:

```sh
services/worker/.venv/bin/python -m unittest discover -s services/worker/tests -p 'test_zu127_generic_stage_v3.py' -v
```

They cover fenced profile, PDF and text tampering, missing/non-current review,
no lexical candidate, exact selected scope and malformed Poppler receipt. No
synthetic CURRENT/APPROVED decision is represented as a real expert decision.
