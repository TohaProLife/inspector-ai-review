# T45: frozen source packet для ODI-120

Pure implementation ещё не написана. Root утвердил отдельный algorithm-free wire `output/matrix-t45-20261018/research-rail-inventory-wire.json`, SHA `13edfaeb65a956ade37d83779e6555bec9dfc8c70a55aa1f5fe5e82c73fcc206`; approval — `root-wire-approval.json`. Accepted старые call/AR grammar, helpers, profiles, registry и результаты этим пакетом не менялись.

Консервативный будущий predicate: ПД явно содержит WC_FIXED_RAIL **и** WC_FOLDING_RAIL; human-reviewed complete nonempty РД того же доступного санузла не содержит **ни одного** из этих двух типов. BASIN_RAIL отдельный тип. Отсутствие только одного WC-типа — ABSTAIN. Результат только кандидат с null calibrated probability, различие в reviewed declared inventory, без физического отсутствия или нормативного заключения. Source parser predicate не исполняет.

## Source wire

Вход exact6 keys: sourceFileId, sourceSha256, stage, pageStages, полный textArtifact document-text-v2, selection. Selection exact pageNumber/regionBoxMilliPoints/headerFragments/scopeFragments/endFragments. Fragment exact pageNumber/blockIndex/lineIndex/rawText/bboxMilliPoints. Полный native input ограничен до обхода; document/source/stage проверки раньше selection. Наследуются portable depth64/nodes200000/UTF8 key+value bytes8000000/string2000000/container32768, pages512, region lines128, source line8192. Object key order — Unicode codepoint; числовые ASCII keys тоже lexical, без JS integer-key reordering. Дополнительное root уточнение сохранено в approval, approved wire не переписан.

Литералы без нормализации:

- header `Перечень поручней доступного санузла`;
- scope `Санузел МГН: {roomToken}`, exact token grammar в wire;
- end `Конец перечня поручней доступного санузла`;
- WC_FIXED_RAIL: `Поручень стационарный` / `для унитаза`;
- WC_FOLDING_RAIL: `Поручень откидной` / `с бумагодержателем` / `для унитаза`;
- BASIN_RAIL: `Поручень для раковины`.

Output featureRows —1..3 unique `{featureKey,fragments:[...]}`, original body order. Multiline2/3 fragments должны иметь один blockIndex и consecutive lineIndexes. Nearest/cross-block joins запрещены. Каждая непустая строка тела учтена; unknown/conditional/negative/combined/seat/reference/continuation/incomplete row блокирует весь результат. Unsupported body имеет приоритет над duplicate feature.

Область exact fullwidth `[0,end.bottom,page.width,header.top]`, anchors contained; header/scope/end unique на всей выбранной странице, authenticated first/second/last. Geometry gaps0..30000, line overlap/boundary crossing закрываются до literal semantics. Любая из пяти точных vocabulary lines вне band на selected page даёт OUTSIDE_BODY_ROW; unrelated footer допустим. Это намеренно узкая grammar. End marker не machine proof полноты и не требование каталога. Header-only/empty не являются отрицательным инвентарём. Building/floor/room/entity mapping, human completeness и source approval остаются следующим отдельным review/comparison этапом.

## Независимое авторство и проверки

До создания20 original PDFs зафиксирован `research-rail-manual-authoring-plan.json`, SHA `d1e7bfd715a9a00428453c07be82cc1ad033a903df651a29d165eacccb8b5755`: literal groups, block/line indices, frame842000×595000, baselines, full expected source outcome. Glyph advances600 PDF units при12pt и Descent−200 дают line boxes арифметически. Отдельный layout probe до freeze проверил только пригодность font/layout к same-block extraction; это не source oracle и не production fixture.

20 synthetic originals: PD both; RD basin/all/fixed-only/folding-only; PD basin-only; empty; unknown-extra; conditional; negation; folding-seat; duplicate fixed; other room; incomplete folding; interleaved folding; reference; wrong header; wrong end; vocabulary row outside band; unknown combined label. У каждого неизменяемые original SHA/bytes/sourceID/stage, полный одностраничный canonical artifact и явный synthetic-only provenance.

Фактический canonical extractor `text_layer.extract_pdf_text_artifact` подтвердил **20/20** полных raw/boxes/frame/source-block materializations без исправления ручного baseline. Никакой rail/call/AR reconstructor/comparator не импортирован и не вызван. Сгенерированы **37 whole-source goldens**:20 originals +16 source/stage/selection/anchor mutations +1 явно помеченный SYNTHETIC_CANONICAL_ADVERSARIAL_ONLY cross-block vector. Последний не выдаётся за подлинный оригинал с изменённой extraction. Девять отдельно написанных pair expectations — rationale будущего predicate, не approved DB authority или comparator output.

Проверены generic frozen full-envelope validation и T37 public page reader:37/37 structurally valid full source artifacts/READY. Это проверка geometry/materialization, не успешный source reconstruction. Все20 страниц отрендерены; просмотрены positive full page и20-page contact sheet: текст и границы читаемы, clipping/overlap отсутствуют, intentional negative wording сохранено. Browser не использовался.

Byte-exact self-contained fixture directory: `services/worker/tests/fixtures/matrix-rail-inventory-v1/` —20 PDF +20 full canonical JSON +6 wire/plan/manifest/extraction/golden/approval JSON,47 files с provenance.json. Source/tests implementation отсутствуют. Tests будущей реализации смогут читать только этот каталог, без зависимости от ignored output.

## Что проверить дальше

Independent Python/TS pure reconstruction против37 frozen whole outputs, затем native/resource/getter/Unicode/alias, same-block and precedence probes; исходные expected не подгонять. После pure acceptance — отдельные review/identity/comparator wire с human-scoped completeness/CAS/immutable snapshots и actualPG/durable validation. Реальные public matched qualification0; текущая F0151/OTHER диаграмма не стала approved inventory и не получила RD pair. Новое accepted coverage0. Авторский пакет не требует запусков стенда, H100, внешней модели или браузера.

## Production pure acceptance, 03:29 UTC

Accepted `output/matrix-t45-20261018/production-pure-acceptance.json`. Independent Python/TS implementations passed160 exact whole outputs each (158unique inputs); native traps/limits tested separately. One mixed source/page-stage diagnostic-order RED remains preserved; TS changed only gate ordering, not literals or expected bodies.

Production Python byte-identical to accepted staged source; TypeScript differs only in two relative import paths. Focused API353PASS/5files (185rail,168existing call/AR neighbors); Python192methodsPASS (29rail methods include two loops covering160 whole-output subtests); APItypecheck/compile/diffcheck PASS. All47 original fixture files unchanged; six required probe JSON copies give53self-contained fixtures. Old T44 328+3pins unchanged.

No profile/registry/dispatch/stand activation, no additional accepted coverage or real matched qualification from source parsing. T46 continues immediately with independently implemented rail comparison and server review materialization.
