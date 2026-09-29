# Офлайн-проверка bounded OCR

`scripts/verify-bounded-ocr-stage.py` проверяет сохранённый результат
`DOCUMENT_OCR_LAYOUT` профилей v1–v4 по оригиналам PDF из публичного пакета участника.
Источники допускаются только при `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`.
Манифест сверяется с размером, SHA-256 и числом страниц каждого PDF.
Закрытые ответы и `TEST_HIDDEN` не нужны.

Скрипт принимает полный `analysis_stage_artifacts.content_json` и его
`content_hash` из БД, а также сохранённые `document-text-v2` и их `content_hash`.
Он проверяет профиль, канонические хеши, источники и счётчики. Для v1 сверяет
выбор первых `OCR_REQUIRED` листов. Для v2 сверяет приоритет чертёжных страниц,
расстояние до текстовых якорей, отсечение по лимиту рендера и распределение
листов по источникам. Также сверяются допустимый OCR provider, профиль PDFium
и геометрия относительно текстового этапа с допуском два пикселя. Для v3
допустимы лишь страницы `OCR_REQUIRED` между маркером ревизии `-РД-ОВ` и
сводкой отопления не дальше восьми листов после маркера; проверяются
`subjectCandidatePageCount` и явный `SKIPPED_NO_SUBJECT_CONTEXT`.
Для v4 сначала действует v3-окно, затем при его отсутствии допускаются
лишь первые две страницы с `TEXT_DECODING_ANOMALY` из сохранённого текстового
слоя. Верификатор принимает закреплённые `text-layer-quality-v1` и `v2`,
пересчитывает `titleRecoveryCandidatePageCount` и сверяет список страниц.
Бюджет каждого профиля — две страницы на запуск. Каждый выбранный лист
заново отрисовывается **из исходного PDF** через `pypdfium2==5.12.1` при
120 dpi. Геометрия и SHA-256 PNG должны совпасть с OCR-артефактом. Для точного
PNG-хеша используйте тот же Pillow и PDFium, что в образе `document-ai`.

Пример на homeserver, из корня изолированного проекта, после копирования
проверочного скрипта и трёх экспортированных JSON в `output/bounded-ocr-20260927/`:

```bash
docker run --rm --network none --user 0:0 --entrypoint python \
  -v "$PWD:/workspace:ro" -w /workspace \
  inspector-ai/document-ai:paddle3.2.1-cpu-v1 \
  scripts/verify-bounded-ocr-stage.py \
  --manifest 'datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl' \
  --artifact output/bounded-ocr-20260927/stage.json \
  --expected-artifact-sha256 ae6218bccf5694da924bed21b03fe4035ecb86d777908efa8c6132b00ea914c8 \
  --source F0150=FIL-05B63D59=dataset-smoke/F0150_raw.pdf \
  --source F0201=FIL-35450220=dataset-smoke/F0201_raw.pdf \
  --text F0150=output/bounded-ocr-20260927/FIL-05B63D59-text.json=71ffa2dfb2de9f96bdddbe66ed1b00f32cb5ec5c8c7202bb0eb7f98dbc7e81fb \
  --text F0201=output/bounded-ocr-20260927/FIL-35450220-text.json=ca029362df27de1d7a1729c9851888718c047d99a47b6e758376cfd36f8301b7
```

Успех даёт `SOURCE_RENDER_SCOPE_VERIFIED`, ID профиля, счётчик проверенных изображений и
`ocrLineTextVerified: false`. Ошибка источника, хеша, выбора листа, геометрии
или PNG завершает процесс с кодом `2`. Совпадение хешей доказывает сохранность
данных и повторяемость рендера, **не правильность распознанных строк**.
Правильность OCR, применимость чисел и вывод о нарушении требуют независимого
экспертного просмотра исходных листов. Проверка выбора листов опирается на
зафиксированный `document-text-v2`; она не повторяет извлечение текстового слоя.

Опциональный v2 для **нового** запуска `PILOT_PZ002_PZ017` включается через
`INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v2` в env-файле стека. API и worker
должны быть обновлены вместе; старые запуски остаются привязаны к v1 release.
V2 выбирает до двух `OCR_REQUIRED` страниц с приоритетом чертежей и распределением по источникам,
учитывает предел 25 Мп и 20 000 пикселей на сторону и закрепляет допустимые
профили PDFium/PaddleOCR. Проверочный скрипт определяет v1–v4 по
`providerProfileId` сохранённого артефакта; параметры CLI одинаковы. Команда
выше относится к старому v1 run; для v2–v4 подставьте путь и хеш нового stage artifact.
Результат OCR не
подтверждает правильность распознанного текста и не создаёт findings.

Синтетические тесты v1/v2/v3, включая подмену PDF, манифеста, хешей, выбора страниц,
геометрии, provider и PNG:

```bash
python3 -m unittest scripts.tests.test_verify_bounded_ocr_stage -v
```

Для самого verifier CLI нужен `pypdfium2==5.12.1` и Pillow; при отсутствии
PDFium скрипт завершается ошибкой. Синтетические тесты дополнительно создают
PDF через `PyMuPDF==1.27.2.2`. При отсутствии PDFium или PyMuPDF они явно
пропускаются. Они пройдены **локально** при PyMuPDF 1.27.2.2, Pillow 11.3.0 и
pypdfium2 5.12.1 командой выше. Существующий `document-ai` образ содержит
PDFium и Pillow, но не PyMuPDF: он пригоден для реальной проверки CLI, а не
для запуска синтетического test-модуля без дополнительной зависимости.

## Реальная проверка v2, 27 сентября 2026

