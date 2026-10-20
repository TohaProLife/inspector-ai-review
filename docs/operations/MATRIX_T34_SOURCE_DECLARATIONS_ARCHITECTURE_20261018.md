# T34: typed source declarations without executable coverage

Status: READ-ONLY DESIGN, 2026-10-18. This note is a proposed future change, not an accepted implementation, release or browser result. No registry/runtime/stand changes, FTS queries, extractions or browser calls were made for this review. The independently developed steel parser was read as source, not executed here.

## Decision

Add a separate `sourceDeclarations` sibling of `execution` and `projectConstraints` in the existing immutable `analysis-stage-result-v2` RULE_EVALUATION envelope. First support only a strict steel declaration variant. Introduce a new provider profile, proposed `matrix-text-facts-evidence-v3`, adapter `3`; retain explicit v1/v2 policies and historical readers. Do not enable a steel atom or put these declarations in `MatrixObservation`.

This gives the user searchable, source-bound material evidence while the corresponding catalog parameter remains UNSUPPORTED. It does not create a comparison, finding, confidence score, reviewed element identity, normative applicability or successful-comparison count. A declaration count is an evidence count with its own label, never a coverage numerator.

No SQL migration is needed for this bounded sibling approach: `analysis_stage_artifacts` already stores JSONB and an unconstrained text provider profile, with immutable UPDATE/DELETE trigger (`migrations/011_analysis_pipeline_scaffold.sql:25`); migration 013 permits `analysis-stage-result-v2`, RULES_EVALUATED and 8 MiB (`migrations/013_pilot_rule_results.sql:5`). Keep that envelope schema, disposition and size limit. Do not store the full text artifact again inside the declarations payload.

## Existing T28 path and exact extension points

| Layer | Current entry point | Smallest proposed extension |
| --- | --- | --- |
| DTO | `packages/contracts/src/matrix-project-constraints.ts:2`, `:34`; `matrix-execution.ts:103` | New `matrix-source-declarations.ts`; optional sibling on `MatrixExecutionRead`; index export. Keep old DTOs unchanged. |
| Pure Python evidence extraction | `services/worker/inspector_worker/project_constraints.py:66` ID hash, `:199` extractor; `steel_prose.py:139` page parser | New full-envelope `source_declarations.py` wrapper calls the frozen pure steel parser on authentic pages. No import into the scalar engine. |
| Durable producer | `services/worker/inspector_worker/durable_matrix.py:15`, profile map `:20`, pins `:51`, output `:77` | Add v3 capability policy, pin wrapper plus steel source/version, emit both evidence siblings only for declared capabilities. Keep `outputCount=len(execution.results)`. |
| Release/config identity | `apps/api/src/matrix-execution.ts:17`, definitions `:31`, policy `:53`; `postgres-repository.ts:5355` | Explicit three-profile policy records/capabilities, new v3 config/release identity. Never derive old v1/v2 definitions by accidentally spreading the new v3 evidence pins. |
| Independent TS boundary | `apps/api/src/matrix-project-constraints.ts:188`, validator `:226` | New independent `matrix-source-declarations.ts` reconstruction, using committed text artifacts and source metadata; no Python subprocess or trusted worker-only parse. |
| Stage acceptance | `apps/api/src/postgres-repository.ts:12067` | Validate required v3 sibling independently before accepting worker completion; forbid it on v1/v2. Keep scalar validation separate. |
| Seal | `apps/api/src/postgres-repository.ts:12132` | Revalidate v3 at seal just as T28. Existing rule_results/coverage/submission builders consume only execution. Include sibling in the existing envelope content hash. |
| Historical/API read | `apps/api/src/postgres-repository.ts:12249`; route `apps/api/src/app.ts:1575`; client `apps/web/src/api.ts:1588` | Extend profile lookup from SQL `IN ($2,$3)` to the full explicit read-profile array. Return saved optional sibling; preserve auth, ETag, private/no-store and hash checks. No new write endpoint. |
| OpenAPI | `apps/api/src/api-contract.ts:2248`, operation `:3187` | Describe optional typed sibling; current permissive generic response object is insufficient documentation for this contract. |
| Evidence UI | `apps/web/src/MatrixExecutionPanel.tsx:178`; `MatrixProjectConstraints.tsx:20` | Separate `MatrixSourceDeclarations` evidence section using common query and its own selected declaration/fragment viewer. No scalar-selection review flow. |
| Fact targets/reviews | `apps/api/src/postgres-repository.ts:12212`, `:12231`; `MatrixExecutionPanel.tsx:181` | Remain scalar-only. Declaration IDs never become FACT_BINDINGS targets or approval/review actions. |

