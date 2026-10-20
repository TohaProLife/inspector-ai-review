# T32: лестничный бетон для существующего KR-055

Статус: READ_ONLY FEASIBILITY. Runtime, registry, contracts, стенд и сохранённые анализы не менялись. Использованы только полный открытый fixture T31 и уже проверенные оригиналы. Реальная пара равная: ПД В30 / РД В30. Нарушение из неё не следует.

## Что подтверждено

- Полный fixture `services/worker/tests/fixtures/rebar-F0106-F0139.json`: 161 PDF-страница, SHA256 `ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54`.
- F0106: ПД/KR, 139 страниц, SHA256 `ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655`; оригинал `output/matrix-t31-20261018/F0106-original.pdf`, 23 871 472 байта.
- F0139: РД/KR, 22 страницы, SHA256 `d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f`; оригинал `output/matrix-t30-20261018/F0139-original.pdf`, 2 298 875 байт.
- Оба источника TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN. SHA оригинальных PDF повторно проверены локально; новый поиск корпуса не выполнялся.
- Действующий `matrix-kr-055-concrete_class`, version1: CONCRETE_CLASS / B_CLASS / CLASS_DECREASE; contexts ELEMENT_IDENTITY и MATERIAL_CLASS_BASIS; PD_RD, PD_ID, RD_ID. Глобальная нормализация и политика сравнения уже подходят.
- Чтение текущего engine на полном fixture даёт шесть CONCRETE_CLASS фактов, все из таблицы F0106 PDF50. Целевых лестничных фактов из ПД3:0 и РД44:0 нет. Это пробел extraction, а не новый unsupported-параметр.

Точные исходные строки, line boxes, quality, исходный rule и результат baseline находятся в `output/matrix-t32-20261018/research-concrete.json`. Скрипт `research-concrete.py` воспроизводит чтение без записей в БД или стенд.

## Минимальная независимая грамматика

Новый отдельный helper `concrete_prose.py` и независимый TS-порт. Не импортировать `rebar_prose`, не требовать ни наличия класса арматуры, ни его значения, ни rebar authority. Допустимо повторить проверку геометрии как чистую утилиту. Сигнатуре нужны текущая страница, stage и предыдущая страница для ограниченного material header ПД. Никаких source/page allowlist.

ПД: полная единственная строка `Лестницы, лестничные площадки всех корпусов [BВ]30.` — первичное evidence. Для controlled проверки разрешить только замену class token на B25/В25, с заранее определённым узким доменом B25/B30; расширение домена — отдельный шаг. Сохранить literal glyph в value и rawValue, rawUnit=B_CLASS, unit=B_CLASS, attribute=CONCRETE_CLASS. Уже существующий classRank приводит B/В к одному B-домену; глобальный normalizeFact не менять.

Материал нельзя выводить из соседнего упоминания арматуры. ПД содержит прямой material header на предыдущей PDF49, block10, две строки:

1. `Для  железобетонных  конструкций  предусматривается  использование  тяжелого  бетона` — box `[106320,325008,559542,337008]`.
2. `по ГОСТ 7473-2010 и ГОСТ  26633-2012 и приняты следующие классы по прочности на сжатие:` — box `[70800,311328,559415,323328]`.

Эти две оригинальные строки сохранить как ATTRIBUTE_HEADER; PDF50 `Подземная часть`, block0:0, box `[106320,800208,192336,812208]` — MATERIAL_SCOPE. Первичное evidence PDF50 block3:0: `Лестницы, лестничные площадки всех корпусов В30.`, box `[106320,698448,380184,710448]`. Header искать только на текущей/ровно предыдущей странице того же источника, с однозначным совпадением, полным raw text, line geometry и PD stage; обе quality TEXT_LAYER_CANDIDATE. При нескольких competing stair declarations/headers, malformed anchor, ином этаже/области, ranges/alternatives — abstain. Табличные B40/В60 других элементов не считать конкурентами самой лестничной строки, но не присоединять их к её значению. Существующая adjacent-page concrete-table boundary уже использует такой тип material header; лестничный prose row остаётся отдельной грамматикой.

РД: полная единственная оригинальная строка PDF4 block44:0, box `[97500,554871,832168,566750]`:

`Класс  бетона  по  прочности  для  лестничных  маршей  и  площадок  -  В30,  F150,  W6,  П4.  В  качестве  крупного  заполнителя  для  бетона  применять  гравий  из  плотных  горных  пород  по  ГОСТ  8267-93.`

Это одно primary evidence с полной строкой, включая F150/W6/П4 и стандарт заполнителя. Извлекать только token B/В25 или B/В30 после конкретного названия прочности лестниц. F/W/П4, 8267-93 и 50% не становятся прочностью бетона. MATERIAL_SCOPE: оригинальная строка block1:3 о комплекте чертежей и железобетонных внутренних монолитных лестницах подземной части, box `[72000,1102371,798335,1114370]`. Не требовать rebar block45:0 и промежуточную прочность распалубки32:11: они не нужны атрибуту данной строки.

