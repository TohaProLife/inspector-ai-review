# Локальные модели на реальных PDF: проверка 25 сентября 2026

На `homeserver` с RTX 2080 SUPER 8 ГБ запущен отдельный облегчённый [Compose-профиль](../../infra/docker-compose.local-model-probe.yml): CPU PDFium/PaddleOCR, CPU Qwen3-Embedding-0.6B и GPU Bonsai 2 27B. Он использует локальные веса. `document-model-verify` без сети сверил 47 файлов Paddle cache и SHA-256 профиля `0cfcf119e0a8aef3914526df935044eff6157fceafe17b8af9f79db7a7dbb8d8`; `qwen-model-verify` без записи в read-only cache проверил все 10 файлов Qwen по размерам и SHA-256 lock `8c2d4c196aca9d1ca46a22afba1b59bc24af3718d30c2a24b7aa073d30ef6a62`; Bonsai проверяет размеры и SHA своих GGUF при старте. Три runtime-сервиса имеют статус `healthy`; API основного приложения также отвечает HTTP 200. Модельные endpoints опубликованы только на loopback homeserver: документный `18084`, Bonsai `18082`, embeddings `18085`.

Профиль [`homeserver.json`](../../services/document-ai/profiles/homeserver.json) использует RU/Latin mobile recognizers, PP-DocLayout-M и detection, без табличной реконструкции и автоматического поворота листа. На листах `F0171` p.104 и `F0201` p.17 автоматический поворот ошибочно определял 180°: число строк OCR с confidence ≥0,7 было 23/172 и 79/631. После отключения поворота получены 106/158 и 368/631, распознаны названия листов и помещение `012`. Для действительно повернутых сканов нужен отдельный управляемый выбор ориентации.

Первый прогон исходного `F0201` p.50, у которого текстовый слой содержит только 7 символов, нашёл 122 OCR-строки и 122 прямоугольника; 115 строк имеют confidence ≥0,7. На итоговом образе `inspector-ai/document-ai:paddle3.2.1-cpu-v1` (image ID `sha256:fa3ea8ae024e7a0a2c00c55b3f404cab68cd6a9fdeaf5238e5c7485cf5a39628`) рендер занял 0,48 с, OCR 8,61 с, JSON-ответ 27 721 байт. Исправлены две реальные ошибки сериализации результата PaddleX (`Font`, `LayoutBlock`); служебные копии растра больше не передаются в JSON. До этого тот же ответ достигал около 280 МБ.

## Повторяемый запуск

Команды выполняются в выделенной копии `/home/freetok/Projects/inspector-ai-homeserver-smoke`, где `model-cache/` и исходные PDF уже проверены. Для другой машины можно задать абсолютный `MODEL_CACHE_ROOT`. Этот Compose-проект не меняет 12 контейнеров основного приложения.

```bash
docker compose -f infra/docker-compose.local-model-probe.yml config --quiet
docker compose -f infra/docker-compose.local-model-probe.yml up -d --no-build
docker compose -f infra/docker-compose.local-model-probe.yml ps -a
curl --noproxy '*' -fsS http://127.0.0.1:18084/health
curl --noproxy '*' -fsS http://127.0.0.1:18082/health
curl --noproxy '*' -fsS http://127.0.0.1:18085/health
```

`document-model-verify` и `qwen-model-verify` должны завершиться с кодом 0, три runtime-сервиса — стать `healthy`. `--no-build` предполагает уже подготовленные образы. Порты и имена Compose-проекта не пересекаются с core smoke. Qwen загружается из закреплённого [laptop lock](../../services/model-store/locks/laptop.json); для offline-проверки read-only снимка provisioner поддерживает `--verify-only`.

Одна команда проходит оригинальный PDF → проверку размера и SHA по `document_manifest.jsonl` → извлечение text layer → рендер страницы → OCR → локальную Bonsai → проверку цитат, OCR-координат и публичной метки:

