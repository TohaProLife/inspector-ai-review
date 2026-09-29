# Изолированный Compose: EQUIPMENT_SPEC на публичном F0171

## Источник и профиль

Использован только оригинальный F0171, ПД/ОВ, из открытого пакета участника.
Его запись в `document_manifest.jsonl` имеет `TRAIN_PUBLIC / INCLUDE /
PUBLIC_TRAIN`; в run переданы только PDF-байты, метки и ответы не читались.
PDF SHA-256
`a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc`,
12 357 877 байт, 177 страниц. Повторный потоковый SHA оригинального ZIP
на homeserver —
`79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`;
вложенный manifest SHA-256 —
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
PDF извлечён по CP866-имени, его SHA/размер и число страниц совпали с
единственной записью F0171. [Аудит источника](../../output/equipment-spec-compose-20260928/source-audit.json).

Отдельный `inspector-ai-homeserver-smoke` получил
`INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE=v1` и OCR layout v6; другие review
consumers пусты. До sync [12-файлового allowlist](../../output/equipment-spec-compose-20260928/runtime-allowlist.txt)
сохранён remote backup `.sync-backup-20260928-equipment-spec/` вместе с env.
[Локальные](../../output/equipment-spec-compose-20260928/deploy-local-sha256.txt)
и [удалённые](../../output/equipment-spec-compose-20260928/deploy-remote-sha256.txt)
SHA совпали. Compose config прошёл; пересобраны и перезапущены только API,
worker, web изолированного проекта.

## Сохранённый запуск

Свежий объект `OBJ-C9E81F8B` содержит один исходный F0171,
`FIL-97E1FB4C`. Запуск `CHK-C8360E50` sealed `PARTIAL`, **9/9 jobs
SUCCEEDED**, 0 findings; текстовый артефакт хранит 177/177 текстовых страниц,
`OCR_REQUIRED=0`, поэтому OCR job не создавался. Execution ledger:
2 `PARTIAL`, 130 `UNSUPPORTED` — статусы исполнения, не предметный охват.

Release `release:pz002-pz017:05afdcc6cb0ee036d8c3db0a`, SHA-256
`5de93b08975e5a559af5c5af521a95cff8ad6191e24bc063dab42849db818edd`.
RULE slot `typed-pz002-pz017-equipment-spec-review-v1`, config SHA-256
`2380ad4760c702edf29352387fbf573d3d613a12a55f6d28843402cfee329af7`.
Input manifest SHA-256
`575842253929124293649fe1114ac460165a820ac1f950c7ab197f9b85f02451`;
`document-text-v2` SHA-256
`881193ebc40c67ee5dd6912e4f10c5efd20627454305deb01dc508180859abae`;
RULE stage SHA-256
`faa2b9f21f59f20557edc0a1efa9541187edb4590732301fcfc95d67752f0c2c`,
`outputCount=3` (два пилотных результата и один sidecar).

## Независимый аудит

Авторизованный GET вернул sidecar SHA-256
`e987cfbaec4f473e035a86dd3a98cff34b5d0097b0bd42f3f2d56ea90125e3f0`:
`IOS4-077`, `IOS4-079`, `PPM-112` имеют `ABSTAIN`, 0 eligible sources и
0 строк-подсказок. Причины: `SOURCE_REVIEW_REQUIRED`,
`NO_ELIGIBLE_REVIEWED_SOURCE`, `PD_RD_PAIR_UNVERIFIED` и консервативные
семейные причины. Анонимный GET: 401; source-review GET: 404;
immutable source-review snapshots: 0. API-аудит сверил scope, исходный PDF,
SHA текстового артефакта и канонический SHA sidecar. Read-only SQL проверил
все 9 jobs, release и stage. Прежний GP-table sidecar `CHK-192193C0`
остался доступен через API с прежним SHA
`f8c33bd156c435db6435218417a6196174ddbffdb08bef8fb833e9caa4eb1df7`;
его RULE stage SHA также совпал с предыдущим прогоном.

Headless Chrome после входа показал три `ABSTAIN`, 0 подсказок, 0 ссылок
на непроверенный источник. [Скриншот](../../output/equipment-spec-compose-20260928/ui-equipment-spec.png),
SHA-256 `8ba451985e562dc9967cd1d02238e99579a1ff1214f7b19ea548f91ec416d19b`.

Доказательства: [run receipt](../../output/equipment-spec-compose-20260928/run-receipt.json),
[API audit](../../output/equipment-spec-compose-20260928/audit-summary.json),
[SQL audit](../../output/equipment-spec-compose-20260928/read-only-audit-result.txt),
[browser smoke](../../output/equipment-spec-compose-20260928/ui-smoke.json).
В этом запуске положительная ветка с действительно проверенным
`CURRENT/APPROVED` источником не испытана: решения эксперта не создавались.
Лиды из публичного PDF, факты, пары ПД/РД, findings и coverage не выдумывались.
