# T36: приоритет архитектуры после T34

18 октября 2026. Read-only review. **Сейчас 132 параметра, 55 с реализацией, 63 enabled atoms, 77 UNSUPPORTED. Обоснованного немедленного сокращения77 из уже изученных public pairs нет.** Это не повод писать ещё один parser: основной пробел — доказанная принадлежность факта элементу, полная область поиска и применимость.

Registry SHA `cc5dd08210d92434b10e316a5c01959b26ace1929ce48da4bc8f99733e17f769`. Распределение77: composite26, geometry19, applicability10, enumeration8, approval/context7, external4, mapping conflict2, trigger conflict1. Категории пересекаются по архитектурным потребностям; складывать обещанный эффект рекомендаций нельзя.

## Что уже готово

- `numeric_family_table_rows.py:85` геометрически связывает literal label/unit/value для31 numeric codes. **Все31 уже implemented**; это полезный путь повышения реального числа qualified facts, но не сокращения77. Все8 class-label codes также уже implemented.
- `matrix_engine.py:619` уже разбирает целую scalar строку и узкую горизонтальную таблицу, в некоторых случаях с явной unit из header. Работает для включённых rules; не связывает произвольный размер с контуром/элементом и не удостоверяет полноту таблицы.
- `table_rows.py:73` специализирован на PZ-002 общей площади. `matrix-table-context.ts:25` проверяет конкретную geometry/header/scope grammar бетона; соседние функции — плиту и тротуар. Это reusable guards, но не универсальная semantic table model.
- **Готового универсального dimension-chain extractor среди проверенных worker/API путей нет.** `vector_proposals.py` ищет неклассифицированные графические устройства отопления; `geometry_registration_v1.py` выполняет affine arithmetic без удостоверения координат и смысла; window-table proposals сохраняют непроверенное соседство строк. Ни один модуль нельзя включить как extractor размеров шахт/сечений.
- `family_rule_evaluator.py:247` и `candidate_family_comparison.py:198` уже содержат offline PRESENCE_SET с reviewed enumeration и complete/same-scope gates для8 текущих UNSUPPORTED. Это готовая основа comparator, **не** durable execution. `matrix_engine.py:84` этого семейства пока не допускает.

## 1. Типизированные операнды и доказанная связь одного элемента

Первый узкий потребитель — KR-056. Повторно используемый контракт должен связывать уже извлечённую декларацию с исходно обозначенным изделием, без нового prose parser и без изменения EVIDENCE_ONLY артефакта. T34 уже даёт полные source-bound declarations; `steel_prose.py:47` уже исполняет чистый bounded predicate С345/С245. Новый общий слой — отдельно версионированная проекция/selector и correspondence review с declaration ID, source/textArtifact hashes, полными fragments, stage и текущим source-review hash. Проверка product/member/zone/tier/standard applicability и basis обязательна; произвольный entityKey не создаёт недостающий member ID.

Конкретные входы: `packages/contracts/src/matrix-source-declarations.ts:26`, `apps/api/src/matrix-source-declarations.ts:151,215`, `matrix-execution.ts:124` (scalar reserved-field isolation), `matrix_engine.py:1108,1271`. Нужен отдельный profile/capability pin; существующие v1/v2/v3 и машинные snapshots сохраняются. Исходные declarations остаются immutable EVIDENCE_ONLY, новая projection не делает их scalar путём удаления kind/productScope.

Реальная опора: full43 fixture `services/worker/tests/fixtures/matrix-steel-v1/research-full43-fixture.json`, SHA `2849b29dbe251377955c7eb1146aa12ef29be996ab9a706ab555c3a661e1e7f6`. F0105 PD14 описывает три70Б3 второго яруса распределительного пояса; F0145 RD4 — generic I-beam declaration без profile/count/tier, sectionOTHER. Обе марки С245, стандарты различаются. **Это не доказанная пара одного элемента и не downgrade.** OTHER автоматически не меняется. Сейчас только evidence; helper не сокращает UNSUPPORTED.

Gate: source-proven member correspondence и применимость стандартов, независимая реконструкция Python/TS, stale/rehashed/wrong-member attacks, controlled candidate/withdrawal/restore с probabilitynull, реальная unqualified пара без ложного отрицательного результата. Лишь затем отдельное решение о registry atom. Потенциал ближайшего среза — один partial parameter; обещания реального paired результата пока нет.

## 2. Полный scoped inventory и PRESENCE_SET

