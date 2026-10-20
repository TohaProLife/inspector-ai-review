# T27: project bounds without invented exact measurements

Date: 2026-10-18. **Read-only design for future implementation; not acceptance or release evidence.** Runtime, tests, registry and stack unchanged. Reused three public canonical pages already SHA-verified in T22; no new index queries, extraction, OCR, models or annotation reads. Evidence: `output/matrix-t27-20261018/`.

## Recommendation

Represent an author-adopted project minimum/maximum as a **separate constraint fact**, initially evidence-only. Keep existing exact `MatrixObservation` and `typed-fact-v1` behavior unchanged. Do not put a lower-bound endpoint into `value` and run existing DECREASE/LOWER_BOUND comparison as though the PD stated an exact dimension.

First useful slice: retain the adopted door-opening minimum from F0151 p22 as a scoped, unbound project-constraint candidate with original text and geometry. No automatic door identity, norm applicability, qualified finding or matrix coverage. Actual comparison requires an exact RD dimension for the same accepted entity and measurement basis, plus reviewed applicability. The investigated pages do not establish that pair; an enabled ODI atom is not justified yet.

This follows the existing target contract: `docs/architecture/07_RULES_AND_EVIDENCE.md:62` explicitly requires ranges and «не менее» to be separate typed constraints. The same document's lines 3 and 80 keep the task within PD/RD/ID discrepancies; a project statement quoting an SP is not an external norm-administration service.

## Verified runtime entrypoints

Line numbers refer to the current shared working tree at review time; later edits can shift them.

| Layer | Entrypoint | Current behavior / required future change |
|---|---|---|
| Public observation contract | `packages/contracts/src/matrix-execution.ts:12`, `:59`, `:90` | Scalar observation; atomic results reference observation IDs and scalar values; execution schema v1. No relation or constraint kind. |
| Worker lexical extraction | `services/worker/inspector_worker/matrix_engine.py:506`, `:523`, `:536` | Anchored exact numeric grammar; line/table adapters; ranges and alternatives abstain. Add a separate narrow constraint grammar, not optional qualifier stripping in `_patterns`. |
| Worker normalization and identity | `matrix_engine.py:899`, `:1188` | Normalizes raw numeric token; observation ID hashes source/stage/page/block IDs/attribute/value/unit and optional context fragments. **Relation is absent.** |
| Worker comparison | `matrix_engine.py:1039`, `:1065`, `:1107` | Existing LOWER_BOUND/UPPER_BOUND use a registry threshold and first check the exact PD baseline against it. This is not a PD-authored bound comparator. A negative additionally needs `RULE_SCOPE_COMPLETE`. |
| Independent source boundary | `apps/api/src/matrix-execution.ts:36`, `:64`, `:89`, `:118`, `:138` | Observation schema is passthrough; boundary rechecks original text, exact evidence boxes, identity and independent grammar. Unknown relation metadata must not acquire semantics through passthrough. |
| Independent comparison and coverage | `apps/api/src/matrix-rule-verifier.ts:213`, `:357`, `:388`, `:431` | Revalidates typed facts, recomputes comparisons and all-132 coverage. New bound comparator needs an independent TS implementation and purpose gate. Fact count alone cannot change coverage. |
| Alternate typed-fact family | `services/worker/inspector_worker/fact_comparison.py:20`, `:55`, `:212`; `apps/api/src/fact-family-proposals.ts:115`, `:501` | `typed-fact-v1` hashes **all fields except factId**, unlike selective MatrixObservation ID. But scalar numeric normalization/comparison still has no bound semantics. Including relation in that hash alone does not make the comparator correct. |
| Portable evidence selector | `apps/api/src/matrix-fact-scope.ts:14`, `:125`, `:145`; `services/worker/inspector_worker/matrix_fact_scope.py:66`, `:127` | Selector-v1 hashes listed value/raw/evidence fields and entire text artifact. Relation/constraint kind/applicability syntax are absent. Both implementations must dispatch explicitly on a new selector version. |
| Scope target and binding | `packages/contracts/src/matrix-fact-scope.ts:25`, `:37`, `:50`; `apps/api/src/matrix-fact-bindings.ts:22`, `:35` | Review references immutable execution, observation/evidence/text-artifact hashes and exact rule version. No whole-file fallback when FACT_BINDINGS is present, even empty. Preserve this invariant. |
| Human proof editor | `apps/web/src/MatrixFactScopeEditor.tsx:145`, `:206`, `:226`, `:284` | Rules must exist and be enabled; explicit identity and separate proof references required. NORM_APPLICABILITY proof is for registry thresholds, not author-project adoption. Editor cannot mint a constraint or fill a missing predicate. |
| Durable pinning | `apps/api/src/matrix-execution.ts:14`, `:24`; `services/worker/inspector_worker/durable_matrix.py:15`; `apps/api/src/postgres-repository.ts:12027` | Profile/config hash pins registry, Python engine and Python fact-scope source; worker checks hashes before execution and API checks result profile/config. New standalone extractor/comparator modules must also be explicitly pinned. |
| UI and confidence | `apps/web/src/MatrixExecutionPanel.tsx:37`, `:60`, `:155`, `:175`; `apps/api/src/matrix-execution.ts:273` | UI currently shows bare scalar values. New rendering must say «Проектное ограничение: ≥ 0,9 м», preserve raw text and show entity/applicability gaps. Unknown confidence stays unknown; structural qualification is not 80% probability. |
| Frozen submission | `apps/api/src/matrix-execution.ts:280` | Current diagnostic export serializes scalar pd/rd values and deliberately returns abstention. Never export a constraint endpoint as an exact scalar; preserve old snapshots byte-for-byte. |

