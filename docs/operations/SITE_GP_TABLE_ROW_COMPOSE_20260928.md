# Изолированный Compose: соседство табличных блоков ГП на F0126

## Источник и запуск

Использован оригинальный, не аннотированный `F0126` из публичного ZIP
`01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip`. Запись manifest имеет
`TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, ПД/ГП, `UNLABELED`.
PDF SHA-256 `b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088`,
7 676 220 байт, 23 страницы. Повторное потоковое чтение оригинального ZIP
на homeserver дало SHA-256
`79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`;
внутри него manifest SHA-256
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
Член PDF прочитан из ZIP по CP866-имени, его SHA/размер совпали с единственной
записью `F0126` manifest, где также указаны 23 страницы.
[Аудит источника](../../output/site-gp-table-row-compose-20260928/source-audit.json).

Отдельный проект Compose `inspector-ai-homeserver-smoke` получил
`INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE=v1`, OCR layout v6;
другие review consumers выключены. До копирования каждого файла из
[allowlist](../../output/site-gp-table-row-compose-20260928/runtime-allowlist.txt)
сохранён remote backup в `.sync-backup-20260928-site-gp-table-row/`;
локальные и удалённые SHA всех 12 файлов
совпали [перед сборкой](../../output/site-gp-table-row-compose-20260928/deploy-local-sha256.txt).
Пересобраны и перезапущены только API, worker и web изолированного проекта.

Новый запуск `CHK-192193C0` повторно использовал сохранённый F0126
`FIL-2D1178F7` объекта `OBJ-3F27A63B`. Он sealed `PARTIAL`, все **9/9 jobs
SUCCEEDED**, 0 findings. OCR job не создавался: сохранённый текстовый артефакт
имеет 23/23 текстовые страницы, `OCR_REQUIRED=0`. Execution ledger содержит
2 `PARTIAL` и 130 `UNSUPPORTED`; это не предметный охват.

Release `release:pz002-pz017:8356bc1f93032f1d9606e73e`, SHA-256
`ae52cd20bf96c3509e5580debf896c33d03818918a37e86d76b7e91a1c34d2de`.
RULE slot `typed-pz002-pz017-site-gp-table-row-review-v1`, config SHA-256
`9b3bb80f41f7b1f57df3093b4491b0da9acbcd1aa65c48c3d063882715bbe3ab`.
Input manifest SHA-256
`0abd194dcac7ab5cb75c1e9134a400df775d9914bfd75d74c6a082e47d53ab81`.
`document-text-v2` SHA-256
`ed7cc26822aa7739511bbf3f044f5d547786d8ac746439f23f75e9d2c2951590`;
RULE stage SHA-256
`afeea2123ce977be56a8bea411dcdac1bbb5fd36cb155e114efc6c0197ef510b`,
`outputCount=3` (два пилотных результата и один sidecar).

## Результат и независимая проверка

Авторизованный GET показал sidecar SHA-256
`f8c33bd156c435db6435218417a6196174ddbffdb08bef8fb833e9caa4eb1df7`:
`SPZU-029` и `SPZU-032` имеют `ABSTAIN`, 0 eligible sources,
0 предложений соседства и 0 воздержаний по конкретным блокам. Причины
включают `SOURCE_REVIEW_REQUIRED`, `NO_ELIGIBLE_REVIEWED_SOURCE`,
`ROW_ASSOCIATION_UNVERIFIED`; утверждённого `CURRENT/APPROVED` решения
по F0126 нет. Анонимный GET вернул 401. Независимый API-аудит проверил
канонический SHA пакета, SHA PDF и текстового артефакта, scope и причины.
Read-only SQL подтвердил immutable stage, 9 jobs и 0 source-review snapshots.

Прежний SITE_TEP sidecar `CHK-F71034FE` доступен через API с прежним SHA
`75845d24283b3eb29e985d01214f0b01ec13592460f3ecf07e253156cdc3134f`.
Прежний F0126 SITE_GP run `CHK-A97C4079` после повторного запуска того же
объекта даёт API 404; read-only SQL подтвердил, что его RULE stage SHA
`c5f3b134d8b47fc3822bdb6a267c591e868f0ec45d5ba122a2eb46c354626d5f`
и сохранённый sidecar SHA
`18db46fdb851652ddbda854be983fc721829787b044660bc83816d1ffb811051`
не изменились.

Headless Chrome после входа показал оба `ABSTAIN`, 0 соседств, 0 ссылок
на непроверенный источник. [Скриншот](../../output/site-gp-table-row-compose-20260928/ui-site-gp-table.png),
SHA-256 `e497b14fc1a78fa719d64ab1e39636b76dd375e366d6911c8ccc009cc6fc6858`.

Машинные доказательства: [run receipt](../../output/site-gp-table-row-compose-20260928/run-receipt.json),
[SQL и результат](../../output/site-gp-table-row-compose-20260928/read-only-audit-result.txt),
[API audit](../../output/site-gp-table-row-compose-20260928/audit-summary.json),
[UI smoke](../../output/site-gp-table-row-compose-20260928/ui-smoke.json),
[сохранённый ответ](../../output/site-gp-table-row-compose-20260928/pilot-results.json).
Факты, пары ПД/РД, вывод о наличии или отсутствии параметра, findings и
coverage не создавались. Соседство текстовых блоков не доказывает строку
таблицы.
