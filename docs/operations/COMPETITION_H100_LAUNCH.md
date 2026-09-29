# Запуск конкурсного профиля на H100

Для конкурсного запуска нужны семь явных выборов **в существующем `infra/.env.server`**: `PILOT_PZ002_PZ017`, OCR layout `v4`, визуальные подсказки `V6`, OCR heat review `v1`, fact family review `v1`, 47-code candidate preview `v1` и candidate observations `v1`. Общий `server.env.example` намеренно оставлен с безопасными `SCAFFOLD/v1/V4`; четыре review aid там выключены. Команда `stack.sh server init` создаёт `.env.server` только при его отсутствии и не обновляет старый файл.

Этот профиль рассчитан на **один выделенный H100 80 ГБ**. Физический сервер может иметь два GPU, но Docker должен передать каждому GPU-контейнеру ровно выбранный `SERVER_GPU_DEVICE`. Драйвер NVIDIA ставится на хосте; образ содержит CUDA runtime и зависимости приложения.

## Подготовить существующий env без смены секретов

В корне проекта выполните:

```bash
./infra/stack.sh server init
python3 - <<'PY'
from pathlib import Path
import os
import re
import tempfile

path = Path(os.environ.get('INSPECTOR_ENV_FILE', 'infra/.env.server'))
updates = {
    'INSPECTOR_ANALYSIS_PROFILE': 'PILOT_PZ002_PZ017',
    'INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE': 'v4',
    'INSPECTOR_VISUAL_PROFILE': 'V6',
    'INSPECTOR_OCR_HEAT_ROW_PROFILE': 'v1',
    'INSPECTOR_FACT_FAMILY_PROFILE': 'v1',
    'INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE': 'v1',
    'INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE': 'v1',
}
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
for key, value in updates.items():
    matching = [i for i, line in enumerate(lines) if re.match(rf'^\s*{key}\s*=', line)]
    if len(matching) > 1:
        raise SystemExit(f'duplicate selector: {key}')
    if matching:
        lines[matching[0]] = f'{key}={value}\n'
    else:
        lines.append(f'{key}={value}\n')
fd, temporary = tempfile.mkstemp(prefix='.env.server.', dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.writelines(lines)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
```

Скрипт меняет только семь ключей; все другие строки, включая секреты и `SERVER_GPU_DEVICE`, остаются в файле. Перед запуском задайте `SERVER_GPU_DEVICE` как **один** индекс (`0` или `1`) либо один UUID `GPU-...`, соответствующий выделенному организаторами GPU. Не используйте `all` или список устройств. Если `INSPECTOR_ENV_FILE` указывает на другой файл, правьте именно его и передайте тот же путь проверке.

## Проверка перед стартом

```bash
python3 infra/check-competition-profile.py
./infra/stack.sh server preflight
./infra/stack.sh server config --quiet
```

Guard читает фактический `.env.server` (или `INSPECTOR_ENV_FILE`) и **итоговый** `docker compose config`: проверяет семь профилей API, локальный адрес `http://vlm:8000/v1`, точное имя `inspector-qwen3-vl-8b-fp8`, команду vLLM, SHA-256 серверного model lock, подключение volume текстового/OCR кеша к правильным очередям и единственный выбранный GPU во всех GPU-сервисах. Он не выводит содержимое env или Compose, поскольку там есть секреты. Статическая проверка не подтверждает, что GPU действительно выделен контейнеру или что модель загрузилась.

`infra/stack.sh server preflight` проверяет ресурсы хоста. Если на общем GPU уже занята значительная память, `gpu-admission-server` может отказать в запуске: он сохраняет бюджет для VLM и document-ai. Нужен свободный слот или согласование с организаторами, а не снижение порога без измерений. На стенде проверяющие могут запускать образы одновременно и повторно.

## Запуск и runtime smoke

```bash
./infra/stack.sh server up -d --build
python3 infra/check-competition-profile.py --running
./infra/smoke-providers.sh server
./infra/stack.sh server ps
```

`--running` запускает `nvidia-smi` **внутри** `document-ai-server` и `qwen-vlm-server` и требует ровно один видимый GPU в каждом. `smoke-providers.sh` проверяет API, рендер PDF, OCR, фактический ответ локальной VLM, embedding и изоляцию провайдеров. При ошибке изучайте журналы сервисов локально: не публикуйте `.env.server`, сырую конфигурацию Compose или полный ответ API с секретами.

