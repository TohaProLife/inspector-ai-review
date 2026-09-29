# Изолированный Compose: KR-065, подписи проёмов

## Оригинальный публичный источник

Проверен исходный `F0141` — РД/КР, `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, без закрытых ответов. [Свежий аудит](../../output/kr065-opening-compose-20260928/source-audit-f0141.json) на homeserver прочитал полный ZIP, вложенный `document_manifest.jsonl`, член ZIP и извлечённый PDF. Потоковый SHA члена, SHA извлечённого файла, размер и число страниц совпали с manifest и `pdfinfo`.

| Данные | Проверенное значение |
| --- | --- |
| Исходный ZIP SHA-256 | `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417` |
| Manifest SHA-256 | `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7` |
| F0141 PDF SHA-256 | `421a34429325f424d3e29086810b1283e805d9bb3c75646508e5434b248e5d5f` |
| PDF | 5 302 653 байт, 32 страницы |

Это тематический документ: ранее визуально проверенный исходный лист `F0141` с.23 содержит подпись отверстия №7 с размером 750×750 мм. В этом запуске текстовую строку **не повышали** до предложения, поскольку решение `CURRENT / APPROVED` об источнике отсутствует.

## Изолированный runtime

В checkout `inspector-ai-homeserver-smoke` установлен opt-in `INSPECTOR_KR065_OPENING_REVIEW_PROFILE=v1`; предыдущий `LAYER_ASSEMBLY` отключён, OCR layout v6 оставлен. Другие review consumers пусты. Remote backup `.sync-backup-20260928-kr065-opening/` сохранён. Все [12 runtime-файлов](../../output/kr065-opening-compose-20260928/runtime-allowlist.txt) совпали по [локальному](../../output/kr065-opening-compose-20260928/deploy-local-final-sha256.txt) и [удалённому](../../output/kr065-opening-compose-20260928/deploy-remote-final-sha256.txt) SHA. `docker compose config --quiet` и [импорт нового модуля в собранном worker image](../../output/kr065-opening-compose-20260928/worker-import-preflight.txt) прошли. Пересобраны и перезапущены только isolated API, worker, web; чужие контейнеры не трогали.

Release `release:pz002-pz017:7d64bf32bce93bb92b12f2a9`, SHA `fb1ab1ec3b2d3da5cc9739ddba3a9c4f8c4dece2dfd969918724d99b199c6a67`. RULE slot `typed-pz002-pz017-kr065-opening-review-v1`, adapter 21, config SHA `ab7fbad525ea3d15352d14f0fb56af86068fc0ff25d3a5477fc7eab3f3d6f7e3`.

## Run F0141

Новый объект `OBJ-0BBD99CB`, исходный файл `FIL-1073A401`, check `CHK-DDFAE354` запечатан как `PARTIAL`: **9/9 jobs `SUCCEEDED`**, 0 findings. [Smoke receipt](../../output/kr065-opening-compose-20260928/run-receipt.json) подтверждает исходный PDF и публичный manifest. OCR job не потребовался: `document-text-v2` имеет 32/32 страниц с текстом, `OCR_REQUIRED=0`. Это не подтверждает корректность распознавания чертежа.

Input manifest hash `25dde8a93b9c2102dad97ad8b87f76c9856bf9fe93f64b306676a5e04ec9e1f8`; текстовый артефакт SHA `ab34a34ba391cec2ac0e1a58a9ae71cc399c9bf571596b1cb5b6c866ab6ceb87`; RULE stage SHA `34bee076c1db9beab2d603eead525b7e5890c97abc644b4c08178a30e7d8ea7f`, `outputCount=3`. [SQL audit](../../output/kr065-opening-compose-20260928/sql-audit.txt) подтвердил sealed run, release, jobs, stages и 0 snapshot решений об источнике. Execution ledger 2 `PARTIAL` и 130 `UNSUPPORTED` — статусы исполнения, не предметный охват.

[Независимый API-аудит](../../output/kr065-opening-compose-20260928/audit-summary.json) повторно проверил исходный SHA, canonical sidecar SHA `de0e1aba10ca4a9da1e985f6794679c57bfb5317e96b1a57cffae84f64c8b70b` и результат `KR-065: ABSTAIN`, 0 подходящих источников, 0 предложений, 0 отложенных строк, `findingCount=null`, `parameterCoverage=null`. Анонимный GET вернул 401, авторизованный 200, source-review GET 404. Предыдущие v1/v2/v3 unresolved и два LAYER_ASSEMBLY run сохранили прежние RULE/sidecar SHA; подтверждение в том же SQL audit.

[Headless Chrome](../../output/kr065-opening-compose-20260928/ui-smoke-after-copy.log) показал отдельную KR-065 панель, один `ABSTAIN`, 0 подсказок и 0 ссылок. На первом [скриншоте](../../output/kr065-opening-compose-20260928/ui-f0141.png) обнаружен неточный текст, утверждавший, что метка и размер найдены при 0 предложений. Компонент исправлен условной подписью, focused web typecheck и 3/3 UI теста прошли; после SHA-sync и пересборки **только isolated web** повторный [скриншот](../../output/kr065-opening-compose-20260928/ui-f0141-after-copy.png) (SHA `35f6993e299d142307ecfabcaf643d2ae5bb61f09212a5f87f9e949bb7de1b09`) показывает «Текстовых подсказок для ручного просмотра нет». Immutable run и sidecar не менялись.

Положительные решения эксперта и утверждённая пара ПД/РД не создавались. Этот запуск проверяет консервативную доставку и сохранение review-only результата; он не подтверждает проём, усиление, заделку, нарушение, предметный охват или качество модели. `TEST_HIDDEN` не использовался.
