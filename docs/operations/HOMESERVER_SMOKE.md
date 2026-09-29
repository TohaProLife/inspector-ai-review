# Изолированный прогон на homeserver

Последняя проверка текстовой политики v2 и двух полных run по F0153:
[PUBLIC_DOCUMENT_INDEX_V4_20260927.md](PUBLIC_DOCUMENT_INDEX_V4_20260927.md).

24–26 сентября 2026. На `homeserver` работает GeForce RTX 2080 SUPER 8 GB и драйвер NVIDIA 580.178.04. Прогон ниже остаётся **проверкой приложения и инфраструктуры**, не H100-профиля и не качества ML. Исторические прогоны ниже выполнены с `SCAFFOLD`. С 26 сентября в изолированном smoke-проекте включён `PILOT_PZ002`: новые проверки имеют 131 `UNSUPPORTED` и одну `PARTIAL` coverage-строку; локальный профиль приложения и стенд H100 этим не меняются.

Рабочая копия: `/home/freetok/Projects/inspector-ai-homeserver-smoke`. Проект Compose: `inspector-ai-homeserver-smoke`. Порты привязаны только к `127.0.0.1` homeserver: web `18081`, API `14100`, PostgreSQL `15432`, RabbitMQ `15673`/`25672`, Redis `16379`, MinIO `19000`/`19001`. Секреты сгенерированы в `infra/.env.homeserver-smoke` с правами `0600`; не переносить их в Git и не удалять при сохранённых volumes.

Запуск из рабочей копии:

```bash
docker compose --project-name inspector-ai-homeserver-smoke \
  --env-file infra/.env.homeserver-smoke \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.core-smoke.yml \
  up -d --build
```

Проверка:

```bash
docker compose --project-name inspector-ai-homeserver-smoke \
  --env-file infra/.env.homeserver-smoke \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.core-smoke.yml ps
curl -fsS http://127.0.0.1:14100/api/health
curl -fsS http://127.0.0.1:18081/api/health
curl -fsSI http://127.0.0.1:18081/
```

Локальный просмотр через SSH-туннель:

```bash
ssh -L 18081:127.0.0.1:18081 homeserver
```

Затем открыть `http://127.0.0.1:18081/`. Не публиковать этот тестовый профиль наружу: session cookies настроены для локального HTTP. Остановка с сохранением DB и files: та же команда Compose с `down` вместо `up -d --build`. `down -v` удалит тестовые данные.

Тестовый пользователь `homeserver-smoke` создан только в этом проекте. Логин и случайный пароль лежат в `infra/.smoke-user` с правами `0600`. Проверка пользовательского пути:

```bash
python3 scripts/smoke-core.py \
  --credentials-file infra/.smoke-user \
  --pdf scripts/fixtures/smoke.pdf
```

Фактический прогон: вход, создание `OBJ-D0654A0D`, загрузка PDF в `UPL-BCDBBD07`, запуск `CHK-FEEC44FF`, итог `PARTIAL`, ровно 132 `UNSUPPORTED`. Это подтверждает работу API, ClamAV, MinIO, PostgreSQL, outbox, очереди и workers на данном тестовом PDF. Прямой `/api/health`, web proxy и MinIO live endpoint вернули HTTP 200; применены 12 миграций; 4 PostgreSQL integration tests прошли. Все 12 постоянных контейнеров остались в `running`; healthchecks имеющихся probe-сервисов прошли. После прогона осталось около 64 GiB диска и 4,7 GiB доступной RAM.