```bash
python3 scripts/eval-local-public.py \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-checks datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl \
  --case-id TRAIN-0002 \
  --source F0171=dataset-smoke/F0171_raw.pdf \
  --source F0202=dataset-smoke/F0202_raw.pdf \
  --mode ocr-live \
  --document-url http://127.0.0.1:18084 \
  --model-url http://127.0.0.1:18082 \
  --ocr-artifacts-dir dataset-smoke/probes/compose-live \
  --report dataset-smoke/probes/TRAIN-0002-ocr-live-compose-bonsai.json
```

Скрипт допускает только `TRAIN_PUBLIC/INCLUDE`, не отправляет PDF на внешний API и добавляет публичную метку в отчёт после inference. Контрольные страницы берутся из публичной разметки: это регрессия на известных листах, не самостоятельный поиск нужных листов по всему объекту. Полные отчёты и OCR-файлы лежат только в закрытом каталоге `dataset-smoke/probes/` на homeserver.

## Поиск страниц до OCR

[`eval-retrieval-public.py`](../../scripts/eval-retrieval-public.py) сверяет три исходных PDF с manifest, извлекает текстовый слой всех 889 страниц, оставляет страницы с точным номером помещения, затем ранжирует кандидатов локальной Qwen3 Embedding отдельно для ПД и РД. В запросе только помещение и название параметра из публичного каталога. Страницы ответа и публичный verdict используются после ранжирования для расчёта позиции правильного листа. Так проверяется поиск внутри этих трёх исходных документов; сами документы выбраны из публичного набора заранее. Скан без читаемого текстового слоя может не пройти первичный фильтр.

```bash
python3 scripts/eval-retrieval-public.py \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-checks datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl \
  --case-id TRAIN-0001 --case-id TRAIN-0002 --case-id TRAIN-0006 \
  --source F0171=dataset-smoke/F0171_raw.pdf \
  --source F0201=dataset-smoke/F0201_raw.pdf \
  --source F0202=dataset-smoke/F0202_raw.pdf \
  --report dataset-smoke/probes/public-retrieval-qwen3-20260925.json
```

После поиска `eval-local-public.py --retrieval-report ... --mode ocr-live` берёт верхнюю страницу каждого этапа из отчёта поиска и проверяет ту же цепочку OCR → Bonsai без выбора страницы по публичной разметке. Отчёт помечает, сколько выбранных страниц совпало с публичными страницами ответа; ни одна стадия не создаёт finding в основном приложении.

Поиск обработал 73 кандидата за **1000,55 с** на Ryzen 5 2600 (лимит модели 4 CPU/4 ГБ). Позиции публично подтверждённых листов после ранжирования:

| Кейс | ПД | РД | Выбранные top-1 листы |
|---|---:|---:|---|
| `TRAIN-0001` | 3/10 | 3/10 | `F0171`:89 + `F0202`:15 |
| `TRAIN-0002` | 5/6 | 5/9 | `F0171`:11 + `F0201`:644 |
| `TRAIN-0006` | 3/5 | 13/33 | `F0171`:97 + `F0201`:363 |

В таблице числитель — ранг нужного листа, знаменатель — число кандидатов этого этапа. Все шесть листов из публичной разметки присутствуют среди кандидатов, но ни один не выбран top-1. Отчёт ранжирования SHA-256 `1eb9f6305521f5c98ee3e0c0996aff07a2364a68043ffd6b2b8c0747646ce27f` хранится в `dataset-smoke/probes/` на homeserver. Вывод: живой embedding endpoint работает, но текущий способ формирования кандидатов и запроса не готов для автоматического выбора пары страниц. Это три учебных кейса, не оценка скрытой выборки.

### Структурный отбор на homeserver

В тот же скрипт добавлен `--ranker structural`. После точного поиска номера помещения он поднимает листы со схемой или экспликацией выше технических приложений, а раздел РД определяет по титульным листам: `ОВ1` — вентиляция, `ОВ2.1` — отопление. Для запроса используются только номер помещения, код и название параметра из публичного каталога; публичные значения, страницы ответа и verdict открываются после ранжирования. Исходные PDF снова сверены с manifest. Это проверка отбора страниц, без OCR, VLM и результатов основного приложения.

