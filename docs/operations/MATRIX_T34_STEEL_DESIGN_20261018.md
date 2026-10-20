# T34: ограниченный каталоговый пример стали KR-056

Статус: PURE HELPER / SOURCE EVIDENCE ONLY. Новый helper и отдельные unit tests готовы; engine, fact scope, durable profiles, contracts, registry, API, БД и стенд не подключались и не менялись этим пакетом. Счётчики55 параметров /63 атома /77 unsupported сохраняются. Результат не является новой приёмкой coverage.

## Реальная пара и граница результата

Реальные F0105 ПД/KR и F0145 РД/OTHER содержат одинаковую категорию С245. ПД явно называет второй ярус распределительного пояса из трёх двутавров70Б3; РД-декларация класса двутавров не указывает конкретный member/profile/tier. Известные RD specs55Б1/60Б1 нельзя переименовать в70Б3. Manifest OTHER не переименовывается в KR. **Реальная пара остаётся0qualified / UNKNOWN**, без нарушения. В `research-source-packet.json` это явно маркировано как ожидаемая fail-closed политика будущей границы; новых runtime runs для проверки не создавалось. Сейчас KR056 вообще остаётся без атома.

Отсутствие comparable public member не блокирует чистый направленный предикат из буквального примера каталога: только С345 в ПД и С245 в РД. Это не общая шкала прочности стали и не сравнение чисел345/245. `compare_steel_catalog_example` возвращает True только для этой пары, False для равенства двух известных категорий, None для обратного перехода или неизвестного класса. False сам по себе не является qualified negative finding: прежняя полнота rule scope обязательна. Ни вероятность, ни coverage helper не вычисляет.

## Подлинные входы

Использованы только already verified T31/T33 sources/pages и два разрешённых exact PUBLIC ZIP member. Новых FTS-запросов и canonical index pages —0. На homeserver архив прочитан без распаковки/записи; member найден по точному нормализованному manifest path, уникальности, размеру и SHA. Hidden answers не читались.

- **F0105:** `Новослободская/Новослободская/Стадия П/НВС-2025.03-4.1-КР1.pdf`; PD/KR;29 страниц;3 831 452 байта; original SHA `8156fe22033fa94ba65ccc063e934b90168de8d0614a4bbecfde5def1e8b4a89`.
- **F0145:** `Новослободская/Новослободская/Стадия РД/Распорная система 17_ПД_25-РС изм. 1.pdf`; RD/OTHER;14 страниц;2 902 999 байт; original SHA `0be3a646cc793b86257e3ce4aeb9d0f15326369aa8a37a9205670e82635eaa05`.
- Оба TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN. Полные43 страницы заново обработаны штатным `extract_pdf_text_artifact`, без monkeypatch, OCR bypass или cache. Полные modern artifacts сохранены отдельно.
- Full PD text artifact SHA `0871c85b52dde6debf214f70067432ea37cb9608c5ca2dafbaf6f2868b795d15`; full RD SHA `bf8028af09e6f5eb9a4347166d106b5d95488f5314083504932a5afed4d0a023`.
- Полный wrapper `output/matrix-t34-20261018/research-full43-fixture.json` содержит обе manifest source rows, полные artifacts и provenance. Это research fixture, не standard observation schema.

Повторная экстракция совпала с T33 canonical pages по всем blocks и line boxes, а по всем выбранным raw fragments — точно. В одной посторонней строке штампа RD69:2 полный artifact сохраняет leading space перед «помещениями», индекс его снимал. Это явно записано в packet; полное побайтное совпадение всех line text с индексом не заявляется. Фрагменты helper используют новые аутентичные полные artifacts.

## Чистая грамматика и payload

Новый `services/worker/inspector_worker/steel_prose.py`, version `matrix-steel-prose-v1`, экспортирует `extract_steel_candidates(page,stage)`, строгую нормализацию четырёх буквальных C/С aliases245/345 и bounded comparator. Другие классы, suffix, ranges, альтернативы, пробелы внутри класса, full-width glyphs, числа, lowercase и zero-width добавки не aliases. Original rawValue сохраняется.

На всех43 страницах helper находит ровно **F0105 PDF14** и **F0145 PDF4**, по одному evidence candidate. Source/page allowlist отсутствует. Вход — строгая страница modern artifact с complete line boxes, safe integer координатами, точным block union, disposition TEXT_LAYER_CANDIDATE. Неправильная shape/стадия/геометрия даёт пустой результат. Metadata источника и section не входят в pure grammar и не выводятся из текста.

Выход: value, rawValue, rawUnit=null, canonicalUnit=`steel_catalog_example`, primaryFragments и scopeFragments с pageNumber/blockIndex/lineIndex/full rawText/bbox, плюс **внутренний** source-authored productScope. Он не entity, не approval и **не новое поле standard observation v1**. Будущая интеграция должна переносить raw+fragments прежним стандартным observation payload, а protected derived metadata восстанавливать независимо на границе. Никаких ближайших по расстоянию классов или whole-file material defaults.

### ПД: пояс второго яруса, только70Б3

Четыре полные original строки PDF14:

- 24:0 `[99408,295348,514632,307348]`: `конструкциях, и составляет от 3,5 м до 5,5 м. Крепление распорных элементов к`
- 25:0 `[99408,274678,485270,286678]`: `«стене в грунте» осуществляется через распределительные пояса, которые`
- 28:0 `[99408,254038,503314,266038]`: `выполняются на 1 и 3 ярусе из спаренных двутавров 70Б2, для 2 яруса из трех`
- 30:0 `[99408,233158,533062,245158]`: `двутавров 70Б3 ГОСТ Р 35087-2024 (сталь класса C245 ГОСТ 27772-2015). Монтаж`

