# T39 — durable PRESENCE_SET: read-only design

Status: **GO for a new typed closed-inventory review boundary and a controlled bounded predicate; NO_GO for promoting the existing offline evaluator unchanged, or claiming eight executable public comparisons.** No runtime, registry, source review, stand, or browser changes in T39. No new FTS, page extraction, archive reads or downloads.

## What exists

The exact offline pack contains eight `PRESENCE_SET` codes. Each current matrix registry entry has **zero atomicRules**, gap `ENUMERATION_COMPLETE_AND_NEGATIVE_SCOPE_REQUIRED`. The synthetic offline adapter can produce `REVIEW_REQUIRED`, always with `REVIEW_ONLY` and `NON_EXECUTING_ABSTAIN`; this is not durable execution or coverage.

| Code | Catalog-bounded missing item / physical scope | PD → RD drawing categories | Important restriction |
|---|---|---|---|
| AR-053 | Damping tape / specific partition–slab joint | AR → AR | Generic sound-insulating gasket is in lead vocabulary but is not automatically this trigger. Best first controlled atom. |
| ODI-122 | Warning tactile strip / individual stair or door approach | ODI → GP/AR | PD section requires an explicit authenticated category resolution; plan/placement inventory, not a bare mention. |
| ODI-123 | Staff/help call button / identified accessible toilet or entrance | ODI → SS | Two-way communication mention is not automatically a call-button implementation. |
| ODI-120 | Fixed/folding rails / individual accessible toilet | ODI → AR | Pin precise missing-member policy, not an inferred equivalence of rail types. |
| SPZU-039 | Open tray / closed wall drain in an identified drainage zone | SPZU → NVK | Both manifest category resolutions are unresolved in the offline policy; substitution needs a separate reviewed policy. |
| POD-092 | Protective measures for a named live utility in a machine-work zone | POD → PPR | Utility **and** work-zone identity, current/live state and applicability; no arbitrary absence of one label. |
| POD-095 | Hydro-spray / protective screens in a named wall-demolition zone | POD → PPR | Water cannon is an extra lead vocabulary feature, not an automatic catalog-equivalent requirement. |
| ZU-129 | Resource meters / same carrier and building/apartment accounting scope | ZU → IOS1/IOS2/OV | Do not compare one carrier with another or shared-building inventory with apartment inventory. |

Order above is implementation complexity, **not evidence that a real public PD/RD complete-inventory pair exists**. This packet inspected code only. It authenticates no new source inventory or real same-member pair.

Code anchors:

- `presence_family_candidates.py:31` declares the exact eight-code set; extraction at `:260` only recognizes positive source mentions, explicit scope tokens and conditional/negated-line rejection. A mention never closes an inventory.
- `candidate_family_comparison.py:198–253` binds a separately reviewed enumeration anchor to an exact observation, source SHA, artifact SHA, page and locator. `:263–331` requires CURRENT/APPROVED source review and linked facts, but remains offline caller-supplied review data.
- `family_rule_evaluator.py:247–267` requires completeExpected/completeActual/sameSearchScope and fact/manifest binding, then subtracts literal member strings. This is the reusable **mathematical idea**, not sufficient durable authentication.
- `matrix-fact-scope.ts:45–47` deliberately rejects RULE_SCOPE_COMPLETE/PARAMETER_SCOPE_COMPLETE in current per-fact contexts. Existing strict context DTOs have no inventory members, inventory provenance, closure regions or completeness version. `matrixSourceScopeSchema` only supports existing legacy/per-fact shapes.
- `postgres-repository.ts:2430–2439` already provides the inspector lock, latest-review optimistic hash and source SHA check suitable for a new explicit review variant. Current fact-target validation authenticates scalar observations, not new inventories.
- `matrix_engine.py:1237` / `matrix-rule-verifier.ts:436` implement scalar/category comparisons; SET must have a separate branch/type and must never reach Decimal/rational conversion.

