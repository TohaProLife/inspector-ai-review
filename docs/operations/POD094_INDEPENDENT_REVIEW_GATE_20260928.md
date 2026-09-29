# POD-094: independent original PDF review gate, 28.09.2026

## Scope

`apps/api/src/pod094-waste-chain-proposals.ts` independently replays the pure worker's review-only proposals from complete page-word artifacts. It requires the exact SHA, byte length, page count, object, stage, section, and `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN` manifest identity of the original public PDFs. Scanned pages are fixed: F0189 p99–100 and F0071 p5. It replays all proposal roles, source-local quantities, page word counts/layout hashes, reason codes, proposal hashes and final content hash. It rejects changed locators, false zero, cross-object source substitution, hidden data, typed facts, findings, `actualTransfer`, and `contractLimit`. Contract price remains an excluded cell; `350,00` is only an orientative contract candidate.

This pure check does **not** establish independence of the supplied PyMuPDF word order. The async original gate obtains a separate complete API-owned Poppler page-word inspection and requires a unique full-page text-and-bbox bijection before accepting the replay. This is a review gate only; no save, seal, release, GET, UI, or Compose consumer uses it.

## Exact original results

Both files in `/tmp` matched the public manifest SHA and byte length. The Python worker result replayed exactly on both originals, with F0189 two estimate candidates and F0071 one orientative contract candidate. Every result remained `ABSTAIN`, `findingCount=null`, `parameterCoverage=null`, `actualTransfer=null`, and `contractLimit=null`.

Independent full-page Poppler comparison **failed closed**:

| Source/page | PyMuPDF words | Poppler words | Result |
| --- | ---: | ---: | --- |
| F0189 p99 | 422 | 423 | `WORD_COUNT_MISMATCH` |
| F0189 p100 | 388 | 393 | `WORD_COUNT_MISMATCH` |
| F0071 p5 | 365 | 365 | `WORD_TEXT_OR_BOX_UNMATCHED` |

Poppler segmentation or geometry cannot be equated with PyMuPDF by count alone. No complete unique text-and-bbox bijection exists on these inspected pages under the current provider profile. Therefore the async gate returns `FULL_WORD_BIJECTION_FAILED` for both files. It cannot approve independent page words, proposal counts, absence, or promotion to a durable result. Do not bypass this with selected-word corroboration.

## Local verification

`npm exec --workspace=apps/api vitest -- run test/pod094-waste-chain-proposals.test.ts --reporter=verbose`: 4/4 PASS, including a synthetic contract row, both original PDFs, source and result tampering, false zero, source mix, and explicit fail-closed comparison. Original-file tests skip when `/tmp/inspector-pod094-F0189.pdf` or `/tmp/inspector-pod094-F0071.pdf` is absent. `npm exec --workspace=apps/api tsc -- -p tsconfig.json --noEmit` and `git diff --check` passed.

Next gate requires a genuinely independent complete provider with exact raw word list/index evidence, or an audited alternative that fully reconciles the three page differences. Subject-matter checks still need approved source editions, object/section context, a real PD/RD and batch link, and transfer talons. No mass comparison or finding is supported by these pages.