## Actual source analysis

All three sources/pages passed T22's TRAIN_PUBLIC + INCLUDE + PUBLIC_TRAIN gate. T27 copies the previously verified canonical objects and rechecks declared source SHA, original page and gate. It does **not** claim a new gzip/PDF hash verification. Full original lines/boxes and prior compressed SHA are in `prior-evidence-receipts.json` and the copied page files.

### F0125 p8: corridor alternatives, not one exact width

Object `OBJ-NOVOSLOBODSKAYA`, PD/**OTHER**. Source SHA `570a18c01ec7325a6608546f71d6d4da23ddb07422937bef2be4ec6a3b6e42e3`; original compressed page SHA `50a4ed424753d3f83ba89cd86e7c4b2705d81c0afaf7c1d72a838278035b9e19`.

Block 2 line 2 states first-floor corridor width **not less than 1.8 m**, box `[85078,696064,548719,707226]`. The same sentence continues through local narrowing **1.5–1.2 m**, passing pockets at least 2 m long and combined corridor/pocket width at least 1.8 m. Lines 6–7 allow at least **1.4 m** under a calculation for at most one wheelchair user on the floor. Later lines introduce approach width and turning-zone dimensions; these are different attributes/entities.

Therefore, `GE 1.8` cannot be promoted as the applicable bound for every corridor. A reviewed entity alone is insufficient: the local-narrowing regime, passing-pocket provision and occupancy/calculation predicate must be resolved. A flat GE fact may be retained only as an unresolved candidate with the entire governing paragraph; executable comparison remains abstain. No choosing the largest, smallest or first convenient number.

### F0151 p22: author-adopted door minimum, unidentified doors

Object `OBJ-TYUMENSKAYA-5-GOLD-SEED`, PD/**OTHER**. Source SHA `afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a`; original compressed page SHA `bcd26cf1d52e1fb35421993159eed175de887df8e8fd6f4cf759aa4ca6a897ab`.

Original blocks 0–3 form the sentence about openings in walls/partitions through which a wheelchair user can move, and exits to staircases/lift halls. Block 2 says **«принята не менее 0,9 м в свету при»**, box `[85085,719536,556327,733576]`; block 3 begins **«открытом дверном полотне.»** This explicitly adopted project minimum is **GE 0.9 m, clear opening with leaf open**, not a measured 0.9 m leaf width. The rest of block 3 starts a different statement about thresholds and must not be lost or treated as width evidence.

A narrow extraction can retain the complete first sentence and surrounding original line text. It cannot identify a unique door or prove which RD mark it governs. It also cannot substitute 0.9 for catalog ODI-117's stated 1.5 m or assert that catalog threshold applies. A future project-minimum comparison needs its own declared purpose; it cannot silently redefine ODI-117.

### F0151 p24: cabin alternatives, minimum ordered pairs

Same source/object/stage. Original compressed page SHA `4c6b46097d6ef152cccae09ccdd8ab2fc687ef8cac513a7132530ed28c0d38b9`.

Blocks 14–15 introduce cabin dimensions in plan **«не менее, в м»**; block 16 gives **central toilet placement: 2.2 × 2.25**, box `[120480,358570,438753,372610]`; block 17 gives **right/left placement: 1.7 × 2.2**, box `[120480,334449,468026,348489]`.

These are conditional minimum dimension pairs, not two measurements of one cabin, not an area, and not interchangeable x/y assignments. An executable scalar GE extractor must abstain. Future support needs layout-specific alternatives, accepted side/measurement orientation and a particular cabin identity. Multiplication into area loses the failing-side condition; rotating/swapping sides needs explicit semantics, not sorting numbers.

## Minimal representation and compatibility

Prefer a separate immutable artifact, proposed `matrix-project-constraints-v1`, before any comparison-enabled execution version. Old `matrix-execution-v1` observations/results remain exact-only; existing runs and exports keep their hashes. Read clients may learn a new optional artifact endpoint without changing existing endpoints. Old workers never receive the new provider profile. Do not append opaque constraints to passthrough v1 and assume that an old API validated them.

Proposed strict fact payload:

```ts
type ProjectConstraintFactV1 = {
  schemaVersion: "matrix-project-constraint-v1";
  id: string;
  kind: "PROJECT_AUTHORED_CONSTRAINT";
  relation: "GE" | "LE";
  attribute: string;
  limitValue: string; // normalized decimal endpoint; never exact measured value
  canonicalUnit: string;
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD"; // first grammar only
  pageNumber: number;
  extractorVersion: "matrix-project-bound-prose-v1";
  primaryFragments: OriginalFragment[];
  qualifierFragments: OriginalFragment[];
  applicabilityFragments: OriginalFragment[];
  applicabilitySyntax: { componentClass: string; measurementBasis: string;
    predicates: Array<{ key: string; rawText: string }> };
  applicabilityStatus: "UNREVIEWED";
};
```

`OriginalFragment` retains original block/line, exact raw text, original milli-point box, normalized visible box and, where selecting a sentence within a line, explicit start/end offsets tied to the entire original line. This is a proposed type, not a claim that new offsets currently exist. Preserve source frame/transform in the immutable text artifact; do not recalculate a new geometry convention. Qualifier and applicability fragments are **primary semantic evidence**, not optional unverified table decoration. A removed «не менее», «при открытом полотне» or exception changes meaning and identity.

Keep EQ in existing exact observations. If a later unified `EQ|GE|LE` union is useful, introduce an explicit new fact/execution discriminant with strict API validation; legacy missing relation maps to EQ only for validated legacy exact grammar. An explicit GE/LE reaching the legacy exact path must be rejected. Unknown relations and combinations fail closed. No EPS rounding: use existing Decimal/rational normalization and unit dimension checks.

Applicability syntax records what the author wrote, not a verified fact that a door belongs to that class. The authenticated review is separate and supplies entity, approved revision, applicability reference and measurement basis for this exact constraint. It cannot create the GE/LE endpoint, choose a cabin alternative or import an external SP threshold. External-norm constraints, if ever implemented, need a separate provenance kind and versioned authoritative norm source; excluded from this first slice.

## Hash, version and review rules

1. Keep legacy observation-ID preimages and selector-v1 unchanged. Adding an optional default EQ into every old hash would invalidate existing immutable IDs/reviews.
2. New constraint ID uses a **versioned domain-separated hash** over strict parsed semantic/evidence payload excluding only `id` and derived presentation/review. Include relation, limit/unit, extractor policy version, source SHA/stage/page, ordered original fragments and applicability syntax. Do not include reviewer identity or invented entity; those remain append-only review provenance. Define one exact portable JSON policy and shared Python/TS goldens before saving.
3. Introduce `matrix-constraint-selector-v1` and a discriminated target `factKind:"PROJECT_CONSTRAINT"` with `constraintId`, `evidenceHash`, `textArtifactHash`, plus immutable origin artifact hash/check. Selector includes relation, endpoint and **all** qualifier/applicability fragments. Do not squeeze constraint IDs into selector-v1 or reuse an observation binding by string coincidence.
4. New review schema/envelope must distinguish observation vs constraint targets; validate original immutable artifact and actor/object/manifest/source provenance server-side. Bind both the constraint's applicability and RD exact observation with separate reviewed targets. Keep exact rule ID/version matching and disabled whole-file fallback. Existing `matrix-fact-scopes-v1` keeps working unchanged for observations.
5. Future comparator policy gets its own stable rule ID/version, explicit `purpose:PROJECT_CONSTRAINT_VALIDATION`, expected kind/relation set and actual kind EQ. Never change an existing LOWER_BOUND/DECREASE definition under the same ID/version. Include all new Python helper hashes and typed policy definitions in release/config pinning; update independent TS allowlists and shared goldens together. Reprocessing creates a new run/config; it never rewrites old machine artifacts or ports review approvals automatically.

## Comparison semantics: do not manufacture NO_VIOLATION

Assume all source revision, identity, measurement basis, quality and applicability gates passed. First implementation should support only PD GE/LE versus one RD **exact** scalar. Any scoped alternative, unresolved exception, wrong stage/entity or duplicate competing fact remains abstain.

| PD constraint | RD fact | Honest conclusion |
|---|---|---|
| GE 1.8 m | EQ 1.7 m | Breaches this applicable project minimum; candidate for a new project-constraint rule. |
| GE 1.8 m | EQ 1.8 or 1.9 m | Satisfies this minimum only. Does not prove absence of reduction from an unknown exact PD dimension. |
| LE 0.17 m | EQ 0.18 m | Breaches this applicable project maximum. |
| LE 0.17 m | EQ 0.17 or 0.15 m | Satisfies this maximum only. Does not prove every project requirement was preserved. |
| GE 1.8 m | GE 1.5 m | RD requirement may be weaker, but RD exact dimension is unknown. First profile abstains; no measured-shortfall claim. |
| Any bound | Missing, range or conditional alternatives | Abstain with specific missing applicability/actual-fact reason. |

The current official catalog check and a future authored-bound check have different purposes. A bound-satisfied outcome must **not** flow into legacy `NEGATIVE_VERIFIED`, a catalog `NO_VIOLATION` export, full coverage or absence of project decrease. Initially use a separate result schema/status, e.g. `SATISFIES_THIS_PROJECT_BOUND`, with an explicit scope label; keep catalog prediction ABSTAIN. Even a future scoped negative needs separately verified completeness and a rule whose entire trigger is exactly this constraint. Per-fact review v1 intentionally cannot certify `RULE_SCOPE_COMPLETE`/`PARAMETER_SCOPE_COMPLETE`.

Do not multiply confidence by this logical outcome. A valid constraint comparison is a logical statement over accepted premises, while a calibrated probability requires measured calibration. Existing null confidence remains null; inspector confirmation stays separate.

## Smallest justified grammar and order of work

**First grammar: F0151 door-minimum statement, extraction-only.** Four original consecutive single-line blocks on one page, exact source anchor/continuation corresponding to blocks 0–3, exact declared boxes, coherent same-column reading order, one literal `принята не менее <NUM> м в свету при открытом дверном полотне` construction. Preserve the entire first sentence and the unused remainder of its last original line. No generic cross-page paragraph assembly, column join, range, optional exception deletion, unit guessing or synthetic label. Derive the geometry tolerances from those original four boxes and validate adversarial nearby lines before claiming the grammar implemented; do not borrow fence grammar's same-block rule or invent passing tolerances here.

Its result is an **unreviewed project-constraint candidate**, general class `ACCESSIBLE_ROUTE_DOOR_OPENING`, measurement basis `CLEAR_OPENING_WITH_LEAF_OPEN`, GE 0.9 m. It is not a per-door fact and has no enabled catalog atom. Exclude F0125's corridor alternatives and F0151 p24's cabin pairs from this scalar grammar; retain their visible source snippets and exact abstention reasons.

Implementation order: strict constraint/evidence contract and hash goldens; independent source grammar; immutable evidence-only persistence/UI; explicit authenticated applicability binding; then a real paired PD/RD acceptance fixture and separately approved project-constraint comparator policy. This keeps the first slice useful without claiming additional matrix implementation. No enabled ODI-116/117/119 atom is justified by the examined pages alone.

## Meaningful regression tests for that future slice

1. Legacy exact fixtures preserve byte-identical IDs, selector hashes, results and frozen exports; non-EQ metadata on a legacy exact path is rejected.
2. Actual F0151 p22 yields one GE 0.9 candidate with four original lines, all original boxes and open-leaf condition; source page/block remapping without provenance fails. It never yields EQ 0.9, identity or approved status.
3. Delete/change `не менее`, flip GE to LE, alter endpoint/unit/predicate/fragment order/offset/source SHA/bbox or remove the open-leaf condition: independent TS recomputation rejects the artifact or produces a different semantic ID. Old target/review never reattaches.
4. Actual F0125 p8 remains abstain for executable corridor comparison with unresolved 1.8/1.5–1.2/1.4 regimes; review of a door/corridor ID alone cannot select the regime. Actual F0151 p24 remains abstain for scalar geometry; neither side sorting nor area conversion qualifies it.
5. Source with merely a quoted SP, imperative recommendation or generic legal excerpt cannot become `PROJECT_AUTHORED_CONSTRAINT` through a numeric match. Test adopted-project wording separately.
6. GE/LE versus EQ truth-table boundaries, comma decimal and 900 mm equivalence use exact arithmetic. RD GE/LE, ranges, two candidate dimensions and incompatible clear-width/leaf-width bases abstain in the first profile.
7. Same numeric text in another object/source/stage/revision/entity does not bind; empty binding list disables whole-file fallback. New selector hashes agree across Python/TS, including Unicode, ordered fragments, raw whitespace and geometry changes.
8. A bound-satisfied result cannot produce catalog `NO_VIOLATION`, `NEGATIVE_VERIFIED`, an extra successful matrix comparison or full parameter coverage. Missing/failed/not-applicable/unsupported outcomes remain distinct.
9. UI and download show `≥`/`≤`, original source and applicability gaps at desktop/narrow widths; bound endpoint never appears as bare measured value. Null confidence never becomes an 80% warning. Existing immutable exports remain unchanged after review/reprocess.
10. When persistence is implemented, disposable PostgreSQL test proves append-only artifact/review, wrong-origin rejection, concurrent stale-review refusal and restart readback; a real matched PD/RD fixture remains required before enabling a comparator.

No tests were added or executed for this design packet. Evidence integrity checks only: three reused canonical objects, matching declared source/page/gate, and checksums of newly written research files.