## Why directly wiring the offline API is unsafe

Its caller is explicitly responsible for verifying source bytes and locator. `_verified` accepts a status plus reference; `_set_observed` checks casefold substring membership in one fact's rawText, not feature vocabulary, token boundaries, negation, complete source scope or an authenticated actor's stored decision. Synthetic probe records that expectedMembers=`['л']` and actualMembers=`[]` can yield a review proposal once the synthetic caller asserts completeness. This is **not a production exploit claim**: the module is intentionally offline and non-executing. It demonstrates why those booleans and references must not become production absence authority.

Other gaps: exact one-PD/one-RD fact selection rejects multiple independent item mentions as ambiguity; reviewed enumeration still requires an existing positive lead, so absence of every RD item cannot be represented by silence. Literal member subtraction is case-sensitive even though its substring check is casefolded. Reviewed member synonyms cannot be compared as raw strings. Unknown alternatives cannot be classified as missing measures automatically.

## Smallest useful contract

Introduce an explicitly versioned inventory review, **not** additional free-form context keys or a relaxation of current completeness protection. Proposed new `matrix-fact-scopes-v2` retains current bindings and adds typed `presenceInventories`; v1 remains byte/read compatible. Use existing `matrix_scope` JSON storage with a strict new union variant if repository compatibility permits; no migration is required just to store its JSON. Each new inventory is distinct from a scalar observation/fact and must not invent a scalar target ID.

Human input per inventory:

- exact check/profile/artifact content-hash target, original source id/SHA, full committed text-artifact hash;
- pinned catalog rule/version and feature-policy version; physical scope role plus componentKey, zoneKey, operatingModeKey, measurementBasisKey;
- bounded source-authored inventory header/scope fragments and explicit search-page/region list (page/frame/exact integer boxes); structural closure reason and basis reference;
- every known member as canonical pinned feature key plus **all exact original positive fragments** and original raw text; unknown/conditional/alternative rows are explicit unresolved items, never discarded;
- closure status `UNKNOWN | REVIEWED_COMPLETE`, with an explicit typed empty-inventory case requiring a genuine scoped source anchor. Empty means an inspector-reviewed closed inventory of the selected scope; it is never generated from zero search hits.

Server output additionally binds object/inputManifestHash, immutable inventory body/content hash, sourceReviewContentHash, actor and saved decision. Human DTO omits its own review hash to avoid circular self-hashing. A later PD or RD review creates a new hash and invalidates qualifications in a **new** run; old runs are immutable. Saving UNKNOWN classification is allowed, qualification is blocked. Deletion/withdrawal/restoration creates new decisions under the existing inspector lock and expectedReviewHash guard.

Validation before acceptance:

1. Authenticate full committed source/artifact bytes and original frames. Resolve stage from actual saved source/page interpretation; PD versus RD only. Keep source section OTHER/unknown until explicit approved category interpretation. No filename inference.
2. Validate every fragment against source raw text, codepoint range, line box and page; use the frozen geometric binder only for an actual table. Binder success establishes geometry, **not** closure, row meaning, identity or approval.
3. Reconstruct all recognized catalog feature mentions within declared regions independently. Reject duplicate/conflicting identity, unsupported/conditional/negative/alternative content, omitted recognized rows, mixed sources, coarse/OCR-required pages, clipped tables and ambiguous continuation. Limits must be explicit and portable. A complete selected page is not a complete building inventory automatically.
4. Require CURRENT+APPROVED decisions for both source snapshots, same object/manifest/linkGroup and exact authenticated latest saved review hashes. Same-source reviewed scope plus typed cross-source member/entity identity must match; a whole-file entityKey/reference cannot substitute.
5. Require both inventories `REVIEWED_COMPLETE`, identical pinned feature universe and search-scope identity. Compute canonical `expectedFeatureKeys − actualFeatureKeys`; exact policy determines which missing keys trigger. Preserve original membership evidence and closure evidence separately. No canonicalization by arbitrary casefold substring.
6. Missing closure/identity/category/source approval/stale hash => UNKNOWN/CLARIFICATION_REQUIRED, qualified=false, probability=null. Even a positive missing-item candidate is an absence claim and therefore needs actual closure. Equality never creates a broad negative certificate. No global RULE_SCOPE_COMPLETE bypass.

