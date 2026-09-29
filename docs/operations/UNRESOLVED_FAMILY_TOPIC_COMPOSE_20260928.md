# Тематический Compose прогон unresolved-family на публичном F0163

28 сентября 2026. Проверен **новый объект и новый run** в изолированном
`inspector-ai-homeserver-smoke`, без решений о редакции, согласовании,
предметном разделе или паре ПД/РД за эксперта. Это проверка транспорта
и консервативного воздержания, не оценка качества извлечения.

## Исходный документ

Взято ровно одно исходное PDF `F0163` из
`01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip`. Полный SHA-256 ZIP
`79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`
и SHA публичного `document_manifest.jsonl`
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`
пересчитаны на homeserver. Запись `F0163`: `TRAIN_PUBLIC / INCLUDE /
PUBLIC_TRAIN`, ПД/ВК, 5 738 729 байт, 21 страница. После извлечения
только этого ZIP-члена исходный PDF сверён с manifest по размеру и SHA
`18282c9104974a462338ff2d246bf081545bdfcafde1a85ee5e6d4ca54584861`;
`pdfinfo` подтвердил 21 страницу. Скрипт извлечения:
[`extract-public-f0163.py`](../../output/unresolved-family-topic-compose-20260928/extract-public-f0163.py).
Закрытые ответы и `TEST_HIDDEN` не читались.

Runtime файлы API/web/worker в isolated checkout до запуска совпали с локальными
по SHA; повторной пересборки для этого прогона не требовалось. Существующий
Compose уже использовал opt-in `...-ocr-table-v3-unresolved-review-v1`.

## Запуск и сохранённый результат

`scripts/smoke-core.py` создал объект `OBJ-58FA0B7B`, загрузку
`UPL-AD17EBF0`, исходный файл `FIL-005BA66B` и проверку
`CHK-0D43285B`. API повторно выдал скачанный PDF с теми же 5 738 729
байтами и SHA; журнал решения по источнику вернул 404. [Run receipt](../../output/unresolved-family-topic-compose-20260928/run-receipt.json)
SHA `77f1958dec9bc68ec6d448f9a89c381e5d3b8492f1c7dabafb9c92faec7208bb`.

Независимый read-only запрос к PostgreSQL подтвердил **10/10 jobs
`SUCCEEDED`**, `sealed_at` установлен. Run `PARTIAL`: 7 `PARTIAL`, 125
`UNSUPPORTED`, 0 findings. Сохранённая стадия `RULE_EVALUATION` имеет
`outputCount=9`, профиль
`typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1`, SHA
`df17c6671c6f373ba45a02164b45d06c934c09f09658f656ea56ce3c5a5c3420`.
Текстовый `document-text-v2` артефакт на 21 странице имеет SHA
`30e811b9a47ff590a820bd2408ee673eea4d506a7a8f527505e9318cc71815a6`;
19 страниц получили кандидатный текстовый слой, две `OCR_REQUIRED`.
Сохранённая OCR-стадия v5 обработала 0 страниц; выводы об этих двух
страницах не делались. [SQL и результат](../../output/unresolved-family-topic-compose-20260928/read-only-audit.sql),
[`read-only-audit-result.txt`](../../output/unresolved-family-topic-compose-20260928/read-only-audit-result.txt).

Анонимный `GET /api/checks/CHK-0D43285B/pilot-results` вернул 401,
аутентифицированный — 200. Независимая проверка SHA пакета и происхождения
нашла три строки кодов `AR-042`, `IOS2-072`, `IOS3-075`, все `ABSTAIN`,
0 leads, `findingCount=null`, `parameterCoverage=null`. Причины каждого
кода: `SOURCE_REVIEW_REQUIRED`, `NO_ELIGIBLE_REVIEWED_SOURCE`,
`NO_EXACT_LINE_LEAD`, `LEAD_NOT_VERIFIED_FACT`. Ноль leads обусловлен
отсутствием проверенного `CURRENT/APPROVED` решения по новому источнику,
а не отсутствием параметра в PDF. SHA sidecar
`039ea24f2aab7c44f96c501d4dbb9c859ca5efbc331bfa31c9f261b16b0ca3e3`.
[Аудит API](../../output/unresolved-family-topic-compose-20260928/audit-summary.json),
[сохранённый ответ](../../output/unresolved-family-topic-compose-20260928/pilot-results.json).

Headless Chrome после входа через web открыл новый объект, проверил панель
«Неразрешённые семейства: текстовые подсказки» и все три `ABSTAIN`.
Визуальный provider обработал 21/21 страницы, дал 0 предложений;
это также не вывод об отсутствии объектов. [UI smoke](../../output/unresolved-family-topic-compose-20260928/ui-smoke.json).
Форма положительного решения не заполнялась.

Обнаружена и исправлена граница UI: поле `unresolvedFamilyReview.objectId`
содержит внутренний UUID, а маршрут просмотра PDF использует публичный
`OBJ-*`. Ссылка теперь показывается после совпадения source ID, SHA PDF и
SHA сохранённого текстового артефакта внутри пакета; доступ к PDF повторно
проверяет API по публичному объекту. Профильный web-тест с разными UUID и
`OBJ-*` прошёл 3/3, typecheck прошёл. Исправленный web пересобран в
изолированном Compose, повторный headless Chrome smoke прошёл; прямой
preview F0163 p.1 вернул анонимно 401, аутентифицированно 200 `image/png`.
В реальном run leads всё ещё 0, поэтому положительная ссылка с реальным
подтверждённым лидом остаётся непроверенной. Точные страницы/строки по
правилам можно предметно проверить только после экспертного решения об
источнике и новом run.

## Воспроизведение

В изолированном checkout homeserver после SHA-проверки оригинала:

```bash
python3 scripts/smoke-core.py --base-url http://127.0.0.1:14100 \
  --credentials-file infra/.smoke-user \
  --pdf dataset-smoke/train_public_F0163_raw.pdf --pdf-stage PD \
  --expected-profile FACT_FAMILY_V1 \
  --public-manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --pdf-source-id F0163 --wait-seconds 1200

node scripts/smoke-visual-proposals-ui.mjs --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user --object-id OBJ-58FA0B7B \
  --expected-proposals 0 --expected-pages 21 --expected-scanned 21 \
  --expected-unresolved-family-codes AR-042,IOS2-072,IOS3-075
```

`smoke-core.py` при повторе создаст другой объект/run; указанные ID относятся
только к зафиксированному прогону. Пар ПД/РД, экспертных фактов, findings
и подтверждённой полноты перечней этот тест не создавал.
