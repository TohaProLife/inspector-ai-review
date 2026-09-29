# Проверка локатора чертежей на полностью просмотренных листах

26 сентября 2026. Для экспериментального векторного локатора добавлен [оценщик](../../scripts/evaluate-drawing-vector-public.py). Он читает только `TRAIN_PUBLIC/INCLUDE`, сверяет исходный PDF с `document_manifest.jsonl`, хеш библиотеки шаблонов, происхождение отчёта и SHA очереди разметки. `TEST_HIDDEN` и закрытые ответы не используются.

## Что считается измерением

Для каждого выбранного листа и класса `RADIATOR` нужен отдельный `drawing-sheet-review-v1`: `coverage=FULL_SHEET`, `review_status=HUMAN_APPROVED`, идентификатор проверяющего, SHA отчёта локатора и **все** приборы на листе с рамками в координатах видимой PDF-страницы. `instances=[]` допустим только после полного просмотра листа и означает подтверждённое отсутствие класса на нём. Локальные `AI_CROSSCHECKED` рамки и просмотр одних предложений этим требованиям не соответствуют.

Оценщик связывает предложения с эталонными рамками один к одному при IoU ≥ 0,5. Повторное предложение на один прибор учитывается как ложное. Отчёт показывает TP/FP/FN, precision и recall для выбранных полностью просмотренных листов. При отсутствующей или неполной разметке он возвращает `NOT_ESTIMABLE` и `metrics=null`. Даже `MEASURED` оставляет `release_gate=NOT_ASSESSED`: отдельное предметное решение о допуске в `NORMAL` не автоматизировано. Поле `HUMAN_APPROVED` в JSONL является заявлением автора файла; оценщик не аутентифицирует человека. Принятый набор должен храниться с проверяемой историей review.

## Текущие реальные прогоны на homeserver

| Источник и листы | Область | Предложения | Вывод оценщика |
|---|---|---:|---|
| F0202 p.17–18 | тот же объект, откуда взят шаблон | 79 | `NOT_ESTIMABLE`, оба листа без полного человеческого review |
| F0122 p.45 | другой объект `TRAIN_PUBLIC` | 1 | `NOT_ESTIMABLE`, полный лист без человеческого review |

Исходные PDF повторно сверены по размеру и SHA. Повторный векторный прогон F0202 дал те же 79 предложений, но записал явные поля области объекта, необходимые оценщику. [Отчёт F0202](../../datasets/templates/experimental-public-v1/review/f0202-vector-eval-v1.json), [очередь p.17–18](../../datasets/templates/experimental-public-v1/review/f0202-p17-p18-full-sheet-review.jsonl), [результат](../../datasets/templates/experimental-public-v1/review/f0202-p17-p18-evaluation.json). Для независимого объекта: [отчёт F0122](../../datasets/templates/experimental-public-v1/review/cross-object/f0122-cross-object-vector.json), [очередь p.45](../../datasets/templates/experimental-public-v1/review/cross-object/f0122-p45-full-sheet-review.jsonl), [результат](../../datasets/templates/experimental-public-v1/review/cross-object/f0122-p45-evaluation.json).

[Генератор обзорных листов](../../scripts/build-drawing-full-sheet-review-packet.py) создал [F0202 p.17–18](../../datasets/templates/experimental-public-v1/review/full-sheet-p17-p18/review-index.json) и [F0122 p.45](../../datasets/templates/experimental-public-v1/review/cross-object/full-sheet-p45/review-index.json): на каждом полном листе нанесены ID и рамки всех предложений. Индексы содержат SHA PDF, библиотеки, отчёта и PNG; локальные PNG совпали с повторным прогоном на homeserver. [Обзор F0202 p.17](../../datasets/templates/experimental-public-v1/review/full-sheet-p17-p18/page-00017-proposals.png), [p.18](../../datasets/templates/experimental-public-v1/review/full-sheet-p17-p18/page-00018-proposals.png), [F0122 p.45](../../datasets/templates/experimental-public-v1/review/cross-object/full-sheet-p45/page-00045-proposals.png). PNG удобны для навигации; проверять пропущенные элементы нужно по исходному PDF в полном разрешении. Пакеты сохраняют `UNREVIEWED`.

На F0122 p.45 ранее визуально обнаружено ложное совпадение с трубой; локальная VLM тоже назвала его радиатором. Это регрессионный пример, но его нельзя подставить вместо полной разметки листа и назвать measured precision. Предложения F0202 также не доказывают полный recall. Связь с выноской и помещением оценивается отдельно; текущий оценщик считает только локализацию символа.

## Воспроизведение

На homeserver исходные PDF и копии отчётов находятся в `dataset-smoke`. Для F0122:

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke/dataset-smoke
python3 probes/template-public-v1/evaluate-drawing-vector-public.py \
  --manifest probes/template-public-v1/document_manifest.jsonl \
  --template-library probes/template-public-v1/library.json \
  --locator-report probes/template-public-v1/f0122-cross-object-vector.json \
  --source-pdf F0122_raw.pdf \
  --reviews probes/template-public-v1/f0122-p45-full-sheet-review.jsonl \
  --page 45 \
  --output probes/template-public-v1/f0122-p45-evaluation.json
```

Для F0202 заменить source/report/reviews на `F0202_raw.pdf`, `f0202-vector-eval-v1.json`, `f0202-p17-p18-full-sheet-review.jsonl` и указать `--page 17 --page 18`.

Следующий шаг: независимый эксперт отмечает **все** приборы и отсутствие приборов на этих трёх полных листах, проверяет рамки по исходным PDF, затем оценщик пересчитывает качество. После этого отдельно измерить ошибку связи с помещением на другом объекте. Только получив эти данные, можно выбрать пороги и подключать локатор к durable stage как review proposals. Он не должен создавать finding или `NEGATIVE_VERIFIED` напрямую.

Проверка кода: 7 тестов оценщика локально, 3 теста обзорного пакета в изолированном Python-окружении homeserver, два реальных прогона PDF и сверка SHA всех трёх обзорных PNG. H100 и durable `NORMAL` этим опытом не проверены.
