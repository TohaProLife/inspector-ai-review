# Локальный контракт оценки и сопоставления ответов

29 сентября 2026. Основа формата — выданный участникам `submission_schema.json`, побайтовая копия в [`schemas/official-submission-20260811.schema.json`](../../schemas/official-submission-20260811.schema.json), SHA-256 `75c58bef6b580528e7e4af8e4fdcdf5a5d40599b8966dae90df38b3a5f04a8d7`. Исполняемого scorer или письменной политики matching среди доступных документов нет. Ниже явно **локальная политика `LOCAL_SCORER_V1`**, не обещание организаторской оценки.

## Вход

Внешняя оболочка [`local-evaluation-envelope-v1.schema.json`](../../schemas/local-evaluation-envelope-v1.schema.json) фиксирует `runId`, `mode=NORMAL`, `sealed=true`, SHA исходного манифеста и `submission`. Поле `submission` проверяется неизменённой схемой организаторов: `object_id`, `checks[]`; каждый check содержит `parameter_code`, `location`, `violation_label` и `evidence[]` из `{stage,file_id,pdf_page_number}`. Подсказки `REVIEW_CANDIDATE` и `DEMO_SEED` отклоняются. `mode` и `sealed` во входном JSON остаются **утверждениями поставщика файла**: CLI не может независимо доказать происхождение frozen machine output из приложения. В текущем API официальный endpoint возвращает `INCOMPLETE_ANALYSIS` для неполного NORMAL run; scorer не обходит этот блок.

Scorer принимает только строки манифеста `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN`, только gold `TRAIN_PUBLIC/PUBLIC_TRAIN_LABEL`. До matching для каждого упомянутого PDF независимо сверяются размер и SHA исходных байтов; проверяются объект, стадия и физический номер страницы. Для `VIOLATION_PRESENT` и `NO_VIOLATION` нужны локаторы обеих стадий ПД и РД. Неизвестный файл, закрытая метка, дублированный локатор или неверная страница делают весь вход недействительным. `MISSING_DOCUMENT` и `COMPARISON_IMPOSSIBLE` считаются abstention в отчёте, даже если они валидны по схеме.

## Локальный matching

Атомарный положительный check совпадает только при равенстве `object_id`, `parameter_code`, `location`, метки `VIOLATION_PRESENT` и **полного множества** `(stage,file_id,pdf_page_number)` в evidence. Нормализация location: Unicode NFC, trim, схлопывание пробелов, верхний регистр; ведущие нули, знаки и числа не изменяются. Дополнительная страница, другой файл или частичная пара ПД/РД не засчитываются. Совпадения распределяются один к одному максимальным паросочетанием: повтор ответа не повышает TP. Группа замечания засчитывается лишь тогда, когда совпали все её атомарные checks. Для публичных отрицательных меток `NO_VIOLATION` применяется такое же однозначное сопоставление; сейчас таких открытых меток **0**.

Непарные `VIOLATION_PRESENT` с известным `(code,location)` показываются как `fpKnownKeys` — диагностические ошибки matching, а не статистически оценённые false positives; на неизвестных публичной разметке ключах — `unlabeledPredictions`, не автоматически false positive. `recall=TP/публичные positives` доступен как учебная метрика. Видимые метки не объявлены полным множеством контрольных точек, поэтому `precision`, `F1`, `FPR` всегда равны `null` даже при появлении отдельных открытых negatives. Это не итоговый F1 конкурса и не оценка скрытой выборки. Совпадение полной пары страниц здесь является строгим **локальным предположением**; организаторы могут выбрать иную политику допусков, location, лишних evidence, `FREE`, `MISSING_DOCUMENT` и `NO_VIOLATION`.

## Воспроизведение

```bash
python3 -m pip install -r scripts/requirements-local-scorer.txt
python3 -m unittest discover -s scripts/tests -p test_local_scorer.py -v
python3 scripts/local_scorer.py \
  --predictions output/local-scorer-20260929/empty-public-predictions-203.json \
  --manifest output/local-scorer-20260929/public-manifest-203.jsonl \
  --originals output/review-candidates-20260928/originals \
  --report output/local-scorer-20260929/empty-public-report-203.json
```

Пустой диагностический baseline на 10 открытых положительных checks даёт `TP=0`, `FN=10`, `recall=0`, `0/4` полных групп и `precision/F1/FPR=null`. Это **синтетический пустой вход**, а не предсказания работающего продукта. Для запуска нужны три оригинальных разрешённых PDF, указанных в gold, с SHA из публичного манифеста. `scripts/tests/test_local_scorer.py` отдельно проверяет дубли, полную группу, неверную страницу, нормализацию location, abstention, запрет подсказок и DEMO_SEED, подмену PDF, закрытый gold и однозначное сопоставление negatives.

В архивах проверяющих `source/datasets/.../document_manifest.jsonl` содержит только 203 разрешённые строки, и `evidence/local-scorer-empty-public-envelope.json` привязан именно к SHA этих 203 строк. При воспроизведении из распакованных архивов передайте `--predictions evidence/local-scorer-empty-public-envelope.json --originals evidence/originals`; остальные пути по умолчанию находятся внутри `source/`. Служебный `runId` пустого baseline не является реальным run приложения.

## Нерешённая граница сдачи

Формат submission известен и воспроизводим; организаторский scorer и его matching недоступны. Приложение ещё не производит независимый frozen machine submission из полного NORMAL анализа. Демо кандидатных подсказок предназначено для решения инспектора и экспорта review, а официальный конкурсный exporter остаётся `BLOCKED_CONTRACT`/`INCOMPLETE_ANALYSIS`. Подменять submission принятыми инспектором подсказками нельзя.