### First atom

After this boundary exists, implement **AR-053: PD-declared DAMPING_TAPE missing from an explicitly reviewed complete RD inventory of the same partition–slab joint**, with AR/AR categories and bounded feature policy. It compares required measure membership, not acoustic performance or material equivalence. Sound-insulation gasket alone is not treated as tape. Initially use truthful synthetic PD/RD complete-table fixtures; a real public atom is not accepted until its actual pair, applicability and complete source scope are reviewed. Activate one partial atom only after both independent implementations and durable gates pass; do not mark all eight codes implemented from a generic set function.

## Profile boundary and independent reconstruction

Keep accepted profiles v1–v4 and their definitions/config hashes unchanged. A future profile (working name `matrix-text-facts-presence-v5`, adapter5) must pin the new inventory source normalizer/parser, feature policy/catalog hash, proof schema, pure Python comparator and independent TS validator. The exact profile name is a proposal, not registered by this packet.

Prefer a separate immutable `presenceInventories`/`presenceComparisons` sibling for the first REVIEW_ONLY delivery. That demonstrates authenticated closure and stale-review behavior without altering scalar observation payloads/IDs, results or coverage. For eventual executable status, add a typed SET path in engine, independent TS verifier, registry validator and coverage logic together; evidence-only sibling alone cannot reduce UNSUPPORTED. `outputCount` stays tied to the existing declared stage semantics; sibling items do not masquerade as scalar facts.

TS must reconstruct inventory membership and closure targets from authenticated original artifacts and committed review snapshots, recompute canonical content/IDs, then compare exact output. A worker's recomputed ID or self-declared completeness boolean has no authority. Use codepoint ordering/ranges and strict portable canonical JSON; reject extras, duplicates, missing members, reordered source fragments, non-scalar/native input, unsafe numbers and forged full-artifact hashes.

## Proposed ownership and acceptance gates

- Contract owner: new `matrix-presence-inventory.ts`, strict new scope variant and reviewed inventory target read DTO; no weakening of old schemas.
- Python owner: new `presence_inventory.py` (bounded source reconstruction) and `presence_inventory_comparison.py` (pure set math over authenticated typed inputs), dedicated full fixtures/goldens/native tests; explicit new-profile durable dispatch/pins only.
- Independent API owner: new TS source-inventory reconstructor/comparator and validator; repository review save/authentication, immutable stage persistence/readback and new-profile dispatch.
- UI owner: original PDF plus closure regions/member rows, explicit UNKNOWN/complete selection and same-member identity; no user-entered hashes. Withdrawal must be visible and auditable.
- Final executable owner: dedicated AR-053 atom/SET verifier path only after review boundary passes; future seven codes get their own narrow feature/identity/catalog policies.

Meaningful tests: exact original member fragments and whole artifact; PD tape→RD other listed measure; equal sets; actual scoped empty set versus no artifact; subset/superset and duplicate aliases; negation/future/alternative; omitted/interleaved row; unsupported member; geometry/Unicode range forgery with recomputed IDs; source/manifest/stage/category mismatch; same labels in different joint/zone; current/approved withdrawal; stale or substituted review hash; optimistic concurrent save and idempotent retry; pin drift before download; old v1–v4 policy/config and scalar execution byte equality; immutable old check after review/restart; no qualification and no coverage from a lead, unresolved closure, empty search or EVIDENCE_ONLY sibling.

Stop condition: no reviewed complete actual inventory for one matching physical scope means no absence result. Build the typed review boundary and controlled regression evidence; do not scan repeatedly to manufacture a real pair or increase the eight-code counter.
