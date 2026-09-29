# Изолированный Compose: UNRESOLVED_CONFIG на публичном F0126

## Источник и сборка

Взяли оригинальный F0126, ПД/GP, из публичного пакета участника:
`TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, `UNLABELED`, 23 страницы.
Повторный потоковый SHA-256 ZIP на homeserver —
`79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`;
вложенного manifest —
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`;
PDF — `b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088`.
PDF имеет 7 676 220 байт; SHA и размер извлечённого файла совпали с
manifest и членом ZIP. [Аудит источника](../../output/unresolved-config-compose-20260928/source-audit.json).
Из 19 конфигурационных кодов четырём подходит роль ПД/GP: `SPZU-027`,
`SPZU-028`, `SPZU-031`, `SPZU-033`. Предметная применимость не подтверждена.

Для изолированного проекта `inspector-ai-homeserver-smoke` включили
`INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v1`, OCR layout v6 и отключили
остальные review consumers. Сохранили remote backup
`.sync-backup-20260928-unresolved-config/` вместе с env. Все
[14 runtime-файлов](../../output/unresolved-config-compose-20260928/runtime-allowlist.txt)
сверены по [локальным](../../output/unresolved-config-compose-20260928/deploy-local-sha256.txt)
и [удалённым](../../output/unresolved-config-compose-20260928/deploy-remote-sha256.txt)
SHA. Compose config прошёл; пересобраны и перезапущены только isolated API,
worker и web.

## Первый запуск: подтверждённый дефект сборки

`CHK-4C4C29C4` на свежем объекте F0126 завершился `FAILED`, не sealed.
`DOCUMENT_TEXT_LAYER` и другие upstream jobs прошли, но
`RULE_EVALUATION` получил `WORKER_EXECUTION_ERROR`:

```text
[Errno 2] No such file or directory: '/usr/local/lib/python3.13/site-packages/rules/unresolved-review-config-v1.json'
```

Причина: Docker-образ копирует JSON в `/worker/rules` и задаёт
`INSPECTOR_RULES_DIR=/worker/rules`, а новый evaluator искал `rules` рядом
с установленным Python wheel в `site-packages`. Исходный запуск оставлен
как доказательство; его нельзя считать успешной проверкой 19 кодов.
[Read-only SQL audit](../../output/unresolved-config-compose-20260928/failed-run-read-only-audit.txt)
и [smoke error](../../output/unresolved-config-compose-20260928/smoke-core-error.txt)
фиксируют статус. Проверка после исправления выполнена отдельным свежим run ниже.

Положительных решений эксперта по источнику не создавали. Факты, пары
ПД/РД, замечания и предметный охват по этому запуску не заявляются.

## Исправление и свежий сохранённый запуск

Worker стал брать конфигурацию и реестр из `INSPECTOR_RULES_DIR` в Docker,
с fallback к каталогу исходников для локального режима. После локальных
focused tests и совпадения
[SHA исправленного модуля](../../output/unresolved-config-compose-20260928/fix-local-sha256.txt)
с [удалённым SHA](../../output/unresolved-config-compose-20260928/fix-remote-sha256.txt)
пересобран и перезапущен только isolated RULE worker. Старый failed run не
повторно запускался и не удалялся.

Новый объект `OBJ-BCBAE71F` содержит F0126 как `FIL-D7CADDE3`.
`CHK-0855D3C6` sealed `PARTIAL`: **9/9 jobs SUCCEEDED**, 0 findings.
`document-text-v2` содержит 23/23 страниц текстового слоя,
`OCR_REQUIRED=0`; отдельного OCR job не было. Execution ledger:
2 `PARTIAL`, 130 `UNSUPPORTED` — статусы исполнения, не предметный охват.

Release `release:pz002-pz017:f73793db7646b8d3b88af71d`, SHA-256
`dbca0d80f7f8ef161f537568b5ca567d3c03d4280534f44b5c6bc59b161e0b9a`.
RULE slot `typed-pz002-pz017-unresolved-config-review-v1`, config SHA-256
`cb69740e9f14cfb6579d63d74dded5bf64bf606c1ebc7205e3e3a9d171211f55`.
Input manifest SHA-256
`36e060100e049eb1a5cef258d862804146d7d43e705d28541994841257a931b6`;
`document-text-v2` SHA-256
`f7a9470562fddc2831e7a1c1c26cbd0586427c8294a3996de90c43745ecd5a87`.
RULE stage SHA-256
`5e4fa1a00991866c3f4b832cf036fdfed0a02f70edf5038c53583cd4cbd83b3f`,
`outputCount=3`: два пилотных результата и один review-only sidecar.

## Аудит API, интерфейса и предыдущего запуска

Авторизованный GET вернул sidecar SHA-256
`647b4e1c4e01ede785f79ab091fcfd52a94cd99ecf0e76bb0d2bc985d4db071e`:
все 19 кодов `ABSTAIN`, 0 eligible sources и 0 текстовых лидов. Причины
включают `SOURCE_REVIEW_REQUIRED`, `NO_ELIGIBLE_REVIEWED_SOURCE` и
`NO_SCANNED_TEXT_IN_SCOPE`. Последний код означает, что в рамках
подходящих **проверенных** источников текст не просматривался; индексный
текст F0126 от этого не становится отрицательным доказательством.
Закреплённый SHA конфигурации —
`c5aedccb8752ef365ea18298e1ed222f97abd207607b8caf5a18f23fd547bc85`,
реестра — `fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a`.
`findingCount` и `parameterCoverage` в sidecar равны `null`.

Анонимный pilot GET вернул 401, авторизованный 200; source-review GET
вернул 404, immutable snapshots решений 0. API-аудит проверил исходный
PDF, scope, SHA текстового артефакта и канонический SHA sidecar. Read-only
SQL подтвердил release, stage и jobs. Прежний MATERIAL_CLASS
`CHK-44D0DC61` остался доступен с прежними RULE stage SHA
`e99aaf424bcfbd6480a77c2a7db1ce984dbbf3e1d25978bf4c589787706131f3`
и sidecar SHA
`bbd5ffc4e3ef0be2f3108740047def97c03998f053ad3181a7cc8280f275a85e`.

Web получил понятные подписи для `NO_SCANNED_TEXT_IN_SCOPE`,
`PAGE_STAGE_UNRESOLVED_DEFERRED` и `PAGE_STAGE_MAP_INCOMPLETE`; последние
два проверены focused UI test, но в этом одном F0126 run не возникали.
Web typecheck и focused 3/3 теста прошли, финальный компонент сверен
[по SHA](../../output/unresolved-config-compose-20260928/ui-final-local-sha256.txt)
с изолированным web и пересобран. Headless Chrome после входа показал
19 `ABSTAIN`, 0 подсказок/ссылок и русскую причину отсутствия
просмотренного текста без сырого кода.
[Скриншот](../../output/unresolved-config-compose-20260928/ui-unresolved-config-final.png),
SHA-256 `abc58b7061f199e59981a123573a930e62b666fd2df43de7c4fb3090420365e0`.

Доказательства: [run receipt](../../output/unresolved-config-compose-20260928/run-receipt-after-fix.json),
[API audit](../../output/unresolved-config-compose-20260928/audit-summary.json),
[SQL audit](../../output/unresolved-config-compose-20260928/read-only-audit-result.txt),
[browser smoke](../../output/unresolved-config-compose-20260928/ui-final-smoke.json).
Положительная ветка с действительно проверенным `CURRENT/APPROVED`
источником этим тестом не охвачена. Решения эксперта не создавались;
факты, пары ПД/РД, findings и предметный coverage не заявляются.
