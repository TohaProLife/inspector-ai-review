# Docker-профили laptop и server

Версия 1.5, 27 сентября 2026 года. Есть ровно два deployment-профиля: `laptop` и `server`. `server` настроен под проверочный стенд с одним доступным H100 80 ГБ на команду, хотя на физическом сервере установлены два H100. Каждый профиль одной командой поднимает application stack, хранилища и выбранные provider runtimes. По умолчанию release остаётся `SCAFFOLD`; отдельный `DRAFT`-пилот PZ-002/PZ-017 включается через env.

## Состав профилей

| Компонент | Laptop | Server |
|---|---|---|
| PostgreSQL | PostgreSQL 17 + pgvector 0.8.6 | то же |
| Renderer/OCR | pypdfium2 5.12.1 + PaddleOCR 3.7.0, CPU | pypdfium2 5.12.1 + PaddleOCR 3.7.0, GPU |
| Layout/detection | PP-DocLayout-M + PP-OCRv5 mobile det | PP-DocLayout-L + PP-OCRv5 server det |
| Recognition | East Slavic + Latin PP-OCRv5 | те же recognizers, batch 8 |
| VLM | Bonsai 2 27B PTQ1_0, PrismML llama.cpp | Qwen3-VL-8B-Instruct-FP8, vLLM 0.29.0 |
| Embeddings | Qwen3-Embedding-0.6B, CPU, 1024 dimensions | Qwen3-Embedding-0.6B, CPU, 1024 dimensions |
| Reranker | выключен | выключен |
| Приложение | API, web, RabbitMQ, Redis, MinIO, ClamAV, workers | то же |

Qwen snapshots закреплены полным commit SHA, размером и SHA-256 каждого runtime-файла в [`laptop.json`](../../services/model-store/locks/laptop.json) и [`server.json`](../../services/model-store/locks/server.json). Laptop lock содержит 1.12 GiB embeddings; server lock — около 11 GiB VLM/embeddings. Bonsai lock отдельно содержит 6.12 GiB model/projector artifacts.

Paddle model archive URLs не дают стабильного опубликованного SHA-256 lock. Поэтому init-контейнер скачивает только allowlisted model names через закреплённые PaddleOCR/PaddleX 3.7.0, хеширует полный cache и сохраняет локальный manifest. Повторный запуск проверяет schema/profile/hash и точное множество файлов, включая отсутствие лишних файлов. Для production можно передать доверенный manifest через `DOCUMENT_AI_TRUSTED_MANIFEST` и включить `DOCUMENT_AI_REQUIRE_TRUSTED_MANIFEST=1`; первый download без такого manifest остаётся TOFU и требует supply-chain approval.

Все внешние base/runtime images в Compose и Dockerfile закреплены amd64 digest. Собираемые локально `inspector-ai/*` images получают детерминированные base layers, но их итоговые registry digests, transitive Python wheel hashes, SBOM и подпись фиксируются уже в release packaging.

## Требования

Общие:

- Linux x86_64, Docker Engine 24+ и Docker Compose v2.30+;
- NVIDIA Container Toolkit для обоих GPU-профилей; runtime `nvidia` должен быть зарегистрирован в Docker (`nvidia-ctk runtime configure --runtime=docker` на host с последующим перезапуском Docker);
- Internet только на первом provisioning либо заранее импортированные images/model volumes;
- matching hardware выбранного профиля; эти конфигурации не обещают запуск на произвольной архитектуре/без нужного GPU;
- секретный env генерируется с mode `0600`; все публикуемые порты по умолчанию bind только на `127.0.0.1`.

Laptop рассчитан на RTX 4060 Laptop 8 GiB, 14 GiB RAM. Нужно минимум 20 GiB свободного диска, рекомендуется 40 GiB. Bonsai работает через CUDA; OCR и embeddings — на CPU. Отдельного третьего CPU-профиля нет.

Server default рассчитан на один из двух H100 80 ГБ проверочного стенда, до 24 физических CPU-ядер, до 640 ГБ RAM и минимум 300 ГБ рабочего диска. Preflight требует не менее 150 GiB свободного диска, 240 GiB RAM и GPU с не менее 78000 MiB VRAM; эти пороги не доказывают наличие свободных CPU/RAM в других контурах. `SERVER_GPU_DEVICE` выбирает один физический GPU через runtime `nvidia` и `NVIDIA_VISIBLE_DEVICES`; второй GPU в контейнеры не передаётся. Такой путь проверен на Docker 29, где `--gpus all` даёт ошибку CDI. Образ содержит CUDA runtime, драйвер предоставляет host через NVIDIA Container Toolkit.

