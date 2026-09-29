# Изолированный Compose: MATERIAL_CLASS на публичном F0140

## Источник и профиль

Проверен оригинальный F0140, РД/КР, из открытого пакета участника. Запись
`document_manifest.jsonl` имеет `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`,
статус разметки `UNLABELED`. В запуск переданы только байты PDF; закрытые
ответы и TEST_HIDDEN не использовались. Повторный потоковый SHA-256 ZIP на
homeserver: `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`.
SHA-256 вложенного manifest:
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
PDF извлечён из ZIP по CP866-имени: 5 045 440 байт, 27 страниц, SHA-256
`2c46f909396f33e4286637319fe4829d8d4cf6742c0e7337577dfdc4127ab085`.
SHA и размер извлечённого файла повторно совпали с manifest и членом ZIP.
[Аудит источника](../../output/material-class-compose-20260928/source-audit.json).

В отдельном проекте `inspector-ai-homeserver-smoke` включены
`INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE=v1` и OCR layout v6; остальные
review consumers пусты. Перед синхронизацией
[12 runtime-файлов](../../output/material-class-compose-20260928/runtime-allowlist.txt)
сохранён удалённый backup `.sync-backup-20260928-material-class/` вместе с env.
[Локальные](../../output/material-class-compose-20260928/deploy-local-sha256.txt)
и [удалённые](../../output/material-class-compose-20260928/deploy-remote-sha256.txt)
SHA каждого файла совпали. Compose config прошёл. Пересобраны и перезапущены
только API, worker и web изолированного проекта.

## Сохранённый запуск

Свежий объект `OBJ-03059CC8` содержит один исходный F0140,
`FIL-3DEABB88`. Запуск `CHK-44D0DC61` sealed `PARTIAL`: **9/9 jobs
SUCCEEDED**, 0 findings. `document-text-v2` содержит 27/27 страниц
текстового слоя, `OCR_REQUIRED=0`; отдельный OCR job не создавался.
Execution ledger: 2 `PARTIAL`, 130 `UNSUPPORTED`. Это статусы исполнения,
не предметный охват.

Release `release:pz002-pz017:a40828bc21168822e3f74a01`, SHA-256
`f3524f768f1ab0fd988f7835b3ebb4a17403403c4c49a33d14051aeeede8dcc8`.
RULE slot `typed-pz002-pz017-material-class-review-v1`, config SHA-256
`474a4539fbceaca26311fedf85e8473fdb88b14db92f63ecddee9e5d0069fa09`.
Input manifest SHA-256
`0f224d2171e1d8c182d4f0bf8db8ecf9b5ad5b7dd14c166876a881e92fdf3d02`;
`document-text-v2` SHA-256
`9270ae70d00500a4d246683beb2da45b393617f795c18badb4a0b10a81b710ff`.
RULE stage SHA-256
`e99aaf424bcfbd6480a77c2a7db1ce984dbbf3e1d25978bf4c589787706131f3`,
`outputCount=3`: два пилотных результата и один MATERIAL_CLASS sidecar.

## Независимый аудит

Авторизованный GET вернул sidecar SHA-256
`bbd5ffc4e3ef0be2f3108740047def97c03998f053ad3181a7cc8280f275a85e`.
`KR-056`, `KR-057`, `KR-066` имеют `ABSTAIN`, 0 eligible sources и 0
строк-подсказок. Причины включают `SOURCE_REVIEW_REQUIRED`,
`NO_ELIGIBLE_REVIEWED_SOURCE`, `ELEMENT_IDENTITY_UNVERIFIED` и
`PD_RD_PAIR_UNVERIFIED`. Ни один элемент, состав или фактическая огнезащита
не подтверждены. `findingCount` и `parameterCoverage` у sidecar равны
`null`. Анонимный pilot GET: 401; source-review GET: 404; immutable
source-review snapshots: 0. API-аудит повторно проверил scope, PDF SHA,
SHA текстового артефакта и канонический SHA sidecar.

Read-only SQL подтвердил 9 jobs, release, RULE stage и отсутствие source
decisions. Прежний EQUIPMENT_SPEC run `CHK-C8360E50` остался доступен через
API с прежним sidecar SHA
`e987cfbaec4f473e035a86dd3a98cff34b5d0097b0bd42f3f2d56ea90125e3f0`;
его RULE stage SHA также не изменился.

Headless Chrome после входа показал три `ABSTAIN`, 0 подсказок и 0 ссылок
на непроверенный источник. [Скриншот](../../output/material-class-compose-20260928/ui-material-class.png),
SHA-256 `3ae3d9841b3119129a8402e9463655caf098f2f5b05478fd14b46d5398528bb6`.

Доказательства: [run receipt](../../output/material-class-compose-20260928/run-receipt.json),
[API audit](../../output/material-class-compose-20260928/audit-summary.json),
[SQL audit](../../output/material-class-compose-20260928/read-only-audit-result.txt),
[browser smoke](../../output/material-class-compose-20260928/ui-smoke.json).
Положительная ветка с действительно проверенным `CURRENT/APPROVED`
источником здесь не испытана: решения эксперта не создавались. Совпадения
материальных марок не повышались до фактов и сравнений ПД/РД.
