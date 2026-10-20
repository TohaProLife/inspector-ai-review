# T37: геометрическая привязка строк таблицы

Статус: PURE_ACCEPTED_NOT_DEPLOYED; Python130PASS, независимыйTS142PASS/typecheckPASS,96общих независимыхvectors и23дополнительныхedgeprobes совпали. Receipt: `output/matrix-t37-20261018/acceptance.json`. После завершения T34 fullcheck root разрешил новые source/tests/fixtures. Существующие runtime, fact IDs, registry и T34 freeze не менялись. Интеграции primitive в анализ пока нет.

## Ограниченный контракт v1

`bind_table_rows(page, policy)` принимает одну полную canonical `document-text-v2` page и явную геометрическую policy. Источник/SHA, стадия, нормативная применимость, связь с объектом и происхождение policy аутентифицируются вызывающей стороной. Primitive не читает source ID, не выводит section/stage/entity, не интерпретирует значения и не даёт semantic approval.

Policy:

- `schemaVersion: 'table-row-binding-policy-v1'`;
- `tableBoxMilliPoints: [left,bottom,right,top]`, граница проверяемой области, включая заголовки;
- `columns`: ровно один `ROW_LABEL` и минимум один `VALUE`; у каждой колонки opaque `key`, непересекающийся `xRangeMilliPoints`, обязательные `headerAnchors`. У `VALUE` дополнительно непустые `unitAnchors`; у `ROW_LABEL` unitAnchors пусты;
- каждый anchor — `{blockIndex,lineIndex,rawText}` с точным Unicode/raw, без trim/regex. Header и unit — разные полные исходные строки; unit может быть строкой с поясняющими словами, primitive не утверждает, что понял её семантику;
- `rows`: opaque `key`, непересекающийся `yRangeMilliPoints`, полные `labelAnchors` и `valueLineCounts` с точным количеством строк для каждой VALUE-колонки. Порядок rows строго сверху вниз; columns слева направо;
- `maxLineGapMilliPoints`: явная неотрицательная граница вертикального разрыва внутри многострочной ячейки, без поиска ближайшей строки.

Exact valueLineCounts необходимы, чтобы вставленная промежуточная строка не стала незаметно новой частью многострочного значения. Policy задаёт прямоугольники/структуру, но не передаёт ожидаемые численные значения. Значения выбираются исключительно полным containment исходных line boxes в пересечение колонки и полосы строки. ROW_LABEL cell должна совпасть с объявленными labelAnchors целиком.

Все header/unit anchors должны находиться внутри своей колонки/таблицы выше всех body rows. Каждая непустая строка, пересекающая tableBox, обязана полностью содержаться в области и получить ровно одну роль: header, unit, label или value. Необъявленная строка в промежутке, пересечение границы, лишняя label-строка, duplicate/overlap, конкурирующие значения и отсутствующий header/unit дают отказ всей таблицы. Строки вне tableBox не рассматриваются как конкуренты: scope задаёт явная policy. Пустые строки не являются данными. Неполная/повреждённая line geometry не исправляется.

Успех: `{schemaVersion:'table-row-binding-result-v1',status:'BOUND',tableBoxMilliPoints,columns:[...headerFragments,unitFragments...],rows:[{key,yRangeMilliPoints,cells:[{columnKey,role,fragments:[{pageNumber,blockIndex,lineIndex,rawText,bboxMilliPoints}]}]}]}`. Порядок fragments сверху вниз, без склейки/нормализации raw. Полные anchors присутствуют в output.

Отказ: тот же schemaVersion, `status:'ABSTAIN'`, один typed `reasonCode`, `rows:[]`. Частичных успешных строк нет. Неправильная форма policy — `ValueError`; неверная/непригодная source page — typed abstention. Ни probability, confidence, parameter, entityKey, coverage, approved scope, ни новые scalar facts не возвращаются.

## Реальные layouts для проверки

