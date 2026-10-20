# Проверка машинного JSON перед подачей

## Публичный контракт

Используется предоставленная участникам schema `datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/submission_schema.json`. Её неизменённые байты скопированы в [`scripts/schemas/machine-submission-v1.schema.json`](../../scripts/schemas/machine-submission-v1.schema.json): 2141 байт, SHA-256 `75c58bef6b580528e7e4af8e4fdcdf5a5d40599b8966dae90df38b3a5f04a8d7`. Это JSON Schema Draft 2020-12. Закрытые ответы и scorer для проверки не нужны.

[`validate-matrix-submission.py`](../../scripts/validate-matrix-submission.py) проверяет сохранённые байты локально, без сетевого разрешения schema. Хеш копии schema закреплён в validator; изменение schema не может незаметно ослабить проверку. В отчёт входят SHA-256 и размер проверенного JSON, хеш schema, ошибки с JSON Pointer и отдельная согласованность публичных ссылок.

```bash
python3 scripts/validate-matrix-submission.py output/machine-submission.json
python3 scripts/validate-matrix-submission.py output/machine-submission.json \
  --require-official-ids --report output/machine-submission.validation.json
```

Зависимость — `jsonschema`; она уже закреплена в `scripts/requirements-local-scorer.txt`. Можно использовать Python окружения worker: `services/worker/.venv/bin/python`. Validator не запускает scorer и не читает разметку.

Коды завершения: `0` — выбранные проверки пройдены; `1` — JSON/schema или обязательная согласованность публичных ссылок не пройдена; `2` — ошибка чтения, зависимости или закреплённого контрольного хеша. `--report` сохраняет тот же JSON отчёта, который выводится в stdout. Повторяющиеся ключи JSON, NaN/Infinity и некорректный UTF-8 отвергаются.

## Идентификаторы и fallback

[`resolveMatrixSubmissionIdentity`](../../apps/api/src/matrix-submission-identity.ts) разрешает официальные идентификаторы по **точному SHA исходного файла и заявленной стадии**. Имя загруженного файла и внутренний UUID не являются основанием для такого сопоставления. Все разрешённые источники должны относиться к одному публичному объекту. Неизвестный SHA, несовместимая стадия или смесь объектов оставляют внутренний object ID и исходные application source IDs для всего экспорта.

Публичная таблица [`public-source-id-map-v1.json`](../../services/worker/rules/public-source-id-map-v1.json) происходит из manifest участников; её канонический SHA-256 — `124f43c884de67f1a56bb0a65de693626e93125fb7589790f4624e29b09075fa`. Смешанный документ `RD_ID_MIXED` разрешён для ссылок РД и ИД, но не ПД. Это не заменяет определение стадии отдельной страницы и проверку области конкретного наблюдения.

Проверенные оригиналы Новослободской:

| Официальный ID | Стадия | SHA-256 |
| --- | --- | --- |
| F0101 | PD | `01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54` |
| F0136 | RD | `cb4929c8a0f069a325ba16991767f26ba3c43a521e8052bad55c803b9e89fa5b` |
| F0002 | ID | `1ff8cccb7e104f0ef22223af31350f9c8d7956c4df33a537f6c5e5a96c881b2e` |

При точном сопоставлении выходной объект — `OBJ-NOVOSLOBODSKAYA`. `buildMatrixSubmission` берёт `M-NNN` из каталога, сохраняет отдельные `pd_value`, `rd_value`, `id_value`; при РД–ИД ожидаемое значение попадает в `rd_value`. Неопределённая стадия не становится допустимой ссылкой PD/RD/ID.

## Что подтверждает проверка

`schemaValid=true` подтверждает форму предоставленной schema. Она допускает произвольные строки object/file/parameter ID и пустой массив evidence, поэтому внутренние fallback ID могут быть формально допустимыми. Флаг `--require-official-ids` дополнительно требует известный публичный объект и соответствие каждого file ID его объекту и стадии. Эти результаты сохраняются раздельно: JSON может пройти schema и не пройти публичные ссылки.

Сохранённый формат не содержит SHA исходных PDF. Поэтому validator сообщает `originalSourceShaVerified=false`: по одному JSON нельзя заново подтвердить происхождение документа или корректность исходного runtime mapping. Его проверяет API при разрешении исходных загруженных байтов. Страница выше фактического числа страниц, верность значения, область элемента, качество evidence и предметная правильность заключения требуют отдельных source/rule проверок; публичная schema их не устанавливает.

Замороженный generic export пока сохраняет `COMPARISON_IMPOSSIBLE` для violation/protocol status. Положительное детерминированное условие и ручное решение не подменяют некалиброванную машинную вероятность. Пустое evidence при отсутствии сравнимой пары не заполняется вымышленными ссылками.

## Проверенный срез

`apps/api/test/matrix-submission-identity.test.ts`: **7 tests passed**. Проверены точные SHA/stage для F0101/F0136/F0002, fallback при несовпадении SHA/стадии и смешении объектов, смешанная РД/ИД, поля значений трёх пар стадий, официальные evidence ID, сохранённые байты exporter против offline schema, некорректные поля JSON и отдельные ошибки публичной ссылки.

Pure export совместной реальной пробы ПД/РД/ИД Новослободской: `/tmp/matrix-novoslobodskaya-submission.json`, **72 checks, 20494 байта**, SHA-256 `26269cebe681ee553184d55bd221ef374c02a81172d0b03c6c307ef5ac73ae53`. Проверка с `--require-official-ids` прошла, отчёт — `/tmp/matrix-novoslobodskaya-submission-validation.json`. У этой пробы нет сравнимых пар и поэтому нет evidence refs в checks; два исходных наблюдения остаются в execution artifact. Это не результат предметной оценки качества и не подтверждение полноты объекта. Durable API export и байты, выбранные для подачи, следует проверить той же командой отдельно.