Проверить строгую JSON shape, safe integer geometry, exact block union/line count, original strings и literal token boundaries. На каждой выбранной строке исключить наложения; RD primary и scope в общей левой колонке. Не применять большой unobstructed envelope от document scope до primary: между ними законный текст документа. PD header на предыдущей странице также не соединять геометрическим прямоугольником через две страницы. Не копировать rebar-specific gap/left-edge условия механически. Геометрические пределы зафиксировать из этих оригиналов и испытать shift/overlap/column mutations до внедрения.

## Интеграция без нового атома

1. Python engine добавляет результат отдельного concrete helper к строкам существующего KR055; новые факты используют прежний observation payload/id preimage с contextFragments. IDs всех прежних generic/table фактов неизменны. Не менять registry entry/rule id/version, allowed stage pairs или CLASS_DECREASE. Новый prose путь на этом этапе только PD/RD; ID grammar не выдумывать.
2. API `matrix-execution.ts` проверяет новый concrete prose путь независимой реконструкцией ДО table/generic fallthrough. Точное совпадение value/rawValue/rawUnit, parameterCodes=[KR-055], primary/context arrays, ролей, original boxes и stage. `rawUnit` остаётся строкой B_CLASS: null exception T31 не расширять.
3. Portable selectors TS/Python сейчас разрешают MATERIAL_SCOPE только rebar. Добавить только распознанный concrete prose случай после независимой проверки; любое CONCRETE_CLASS с произвольным MATERIAL_SCOPE по-прежнему отвергать. Canonical payload/старые selectors не менять.
4. `_flags`/TS validateObservations сейчас считают contextFragments бетонных фактов табличными. Для ДОКАЗАННОГО нового prose grammar убрать TABLE_CONTEXT_UNVERIFIED; старые table facts сохраняют этот флаг и `tableContextReview.fragmentsHash`. Само наличие MATERIAL_SCOPE не должно снимать флаг.
5. Pin `matrixDefinitions.concreteProse={extractorVersion,sourceSha256}` плюс durable source-pin verification обоих executable profiles. Новый config hash/immutable run; старые completed reads и snapshots без переписывания. На обычной CPU-архитектуре новый helper сканирует уже полученный text artifact, новая OCR/ML зависимость не нужна.
6. UI использует существующие source reviews/fact targets и original fragments. Потребуется настройка конкретных ELEMENT_IDENTITY/MATERIAL_CLASS_BASIS полей для новой prose области; обычного свободного reference недостаточно для автоматического совпадения broad PD all-corps с local RD stair member.

## Применимость: полезный результат требует review

Оставить CURRENT/APPROVED, общий object/manifest/link group, проверенный KR section и entity. Новые prose факты должны требовать **обе FACT_BINDINGS**, чтобы whole-file scope не переносил broad бетон всех корпусов на конкретный лестничный марш.

Минимально использовать существующие contexts, без новых context keys или DB migration:

- ELEMENT_IDENTITY: `componentRole=MONOLITHIC_LOAD_BEARING_STAIR`, componentKey конкретной конструкции/согласованной группы, zoneKey общего корпуса/подземной лестницы; operatingModeKey фиксированный `CAST_IN_PLACE_LOAD_BEARING_STAIR`, measurementBasisKey `CONCRETE_COMPRESSIVE_STRENGTH_CLASS`. Все четыре identity поля явные и равные с двух сторон.
- MATERIAL_CLASS_BASIS: явное подтверждение attribute=CONCRETE_CLASS, canonicalUnit=B_CLASS и той же базы прочности на сжатие, с содержательным review reference. Контекст не подтверждает прочность заполнителя, подготовку B7,5, арматуру, распалубку50% или отделку ступени.

Эти поля уже допускает текущий context schema; нужен узкий verifier guard **только для нового независимо распознанного prose**. Existing KR055 generic/table поведения не расширять или менять скрыто. Повторное использование rebar WORKING_REINFORCEMENT_POSITION запрещено: это другая материальная позиция и другое основание.

Без review обе реальные В30 остаются entity=null/UNKNOWN. Даже после точного matching равная пара В30/В30 остаётся NEGATIVE_SCOPE_UNVERIFIED при отсутствии RULE_SCOPE_COMPLETE. Подмена только controlled RD class на B25 или В25 после обеих рецензий даёт прежний CLASS_DECREASE candidate, delta=-5, probability=null. Это разница проектных классов, не оценка вероятности и не обещание полной конструктивной безопасности. Обратная В25→В30 не становится кандидатом понижения и сохраняет negative-completeness gate.

