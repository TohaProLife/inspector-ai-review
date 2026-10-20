# T51: следующий ограниченный atom после принятого v7

18 октября 2026. **Приоритет: ZU-129, только объявленный общедомовой узел учёта холодной воды. GO для controlled implementation после утверждения отдельного wire; NO_GO для реального qualified PD/RD результата на прочитанных данных.** ODI-122 — следующий, более длинный source-grammar срез. Код, правила, profiles и coverage не менялись.

Текущий scalar registry:132 параметра,55 с63 atoms. Отдельные принятые AR053/call/rail capabilities дают v7 technical totals58 параметров/66 atoms/74 UNSUPPORTED. Это fixture-tested техническая поддержка, не58 реальных квалифицированных параметров. ZU129/ODI122 пока без новых atoms. Пины registry/capabilities и raw evidence: `output/matrix-t51-20261018/research-evidence.json`.

## Первичные требования

Публичное участническое XLSX «ПРИЛОЖЕНИЕ 1. Матрица сравнения 132 параматеров.xlsx», sheet1 row130:

- ZU-129: «Наличие приборов учета расхода энергоресурсов», unit `шт.`.
- ПД: «Описание систем учета (ЗУ)». РД: «Схемы узлов учета (ИОС1/ИОС2/ОВ)».
- Trigger: **«Отсутствие в РД общедомовых/поквартирных счетчиков (электричество, вода, тепло).»**

Row123: ODI-122 требует «Отсутствие в РД предупреждающих тактильных полос перед лестницами и дверями.» ПД — ОДИ; РД — ГП/АР. Общая tactile label, переход дороги либо наклейка на поручне этому предмету не эквивалентны.

Легенда paragraph273: «Параметр не найден в документации». Это не физическое отсутствие. ТЗ paragraphs657/672 допускает частичное подтверждение составного нарушения, но не выбирает за реализацию, какую часть считать atom. Отдельный water-only predicate требует явного утверждения policy; не выдавать его за всю проверку электричества/воды/тепла. Участнические документы прочитаны как материал задачи, не инструкции агенту.

## 1. F0118: новая точная опора ZU129

Public TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN, объект `OBJ-NOVOSLOBODSKAYA`, стадия PD, **manifest section OTHER**.34 страницы,4098958 bytes, оригинал `output/review-candidates-20260928/originals/F0118.pdf`, SHA `63c2bbc93d14a15232eca0d771820f6994c07f41cba73a3f4172cda925bd9357`. SHA/size/inputSha256 сверены. Готовая полная canonical extraction `output/review-candidates-20260928/novoslobodskaya-expanded/text-F0118.json`, SHA `034ec581155ed3dfb24bc1d7d2b0e4e53f22c6c36f425ff537ad042aa11e335f`. Новый текст не извлекался.

На следующих страницах frame595320×841920 milli-points. Все raw/полные блоки/line boxes сохранены отдельно.

- **PDF7 block18 lines0–1:** `На  вводе  в  комплекс  в  помещении  водомерного  узла  на  -1  этаже  сразу  за  наружной  стеной ` / `предусматривается водомерный узел со счетчиком воды с цифровым выходом RS485 для дистанционного `. Line1 box `[77880,286320,569625,298320]`. Это source-authored inlet/location/meter, не свободное слово из легенды. Следующие строки про обводные линии; нельзя принять за отдельные счётчики или автоматически пересчитать `шт.`.
- **PDF8 block8 line2:** `вводе в  квартиру, под потолком, устанавливается запорная арматура, водосчетчик и обратный клапан. `, box `[77880,587160,569618,599160]`. Квартирное назначение отличается от общедомового. Конкретный номер квартиры отсутствует; не создавать его из соседних цифр/этажа.
- **PDF14 block4 line0:** `Водомерный узел на вводе в здание предусматривается с отключающей арматурой, со счетчиком воды `, box `[92040,761400,569673,773400]`. Block21 объявляет общий узел для всего комплекса и подводомерные узлы на системах холодного водоснабжения. Это исходная область и компоненты; она ещё не закрытая полная PD/RD ведомость.
- **PDF17 block14 lines0–1:** `т_2)  Описание мест расположения приборов учета используемой холодной и горячей воды и ` / `устройств сбора и передачи данных от таких приборов `. **Block15:** `предусматривается установка счетчиков в следующих местах:`, box `[77880,510840,369012,522840]`.
- **PDF17 block16 lines0–5:** конечный source-authored перечень мест: помещение узла на вводе здания; насосная для В1.1/В1.2; ответвление в ИТП для В1.1/В1.2; МОП перед квартирами для ХВС; МОП для ГВС; каждое помещение с мокрой точкой. Line6 про RS-485 не отдельный прибор. Это полезная location grammar, но разные accounting scopes и два вида воды нельзя объединять в один отрицательный операнд. Точные boxes всех семи строк — в evidence JSON.