These line anchors describe the tree read for this review. The accompanying receipt records source hashes; concurrent work may shift line numbers.

## Proposed first contract

Names below are proposals, not current exported contracts. Use a strict discriminated steel-only union initially; avoid an open arbitrary attribute/value plugin map.

```ts
type MatrixSourceDeclarations = {
  schemaVersion: "matrix-source-declarations-v1";
  objectId: string;
  inputManifestHash: string;
  extractorVersion: "matrix-source-declarations-v1";
  purpose: "EVIDENCE_ONLY";
  declarations: MatrixSteelSourceDeclaration[];
};

type MatrixSteelSourceDeclaration = {
  schemaVersion: "matrix-source-declaration-v1";
  id: string;
  kind: "SOURCE_AUTHORED_STEEL_DECLARATION";
  extractorVersion: "matrix-steel-prose-v1";
  sourceFileId: string;
  sourceSha256: string;
  textArtifactHash: string;
  stage: "PD" | "RD";
  pageNumber: number;
  widthMilliPoints: number;
  heightMilliPoints: number;
  value: "С245" | "С345";
  rawValue: "C245" | "С245" | "C345" | "С345";
  rawUnit: null;
  canonicalUnit: "steel_catalog_example";
  entityKey: null;
  applicabilityStatus: "UNREVIEWED";
  primaryFragments: SourceDeclarationFragment[];
  scopeFragments: SourceDeclarationFragment[];
  productScope: SteelSourceProductScope;
};

type SourceDeclarationFragment = {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number;
  rawText: string;
  bboxMilliPoints: [number, number, number, number];
};
```

`SteelSourceProductScope` is a strict union matching the pure parser, not an element binding. Current parser branches (`steel_prose.py:171`, `:198`) yield:

* PD: `role=DISTRIBUTION_BELT_I_BEAMS`, `productKind=I_BEAM`, `profile=70Б3`, `count=3`, `tier=2`, source-written product standard `ГОСТ Р 35087-2024` and grade standard `ГОСТ 27772-2015`.
* RD: `role=I_BEAM_GENERIC_DECLARATION`, `productKind=I_BEAM`, profile/count/tier null, source-written `ГОСТ Р 57837-2017` and `ГОСТ 27772-2021`.

Retain all parser primary/scope fragments, including adjacent tube/sheet/rebar text. Those neighboring grades must not become the I-beam grade. RD remains section OTHER in the original file metadata. The wrapper must not invent KR, a common member, floor/zone, review/approval or matching applicability. Standards are literal source references, not verified legal applicability or external norm claims. `count=3` and `tier=2` describe this source's product group, not a cross-source key.

Do not add ruleId/ruleVersion/comparisonVariant/delta/qualified/result/machineStatus/probability to this DTO. No `attribute` from the executable atom namespace or parameter link is necessary for the first version. A later static UI catalog association must be labeled informational, must not enter identity/comparison gates, and needs its own versioned mapping if hashed.

`steel_catalog_example` is the narrow parser category token, not a physical unit or strength ranking. Raw unit remains null here; do not relax the legacy generic observation unit schema or normalization to accommodate it. The pure helper's directed comparison utility is not invoked by this evidence pipeline.

## Authenticity, hash and stage rules