```bash
python3 scripts/eval-retrieval-public.py \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-checks datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl \
  --case-id TRAIN-0001 --case-id TRAIN-0002 --case-id TRAIN-0006 \
  --source F0171=dataset-smoke/F0171_raw.pdf \
  --source F0201=dataset-smoke/F0201_raw.pdf \
  --source F0202=dataset-smoke/F0202_raw.pdf \
  --ranker structural \
  --report dataset-smoke/probes/public-retrieval-structural-20260925.json
```

Позиции нужных листов ПД/РД: `TRAIN-0001` — 6/1, `TRAIN-0002` — 1/2, `TRAIN-0006` — 1/1. Итог: top-1 **4/6**, top-2 **5/6**, top-6 **6/6** против top-1 **0/6** у embedding baseline. Это только три разные пары из публичной разметки, поэтому число нельзя считать оценкой качества на новых объектах. Отчёт homeserver: `dataset-smoke/probes/public-retrieval-structural-20260925.json`, SHA-256 `5a5c1c41769bce8336cb07879dc52bb62745490fd131c8db93bd2b5d77d94d37`. Следующий gate — автоматически локализовать помещение на top-6 листах, проверить связь выноски с нужной комнатой и сравнить области Qwen3-VL-4B с OCR/text layer; без этого ранжирование не создаёт finding.

Один вызов [`smoke-local-public-pipeline.py`](../../scripts/smoke-local-public-pipeline.py) выполняет поиск (либо принимает уже сохранённый отчёт), затем live OCR и Bonsai для каждого top-1 листа:

```bash
python3 scripts/smoke-local-public-pipeline.py \
  --manifest datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl \
  --public-checks datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl \
  --case-id TRAIN-0001 --case-id TRAIN-0002 --case-id TRAIN-0006 \
  --source F0171=dataset-smoke/F0171_raw.pdf \
  --source F0201=dataset-smoke/F0201_raw.pdf \
  --source F0202=dataset-smoke/F0202_raw.pdf \
  --retrieval-report dataset-smoke/probes/public-retrieval-qwen3-20260925.json \
  --output-dir dataset-smoke/probes/retrieved-live-20260925
```

При повторе можно добавить `--resume`: скрипт проверит SHA исходных PDF и привязку отчётов к SHA retrieval-отчёта, затем использует уже сохранённые OCR/model-артефакты. Первый прогон выполнил live OCR всех шести выбранных листов; для `TRAIN-0006` модельное сравнение повторено по этим же OCR-артефактам после исправления валидатора. Paddle возвращает координаты OCR как конечные дробные числа — валидатор теперь допускает их, сохраняя проверку границ изображения.

| Кейс | Выбранные листы из публичной пары | OCR-строки ПД/РД | Bonsai, с | Ответ | Подтверждённые цитаты |
|---|---:|---:|---:|---|---:|
| `TRAIN-0001` | 0/2 | 190 / 564 | 43,69 | `INVALID_RESPONSE`, ответ обрезан по 512 токенам | 0/0 |
| `TRAIN-0002` | 0/2 | 47 / 244 | 40,41 | `INSUFFICIENT_EVIDENCE` | 3/3 |
| `TRAIN-0006` | 0/2 | 195 / 96 | 33,68 | `INSUFFICIENT_EVIDENCE` | 4/4 |

`dataset-smoke/probes/retrieved-live-20260925/summary.json` имеет SHA-256 `b31e8d42a350d79c63d7c614032710701d4076568dff591210920d47c819161a`; шесть OCR-отчётов и три полных модельных отчёта сохранены рядом только на homeserver. Прохождение OCR и проверка цитат не компенсируют ошибку выбора источника. Для предметного результата необходимы структурный поиск листов/разделов и проверенный linking policy, затем повторное сравнение на релевантных изображениях. Из трёх публичных положительных кейсов ни один не обнаружен; эти данные не позволяют оценить скрытую выборку.

## Фактический результат

