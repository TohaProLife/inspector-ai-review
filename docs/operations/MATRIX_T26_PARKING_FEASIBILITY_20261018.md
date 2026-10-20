# T26: ODI-121 / SPZU-038 — bounded public parking feasibility

Date: 2026-10-18. Read-only investigation; runtime, tests, registry and deployed stack unchanged. No new extraction, OCR, model invocation or hidden-answer/annotation read.

## Decision

Keep both parameters unsupported for automated findings. Public evidence supports four exact **planned counts reported in an included transport-authority letter**, but no matched RD parking pair or exact parking-bay width was established. The school package explicitly places parking outside its own territory. Treating absent on-plot parking as a failed 10% ratio would invent applicability and a denominator.

The useful next unit is a scoped parking-inventory fact, initially evidence-only. There is insufficient evidence for an enabled count-decrease, width or percentage rule in this package. Missing width and missing RD are evidence gaps, not low-confidence violations.

## Exact catalog requirements

Source: `services/worker/rules/parameter_catalog_132.jsonl`, matrix rows 39 and 122.

| Parameter | Exact trigger | Declared sources |
|---|---|---|
| SPZU-038, «Количество парковочных мест для МГН на участке», шт. | «Отсутствие или уменьшение доли мест для МГН (< 10% от общего числа).» | PD: «Схема парковочных зон (СПЗУ/ОДИ)»; RD: «План благоустройства; Знаки и разметка (ПП)»; ID: «Исполнительная схема разметки; Акты установки знаков» |
| ODI-121, «Количество и габариты парковочных мест для инвалидов», шт. / м | «Сокращение количества мест для инвалидов; уменьшение ширины места < 3.5 м.» | PD: «Схема парковочных зон (ОДИ/СПЗУ)»; RD: «План благоустройства; Разметка (ПП)»; ID: «Исполнительная схема разметки» |

Both current registry entries have `family:null`, `gap:COMPOSITE_TRIGGER`, `atomicRules:[]`. These quotes describe the catalog; this review does not establish a universal legal 10% or 3.5 m requirement. Applicability, parking subtype, scope and accepted revision remain necessary.

## Search boundary and provenance

Manifest gate applied before retrieval: `split=TRAIN_PUBLIC`, `distribution_status=INCLUDE`, `label_visibility=PUBLIC_TRAIN`; 203 eligible source IDs. Each returned source was checked against manifest object, stage, section, path, byte size and SHA. The manifest's section was retained: F0151 and F0102 are **OTHER**, even though filenames/content mention access or parking.

Read-only index: `/mnt/edberries-backup-disk/inspector-ai-public-document-index-v3-20260927/index.sqlite3`. Exactly **8 FTS queries**, each `LIMIT 12`, 84 rows total. For each RD and PD stage, four queries covered accessibility, count, width and share. Exact queries and bounded results: `output/matrix-t26-20261018/bounded-fts-results.json`. RD accessibility returned zero rows; remaining broad RD queries reached the limit with structural/title-page false matches. These results do not prove that every RD drawing lacks parking; they establish that this bounded search did not find a pair. No further FTS queries were made.

Exactly **6 canonical pages** read, all compressed-file SHA verified against index metadata; decompressed `inputSha256` checked against manifest SHA and `pageNumber` against selection. This verifies the canonical artifacts and declared source identity; it is not a fresh rehash of every original PDF. Original compressed bytes and decompressed JSON retained under `output/matrix-t26-20261018/`. `canonical-page-receipts.json` includes source paths, full source/artifact hashes, pages and checks. `read-only-research.json` includes exact original block/line indices and boxes. `checksums.json` hashes the evidence files.

| Source / original PDF page | Object / stage / manifest section | Source SHA-256 | Compressed page SHA-256 |
|---|---|---|---|
| F0154 / 16 | OBJ-TYUMENSKAYA-5-GOLD-SEED / PD / GP | `336e9742450dd403c6e2dfd0ee4660d316725e95201f4cb41308d2b9296c085b` | `6a8a78072c322d8cdbe194040533afc4eb9f133c88b2a769afa0f36b4916bb13` |
| F0151 / 11 | OBJ-TYUMENSKAYA-5-GOLD-SEED / PD / OTHER | `afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a` | `5ac34cb347dd2b0c0e09b6002ff95019a9a30dee99fea5a1abf7571220c27503` |
| F0102 / 214 | OBJ-NOVOSLOBODSKAYA / PD / OTHER | `efd65f210857dba26b2189ade16a82f7f5f1771ad503b8539fb6cd043d78629e` | `ba93017f8d2e7a8ce567d037345c7380fbea505f9eebee9fd9917ba3e9bd41f4` |
| F0104 / 11 | OBJ-NOVOSLOBODSKAYA / PD / AR | `bbfef68dad703d33c63d73549b0c4a1007f74213a236580346262491839d80f8` | `b2d8aff8eb46aa1fe4496e015de81c174ff9dadd06e7eb787aec9eb5dc8467a0` |
| F0101 / 10 | OBJ-NOVOSLOBODSKAYA / PD / OTHER | `01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54` | `241117a27201f6c9a50cb8fe802f5df23ae0336f50a3b82069e5fe3f20f5605e` |
| F0102 / 15 | OBJ-NOVOSLOBODSKAYA / PD / OTHER | `efd65f210857dba26b2189ade16a82f7f5f1771ad503b8539fb6cd043d78629e` | `8c95a4ef80039be638194d26b2ab0ca111800340caf635ea5b9a6b6f9ce2bad0` |

