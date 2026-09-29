# Visual V6 для серверного H100

`red-vector-proposals-v6` — отдельный opt-in release для локальных визуальных подсказок к максимум двум уже сохранённым геометрическим предложениям на PDF. Он не классифицирует все объекты листа, не устанавливает отсутствие радиаторов, не создаёт findings и не повышает coverage. V4 остаётся профилем по умолчанию; V5 с Qwen3-VL-4B GGUF продолжает читаться как прежний immutable release.

## Модель и provenance

- Серверный endpoint: `http://vlm:8000/v1` внутри `provider-runtime`; публичный API запрещён. V6 отвергает другие адреса и отправляет `model=inspector-qwen3-vl-8b-fp8`. Успешным ответом считается только JSON с тем же точным полем `model`.
- Источник весов: `Qwen/Qwen3-VL-8B-Instruct-FP8`, revision `9cdc6310a8cb770ce18efaf4e9935334512aee45` в [`server.json`](../../services/model-store/locks/server.json). SHA-256 всего lock: `e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879`. Lock перечисляет размеры и SHA-256 всех файлов, включая tokenizer/config и два safetensors shard; их SHA дополнительно записаны в V6 profile. GGUF projector у этой модели нет и V6 его не заявляет.
- Model-store проверяет locked файлы до старта vLLM; volume модели подключён read-only. Release фиксирует ожидаемый lock и model ID. Проверка HTTP model ID подтверждает маршрутизацию к ожидаемому имени сервиса, но сама по себе не является криптографическим доказательством загруженных весов.
- Профиль, prompt, выбор предложений, ограничение crop до 768 px, версия адаптера и hash профиля сохраняются в immutable release/result. V6 не переписывает V5 hash и не использует его поля `modelWeightsSha256`/`modelProjectorSha256`.

## Семантика ответа

`RADIATOR` сохраняется как `RADIATOR_HINT` только для выбранного crop. `ABSTAIN` остаётся воздержанием. Ответ `OTHER` сохраняется с SHA-256 ответа, но превращается в `ABSTAIN/MODEL_OTHER_UNTRUSTED`: на локальных чертежах более лёгкая модель давала ложный `OTHER` для областей с PRADO и красной геометрией. Ошибка HTTP, неверный `model`, таймаут и недоступный endpoint получают отдельный reason code и воздержание. Ни один из этих ответов не является отрицательным свидетельством для правила или полного листа.

## Включение и проверка

В серверном `.env.server` для **новых** NORMAL-run выбрать `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002` либо `PILOT_PZ002_PZ017` и явно `INSPECTOR_VISUAL_PROFILE=V6`. `infra/server.env.example` сохраняет V4. Серверный Compose передаёт `VISUAL_VLM_BASE_URL=http://vlm:8000/v1` только worker; общая инфраструктура уже запускает Qwen3-VL-8B FP8 через vLLM на одном выделенном GPU. Выполнить `./infra/stack.sh server config --quiet` перед запуском. После запуска использовать только разрешённый `TRAIN_PUBLIC` исходник и аутентифицированный read:

```bash
python3 scripts/smoke-visual-proposals.py \
  --credentials-file /path/to/credentials \
  --check-id CHK-... \
  --public-manifest /path/to/document_manifest.jsonl \
  --public-source-id F0150 \
  --expected-proposals 2 \
  --expected-pages 614 \
  --expected-visual-version visual-proposal-analysis-v6 \
  --expected-vlm-observations 2 \
  --require-vlm-response
```

Числа примера отражают предыдущий локальный scan F0150 и подлежат сверке с новым run. `--require-vlm-response` требует хотя бы один фактический ответ (`MODEL_RESPONSE`, `MODEL_ABSTAIN` или `MODEL_OTHER_UNTRUSTED`); один лишь завершённый stage с `ENDPOINT_NOT_CONFIGURED` не проходит этот smoke. Отдельно проверить состояние run, сохранённый artifact hash и отображение crop в UI. Точность класса и производительность H100 пока не измерены на стенде.