| Кейс | Пара страниц | OCR-строк | Bonsai, с | Вердикт | Подтверждённые цитаты | Публичная метка |
|---|---|---:|---:|---|---:|---|
| `TRAIN-0001` | `F0171`:104 + `F0201`:17 | 158 + 631 | 43,88 | `INSUFFICIENT_EVIDENCE` | 4/4, две с OCR bbox | `CONFIGURATION_MISMATCH` |
| `TRAIN-0002` | `F0171`:99 + `F0202`:17 | 229 + 673 | 53,56 | `INSUFFICIENT_EVIDENCE` | 2/2 | `MISSING_DESIGN_ELEMENT` |
| `TRAIN-0006` | `F0171`:88 + `F0201`:18 | 323 + 745 | 34,52 | `INSUFFICIENT_EVIDENCE` | 4/4 | `MISSING_DESIGN_ELEMENT` |

Первые два кейса повторены в режиме `ocr-live`; последний использовал заранее сохранённые OCR-результаты тех же проверенных PDF. `TRAIN-0001` через один процесс занял около 81 секунды (OCR 9,33 + 27,37 с, Bonsai 43,88 с; этапы выполнялись последовательно). `TRAIN-0002` через Compose занял около 95 секунд (OCR 12,19 + 28,95 с, Bonsai 53,56 с). Время зависит от нагрузки на общий homeserver. Три отказа на трёх положительных известных кейсах показывают, что текущая схема выбора страниц/промпт/Bonsai пока не даёт нужного предметного обнаружения. Они не дают оценки качества на скрытой выборке.

Все отчёты имеют `domainDecision=NOT_ACCEPTED_PROBE_ONLY`. Основной `analysis-release-v1` по-прежнему `SCAFFOLD/UNCONFIGURED`: его persisted DAG проверен на исходных PDF, но пока не вызывает эти endpoints, не выполняет поиск релевантных листов, linking и правила. В нём остаются 132 `UNSUPPORTED` и нет новых findings. Этот тест подтверждает рабочую локальную цепочку провайдеров и ограничение модели, а не завершённую предметную проверку приложения. Доступ к H100 ожидается только на финальной проверке организаторов; все текущие inference-тесты выполняются на homeserver с RTX 2080 SUPER.

## Проба визуального чтения без OCR-текста в запросе

На публичной паре `TRAIN-0001` отдельно проверена идея заменить OCR визуальным чтением. Исходные `F0171` p.104 и `F0201` p.17 ранее сверены с `document_manifest.jsonl`. Из листов при 100 dpi взяты фрагменты вокруг помещения `012`: ПД `(2300,170,3200,870)` и РД `(2300,2050,3250,3000)` в координатах растра. **Выбор фрагментов опирался на координаты прежнего OCR**, поэтому опыт проверяет визуальное чтение и сравнение, но не полностью самостоятельный поиск фрагмента без OCR. Публичный verdict в промпты не передавался; страницы выбраны по публичной разметке для регрессии.

В три вызова Bonsai передавались только изображения и инструкции, без текста PDF и OCR. При одиночном чтении модель распознала `012`, `Венткамера`, `012.1`, `Форкамера` на ПД за 30,55 с; на РД распознала `012` и две неуверенные подписи за 46,18 с. В обоих ответах список уверенно определённого оборудования пуст. При сравнении двух фрагментов модель вернула `INSUFFICIENT_EVIDENCE` за 78,13 с: привязать конкретные элементы ПД к РД не смогла. Это один известный положительный кейс, не показатель точности на всём наборе и не тест Qwen3-VL на H100.

Артефакты хранятся только на homeserver в `dataset-smoke/probes/visual-compare-20260925/`: два исходных растра, два фрагмента, одиночные ответы и `TRAIN-0001-crops-vision-only.json`. SHA-256 фрагментов: ПД `e258cf0ab593503e5491355e8c141a5f453c30a92a0059c28fb1045dd8cee11e`, РД `db01ab1416bd7d673d20433c8ed338a39b4ab7571fdd1b40307afaccc3f6efab`.

Практический вывод: визуальная модель полезна для локального чтения и анализа схем, но текущая Bonsai не подтвердила замену OCR или самостоятельное сравнение ПД/РД. Следующий A/B gate выполняется на homeserver с Qwen3-VL-4B: одинаковые публичные пары и crops, варианты «только изображение» и «изображение + OCR/text layer», проверка цитат, привязки к области, ложных находок и времени. H100 остаётся финальной проверкой переносимости образа и производительности у организаторов. До успешного gate токены и геометрия evidence остаются за PDF text layer/OCR, а VLM даёт проверяемые предложения по визуальной конфигурации.