После завершения `CHK-75051E60` сохранённый v2 stage artifact с DB SHA-256
`c3f30ae1e6775dc05ecc79e4e4166b7564c94cbe63a941a095fe6b7a76cf5518`
проверен в существующем `document-ai` образе с `--network none` и read-only
mount исходного проекта. Скрипт сверил оба `TRAIN_PUBLIC` PDF, DB-хеши stage
и text artifacts, v2 page selection и повторно отрисовал F0150 p.295 и
F0201 p.30. Оба PNG-хеша и геометрия совпали. [Отчёт](../../output/bounded-ocr-v2-20260927/source-render-verification.json)
имеет SHA-256 `e7fd00887988df5f726c87a3b60411df4e0934dc9580fd98d5c6db4a75a6d1a7`;
`status=SOURCE_RENDER_SCOPE_VERIFIED`, `verifiedRenderedPageCount=2`,
`ocrLineTextVerified=false`. На момент v2 проверки 11 синтетических тестов v1/v2
покрывали подмену источника,
профиля, страницы, координат, provider и render-хеша отвергается.

## Команда для сохранённого v3 артефакта

Два значения `OCR_V3_STAGE_JSON` и `OCR_V3_STAGE_SHA256` взять из **одной**
строки `analysis_stage_artifacts` нового run: полный canonical `content_json`
и `content_hash`. Имена F0150/F0201 и text SHA ниже относятся к тому же
публичному объекту, что в примерах выше. При другом объекте заменить все
source ID, PDF и text hashes на соответствующие `TRAIN_PUBLIC`.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
docker run --rm --network none --user 0:0 --entrypoint python \
  -v "$PWD:/workspace:ro" -w /workspace \
  inspector-ai/document-ai:paddle3.2.1-cpu-v1 \
  scripts/verify-bounded-ocr-stage.py \
  --manifest 'datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl' \
  --artifact "${OCR_V3_STAGE_JSON}" \
  --expected-artifact-sha256 "${OCR_V3_STAGE_SHA256}" \
  --source F0150=FIL-05B63D59=dataset-smoke/F0150_raw.pdf \
  --source F0201=FIL-35450220=dataset-smoke/F0201_raw.pdf \
  --text F0150=output/bounded-ocr-20260927/FIL-05B63D59-text.json=71ffa2dfb2de9f96bdddbe66ed1b00f32cb5ec5c8c7202bb0eb7f98dbc7e81fb \
  --text F0201=output/bounded-ocr-20260927/FIL-35450220-text.json=ca029362df27de1d7a1729c9851888718c047d99a47b6e758376cfd36f8301b7
```

Даже при успешной проверке правильность OCR-строк остаётся непроверенной без
экспертного просмотра исходного листа. Артефакт с нулём обработанных страниц
подтверждает только корректность отказа по v3-контексту, а не качество OCR.
После расширения верификатора два теста выбора v4 проходят и без PDFium;
15 синтетических тестов v1/v2/v3 требуют PyMuPDF и PDFium.
Текущая версия скрипта также повторно проверена на сохранённом v2 stage через
`document-ai` образ с `--network none`; результат и SHA отчёта совпали с
предыдущим реальным прогоном v2. Затем v3 проверен на двух реальных публичных
наборах. Для F0150/F0201 [отчёт](../../output/bounded-ocr-v3-20260927/source-render-verification.json)
имеет SHA-256 `a777a6e2ec1939f7d349922e7cf2cb2cae3f14f58caef239ba7d696af267505c`:
F0201 p.7–8 прошли повторный рендер, F0150 явно пропущен. Для F0171/F0202
[отчёт](../../output/bounded-ocr-v3-f0202-20260927/source-render-verification.json)
имеет SHA-256 `168aee99607712623f5d78cfed7dbcccb13b0b24acbcb5e0550b6d584a604339`:
F0202 p.7–8 прошли повторный рендер. В обоих отчётах
`SOURCE_RENDER_SCOPE_VERIFIED`, `ocrLineTextVerified=false`.

## Реальная проверка v4, 28 сентября 2026

Для исходного открытого F0153 полный stage из `CHK-C260E0AA` проверен в
`inspector-ai/document-ai:paddle3.2.1-cpu-v1` с `--network none` и mount
только на чтение. Входы: оригинальный PDF, открытый manifest, полный
OCR stage SHA `cab7f21b610fe8c863883db4fbd619d6095b6343f713712b67cf4f3e290236f7`
и текстовый artifact SHA
`4190acfab10037a0dc8d6a614bfa33d0885d3b5e5657b02aa0296efc5c0c861c`.
Повторный рендер p.1–2 совпал по PNG SHA; [отчёт](../../output/public-index-20260927/f0153-v4-ocr-verification-20260928.json)
SHA `eb0d143204fa0be45cf5ffe7cd7fcc9c86f25bf68e6f3ff8d93ab9d030f03d9c`,
`SOURCE_RENDER_SCOPE_VERIFIED`, `ocrLineTextVerified=false`.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
docker run --rm --network none --user 0:0 --entrypoint python \
  -v "$PWD:/workspace:ro" -w /workspace \
  inspector-ai/document-ai:paddle3.2.1-cpu-v1 \
  scripts/verify-bounded-ocr-stage.py \
  --manifest 'datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl' \
  --artifact output/public-index-20260927/f0153-v4-ocr-stage.json \
  --expected-artifact-sha256 cab7f21b610fe8c863883db4fbd619d6095b6343f713712b67cf4f3e290236f7 \
  --source F0153=FIL-44395D71=dataset-smoke/public/F0153.pdf \
  --text F0153=output/public-index-20260927/f0153-v4-text.json=4190acfab10037a0dc8d6a614bfa33d0885d3b5e5657b02aa0296efc5c0c861c
```
