# OCR_REQUIRED: полный ограниченный прогон F0201

20.10.2026. В V4 F0201 всего 676 страниц: 664 `TEXT_LAYER_CANDIDATE`, 12 `OCR_REQUIRED`. Probe выбирает **все** 12 страниц по disposition; prefix/sample не применяет. Native V4 не меняется. Отдельный OCR artifact содержит исходный PDF SHA, физический номер страницы, PNG SHA, raw response SHA, raster bbox и bbox `PDF_BOTTOM_LEFT_MILLI_POINTS`.

Реально выполнено 12 последовательных CPU-запросов: **264 непустые строки, 0 технических отказов, 60.148 с** всего. Это измерение одного прогона, не SLA/percentile. Страницы 5/7/8/9 дали соответственно 35/78/82/69 строк. Страницы **596, 604, 610, 614, 618, 624, 630, 634** вернули 0 непустых строк: `OCR_RETURNED_NO_TEXT_UNRESOLVED`. Пробелы этих восьми страниц не закрыты. Дополнительный root-просмотр всех восьми сохранённых SHA-bound растров показал QR-код на белом фоне; [визуальная квитанция](evidence/pair-viewer-20261020/ocr-zero-text-visual-review.json). QR не декодировался, внешние ссылки не открывались. Отсутствие OCR-текста не означает пустую страницу или доказанную полноту; статус всех восьми остаётся UNRESOLVED.

Каждая строка: `evidenceKind=OCR`, `humanVerified=false`, `factEligible=false`, `absenceProof=false`, `p=null`. `recognitionScore` — некалиброванный score OCR, не вероятность инженерного вывода. Полнота распознавания `UNVERIFIED`. Пустые распознавания не становятся строками; raw response сохранён. `coverageDelta=0`, `engineeringQualification=false`. Публичные обучающие ответы не читались и не были входом OCR.

## Исходники и среда

- PDF F0201: `output/local-work-20261020/real-pairs-priority-v1/sources/F0201.pdf`, SHA256 `0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd`.
- Native V4: `output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json`, SHA256 `64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9`.
- Public document manifest: `datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl`, SHA256 `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
- Локальный рендер: PyMuPDF `1.27.2.2`, 144 DPI, максимум 2 500 000 пикселей на полную страницу. У страниц 7/8/9 rotation 270°. Geometry привязана к совпадающему rotated visible frame V4; raw MediaBox не подменяет его.
- Существующий healthy CPU service: SSH alias `homeserver`, loopback `127.0.0.1:18084`, контейнер `inspector-ai-local-model-probe-document-ai-1`. Образ `sha256:fa3ea8ae024e7a0a2c00c55b3f404cab68cd6a9fdeaf5238e5c7485cf5a39628`, профиль `ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1`, script `eslav` уже загружен. Это не H100.
- PaddleOCR/PaddleX `3.7.0`, PaddlePaddle `3.2.1`. Профиль SHA256 `0cfcf119e0a8aef3914526df935044eff6157fceafe17b8af9f79db7a7dbb8d8`. Model-cache manifest SHA256 `e395547ccfd129c8600d12a3c3261b2e4db82aba4daa316c55b7108eed3de8ae`; размеры/SHA всех 47 перечисленных файлов перепроверены. `trustMode=local-first-download`: это локальная фиксация bytes, не доказательство аутентичности издателя.
- Перед каждой страницей проверены CPU/device/profile/loaded-script/image и `MemAvailable >= 1500000 KiB`. Фактический диапазон 1907160–2267840 KiB. Новый контейнер/стек/модель не запускались, загрузки моделей не выполнялись, соседние сервисы не останавливались. Текущий memory gate не является обещанием наличия ресурсов при повторном запуске.

## Воспроизведение

Зависимость локального render/replay: установленный PyMuPDF `1.27.2.2`. CLI не ставит пакеты. Используйте новый, ещё не существующий output-каталог. Все три input SHA сверяются до создания output.

```sh
python3 scripts/ocr-full-source-gap-probe.py --plan-only \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --pdf output/local-work-20261020/real-pairs-priority-v1/sources/F0201.pdf \
  --native-v4 output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json \
  --output-dir /tmp/inspector-ocr-gap-plan-new
