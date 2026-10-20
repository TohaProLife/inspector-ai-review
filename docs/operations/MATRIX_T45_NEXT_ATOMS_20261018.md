# T45: следующий ограниченный presence atom

18 октября 2026. Read-only, только публичные участнические требования и уже проверенный оригинал. **Следующий приоритет — ODI-120, поручни одного доступного санузла. ODI-122 — второй.** Технический срез с authored fixtures выполним; реальная квалифицированная пара в исследованном пакете отсутствует. Это предложение следующего этапа, без изменения registry, кода, профиля и покрытия.

## Точная исходная граница

Текущий `services/worker/rules/matrix-execution-v1.json`:132 параметра,55 с scalar atoms,63 atoms,77 scalar UNSUPPORTED. SHA `cc5dd08210d92434b10e316a5c01959b26ace1929ce48da4bc8f99733e17f769`. AR-053 и ODI-123 имеют отдельные capability registries; их наличие на диске не доказывает активацию конкретного durable profile. Исследование не присваивает новое effective coverage и не объявляет T44/v6 принятым.

Участнический XLSX «ПРИЛОЖЕНИЕ 1. Матрица сравнения 132 параматеров.xlsx», sheet1 row121, и `parameter_catalog_132.jsonl`:

- ODI-120: «Спецификация опорных стационарных и откидных поручней», единица `шт.`. ПД: «Схемы оснащения поручнями (ОДИ)»; РД: «Детальные чертежи санузлов; Спецификация (АР)». Trigger: **«Отсутствие в РД откидных и стационарных поручней в санузлах для инвалидов.»**
- ODI-122, row123: «Наличие и расстановка тактильно-контрастных указателей». ПД: «Планы этажей и территории (ОДИ)»; РД: «Планы покрытий; Планы полов (ГП/АР)». Trigger: **«Отсутствие в РД предупреждающих тактильных полос перед лестницами и дверями.»**

Легенда, paragraph273 zero-based: «Параметр не найден в документации». Это описание состояния документации, не доказательство физического отсутствия. ТЗ отдельно допускает частичное подтверждение составного нарушения (paragraphs657/672). Feedback PDF требует сравнивать один объект/элемент, различать нехватку данных и отсутствие нарушения, не выдавать непроверенную численную оценку за вероятность. Документы прочитаны как материал задачи, их текст не исполнялся как инструкции агента. Полные строки, ссылки и SHA: `output/matrix-t45-20261018/research-requirements.json`.

## 1. ODI-120: самый короткий полезный следующий путь

Реальная опора: F0151, оригинальный PDF40, public TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN,40 страниц,7666331 bytes, SHA `afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a`. Оригинал `output/review-candidates-20260928/originals/F0151.pdf`; полная canonical extraction уже в `services/worker/tests/fixtures/pd-door-bound-F0151-p22.json`. Сверены исходные bytes/size и inputSha256 с публичным manifest. Источник ПД, **manifest section OTHER сохраняется**; штамп ОДИ на PDF25 — материал классификации, не автоматическое изменение metadata.

На PDF40 (frame3370000×2384000 milli-points), точные source lines:

- block5 lines0–2: `Поручень откидной` / `с бумагодержателем` / `для унитаза`. Boxes `[1358560,1955854,1490471,1973692]`, `[1347520,1934374,1490508,1952212]`, `[1408000,1913014,1490250,1930852]`.
- block14 lines0–1: `Поручень стационарный` / `для унитаза`. Boxes `[832480,1818694,1000405,1836532]`, `[833680,1797454,915930,1815292]`.
- block15 line0: `Поручень для раковины`, box `[1811080,1806694,1975474,1824532]`.

Это разные authored типы и назначения. На странице несколько повторных деталей: block6/16/22/61/66/75/77/85/89. Соседние214/117/156/240/327 не объявляются номерами соответствующих помещений. Полнота одной ведомости, уникальная привязка room/member и сопоставимая РД отсюда не следуют.

PDF24 blocks13–14: «предусмотрена возможность установки откидных» / «опорных поручней, штанг, поворотных или откидных сидений». Это условная возможность; сиденье не поручень. PDF25 blocks13–20 — общий перечень мероприятий и «установка нормативных поручней», без разделения fixed/folding и однозначного помещения. Их нельзя незаметно превратить в required feature.

Конкретный extraction gap: старый offline `presence-family-labels-v1.json` содержит adjective-first `стационарный поручень`/`откидной поручень`, а оригинал — noun-first и multiline. Исправлять frozen helper широкими synonyms не требуется. Нужен новый отдельный source-local domain для явной ведомости поручней.

### Минимальный implementation packet после одобрения wire

