# T20: scoped stair tread and riser dimensions

## Catalog and bounded implementation contract

The unchanged participant catalog AR-048 states three triggers: a change in step
count, a riser above 150 mm, or a tread below 300 mm. This slice implements only the
last two, for explicitly reviewed evacuation stairs. It does not establish the
applicability of those thresholds to every stair from a number alone.

The entry retains mixed `family=null`, its original name/trigger, and this gap:

```text
SCOPED_LITERAL_STAIR_DIMENSIONS_ONLY;STEP_COUNT_DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_PD_BASELINE_AND_ID_REQUIRED
```

| Field | Tread | Riser |
|---|---|---|
| ruleId | `matrix-ar-048-stair_tread_depth` | `matrix-ar-048-stair_riser_height` |
| attribute | `STAIR_TREAD_DEPTH` | `STAIR_RISER_HEIGHT` |
| family / threshold | LOWER_BOUND / 300 mm | UPPER_BOUND / 150 mm |
| literal label | `Глубина проступи лестницы в свету` | `Высота подступенка лестницы после отделки` |
| componentRole | `STAIR_TREAD` | `STAIR_RISER` |
| measurementBasisKey | `FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH` | `FINISHED_VERTICAL_RISER_HEIGHT` |

Both use canonical `mm`, strict comparisons, DECIMAL values, exact unit aliases
`мм/mm/м/m/см/cm`, AR source sections, and only PD_RD. Letter case is folded only
for labels. No stair count, ID path, drawing dimension chain or generic table is
implemented by these two atoms.

Each atom requires, in this order, `NORM_APPLICABILITY_VERIFIED`,
`STAIR_FLIGHT_STEP_IDENTITY`, and its own `ATOMIC_SUBRULE_SCOPE:<ruleId>`.
The atomic proof must carry the exact parameter/attribute/unit/role and four
matching identities: componentKey, zoneKey, operatingModeKey, measurementBasisKey.
Mode must be `EVACUATION`; basis must equal the role-specific constant above on
both sides, even when both sides contain the same wrong alternative. Component
and zone identify the reviewed flight and individual step or explicitly uniform
step group. The flight/step context supplies the inspector's source reference;
the extractor does not select one of the four stairs mentioned in the paragraph.

Norm proof must explicitly contain `applicable=true`, parameterCode AR-048, the
selected attribute, canonicalUnit `mm`, the exact threshold string `300` or `150`,
and a reference covering the applicable edition, scope and exceptions. This is a
binding check on an inspector decision, not an automatic legal applicability test.
Per-fact v2 bindings preserve their portable origin/rule/hash checks. UNKNOWN
source status, absent section confirmation or unmatched scope prevents a
qualified comparison. Full negative scope is never inferred from a selected fact.

The existing comparator first requires a PD baseline within the selected bound.
PD tread below 300 or PD riser above 150 yields `PROJECT_BASELINE_OUTSIDE_BOUND`.
Otherwise a candidate requires strictly RD tread <300 or RD riser >150. Equality
does not trigger; absent complete checked scope yields an abstention. Delta is
RD minus threshold, with exact Decimal arithmetic. No confidence is synthesized.

## Original-source evidence

Both originals were selected from the participant manifest only after checking
`TRAIN_PUBLIC + INCLUDE + PUBLIC_TRAIN`. No hidden answers were read. Archive
paths are restored from incorrectly marked CP437 ZIP metadata using CP866,
matched by the complete manifest-relative suffix, and required to be unique.
The remote archive was read only:
`/mnt/edberries-backup-disk/inspector-ai-dataset-20260924/archives/01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip`.

- F0151: `Пример нарушений на чертежах/ПД/10 Мероприятия по обеспечению доступа инвалидов/V2_01-10-00-01-10_Том 10.pdf`;
  SHA `afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a`,
  7,666,331 bytes, 40 pages, manifest PD/OTHER.
- F0125: `Новослободская/Новослободская/Стадия П/НВС-2025.3-11-ОДИ.pdf`;
  SHA `570a18c01ec7325a6608546f71d6d4da23ddb07422937bef2be4ec6a3b6e42e3`,
  3,268,065 bytes, 21 pages, manifest PD/OTHER.

