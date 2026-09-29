# Изолированный Compose: согласование и безопасность, профиль v2

## Оригинальный публичный источник

Для проверки взят F0156, ПД/АР, из пакета участника: `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, `UNLABELED`. В оригинальном PDF 38 страниц и 6 585 369 байт. Потоковый аудит ZIP, вложенного manifest, члена ZIP и извлечённого файла на homeserver прошёл:

| Объект | SHA-256 |
| --- | --- |
| ZIP | `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417` |
| `document_manifest.jsonl` | `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7` |
| F0156 PDF | `16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf` |

[Подробный аудит источника](../../output/unresolved-config-v2-compose-20260928/source-audit.json) сверяет разрешённую запись manifest и существующий файл `dataset-smoke/F0156_raw.pdf`. Кодам `AR-043` и `AR-052` подходит роль ПД/АР по конфигурации v2; предметная применимость не подтверждена.

## Изолированная сборка и обнаруженный пропуск

В проекте Compose `inspector-ai-homeserver-smoke` включены `INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v2` и OCR layout v6; остальные review consumers оставлены пустыми. До синхронизации создан backup `.sync-backup-20260928-unresolved-config-v2/`, в том числе исходный env. [Первые 14 runtime-файлов](../../output/unresolved-config-v2-compose-20260928/runtime-allowlist.txt) совпали по [локальным](../../output/unresolved-config-v2-compose-20260928/deploy-local-sha256.txt) и [удалённым](../../output/unresolved-config-v2-compose-20260928/deploy-remote-sha256.txt) SHA. `docker compose config --quiet` прошёл; пересобраны и перезапущены только isolated API, worker и web.

После первой сборки worker не запускался: `pilot_rule_adapter.py` импортировал новый `unresolved_config_review_v2.py`, но он отсутствовал в allowlist. [Сохранённый лог](../../output/unresolved-config-v2-compose-20260928/failed-worker.log) содержит `ModuleNotFoundError`. Исходный smoke-клиент для `CHK-A9D3F315` был прерван при этом сбое; его нельзя выдавать за полный результат первой сборки. Модуль добавлен отдельной синхронизацией, его [локальный](../../output/unresolved-config-v2-compose-20260928/repair-local-sha256.txt) и [удалённый](../../output/unresolved-config-v2-compose-20260928/repair-remote-sha256.txt) SHA совпали: `5af499fd9ac1d6b7048f11435f76a065412d303a973c8291bd14e98b749ce3f5`. В backup зафиксировано, что файла до исправления не было. Пересобран только isolated worker. [Container preflight](../../output/unresolved-config-v2-compose-20260928/worker-import-preflight.txt) импортировал адаптер и загрузил v2 конфигурацию.

После восстановления worker ранее созданный `CHK-A9D3F315` самостоятельно дошёл до sealed `PARTIAL`, 10/10 jobs `SUCCEEDED`. Его [read-only запись](../../output/unresolved-config-v2-compose-20260928/early-run-after-repair.txt) содержит RULE stage SHA `8642fb394e3036433aaf6165a6070b7b7785fbed1b8741a60b6e8b33183e773d` и sidecar SHA `6e4a2b2a913043ccc66b29aa0282adecfe4e0b4dbc8491f66daa8efe9e380c4f`. Для итоговой проверки создан отдельный новый объект и run ниже.

## Свежий сохранённый run

Новый объект `OBJ-2EEAD529` содержит F0156 как `FIL-4B12D427`; `CHK-3F610706` sealed `PARTIAL`, **10/10 jobs `SUCCEEDED`**, 0 findings. [Run receipt](../../output/unresolved-config-v2-compose-20260928/run-receipt-fresh.json) повторно фиксирует PDF и manifest SHA. Execution ledger: 2 `PARTIAL`, 130 `UNSUPPORTED`; это статусы исполнения, а не предметный охват. В `document-text-v2` 38 страниц, 37 с текстом и 9 `OCR_REQUIRED`.

Release `release:pz002-pz017:c7a1eef0b971bbb45b531731`, SHA `92206d248e7243e6a4382f071a0222f0d9d8425715795ac78435d9b16b22478b`. RULE slot `typed-pz002-pz017-unresolved-config-review-v2`, adapter 18, config hash `58d0eb1afbc63c329a29b4935ad575bd64a72a1934191b5fd56d3f0675272ace`. Input manifest hash `d6e6e3c7b09cd6d5fbcebf05c2cfde32fe08ddc0c66ed8a56bd7570442943a27`. RULE stage SHA `e3b41df7ac35af1014e79946a9aba0f2029adc07235dacc23ff08ccc26ff7cac`, `outputCount=3`: два пилотных результата и один review-only sidecar. [Read-only SQL audit](../../output/unresolved-config-v2-compose-20260928/sql-audit.txt) содержит release, все jobs и stages.

OCR v6 stage SHA `98cd2d7df457e1bfd33bdff2cb172674167ecd2fe1bb2f517b2e15301bb000ca`. [Сохранённый stage payload](../../output/unresolved-config-v2-compose-20260928/ocr-stage.json) показывает `processedPageCount=0`, `deferredPageCount=9`, `ocrRequiredPageCount=9`, `reviewEligiblePageCount=0`, статус источника `SKIPPED_SOURCE_REVIEW_REQUIRED`. Отсутствие проверенного `CURRENT/APPROVED` решения по источнику объясняет отсрочку; OCR не выдавался за отрицательное доказательство.

## Проверка API, UI и предыдущего профиля

[Независимый API-аудит](../../output/unresolved-config-v2-compose-20260928/audit-summary.json) проверил исходный PDF SHA, stage/manifest scope и канонический хеш sidecar `b911ac0f324046b99e583213d93451b48f56c70d8d0b5266776ef04bd7003964`. Все 10 кодов `ABSTAIN`, 0 eligible sources, 0 текстовых подсказок. Закреплённые SHA конфигурации и реестра: `1c31aad1761af86273f421daef5fc04bfe7724c9bf07750a1f1b8b37be30a0e8` и `fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a`. `findingCount` и `parameterCoverage` в sidecar равны `null`.

Анонимный pilot GET вернул 401, авторизованный 200, source-review GET 404; snapshots решений по источнику 0. Старый v1 `CHK-0855D3C6` сохранил RULE stage SHA `5e4fa1a00991866c3f4b832cf036fdfed0a02f70edf5038c53583cd4cbd83b3f` и sidecar SHA `647b4e1c4e01ede785f79ab091fcfd52a94cd99ecf0e76bb0d2bc985d4db071e`.

[Headless Chrome smoke](../../output/unresolved-config-v2-compose-20260928/ui-smoke.log) после входа показал 10 `ABSTAIN`, 0 подсказок и 0 ссылок. [Скриншот](../../output/unresolved-config-v2-compose-20260928/ui-v2.png), SHA `0856f6e5a52aa244bbe20531ef6c5dbd525dfc4147a79fc93e9ec6a23f769f57`. В раскрытом счётчике новой v2 панели остался технический текст `OCR_REQUIRED`; это замечание к формулировке интерфейса, переданное владельцу web.

Реального положительного решения эксперта, утверждённой пары ПД/РД и проверенной предметной применимости не было. Этот smoke проверяет отказоустойчивое `ABSTAIN` и сохранение происхождения, но не положительную ветку сравнения; findings, предметный coverage и качество модели не заявляются. TEST_HIDDEN и закрытые ответы не использовались.
