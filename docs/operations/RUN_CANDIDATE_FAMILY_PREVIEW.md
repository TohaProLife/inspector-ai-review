# Run-scoped preview for 47 candidate codes

`inspector_worker.run_candidate_family_preview` reads committed source decisions
and immutable `document-text-v2` artifacts for one run. It uses catalog-pinned
candidate rules and three pinned label packs (31 numeric, 8 class, 8 presence).
It emits one `ABSTAIN` row per code. Exact line matches are review leads, not
typed facts, findings, confirmed omissions, or parameter coverage.

## Admission and provenance

- `execute_durable_candidate_family_preview(lease, attempt)` checks source
  decisions against the committed source SHA and reviewed `sectionCode`, then
  downloads the fenced text artifacts. A reviewed section needs a decision
  reference. The API must verify that the lease and artifacts belong to the
  current run.
- `evaluate_run_candidate_family_preview(object_id, input_manifest_hash,
  sources, text_artifacts)` rejects malformed or duplicate sources, cross-object
  sources, SHA mismatches, invalid `document-text-v2` page quality and geometry,
  and page-stage maps outside the artifact.
- Lexical scanning requires an approved, current source; a resolved drawing
  `sectionCode`; and a single stage or a complete reviewed `pageStages` map.
  A coarse section such as `KR` cannot prove a `KJ` or `KM` drawing mark.
- Only `TEXT_LAYER_CANDIDATE` pages are searched. `OCR_REQUIRED` pages are
  counted and reported for targeted OCR. No missing label means a missing
  project element.
- Numeric and class matches require one complete physical line. A repeated
  numeric or class label on the same page is ambiguous and dropped. Presence
  matches require the feature and all configured scope tokens in one line;
  negated, conditional, and future-tense lines are rejected.
- Class labels are resolved from the spelling actually matched in the source
  line. If two configured aliases case-fold to the same spelling, the line is
  dropped rather than assigned to one alias.

## Result contract

Top-level schema `candidate-family-preview-v1` includes `inputManifestHash`,
`objectId`, `scope: RUN_COMMITTED_SOURCES`, `purpose: REVIEW_ONLY`, SHA-256 hashes
of the candidate rules and three label packs, exactly 47 sorted `codeRows`,
`findingCount: null`, `parameterCoverage: null`, `outputCount: 47`, and
`contentHash`. The hash is SHA-256 of canonical UTF-8 JSON with sorted keys,
compact separators, `ensure_ascii=False`, and no `contentHash` field.

Each row contains `parameterCode`, `family`, `ruleId`, `status: ABSTAIN`, sorted
`reasonCodes`, `eligibleSourceCount`, `textScannedPageCount`,
`ocrRequiredPageCount`, `leadCount`, and at most 16 `candidateLeads`. Lead
overflow is explicit as `LEAD_LIMIT_REACHED`.

Each lead uses schema `candidate-family-run-lead-v1` and includes
`sourceFileId`, `sourceSha256`, canonical `artifactSha256`, `objectId`, reviewed
stage/section/revision/approval, page number, block text SHA-256, full line text,
value or feature, and a locator with block and line index, original character
span, and block bounding box in PDF bottom-left milli-points. `leadSha256` is
the canonical SHA-256 of the lead without its own hash. The span points into
the original `document-text-v2` block, so a verifier can reconstruct the
matched substring.

Integration must store this as a separate review-only run output. Do not feed
leads into the fact comparer, finding generator, or coverage counters. Typed
facts need entity, quantity meaning, unit, source revision, and review proof;
cross-document comparisons additionally need a reviewed link and compatible
measurement basis.

Focused test command:

```bash
PYTHONPATH=services/worker python3 -m unittest services.worker.tests.test_run_candidate_family_preview -v
```