Наибольший reusable family horizon: SPZU-039, AR-053, POD-092, POD-095, ODI-120, ODI-122, ODI-123, ZU-129. Не включать8 правил сразу. Сначала одна настоящая именованная ведомость/таблица с полным составом обеих стадий.

Новый inventory artifact должен сохранять source/page/region inventory, уникальные member IDs и literal evidence каждого члена, именованную предметную область и явные OCR/incomplete/truncated состояния. Отдельное authenticated completeness/same-scope review связывается с inventory hash и актуальными stage/revision/source. **Не переносить offline `status:VERIFIED`+reference как серверную authority.** Existing FACT_BINDINGS специально запрещает completeness keys (`matrix-fact-bindings.ts:56`, `matrix_engine.py:437`); этот запрет не ослаблять. Отдельные target/schema нужны для полноты перечня, а не для полноты одного scalar факта.

Реальная опора и граница: `PRESENCE_FAMILY_CANDIDATES.md` уже описывает F0151 кнопку вызова и F0118 счётчик воды, но scope не установлен. Исторический корпусный проход прямо оставляет searchCompleteness NOT_ESTABLISHED и absenceInference PROHIBITED; новых подтверждённых полных public inventories нет. Его результаты здесь повторно не исполнялись и удалённо не читались.

Готовый comparator разности множеств пригоден после строгого source-bound переноса; **публичной парной проверки пока нет**. Пропущенный PDF, пустой FTS, нечитаемая страница и отсутствие подписи никогда не означают пустой фактический перечень. Явно пустой RD inventory допускается только с положительным доказательством полного охвата. Tests: incomplete/OCR/truncation/duplicate views/scope mismatch, отсутствующий member в полном и неполном перечне, отзыв и stale completeness review. Горизонт8 codes — не прогноз прироста покрытия.

## 3. Структурированные размеры и модель строк/ячеек

Следующий по усилиям/риску слой для KR-060/KR-064: общий source-bound graph label/value/unit/header/scope, затем typed dimensions с shape, EQ, двумя length operands, единицей, basis и исходно обозначенным member/axes/level/building. Политики соединения ячеек версионируются декларативно поверх geometry guards; parser на каждый новый параметр не нужен. Для первой rectangle area — exact integer product вмм² с обоими исходными selectors; generic scalar normalization не расширять. Circle/diameter, image-scale measurement и topology остаются вне среза.

`matrix_engine.py:1237` уже имеет exact DECREASE; отсутствует доказанный структурированный operand, а не вычитание. `numeric_family_table_rows.py:85` и `matrix-table-context.ts:25` дают guards для ячеек, но не member association. **До dimension-chain detector нужен один настоящий paired plan/section с именованным элементом, осями/отметкой и однозначной цепочкой размеров.** Это stop condition, не просьба реализовать весь CAD.

Проверенная T29 опора: F0106 PD53 перечисляет сечения колонн, F0141 RD4 — сечения пилонов; IDs соответствующих элементов отсутствуют. Даже одинаковые600×1500 не создают пару. Сортировка площадей либо nearest-number pairing запрещены. T35: F0106 PD115/127 содержит толщину перегородок75/80мм и названия холлов; это не clear dimensions шахт. F0141/F0143 RD3 описывают другие подземные уровни. Результат пока EVIDENCE_ONLY/ABSTAIN; поддержка KR-064 width/depth и embedded-item displacement — разные будущие atoms. AR-045 далее потребует собственной связи slope-arrow/catchment, rectangle model её не решает.

Tests: wrong member/level/basis/shape, range и условный bound вместоEQ, diameter вместостороны, column/header borrowing, повторные виды, recomputed hash, exact area и неизменность старых scalar facts. Сейчас снижение77 — ноль.

## Что не приоритет

T28 GE0.9m дверного проёма не превращать в EQ и не подключать к каталожному ODI-117 с1.5m. Отдельный будущий PROJECT_CONSTRAINT_VALIDATION полезен, но не закрывает каталожный trigger и не даёт legacy NO_VIOLATION. T35 R/REI declarations без покрытия/состава одной конструкции и T22 подписи воронок без полного инвентаря также не обосновывают новые atoms. Новые внешние нормы, реестры и массовые regex не устраняют эти blockers.

Машинный отчёт: `output/matrix-t36-20261018/architecture-priority-review.json`. Выполнены только чтение кода/имеющихся evidence, registry arithmetic и hashes. Новых данных/FTS/агентов/remote calls/runtime edits/stand writes/browser calls/tests —0. Прогнозов confidence и claims о приёмке/релизе нет.