## Qwen3-VL-4B на RTX 2080 SUPER: первый визуальный кандидат

Для дополнительного локального A/B на homeserver запущена `Qwen3-VL-4B-Instruct-GGUF` Q4_K_M ([официальная модель](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF)), revision `1cd86afb9a95c410a6038ab3b40d8b578c892266`. SHA-256 весов `66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a`, projector Q8_0 `30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d`; оба файла сверены после скачивания. Runtime `ghcr.io/ggml-org/llama.cpp:server-cuda` digest `sha256:1f4b9cf58982dd4d7cc497aea31b1a456ca9a3a1f94f527d317d3fdee0d60ab6`, локальный порт `18086`, исходный лимит 5 ГБ RAM и один GPU. В конце первого прогона занято 4516 MiB VRAM. Чтобы освободить RTX 2080 SUPER, остановлен **только** пробный контейнер Bonsai; основной API остался HTTP 200, Qwen `/health` — HTTP 200.

Проверены те же оригинальные `TRAIN_PUBLIC` PDF после повторной проверки SHA/размера по manifest. Публичные страницы и ручные crop-области здесь являются oracle-условием; это **не** проверка поиска листов из 889 страниц. В промпты не передавались `pd_value`, `rd_value`, `comparison_result` или закрытые ответы. Публичные метки `TRAIN-0002/0003` прочитаны только после inference для регрессии. Изображения и полные промпты/ответы лежат на homeserver в `dataset-smoke/probes/qwen-eval-20260925/`; детерминированная проверка создала `scoped-candidate-267-270.json` (SHA-256 `b115b7b4733a475ccf4450c762a302a98a8560cb34e2b515ef760f970ce0d203`).

На ПД `F0171` p.99 при 200 dpi модель дословно прочитала `Регулятор для системы "теплый пол" Multibox C/RTL` у помещений `267/270`. PaddleOCR на том же фрагменте независимо нашёл `"теплый пол"` (confidence 0,90), `Multibox C/RTL` (0,99) и `267,270` (0,99); при 100 dpi полная подпись была пропущена. В ограниченной областью проверке Qwen отметила вложенный красно-синий контур в ПД `267/270`, не отметила его в соседнем `277` и в областях РД `F0202` p.17 для `267` и `270`. На РД PaddleOCR при 200 dpi подтвердил `PRADO Universal` и номер `267`. После первого прогрева одиночные вызовы занимали около 1,4–4,5 с; первый парный вызов занял 61,36 с, эти разрозненные замеры не являются p95.

Для проверки границы поиска все 36 страниц `F0202` обработаны OCR при 100 dpi: 8882 строк, 36/36 без технических ошибок, отчёт `f0202-full-ocr/summary.json` SHA-256 `ba62fb8419a59d7c1eaed569c07b656ca9eb207cdb0a16de8bf63c70a919ff73`. Явных `Multibox C/RTL` или подписи тёплого пола поиск не нашёл. Номер `267` найден на p.17; на p.16 обнаружено только `267.1`. Из-за известного пропуска мелкой подписи при 100 dpi этот поиск **не доказывает** отсутствие системы на всех листах.

Отчёт классифицирует результат как `SCOPED_CANDIDATE`, `domainDecision=NOT_ACCEPTED_PROBE_ONLY`. Различие в конкретных фрагментах согласуется с двумя публичными положительными примерами, но не стало finding основного приложения. Прямой запрос Qwen «сравни пару» на p.104/p.17 дал ложный `MISMATCH`: модель неверно связала подпись помещения и оборудование. На p.99 общий crop ошибочно приписал систему тёплого пола соседнему `277`; только отдельный crop комнаты исправил это. Поэтому допуск требует автоматической локализации комнат/выносок, проверки пространственной привязки, полного scope поиска РД и повторения на независимых объектах. Серверная Qwen3-VL-8B на H100 и основной stage adapter всё ещё не тестировались.

## Автоматический поиск листа и границ помещения

