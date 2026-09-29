# Исполнение правил, evidence и coverage

Версия 1.2. Единица machine output — atomic rule result на конкретной сущности и наборе сопоставимых источников. Число таких результатов может превышать 132. Хакатонный предмет проверки — расхождения ПД/РД/ИД, а не самостоятельная нормативная экспертиза ПД. Извлечение следует [маршруту по параметру](06_DOCUMENT_PIPELINE.md#21-маршрутизация-по-параметру).

## Исполняемый каталог

Исходные 132 записи импортируются неизменённо в matrix_version. Для каждой создаётся mapping к одному или нескольким atomic rules. Реестр реализации содержит parameter_code, owner, comparator family, source requirements, implementation_status, validation fixtures и accepted release. Код вне матрицы имеет matrix_scope=FREE; FREE-HEATING-001 не добавляется как 133-й параметр.

Поэлементный проект для всего каталога — [14_PARAMETER_IMPLEMENTATION_MATRIX](14_PARAMETER_IMPLEMENTATION_MATRIX.md). Название параметра, unit и trigger иногда описывают разные величины; 14 фиксирует такие места вместо неявного выбора одной интерпретации.

Rule version содержит:

| Поле | Семантика |
|---|---|
| rule_id, version, matrix_version, parameter_code?, scope | Стабильная идентичность и источник |
| entity_schema, comparison_variant | Что именно сравнивается; отдельные PD_RD/PD_ID/RD_ID при необходимости |
| applicability | Типизированное условие по признакам объекта; UNKNOWN не равен false |
| required_sources, allowed_stage_pairs | Типы документов, обязательные роли, scope страниц/систем |
| revision_policy, approval_policy | Допустимость источников |
| extraction_targets, field_types, units | Контракт извлечения |
| normalization_profile | Decimal, единицы, категории, допустимые aliases |
| comparator, operator, threshold, tolerance, denominator_policy | Смысл проверки без свободного eval |
| evidence_requirements | Источники/локализация/negative search coverage |
| normative_refs, effective_dates | Версионные основания |
| review_priority | HIGH/MEDIUM/LOW; не юридическое действие |
| abstention_codes, implementation_status | Причины отказа/неисполнения |

DSL ограничен allowlisted операциями; хранить произвольный Python/JavaScript/SQL в rule config запрещено. Публикация правила требует валидации схемы, предметного review и fixtures на границах.

## Семейства сравнений

| Семейство | Пример каталога | Исполнение |
|---|---|---|
| Numeric absolute/relative | PZ-002, SPZU-024/025, KR-067, SM-132 | Decimal, общий unit, установленный знаменатель, threshold и tolerance |
| Ordered category | KR-055, PPM-103, PZ-015/021/022/023 | Versioned rank/domain relation, а не сортировка строк |
| Presence/set difference | AR-044/053, ODI-120/122/123, ZU-129 | Полный сопоставимый scope, inventory элементов, negative coverage |
| Geometry/topology | SPZU-034/035, AR-043, KR-054/064, PPM-102/114 | Калиброванный масштаб, привязка элемента, geometry transform |
| Approved change/context | AR-052, PZ-004, IOS2-072 | Наличие применимого согласования как отдельный prerequisite |
| External registry | OOS-098…101 | Версионный ответ разрешённого источника и freshness; без него abstention |

Пересекающиеся AR-041/PPM-105 и подобные правила имеют самостоятельный coverage, но могут объединяться одной UI-группой. Scorer получает atomic units в соответствии со своей методикой; UI-дедупликация не удаляет официальные коды.

## Порядок исполнения

1. Проверить, реализовано ли правило: иначе UNSUPPORTED, machine_status=null.
2. Определить применимость. Доказанное false → NOT_APPLICABLE; неизвестность → CLARIFICATION_REQUIRED.
3. Проверить обязательные sources. Нет документа/фрагмента → MISSING_EVIDENCE с точным требованием.
4. Проверить revision/approval/link gates. Неясность → CLARIFICATION_REQUIRED; доказанная несопоставимость → NOT_COMPARABLE.
5. По `extraction_targets` извлечь typed values из текста, таблиц и векторной геометрии; визуальный поиск вызывать только для предусмотренного правилом графического факта, который этот путь не подтвердил. Проверить кандидатов по контексту и нормализовать подтверждённые значения. Ошибка OCR/качества или пропуск кандидата не становится «значение отсутствует» без достаточного поиска.
6. Проверить соответствие фактов одной сущности, системы и помещения; затем выполнить comparator. Выполнен trigger → CANDIDATE; trigger не выполнен при достаточных источниках и проверенном scope → NEGATIVE_VERIFIED.
7. Проверить evidence bundle. Недостаточность понижает вывод до соответствующего abstention; объяснение не компенсирует отсутствующий источник.
8. Сохранить output, rationale, versions, timing, reason codes; human status не задавать.

Предметный abstention считается успешно выполненным решением gate. Техническая ошибка stage даёт execution=FAILED и не маскируется предметным status. При нескольких необходимых источниках запрещено выбирать один удобный и забывать остальные.

Рамка от шаблона или модели — предложение о местоположении, не доказательство типа прибора и не готовый finding. Если выноска указывает на соседний прибор, номер помещения относится к нескольким областям или поиск не охватил все нужные листы, правило сохраняет альтернативы/причину abstention. `NEGATIVE_VERIFIED` для отсутствующего элемента требует того же контроля охвата, что и положительный вывод.

## Нормализация

Raw value остаётся неизменным. Normalized value имеет type: decimal/string/boolean/enum/geometry/set, value, canonical_unit, normalization_version, source_unit, quality и uncertainty при необходимости.

Числа с запятой, пробелами тысяч и единицами разбираются по явной grammar. Dimension проверяется до conversion. 900 мм и 0,9 м равны после conversion; неизвестная единица → abstention. Диапазоны и «не менее» — отдельные typed constraints, не одно число.

Пример PZ-002: относительное изменение = abs(actual−expected)/abs(expected), порог 0.01 по исходному каталогу. expected=0 требует отдельного правила; default NOT_COMPARABLE с ZERO_BASELINE. Порог трактуется как строгое `>`; округление только при отображении. Этот пример описывает каталог, не подтверждает юридическую применимость порога ко всем объектам.

Класс бетона — предметная категория; не оценивать его через casefold-only или lexicographic order. Различие написания технического кода нельзя безусловно удалять как «пунктуацию».

## EvidenceBundle

Обязательные поля: result_id/review_item_id, scope, rule/parameter, entity_key, location_raw/display, expected/actual/delta, machine_status, reason_code, rationale, review_priority, model_release, link decision, evidence_fingerprint.

Каждый источник содержит source_file_id, official_file_id?, SHA, document version/code/revision, approval status/evidence, stage, source page и sheet, canonical locator, page transform version, role и extracted value. Источник context (например, согласованное изменение) обязателен, если от него зависит вывод.

Confidence объект: extraction_score?, linking_score?, calibrated_probability?, calibration_version?, confidence_kind. Отсутствующий показатель null. Нельзя усреднять несопоставимые scores в «точность 94%». Некалиброванный rank можно показывать как эвристическую оценку, но не вероятность правильности.

Для положительного вывода проверять полноту всех источников. Для absence finding — evidence существующего требования + явно ограниченная проверенная область/ведомость, доказывающая отсутствие. Source page без bbox имеет localization_level=PAGE, не засчитывается как полный BBOX-evidence.

## Свободный поиск

Разрешены logical, semantic, rule-reference и anomaly стратегии внутри сопоставления ПД/РД/ИД. Нормативная ссылка может объяснять существующий comparator, но свободный поиск не проверяет сам проект на соответствие СанПиН, СП или иной внешней норме. Первичный output всегда SUSPICION, с discovery_method, источниками и условиями проверки. Свободный поиск не может формировать CONFIRMED_VIOLATION и не входит в число матричных параметров.

PROMOTE — человеческая команда построить новый atomic candidate с полным evidence и rule identity. Создаётся HUMAN_PROMOTION review item с lineage к исходному result; frozen model predictions прежнего run не дописываются. Если для promotion нужны новые извлечения/согласования — новый analysis run. Исходная SUSPICION остаётся в истории.

## Coverage и сводка

Для каждого parameter_code: planned atomic rules, implemented count, applicability, discovered entities, executed groups, successful comparisons, abstentions, failures, unsupported, evidence completeness. Если entity discovery не покрывает требуемую область, параметр не получает полный coverage даже при успешном сравнении одной комнаты.

API возвращает раздельно: catalog_parameters=132; implemented_parameters; applicable_parameters и unknown applicability; fully_executed_parameters; atomic candidate/negative/abstention counts; free suspicions; human confirmed/pending counts. Последние не складываются с параметрами в 132.

Headline partition определяется после seal в следующем порядке: `UNSUPPORTED` — нет ни одного реализованного atomic rule; `TECHNICAL_FAILURE` — нет пригодного результата из-за сбоя; `PARTIAL` — реализован/обследован не весь требуемый scope либо есть отдельные technical/unsupported gaps; `EVALUATED` — все предусмотренные gates/rules завершены без технического пропуска. EVALUATED может содержать предметный abstention: это не successful comparison. Эти четыре bucket взаимоисключающие и в сумме дают 132. Числа fully_compared/applicable/negative — дополнительные показатели со своими знаменателями; не подписывать EVALUATED как «расхождений нет». До seal есть пятый bucket PENDING.

Если у параметра есть и успешные, и неисполненные группы, rollup PARTIAL. «Без расхождений» допустимо на уровне параметра только при полном требуемом scope и отсутствии candidate/unknown/gaps. Остальные выводы сопровождаются покрытием.

## Выбор первого набора

Предлагаемые R1 candidates: PZ-002, PZ-007, KR-055, PPM-103, ZU-125 и один IOS4 после согласования mapping. До фиксации R1 проверить наличие разрешённых реальных источников/отрицательных fixtures. Замена кандидата допускается по documented data availability, а не по удобству получения высокой метрики. Полный runtime coverage ledger обязателен независимо от размера R1.