## Обязательные испытания перед реализацией

- Полный161 fixture: старые6 concrete observations неизменны + новые ровно2 нужных staircase concrete observations; обе real В30, 0 newly qualified; ни одного зависимости от удаления/замены rebar declarations.
- Отдельный controlled fixture с B25/В25; оба aliases дают класс25 без глобальной замены Unicode; real original не редактировать.
- Шесть важных подмен: header отсутствует/из другого stage/page/источника; PD foundation B7,5/табличное В60 подставлено лестнице; RD F150/W6/П4/50% принято за strength; совпал текст, но другой элемент; generic reference вместо конкретной identity; MATERIAL_SCOPE подделан и ID/portable hashes пересчитаны.
- Duplicate/malformed stair anchors, quotes/negation, alternatives/ranges, missing final sentence, wrong material scope, scalar/token glyphs, geometry/overlap/column shifts — abstain, parity Python/TS.
- Existing table/manual-layout review и все прежние generic KR055 fixtures остаются зелёными; новые prose флаги не снимают ограничения соседних таблиц.
- Actual PostgreSQL 0→1 после обеих reviewed bindings, withdrawal→0, restore→1; прежние bytes/hash неизменны. Equality never qualifies negative.
- Browser: exact original PDF49/50 и4 locator, primary + context отдельно, responsive1440/768/375; proof editor и explicit review, кандидат с probability=null. Public path read-only.

Ожидаемый эффект — одна новая реальная пара evidence для уже реализованного параметра. Реальная равная пара не доказывает positive violation. Счётчики остаются 55 параметров /63 атома /77 unsupported; нельзя выдавать это за снижение unsupported ещё на один.

## Локальный frozen case packet, без подключения runtime

`output/matrix-t32-20261018/research-frozen-cases.json` содержит полные исходные страницы ПД49/50 и РД4, original PDF SHA/размеры, полный text artifact SHA, public gates, точные raw строки/line boxes и независимо выписанный ожидаемый payload двух кандидатов. Для cross-page ПД у каждого фрагмента явно сохранён pageNumber: две ATTRIBUTE_HEADER на49, MATERIAL_SCOPE и primary на50. Это research schema, не утверждённое расширение production contract. У РД один MATERIAL_SCOPE и один primary на4. Исходные строки и пробелы не очищены в evidence; пробелы нормализуются только для сопоставления грамматики.

`research-concrete-prototype.py` — отдельный pure Python prototype только в output. Не импортирует production engine/helper, в частности rebar parser. Строгие страницы/line boxes, уникальные anchors, полный класс/предложение и локальная геометрия проверяются заново. Конкурирующая декларация, разбитая между строками одного блока, также приводит к abstain: block join используется только для подсчёта неоднозначности, не для извлечения текста.

`research-prototype-cases.py` воспроизводит packet и `research-prototype-golden.json`. У каждого synthetic vector есть операции над исходной страницей и явный ожидаемый payload/пустой результат. **123/123 PASS: 17 positive и106 negative**. Полный скан161 исходной страницы даёт ровно F0106 PDF50 и F0139 PDF4, по одному В30. Для всех123 проверены отсутствие изменения входа и повторяемость; для17 positive также отсутствие aliasing выходных bbox с входом. Public fixture повторно сравнивается побайтно после выполнения.

Отдельные positive vectors удаляют/портят ПД rebar blocks4/5, РД rebar45 и строку32:11 о распалубке, вместе и по отдельности. Во всех них бетонный payload остаётся тем же. Изменение чужого табличного B40 наB25 также не меняет лестничный В30. Negative vectors покрывают отсутствующий/неadjacent/malformed/duplicate header, неверный scope/member, неполную строку, F/W/П/50% вместо класса, неразрешённые классы, ranges/alternatives, negation/quotes, split competing anchors, coarse/missing/fractional/bool/unsafe geometry, union/overlap/column/gap/quality/stage mutations.

Воспроизведение: `services/worker/.venv/bin/python output/matrix-t32-20261018/research-prototype-cases.py`. Результаты: `research-prototype-results.json`, контрольные суммы: `research-receipt.json`.

Ограничения: это локальная проверка прототипа, ещё не независимая Python/TS parity, не engine/API/PG/browser acceptance. Same-source authenticity предыдущей страницы должен обеспечить caller из immutable source artifact: одинаковый pageNumber/текст этого не доказывает. Оригинал проверяет только previous-page PD header; current-page branch требует отдельного controlled случая перед production. Synthetic операции не пересчитывают character-count metrics quality: disposition взят из исходного text artifact; claims об одобрении документа не создаются. Никакие существующие runtime, registry, contracts или production tests этим пакетом не менялись.