1. F0106 PD/KR PDF51:6 верхних строк конструктивных ролей и R/REI. Точная геометрия2-строчной подписи перекрытий и единица `мин`. Никакой fire-specific логики в primitive.
2. F0126 PD/GP PDF20:4 строки ведомости покрытий по грунту, исходные raw площади7/8/112/42м²,2–3-строчные подписи и отдельные `- тип` внутри label cell. Header unit — полная строка `покрытия, кв.м. в`. Соседнюю таблицу по кровле и конструктивные узлы исключает явный tableBox, без выбора по source ID.

Fixtures сохраняют полные исходные pages, provenance/SHA исходных доступных artifacts и policy, без вырезания конкурирующего текста. Независимые expected fragments собраны из явно перечисленных source references, без вызова binder. Native cases: bool/float/unsafe integers, суррогаты, cycles, неверная page/quality shape, malformed policy. Portable vectors: отсутствие/подмена anchors, overlaps, duplicates, interleaving, wrong column/row, multiline gaps/counts, Unicode/raw preservation, неизменность входа и повторное извлечение. Врезки в правила, новые downloads/FTS, stand/browser проверки отсутствуют.


## Точный wire и неоднозначности

`output/matrix-t37-20261018/research-wire-contract.json` фиксирует exact keys,20 typed reasons и failure precedence. Policy проверяется первой: неверная/слишком большая policy вызывает ValueError, даже если page тоже неверна. Затем полная page, table boundaries/overlap, anchors в порядке columns, rows/cells и остаточные строки. Для source page нет исключения из-за native shape: typed ABSTAIN с пустыми rows.

Пересечение прямоугольников — строго положительная площадь; containment включает границы. Касание внешней строки ребром table не делает её строкой таблицы. Columns и rows могут касаться границами, но не пересекаться площадью. Невырожденная строка не может целиком принадлежать двум ячейкам; пересекающая cell boundary не разрезается и не привязывается по расстоянию. Совпадающие boxes любых непустых строк внутри table дают OVERLAPPING_LINES. Непопавшая строка может сначала вызвать CELL_LINE_COUNT/ANCHOR_OUTSIDE_CELL; если counts/anchors уже проходят, остаток даёт UNASSIGNED_CONTENT.

Порядок fragments: `[-top,left,-bottom,right,blockIndex,lineIndex]`, только целые числа. Никакой сортировки raw/locale. Явные label/header anchors могут быть соседними фрагментами на одной высоте; VALUE строки с пересечением вертикальных интервалов дают AMBIGUOUS_CELL_LINES даже при горизонтальном разнесении. Дубли raw внутри ячейки и одинаковые полные label tuples разных rows запрещены. Одинаковое значение в разных rows допустимо.

Для body cells gap равен `previous.bottom-next.top` и не превышает явный maxLineGap; одинаковая высота частей label может давать отрицательный gap. Header/unit groups с явными refs проверяются на порядок и владение, без неявного обещания их семантической близости. В F0126 unit130:1 лежит между header130:0/130:2; он сохранён отдельной исходной строкой.

## Полная page и native domain

Принимаются только plain Python dict/list/int/bool/str/None с проверкой точного типа до traversal. Geometry/count/index не принимают bool, float, unsafe integer. Cycles, subclasses/объекты с кодом, surrogate строки не проходят. Scalar Unicode object keys допустимы, в том числе opaque column keys в valueLineCounts. Native integral float неотличим от integer после JSON parsing в JS; wire goldens используют fractional/unsafe числа, отдельный Python native test не заявляет лексическое различение `1.0`/`1` в JSON.

Page frame/pageNumber — положительные safe integers. Exact quality shape: disposition/metrics/reasonCodes, пять standard metrics, blockCount равен полной длине blocks. OCR_REQUIRED даёт TEXT_LAYER_UNAVAILABLE. Каждая исходная строка определяется только split по LF; terminal LF сохраняет пустую строку и её box. Block box обязан точно равняться union всех line boxes; ни line boxes из coarse box, ни исправление/клиппинг не допускаются. Проверяется вся page, включая строки вне table. C0 controls кроме TAB/LF, CR, U2028/U2029/UFFFD запрещены; raw остальных Unicode scalars не нормализуется. Пустота определяется Python strip; nonblank output остаётся точным. JS port должен зеркалить Python whitespace, включая U0085/001C..001F, сохраняя BOM.