Primary —30:0; scope —24:0,25:0,28:0 в порядке источника. Полные raw строки сохраняются вместе с хвостом следующей фразы «Монтаж». ProductScope фиксирует только то, что явно следует из грамматики: I_BEAM / DISTRIBUTION_BELT_I_BEAMS /70Б3 /count3 /tier2 /product standard35087-2024 /grade standard27772-2015. Класс не распространяется автоматически на70Б2 первого/третьего яруса или соседние трубчатые распорки Ст2сп.

Все выбранные line heights12000mpt; bounds11000..13000, mixed-height delta<=1000. Vertical gaps8670/8640/8880; максимум10000. Left delta<=2000; исходный общий left99408. Проверяется отсутствие любого unknown/overlapping body text в общем envelope и совпадение enumeration/reading order. Вертикальный штамп x26621..36701 остаётся вне body column; он не присоединяется к evidence и не мешает ложным образом. Duplicate/split malformed governing anchor, missing/reordered scope, wrong profile/tier/count — abstain.

### РД: отдельные изделия внутри одного блока

PDF4 block40 содержит пять последовательных строк:

1. `12. Трубы должны соответствовать ГОСТ 10704-91, из стали марки Ст20 по ГОСТ`
2. `380-2005. Двутавры должны соответствовать по ГОСТ Р 57837-2017, сталь`
3. `С245 по ГОСТ 27772-2021. Сталь прокатная листовая должна`
4. `соответствовать ГОСТ 19903-2015 из стали С245 по ГОСТ 27772-2021.`
5. `Арматурные стержни закладных деталей класса А500С по ГОСТ 34028-2016.`

Primary —40:1+40:2: класс относится **двутавру**. Scope —40:0,40:3,40:4 сохраняет явные границы соседних изделий. Второе С245 относится листу, Ст20 — трубе, А500С — закладной арматуре. Изменение допустимого класса листа не меняет класс двутавра; исчезновение класса двутавра при сохранённом соседнем С245 не извлекает лист вместо него. ProductScope I_BEAM_GENERIC_DECLARATION; profile/count/tier=null. ГОСТы продукта57837-2017 и класса27772-2021 сохраняются раздельно.

Строки высотой15393mpt, bounds14500..16500 и mixed delta<=1000; ordered same-block sequence; gaps<=4000; left delta<=21000 с учётом реального indent19800. Unknown interleaving/overlap, duplicate/malformed governing «Двутавры», replacement pipe/plate/rebar/standard, reordered fragments — abstain. Оригинальный OTHER сохраняется на source layer.

## Предлагаемая будущая граница применимости

Предлагается отдельная typed роль позиции `ROLLED_STEEL_I_BEAM_DISTRIBUTION_BELT`. До внедрения надо согласовать schema с root; здесь только дизайн. Обе стороны требуют FACT_BINDINGS, authentic source selector и source-bound fragments, Current/Approved reviews, корректный section и approved-change status.

Четыре общих identity поля: componentKey точной позиции/элемента, zoneKey общего участка/яруса/осей или отметки, operatingModeKey фиксированного назначения несущего металлопроката, measurementBasisKey `DECLARED_STEEL_GRADE_AND_PRODUCT_STANDARD`. Дополнительно material basis должен подтверждать attribute/unit, I_BEAM product role, настоящую source-authored позицию/profile и применимость product/grade standards. Generic reference не заменяет доказательство. Нельзя свободным review текстом дописать отсутствующий profile в RD fact, изменить OTHER, игнорировать известные55Б1/60Б1 или автоматически считать ГОСТ27772-2015 и2021 взаимозаменяемыми. Если member evidence вынесено в отдельную spec, нужна authenticated связь source SHA/page/target/current review, а не имя файла.

Для controlled positive нужны явно synthetic новые PD/RD sources с **одним и тем же явно указанным продуктом/элементом**, PDС345/RDС245; обе genuine source-bound грамматики должны подтверждать literal value+scope. Не использовать исходную generic РД как готовый matched member только ради positive. Original real pair и его immutable bytes не переписывать. Равенство продолжает требовать RULE_SCOPE_COMPLETE для qualified negative; reverse/другой класс UNKNOWN; probability=null.

## Проверки и freeze

`services/worker/tests/test_steel_prose.py`: **150 unit methods PASS**. В том числе143 portable JSON vectors:19 positive evidence/124 abstain; отдельные8 predicate cases и native malformed checks. Полный43-page scan и повторяемость/immutability/выход без bbox aliasing. Всего38 native-only rejection vectors записаны отдельно; они не смешаны с JSON wire parity.

Goldens создаются независимо от helper output: payload выписан из проверенных original lines, geometry и source-authored scope. Полезные boundaries изменяют и line box, и block union согласованно: PD height13000/13001,11000/10999, gap10000/10001; RD left delta21000/21001 и mixed-height delta1000/1001. Проверки не становятся зелёными только из-за ошибочного redundant bbox.

Native NaN/Infinity, tuple, cycle, surrogate и integral Python float1.0 проверены отдельно. После JS JSON parse запись1.0 эквивалентна1; TS не обещается отличать их лексическую запись. В portable geometry используются fractional0.5 и unsafe integers. Это сохраняет различие Python host strict types и JSON wire numbers.

Команды: `PYTHONPATH=services/worker:services/worker/tests services/worker/.venv/bin/python -m unittest test_steel_prose -v`; `PYTHONPATH=services/worker services/worker/.venv/bin/python output/matrix-t34-20261018/research-freeze.py`. Логи попыток сохранены; первый139-method прогон зелёный, финальный150-method прогон зелёный после добавления meaningful geometry vectors. Registry/integration/PG/browser/stand acceptance не заявляются. SHA helper/test/goldens/fixture/document — в `research-receipt.json`.
