# Два воспроизводимых сравнения реальных исходников

20.10.2026. Новая offline source-only lane; V13, API, worker и runtime не изменены. `MACHINE_COVERAGE_V13_20261020.json` содержит 132 параметра, из них 70 без configured atomic rule. Здесь выполнены два узких сравнения по реальным обеим сторонам. **Они не уменьшают unsupported и не закрывают параметры.** `p=null`, `engineeringQualification=false`, `coverageDelta=0`, `matrixFinding=false`, `factEligible=false`.

| Код | Реальные выбранные цитаты | Детерминированный результат | Незакрытая граница |
| --- | --- | --- | --- |
| PZ-013 | ПД F0171 PDF p1: «Школа на 600 мест, р-н Богородское, ул. Тюменская, влд.5». РД F0201 OCR PDF p5: та же декларация; p7: «Общественное (школа на 600 мест)». | 600 мест = 600 мест; delta РД−ПД = 0. Полные caches содержат 29 деклараций ПД / 9 native РД; новый OCR — 2. Конфликтов значений нет. | `COMPOSITE_TRIGGER` остаётся: production power, иные типы вместимости, применимость, физическая вместимость и утверждённые редакции не квалифицированы. OCR не прошёл authenticated human review. Равенство деклараций не означает соответствие проекта. |
| IOS4-079 | ПД F0171 PDF p156: `П17 (L=9060 м3/ч, Pc=350 Па)`. РД F0201 PDF p272: `Проект: П17.1 (L=3340 м3/ч, Pc=540 Па)`; p279: `Проект: П17.2 (L=5720 м3/ч, Pc=540 Па)`. | 9060 = 3340 + 5720 м³/ч; delta = 0. Повторы РД p646/p647 сохраняются как цитаты и не суммируются повторно. Давления 350/540 Па записаны отдельно и не суммируются. | `PUBLIC_MAPPING_CONFLICT` остаётся. Сумма расходов выбранной группы не устанавливает кратность, объём помещения, один физический агрегат, режим, approved replacement или нарушение. Полнота всей вентиляции не заявляется. |

Третий атом не добавлен: новые OCR строки температуры/давления/ИТП не дают квалифицированного одноимённого ПД/РД quantity и контекста. На p8 видимая запись `107,687 кВт (0,926 Гкал/час)` требует разбора исходной несогласованности, не автоматической коррекции.

## Проверенные исходники

Оба файла public manifest относятся к `OBJ-TYUMENSKAYA-5-GOLD-SEED`, `TRAIN_PUBLIC`, `INCLUDE`, раздел OV. F0171 заявлен PD. F0201 имеет **RD_ID_MIXED**, поэтому стадия каждой выбранной РД страницы остаётся `UNVERIFIED`; утверждённые редакции не установлены. Общий object_id в публичном manifest не заменяет инженерную qualification.

- F0171 PDF SHA256 `a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc`.
- F0201 PDF SHA256 `0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd`.
- PD full native V2 SHA256 `321eb75fd59b501ee4445ecf552a2fc9625175efb0aa49e3a761e1d776a5f4ea`.
- RD full native V2 SHA256 `658fd77266e272695fcf84b8ec078b152a91b31df379bb53e7eaf289afe5e742`.
- RD full native V4 SHA256 `64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9`.
- Реальный 12-page OCR report SHA256 `bba36ea5c02ccabaefa2dcfb9c1dd6a7785521b32bf494a956ae3ab53838d82f`.

Все PDF, manifests и artifacts проверяются целиком. Все 12 OCR_REQUIRED страниц повторно рендерятся из оригинала; PNG/raw response/нормализованные строки/bbox сверяются с закреплённым OCR report без нового inference. Native anchors дополнительно воспроизводятся native text extractor непосредственно из выбранных оригинальных PDF. Geometry native остаётся закреплённой canonical geometry; более новый extractor не подменяет её незаметно. Полные source pins и точные page/bbox/rawText находятся в `fixtures/real-parameter-source-comparisons-v1/source-bindings.json` и результате.

Публичные TRAIN ответы не читались и не были входом. Manual goldens получены из заявленных source values до кода. Это воспроизводимость source comparison, не оценка независимой accuracy, калибровки или полноты матрицы.

## Реализация и отсутствие дублирования