1. Use full committed document-text-v2 envelopes. Check source ID uniqueness, manifest source SHA, artifact inputSha256/sourceFileId, page count/order, page dimensions, quality, exact original line boxes and permitted strict shapes before parsing. No pages-only hash, renumbering, text substitutions, source hash allowlist or hidden labels. Match T28 strict full-artifact validation semantics; independently port rather than importing private implementation details across feature modules.
2. Stage comes from the trusted frozen manifest/page-stage interpretation used for that run, not the worker declaration. Initially accept only one unambiguous PD or RD stage for the entire source; multi-stage/ID/unresolved sources abstain. Per-page interpretations can be a later explicit grammar version. Missing source approval does not erase evidence, and evidence does not grant approval. Section OTHER does not prevent source-authored RD text evidence.
3. Use a new domain-separated portable canonical JSON policy, ASCII object keys sorted by code point, Unicode scalar strings, no floats, safe integers only, finite tree/depth limit. Proposed domains: `matrix-source-declaration-text-artifact-v1` for the whole immutable text envelope, and `matrix-source-declaration-id-v1` for the full declaration body excluding only id. Include stage, full productScope, full raw fragments/order/boxes/page dimensions, parser version and provenance. Do not change existing observation/typed-fact/projectConstraint hash domains.
4. Full original raw lines stay byte-for-byte text data, including unused neighbors, spaces and glyphs. If usedTextRange is later introduced, its offsets must be Unicode code points and hashed, just as T28; initial steel DTO need not pretend the page parser already emits offsets. UI can display full original lines without inventing substring coordinates.
5. Sort deterministically by sourceFileId/page/declaration ID with the new portable ordering. Reject missing/extra declarations, altered ordering, unknown nested keys, fake identity/status fields and rehashed forged values. TS independently rebuilds the entire expected sibling from trusted inputs and compares canonical equality. A valid-looking ID is not evidence authentication.
6. Put wrapper source SHA, steel helper SHA/version, schema version, hash policy version and purpose in v3 definitions. Config/release hash must change if either extraction implementation changes. API's independently deployed validator is part of the API build/runtime release evidence; do not claim a Python source pin alone verifies it.
7. Unsupported prose/ambiguous grammar gives an empty declarations array. Malformed accepted artifact shapes or unrecognized configured versions fail the stage rather than silently dropping a configured evidence output. Do not truncate over the existing 8 MiB envelope ceiling; an explicit extraction cap would require a versioned completeness/deferred contract first.

## Backward compatibility and sealing

Current profiles are v1 exact-only and v2 exact+projectConstraints. Their meanings must stay fixed:

| Profile | Required sibling | Forbidden sibling |
| --- | --- | --- |
| matrix-text-facts-v1 / adapter1 | none | projectConstraints, sourceDeclarations |
| matrix-text-facts-constraints-v2 / adapter2 | projectConstraints | sourceDeclarations |
| proposed matrix-text-facts-evidence-v3 / adapter3 | projectConstraints, sourceDeclarations, even when empty | evidence nested inside execution |

Replace hard-coded `profile===MATRIX_PROFILE` tests with profile capabilities; simply changing the constant to v3 would accidentally make v2 lose mandatory constraints validation/readback. In particular, audit durable producer, `validateMatrixStage`, `getMatrixExecution`, release creation, seal and `loadMatrixFactOrigin`. Change profile read selection consistently, including SQL parameter count. Keep the current v1/v2 definitions constructed from scalar definitions and constraints policy explicitly, excluding the new declarations pin. Current old definitions already track the installed scalar implementation: this design does not promise to replay arbitrary historical binaries. Previously sealed runs remain readable from saved bytes without re-executing the current parser.

The sibling is covered by existing stage content_hash/byte_size and seal output_hash. For a NEW v3 run, stage contentHash and therefore fact target executionContentHash change, even when every scalar observation ID/payload and submission byte is identical to a same-input v2 run. That is correct provenance. Never normalize these hashes to make them match, overwrite an old stage, carry old targets as if current, or regenerate old submission snapshots. Existing historical contentHash, target hashes, source decisions and stored submission bytes remain unchanged.

`sealMatrixRun` inserts results/coverage from execution only and hashes `buildMatrixSubmission(execution, ...)` only. Keep it so. Evidence-only sibling is not appended to rule_results, parameter_coverage, pilot findings, prediction export or review candidates. An evidence export, if wanted later, should use a separately labeled schema and saved envelope identity; it is not needed for the first implementation.

API readback must retain authorization/object scoping and stored envelope integrity checks. Historical v1/v2 reads omit sourceDeclarations; do not synthesize an empty field from today's extractor. New v3 reads validate saved discriminator/purpose/objectId/manifest identity and expose the saved artifact; completion/seal performed the independent full reconstruction. A restarted API reads identical saved outputs, regardless of current parser logic.

## UI and user meaning

Use a separate section titled “Декларации материалов из исходников”. Show literal grade, source-authored product scope, stage/actual source section, PDF page, source SHA and each primary/context original fragment. Label “Принадлежность одному элементу и применимость не проверены”. Search must include grade aliases, full source text and product scope. Primary/context viewer buttons use exact source, page and integer-derived normalized box; key by declaration ID + fragment identity to avoid stale source/page state.

Use `InspectorEvidenceViewer` as T28 does, with independent local selection. Do not pass declaration through the scalar `selectFact` path, `MatrixFactScopeReview`, machine confidence presenter or candidate decisions. No bind/approve/confirm controls. No percentage confidence; the 80% warning policy concerns calibrated machine results, not literal declaration evidence. Empty result means no supported declaration extracted, not verified absence or completed material inventory.