## School: no own-plot parking inventory

Started from existing local full canonical artifacts `/tmp/matrix-t22-F0154.text.json` and `/tmp/matrix-t20-F0151.text.json`; no new extraction. Verified selected original canonical pages independently through the public index.

F0154 p16 block 7, first line: **«Парковка личного транспорта внутри границ ГПЗУ не предполагается.»** Block box `[99320,203760,570536,365880]` milli-points.

F0151 p11 block 3, lines 0–7: no parking places planned on the school territory; where necessary MGN use equipped parking on adjacent territories; a **dropoff location** is planned before the gate. Block box `[85085,565812,547830,709441]`. The following 20‰ slopes describe the dropoff surface, not bay width.

Consequences: nearby parking is a separate entity; dropoff is not a parking bay; no stated count cannot become an asserted count of zero for all surrounding parking. A zero or missing on-plot total cannot produce a 0/0 share or automatic SPZU-038 violation. Same object ID is present for these two PD sources, but neither supplies an RD inventory or numeric bay width.

## Novoslobodskaya: exact counts, different scope

F0102 p214 is an included authority letter, registered `МПП-01-4213/25`, 2025-07-10 (block 12). Block 1 expressly scopes the following list to **paid city parking within 250 m of the object**, according to updated traffic-management projects. It is a report of planned provision, not a measurement or executed parking survey.

| Explicit location | All places | For vehicles of disabled persons | Original evidence | Derived share, arithmetic only |
|---|---:|---:|---|---:|
| Проектируемый проезд №2554 | 35 | 4 | blocks 2:0 + 3:0 | 11.43% |
| Весковский переулок | 15 | 2 | block 4:0–2 | 13.33% |
| 1-я Миусская улица, участок от Весковского переулка до 2-й Миусской улицы | 39 | 2 | block 5:0–2 | 5.13% |
| Новослободская улица, рядом с домом 19, строение 1 | 7 | 2 | blocks 6:0 + 7:0 | 28.57% |

Examples of exact line boxes: block 2:0 `[92297,720711,570750,734974]`, continuation 3:0 `[57027,704954,385475,719217]`; block 5:1 `[57027,623942,570750,638205]`, continuation 5:2 `[57027,608205,385475,622468]`. All lines retained in machine-readable evidence. First and fourth items span original blocks; a same-block-only prose parser must not silently join them. Second and third items already retain original multi-line blocks.

The letter also mentions four free spaces near a social object in the Veskovsky item. Their inclusion in or addition to the stated 15-place total is not independently established: do not change the denominator or classify those four as accessible.

The four stated totals sum to 96, accessible counts to 10, giving 10.42%; the individual 39-place segment gives 5.13%. This arithmetic illustrates why the accepted inventory boundary matters. It proves **neither** a compliant overall facility **nor** a violation on one street. Do not merge these external streets with the project's underground garage.

F0101 p10 has a separate table: parking-count label block 28, unit `м/м` block 29, value `64` block 31 (value box `[466740,574746,480622,584766]`). This is a table-alignment candidate for the underground garage, not a supplied accessible numerator. The label block also contains the next table row, so text concatenation is unsafe.

F0102 p15 blocks 9 + 11 require **87 places as an assumption when designing engineering systems**: «количество машиномест в паркинге принять 87 шт.» It is not an interchangeable actual denominator for the 64-place table or external 96-place list; current revision and purpose have not been reconciled.

F0104 p11 block 37 says guest places for M4 disabled persons are absent in the underground garage, in the context of fire refuge zones. This is a **subtype-specific absence**; it does not prove that all accessible categories have zero places. No exact bay width appears in the six inspected canonical pages.

## Bounded contract justified by this evidence

An evidence-only adapter can represent `PARKING_INVENTORY_COUNTS_REPORTED` with exact nonnegative integer `totalPlaces` and `accessibleVehiclePlaces`, same-source explicit `из которых` relation, and subtype wording preserved. Required provenance: source SHA, original page/block/line boxes, document role, date/revision, and explicit named inventory location. Required scope values here: `EXTERNAL_PAID_CITY_PARKING`, `PLANNED_REPORTED_IN_LETTER`, not `ON_PLOT` or `AS_BUILT`. Preserve the named street interval; reject anonymous sums, guessed width, percentages without a denominator, and free-place inference. Structural joins across blocks need an independently reviewed grammar before extraction; current evidence alone does not justify a permissive generic paragraph join.

Enabling a future ODI-121 **count-decrease-only** atom additionally needs a real PD/RD pair with identical accepted inventory boundary, location, accessible subtype, revision basis and approved-change context. The supplied sources do not provide that pair. Width remains a separate unsupported atom until an explicit bay width is tied to a particular bay/entity and its applicable threshold; a vehicle dimension, slope, range or minimum prose is insufficient.

A future SPZU-038 **share-only** atom additionally needs `0 < totalPlaces`, `accessiblePlaces <= totalPlaces`, explicit complete-inventory scope, numerator/denominator from that same accepted population, and reviewed 10% applicability. External street counts, garage totals and a school dropoff cannot fill each other's missing fields. Failure of any gate yields a documented evidence gap, never a confirmed warning merely because confidence exceeds 80%.

## Next concrete blocker

Obtain or identify the real RD parking plan/marking inventory for one of these accepted object/location scopes, including an explicit accessible subtype, exact count and bay width. For the school, first resolve whether the catalog check applies to an on-plot inventory that the PD explicitly does not provide. Until then, retain unsupported status and the evidence-only counts; no runtime expansion is warranted from this bounded sample.
