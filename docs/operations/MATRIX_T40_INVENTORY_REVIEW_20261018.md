# T40 — authenticated source inventory review

API/store capability only. No PRESENCE_SET comparator, enabled atom, catalog coverage, confidence, or independent proof of real completeness is added. All authored PDFs used by API/store tests are explicitly synthetic. Browser acceptance remains pending under the existing policy hold.

The new optional `inventoryScope` sibling belongs to immutable `source_review_decisions`; existing run snapshots retain the exact decision ID/hash. Migration034 adds one nullable JSONB column and retains append-only triggers. Omitted inventory on an old review remains absent, preserving old canonical review/config bytes. Rollback refuses to remove a column containing any recorded sibling.

Request claims contain target5, explicit one-page region plus original header/scope fragments, typed identity, assertion, and unchanged reference. Requests cannot contain `inventorySnapshot`. The server loads the same-object terminal sealed origin run, authenticates its entire manifest/source/text-job/release/text-artifact chain, reconstructs the selected source region independently, checks every target hash and stores the reconstructed snapshot. `textStageContentHash` names the saved **per-source** `analysis_text_artifacts.content_hash`; it is not RULE_EVALUATION or an aggregate stage hash. The separate portable text hash authenticates the entire unchanged document-text-v2 envelope. Targets refer to an origin run, so a later manifest may include the resulting review without a self-hash cycle.

- GET `/api/checks/:id/source-inventory-pages?sourceFileId=...` returns full immutable text and latest authenticated interpretation/CAS hash under READ.
- POST `/api/checks/:id/source-inventory-preview` takes only sourceFileId/selection, requires READ and CSRF, independently reconstructs, returns a target only for RECONSTRUCTED, and performs no domain/audit/receipt writes.
- The existing source-review POST materializes snapshots under REVIEW_DECIDE and latest-hash CAS.

`HUMAN_ASSERTED_COMPLETE` is a human assertion limited to the selected declared region. It requires a nonempty reconstructed feature set and zero unresolved rows. UNKNOWN may retain unresolved/empty mechanical evidence; neither state proves global closure or absence. Different regions sharing a physical identity are retained separately; this store supplies no union, first-match, physical-member equivalence, or comparison policy.

## Approved omission amendment

Parent explicitly approved preserve-on-omission, superseding the earlier T39 design. A writer omitting inventoryScope when the latest decision has it must supply the latest expectedReviewHash. Server projects the prior claims, independently reauthenticates and reconstructs them under the submitted interpretation, then preserves the sibling. Explicit `{schemaVersion:'matrix-inventory-review-v1',claims:[]}` is the only withdrawal. Invalid changed interpretation rejects with repreview/withdraw guidance; no silent reuse of old snapshots. Changing source revision/approval to UNKNOWN can preserve the human inventory, without granting source approval or machine qualification. The approved pure proposal/oracle remains unchanged; amendment is recorded separately in `api-preserve-omission-amendment.json`.

## Bounds and boundary

Request JSON total512KiB; materialized sibling and complete normalized parent review each share one8,000,000-byte JSON ceiling, including punctuation, across all16claims. No per-claim8MB multiplication or truncation. Depth64/nodes200000/container32768. Origin source text is capped at512pages and8MB for this capability. Native proxies/accessors/custom prototypes/sparse arrays/symbols/cycles/unsafe numbers/non-scalar strings reject before traversal. Route-scoped lexical JSON guard rejects escaped duplicate keys and malformed/deep/oversized inputs **before Fastify AJV can strip unknown fields**. Input and output schemas are distinct, strict, and expose safe integer geometry.

All whole-review hash loaders now conditionally include inventoryScope. OCR applicability source-review authentication retains both optional siblings without promoting them to scalar evidence. Legacy `bindMatrixSourceScope` receives only its existing matrix scope; inventory is not injected into legacy proofs or worker profiles.

## Verification

Focused API:132PASS (inventory contract/native/route, existing fact scope route, OpenAPI). Additional existing API/OCR compatibility:18PASS. Actual disposable PostgreSQL:5PASS, bounded timeouts, all clients closed and zero active DB backends before DROP without FORCE. Covers sealed origin/source isolation, two honest synthetic inventories, preserved original sealed output, future immutable run snapshots/noncycle, request-target/region/hash forgeries with no partial review/receipt writes, latest CAS and concurrent writers, omitted sibling preservation, UNKNOWN status, explicit withdrawal, invalid interpretation, unresolved/empty completeness rejection, UNKNOWN evidence retention, append-only/rollback refusal, absent legacy body bytes, and all four original profile config hashes. API/contracts typecheckPASS. Root full-suite/stand acceptance is separate.
