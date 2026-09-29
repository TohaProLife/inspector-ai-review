# Развёртывание Bonsai 2 27B для laptop-профиля

Версия 1.1, 19 сентября 2026 года. Этот runbook поднимает локальный OpenAI-compatible VLM endpoint. Он не переводит provider slots приложения в `CONFIGURED`: adapters и immutable release manifest остаются отдельным этапом.

## Что упаковано

| Компонент | Docker image | Назначение |
|---|---|---|
| Model provisioner | `inspector-ai/bonsai-model-init:2-27b-v1` | Загружает или импортирует закреплённые artifacts, проверяет размер и SHA-256, заполняет volume |
| CUDA runtime | `inspector-ai/bonsai-runtime:prism-b10685-cuda12.4-v1` | PrismML `llama-server`, NVIDIA CUDA 12.4, Linux x86_64 |

Runtime закреплён на `PrismML-Eng/llama.cpp` release `prism-b10685-7dffb15`, commit `7dffb158de30ebb8ef9d64f33c6b0b2d7c1e6313`. Model lock: [`services/bonsai/artifacts.lock.json`](../../services/bonsai/artifacts.lock.json). Profile: [`services/bonsai/runtime-profile.json`](../../services/bonsai/runtime-profile.json).

Weights не входят в runtime image. Init-container один раз помещает `5,946,648,928`-байтный `PTQ1_0` и `629,246,976`-байтный Q8 projector в named volume. Повторный запуск только проверяет уже существующие файлы. Сломанный или подменённый файл не допускается к runtime.

## Требования

CUDA-профиль:

- Linux x86_64 или Docker Desktop/WSL2 с Linux containers;
- NVIDIA GPU с минимум 8 GiB VRAM;
- NVIDIA driver, совместимый с CUDA 12.4, и NVIDIA Container Toolkit;
- минимум 14 GiB system RAM, 20 GiB свободного диска перед первым provisioning; рекомендуется 40 GiB для image cache и обновлений;
- Docker Engine 24+ и Docker Compose v2.30+; runtime `nvidia` должен быть зарегистрирован через NVIDIA Container Toolkit. Compose ограничивает видимую карту переменной `LAPTOP_GPU_DEVICE`.

## Быстрый запуск CUDA

Из корня repository:

```bash
./infra/stack.sh laptop up -d --build bonsai-vlm-cuda
```

`bonsai-model-init` запустится как dependency, скачает только закреплённые файлы и завершится. `bonsai-vlm-cuda` стартует после успешной проверки artifacts.

Проверка:

```bash
./infra/stack.sh laptop ps
./infra/stack.sh laptop exec -T bonsai-vlm-cuda bonsai-smoke
```

Host endpoint публикуется только на `127.0.0.1:8081`:

```text
http://127.0.0.1:8081/v1/chat/completions
```

Внутри Compose workers используют `http://vlm:8080/v1`.

## Полный application stack

После успешного provider smoke:

```bash
./infra/stack.sh laptop up -d --build
```

Это поднимает текущие PostgreSQL/RabbitMQ/API/web/workers и Bonsai sidecar. Наличие healthy VLM endpoint пока не означает выполненный анализ: release остаётся `SCAFFOLD`, а `METADATA_EXTRACTOR`/`ENTITY_EXTRACTION_MODEL` — `UNCONFIGURED` до реализации adapters и qualification.

## Offline/import из локального mirror

В каталог импорта заранее положить ровно четыре файла из artifact lock. Затем:

```bash
./infra/stack.sh laptop run --rm \
  -e BONSAI_IMPORT_DIR=/import \
  -v /absolute/path/to/bonsai-artifacts:/import:ro \
  bonsai-model-init
```

Provisioner копирует файлы в volume только после проверки точного размера и SHA-256. После импорта CUDA runtime можно запускать без Internet. `bonsai-vlm-*` подключён только к `provider-runtime`, помеченной `internal: true`; downloader подключён к отдельной `artifact-download` сети и завершается до runtime.

Для корпоративного mirror можно переопределить только базовый URL:

```bash
BONSAI_MODEL_BASE_URL=https://mirror.example/models/bonsai/6ed5e12b \
./infra/stack.sh laptop run --rm bonsai-model-init
```

Hashes остаются upstream-locked; mirror не может подменить bytes.

### Полностью air-gapped host

На машине с Internet сначала собрать и экспортировать нужные images:

```bash
./infra/stack.sh laptop build bonsai-model-init bonsai-vlm-cuda
docker save \
  inspector-ai/bonsai-model-init:2-27b-v1 \
  inspector-ai/bonsai-runtime:prism-b10685-cuda12.4-v1 \
  -o bonsai-laptop-cuda-images.tar
```

На целевой машине выполнить `docker load -i bonsai-laptop-cuda-images.tar`, импортировать четыре model artifacts из локального каталога командой выше, затем запустить runtime с `--no-build`.

## Настройки laptop-профиля

| Variable | Default | Ограничение |
|---|---:|---|
| `VLM_PORT` | `8081` | Host port; `BONSAI_PORT` внутри container всегда `8080` |
| `BONSAI_CONTEXT_SIZE` | `8192` | `1024..262144`; увеличение требует memory qualification |
| `BONSAI_MAX_OUTPUT_TOKENS` | `2048` | Общий response budget |
| `BONSAI_IMAGE_MAX_TOKENS` | `4096` | Для плотных документов; отправлять crops/tiles, не целый A0 |
| `BONSAI_BATCH_SIZE` | `512` | Уменьшать только новым profile/config hash после OOM |
| `BONSAI_UBATCH_SIZE` | `128` | Не больше batch size |
| `BONSAI_THREADS` | `8` | CPU threads, включая CPU-resident projector |
| `BONSAI_VERIFY_SHA256_ON_START` | `1` | Не отключать в release |

Жёстко зафиксированы: `parallel=1`, `mmproj` в system RAM, `temperature=0`, `seed=20260918`, `PTQ1_0`, Q8 projector. Tool calls не передаются. Images должны приходить как bounded local bytes/data URL от adapter; внешние URLs запрещены.

## Остановка и удаление

Остановить containers, сохранив model volume:

```bash
./infra/stack.sh laptop down
```

Удаление volume `inspector-ai-laptop_bonsai-models` удалит скачанные weights и потребует повторного provisioning. Не использовать `down -v`, если weights нужно сохранить.

## Что проверить

1. `bonsai-model-init` завершился с кодом `0`; lock SHA указан в log.
2. `bonsai-vlm-cuda` имеет status `healthy`.
3. `bonsai-smoke` получает реальный `/v1/chat/completions` response.
4. Runtime container имеет только сеть `provider-runtime`; скачивание при inference невозможно.
5. `nvidia-smi`/`docker stats` показывают отсутствие OOM/swap storm на целевом устройстве.
6. Перед переводом slots в `CONFIGURED` отдельно пройти RU/EN quality, schema, evidence, VRAM и soak gates из provider selection.