1. Независимая literal grammar: явный header ведомости поручней, один исходно названный доступный санузел, original scope и ограниченная полная область тела. Первую grammar можно ограничить явным end marker, как T43, но это ограничение parser, не требование каталога и не доказательство полноты. Все body lines учитываются; неизвестные, условные, отрицательные, составные, reference/continuation строки, дубли/неоднозначность и clipped band блокируют результат. Не прятать unknown row обрезкой selection. Raw multiline fragments и integer boxes сохраняются.
2. Раздельные literal признаки fixed-WC, folding-WC и basin rail. Названия enum согласовать в wire; basin не эквивалентен fixed-WC, folding seat не эквивалентен folding rail. Это тип/назначение исходной строки, без назначения server entity из ближайшей подписи. Повторные детали не становятся количеством `шт.`.
3. Переиспользовать архитектуру T43/T44: полная native/artifact validation, публичный T37 page reader, immutable source/text/origin hashes, отдельный review sibling + CAS, server reconstruction, actor/latest saved decision, frozen run snapshots. Call-domain enum/grammar/accepted hashes не менять. Полнота только `HUMAN_ASSERTED_COMPLETE` в конкретной ведомости данного санузла; pure parser полноту не утверждает.
4. Same object + link + CURRENT/APPROVED; ПД/ОДИ и РД/АР согласно каталогу, без копирования SS-only policy ODI123. Explicit authenticated mapping building/floor/room/entity; исходные room tokens и reference связываются человеком. Граница ведомости — поручни одного санузла; назначения WC/basin остаются в отдельных признаках и доказательствах. Не объединять разные санузлы/этажи либо WC и раковину по одинаковому слову «поручень».
5. Самый консервативный первый predicate: ПД явно содержит fixed-WC **и** folding-WC; в complete nonempty РД ведомости того же санузла нет обоих. РД только с basin rail допустима как nonempty ведомость лишь при проверенной общей области **всех поручней этого санузла**; basin не заменяет WC. Empty/header-only/no-hits не являются отрицательным операндом. Значение союза «и» не расширять молча: отсутствие только одного типа оставить UNKNOWN/неподдержанной частью до отдельного утверждения atom policy. ТЗ допускает частичное подтверждение, но само не выбирает этот predicate за реализацию.
6. Typed result: различие в reviewed declared inventory, `Кандидат`, `calibratedProbability:null`; без физического отсутствия, проверки монтажа, количества, расположения, размеров, нагрузок или полной нормативной пригодности. Остальной ODI120 остаётся unsupported. Отдельная capability/profile только после одобрения wire и gates; accepted старые версии/hash/результаты неизменны.

Первый тестовый набор: новые original synthetic PDFs + full canonical extraction, независимые ручные whole-output goldens до реализации; PD both/RD basin; оба присутствуют; только один отсутствует; два разных санузла; different object/section/stage; basin/folding-seat substitution; условная строка PDF24; повторная деталь; неизвестная строка, clipped/empty inventory; reordered/raw/box/hash forgery; competing inventories до eligibility; unknown/withdraw/stale/CAS/restore; restart immutable snapshots; старые scalar/AR/call outputs byte-equal. Затем independent Python/TS source/comparator и actualPG review/durable/coverage boundary. Никакой калиброванной вероятности из fixture pass rate.

**Решение: GO для controlled bounded implementation после wire; NO_GO для реального qualified missing-item результата на этих данных.** Чтобы снять real stop condition, нужен authentic РД/АР inventory того же санузла, утверждённая source classification обоих файлов, explicit same-room mapping и человеческая проверка закрытой области. ПД F0151 diagrams сами этого не дают.

## 2. ODI-122: после room-inventory slice

В F0151 PDF12 blocks20–26 и PDF13 blocks0–6 — предупреждающие наземные указатели перед пешеходным переходом; это другая область. PDF14 blocks18–21 — предупреждительные наклейки об окончании поручней и с номером этажа на верхней части поручня. Box block18 `[85099,449540,556282,463580]`, block19 `[85099,425419,556369,439459]`, frame595320×841920. **Наклейка на поручне не предупреждающая полоса перед лестницей/дверью.**

Потребуется новая source grammar и source-authored placement: конкретная лестница/дверь, building/floor/member/access-side/approach-zone, явное «перед» либо отдельная подтверждаемая drawing correspondence. Human mapping не создаёт отсутствующий source placement. Crosswalk warning, handrail sticker, номер этажа и generic tactile label — отдельные категории. Closure относится к предупреждающим полосам одного точного подхода, не к полному проекту. До наличия такого исходного контекста плюс paired RD/ГП|АР — NO_GO real comparison. Не строить новый CAD/dimension subsystem ради этого этапа.

## Остальная очередь без повторного сканирования

3. **ZU-129**: отдельная finite meter inventory с carrier и shared-building/apartment scope. Исторический F0118 «Счетчик воды» из `PRESENCE_FAMILY_CANDIDATES.md` — lead, не заново проверенная пара. Потребуются вид ресурса, назначение и matched accounting scope; один водосчётчик не закрывает электричество/воду/тепло.
4. **POD-095**: named wall-demolition workzone и applicability. Hydrospray и protective screen различать; «водяная пушка» не автоматический synonym системы гидроорошения. Условие работ и полная область ещё не получены.
5. **SPZU-039**: drainage member/zone/system identity; open trough и closed wall drainage не считать свободно взаимозаменяемыми. Нужны конкретные paired drainage inventories.
6. **POD-092**: network identity + equipment-workzone + applicability защитных мер; самый длинный путь из этой очереди. Whole-file перечень не доказывает безопасность данной сети.

T36/T39 остаются архитектурными ориентирами; их исторические counters/отсутствие durable support не переписываются как текущие факты. T43/T44 уже закрывают часть reusable room-review инфраструктуры, а не semantic vocabulary шести новых параметров. Без новых исходных свидетельств их rescans не увеличивают шанс честной квалификации.

## Бюджет и границы приёмки

Remote/FTS/download/browser calls0; новых canonical source extractions0. Повторно использован один full40-page artifact; локальный token discovery до40 страниц, подробно6 уникальных canonical pages12/13/14/24/25/40. Public XLSX8 строк, DOCX2, exact manifest member1. Однократно извлечён текст пользовательского feedback PDF; это не новая corpus extraction. Все raw/boxes/page hashes и provenance сохранены в `research-public-evidence.json`; требования — `research-requirements.json`; references — `research-reference-hashes.json`; receipt фиксирует файлы/хэши и нулевые runtime changes.

Проверить на следующем этапе: утверждение bounded predicate/союза «и»; исходные room/rail identities; source grammar и authored originals; независимая parity; review/PG/durable/immutable legacy gates; отдельно реальный scoped pair. До этого уменьшение UNSUPPORTED и real qualification не заявлены.