## Версионные лимиты и стоимость

- 16 columns,512 rows,32 anchors/group,32 lines/value-cell.
- 2048 total anchors и2048 declared header/unit/label/value lines суммарно.
- 8192 page blocks,32768 page lines,2048 nonblank table lines.
- 8192 codepoints/line,2M codepoints/page,4M UTF-8 bytes/page text.
- Portable traversal:200000 nodes,32768 items/container,8M UTF-8 bytes всех strings/keys,depth64; safe integers <=2^53-1.

Все лимиты совместные: предельная ширина shape может исчерпать node budget раньше block cap. Policy sums проверяются до выделения cells. Page portable scan предшествует source property access и geometry scan. Anchor map один; два binary interval lookups на source line, сортировка внутри cells, y-sweep overlap с абсолютным cap2048. Нет произведения rows×columns×all-lines. Sweep worst-case квадратичен в ограниченном table line inventory; контракт не обещает subquadratic worst case.

## Проверки и граница результата

Committed fixtures: `services/worker/tests/fixtures/table-row-binding-v1/`. Два real expected собраны явными source refs без импорта binder; `portable-goldens.json` содержит96 независимых vectors. Native tests проверяют hostile shapes, limits, input/output isolation, multiple VALUE columns, ROW_LABEL справа, два разных корректных региона одной page и maximum512rows. Проверка geometry call counts исключает полный перебор всех rows×lines на этом плотном fixture. Это pure local evidence, без browser/deployment/production performance утверждений.

Полная F0106page51:26 blocks,6 bound rows; исходный PDF SHAae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655 перепроверен. Полная F0126page20:265 blocks,4 rows; canonical artifact SHA638c21dda6c005479b110236997657b98119e600c12f1277a02a82f98e7dee15,source SHAb4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088; все30 blocks старого sidewalk fixture byte-equal полному artifact. Оригинал F0126 в T37 заново не скачивался/не хешировался.

BOUND означает только полное однозначное распределение непустых строк В ОБЪЯВЛЕННОМ регионе. Можно честно переместить исходный box внутри разрешённой ячейки или задать другой валидный регион и получить другой BOUND. Unit `сек` вместо `мин`, если source и anchor согласованы, также остаётся сырым текстом. Source SHA, policy provenance/version, смысл columns/units, физический элемент, review/approval, норматив и закрытость scope должен независимо аутентифицировать будущий consumer. Новых facts/IDs/atoms/coverage нет.


## Итоговая приёмка и продолжение

Все107 файлов и3 зависимости принятого T34 совпали с freeze с учётом ранее принятой единственной harnessamendment. Новые primitive/tests не импортированы runtime и не развёрнуты. PostgreSQL/schema/API/UI не изменены этим этапом, browser не запускался. Общая семантическая проверка в реальном анализе начнётся в T38.

Независимый TS сначала прошёл138проверок до чтения Python алгоритма. Дополнительныеedgeprobes выявили8расхождений кодов отказа; два порядка Python противоречили исходному wire. Явная amendment исправила проверку blockCount передOCR и разрешение всех label anchors передcells; оригинальные исходники/логи/receipt сохранены,96goldens не изменены. Итог Python130/TS142 и23/23parity. TS использует x-sweep с сжатыми Yинтервалами и segmenttree, затем два binary lookup на строку; Python bounded y-sweep,2048строк cap. Это разные реализации одного результата, без заявления общей производительности сервера.

T38 продолжается сразу: source-authored пределы огнестойкости из6верхних строк настоящейF0106. R иREI, исходные labels/мин/геометрия будут сохранены отдельно; KR-066/comparator/membermapping не считаются подтверждёнными.