```

Для повторного реального OCR замените `--plan-only` на `--execute-ocr`, задайте новый output. Нужен доступ к уже существующему CPU service через авторизованный SSH alias. Ресурсный или identity gate останавливает прогон; ошибка сохраняется как `UNRESOLVED`.

Полный offline replay сохранённых ответов не использует SSH или OCR runtime:

```sh
python3 scripts/ocr-full-source-gap-probe.py \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --pdf output/local-work-20261020/real-pairs-priority-v1/sources/F0201.pdf \
  --native-v4 output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json \
  --replay-dir output/local-work-20261020/ocr-full-source-gaps-v1/live-v3 \
  --expected-replay-report-sha256 bba36ea5c02ccabaefa2dcfb9c1dd6a7785521b32bf494a956ae3ab53838d82f \
  --output-dir /tmp/inspector-ocr-gap-replay-new

python3 -m unittest discover -s scripts/tests -p test_ocr_full_source_gap_probe.py -v
```

## Проверки и квитанции

- `output/local-work-20261020/ocr-full-source-gaps-v1/live-v3/report.json`: полный реальный прогон; SHA256 `bba36ea5c02ccabaefa2dcfb9c1dd6a7785521b32bf494a956ae3ab53838d82f`. В каждой `pNNN/` сохранены `render.png`, `response.json`, `evidence.json`.
- `replay-v1/report.json`: 12 страниц / 264 строки, 0 inference; SHA256 `40b5fde0f79bd1be1a35809f6545be8e17d9e65cc26173d8e19fdac7fb6ff28a`. PDF/native/render/raw-response/строки/geometry совпали с реальным прогоном.
- `real-replay-negative-receipt.json`: 4 реальных отрицательных CLI-сценария: неверный whole-report anchor, пропущенная страница, подменённый frame, подменённый raw response. Все fail-closed, 0 новых OCR-запросов.
- `tests-focused-final.log`: **25 focused tests PASS**, включая независимый manual geometry golden, rotation 270° с нарисованным прямоугольником, native/OCR separation, invalid boxes/scores/provider, полную выборку без sampling, bytes/manifest/source substitution, memory gate, отсутствие overwrite, incomplete replay и frame mismatch. Synthetic provider в unit-тестах не доказывает OCR-качество. Полный suite этим заданием не запускался.
- `runtime-provenance.json`: полный cache manifest и результат проверки всех 47 файлов. `live-v3-receipt.json`: время/exit code. `live-v3-executed-script.py` и `live-v3-script-pin.json`: точный код реального прогона. Финальный CLI после него усилен проверкой полноты replay и отдельным replay status; live путь не менялся.
- `live-v1` и `live-v2`: сохранённые ранние отказы на empty recognition и rotated page; их не включаем в успешный итог. Исправления покрыты тестами. Пилот p5 и ранний v2 дали дополнительные bounded вызовы; 12 запросов — счётчик именно полного `live-v3`.

## Следующая узкая интеграция

UI/API/worker не изменены: OCR пока отдельный review-only канал. Для интеграции нужны отдельный artifact kind, source/hash/page/frame pins, явная метка OCR, authenticated human review и запрет автоматического продвижения OCR в native/fact/absence. Нельзя заменять native quality summary количеством OCR-строк.

Реальные источники подходят для следующей отдельной source-only lane: PZ-013 (ПД F0171 p1 и OCR РД F0201 p5/p7 заявляют 600 мест) и IOS4-079 (ПД F0171 p156: П17 9060 м³/ч; РД F0201 p272/p279: П17.1 3340 + П17.2 5720 = 9060). Обе ветки пока без квалификации редакций/engineering и с `coverageDelta=0`; IOS4-079 требует сохранения `PUBLIC_MAPPING_CONFLICT`, потому что сумма расходов выбранной группы не доказывает кратность воздухообмена.

В OCR p8 строка `107,687 кВт (0,926 Гкал/час)` совпадает с видимой записью исходного скана. Единицы/числа требуют ручной проверки; нельзя молча исправлять источник, объявлять это только OCR-ошибкой или использовать для инженерного сравнения.

Что проверить: прочитать OCR на оригиналах; квалифицировать геометрию и полноту; отдельно разобрать восемь страниц без текста; утвердить object/revision/operating-mode bindings перед инженерными выводами.