Verified local PDFs are `/tmp/matrix-t20-F0151.pdf` and
`/tmp/matrix-t20-F0125.pdf`. The previously empty F0151 download was replaced only
after exact byte-size and SHA verification. Actual worker
`extract_pdf_text_artifact` produced current document-text-v2 artifacts:

- `/tmp/matrix-t20-F0151.text.json`: 655,669 bytes, SHA
  `0ba76bc0153c1cfbabe27daf2972de249f588a7792a3e09e5bfe572b9a8922a9`;
  38 text-layer candidate pages and two OCR-required pages.
- `/tmp/matrix-t20-F0125.text.json`: 806,453 bytes, SHA
  `19745b279545b5918daa5051e85f760e3d696bdae336d2d4696107c9931c7275`;
  21 text-layer candidate pages.

All following boxes are PDF_BOTTOM_LEFT_MILLI_POINTS, `[x0,y0,x1,y1]`.
F0151 PDF17 is 595320×841920:

1. `15:0`, `[85095,349335,500439,363375]`:
   `Ширина проступей ступеней предусмотрена 0,3 м, а высота подъема`.
2. `16:0`, `[85095,325214,537769,339254]`:
   `ступеней - 0,15м. Уклоны лестниц - 1:2. Стальные ограждения лестничных`.
3. Preceding `14:0` explicitly discusses evacuation of M1–M3 through four stairs.
   It does not establish the identity of an individual flight or normative scope.

The originals were also visually inspected using
`/tmp/matrix-t20-F0151-p17-excerpt.png`. The tracked compact fixture
`services/worker/tests/fixtures/pd-stair-F0151-p17.json` preserves all original
page-17 blocks and exact line boxes, with separate original-source metadata.
Test helpers remap its page to one synthetic fixture page; they must not claim
that remapped artifact is the original immutable 40-page artifact.

F0151 PDF23 also contains height 0,15 m and depth 0,3 m in `3:0`/`4:0`, with a
35.395-point paragraph indent and reversed attribute order. It is outside the
first grammar below, not evidence of missing dimensions. Its 0,15 m warning strip
at `21:0` is a decoy, not a riser height.

F0125 PDF8 `7:0..2` contains bounds of at least 0,28 m / at most 0,17 m, followed
by actual dimensions `подземной части 280 х 170 мм, для надземной части 280 х 150 мм`.
This mixes normative bounds, two zones and two component values. The first slice
rejects the entire construction. It must not take the first number, merge zones,
or automatically apply 300/150 to a different accessibility context.

## Two-line prose grammar

Whitespace is normalized per line. The grammar uses
`NUM=[0-9]+(?:[.,][0-9]+)?` and case-sensitive `UNIT=(?:мм|mm|см|cm|м|m)`.
Each line is fully matched; letter case is folded only for the fixed Russian
phrases. Line 1 is:

```text
Ширина проступей ступеней предусмотрена <tread><unit>, а высота подъема
```

Line 2 is:

```text
ступеней - <riser><unit>.
```

The only optional suffix is exactly:

```text
 Уклоны лестниц - 1:2. Стальные ограждения лестничных
```

The suffix is preserved as source text; neither slope nor guard geometry is a
third extracted fact. All alternatives, ranges, limits, tolerances, unknown
suffixes, reordered clauses, missing units and thousands grouping are rejected.
There must be one line-1 anchor and one complete line-2 match on the same page.
The dedicated prose grammar only accepts an unambiguous PD or RD page stage.

Both lines require exact line boxes. Line 1 must be above line 2: vertical gap
`first.y0-second.y1` is inclusive 0..18000 milli-points. Left-edge difference is
at most 2000; line-height difference at most 1000; both heights must be positive.
Any other line, including a coarse multi-line box, whose interior intersects the
two-line union band rejects the pair. Array order cannot replace geometry.