The real F0105/F0145 pair is a useful positive extraction and negative qualification acceptance case: source-authored PD three70Б3 tier2 I-beams differ in scope from generic RD I-beams, RD section remains OTHER, both literal grades may be С245, and qualified findings remain zero. Equal raw category is not NEGATIVE_VERIFIED.

## Required regression boundaries before implementation acceptance

| Layer | Meaningful checks |
| --- | --- |
| Pure + wrapper | Full original F0105/F0145 artifacts, exact two declarations/primary+scope counts per frozen golden; original source bytes/hashes/pageCount unchanged; raw Cyrillic/Latin aliases; neighboring sheet/tube/rebar clauses not misassigned; scope mismatch retained; OTHER preserved; no input mutation. |
| Hash parity | Python vs independent TS whole-envelope hash/ID goldens including non-ASCII text, safe-int bounds, malformed Unicode, sparse/accessor/extra shapes; mutate each semantic productScope/raw/geometry field and verify ID changes; recompute attacker ID and still reject source mismatch. |
| Boundary | Wrong source/SHA/full textArtifactHash/stage/page/box; missing/reordered/forged contexts; duplicate/competing declarations, coarse boxes/interleavers; unknown fields, status/probability/identity injection; dropped/extra declaration; unsupported grammar vs technical malformed shape distinguished. |
| Scalar isolation | Compare every old observation payload/ID, result, coverage and submission bytes against the same-input baseline; registry hash/counts unchanged; attempts to insert sourceDeclarations/declaration fields into execution or fabricate scalar observations using declaration IDs rejected. Extend reserved-field rejection explicitly without loosening selectors/verifier. |
| Profiles/pins | v1/v2 accepted exactly under existing shapes, reject declarations; v3 requires both evidence siblings, accepts empty list, rejects missing/mismatched version/purpose/wrapper/helper source pin/config hash/profile adapter. No changed old config definitions caused merely by adding the new pin. |
| Actual PostgreSQL | Complete+seal v3 on committed full source artifacts; verify separate saved sibling, unchanged scalar coverage/zero findings, no declaration targets/reviews, stale cross-run target rejection; rejected forged completion leaves no partial stage; immutable UPDATE/DELETE enforcement. v1/v2 old snapshots/raw bytes/hash stable through restart. |
| API/auth/export | Unauthorized/cross-object denied; matrix-execution GET returns saved optional artifact and ETag; source fetches belong to manifest; submission/findings/targets/pilot-results raw bytes unchanged by readback. No evidence count in outputCount or coverage. |
| UI later | 1440/768/375, fresh navigation, each primary/context original frame/box, search full neighbors, no overflow, no domain writes, no review controls or confidence, correct OTHER and differing scopes. Browser remains NOT_RUN under current security hold; no alternate surface bypass. |

Existing tests to extend by analogy, not edit in this review: `apps/api/test/matrix-project-constraints.test.ts`, `matrix-postgres.integration.test.ts`, `matrix-legacy-postgres.integration.test.ts`, `services/worker/tests/test_durable_matrix_source_pin.py`, `apps/web/src/matrix-project-constraints.test.tsx`. Use new feature tests for declaration-specific cases; preserve all old negative source-boundary assertions.

## Alternatives and delivery order

An evidenceExtractors registry that produces this same sibling could be introduced later for multiple evidence kinds. It would still need pinned versions, independent validation and explicit separation from atom coverage. With one steel grammar it adds dispatch/config surface without solving a new requirement.

Putting UNSUPPORTED declarations in existing observations is a larger and riskier change: current scalar DTO requires a unit, fact targets derive from every observation, review UI exposes binding actions, verifier expects atom-defined source semantics and the engine consumes the same collection. Loosening any of these to admit rawUnit null or unregistered attributes would expand the attack surface. Reject that alternative for this phase.

Implement in order: frozen pure parser/full-artifact golden → strict standalone wrapper + independent TS parity → contracts/new profile/pins and forbidden-field isolation → immutable completion/seal/readback + actual PG → evidence-only UI → authorized HTTP/restart acceptance → browser acceptance only when the existing security hold is explicitly resolved. No external models, new jobs, caches, data search or enabled atom are required.

The resulting capability is “material declarations located with source context”, while the executable registry and unsupported gaps remain honest. A later steel atom needs a separately justified catalog trigger, authentic same-member binding, compatible product/standard basis and explicit approval/context gates; this evidence artifact cannot supply those by implication.
