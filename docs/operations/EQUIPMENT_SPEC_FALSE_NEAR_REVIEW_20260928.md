# Equipment specification near misses: IOS2-073 / ODI-115

Two original public PDFs were read from the participant ZIP on homeserver. The
`document_manifest.jsonl` SHA-256 was
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
Each exact ZIP member was resolved from its manifest `relative_path` after
CP866 decoding. Before page extraction, the member had to be
`TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`; ZIP size, extracted byte count,
PDF SHA-256, and `pdfinfo` page count matched the manifest. Only `F0165` and
`F0160` bytes were extracted. The prior [visual page audit](NEXT_EQUIPMENT_SPEC_PUBLIC_AUDIT_20260928.md)
provides page-render SHAs and the subject interpretation; this pure extractor
verifies original PDF bytes and exact text-layer word spans, not image pixels.

| Code | Source / physical page | Exact local word span | Classification |
| --- | --- | --- | --- |
| `IOS2-073` | `F0165`, `PD/VK`, p.26; PDF SHA `f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64` | Words 2–7: `Насосная установка для пожарной системы (спринклеры)` | `FIRE_SPRINKLER_PUMP`, **ineligible** for domestic drinking-water pump fact |
| `ODI-115` | `F0160`, `PD/EOM`, p.37; PDF SHA `72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd` | Words 102–107: `ЩЛ - щит лифта (подъемника МГН);` | `LIFT_POWER_BOARD_LEGEND`, **ineligible** for installed lift/platform fact |

`equipment_spec_false_near.py` matches only the two complete, source-pinned
excluding phrases. It emits one bounded navigation proposal per page with
word boxes and hashes. It does not extract a pump model, Q/H/power, installed
platform, automation mode, quantity, or comparison fact. For both codes:
`ABSTAIN`, `typedFact=null`, `findingCount=null`, `parameterCoverage=null`.
The manifest stage/section labels do not establish a current, approved edition.
No verified PD/RD pair or equipment installation record exists in this slice.

Local verification: three focused `unittest` cases passed, including both
SHA-checked original PDFs. PyMuPDF 1.27.2.2 reported 232 words on F0165 p.26
and 878 words on F0160 p.37. Content hashes:
`1b45b7f9f0ff7557c9e557d01239f0fae0eedd676e513e62e9c1752030085fa5`
and `da64c3055868304f1903ffcbb3ffd87aa332a489a79bd8ee7df6b9c22193ac36`
respectively. This is a pure worker evaluation: no durable save, API, UI,
runtime release, positive finding, or coverage claim.

For any later parameter comparison, separately verify an approved source
edition, identical object and equipment identity, applicable system role, an
installed equipment record, and a matched PD/RD pair. A pump for fire
sprinklers cannot be silently reused for drinking-water supply; a power-board
legend cannot establish the physical lift or its operating mode.

Independent full-page Poppler 25.03.0 comparison remains fail-closed.
F0165 p.26 has 232 PyMuPDF and 232 Poppler words and matching normalized
page text, but only 184 exact text-and-box pairs; 48 boxes differ. F0160
p.37 has 878 PyMuPDF versus 1,099 Poppler words and different normalized
page text. Therefore neither pure packet qualifies for the current
independent full-word durable API gate; checking only the short excluding
phrase would not prove complete page provenance.