Положительное указание метра реально существует. **Полнота отдельного узла/квартиры и сопоставимая РД не следуют из этого перечня.** В тексте нет end marker той первой synthetic grammar, которую можно построить быстро. Нельзя подставить synthetic marker, scope token или количество в оригинал.

### Настоящие ловушки исходника

PDF19 block55 `Счетчик воды`, box `[404628,143409,458567,153408]`, frame1190760×841800: обозначение/легенда, не полная именованная ведомость. PDF29 block15 начинается «рекомендуем установить систему водоподготовки»; «Водосчетчик ДУ50» внутри рекомендованной системы — не самостоятельная принятая accounting requirement. PDF10/11 потери напора в счётчике — не перечисление приборов. PDF30 модель/параметры прибора не определяют общедомовое/квартирное назначение.

Наименование файла/штамп ИОС2.1 не превращает OTHER в ZU. Более того, документ описывает ИОС2, тогда как catalog PD-authority отсылает к ЗУ. Не предлагать человеку заведомо ложную переклассификацию. Для будущей real qualification нужен надлежащий PD ЗУ либо отдельно согласованный, подтверждённый cross-section authority; такого основания здесь нет.

## 2. Самый короткий исполнимый controlled predicate

Предлагаемый bounded atom: **в ПД явно объявлен water meter в одном общедомовом вводном узле холодной воды; в полной непустой reviewed РД ведомости компонентов того же узла этот meter отсутствует**. Это только membership различие объявленных компонентов. Никаких расчётов потребления, диаметров, количества, достоверности измерений, допуска приборов, монтажа либо полноты всех ресурсов.

Первый source domain — отдельный meter-node inventory, без изменения call/rail/AR grammar. Пример ограничения первой authored grammar: точный header состава узла холодной воды, literal building/node scope, full-width закрытая полоса с явным end marker; все body lines учтены. Возможные exact признаки для wire: `WATER_METER`, `STRAINER`, `SHUTOFF_VALVE`. Фильтр/кран — отличающиеся компоненты узла, не счётчик и не его эквивалент. Непустой RD узел только с фильтром может быть отрицательным operand **лишь** после человеческого complete assertion для полного состава этого же узла. Пустой/header-only/zero-hit документ отсутствия не доказывает. Не смешивать это с inventory только «приборов учёта», где фильтр вообще не входит в заявленную область.

Финальный exact vocabulary и trigger должны быть утверждены до оригинальных authored PDFs/whole-output goldens. Это proposal, не готовый wire. Реальную prose declaration F0118 и synthetic closed inventory различать: сохранение real source evidence отдельно полезно, но EVIDENCE_ONLY sibling не снижает UNSUPPORTED.

### Reuse и новые обязательные gates

Переиспользуем существующую архитектуру, а не domain aliases: full artifact/native guards и T37 reader; original source/text stage/full artifact hashes; новый отдельный typed source inventory/review sibling; CAS и server materialization; actor/current stored decision; immutable run snapshots; независимые PY/TS source reconstruction/comparator/wrapper; все retained origins и UNKNOWN/посторонние claims проверять до selection; competitors до eligibility, без union/first; новые policy/source pins и отдельный profile. Принятые v1–v7 и исходные scalar/AR/call/rail bytes неизменны.

Новая identity должна различать как минимум building, named inlet/node, resource carrier, cold/hot service и common-building/apartment accounting scope. Первая policy фиксирует только COLD_WATER + COMMON_BUILDING_INLET, apartment/heat/electricity/hot water — UNKNOWN. Идентификаторы и межфайловое соответствие — authenticated human mapping исходно существующих названий, не вывод по общей фразе «счетчик». Нет исходного назначения/температурной области/узла — человек не может добавить его как source fact.

