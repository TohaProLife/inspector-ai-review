# Изолированный Compose: подсказки по слоям конструкций

## Источники и граница проверки

Основной исходник F0156 — ПД/АР из разрешённого пакета участника: `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, `UNLABELED`. Его оригинальный PDF имеет **38 страниц** и 6 585 369 байт. [Повторный потоковый аудит](../../output/layer-assembly-compose-20260928/source-audit-f0156.json) на homeserver сверил ZIP, вложенный manifest, член ZIP и извлечённый файл:

| Объект | SHA-256 |
| --- | --- |
| ZIP | `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417` |
| `document_manifest.jsonl` | `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7` |
| F0156 PDF | `16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf` |

Дополнительно проверен F0126 — ПД/ГП, 23 страницы, 7 676 220 байт, PDF SHA `b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088`. [Его аудит](../../output/layer-assembly-compose-20260928/source-audit-f0126.json) заново сверил manifest, член ZIP и извлечённый PDF. Для ZIP использован результат полного потокового хеширования этого же архива в F0156 аудите этого этапа; архив второй раз целиком не читался. Оба файла имеют статус `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN` и не использовались вместе с закрытыми ответами.

## Runtime и preflight

В изолированном Compose `inspector-ai-homeserver-smoke` включили `INSPECTOR_LAYER_ASSEMBLY_REVIEW_PROFILE=v1` и OCR layout v6; остальные review consumers оставлены пустыми. Сохранён remote backup `.sync-backup-20260928-layer-assembly/`, включая прежний env и список новых отсутствовавших модулей. Все [12 runtime-файлов](../../output/layer-assembly-compose-20260928/runtime-allowlist.txt) совпали по [локальным](../../output/layer-assembly-compose-20260928/deploy-local-sha256.txt) и [удалённым](../../output/layer-assembly-compose-20260928/deploy-remote-sha256.txt) SHA. `docker compose config --quiet` прошёл; пересобраны и перезапущены только isolated API, worker и web. До запуска [container preflight](../../output/layer-assembly-compose-20260928/worker-import-preflight.txt) импортировал RULE adapter и новый worker модуль с тремя кодами.

Release обоих runs `release:pz002-pz017:01230ecb5fc3011ee88218b7`, SHA `6b54beb81f0d8bf46998911319bc4cc82d5cf9f3d3964f2566bc169eb34fbde0`. RULE slot `typed-pz002-pz017-layer-assembly-review-v1`, adapter 20, config hash `fcf3a2c6d3ac810de05269a175fa05f66dc07b1d9d1bd0e436888b28cb788dff`.

## F0156: ПД/АР

Новый объект `OBJ-CF64020D` содержит F0156 как `FIL-95739DC1`; `CHK-0AFF6FD5` sealed `PARTIAL`, **10/10 jobs `SUCCEEDED`**, 0 findings. [Run receipt](../../output/layer-assembly-compose-20260928/run-receipt-f0156.json) фиксирует исходный SHA. Execution ledger 2 `PARTIAL` и 130 `UNSUPPORTED` — статусы исполнения, не предметный охват. `document-text-v2` содержит 38 страниц, 37 с текстом и 9 `OCR_REQUIRED`.

Input manifest hash `16f4fbfcf344e9f62c25bce3bd69bcd167b5d74af360896fb3d8e83e3ace6bc6`; текстовый артефакт SHA `c7ee0e7b20341e89da91675e948f333992c06deaecb556e1acba07482cda5876`. RULE stage SHA `41a22cfb83b6ae82df0444b04895b1252079e33ac6fa71b40e1b71ebc29f3b08`, `outputCount=3`: два пилотных результата и один review-only sidecar. OCR v6 stage SHA `21d00ea5a9b357293058da6f74506ad96c312bf683527e323de939a67e1668ce`; [payload](../../output/layer-assembly-compose-20260928/ocr-stage-f0156.json) показывает `processed=0`, `deferred=9`, `reviewEligible=0`, `SKIPPED_SOURCE_REVIEW_REQUIRED`. Реального подтверждённого `CURRENT/APPROVED` источника нет.

[Независимый API-аудит](../../output/layer-assembly-compose-20260928/audit-summary-f0156.json) подтвердил sidecar SHA `5a55fb41c45c64e48a8b73f0ae5e92c9048edf51f05054af6242cd262b7c71ae`: `SPZU-032`, `AR-044`, `ZU-125` имеют `ABSTAIN`, 0 proposals, 0 отложенных строк и 0 eligible sources. `findingCount` и `parameterCoverage` в sidecar равны `null`. Анонимный pilot GET вернул 401, авторизованный 200, source-review GET 404. [SQL audit](../../output/layer-assembly-compose-20260928/sql-audit-f0156.txt) подтвердил sealed run, все jobs/stages и 0 source-review snapshots. [Headless Chrome](../../output/layer-assembly-compose-20260928/ui-smoke-f0156.log) показал три `ABSTAIN`, 0 подсказок и 0 ссылок; [скриншот](../../output/layer-assembly-compose-20260928/ui-f0156.png), SHA `2bcf4503413b5f8c819607e6ddb67d3c949190f233c08696311a0d7fca168907`.

## F0126: ПД/ГП и дорожные слои

Новый объект `OBJ-8A4CBD05` содержит F0126 как `FIL-6C48C386`; `CHK-577B4890` sealed `PARTIAL`, **9/9 jobs `SUCCEEDED`**, 0 findings. [Run receipt](../../output/layer-assembly-compose-20260928/run-receipt-f0126.json) сверил PDF и manifest SHA. `document-text-v2`: 23/23 текстовых страниц, `OCR_REQUIRED=0`; отдельного OCR job не было. Input manifest hash `f71f3f613e1a7c8fb32c7d2cb6598b55253e3888b0d941f342deb88b4d2462a`; текстовый артефакт SHA `d1ec72a0ac2adb37e39c9f8d332ccc964710dd915c5b381dd3eecdee338fb5d6`. RULE stage SHA `bbb2d08f3925cb9275bb32c6b4212ef24b3ce261c16b4a6c33410b2ce7b96e89`.

[Независимый API-аудит](../../output/layer-assembly-compose-20260928/audit-summary-f0126.json) подтвердил sidecar SHA `4455a98be03647f55f59eac258aa6477c0002f8c4e1690407139ae7736f1e8a9`: те же три `ABSTAIN`, 0 proposals/eligible sources, `null` findings/coverage. Для `SPZU-032` причина `EXISTING_SITE_GP_TABLE_ROW_REVIEW` и **0 новых предложений**: подсказки строк ГП не дублируются этим профилем. Анонимный/авторизованный GET 401/200, source-review 404. [SQL audit](../../output/layer-assembly-compose-20260928/sql-audit-f0126.txt) подтвердил sealed stage/jobs и 0 source-review snapshots; [headless Chrome](../../output/layer-assembly-compose-20260928/ui-smoke-f0126.log) показал три `ABSTAIN`, 0 подсказок/ссылок, [скриншот](../../output/layer-assembly-compose-20260928/ui-f0126.png), SHA `9aca1d4e470895fe0ab0b16089d80d55a907db14cb5862d619d47dc0dbbe28a4`.

Предыдущие v1/v2/v3 unresolved-config runs сохранили прежние RULE stage и sidecar SHA, что проверено в обоих SQL и API аудитах. Положительные решения эксперта, подтверждённые конструкции/зоны и пара ПД/РД не создавались. Эти runs проверяют консервативный review-only путь и происхождение; они не доказывают толщину слоя, соответствие проекту, findings, предметный coverage или качество модели. TEST_HIDDEN не использовался.
