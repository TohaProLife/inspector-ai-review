# Изолированный Compose: топология сетей, профиль v3

## Оригинальный публичный источник

Для проверки взят F0171, ПД/ОВ, из пакета участника: `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`. Оригинальный PDF содержит 177 страниц и 12 357 877 байт. Повторный потоковый аудит на homeserver сверил ZIP, вложенный manifest, член ZIP и извлечённый PDF:

| Объект | SHA-256 |
| --- | --- |
| ZIP | `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417` |
| `document_manifest.jsonl` | `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7` |
| F0171 PDF | `a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc` |

[Аудит источника](../../output/unresolved-config-v3-compose-20260928/source-audit.json) подтверждает также разрешённую запись manifest и `dataset-smoke/F0171_raw.pdf`. PDF тематически относится к профилю топологии сетей; наличие конкретной подтверждённой ветви, элемента и сопоставимой пары ПД/РД из этого не следует. Метки ответов для вывода не использовались.

## Сборка и запуск

В изолированном проекте `inspector-ai-homeserver-smoke` включены `INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v3` и OCR layout v6; другие review consumers оставлены пустыми. Перед синхронизацией сохранён remote backup `.sync-backup-20260928-unresolved-config-v3/`, включая предыдущий env и список отсутствовавших новых файлов. Все [15 runtime-файлов](../../output/unresolved-config-v3-compose-20260928/runtime-allowlist.txt) сверены по [локальным](../../output/unresolved-config-v3-compose-20260928/deploy-local-sha256.txt) и [удалённым](../../output/unresolved-config-v3-compose-20260928/deploy-remote-sha256.txt) SHA. `docker compose config --quiet` прошёл; пересобраны и перезапущены только isolated API, worker и web.

До создания run [preflight внутри worker контейнера](../../output/unresolved-config-v3-compose-20260928/worker-import-preflight.txt) импортировал RULE adapter и v3 модуль, загрузил все 7 записей закреплённой конфигурации; её SHA `ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a`.

Новый объект `OBJ-14E5FB98` содержит F0171 как `FIL-E0F8C037`; `CHK-A2EC9D6E` sealed `PARTIAL`: **9/9 jobs `SUCCEEDED`**, 0 findings. [Run receipt](../../output/unresolved-config-v3-compose-20260928/run-receipt.json) повторно фиксирует исходный PDF и manifest SHA. В `document-text-v2` 177/177 страниц с текстом, `OCR_REQUIRED=0`, поэтому отдельного OCR job не было. Execution ledger: 2 `PARTIAL`, 130 `UNSUPPORTED`; эти статусы не означают предметный охват.

Release `release:pz002-pz017:b303af4ad364c6b2e948f0c4`, SHA `4f55a420d51d1408c666925d3e7a718bc687ac298260b5503645b5a81068b819`. RULE slot `typed-pz002-pz017-unresolved-config-review-v3`, adapter 19, config hash `3c796da193a0317e1f07e888c49f50c7fa6374a6ae8fe08ee0850300ce2eeb49`. Input manifest hash `e85a5375330a66f86e2aefc63907292717a60c7d0a0f3393736d55eb1fd1a8e1`; `document-text-v2` SHA `b1a85a38f9db8c3a90258ee9f452fc77b397762f93483d9d1c1ef1f4f8db4036`. RULE stage SHA `a7202d6f9fac66505016e58aaabbf33fa83d780c716ec10b5faeeeba8046eb7e`, `outputCount=3`: два пилотных результата и один review-only sidecar. [Read-only SQL audit](../../output/unresolved-config-v3-compose-20260928/sql-audit.txt) показывает release, jobs, stages и отсутствие snapshot решений по источнику.

## Независимый API и браузер

[API-аудит](../../output/unresolved-config-v3-compose-20260928/audit-summary.json) проверил SHA PDF, scope manifest, текстовый артефакт и канонический sidecar SHA `c2619e9122dc2de900b089c870af7aea3c66fe73577ed49781d4b6c5bc347606`. Все 7 кодов `ABSTAIN`, 0 eligible sources, 0 строк-подсказок; причины включают `SOURCE_REVIEW_REQUIRED`, `NETWORK_TOPOLOGY_UNVERIFIED`, `NO_ELIGIBLE_REVIEWED_SOURCE`. Закреплённые SHA конфигурации и реестра — `ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a` и `fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a`. `findingCount` и `parameterCoverage` в sidecar равны `null`.

Анонимный pilot GET вернул 401, авторизованный 200, source-review GET 404. Старые runs сохранили прежние RULE stage и sidecar SHA: v1 `CHK-0855D3C6` — `5e4fa1a00991866c3f4b832cf036fdfed0a02f70edf5038c53583cd4cbd83b3f` / `647b4e1c4e01ede785f79ab091fcfd52a94cd99ecf0e76bb0d2bc985d4db071e`; v2 `CHK-3F610706` — `e3b41df7ac35af1014e79946a9aba0f2029adc07235dacc23ff08ccc26ff7cac` / `b911ac0f324046b99e583213d93451b48f56c70d8d0b5266776ef04bd7003964`.

[Headless Chrome smoke](../../output/unresolved-config-v3-compose-20260928/ui-smoke.log) после входа показал 7 `ABSTAIN`, 0 строк и 0 ссылок. [Скриншот](../../output/unresolved-config-v3-compose-20260928/ui-v3.png) визуально проверен, SHA `26e9185be330aa917ebdbdff352e349de393110e6e1fd264d153d87600a58269`.

Положительное решение эксперта по редакции источника, утверждённая пара ПД/РД и топология конкретной сети отсутствуют. Этот smoke проверяет сохранение и консервативный `ABSTAIN`, но не положительную ветку предметного сравнения. Findings, предметный coverage и качество модели не заявляются. TEST_HIDDEN и закрытые ответы не использовались.