Образ MinIO закреплён по digest из [публичной сборки Coollabs](https://github.com/coollabsio/minio). Исходный digest `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` при развёртывании 24 сентября вернул `401 UNAUTHORIZED`; зеркало содержит тот же release tag, но является сторонней сборкой. Перед конкурсным релизом нужно зафиксировать SBOM/provenance. Загрузка PDF через API подтвердила S3-совместимый путь на тестовом образе.

Для H100 использовать только отдельный профиль `./infra/stack.sh server ...` на стенде с одной выделенной H100 80 GB. CPU-прогон не даёт оснований отмечать provider slots как `CONFIGURED`.

## Доступные данные и проверка на реальных PDF

24 сентября на homeserver перенесены локальные `datasets/` и `downloads/`: 240 файлов, суммарно 1 705 478 586 байт. Повторный `rsync --checksum --dry-run` не нашёл различий. Корни обоих каталогов закрыты правами `0700`; контейнеры получают только явный mount пакета участника. Папка `ОРГАНИЗАТОР_ЗАКРЫТЫЙ` не используется как обучающая или проверочная разметка.

Перенесённые `datasets/` и `downloads/` не содержат все 416 оригиналов трёх объектов (`Новослободская`, `Тюменская`, `Речников`). Публичная папка Яндекс.Диска `https://disk.yandex.ru/d/CvZaShLNfE2XSQ` открыта на homeserver после ввода пароля владельца. В ней 13 ZIP-архивов (83 512 454 268 байт) и 11 альтернативных TAR-упаковок. Все 13 ZIP загружены напрямую, без VPN и прокси, в `/mnt/edberries-backup-disk/inspector-ai-dataset-20260924/archives/`; альтернативные TAR не скачивались. Служба `hackaton-yandex-dataset-parallel-20260924.service` завершилась с `ALL_DONE 13`, без перезапусков и ошибок. Каждый ZIP проверен по ожидаемому размеру, ZIP CRC и локальному SHA-256. Итоговая сверка нашла 13 ZIP, 13 уникальных записей в `sha256-completed.txt`, 0 `.part` и суммарно 83 512 454 268 байт. Структурная проверка 11 949 ZIP-записей не нашла дублированных или небезопасных путей. `TEST_HIDDEN` и закрытые ответы нельзя использовать для настройки модели или публичной оценки.

Архив `01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip` уже завершён: 8 718 593 068 байт, SHA-256 `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`. Встроенный manifest совпал с репозиторием по SHA-256 `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`. После декодирования CP866 проверены имена, размеры и SHA-256 всех 416 исходных файлов (8 697 888 218 байт распакованного содержимого): 0 пропусков, 0 лишних файлов, 0 расхождений. В manifest 203 `TRAIN_PUBLIC` и 213 `TEST_HIDDEN`; для тестов используется только `TRAIN_PUBLIC`.

Итоговый `ALL_DONE 13` виден через `journalctl --user -u hackaton-yandex-dataset-parallel-20260924.service --no-pager -n 30 --output=cat`. Локальные хеши записаны в `sha256-completed.txt` рядом с каталогом архивов. В проверенных ZIP кириллические имена записаны в CP866; при распаковке через Python их нужно преобразовать из `cp437` в `cp866` и проверить пути перед записью. Сырые имена `zipfile` отображаются с ошибочной кириллицей.

Из доступного архива `downloads/14_Алтуфьевское_79Б.zip` извлечены два исходных документа одного объекта: ПД 15 страниц, 1 769 185 байт, SHA-256 `6853c32ae6fe0b4a021c6498f1e09034dc81ab4c3b6cc5b97383167497d068a3`; РД 15 страниц, 3 485 757 байт, SHA-256 `8a9d4e6b24632e0c981cb0d5331196e7ef98238fd57a65151710bddd08b9a311`. Тестовые копии лежат в `dataset-smoke/` на homeserver. Команда для нового прогона:

```bash
python3 scripts/smoke-core.py \
  --credentials-file infra/.smoke-user \
  --pdf dataset-smoke/test_pd.pdf \
  --rd-pdf dataset-smoke/test_rd.pdf
```

Проверка `CHK-56076660` завершилась за ~132 секунды: `PARTIAL`, 132 строки coverage, все `UNSUPPORTED`. Первый CLI-прогон перестал ждать через 120 секунд, но отдельный запрос к API подтвердил завершённое состояние и coverage. В CLI ожидание увеличено до 300 секунд. Это доказывает прохождение двух реальных PDF через загрузку и обработку, но не качество OCR/сопоставления/выявления нарушений.

После загрузки `РАЗМЕЧЕННЫЙ_TRAIN_PUBLIC_203.zip` независимо проверены SHA-256 и размеры 211 файлов по встроенному `SHA256SUMS.jsonl` (3 932 845 243 распакованных байта); сам список хешей в эти 211 записей не входит. Из архива отдельно извлечён публичный аннотированный `F0001` (9 387 648 байт) в `dataset-smoke/train_public_F0001_annotated.pdf`. Прогон через текущий CPU-стенд создал `OBJ-67302DDE`, `CHK-F7A7FFDC` и завершился `PARTIAL` с 132 `UNSUPPORTED`. Это проверка ingest и очередей на новом публичном материале; аннотированный PDF не является исходным PDF, а качество ML здесь не измерялось.

Из `01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip` отдельно извлечён исходный `F0001` из `TRAIN_PUBLIC` в `dataset-smoke/train_public_F0001_raw.pdf` (6 237 196 байт, SHA-256 `ab8be6dc7a185f6d58231a1763537ac9fb6974aa9e3c6726a54862ce4741a577`). `scripts/smoke-core.py` теперь принимает `--pdf-stage ID`, чтобы не подменять фактическую стадию документа. Прогон `--pdf-stage ID --pdf dataset-smoke/train_public_F0001_raw.pdf` создал `OBJ-F04D3A40`, `CHK-686F5DF4` и завершился `PARTIAL` с 132 `UNSUPPORTED`. Это подтверждает ingest исходного публичного PDF на правильной стадии, но не качество проверки.

## GPU на homeserver

На Ubuntu 24.04 с ядром `7.0.0-34-generic` установлены `nvidia-driver-580-open` и готовый модуль NVIDIA версии `580.178.04`. После `modprobe nvidia` команда `nvidia-smi` видит GeForce RTX 2080 SUPER с 8192 MiB памяти. Перезагрузка не потребовалась.

В `driver-packages/` остались 17 пакетов официального Ubuntu APT, использованных для установки драйвера. В `driver-packages/toolkit/` скачаны четыре пакета NVIDIA Container Toolkit `1.20.1-1`; размер и SHA-256 каждого сверены с индексом [официального репозитория NVIDIA](https://nvidia.github.io/libnvidia-container/). Toolkit установлен, `nvidia-ctk runtime configure --runtime=docker` зарегистрировал runtime `nvidia`; reload Docker сохранил работающие сервисы. Контейнер `nvidia/cuda:12.6.3-base-ubuntu24.04` успешно выполнил `nvidia-smi` через `--device nvidia.com/gpu=0` и через `--runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all`. Отдельный минимальный Compose-сервис с `runtime: nvidia` тоже увидел GPU. На Docker 29.3.1 путь `--gpus all` отвечает `AMD CDI spec not found`, поэтому локальный laptop Compose использует runtime `nvidia` и явно выбирает карту через `NVIDIA_VISIBLE_DEVICES`. Собранный контейнер `gpu-admission` с локальным бюджетом 3072 MiB вернул `admitted`, обнаружив 8192 MiB общей и 1 MiB занятой VRAM. Это проверка доступа к GPU и admission, не запуска Bonsai. По [спецификации NVIDIA](https://www.nvidia.com/en-us/geforce/graphics-cards/compare/) RTX 2080 SUPER имеет 8 GB VRAM и годится только для облегчённого профиля; результаты не заменяют прогон на H100.

Закреплённые четыре артефакта Bonsai 2 27B для облегчённого профиля загружены в `model-cache/bonsai/` на homeserver. Провизионер сверил каждый размер и SHA-256 с `services/bonsai/artifacts.lock.json` и создал `.bonsai-model-ready.json` с lock SHA-256 `e5f4e64b90cb2b9170021c0339db55fbf00bdfc5466bf6e3b1bf65f43e564e8f`. Кеш находится на хосте отдельно от Docker volume; каталог имеет ACL на чтение для UID `10001` контейнера. Для штатного Compose его можно импортировать в `bonsai-model-init` по [инструкции для laptop-профиля](BONSAI_LAPTOP_DEPLOYMENT.md).

Образ `inspector-ai/bonsai-runtime:homeserver-smoke` собран из закреплённого PrismML runtime. Одноразовый контейнер с `--runtime=nvidia`, `--network none`, read-only bind mount кеша и штатными настройками `context=8192`, `ngl=99`, `mmproj_cpu=1` прошёл SHA-256 старта, стал `healthy` и прошёл `bonsai-smoke` с реальным текстовым ответом. Для публичной аннотированной страницы `F0001` из TRAIN_PUBLIC рендер 1024 px был подан как data URL; VLM вернула «Акт». Это подтверждает работу vision endpoint, но один ответ не доказывает точность на датасете. Измерено около 6,24 GB занятой VRAM после загрузки и до 2,3 GiB RAM контейнера при vision-запросе. После проверки контейнер остановлен и удалён; GPU освободилась. Полный laptop stack не поднимался: на хосте 15 GiB RAM уже заняты другими сервисами, swap почти заполнен. Около 49 GiB места осталось на корневом диске после сборки; архивы лежат на отдельном диске.

## Прогон исходных TRAIN_PUBLIC PDF с локальной моделью

Из проверенного пакета участника извлечены исходные `F0171` (ПД, 177 страниц), `F0201` (смешанный РД/ИД, 676 страниц) и `F0202` (смешанный РД/ИД, 36 страниц). Перед использованием их размер и SHA-256 сверены с публичным `document_manifest.jsonl`; `TEST_HIDDEN` и закрытые ответы не читаются. Файлы находятся только в `dataset-smoke/` на homeserver. Публичная разметка используется для выбора контрольных страниц и сверки **после** ответа модели; ожидаемые значения и verdict не попадают в prompt.

Полный текущий application DAG проверен на паре `F0171` + `F0202`: `CHK-436FDA2D` завершён как `PARTIAL`; 10 jobs имеют `SUCCEEDED`, созданы два immutable text-layer artifact на 177 и 36 страниц, 132 coverage rows имеют `UNSUPPORTED`, `rule_results` нет. Из 36 страниц `F0202` 13 потребовали OCR по текущему текстовому фильтру; OCR provider пока не подключён. При первой попытке document-worker с лимитом 384 MiB был убит OOM; лимит тестового overlay поднят до 2 GiB. На реальной нагрузке обнаружены и исправлены два дефекта outbox recovery: несовместимые SQL-типы параметра ID и публикация в имя очереди вместо exchange `inspector.jobs`. Истёкший lease восстановлен; после повторной доставки весь DAG завершился. PostgreSQL integration suite теперь отдельно проверяет восстановление, `EXPIRED` попытку, правильные exchange/routing и fencing; 4/4 теста прошли в отдельной временной БД homeserver. Новый relay собран и запущен, health `healthy`, `PENDING=0`, `DEAD=0`. `scripts/smoke-core.py` теперь допускает 180 секунд для HTTP-запроса загрузки большого PDF. Эти исправления проверены на выделенном test Compose, не на H100.

Второй application-прогон загрузил `F0171` + `F0201` (12,4 + 43,0 МБ), создал `CHK-39B997C8` и завершился за 404 секунды без повторного OOM. Все 10 jobs `SUCCEEDED`; text artifacts: 177 страниц / 1 366 416 байт и 676 страниц / 3 460 215 байт. Для `F0201` текущий фильтр пометил 93 страницы как `OCR_REQUIRED`; всего 664 страницы имеют ненулевой text layer. Итог снова `PARTIAL`, 132 `UNSUPPORTED`, 0 rule results. Загрузка смешанного РД/ИД была назначена стадии `RD` только для ingest smoke: реальное разбиение смешанных документов на логические стадии не выполнялось.

Для локальной ML-проверки добавлен [`scripts/eval-local-public.py`](../../scripts/eval-local-public.py). Он отказывает кейсу вне `TRAIN_PUBLIC`, сверяет исходные PDF с manifest, извлекает текст контрольных страниц, по запросу рендерит их, вызывает только loopback OpenAI-compatible endpoint и сохраняет ответ с проверкой дословных цитат. Вывод модели помечен `NOT_ACCEPTED_PROBE_ONLY` и не записывается как finding в приложение. В текстовом режиме на трёх различных публичных кейсах `TRAIN-0001`, `TRAIN-0002`, `TRAIN-0006` Bonsai вернула `INSUFFICIENT_EVIDENCE` за 20,4 / 33,8 / 38,3 секунды; все три имеют публичную положительную метку. Это честный отказ при недостатке данных, но не успешное обнаружение нарушений. Одностраничный vision-запрос на `F0171` PDF page 104 с лимитом 512 токенов занял 96 секунд, был обрезан и выдал несколько неверных терминов; принимать такие цитаты без текстового/геометрического подтверждения нельзя. Парный vision+text запрос по `TRAIN-0001` также дал `INSUFFICIENT_EVIDENCE` за 107,4 секунды; одна из двух цитат не подтвердилась текстовым слоем. Краткий [отчёт с ответами и проверкой цитат](LOCAL_PUBLIC_MODEL_PROBES_20260924.json) сохранён без полного текста страниц. После probes временный Bonsai-контейнер остановлен, GPU освободилась.

## Durable PZ-002 на проверенных исходных документах, 26 сентября

В изолированном smoke-проекте применены миграции `013` и `014`, включён `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002`; API, worker и web пересобраны. Для OCR worker получает локальный `DOCUMENT_PROVIDER_BASE_URL=http://document-ai:8080`. Контейнер существующего model-probe профиля подключён к внутренней сети smoke-проекта с alias `document-ai`; `/health` из worker вернул 200. При пересоздании контейнера model-probe нужно снова присоединить его к сети перед реальным OCR командой `docker network connect --alias document-ai inspector-ai-homeserver-smoke_default inspector-ai-local-model-probe-document-ai-1` (только если он ещё не подключён). Все секреты остаются в `infra/.env.homeserver-smoke` с правами `0600`.

Из пакета участника сверены с `document_manifest.jsonl` и извлечены исходные `TRAIN_PUBLIC` `F0150` (ПД, 62 364 734 байта, 614 страниц) и `F0201` (смешанный РД/ИД, 43 033 348 байт, 676 страниц). Прежний лимит 50 MiB отвергал первый файл с HTTP 413; контракт и сообщение API увеличены до 100 MiB, ClamAV stream/file limits до 128M, web proxy принимает тело 210m и передаёт его потоком. Полный пользовательский путь через web proxy `127.0.0.1:18081` создал `OBJ-4993F5F1`, `CHK-64A1D37B`; все 10 jobs завершились `SUCCEEDED`, результат `PARTIAL`, coverage: 131 `UNSUPPORTED` и одна `PARTIAL`, findings: 0. Это реальный сквозной прогон загрузки, хранения, обработки и исполнения PZ-002, но не положительное выявление нарушения.

В первом run сохранён результат `MISSING_EVIDENCE/REQUIRED_STAGE_FACT_MISSING`: правило получило 0 извлечённых фактов, 398 страниц потребовали OCR. На `F0150` p.26 таблица технико-экономических показателей имеет подпись, единицу и значение в разных PDF text blocks; `F0201` p.14 содержит форму «Общая площадь здания S=...». Для последней формы добавлено извлечение и независимая проверка блоков. В первом и втором run таблица из нескольких блоков ещё не связывалась геометрически; это изменено в следующем прогоне ниже.

Отдельный воспроизводимый [пакет просмотра](../../output/pz002-public-review-20260926/review.json) построен только из проверенных исходных PDF и `TRAIN_PUBLIC` manifest: `F0150` p.26 показывает 11 618,27 м², `F0201` p.14 показывает 11 030,3 м²; разность 587,97 м², или приблизительно 5,06% от ПД. Это **`MEASUREMENT_PREVIEW_ONLY`**, не finding: у F0201 смешанная стадия, актуальность/согласование редакций и связь источников не подтверждены, а таблица ПД не прошла независимый серверный verifier. В 10 публичных контрольных строках нет PZ-002, поэтому предметную точность по этому примеру оценивать нельзя. Скрипт [`build-pz002-public-review.py`](../../scripts/build-pz002-public-review.py) проверяет split/видимость/размер/SHA, уникальность фразы и хеши рендеров; не читает закрытые ответы.

Повторный run `CHK-673B2639` запущен через `/api/checks/CHK-64A1D37B/reprocess` после подключения локального OCR. Это отдельный immutable run. Все 10 jobs снова `SUCCEEDED`; итог `PARTIAL`, coverage 131 `UNSUPPORTED` + одна `PARTIAL`, findings 0. В сохранённом `RULE_EVALUATION`: `MISSING_EVIDENCE/REQUIRED_STAGE_FACT_MISSING`, один факт `11030,3 кв.м` из F0201 p.14, 398 страниц `OCR_REQUIRED`, из них 2 обработаны локальным Paddle OCR (F0150 p.1–2), 396 отложены бюджетом. Это подтверждает живой вызов локального OCR внутри durable worker; первые две страницы не содержали нужную таблицу. Сводка обоих run, полученная read-only SQL-запросом к isolated PostgreSQL, сохранена в [durable-runs.json](../../output/pz002-public-review-20260926/durable-runs.json). Команда повторной проверки результата:

```bash
python3 scripts/smoke-reprocess.py \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --check-id CHK-64A1D37B \
  --poll-check-id CHK-673B2639 \
  --wait-seconds 1200
```

Отдельно, только для review, `scripts/smoke-document-public.py` обработал целевые страницы через тот же локальный OCR provider: F0150 p.26 (120 dpi, 7,76 с OCR) распознал «Общая площадь здания, в т.ч.:» и `11618,27` на одной строке таблицы с координатами, F0201 p.14 (120 dpi, 46,25 с OCR) распознал «Общая площадь здания S=11030,3 кв.м;» с confidence 0,987. Полные ответы и профили лежат в [F0150 OCR](../../output/pz002-public-review-20260926/F0150-p26-ocr.json) и [F0201 OCR](../../output/pz002-public-review-20260926/F0201-p14-ocr.json); [машинная сверка строк и геометрии](../../output/pz002-public-review-20260926/ocr-crosscheck.json) создана [`verify-pz002-review-ocr.py`](../../scripts/verify-pz002-review-ocr.py) и имеет статус `OCR_CROSSCHECK_ONLY`. Это независимый способ прочитать пиксели, но он не заменяет проверку актуальности документов и серверную верификацию ячейки таблицы; эти целевые страницы не выбирались автоматически при лимите 2 OCR-страницы.

Повторить сверку сохранённых OCR-отчётов из корня репозитория:

```bash
python3 scripts/verify-pz002-review-ocr.py \
  --review output/pz002-public-review-20260926/review.json \
  --ocr F0150=output/pz002-public-review-20260926/F0150-p26-ocr.json \
  --ocr F0201=output/pz002-public-review-20260926/F0201-p14-ocr.json \
  --output output/pz002-public-review-20260926/ocr-crosscheck.json
```

После изменений локальные `npm run check`, 58 worker tests, четыре теста генератора/crosscheck пакета, `git diff --check` прошли. На homeserver 12/12 контейнеров smoke-проекта работают, имеющиеся healthchecks `healthy`, web/API и локальный OCR `/health` отвечают; свободно 27 GiB на корневом диске. Это состояние homeserver на 26 сентября, не измерение под нагрузкой H100.

### Строка таблицы в полном durable-прогоне

В `PILOT_PZ002` добавлен точечный повторный разбор страниц, куда привёл текстовый маршрут. Для `F0150` p.26 `pdfminer` нашёл подпись, единицу и число на одной горизонтальной строке; каждый из трёх локаторов сверяется с уже сохранённым `document-text-v2`, координаты остаются в системе исходного PDF. Весь набор построчных координат для 1290 страниц не хранится. Бюджет `PZ002_MAX_TABLE_PAGES` по умолчанию 8; непроверенные страницы явно учитываются. Серверный verifier для возможного `CANDIDATE` отдельно проверяет текст трёх ячеек, их геометрию, единицы, число и fingerprint; синтетические тесты покрывают принятие и подмену.

Повторный полный run `CHK-1E3D8D30` на той же неизменной паре `TRAIN_PUBLIC` завершил 10/10 jobs как `SUCCEEDED`, итог `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. В сохранённом `RULE_EVALUATION` теперь **два факта**: F0150 p.26 `11618,27 м ²` с тремя локаторами ячеек и F0201 p.14 `11030,3 кв.м`. Один табличный лист пересмотрен, отложенных табличных листов 0. OCR по прежнему порядку обработал 2 из 398 требующих его страниц; 396 отложены. Машинный статус `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`: публичный пакет не подтверждает актуальность и согласование редакций, а F0201 смешивает РД/ИД. Строка таблицы сохранилась как факт для ревью, но реальный серверный путь создания finding для неё не исполнялся. [Сводка с hash и локаторами](../../output/pz002-public-review-20260926/durable-table-run.json).

После этого внедрён порядок OCR `subject-stage-neighbor-v1`: бюджет сперва расходуется на страницы `OCR_REQUIRED`, ближайшие к предметным попаданиям маршрута, чередуя релевантные стадии. На сохранённом маршруте он выбрал F0150 p.29 и F0201 p.9 вместо первых двух страниц F0150. Обе страницы обработаны локальным Paddle OCR на homeserver; получено 54 и 67 строк, новых фактов общей площади на них нет. [Сводка целевого OCR](../../output/pz002-public-review-20260926/targeted-ocr-probe.json). Новый порядок затем прошёл полный immutable run `CHK-71B5BB7B`: 10/10 jobs `SUCCEEDED`, те же два исходных факта, локальный OCR именно F0150 p.29 и F0201 p.9, 396 страниц отложены, итог `PARTIAL`, 0 findings. `TEST_HIDDEN` и закрытые ответы не использовались.

Для табличного факта добавлен отдельный OCR того же листа. Возможный кандидат требует ровно одну OCR-пару «общая площадь здания»/`11618,27` на одной строке с минимальной уверенностью 0,8; API повторяет проверку OCR-текста, геометрии и content hash. Source-only проверка F0150 p.26 через новый worker вернула совпадение строк 30/32, minimum score `0,960711` и тот же render SHA, что в предыдущем визуальном отчёте. Отсутствие или противоречие этого OCR оставляет `TABLE_VISUAL_UNVERIFIED`, а не создаёт finding.

Полный immutable run `CHK-A9C2743D` подтвердил подключение OCR к штатному DAG: 10/10 jobs `SUCCEEDED`, сохранены оба факта, один OCR-артефакт таблицы F0150 p.26 и один crosscheck с hash `0f2d4ff0…c5cd59a33`, индексами строк 30/32 и minimum score `0,960711`. Обычный OCR обработал F0150 p.29 и F0201 p.9; 396 из 398 `OCR_REQUIRED` страниц отложены. Итог `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings; правило осталось `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`, поскольку ревизии, согласование и связь исходных ПД/РД/ИД не подтверждены. [Краткий отчёт с hash и счётчиками](../../output/pz002-public-review-20260926/durable-visual-run.json). Это подтверждение согласования двух локальных способов прочитать страницу; API не рендерит PDF повторно независимо от OCR provider.

На этих длинных PDF обнаружилась отдельная проблема транспорта: RabbitMQ дважды закрывал соединение `document-worker` после 60 секунд без AMQP heartbeat. Стадия на сервере успевала завершиться, но подтверждение сообщения вызывало `StreamLostError` и перезапуск контейнера. Исправленный consumer исполняет работу в потоке, оставляя Pika event loop свободным; `ack`/`nack` возвращается на поток соединения. Повторный полный run `CHK-B93E6F4C` после пересборки четырёх worker-контейнеров завершился 10/10 jobs с `attempt_count=1`, двумя теми же фактами, одним табличным OCR/crosscheck и **точно тем же hash rule artifact** `190a2639…50c90`. Итог `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. У `document-worker` и rules worker после run `RestartCount=0`, в логах RabbitMQ за этот прогон нет `missed heartbeats`. Это проверка устойчивости на длинной задаче homeserver, не нагрузочный тест H100.

## Проверка исходных файлов в приложении, 26 сентября 2026

Добавлен экран «Исходные документы» из результатов NORMAL-run: список файлов объекта, загрузка исходных байтов, просмотр и сохранение решения инспектора, разметка каждой страницы смешанного РД/ИД и явный запуск новой проверки. Для файла только с РД или ИД пользователь с правом `UPLOAD` может добавить вторую стадию в этом же экране: клиент сначала сверяет размер и SHA-256 локально выбранного PDF с сохранённым оригиналом, серверный upload сохраняет identity исходного файла по hash. Основание решения обязательно. Статусы редакции и согласования интерфейс не выводит автоматически; изменение решения не меняет старые immutable run. API `GET /api/objects/:id/files` возвращает права `upload/review/run` в объектном scope; `GET /api/objects/:id/files/:sourceFileId/content` ограничен READ-доступом к объекту. Обёртка demo/PostgreSQL пересылает оба метода в реальный repository.

В изолированном проекте пересобраны API и web. Через web proxy `18081` список `OBJ-4993F5F1` вернул два файла с 614 и 676 страницами. Оригинал F0201 (`FIL-35450220`, 43 033 348 байт) скачан целиком; SHA-256 скачанных байтов совпал с заголовком API, записью хранилища и открытым `document_manifest.jsonl`. Повторяемая read-only команда:

```bash
python3 scripts/smoke-source-files.py \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --object-id OBJ-4993F5F1 \
  --file-id FIL-35450220
```

Отдельная smoke-учётная запись с capability `SOURCE_REVIEW` и доступом только к рабочему объекту создана для проверки пути решений. Её случайный пароль хранится только на homeserver в `infra/.smoke-source-reviewer` (`0600`). API отклонил решение с заведомо неверным SHA-256 (`409 SOURCE_HASH_MISMATCH`); повторное чтение вернуло `404`, то есть решение не записалось. Положительное решение об актуальности или согласовании **не создавалось**: публичный пакет не даёт такого основания.

Открытый manifest помечает F0201 как `RD_ID_MIXED`; первоначальная техническая загрузка назначила ему только РД. Скрипт [`associate-mixed-public-source.py`](../../scripts/associate-mixed-public-source.py) перед изменением сверил `TRAIN_PUBLIC`, `INCLUDE`, размер и SHA-256 с публичным manifest, затем повторно загрузил те же байты для ИД. API объединил их по hash: тот же `FIL-35450220`, по-прежнему два исходных файла объекта, теперь стадии `RD` и `ID`. Второй запуск скрипта вернул `changed=false`. Это **только регистрация доступных стадий**, а не утверждение, что каждая из 676 страниц классифицирована: постраничную разбивку и состояние редакций ещё должен проверить человек. Команда на homeserver:

```bash
python3 scripts/associate-mixed-public-source.py \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --source-id F0201 --pdf dataset-smoke/F0201_raw.pdf \
  --object-id OBJ-4993F5F1 --add-stage ID
```

После регистрации второй стадии выполнен новый immutable run `CHK-9E8EF1CD`. Его manifest hash изменился с `25ef24d3…53dc71ae8` на `49f323ae…e168896858c`; F0201 присутствует в manifest со стадиями `RD` и `ID`. Все 10 jobs завершились `SUCCEEDED` с первой попытки. Результат `PARTIAL`, coverage: 131 `UNSUPPORTED` + PZ-002 `PARTIAL`, findings 0. Правило сохранило `MISSING_EVIDENCE/REQUIRED_STAGE_FACT_MISSING`: для РД `pageCountInScope=0`, `sourceReview.reasonCodes` содержит `STAGE_SEGMENTATION_REQUIRED`, `REVISION_UNRESOLVED`, `APPROVAL_UNRESOLVED`. Один извлечённый факт относится к ПД; из 305 OCR_REQUIRED страниц обработаны 2, 303 отложены. Это демонстрирует, что запись двух стадий сама по себе не превращает смешанный PDF в проверенную РД. Лог запуска: `dataset-smoke/probes/source-stage-rerun-20260926.log` на homeserver.

Headless Chrome открыл экран через реальный web proxy под отдельным reviewer: показаны два файла, кнопка скачивания, поле разбивки 676 страниц; сохранение без основания отключено. [Скриншот](../../output/pz002-public-review-20260926/source-review-ui-20260926.png) снят после последней пересборки API/web. Повторить на homeserver:

```bash
node scripts/smoke-source-review-ui.mjs \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-source-reviewer \
  --object-id OBJ-4993F5F1 \
  --screenshot dataset-smoke/probes/source-review-ui-20260926.png
```

Этот браузерный smoke требует установленные `google-chrome` и Node-модуль `ws` на homeserver; в основном режиме он ничего не сохраняет через UI. После последней пересборки API и web получили `healthy`; исходный PDF повторно скачан и сверен по SHA-256. PostgreSQL integration подтвердил отрицательные и положительные комбинации объектных прав.

Для проверки новой кнопки через UI создан отдельный smoke-объект `OBJ-FA65BC97`: `scripts/smoke-core.py` перед загрузкой сверил F0201 с `TRAIN_PUBLIC` manifest, зарегистрировал только РД и завершил полный `CHK-7C1FC2DC` как `PARTIAL` с 131 `UNSUPPORTED` + PZ-002 `PARTIAL`, без findings. Браузер под учётной записью с `UPLOAD`, но без `SOURCE_REVIEW`, выбрал точно тот же F0201 и добавил ИД. Страница показала РД/ИД и поле постраничной стадии, но не кнопку сохранения решения. API до и после операции вернул один источник с тем же ID `FIL-B50EA8B8`; повторная загрузка всех 43 033 348 байт прошла SHA-256 проверку. Решения о редакции/согласовании нет (`404`). [Скриншот после операции](../../output/pz002-public-review-20260926/source-stage-upload-ui-20260926.png). Повторить на новом объекте с одной стадией:

```bash
node scripts/smoke-source-review-ui.mjs \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --object-id OBJ-ID-НОВОГО-ОБЪЕКТА \
  --attach-stage-file /absolute/path/to/F0201_raw.pdf \
  --screenshot dataset-smoke/probes/source-stage-upload-ui.png
```

Этот режим меняет объект: запускайте только с новым RD-only smoke-объектом, созданным из подтверждённого `TRAIN_PUBLIC` F0201. Реальные решения по страницам и согласованию в этом отдельном объекте не вносились.

### Частичная проверка F0201 и новый immutable run

Оригинал F0201 самостоятельно сверен с `document_manifest.jsonl` по split, размеру и SHA-256, а листы с явными признаками РД дополнительно проверены по текстовому слою; p.14 просмотрена как изображение. В основном smoke-объекте reviewer записал карту: 9 страниц РД, 667 `UNRESOLVED`, редакция и согласование `UNKNOWN`, связь с ПД отсутствует. Это решение ограничено доступными доказательствами; остальные страницы не названы ИД по умолчанию. Метод, команда и артефакты — в [отдельном аудите F0201](F0201_SOURCE_AUDIT_20260926.md).

Новый run `CHK-9443227E` после решения завершил все 10 jobs с первой попытки; при просмотре артефакта устранён дубль диагностических причин. Финальный повторный run `CHK-4672F74B` также завершил 10/10 jobs с первой попытки: `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, findings 0. Снимок решения в БД имеет hash `180102322f605017f9306e8f315e68b75d48ba6ac35c063313e2b40fbad4fce9`. Маршрут теперь просматривает 9 подтверждённых страниц РД и находит F0201 p.14, но сохраняет `STAGE_PAGES_UNRESOLVED`; машинный результат `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`. Это проверяет сквозное использование решения, не подтверждает нарушение или качество по 132 параметрам. [Сводка финальных сохранённых артефактов](../../output/f0201-source-audit-20260926/durable-run-final.json).

## Продолжение 25 сентября: локальный OCR + Bonsai

Поднят отдельный [облегчённый Compose-профиль](../../infra/docker-compose.local-model-probe.yml) с обязательной офлайн-проверкой Paddle/Qwen cache, CPU OCR, CPU Qwen3 Embedding и Bonsai на GPU. Три runtime-сервиса имеют `healthy`; порты homeserver — `127.0.0.1:18084`, `127.0.0.1:18085` и `127.0.0.1:18082`. Профиль [`homeserver.json`](../../services/document-ai/profiles/homeserver.json) отключает тяжёлую табличную реконструкцию и автоматический поворот, который ошибочно разворачивал реальные чертежи на 180°. Исправлена сериализация PaddleX и исключены служебные растровые массивы из OCR JSON. Сквозной **квалификационный** прогон известных страниц `TRAIN-0001`/`TRAIN-0002` идёт от проверенных исходных PDF через рендер, OCR и Bonsai до валидации цитат/координат; на трёх контрольных парах Bonsai воздержалась от положительного вывода. Дополнительно Qwen3 Embedding за 1000,55 с ранжировала 73 страницы-кандидата из 889: правильные страницы присутствуют, но top-1 пара ошибочна во всех трёх кейсах. На выбранных ею страницах выполнены live OCR и Bonsai: совпадений с контрольными листами 0/6, два отказа `INSUFFICIENT_EVIDENCE` и один обрезанный JSON. На 25 сентября основной DAG был `SCAFFOLD` и endpoints моделей не вызывал; подключение локального OCR к durable PZ-002 выполнено 26 сентября, как описано выше. Команды, измерения и точная граница проверки — в [отчёте 25 сентября](LOCAL_MODEL_PROBE_20260925.md).

## Durable визуальные предложения на F0202, 26 сентября

В изолированном Compose-проекте применена миграция `015`, пересобраны API, web и worker. `ENTITY_EXTRACTION` в пилотном release сохраняет отдельный проверяемый `VISUAL_PROPOSAL_SCAN`; предложения не являются классификацией прибора, finding или доказательством отсутствия. Источник F0202 (`TRAIN_PUBLIC`, 36 страниц) сверен с `document_manifest.jsonl` до загрузки. Run `CHK-7B010C54` для `OBJ-E655CAA3` завершил 10 jobs со статусом `SUCCEEDED`, общий результат `PARTIAL`, coverage 131 `UNSUPPORTED` и PZ-002 `PARTIAL`, findings 0. Артефакт `07849680-2483-4743-8780-904414888d7f`, SHA-256 `69bff48ef0eebe2b0cbcd94903a88e2d604c0657b55331ffd0c77505847fb9d2`, содержит 160 геометрических предложений с координатами на 36 листах; источник имеет статус `SCANNED`.

API `GET /api/checks/:id/visual-proposals` под сессией возвращает сохранённый артефакт. `GET /api/objects/:id/files/:sourceFileId/pages/:pageNumber/preview` сверяет исходные байты с SHA-256 и рендерит видимую страницу PDF через Poppler. Read-only API smoke проверил PNG листа 17 (345 463 байта), статус и число предложений. Headless Chrome открыл карточку объекта, выбрал кандидата на листе 17, загрузил PNG и проверил, что рамка находится внутри изображения. [Снимок браузера](../../output/f0202-visual-proposals-20260926/preview.png). Рамка может быть очень мала на полном листе; точность класса и полнота обнаружения не оценены.

Повторить чтение без создания новых run:

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
python3 scripts/smoke-visual-proposals.py \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --check-id CHK-7B010C54 \
  --public-manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-source-id F0202 --expected-proposals 160 --expected-pages 36 \
  --object-id OBJ-E655CAA3 --preview-page 17
node scripts/smoke-visual-proposals-ui.mjs \
  --base-url http://127.0.0.1:18081 \
  --credentials-file infra/.smoke-user \
  --object-id OBJ-E655CAA3 --expected-proposals 160 --preview-page 17 \
  --screenshot dataset-smoke/probes/f0202-visual-preview-20260926.png
```

Первый запуск `ENTITY_EXTRACTION` с прежним лимитом памяти document-worker 384 MiB привёл к истечению lease. В тестовом Compose overlay лимит поднят до 2 GiB, CPU до одного ядра; повторная попытка завершилась, контейнер не перезапускался. Это измерение homeserver с RTX 2080 SUPER, не проверка H100. Формальная полнота и качество детектора зависят от независимой разметки полных листов по [протоколу оценки](DRAWING_EVALUATION_GATE_20260926.md).

Исторический reprocess v1 исходных F0150 (614 страниц) и F0201 (676 страниц) создал `CHK-5C362232`: `PARTIAL`, coverage 131 `UNSUPPORTED` + PZ-002 `PARTIAL`, findings 0. API-верификация visual artifact `24c7a488-0b3e-4979-9a60-7e9eedd014d6`, hash `de974f80267e032be8cd3464c790c3594659fccb92770c72f9e05c6e75754e23`, подтвердила для каждого исходника `SKIPPED_PAGE_LIMIT`, `scannedPageCount=0`, `proposals=[]`. Оба файла были исключены целиком; это ограничение не создало вывода об отсутствии приборов. Лог: `dataset-smoke/probes/large-source-visual-skip-20260926.log` на homeserver.

Текущий профиль v2 пересканировал те же исходники в immutable run `CHK-BECA7EB7`. Результат: 10/10 jobs `SUCCEEDED`, 488 с, `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. API проверил artifact `4fb2134b-facc-450e-a92a-b932246383da`, SHA-256 `446a35d8791440c63a89f7896db31144ed2dd811f888df238c7a26c8fe9ceaf6` и соответствие обоих PDF открытому manifest. Для F0150 `scannedPageCount=64`, `skippedPageCount=550`; для F0201 — 64 и 612. Оба источника получили `PARTIALLY_SCANNED_PAGE_LIMIT` и по 0 предложений. Нулевой результат относится только к проверенной выборке и методу красно-синих векторных контуров; отсутствие элементов нигде не установлено. В браузере показаны охват и предупреждение, [снимок](../../output/large-source-visual-v2-20260927/ui.png). Лог: `dataset-smoke/probes/large-source-visual-v2-20260926.log` на homeserver.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
python3 scripts/smoke-visual-proposals.py \
  --base-url http://127.0.0.1:18081 --credentials-file infra/.smoke-user \
  --check-id CHK-BECA7EB7 \
  --public-manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-source-id F0150 --expected-pages 614 --expected-proposals 0 \
  --expected-status PARTIALLY_SCANNED_PAGE_LIMIT
```

Для F0201 заменить `--public-source-id F0150 --expected-pages 614` на `F0201` и `676`. Это проверка сохранённого результата, без нового run.

Отдельный read-only диагностический проход по **всем** страницам тех же сверенных PDF занял 16,14 с для F0150 и 46,08 с для F0201, с пиком RSS около 721 МиБ. Он нашёл 2 геометрических совпадения на F0150 p.566 и 20 на F0201 p.31, 34–39; выборка v2 не включала эти листы. На просмотренных примерах p.566 — инженерно-геологический разрез, p.36 — вентиляционная схема. Это подтверждает одновременно пропуск выборки и ограничение распознавания класса: красный контур с касанием синей линии сам по себе не доказывает отопительный прибор. Все 22 совпадения остаются непроверенными предложениями, а не положительными метками.

При выборочной пересборке Python worker-кода нужно отдельно пересобрать и перезапустить **каждый** Compose-сервис, использующий этот образ. В этом профиле `worker` и `extract-worker` имеют разные image tags. Первый v3 run `CHK-F5FD7782` завершился `FAILED`: API ожидал release `red-vector-proposals-v3`, а старый `extract-worker` отклонил его с `visual proposal provider slot does not match immutable release`. После сборки и перезапуска `extract-worker` в контейнере проверены ID профиля и SHA-256 конфигурации `4e9bee5f3ffe6683ced20e9838e76a664ff159857d58f107b54fa501bab4e67a`. Неудачный run сохранён в истории; новый запуск выполняется отдельно.

Повторный immutable v3 run `CHK-3D6C7BB3` завершил 10/10 jobs со статусом `SUCCEEDED` за 552 с, итог `PARTIAL`: 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, findings 0. Визуальный артефакт `89f0737b-7518-4c98-94a8-08fbc37b0438` (SHA-256 `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436`) имеет `visual-proposal-analysis-v3` и `SCANNED` для обоих исходников. F0150: 614/614 страниц, 2 предложения на p.566; F0201: 676/676 страниц, 20 предложений на p.31, 34–39. Ничего не пропущено из-за лимита страниц; лимит сохранённых предложений 500 на файл не достигнут. Совпадение с отдельным полным диагностическим проходом проверяет воспроизводимость локатора, **не точность класса**.

Authenticated API smoke сверил каждый source SHA с `TRAIN_PUBLIC/INCLUDE` manifest, числа страниц/областей, отсутствие findings и PNG-превью F0150 p.566 (76 767 байт) и F0201 p.36 (164 999 байт). Browser smoke через выбор файла по source ID открыл обе рамки и проверил их положение внутри страницы: [F0150 p.566](../../output/large-source-visual-v3-20260927/f0150-page-566.png), [F0201 p.36](../../output/large-source-visual-v3-20260927/f0201-page-36.png). Это геологический разрез и вентиляционная схема, поэтому все 22 области остаются неклассифицированными предложениями. На полном листе маленькие рамки трудно рассмотреть; нужен увеличенный фрагмент для предметного review.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
python3 scripts/smoke-visual-proposals.py \
  --base-url http://127.0.0.1:18081 --credentials-file infra/.smoke-user \
  --check-id CHK-3D6C7BB3 \
  --public-manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-source-id F0150 --expected-pages 614 --expected-proposals 2 \
  --expected-status SCANNED --object-id OBJ-4993F5F1 --preview-page 566
```

Для второго файла заменить `F0150`, `614`, `2`, `566` на `F0201`, `676`, `20`, `36`. Это читает сохранённый результат, не запускает новый анализ.

## Журнал решений по визуальным предложениям, 27 сентября

Миграция `016_visual_proposal_reviews.sql` применена в изолированном проекте; API и web пересобраны. `GET /api/checks/:id/visual-proposals/reviews` возвращает историю и возможность записи для активного завершённого run; `POST` требует сессию, CSRF, `Idempotency-Key`, право `REVIEW_DECIDE` на объект, точные ID/hash артефакта и исходника и номер предложения. Действия `KEEP_FOR_REVIEW`, `REJECT`, `UNSURE` хранятся отдельно от findings и coverage. Старый или подменённый артефакт отклоняется с `409`; запись нельзя изменить или удалить.

Все 6 PostgreSQL integration tests прошли, включая append-only запись, повтор с тем же ключом, конфликт ключа и отказ для старого run. Живой API на F0202 отклонил неверный hash с `409/STALE_VISUAL_PROPOSAL` без записи. Затем тестовая учётная запись сохранила одно нейтральное `UNSURE` для первого предложения F0202 p.15: review `2cc6ab10-7bf9-4149-995b-bf2944e046e0`; повтор с тем же ключом вернул ту же запись, в истории ровно одна запись, findings 0. Основание прямо помечает запись тестовой и не подтверждает класс элемента. Браузер открыл [форму по p.17](../../output/f0202-visual-proposals-20260926/review-form-20260927.png) и [историю по p.15](../../output/f0202-visual-proposals-20260926/review-history-20260927.png). Полнота разметки и независимое решение эксперта остаются отдельной проверкой.

По `analysis_runs` время F0202 run составило 323 с, F0150 + F0201 reprocess — 484 с. После финальной пересборки API/web повторно пройдены authenticated PNG и браузерный просмотр; анонимные запросы к обоим маршрутам получили HTTP 401. Локальный `npm run check` прошёл: TypeScript, тесты API/web и всех Python-сервисов, production build. Тест PZ-017 переведён на `unittest`, поэтому его 11 проверок входят в общий тестовый набор.

## PZ-017 и увеличенный просмотр, 27 сентября

Изолированный профиль переключён на `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002_PZ017`; API, `worker` и web пересобраны. Реальный PostgreSQL integration: 7/7, включая новый release-pinned PZ-017; локальный `npm run check`: API 69 pass/7 skipped без локальной PostgreSQL, web 11, worker 97, сборка успешна. `docker compose --profile server ... config --quiet` прошёл. H100 этим не проверен.

Повторная проверка исходного объекта `OBJ-4993F5F1` создана из `CHK-3D6C7BB3` командой ниже. Новый immutable run `CHK-A72D41AE` завершил 10/10 jobs успешно: `PARTIAL`, 130 `UNSUPPORTED`, PZ-002 и PZ-017 `PARTIAL`, findings 0. В БД сохранён release `release:pz002-pz017:a823dcaddd8a93e4c65e3dea` с content hash `ca0fe584d816c3e48bf7c928eed3b412e3204d36846a7817ed84eb8ecff37adb`. Для PZ-017 сохранены 4 факта ПД F0150 p.23 и 2 факта РД F0201 p.14 с исходными текстовыми блоками и геометрией. Итог `CLARIFICATION_REQUIRED/COMPONENT_BASIS_MISMATCH`, сравнение `ABSTAIN`, без общей суммы и finding. Таблица РД отсылает ГВС в ВК, а состав ПД и РД различен; редакция, согласование и связь комплектов по-прежнему неизвестны. 130 остальных правил не исполняются.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
python3 scripts/smoke-reprocess.py \
  --base-url http://127.0.0.1:14100 --credentials-file infra/.smoke-user \
  --check-id CHK-3D6C7BB3 --expected-profile PILOT_PZ002_PZ017 \
  --wait-seconds 1800
```

Визуальный v3-артефакт нового run получил ID `4adf9feb-f15a-4f6a-aa40-daf79eaf0458`; его content hash `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436` совпал с предыдущим v3-run. Authenticated API smoke проверил оба PDF по открытому manifest, 614/614 и 676/676 страниц, 2 и 20 неклассифицированных областей, отсутствие findings, полный PNG и увеличенный PNG. Повторить с приведённой выше командой `smoke-visual-proposals.py`, добавив `--preview-crop` и заменив `--check-id` на `CHK-A72D41AE`.

API теперь принимает проверенный `crop=x0,y0,x1,y1` на том же объектно защищённом маршруте просмотра страницы. Он перед рендером сверяет полный SHA PDF, ограничивает время, память/размер изображения и два параллельных рендера. Для длинных тонких рамок область расширяется до почти квадратного обзора. Browser smoke подтвердил загрузку целого листа, рамки и crop на [геологическом F0150 p.566](../../output/large-source-visual-v3-20260927/f0150-crop-square-ui.png) (`cropWidth=1198`) и [вентиляционном F0201 p.36](../../output/large-source-visual-v3-20260927/f0201-crop-square-ui.png) (`cropWidth=1196`). Рамки остаются неклассифицированными; эти два примера визуально показывают ложные сигналы для гипотезы «радиатор».

Для оценки качества сохранённого визуального артефакта добавлен `scripts/evaluate-visual-proposals.py` (12/12 тестов). На реальном F0202 p.17 проверены PDF/manifest/артефакт, но с пустой независимой разметкой он вернул `NOT_ESTIMABLE/FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING` и код выхода 2. [Отчёт](../../output/large-source-visual-v3-20260927/f0202-evaluation-not-estimable.json) имеет SHA-256 `e03b32da172a6001fd12c7136452fcb03b5e3cc6d54493ce3f93ade80bf8fbb6`. Запуск выполнен в `inspector-ai-homeserver-smoke-worker:latest`, так как host Python не содержит PyMuPDF. Положительной метрики обнаружения, распознавания класса и переноса на другой объект пока нет.

## Visual v4, пилотные факты и полный лист для разметки, 27 сентября

После обновления API, `worker`, `extract-worker` и web новый run `CHK-8C6FFA72` из `CHK-A72D41AE` завершил 10/10 jobs со статусом `SUCCEEDED`. Общий результат `PARTIAL`: 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, findings 0. Визуальный артефакт `484c7798-5456-414b-813f-22098cbc191e`, hash `c4993a6b4b2c9865d122f99b5bad67ee9bbe1e6243ca05a2fdae4d8a2df3b3c3`, имеет профиль v4. На F0150 просмотрены 614/614 страниц, сохранены 2 геометрические области p.566 и контекст титула `UNKNOWN`. На F0201 — 676/676, 20 областей p.31, 34–39 и контекст `VENTILATION`. Подсказка о разделе берётся только из первых двух титульных страниц и не меняет число областей, класс, coverage или findings.

`smoke-visual-proposals.py` повторно сверил оба PDF с открытым manifest, обе области/страницы, полный и увеличенный PNG (`cropWidth` в браузере 1198/1196 px) и отсутствие findings. Старый v3 run `CHK-A72D41AE` остался читаемым под новым API: F0150 614/614, 2 предложения, без `documentContext`. Browser smoke открыл [F0150 p.566](../../output/large-source-visual-v4-20260927/f0150-v4-ui-20260927.png) и [F0201 p.36](../../output/large-source-visual-v4-20260927/f0201-v4-ui-20260927.png), проверил подсказки `раздел не установлен`/`вентиляция`, полный лист и crop. Профиль v4 не утверждает, что вентиляционное совпадение является радиатором.

Новый `GET /api/checks/:id/pilot-results` для активного run вернул PZ-002 и PZ-017, шесть сохранённых фактов PZ-017, `CLARIFICATION_REQUIRED/COMPONENT_BASIS_MISMATCH` и `ABSTAIN`. Анонимный запрос получил 401, старый run — 404. Первая проверка нашла ошибку маршрутизации: `RoutedInspectionRepository` возвращал пустой список без вызова PostgreSQL; добавлены пересылка и тест, затем live API повторно вернул обе записи. Экран покрытия загрузил 132 строки, открыл два частичных результата, шесть фактов и список 130 неподдерживаемых; [браузерный снимок](../../output/large-source-visual-v4-20260927/pilot-coverage-ru-20260927.png). `npm run check`, 7/7 PostgreSQL integration и 18 тестов оценщика/просмотрщика прошли после изменений.

Дополнительная проверка обнаружила гонку между чтением активного run и его результатов при одновременном reprocess. `getPilotResults` теперь выбирает активный run и его пилотные результаты одним SQL-запросом с общим снимком: старый check остаётся `404`, а действующий не превращается в ложный `READY` с пустым списком из-за переключения run между запросами. После изменения прошли API typecheck/build, 6 целевых unit tests и 7/7 PostgreSQL integration; API пересобран, browser smoke снова показал PZ-002/PZ-017 и F0150 p.566. Для интеграционных тестов на homeserver использован контейнер `node:22-slim`: системный Node 18 не запускает текущий Vitest 5.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
python3 scripts/smoke-reprocess.py \
  --base-url http://127.0.0.1:14100 --credentials-file infra/.smoke-user \
  --check-id CHK-A72D41AE --expected-profile PILOT_PZ002_PZ017 \
  --wait-seconds 1800
python3 scripts/smoke-visual-proposals.py \
  --base-url http://127.0.0.1:14100 --credentials-file infra/.smoke-user \
  --check-id CHK-8C6FFA72 \
  --public-manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-source-id F0150 --expected-pages 614 --expected-proposals 2 \
  --expected-context UNKNOWN --object-id OBJ-4993F5F1 --preview-page 566 --preview-crop
```

Отдельный [генератор независимой разметки](INDEPENDENT_VISUAL_SHEET_ANNOTATION.md) проверил SHA исходного F0202 и создал целый лист p.16 без подсказок модели (PNG 5796×8192, SHA-256 `3d6f717a070c9f514f2247e111aafd710cf3cbc8602c034873e82106f869e7b4`). [HTML открыт в браузере](../../output/independent-visual-annotation-20260927/browser.png), draft остаётся `UNREVIEWED`. Оценщик v4 на оригинальном F0150 p.566 пересчитал контекст и вернул `NOT_ESTIMABLE/FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING`, код 2; [отчёт](../../output/large-source-visual-v4-20260927/f0150-v4-evaluation-not-estimable.json), SHA-256 `bc397fd455898fd7865f3f73fd3ede6e46e3cdbe225430c988b750c07640b6a1`. Независимая полная разметка и численная метрика пока отсутствуют.

## Ограниченный OCR в durable run, 27 сентября

Миграция `017_bounded_ocr_layout_stage.sql` применена на изолированном homeserver. Профиль `local-bounded-ocr-layout-v1` привязан к неизменяемому release только для `PILOT_PZ002_PZ017`: первые две страницы `OCR_REQUIRED` на весь run, исходные PDF до 64 МиБ, 120 dpi, локальный `document-ai`, отдельные счётчики пропусков. `extract-worker` получил внутренний `DOCUMENT_PROVIDER_BASE_URL`; из самого контейнера `/health` OCR-сервиса ответил HTTP 200. Unit-проверки: 110 worker и 78 API; реальная PostgreSQL integration — 8/8; конфигурации laptop/server и core-smoke разобраны Compose без ошибок. Результат OCR хранится в append-only stage artifact и не превращается в finding.

Новый run `CHK-4CAE4879` пересоздан из `CHK-8C6FFA72`; 10/10 jobs `SUCCEEDED`. Итог `PARTIAL`: 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. OCR artifact `OCR_LAYOUT_BOUNDED`: `outputCount=2`, SHA-256 канонического содержимого `ae6218bccf5694da924bed21b03fe4035ecb86d777908efa8c6132b00ea914c8`, 7584 байта. Из 398 страниц `OCR_REQUIRED` обработаны F0150 p.1 и p.2; 396 отложены бюджетом, включая все 93 такие страницы F0201. Это проверяет выполнение и сохранение локального OCR, **не** полноту сканирования чертежей. Text artifacts обоих PDF отдельно экспортированы с совпадением DB SHA/размера. PZ-002 пока вызывает свой OCR независимо и не потребляет этот stage artifact.

После OCR API снова сверил оба оригинала с открытым manifest и вернул прежние визуальные результаты: F0150 614/614 страниц, 2 неклассифицированные области; F0201 676/676, 20 областей. Browser smoke открыл действующий run, два частичных параметра, пилотные факты, полный лист F0150 p.566 и увеличенный фрагмент. Сам сервер сверяет формат OCR, источник и SHA отчёта, но не пересчитывает PNG рендера из PDF: хеш изображения пока является утверждением доверенного worker. Независимая исходно-привязанная сверка вынесена в отдельный проверочный скрипт.

Отдельная [проба FREE-HEATING-001](FREE_HEATING_SUSPICION_PROBE_20260927.md) на F0171/F0202 дала один `SUSPICION` и ноль findings. Она пока не часть durable run и не входит в 132 параметра.

PZ-007 не включён в release: ПД подтверждает 3 надземных + 1 подземный этаж, но в разрешённом TRAIN_PUBLIC manifest нет самого комплекта РД АР того же объекта. Реестр комплектов в F0201 p.10 не заменяет чертежи, редакции/согласование/связь неизвестны. H100 здесь не использовался.

## Независимый OCR и визуальная модель v5, 27 сентября

[Проверочный скрипт OCR](BOUNDED_OCR_VERIFICATION.md) запущен в offline-контейнере `document-ai` с оригинальными F0150/F0201, открытым manifest и экспортами БД. Результат `SOURCE_RENDER_SCOPE_VERIFIED`: F0150 p.1–2 повторно отрисованы, SHA-256 PNG и геометрия совпали, `ocrLineTextVerified=false`. Сверка не подтверждает правильность распознанного текста.

Для визуального v5 локальный Qwen3-VL-4B GGUF подключён к внутренней сети `inspector-ai-homeserver-smoke_visual-vlm-runtime` как `visual-vlm`; запрос из `extract-worker` к `/health` вернул HTTP 200. Изолированный API выбрал immutable release с `red-vector-proposals-v5`, profile SHA-256 `d526877fc14eac48a61026f9e9c5394017e25b84d519bacc661af78e2fd89f78`. Прогон F0202 `CHK-570F3FEC` завершил 10/10 jobs, `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. Источник F0202: 36/36 листов, 160 геометрических предложений; два выбранных crop получили ответы `OTHER_HINT/MODEL_RESPONSE`. На обоих видны подписи PRADO Universal, так что отрицательное толкование этого ответа недопустимо. Повторный офлайн-рендер crop из оригинала подтвердил SHA-256, но [оценщик](VISUAL_V5_F0202_PROBE_20260927.md) вернул `NOT_ESTIMABLE` без независимой полной разметки. API smoke проверил исходный лист и crop; headless Chrome открыл страницу 16 в web. H100 не использовался.

## OCR v2 и повторный полный прогон, 27 сентября

После совместного обновления API, `worker`, `extract-worker` и web на homeserver включены `INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v2` и визуальный v5. Контейнеры и внутренний Qwen `/health` здоровы. PostgreSQL integration прошла 11/11 при явном `v1` для старого теста; отдельный тест pinning v2 переключает профиль внутри теста. В обычном runtime API действительно сообщил `ocr=v2`, `visual=V5`.

Новый immutable run `CHK-75051E60` на F0150/F0201 завершил 10/10 jobs с одной попытки: `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. Первый SSH-сеанс ожидания оборвался, поэтому итог повторно прочитан через authenticated API и БД; проверка не запускалась повторно. OCR stage `local-bounded-ocr-layout-v2` имеет DB SHA-256 `c3f30ae1e6775dc05ecc79e4e4166b7564c94cbe63a941a095fe6b7a76cf5518`: из 398 `OCR_REQUIRED` страниц обработаны F0150 p.295 (358 OCR-строк) и F0201 p.30 (365 строк), 396 отложены. [Независимая сверка](../../output/bounded-ocr-v2-20260927/source-render-verification.json) повторно отрисовала обе страницы из оригинальных `TRAIN_PUBLIC` PDF: source, text/stage хеши, выбор страниц, размеры и PNG-хеши совпали. Слова OCR экспертно не подтверждены.

Предметная проверка выявила слабость отбора v2: F0150 p.295 содержит условные обозначения градостроительного регулирования, F0201 p.30 — вентиляционные разрезы. Эти страницы не дают оснований для правил отопления или площади. Нужен профиль отбора с учётом раздела и контекста, а также больший проверяемый охват OCR; совпадение технических хешей не является доказательством полезности текста.

Визуальный артефакт того же run имеет SHA-256 `45862b06cab8643629c32b6a95bacf1043ec68c8383d005b827c96b40b8f6796`: F0150 614/614 страниц, 2 предложения; F0201 676/676, 20 предложений. Для двух crop каждого источника локальная модель вернула `OTHER_HINT/MODEL_RESPONSE`. Authenticated API smoke сверил оба исходника с открытым manifest, полный лист и crop, 0 findings. Это не оценка точности класса.

После добавления read API сохранённого OCR PostgreSQL integration прошла 11/11, а изолированные API и web пересобраны. Аутентифицированный GET активного `CHK-75051E60` вернул 398/2/396 и F0201 p.30 с 365 строками; порции `offset=0` и `offset=50` содержали по 50 строк. Устаревший run получил 404, анонимный запрос 401, исходный PNG p.30 вернул HTTP 200 (`image/png`, 185426 байт). Браузерный smoke открыл [лист и строки 51–100](../../output/bounded-ocr-v2-20260927/f0201-ocr-v2-review-20260927.png), затем [визуальное предложение F0201 p.36](../../output/bounded-ocr-v2-20260927/f0201-v5-after-ocr-review-20260927.png): 20 предложений, рамка внутри оригинала, crop 337 px и предупреждение к ответу VLM. UI прямо указывает, что строки OCR и классификация элемента человеком не подтверждены. Скрипт smoke теперь ограничивает DOM-поиск отдельными секциями OCR и визуальных предложений.

## OCR v3: листы РД-ОВ по контексту, 27 сентября

После совместной сборки API, `worker`, `extract-worker` и web изолированный профиль переключён на `INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v3`. `npm run check` прошёл; PostgreSQL integration на homeserver прошла 12/12, включая v1/v2/v3, до изменения runtime. Реальный новый run `CHK-1D9443FD` из `CHK-75051E60` завершил 10/10 jobs с одной попытки за 576 с: `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings.

Сохранённый OCR v3 artifact (18 582 байта) имеет DB SHA-256 `3b0865824b1f919eaa23a8d53d5232977989e70144f2b53b25357c16ed912e99`: 398 страниц требуют OCR, 3 попали в предметное окно, обработаны 2, отложены 396. F0150 получил `SKIPPED_NO_SUBJECT_CONTEXT` без выбранных страниц; F0201 обработал p.7 (90 строк) и p.8 (85 строк), p.9 отложена бюджетом. [Независимый отчёт](../../output/bounded-ocr-v3-20260927/source-render-verification.json), SHA-256 `a777a6e2ec1939f7d349922e7cf2cb2cae3f14f58caef239ba7d696af267505c`, повторил выбор и рендер по оригинальным `TRAIN_PUBLIC` PDF, получил `SOURCE_RENDER_SCOPE_VERIFIED` и совпадение PNG обоих листов; `ocrLineTextVerified=false`. Аутентифицированный API вернул v3 и тот же хеш, `Cache-Control: private, no-store`, 50+40 строк p.7 и 50+35 строк p.8.

Выборочная визуальная сверка p.7 с оригиналом нашла корректные OCR-строки «Нагревательные приборы» и «Стальные панельные радиаторы», а число `389,893 кВт` прочитано. Единица рядом распознана как `ГкАл/чАС` вместо напечатанного `Гкал/час`: текст не готов к автоматическому числовому выводу. Лист p.8 относится к вентиляции и горячему водоснабжению. Источник F0201 остаётся со смешанным/неразрешённым контекстом стадий и не получает нового finding.

Визуальный v5 stage того же run имеет SHA-256 `0156d43e2be32621e88e133f8e461b03c922d3611c38cc5cc0c8ff57c7b5390d`: F0150 614/614 страниц и 2 предложения, F0201 676/676 и 20 предложений, по 2 VLM-наблюдения на источник. Authenticated API smoke открыл исходный лист и crop обоих источников; предложения не классифицированы и findings 0. Браузерный smoke открыл OCR p.7 порциями по 50 строк и визуальный crop F0201 p.36.

После улучшения ручного просмотра браузерный smoke повторно проверил F0201
p.7: строка 62 «Стальные панельные радиаторы» выбирается из второй порции,
синяя рамка остаётся внутри исходного листа, рядом показывается читаемый
[фрагмент оригинала](../../output/bounded-ocr-v3-20260927/f0201-ocr-v3-crop-20260927.png).
Для F0150 экран ясно показывает `SKIPPED_NO_SUBJECT_CONTEXT` как пропуск,
а не отсутствие текста; [снимок](../../output/bounded-ocr-v3-20260927/f0150-ocr-v3-skip-20260927.png).
Обе браузерные сессии прошли параллельно. При двух занятых слотах рендера
запрос F0201 p.7 получил три `429`, ограниченный повтор дошёл до `200`,
после чего crop тоже вернул `200`. Это проверяет восстановление просмотра
при конкуренции запросов; техническое прохождение не меняет предметный
`PARTIAL` и не подтверждает строку OCR как факт.

## Второй реальный OCR v3 и управляемый Qwen, 27 сентября

На другом разрешённом комплекте `TRAIN_PUBLIC/INCLUDE` F0171 + F0202
reprocess создал `CHK-D445E09E` из `CHK-570F3FEC`. Все 10 jobs завершились,
общий результат остался `PARTIAL`: 130 `UNSUPPORTED`, PZ-002/PZ-017
`PARTIAL`, 0 findings. OCR v3 stage F0202 имеет DB SHA-256
`dd0f23da76772d8b4eb54a2c64dc609d73d31180a5d2d52aa82cc936e64b382e`:
13 страниц требовали OCR, 3 попали в предметное окно, p.7–8 обработаны,
остальные 11 отложены. [Экспорт stage](../../output/bounded-ocr-v3-f0202-20260927/stage-db.json)
сохранён вместе с текстовым артефактом. Независимый [отчёт](../../output/bounded-ocr-v3-f0202-20260927/source-render-verification.json)
с SHA-256 `168aee99607712623f5d78cfed7dbcccb13b0b24acbcb5e0550b6d584a604339`
повторно проверил публичный PDF, выбор и PNG обеих страниц:
`SOURCE_RENDER_SCOPE_VERIFIED`, `ocrLineTextVerified=false`.

Текст p.7–8 по содержанию близок к F0201 p.7–8, а исходные PDF и хеши
рендера различаются. Поэтому эта проверка подтверждает повторяемое исполнение
OCR на другом файле, но не независимую оценку качества распознавания.
Текущая проверенная карта стадий для этих приложений оставляет p.7–9
`UNRESOLVED`; числовой факт РД и finding из этих строк не выводятся.

Локальный Qwen3-VL-4B для визуальных подсказок теперь запускается как
`visual-vlm` в opt-in Compose-профиле `local-vlm`, без опубликованного порта.
Модель монтируется из `SMOKE_VISUAL_VLM_MODEL_DIR` только на чтение,
контейнер получает один GPU через NVIDIA Container Toolkit. На homeserver
Compose-контейнер `inspector-ai-homeserver-smoke-visual-vlm-1` стал `healthy`;
`extract-worker` получил HTTP 200 на `/health`, а мультимодальный запрос с
тестовым PNG завершился HTTP 200 с одним ответом модели. Последующий полный
run `CHK-D905DD61` ниже проверил этот Compose-сервис в составе всего DAG.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
docker compose -p inspector-ai-homeserver-smoke \
  --env-file infra/.env.homeserver-smoke \
  -f infra/docker-compose.yml -f infra/docker-compose.core-smoke.yml \
  --profile local-vlm config --quiet
docker compose -p inspector-ai-homeserver-smoke \
  --env-file infra/.env.homeserver-smoke \
  -f infra/docker-compose.yml -f infra/docker-compose.core-smoke.yml \
  --profile local-vlm up -d visual-vlm
```

## OCR heat review aid: первый сквозной run, 27 сентября

После включения `INSPECTOR_OCR_HEAT_ROW_PROFILE=v1` изолированный homeserver
пересобрал API/worker. PostgreSQL integration прошла 13/13 при явном
baseline OCR v1; новый тест внутри набора отдельно включил v3 и OCR heat.
Локальные проверки: 149 worker Python, 104 API unit, 13/13 PostgreSQL;
для парных чисел Python/TypeScript отдельно проверены ведущие нули и пределы
разрядности. В Compose API действительно получает `v1` OCR heat + `v3` OCR.

Первый reprocess F0171+F0202 создал `CHK-D905DD61` и завершился `PARTIAL`
за 335 с: 10/10 jobs, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings.
Новый immutable RULE_EVALUATION stage имеет профиль
`typed-pz002-pz017-ocr-heat-v1`, outputCount 3, SHA-256
`583a832ede52e3f977883c9ec2149220b9b41b3ed6c40a656aee4a020c2e4608`
(24 306 байт). Внутри `ocrHeatRows`: 0 предложений, 4 воздержания
`PAGE_STAGE_UNRESOLVED`, findingCount 0. PZ-017 сохранил
`MISSING_EVIDENCE`; OCR не был повышен до факта. OCR v3 stage повторил
SHA-256 `dd0f23da76772d8b4eb54a2c64dc609d73d31180a5d2d52aa82cc936e64b382e`
на F0202 p.7–8. Visual v5 просмотрел 36/36 страниц, сохранил 160
геометрических предложений и 2 ответа локального Qwen с `MODEL_RESPONSE`;
его SHA-256 в этом run —
`414933e639d7292c63871fbba78a381de6e09aa9d72c40a3c6a1f134584c63e9`.
Это подтверждает исполнение Compose-модели в полном пайплайне, но не
правильность её подсказок.

Во время этого прогона `RULE_EVALUATION` сначала получил HTTP 503 на
внутреннем OCR read: общий `RoutedInspectionRepository` не пересылал новый
метод в PostgreSQL. Добавлены пересылка и тест, API пересобран; третья
попытка job завершилась, затем успешно закрылись evidence и seal. Скрипт
ожидания оборвался при перезапуске API, поэтому окончательный результат
сверен непосредственно по `analysis_runs`, `analysis_jobs` и сохранённым
stage artifacts. Повторный check для этого сбоя не создавался.

Второй reprocess F0150+F0201 `CHK-9C474C9A` завершился за 579 с:
10/10 jobs `SUCCEEDED`, `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017
`PARTIAL`, 0 findings. RULE_EVALUATION stage с тем же закреплённым профилем
имеет SHA-256 `a25fdc50d667047df42e8afb005df5ce5d88194f46bff88cc55bd531fd086aea`
(87 001 байт), 0 предложений, 4 воздержания `PAGE_STAGE_UNRESOLVED`.
OCR v3 stage повторил SHA-256
`3b0865824b1f919eaa23a8d53d5232977989e70144f2b53b25357c16ed912e99`
на F0201 p.7–8; F0150 не получил предметного OCR-кандидата.

После окончания обоих run API и web обновлены в отдельном Compose-проекте.
PostgreSQL integration на собранном API image прошла 13/13; локальный
`npm run check` прошёл. Анонимный `/pilot-results` вернул 401, а
аутентифицированный запрос по каждому новому check — HTTP 200, `READY`,
два результата правил, OCR-профиль `conservative-ocr-heat-rows-v1`, 0/4.
Запрос к устаревшему run вернул 404 по правилу активного запуска.
Headless Chrome открыл `OBJ-E655CAA3`, подтвердил частичное покрытие,
160 сохранённых визуальных предложений и OCR-блок с четырьмя воздержаниями;
ссылка из раскрытой строки на оригинальную страницу вернула HTTP 200 и
изображение. [Скриншот раскрытой строки](../../output/ocr-heat-review-20260927/coverage-f0202-expanded.png),
SHA-256 `e1eeef4f37d2b64840f0fbf1789e61016e20bbaf5acdfb5f7e4872fa05eef9ec`.
Правильность текста OCR и принадлежность страниц стадии РД этим smoke не
подтверждены.

## Повтор после исправления стадии одностадийного РД, 27 сентября

API и rules worker изолированного Compose пересобраны после исправления
наследования стадии из закреплённого manifest. Остальные сервисы не
перезапускались. До обновления в БД не было активных analysis jobs; после
обновления API health вернул `ok`. Сквозной Python→TypeScript контракт на
детерминированном OCR fixture прошёл локально и в smoke checkout homeserver:
одностадийный РД дал 2 предложения, mixed без page review — 2 воздержания,
mixed с проверенной RD-страницей — 2 предложения; 4 подмены отклонены.
PostgreSQL integration прошла 15/15, в том числе оба положительных варианта
с complete/replay/seal/read и нулём findings.

Новый реальный reprocess публичных F0150+F0201 создал `CHK-EA02587C` и
завершился за 581 с: 10/10 jobs `SUCCEEDED`, итог `PARTIAL`, 130
`UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. Поскольку F0201 остаётся
**смешанным** РД/ИД без подтверждённой стадии выбранных страниц, OCR-heat
сохранил 0 предложений и 4 воздержания. RULE_EVALUATION artifact снова имеет
SHA-256 `a25fdc50d667047df42e8afb005df5ce5d88194f46bff88cc55bd531fd086aea`
(87 001 байт); OCR v3 artifact снова имеет SHA-256
`3b0865824b1f919eaa23a8d53d5232977989e70144f2b53b25357c16ed912e99`.
Совпадение артефактов с предыдущим run подтверждает отсутствие изменения
результата на этом mixed источнике. Положительный путь одностадийного РД
подтверждён PostgreSQL и межъязыковым fixture, но ещё не реальным PDF такого
типа с пригодной строкой тепловой нагрузки.

## Общие факты ПЗ/КР, 27 сентября 2026

Новый opt-in fact-family профиль развёрнут в том же изолированном Compose.
Первый reprocess F0150/F0201 `CHK-24F6DF14` закончился `FAILED`: worker искал
`fact-family-pilot-v1.json` в `site-packages/rules`, а Docker копировал файл
в `/worker/rules`. Исправлен явный `INSPECTOR_RULES_DIR=/worker/rules`;
собранный образ затем загрузил пять правил и весь реестр 132 кодов.
Неудачный run оставлен в истории.

Миграция `018_source_review_section_code.sql` применена к изолированной БД;
старые решения остались без раздела. PostgreSQL integration 16/16 прошла на
временной БД. API, worker и web пересобраны, API/web `healthy`. Headless
Chrome под reviewer открыл новый выбор «Раздел документа» на F0201;
[снимок](../../output/fact-family-public-20260927/source-section-review-20260927.png).

Новый объект `OBJ-7DA53D73` создан из исходных F0106 (ПД, 139 страниц) и
F0140 (РД, 27 страниц), сверенных с `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN`
manifest по байтам и SHA-256. Run `CHK-B210F921` завершился: 10/10 jobs
`SUCCEEDED`, итог `PARTIAL`, coverage 7 `PARTIAL` + 125 `UNSUPPORTED`,
findings 0. `GET /pilot-results` повторно проверил артефакт с хешем
`49bedbe751c75a1802a8907f7a563adb16f215a21e9963e8f4f43cf5a9249740`:
пять локализованных фактов и пять `ABSTAIN`. ПД KR-055 описывает лестницу,
РД KR-055 — фундамент; у KR-058 три факта только в РД. Пара одного элемента
не доказана. [Полный ответ API](../../output/fact-family-public-20260927/durable-pilot-results.json).
Read-only Chrome smoke на том же объекте показал пять строк правил и пять
ссылок на оригинальные страницы;
[снимок панели](../../output/fact-family-public-20260927/durable-fact-family-ui.png).

Повторный большой run F0150/F0201 `CHK-020A7105` после исправления пути к
правилам завершил 10/10 jobs: `PARTIAL`, coverage 7 `PARTIAL` + 125
`UNSUPPORTED`, findings 0. В новом fact-family artifact пригодных фактов
для пяти правил не извлечено; сравнения дали пять
`ABSTAIN/REQUIRED_FACT_MISSING`, hash
`fd0b6ceea44aa624b72b243c73267d424be3629fab1fad42fb4c69eab9bdb270`.
[Сохранённый ответ API](../../output/fact-family-public-20260927/durable-large-pilot-results.json).
Это не утверждение об отсутствии соответствующих параметров в документах.

Миграция `019_fact_entity_link_reviews.sql` применена к изолированной БД;
API/worker/web пересобраны и здоровы. PostgreSQL integration 17/17 прошла на
созданной и удалённой временной БД. Первый read-only browser smoke выявил 503
у `GET /fact-links`: `RoutedInspectionRepository` не передавал новый метод
в PostgreSQL. После добавления двух делегатов и теста API пересобран;
повторный smoke `CHK-B210F921` получил HTTP 200, 0 сохранённых связей,
пять строк сравнений и пять ссылок на исходники.
[Снимок формы](../../output/fact-family-public-20260927/fact-link-review-ui.png).
Связь реальных фактов не утверждалась: исходники имеют статус `UNKNOWN`, а
KR-055 на ПД/РД описывает разные элементы. Результат run не менялся.

Следующий reprocess того же открытого объекта после миграции 019 создал
`CHK-B8ACC123`. Полный DAG завершился `PARTIAL`, coverage 7 `PARTIAL` и 125
`UNSUPPORTED`, findings 0; сохранены пять фактов и пять `ABSTAIN` с прежним
хешем `49bedbe751c75a1802a8907f7a563adb16f215a21e9963e8f4f43cf5a9249740`.
[Ответ API](../../output/fact-family-public-20260927/post-link-reprocess.json).
Индекс всего открытого корпуса ещё строится отдельно; этот run не проверяет
новые PZ-010/KR-061 наблюдения, поскольку для них нет подтверждённой пары.

## Preview 47 семейств и восстановление очереди, 27 сентября 2026

Индекс 203 открытых документов уже прошёл полный аудит; выбранная адресная
OCR-очередь v2 завершила 33/33 новых страниц. Новый opt-in профиль
`candidate-family-preview-v1` прошёл PostgreSQL integration 18/18, два
сквозных run на оригинальных F0105/F0136 и headless Chrome. После найденных
в первом run дефектов исправлены восстановление AMQP-соединения outbox relay
и затенение числового PZ-002 правила набором меток preview. Relay пережил
принудительное закрытие собственного канала; следующий полный run прошёл
10/10 jobs. Оба успешных run имеют 47 `ABSTAIN`, 0 findings и прежние
7 `PARTIAL` + 125 `UNSUPPORTED`. Роли, редакции и сопоставимые элементы
ПД/РД для этих файлов не подтверждены. Команды, receipt SHA и границы
проверки — в [отдельном отчёте](CANDIDATE_PREVIEW_HOMESERVER_20260927.md).

## Восстановление повреждённого титула, 28 сентября

В изолированном проекте API и четыре worker-сервиса переключены на
opt-in bounded OCR v4. На исходном открытом F0153 сквозной `CHK-C260E0AA`
завершил 10/10 jobs, а OCR stage обработал p.1–2 из 39 требующих OCR
страниц; остальные 37 отложены лимитом. Независимая проверка по PDF,
манифесту, сохранённым SHA и повторному рендеру прошла. Все 47 кандидатных
кодов остались `ABSTAIN`, findings 0. Предыдущий v3 run обработал 0 из 39,
хотя текстовый слой уже пометил p.1 как `OCR_REQUIRED`. Полные команды,
хеши и границы проверки — в [отчёте v4](BOUNDED_OCR_V4_TITLE_RECOVERY.md).
Регрессионный v4 прогон открытого F0202 `CHK-84832893` сохранил выбор
предметных p.7–8 и их content SHA из v3: 10/10 jobs с первой попытки,
независимая сверка исходного PDF и рендера прошла, все 47 кодов остались
`ABSTAIN`. Подробности и артефакты — в том же отчёте.

## Регрессия после моста сравнения состава, 28 сентября

В изолированном проекте пересобраны и перезапущены четыре Python worker-сервиса
при отсутствии активных jobs. SHA-256 `candidate_family_comparison.py` в
запущенном контейнере и текущей локальной копии совпал:
`d209f78cc30d0fef61c4ab8c1e9b7998558ac6a4bef2b59bc976286cde4203bb`.
API health вернул `ok`; все 13 контейнеров находились в состоянии `Up`.

Повтор открытого F0202 создал immutable `CHK-3E6A489F` из
`CHK-84832893`. Проверка с закреплённым в исходном run профилем
`FACT_FAMILY_V1` прошла: статус `PARTIAL`, 125 `UNSUPPORTED`, семь `PARTIAL`,
0 findings. Счётчик успешных jobs изолированного проекта вырос с 475 до 485,
число `FAILED` (3) и `CANCELLED` (7) не изменилось. В сохранённом результате
пять сравнений семейства дали `ABSTAIN`, 47 кандидатных строк preview,
0 кандидатных наблюдений для этого источника. Начальная команда smoke была
запущена с ожиданием текущей переменной окружения API
`PILOT_PZ002_PZ017` и завершилась ошибкой сверки ожидаемого coverage;
повторное чтение **того же** `CHK-3E6A489F` с его закреплённым профилем
`FACT_FAMILY_V1` прошло. Новый run из-за этой ошибки не создавался.

Этот сквозной прогон проверяет отсутствие регрессии durable DAG после смены
образа. Он не использует offline `reviewed_sets`: на F0202 нет отдельно
подтверждённых полных перечней, пары ПД/РД и доказанного общего охвата.
Положительный результат `PRESENCE_SET` на реальных данных не установлен.

После закрытия пропуска в связке `inputManifestHash` четыре Python
worker-сервиса повторно пересобраны и перезапущены при отсутствии активных
jobs. Текущий SHA-256 модуля в локальной копии и запущенном `worker`
одинаков: `060c08b2281caa60f0586d831670bd43d5a760de606963520cb5d1592d37c0a8`.
Повтор того же публичного F0202 создал `CHK-C85C1A04` из
`CHK-3E6A489F`: `PARTIAL`, 125 `UNSUPPORTED`, семь `PARTIAL`,
0 findings, пять fact-family `ABSTAIN`, 47 candidate preview `ABSTAIN`.
Счётчик успешных jobs вырос с 485 до 495 без новых `FAILED` или
`CANCELLED`; API health вернул `ok`. Это проверка регрессии сквозного
пути. Новый SHA-gate сравнения по-прежнему проверен синтетическим
тестом: на F0202 нет утверждённой пары фактов, способной пройти его.

После независимого аудита расширенной публичной OCR-очереди выполнен
регрессионный reprocess того же F0202: `CHK-892B92D9` из
`CHK-C85C1A04`. Аутентифицированный smoke подтвердил `PARTIAL`, семь
`PARTIAL` и 125 `UNSUPPORTED` кодов, 0 findings, пять fact-family
`ABSTAIN`, 47 candidate preview `ABSTAIN`, 0 run-наблюдений. Сохранённый
[ответ pilot-results](../../output/public-index-20260927/f0202-post-expanded-ocr-reprocess-20260928.json)
имеет SHA-256 `4d138ab3588b8c15128946fe9297d0692651c27cd7e20a301ed0c0a4022fde83`.
Расширенная OCR-очередь — отдельная offline проверка других публичных
страниц; этот reprocess не переносит её строки в run и не подтверждает
предметные факты.

## Адресные OCR-подсказки 47 кодов, 28 сентября

В изолированном Compose-проекте после отсутствия активных jobs сохранена копия
предыдущих файлов и переменных, затем пересобраны API и четыре worker-сервиса.
Новый профиль `typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1`
включён отдельно. API стал `healthy`, все четыре worker-контейнера запущены.
Профиль добавляет `candidateFamilyOcrObservations` из **сохранённой OCR-стадии
того же run**, не переносит в него offline очередь 105 страниц и не меняет
результаты прежних профилей.

Повтор F0202 создал `CHK-A1109F5D`: `PARTIAL` 7/125, findings 0, пять
fact-family `ABSTAIN`, 47 preview `ABSTAIN`, 47 OCR-sidecar `ABSTAIN`.
OCR-кандидатов нет, поскольку обработанных OCR-страниц в релевантных
проверенных источниках нет. Аутентифицированный `GET /pilot-results` заново
проверил сохранённые SHA и локаторы. [Ответ API](../../output/public-index-20260927/f0202-ocr-sidecar-reprocess-20260928.json)
скопирован с homeserver и сверен: SHA-256
`945a082c2082886b7582316e00abe5cae3fe9343da22c51f03d82a01f34e3a30`.

Повтор открытого F0153 создал `CHK-D1C8E8F1`: `PARTIAL` 7/125, findings 0,
пять fact-family `ABSTAIN`, 47 OCR-sidecar `ABSTAIN`. Его сохранённая OCR-стадия
обработала **2 из 39** страниц, 37 отложила; SHA-256 стадии
`cab7f21b610fe8c863883db4fbd619d6095b6343f713712b67cf4f3e290236f7`.
По 47 правилам нет допустимого источника с подтверждёнными текущей редакцией,
согласованием и разделом, поэтому sidecar не выдаёт лидов и не трактует
отложенные листы как отсутствие параметра. [Ответ API](../../output/public-index-20260927/f0153-ocr-sidecar-reprocess-20260928.json)
сверен по SHA-256
`77e819251da5ffedd3ef0146468aed224086558c1f5111d06d1ba5b4273e8cf1`.

На временной PostgreSQL 17 пройдены все 20 integration cases, в том числе
новый профиль, отказ в сохранении подменённого OCR-sidecar и аутентифицированный
GET. Локальный полный `npm run check` прошёл после интеграции. Тест
Python→TypeScript отдельно проверяет честный новый run stage из старого OCR
receipt с `score=1.0`: receipt остаётся неизменным, числовые значения нового
stage приводятся к устойчивому JSON-представлению, и API принимает его SHA.
Ранее сохранённый stage со старым `1.0` требует повторного run для такой
проверки; существующие cache receipts не переписаны.

Web пересобран в том же изолированном Compose-проекте. Headless Chrome вошёл
через web proxy под smoke-пользователем, открыл `OBJ-E655CAA3` и сохранённый
`CHK-A1109F5D`: панель «Адресные OCR-подсказки» показала все 47 кодов в
девяти семействах с `ABSTAIN`, нулём лидов и прямым предупреждением, что
подсказки не подтверждают факт или находку. Browser smoke вернул
`ocrObservationCodeCount: 47`; web/API healthchecks — `healthy`.

## OCR v5: расширенный адресный лимит, 28 сентября

Профиль OCR v5 отдельно расширил лимит до четырёх страниц на run. На
открытом F0202 новый `CHK-C2D19963` сохранил три выбранных листа p.7–9,
все десять jobs завершились успешно; результат остался `PARTIAL` 7/125,
0 findings, 47 OCR-sidecar `ABSTAIN`. Исходный PDF, сохранённый stage и
повторный рендер всех трёх страниц независимо сверены по SHA.
Подробности и артефакты: [BOUNDED_OCR_V5_PUBLIC_RUN_20260928](BOUNDED_OCR_V5_PUBLIC_RUN_20260928.md).

## Некодированные OCR-строки таблиц, 28 сентября

После подключения отдельного opt-in профиля повтор F0202 `CHK-1BD8477F`
завершил 10/10 jobs, `PARTIAL` 7/125, 0 findings. Новый rule stage сохранил
16 предложений строк таблицы и три воздержания; API независимо проверил
их при save/seal/GET. Аутентифицированный GET, совпадение с offline-пакетом,
анонимный HTTP 401 и headless Chrome прошли. Исходные OCR-строки остались
без кода параметра, типизированного факта и вывода. Полные SHA, тесты и
границы проверки: [OCR_TABLE_ROWS_COMPOSE_20260928](OCR_TABLE_ROWS_COMPOSE_20260928.md).

## Журнал ручной транскрипции OCR-строк, 28 сентября

Изолированный Compose получил миграцию 020, API и web для append-only
решений о чтении строки. На сохранённом F0202 `CHK-1BD8477F`
аутентифицированный GET вернул 16 кандидатов и 0 решений, анонимный GET —
401. POST с чужим отпечатком вернул 409 и не создал запись. Headless Chrome
показал 16 строк и ручную форму с пустым решением и выключенным сохранением.
Положительная запись протестирована только в синтетической PostgreSQL
интеграции; за эксперта на F0202 решение не создавалось. Команды и границы:
[OCR_ROW_TRANSCRIPTION_COMPOSE_20260928](OCR_ROW_TRANSCRIPTION_COMPOSE_20260928.md).

## OCR-таблица v2 и снимки решений, 28 сентября

Изолированный F0202 `CHK-FA35FEA0` с opt-in OCR-таблицей v2 завершил
10/10 jobs; 17 некодированных строк, три воздержания, `PARTIAL` 7/125,
0 findings. Миграция 021 применена, снимков решений в run 0: реальных
подтверждений на F0202 нет. Авторизованный GET, отказ чужому отпечатку,
оригинальная страница и headless Chrome на 17 строк прошли. SHA, локальные
тесты и пределы проверки: [OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928](OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928.md).