Both emitted attribute facts retain the same two ordered evidenceFragments and
their full raw text joined with one space; rawValue/rawUnit come only from the selected named capture.
Their primary bbox is the union of those two lines. There are no table/context
fragments and no inferred TABLE_CONTEXT_UNVERIFIED flag: this is an explicit
compound prose statement. Existing source flags stay unchanged. Neither a
nearby evacuation sentence nor the numeric values assign entity, CURRENT,
APPROVED, section AR, finished measurement basis or norm applicability.

## Acceptance tests and remaining blockers

Fourteen focused tests cover 300/299.999 and 150/150.001, equality, both families,
PD outside the bound, exact units, zero, missing facts, all four scope identities,
wrong-but-matching basis/mode, missing/wrong norm, UNKNOWN, section/stage mismatch,
multi-rule fact binding isolation, no complete negatives, and registry tampering
including removing both typed policy and its atomic gate. Grammar tests cover
original F0151, F0125 decoys, ambiguous/coarse/missing/shifted boxes, competing
lines, strict geometry boundaries and stable observation identity.

The worker fixture exports `stair_dimensions_fixture(kind='tread'|'riser',
expected=None, actual=None, norm_applicable=True, fact_scopes=False)` for independent
API golden tests. Its default pairs are 310/299 mm and 149/151 mm. The optional v2
mode creates explicit synthetic per-fact scopes across a changed manifest.
`stair_prose_artifact(src)` loads the tracked original-page fixture without a
`/tmp` dependency. No synthetic proof is reused by a real-source replay.

The focused worker verification passed 156 tests: 118 matrix, five fact-scope,
23 family evaluator, four family registry and six source-pin tests. The registry
now contains 132 parameters, 52 with installed atoms, 60 atoms and 89 allowed stage
groups; 80 parameters remain unsupported. Counts describe installed capability,
not measured accuracy or complete parameter coverage.

Two separate full-artifact read-only probes preserve original objects and hashes,
manifest section OTHER, UNKNOWN source statuses, null link group and no scope
proofs. F0151's 40 pages yield exactly two AR-048 observations on PDF17: tread
300 mm and riser 150 mm, both with entityKey null. F0125's 21 pages yield no
observations. Both AR-048 coverage rows stay PARTIAL with zero successful
comparisons, two abstentions and zero qualified results. PDF23's alternative
construction is deliberately not accepted.

- `/tmp/matrix-t20-F0151.matrix-input.json`: SHA
  `10fa1cee4196924aa35cafd09966f4023de733c11fd1763cdc420740ec8c52d9`.
- `/tmp/matrix-t20-F0151.matrix-output.json`: SHA
  `a2d87730e4867dd522624713670cbc063e2fa4d4a8d0247bc5339daad66cb7ca`.
- `/tmp/matrix-t20-F0125.matrix-input.json`: SHA
  `1f966a9109cbdc96eb89b74f9ad0aca524c64e89c3169cd1c0e8c1ca7c670b39`.
- `/tmp/matrix-t20-F0125.matrix-output.json`: SHA
  `3abe8a7d70f90ff9f59d46540f60fae4a7e538be985f312e7ed5e211ced13f29`.

Independent API validation, full repository checks, PostgreSQL persistence,
deployment and browser acceptance are separate parent-owned gates.

No matching original RD literal pair was found in the bounded public-index leads
supplied for T20. This is not an absence proof or exhaustive inventory. A real
qualified PD/RD stair comparison remains blocked on an identifiable original RD
dimension, reviewed source/section/flight/step/basis/norm scope, and authentic
per-fact bindings. Step-count changes, ID measurements, general drawing geometry,
all-flight coverage and calibrated confidence remain outside this slice.

## Integrated acceptance, 18 October

T20 accepted after fullcheck1948passed/95skipped,typecheck/buildPASS and actualPostgreSQL42passed. Synthetic browser preserved four immutable runs with0/2/1/2qualified results after independent bindings/norm withdrawal/restoration. Public original F0151 produced exactly300/150mm on PDF17, two exact primary lines, zeroqualified and unreviewed source metadata. Both browser suites passed1440/768/375 with no pageerrors/failedrequests. All24savedchecks and one localregistration survived all-role restart. Evidence: output/matrix-t20-20261017/acceptance.json.