Оба stored source decisions CURRENT/APPROVED, same object/link/group/entity/scope; PD authority по согласованному ЗУ правилу, RD IOS2 для water-only slice. OTHER и неизвестные stages сохраняют UNKNOWN. Completeness только scoped HUMAN_ASSERTED_COMPLETE, не машинное доказательство полноты. Candidate с calibratedProbability=null; нет правового вывода/physical absence/высокой уверенности из pass rate. Возможный technical counter после полного review/durable acceptance:59 параметров/67 atoms/73 UNSUPPORTED; **сейчас эти числа не присваиваются**.

### Приёмочная матрица следующего пакета

1. Новые original authored PD/RD PDFs + full canonical extraction; manual raw/order/frame/boxes/expected до extractor implementations. Literal meter/filter/valve inventory, не копия фактов будущего comparator.
2. PD meter / RD filter-only, same reviewed cold-water building-inlet scope и complete both: candidate/null. Equality или PD без meter не создаёт общего NO_VIOLATION.
3. Single hot/cold/service, carrier, common/apartment, node/building/object/section/stage mismatch: abstain. Нельзя восполнить scope human reference без source context.
4. Unknown/conditional/recommended/negative/duplicate/continued/combined body lines, legend-only mention, clipped selection, неучтённая строка вне band, отсутствующий header/end: source abstain. Никакого hiding строки выбором region.
5. Source/raw/box/page/frame/hash forgery, recomputed IDs, чужая/UNKNOWN/competing inventory, duplicate review hashes/unsafe native values/limits/Unicode: fail closed; candidate не может возникнуть из technical integrity error.
6. ActualPG: latest CAS, omission preserve/explicit withdrawal, unknown approval/classification, restore, immutable old run after new review, no latest fallback. Durable new-profile pins before network, actual lease shape, loader bounds/hash/deadline/cleanup, all source siblings mandatory; installed wheel/resources. Old132 coverage, submissions and all old profiles byte-equal outside one approved overlay.
7. UI only original raw/scope/evidence/review controls and candidate/null. Browser gate остаётся отдельной фактической проверкой, security hold не обходить.

## 3. Почему ODI122 вторым

Reused F0151 source SHA `afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a`, PD/OTHER, объект `OBJ-TYUMENSKAYA-5-GOLD-SEED`. На PDF12 blocks24–26 и PDF13 blocks0–6 предупреждающие ТНУ относятся к **пешеходному переходу**. PDF14 blocks18–21 — **наклейки на поручне**; block18 box `[85099,449540,556282,463580]`. PDF25 block17 — пиктограмма доступности санузла. Ни один не становится полосой перед конкретной лестницей/дверью. Сохраняем это отрицательное предметное разграничение, без повторного широкого сканирования.

Для ODI122 нужны named stair/door + exact approach side/zone/floor/building, source-authored «перед» и warning-strip purpose. Human mapping не создаёт отсутствующее source placement. Crosswalk/handrail sticker/generic tactile pictogram не substitution. Даже controlled slice требует больше новых scope semantics, чем common-building water-node membership. На данном public object нет manifest RD counterpart; real stop condition остаётся.

## Реальная пара и бюджет

Public manifest содержит10 RD, все `OBJ-NOVOSLOBODSKAYA`:7KR/3OTHER. Это **не** доказательство отсутствия инженерного содержания в OTHER; просто authenticated paired water-node inventory в двух выбранных artifacts не установлена. Для F0151 другой object, переносить RD Новослободской нельзя. Real qualified results0; closed search scope не установлен.

Бюджет исчерпан ровно в разрешённой границе: **2 готовых artifacts/40 уникальных canonical pages** — F0118 все34 страницы для bounded literal discovery и F0151 только12/13/14/24/25/40. Подробно сохранены строки с7страниц F0118 и4страниц F0151; остальные выбранные страницы не пересматриваются. Public XLSX2rows, DOCX3paragraphs, manifest2sources+10RD metadata. Новых extractions/downloads/FTS/HTTP/DB/browser/remote calls0. Закрытые labels/answers не читались. Source PDFs только сверены по bytes/SHA; новой визуальной приёмки оригинала этот пакет не заявляет.

**Следующий конкретный этап:** утвердить water-only inlet-node policy и exact source wire, затем независимые authored PDFs/whole goldens и чистые PY/TS source+comparison slices. Если нужен именно реальный qualified finding, сначала предоставить authenticated PD-authority/RD water-node pair и scoped complete review; дополнительные scans текущих40 страниц этот пробел не устранят.