На четырёх `TRAIN_PUBLIC` проверках `TRAIN-0002`–`0005` структурный поиск, без передачи страниц ответа в запрос, выбрал `F0171` p.99 первым листом ПД во всех четырёх случаях. `F0202` p.17 оказался в РД на местах 2, 1, 1, 1. Это четыре помещения двух групп на **одной паре документов**, а не четыре независимых объекта. Отчёт `dataset-smoke/probes/public-retrieval-heating-verified-20260925.json` на homeserver имеет SHA-256 `a5a3f76bbda3068a85ab96cd13330d3721757fc54db6103e08ae88f332b2aaa0`.

[`probe-room-localization-public.py`](../../scripts/probe-room-localization-public.py) сверяет PDF по размеру и SHA с `document_manifest.jsonl`, проверяет `TRAIN_PUBLIC/INCLUDE` и `object_id`, находит номер комнаты в текстовом слое, строит crop при 200 dpi и пытается замкнуть его четырьмя стенами. При полном прямоугольнике дополнительный детектор считает красные и синие горизонтальные полосы **только внутри** комнаты. В отчёте остаются SHA исходного PDF, координаты PDF/растра, SHA родительского и узкого crop. При неполных стенах результат `ROOM_RECTANGLE_UNRESOLVED`, а не отрицательный вывод.

На `F0171` p.99 все четыре ПД-комнаты получили замкнутую область и цветовой визуальный кандидат. Альтернативный ПД-лист p.85 такого кандидата не дал. Соседняя комната `277` на p.99 использована как пространственный контроль: внутри её собственного прямоугольника цветовой детектор дал `false`; это не публично размеченный отрицательный кейс. Для РД `F0202` p.17 прямоугольник не найден: геометрия плана открыта для текущего строгого алгоритма. Следовательно, отсутствие тёплого пола в РД **не доказано**. SHA отчёта локализации `8e53bed1af150a15845d426ad10f57cfd5793cf27cc987fbc61e124695a3717c`; SHA контроля `277` `8f02a6df3017b5b940a04b7a46aff7c60b0d6b073a9979399a0810ac39c5c57b`.

[`probe-room-vision-public.py`](../../scripts/probe-room-vision-public.py) передаёт Qwen только найденный прямоугольник комнаты, полный номер группы из текстового слоя и визуальный вопрос. Модель дала `nestedRedBlueLoop=true` и прочла `267, 270` либо `271, 272` во всех четырёх ПД-комнатах; ответы согласовались с независимым цветовым детектором. На комнате `277` ответ был `uncertain`, цветовой детектор `false`: ложного положительного вывода не создано. Для РД запрос к модели не выполнялся, поскольку прямоугольник отсутствует. Все отчёты `vision-TRAIN-0002-v4.json`–`vision-TRAIN-0005-v4.json` и `vision-CONTROL-277-v4.json` находятся в `dataset-smoke/probes/auto-room-pattern-20260925/`; каждый помечен `NOT_ACCEPTED_PROBE_ONLY`. Прогретые вызовы занимали примерно 0,86–1,04 с; это не замер p95.

Дополнительное A/B на тех же автоматических crops отделило зрительное чтение от подсказки. При `--hint-profile visual-only` номер **группы** не передавался в промпт: Qwen снова отметила контур в 4/4 узких ПД-областях, но полностью прочла `267, 270` или `271, 272` лишь в 2/4 ответах. Остальные 2 ответа получили `MODEL_OUTPUT_INVALID: ROOM_LABEL_NOT_EXACT`. На пространственном контроле `277` модель вернула `uncertain`. На широких `focus`-областях с текстовой подсказкой контур ПД найден в 3/4, один ответ `uncertain`; для РД все четыре ответа `uncertain`. Это показывает пользу узкой геометрии и необходимость независимого текстового слоя/OCR для номера помещения. Артефакты `vision-TRAIN-0002-visual-only-v5.json`–`vision-TRAIN-0005-visual-only-v5.json`, `vision-CONTROL-277-visual-only-v5.json` и `vision-TRAIN-0002-focus-v4.json`–`vision-TRAIN-0005-focus-v4.json` лежат рядом с первым прогоном. Повторные вызовы на одном документе не являются оценкой обобщения.