`scripts/real-parameter-source-comparisons.py` добавляет capacity extraction/conflict checks, объединённую provenance и результаты двух кодов. Для П17 он **переиспользует** `verify_inputs`, `extract_observations`, `evaluate_splits` из `scripts/probe-ventilation-system-split-public.py`. Второй алгоритм П17 не создан. OCR normalization/render/replay primitives переиспользованы из `scripts/ocr-full-source-gap-probe.py`. Whole-file SHA обоих helpers закреплены; drift завершает probe отказом.

Отказы: чужие/переставленные originals, другой object/stage, hidden source, partial cache, пропущенная OCR страница, подменённый ответ/PNG/geometry, несовпавшая quote/bbox, конфликт вместимости внутри документа или между native/OCR, неполная/конфликтная группа П17. Source equality не повышает authority. Выход создаётся только после успешной проверки обеих веток и не перезаписывается.

## Воспроизведение

Нужен установленный PyMuPDF `1.27.2.2`; пакеты/модели CLI не устанавливает. PDF/canonical/OCR относятся к companion inputs, не к Git fixtures. Пути аргументов произвольны; output должен отсутствовать.

```sh
python3 scripts/real-parameter-source-comparisons.py --offline-source-comparisons \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --pd-pdf output/local-work-20261020/real-pairs-priority-v1/sources/F0171.pdf \
  --pd-canonical output/review-candidates-20260929/tyumenskaya-expanded/text-F0171.json \
  --rd-pdf output/local-work-20261020/real-pairs-priority-v1/sources/F0201.pdf \
  --rd-canonical output/review-candidates-20260929/tyumenskaya-expanded/text-F0201.json \
  --rd-native-v4 output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json \
  --ocr-directory output/local-work-20261020/ocr-full-source-gaps-v1/live-v3 \
  --output /tmp/inspector-real-parameter-comparisons-new.json

python3 -m unittest discover -s scripts/tests -p test_real_parameter_source_comparisons.py -v
```

Git package для replay: новый script/test, три JSON и README в `fixtures/real-parameter-source-comparisons-v1`, плюс два переиспользованных script helpers. Обязательные внешние companion bytes перечислены с SHA/размером в `output/local-work-20261020/real-parameter-source-comparisons-v1/companion-inputs.json`; из OCR directory нужны `report.json` и все 12 `pNNN/{render.png,response.json}`. Ни соседние output-пути, ни label files не являются defaults нового CLI. `--bindings`/`--expected-bindings-sha256` позволяют передать отдельно квалифицированный manifest source anchors; изменение pins не даёт инженерной authority.

## Результат и квитанции

`output/local-work-20261020/real-parameter-source-comparisons-v1/real-final-v3.json`: SHA256 **`b0e2c23f46608cbd7315d97d8da74717a731ca0b062e96742e5af659f26db9d1`**. Повтор `real-final-v4.json` byte-identical. Изолированное приложение без output-папки, с входами по другим путям, дало те же bytes. `runtime`: network/newOCR/model/database/engineImports/labelsRead — 0.

- `tests-focused-final.log`: **27 tests PASS**; независимые goldens, delta direction, typed units/entities, conflict/missing scope, P17 duplicate handling/pressure, OCR source/authority/frame/raw/geometry attacks, pinned helpers, viewer quote bindings.
- `real-negative-cli-final-receipt.json`: **11 реальных CLI negative cases PASS**, отказ без создания результата. Включены resealed object/stage/hidden metadata, partial cache, переставленные PDF, source anchor bbox, incomplete member scope, raw OCR и raster substitutions.
- `isolated-tests-final.log` и `isolated-replay-final-receipt.json`: **27 tests PASS** в минимальном копированном Git-пакете и byte-identical replay при relocated companion paths.
- `real-final-receipts-v2.json`: оба реальных CLI запуска. `run-real-final-verification.py`: точный CPU-only verification harness. Полный suite не запускался.

`fixtures/real-parameter-source-comparisons-v1/viewer-bindings.json` содержит шесть исходных citation selections для UI: source SHA/file/role, physical page, page dimensions, bbox PDF bottom-left, rawText, displayValue/unit, NATIVE/OCR и artifact SHA. Это исходные селекторы цитат, не machine verdict и не обучающие ответы. Root UI должен открыть selection только при совпавшем source SHA, сохранить OCR label и неполную authority.

Что проверить: визуально сопоставить выбранные цитаты и bbox в player; отдельно подтвердить OCR; квалифицировать страницы RD_ID_MIXED/утверждённые редакции; установить физический group/operating-mode binding для П17. До этого оба результата остаются source-only candidates, V13 gaps не меняются.