Затем создайте новый NORMAL-run только по разрешённому источнику `TRAIN_PUBLIC` с проверенной редакцией, статусом согласования и разделом чертежа. Проверьте сохранённые результаты, crop и `GET /api/checks/:id/pilot-results`: `candidateFamilyPreview` должен содержать ровно 47 строк `ABSTAIN`, а `candidateFamilyObservations` — 47 строк `REVIEW_ONLY` и адресные наблюдения из тех же исходных текстовых блоков. При отсутствии подтверждённых источников наблюдений может быть ноль. Эти записи не добавляют findings и не увеличивают parameter coverage. Отсутствие метки не доказывает отсутствие элемента на чертеже. Пример ограниченной проверки V6 есть в [VISUAL_V6_H100_PROFILE.md](VISUAL_V6_H100_PROFILE.md). Старые immutable releases не меняют профиль от редактирования `.env.server`; нужен новый run. `V6` даёт подсказки максимум по двум выбранным областям, а OCR `v4` ограничен двумя страницами на run. Это не полное покрытие всех чертежей или параметров.

На homeserver новый v3 run `CHK-1D9443FD` завершил 10/10 jobs; сохранённый OCR artifact имеет SHA-256 `3b0865824b1f919eaa23a8d53d5232977989e70144f2b53b25357c16ed912e99`. [Независимая сверка исходных PDF и рендера](../../output/bounded-ocr-v3-20260927/source-render-verification.json) (SHA-256 отчёта `a777a6e2ec1939f7d349922e7cf2cb2cae3f14f58caef239ba7d696af267505c`) подтвердила `SOURCE_RENDER_SCOPE_VERIFIED`: F0201 p.7 и p.8 совпали по выбору, геометрии и PNG-хешам; F0150 получил ноль предметных кандидатов. `ocrLineTextVerified=false`: правильность распознанных строк требует отдельного экспертного просмотра. Это доказательство homeserver-прогона на `TRAIN_PUBLIC`, не испытание H100.

На H100 пока **не проводились** проверка инференса, оценка точности и замер времени всего пайплайна. Успешный config guard и локальные тесты не являются таким подтверждением. До конкурсной подачи нужен реальный GPU smoke на доступном H100 и разбор результатов на `TRAIN_PUBLIC`; `TEST_HIDDEN` и закрытые ответы не используются для настройки.

Для показа ревьюерам трёх разрешённых PDF без логина после запуска стенда выполните [подготовку публичных примеров](PUBLIC_REVIEW_VISITOR_20260929.md). Она проверяет SHA исходников, сохраняет immutable runs и добавляет ровно три ID в текущий `infra/.env.server`; затем API нужно пересоздать. Это отдельная настройка гостевого просмотра и не меняет H100 GPU/модельный профиль. На новом стенде с пустыми volumes подготовку надо повторить.

27.09.2026 разрешённая конфигурация с новым `candidateFamilyObservations=v1`
проверена через фактический `docker compose config` на временной копии
`.env.server`: `competition profile: PASS (resolved server profiles, VLM routing/model, single-GPU selection)`.
Исходный env и секреты не менялись, контейнеры server-профиля не запускались.
Это подтверждает только сборку конфигурации и выбор одного GPU, не H100 runtime.

После добавления кешей guard повторно прошёл на временном env с семью
конкурсными селекторами. Новая проверка подтверждает в итоговом Compose:
`document-worker` получает `text-layer-cache`, а `worker` и
`extract-worker` получают общий `ocr-page-cache` с серверным профилем OCR.
Она не проверяет точность OCR и реальную производительность H100.

28.09.2026 выбор OCR обновлён до v4 после
[сквозного homeserver-прогона F0153](BOUNDED_OCR_V4_TITLE_RECOVERY.md):
повреждённый титул p.1–2 прошёл OCR, сохранение и независимую сверку
исходного PDF и рендера. Лимит двух страниц, требования к одному GPU и
отсутствие подтверждённых findings не изменились. Это подтверждение
совместимости логики API/worker на homeserver; H100 runtime остаётся
непроверенным.
На временном env с семью v4/V6 селекторами `infra/check-competition-profile.py`
вернул `PASS` для итогового `docker compose config`, маршрутов моделей,
кешей и выбора одного GPU; тесты guard прошли 7/7. Действующий
`infra/.env.server` и его секреты при этой проверке не менялись.