Контроль на другой публичной задаче `TRAIN-0001` (вентиляция, помещение `012`) показал границу алгоритма. Структурный поиск держал нужные листы ПД p.104 и РД p.17 в top-6/top-1. Автоматический поиск номера создал 10 crops из 12 кандидатов, но не смог замкнуть **ни одну** область четырьмя стенами. На ПД p.104 подпись стоит у схемы оборудования с открытыми линиями, а не внутри замкнутой прямоугольной комнаты. Отчёт `dataset-smoke/probes/auto-room-ventilation-20260925/localization.json` имеет SHA-256 `e387798eb3fdd456b76f94d56da79e220f52b549bd1e0f2af40095e1e25e7dd7`. Детектор цветного контура тёплого пола к вентиляции не применялся. Для таких листов нужен отдельный поиск выноски и связи оборудования с помещением; универсальность текущего прямоугольного локатора опровергнута.

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke
data_dir=$(find datasets/reference_methodology -type d -name data -path '*/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/*' -print -quit)
python3 scripts/eval-retrieval-public.py --manifest "$data_dir/document_manifest.jsonl" --public-checks "$data_dir/public_train_checks.jsonl" --case-id TRAIN-0002 --case-id TRAIN-0003 --case-id TRAIN-0004 --case-id TRAIN-0005 --source F0171=dataset-smoke/F0171_raw.pdf --source F0201=dataset-smoke/F0201_raw.pdf --source F0202=dataset-smoke/F0202_raw.pdf --ranker structural --report dataset-smoke/probes/public-retrieval-heating-verified-20260925.json
python3 scripts/probe-room-localization-public.py --manifest "$data_dir/document_manifest.jsonl" --public-checks "$data_dir/public_train_checks.jsonl" --case-id TRAIN-0002 --case-id TRAIN-0003 --case-id TRAIN-0004 --case-id TRAIN-0005 --retrieval-report dataset-smoke/probes/public-retrieval-heating-verified-20260925.json --source F0171=dataset-smoke/F0171_raw.pdf --source F0201=dataset-smoke/F0201_raw.pdf --source F0202=dataset-smoke/F0202_raw.pdf --top-k 2 --crop-profile focus --detect-room-rectangle --output-dir dataset-smoke/probes/auto-room-pattern-20260925
python3 scripts/probe-room-vision-public.py --manifest "$data_dir/document_manifest.jsonl" --localization-report dataset-smoke/probes/auto-room-pattern-20260925/localization.json --case-id TRAIN-0002 --input-profile room-only --hint-profile visual-only --report dataset-smoke/probes/auto-room-pattern-20260925/vision-TRAIN-0002-visual-only-v5.json
```

У пробного Qwen-контейнера дважды сработал OOM при лимите 5 ГБ: на широком изображении 200 dpi и после серии запросов. Для нового прогона вход модели ограничен до 768 пикселей по длинной стороне, а память **только пробного контейнера** поднята до 6 ГБ (`docker update --memory 6g --memory-swap 10g inspector-ai-qwen3vl4b-eval`). После пяти последовательных вызовов контейнер `healthy`, Qwen `/health` и основной API `/api/health` ответили HTTP 200. Длительная стабильность пока не проверена.

26 сентября при проверке переноса шаблона контейнер повторно завершился с `OOMKilled=true`, `ExitCode=137` даже при лимите 6 ГБ. После запуска того же пробного контейнера одна повторная визуальная проверка завершилась за 57,743 с, `/v1/models` снова ответил; на хосте swap 4 ГБ был заполнен. Это ограничение устойчивости локальной RTX 2080 SUPER конфигурации. Долгий пакет VLM-вызовов на текущем homeserver нельзя считать проверенным; шаблонный CPU-локатор работает отдельно от модели.

Следующий gate: локализовать открытые помещения РД, пройти весь связанный раздел отопления при достаточном разрешении, подтвердить привязку символа/подписи к целевой комнате и только затем строить проверяемое сравнение ПД/РД. В текущем `analysis-release-v1` нет настроенного provider slot и stage adapter для этих сигналов; поэтому `132 UNSUPPORTED` сохраняются. H100 доступен лишь при финальной проверке организаторов.