## Запуск laptop

Первый вызов автоматически создаёт `infra/.env.laptop` с независимыми случайными PostgreSQL, RabbitMQ, Redis, MinIO и worker credentials. Явно создать/посмотреть путь можно командой `./infra/stack.sh laptop init`. Затем:

```bash
./infra/stack.sh laptop config --quiet
./infra/stack.sh laptop preflight
./infra/stack.sh laptop up -d --build
./infra/smoke-providers.sh laptop
```

Первый `up` собирает application/provider images, скачивает checksum-locked Bonsai/Qwen artifacts и создаёт Paddle cache. Init-контейнеры завершаются; inference-контейнеры получают model volumes read-only и работают только в сети `provider-runtime` с `internal: true`.

## Запуск server

Первый вызов автоматически создаёт отдельный `infra/.env.server`; явно: `./infra/stack.sh server init`. Затем:

```bash
./infra/stack.sh server config --quiet
./infra/stack.sh server preflight
./infra/stack.sh server up -d --build
./infra/smoke-providers.sh server
```

Для конкурсного H100 запуска перед `up` установите в `infra/.env.server` семь селекторов по [пошаговой инструкции](COMPETITION_H100_LAUNCH.md): `PILOT_PZ002_PZ017`, OCR `v3`, visual `V6`, OCR heat `v1`, fact family `v1`, candidate family preview `v1`, candidate observations `v1`. Затем выполните `python3 infra/check-competition-profile.py`, `./infra/stack.sh server preflight` и `./infra/stack.sh server config --quiet`. Guard проверяет разрешённый Compose и один выбранный GPU; `python3 infra/check-competition-profile.py --running` после `up` проверяет видимость одного GPU в работающих провайдерах. Это не проверка инференса или точности на H100.

`qwen-vlm-server` использует amd64 digest vLLM 0.29.0. Две server-модели загружаются одним init-контейнером и после SHA-256 проверки доступны runtime только read-only. `gpu-admission-server` видит только выбранный H100 и проверяет `used + 40,960 MiB ≤ 85% total VRAM`: budgets VLM `30,720 MiB`, document `10,240 MiB`. Затем последовательно стартуют VLM → document → CPU embedding. vLLM ограничен `0.35` VRAM, Paddle — `0.10`; context `8192`, `max-num-seqs=2`, максимум два изображения на prompt. Это стартовые лимиты; фактические peak/fragmentation и работу при соседней нагрузке подтверждает H100 soak. Admission проверяет состояние при запуске, а не резервирует память на всё окно проверки.

Launcher использует разные Compose project names: `inspector-ai-laptop` и `inspector-ai-server`. Их credentials, DB и model volumes не смешиваются. Одновременно с default ports их запускать нельзя; для параллельного стенда нужны разные host ports. Не удалять соответствующий `.env.<profile>`, пока сохранены его PostgreSQL/MinIO volumes; иначе новые credentials не совпадут с уже инициализированными сервисами. Если старый H200 server volume уже содержит 30B/4B/reranker, эти каталоги могут остаться и занять диск: для H100 лучше создать новый чистый model volume.

`extract-worker` и `worker` используют общий внутри проекта named volume
`ocr-page-cache` для повторного адресного OCR v2/v3 и PZ-002. Он отделён
по Compose project name, не
содержит исходных PDF и не заменяет сохранённый артефакт анализа.
[Правило ключа и проверки](DURABLE_OCR_PAGE_CACHE.md) привязывает кеш к
SHA PDF, странице и профилям; для повторного использования volume нужно
сохранить при перезапуске. Удаление кеша лишь вызовет новый OCR.

`document-worker` держит независимый named volume `text-layer-cache` для
проверенного `document-text-v2`. Исходный PDF всё равно скачивается через
текущий lease и проверяется по SHA; подробности — в
[правиле кеша текста](DURABLE_TEXT_LAYER_CACHE.md).
[Повторный homeserver run](DURABLE_CACHE_E2E_20260927.md) измерил ускорение
обеих стадий с теми же сохранёнными хешами артефактов.

