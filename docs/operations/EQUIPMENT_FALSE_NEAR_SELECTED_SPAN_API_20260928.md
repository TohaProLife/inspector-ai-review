# Equipment false-near selected-span API proof

`equipment-false-near-selected-span.ts` is a pure, offline API verifier for two
ineligible navigation leads. It is not wired into rule evaluation, release,
durable storage, GET, or UI.

| Lead | SHA-pinned original public PDF | Page / phrase | Independent result |
| --- | --- | --- | --- |
| `IOS2-073` | `F0165`, SHA `f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64` | p.26, `Насосная установка для пожарной системы (спринклеры)` | Six PyMuPDF words align with six Poppler words; largest exact-coordinate edge difference `0.000103 pt` before millipoint rounding. |
| `ODI-115` | `F0160`, SHA `72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd` | p.37, `ЩЛ - щит лифта (подъемника МГН);` | Six PyMuPDF words align with eight Poppler tokens. Poppler splits `(` and `);`; largest edge difference `0.533068 pt` before millipoint rounding. |

The verifier requires the exact `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`
manifest metadata, original PDF SHA and size, physical page number, known
phrase and region, and a worker `ABSTAIN` packet with one
`INELIGIBLE_FOR_PARAMETER_FACT` proposal. It checks worker and proposal hashes,
then re-extracts the page from the original PDF using API-owned Poppler
`pdftotext -bbox-layout`. The provider must be exactly
`api-poppler-pdftotext-bbox-layout-v1@25.03.0`. A different Poppler version,
including the current homeserver API image's `25.12.0`, fails closed until that
version receives its own source audit.

Poppler must find the entire phrase exactly once on the selected page after
NFC normalization, Cyrillic casefolding and removal of whitespace. Punctuation
remains significant. Every worker token must align with one or more consecutive
Poppler tokens; grouped text, line geometry and each bbox edge must agree within
`0.6 pt`. The aggregate phrase bbox receives the same check. Duplicate phrase,
changed context, mismatched source, page, version, text or geometry rejects the
packet.

An accepted receipt says `SELECTED_SPAN_ONLY`,
`PAGE_SCAN_COMPLETENESS_UNVERIFIED`, `ABSTAIN`,
`INELIGIBLE_FOR_PARAMETER_FACT`, `typedFact=null`, `findingCount=null`,
`parameterCoverage=null`, and `durableSaveAllowed=false`. Worker `wordCount`,
`wordLayoutSha256`, and `wordIndex` are pinned producer metadata, not independently
proven full-page identities. Presence of an excluding phrase cannot establish
absence of another context on the page, a drinking-water pump, an installed
lift, source approval, or a PD/RD comparison pair. Full-page Poppler checks
remain failed for these originals.

Focused verification: API TypeScript typecheck and eight focused Vitest cases
passed locally. Two cases use the SHA-checked original PDFs at `/tmp` and
independent Poppler 25.03.0 re-extraction; if the PDFs are unavailable in a
different environment, those two cases are reported as skipped.
