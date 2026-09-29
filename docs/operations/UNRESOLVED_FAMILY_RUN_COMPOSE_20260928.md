# Сквозная проверка трёх неразрешённых семейств, 28 сентября 2026

## Область

Новый opt-in профиль `typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1` сохраняет в immutable run только строки-подсказки текстового слоя для `AR-042`, `IOS2-072`, `IOS3-075`. Источник строк — committed `document-text-v2` артефакт этого же запуска. Результат каждого кода всегда `ABSTAIN`; `findingCount` и `parameterCoverage` равны `null`. OCR-текст из offline индекса в пакет не импортируется. Старый v3 профиль не изменён.

Условия допуска: проверенные `CURRENT` и `APPROVED` источник/секция `AR` или `VK`, установленная стадия ПД/РД и точные SHA исходного файла, текстового артефакта, блока, строки. Независимый API-валидатор перепроверяет эти связи при сохранении, фиксации и чтении. Максимум 16 строк на код; достижение предела явно отмечается и не означает полноту документа.

## Исходные PDF

Семейства проверены до сквозного запуска на оригинальных разрешённых публичных PDF с проверкой SHA:

- `AR-042`: три PDF, 125 страниц; адресный OCR 19/19 нужных страниц, независимая проверка receipts и рендеров. Два новых OCR-совпадения — оконные проёмы без доказанной эвакуационной применимости. [Протокол](AR_EVACUATION_HEIGHT_REVIEW_20260928.md).
- `IOS2-072`/`IOS3-075`: восемь PDF, 293 страницы; OCR F0204 p.6 проверен по исходному рендеру. Найденные обозначения К2/К4 и ошибочные OCR-строки не устанавливают нужную пару источников; 97 OCR-страниц выбранного среза ещё не обработаны. [Протокол](PIPE_MATERIAL_REVIEW_20260928.md).
- `PPM-102`/`PPM-113`: четыре PDF, 394 страницы, шесть листов визуально проверены; 69 страниц требуют OCR. Это отдельный offline review-only пакет без новой run-sidecar интеграции. [Протокол](FIRE_SAFETY_REVIEW_20260928.md).

## Реальный Compose запуск

Выборочные runtime файлы синхронизированы в изолированный homeserver checkout `/home/freetok/Projects/inspector-ai-homeserver-smoke`; перед заменой сделана копия `/tmp/inspector-unresolved-before-sync-20260928.tar.gz`, SHA-256 `932ecc468e2d5039b9741936e42b672fd5f9cf409ee97daf41645755f8d7f927`. Сверка `rsync --checksum` после переноса не показала различий. Пересобраны API, web и worker, API получил opt-in переменную через `infra/docker-compose.yml`.

Повторный запуск публичного F0202 создал `CHK-04B3B7AA`. Десять задач `analysis_jobs` завершились `SUCCEEDED`. Общий итог: `PARTIAL`, 7 частичных и 125 неподдержанных параметров, 0 findings. В сохранённом ответе — 47 кандидатных кодов `ABSTAIN`, 17 некодированных OCR-строк/3 abstentions/1 продолжение подписи и новый `unresolvedFamilyReview`: три кода `ABSTAIN`, 0 строк-подсказок. Причина пустого списка — у этого источника нет проверенных `CURRENT`/`APPROVED` решений; пакет явно указывает `SOURCE_REVIEW_REQUIRED` и `NO_ELIGIBLE_REVIEWED_SOURCE`. SHA пакета `2a19ac1ac91ea86db97c8a9d4a764d314066e41aa3bd8b3afcc32713d51df828`.

Анонимный `GET /api/checks/CHK-04B3B7AA/pilot-results` вернул 401; аутентифицированный — 200 и те же три `ABSTAIN`. Headless Chrome показал все три кода, 17 кандидатов ручной транскрипции и закрытые пустые формы применимости, пары и количества. Старый superseded run `CHK-69B4215C` через API после reprocess вернул 404; совместимость старого профиля проверена отдельным PostgreSQL тестом save/seal/GET.

Повтор браузерной проверки в изолированном checkout:

```bash
node scripts/smoke-visual-proposals-ui.mjs --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user --object-id OBJ-E655CAA3 \
  --expected-proposals 160 --preview-page 17 \
  --expected-unresolved-family-codes AR-042,IOS2-072,IOS3-075 \
  --expected-ocr-transcription-candidates 17 \
  --expected-ocr-applicability-candidates 0 \
  --expected-ocr-pair-candidates 0 --expected-ocr-quantity-candidates 0 \
  --expected-ocr-comparison-items 0
```

## Проверки и граница результата

Локальный `npm run check` прошёл: API 259 passed/31 skipped, web 49/49, Python suites и сборка успешны; лог `/tmp/hackaton-full-check-unresolved-final-20260928.log`. Отдельный PostgreSQL integration 1/1 проверил новый save/seal/GET, совместимость старого профиля и отказ при подмене строки/SHA, включая чтение после подмены в БД. Положительный synthetic PG сценарий содержит три тестовые строки, но не является решением эксперта по реальным данным. Реальных утверждённых пар ПД/РД, полных перечней и подтверждённых фактов нет. Положительное сравнение на публичном корпусе не заявляется; качество извлечения и coverage не измерены.