## Локальные endpoints

Все application/infrastructure/provider порты по умолчанию публикуются только на `127.0.0.1`. Для внешнего доступа менять `HOST_BIND_ADDRESS` следует только за firewall/reverse proxy.

| Endpoint | Laptop | Server |
|---|---:|---:|
| Document health/render/OCR | `8090` | `8090` |
| VLM OpenAI API | `8081` | `8101` |
| Embeddings OpenAI API | `8091` | `8102` |

Внутри Compose workers используют aliases `document-ai`, `vlm`, `embedding`; host ports не используются.

Изолированная проверка на homeserver с RTX 2080 SUPER использует
[`docker-compose.core-smoke.yml`](../../infra/docker-compose.core-smoke.yml)
поверх базового Compose, а не профиль `server` для H100. Опциональный
`--profile local-vlm` запускает закреплённый образ llama.cpp с локальными
Qwen3-VL-4B GGUF весами из `SMOKE_VISUAL_VLM_MODEL_DIR` только на чтение.
Сервис `visual-vlm` доступен worker через внутреннюю сеть; публичного порта
у него нет. Конкретная команда и живой smoke описаны в
[журнале homeserver](HOMESERVER_SMOKE.md#второй-реальный-ocr-v3-и-управляемый-qwen-27-сентября).

## Provisioning и offline перенос

Qwen model store поддерживает local import. Каталог должен повторять `localDirectory/filename` из lock:

```bash
./infra/stack.sh server run --rm \
  -e MODEL_STORE_IMPORT_ROOT=/import \
  -v /absolute/path/to/qwen-mirror:/import:ro \
  hf-model-init-server
```

Для laptop заменить service на `hf-model-init-laptop`. Bonsai import описан в [отдельном runbook](BONSAI_LAPTOP_DEPLOYMENT.md).

Paddle cache переносится как уже проверенный named volume: provision выполнить на connected build-host тем же image/profile, экспортировать volume вместе с `.ready-<profile>.json`, импортировать на target host без изменения путей. Runtime не имеет egress; неполный cache обнаружится при preload и container не станет healthy.

Для полностью air-gapped host также заранее собрать/pull и передать все images через private registry или `docker save`/`docker load`. После импорта запускать с `--no-build`. Runtime providers имеют только internal network; smoke дополнительно проверяет невозможность исходящего соединения.

```bash
./infra/stack.sh laptop up -d --no-build
# или
./infra/stack.sh server up -d --no-build
```

## Управление

Статус и logs:

```bash
./infra/stack.sh laptop ps
./infra/stack.sh laptop logs --tail=200 document-ai-laptop embedding-laptop bonsai-vlm-cuda
./infra/stack.sh server ps
./infra/stack.sh server logs --tail=200 qwen-vlm-server document-ai-server embedding-server
```

Остановка с сохранением DB и weights:

```bash
./infra/stack.sh laptop down
./infra/stack.sh server down
```

Не использовать `down -v`, если model/DB volumes должны сохраниться.

## Граница готовности

Контейнерный слой готовит выбранные runtimes, endpoints, model volumes, pgvector extension, secrets, memory limits, GPU admission, closed runtime network и worker environment mapping. `SCAFFOLD` остаётся default. При `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002_PZ017` rules worker получает локальный document-ai для ограниченного PZ-002 OCR и читает сохранённый text layer для PZ-017; максимум OCR-страниц задаёт `PZ002_MAX_OCR_PAGES` (default 2). Старый `PILOT_PZ002` остаётся доступен для прежних immutable runs. Аутентифицированное решение по источнику фиксируется до запуска проверки через `source-review` API и snapshot попадает в lease. Сервер сохраняет PZ-002 `CANDIDATE` только при независимой проверке квалифицированных текстовых блоков ПД/РД; OCR-кандидат пока отвергается. PZ-017 не выводит общую нагрузку или finding без сопоставимого состава, редакции и связи комплектов. Без fact family review 130 матричных правил остаются `UNSUPPORTED`; с пятью review-only правилами их 125. Дополнительные 47 строк candidate preview всегда `ABSTAIN`; observations `v1` проверяет те же лиды по точным адресам и оставляет их `REVIEW_ONLY`. Оба не меняют покрытие и не создают findings. H100 runtime и предметная точность не подтверждены.

Для запуска этого пилота в любом профиле после `./infra/stack.sh <profile> init` указать `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002_PZ017` в соответствующем `infra/.env.<profile>` **до** `up`. Для candidate preview дополнительно нужны OCR layout `v3` и три review aid `v1` из конкурсной инструкции; для observations нужен четвёртый селектор `INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE=v1`. На laptop они необязательны, его лёгкий default сохранён. Смена значения влияет только на новые runs: старые сохраняют свой release ID и артефакты. Оба профиля одной командой сохраняют свой CPU/GPU budget; пилот не требует второго GPU.

Отдельный opt-in `INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE=v1` требует
`INSPECTOR_OCR_TABLE_ROWS_PROFILE=v3` и добавляет только три строки
`AR-042`/`IOS2-072`/`IOS3-075` с исходными подсказками и `ABSTAIN`.
Compose передаёт селектор API; worker получает его через закреплённый release.
Этот профиль проверен в изолированном [homeserver Compose](UNRESOLVED_FAMILY_RUN_COMPOSE_20260928.md)
на RTX 2080 SUPER. H100 и положительный предметный результат пока не проверены.

Отдельный opt-in OCR v6 задаётся `INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v6`.
Он адресно обрабатывает до четырёх `OCR_REQUIRED` листов только после
`CURRENT`/`APPROVED` решения по источнику AR/VK и разрешённой стадии страницы;
старые OCR heat/table селекторы при этом должны оставаться пустыми. Дополнительный
`INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE=v1` добавляет только
review-only подсказки по `AR-042`/`IOS2-072`/`IOS3-075`; он требует OCR v6 и
также несовместим со старыми OCR review селекторами. Compose передаёт оба
значения только API, а worker получает закреплённый release. Базовый OCR v6
проверен в изолированном [homeserver Compose](OCR_V6_COMPOSE_20260928.md):
на публичном F0163 две страницы корректно отложены без решения эксперта.
Новый OCR sidecar [проверен отдельно](OCR_V6_FAMILY_SIDECAR_COMPOSE_20260928.md)
на публичном F0163: три `ABSTAIN`, 0 строк без решения по источнику.
Результаты OCR не подтверждают факты, пары ПД/РД и предметную полноту.

Отдельный `INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE=v1` включает три
review-only строки `PZ-001`/`SPZU-026`/`SPZU-027` по текстовому слою
проверенного ПД/ГП источника. OCR/table селекторы ему не нужны; настройки
старых профилей остаются пустыми. Compose передаёт селектор API, worker
получает неизменяемый release. Пока прошли локальный полный check и
PostgreSQL suite; [тематический изолированный Compose](SITE_TEP_AREA_COMPOSE_20260928.md)
на публичном F0154 прошёл с тремя `ABSTAIN` и нулём строк без экспертного
решения. Это не доказывает качество извлечения площадей.

Отдельный `INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE=v1` включает пять
`SPZU-029/032/033/035/036` строковых подсказок из подтверждённого
ПД/ГП текста. Он несовместим с другими review селекторами; Compose
передаёт настройку API, worker получает immutable release. Пока прошли
локальные проверки, [визуальный аудит](SITE_GP_CONTEXT_VISUAL_AUDIT_20260928.md)
и PostgreSQL suite. [Изолированный Compose](SITE_GP_CONTEXT_COMPOSE_20260928.md)
на публичном F0126 завершил 9/9 jobs и пять `ABSTAIN` без проверки
источника экспертом.

`INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE=v1` — отдельный opt-in профиль
для навигационных кандидатов соседства блоков на листах дорожной одежды
(`SPZU-032`) и ведомости МАФ (`SPZU-029`). Он не совместим с другими
review селекторами. Связь блоков в одну строку не подтверждена, количество
МАФ неизвестно, оба кода остаются `ABSTAIN`. Оригинал F0126 и границы
геометрии описаны в [семейной проверке](SITE_GP_TABLE_ROW_REVIEW_20260928.md).

`INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE=v1` отдельно включает
навигационные строки спецификаций ОВ для `IOS4-077/079` и `PPM-112`.
Три кода остаются `ABSTAIN`, строки расчётов и реестра изменений
помечаются отдельно; количественные значения и сопоставления не
утверждаются. [Аудит и границы](EQUIPMENT_SPEC_REVIEW_20260928.md).

`INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE=v1` включает отдельные
review-only подсказки для `KR-056/057/066`. Он не назначает марку
конкретному элементу и не утверждает фактическую огнезащиту.
[Семейная проверка](MATERIAL_CLASS_REVIEW_20260928.md).

`INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v1` отдельно включает
SHA-закреплённую конфигурацию подсказок для семи `AREA_PROGRAM` и 12
`DIMENSION_LAYOUT` кодов. Все они остаются `ABSTAIN`; поле показывает
только адреса строк в проверенном текстовом слое. Профиль должен быть
взаимоисключающим с остальными review-профилями, включая совпадающие
`SPZU-027` и `AR-042`. [Границы пакета](UNRESOLVED_CONFIG_REVIEW_20260928.md).

`INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v2` выбирает отдельный
SHA-закреплённый пакет для пяти `DOCUMENT_APPROVAL` и пяти
`SAFETY_COVERAGE` кодов. Значение `v1` и `v2` взаимоисключающи; оба
возвращают только подсказки со статусом `ABSTAIN`, без замечаний и
покрытия. [Предметный аудит и контракт](UNRESOLVED_CONFIG_V2_REVIEW_20260928.md).

`INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE=v3` выбирает отдельный
SHA-закреплённый пакет для семи `NETWORK_TOPOLOGY` кодов. `v1`, `v2` и
`v3` взаимоисключающи. Результат остаётся навигацией `ABSTAIN`, пока
не проверены ветви, элементы, источники и пара ПД/РД.
[Предметный аудит и контракт](UNRESOLVED_CONFIG_V3_REVIEW_20260928.md).

`INSPECTOR_LAYER_ASSEMBLY_REVIEW_PROFILE=v1` включает отдельный
review-only пакет для `SPZU-032`, `AR-044`, `ZU-125`. Он показывает
адреса заголовков и соседних блоков материала и толщины. `SPZU-032`
уже имеет предложения строк в отдельном `SITE_GP_TABLE_ROW` профиле;
новый пакет их не копирует. Ни один из трёх кодов не получает
типизированную толщину, факт или находку без проверки строк, участка,
источников и пары документов.
[Аудит исходных листов](NEXT_LAYER_ASSEMBLY_AUDIT_20260928.md).

`INSPECTOR_KR065_OPENING_REVIEW_PROFILE=v1` включает отдельный
review-only адресный просмотр подписей проёмов `KR-065` в РД/КР.
Номер и размер из текстового блока остаются сырой подписью;
контур, армирование, общий элемент и связь с ПД не установлены.
Результат всегда `ABSTAIN`, без находок и предметного coverage.
[Аудит исходных листов](STRUCTURAL_DETAIL_AUDIT_20260928.md).

Для homeserver с RTX 2080 SUPER добавлен отдельный [лёгкий профиль model probe](LOCAL_MODEL_PROBE_20260925.md): только проверка кеша Paddle, CPU OCR без tables/orientation и Bonsai на GPU. Он не является третьим полным deployment-профилем приложения и не меняет `laptop`/`server` release slots.

## Что проверить

1. `./infra/stack.sh <profile> config --quiet` и `preflight` проходят без ошибок; `up` автоматически повторяет preflight до скачивания тяжёлых images/weights.
2. Все init-контейнеры завершились с code `0`; runtime-сервисы имеют status `healthy`.
3. `./infra/smoke-providers.sh <profile>` выполняет настоящий PDF render, обе OCR-ветки, multimodal VLM completion, 1024-dimensional embedding, API/web health и pgvector `0.8.6`.
4. Тот же smoke доказывает, что каждый runtime container имеет ровно одну internal network и не может открыть исходящее соединение.
5. На server `gpu-admission-server` завершился с code `0`; GPU-контейнеры видят ровно один выбранный H100, нет OOM, swap storm и превышения profile budgets.
6. Перед `CONFIGURED` отдельно пройти adapter integration, RU/EN quality, evidence, security, load и soak gates.
