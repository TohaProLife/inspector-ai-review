# Кандидаты группы и подномера помещения для прибора: F0202 p.17–18

26 сентября 2026. Все входы — `TRAIN_PUBLIC/INCLUDE`. Оригинал `F0202_raw.pdf` повторно сверен по размеру и SHA-256 с `document_manifest.jsonl`; библиотека шаблона и отчёт локатора сверены по SHA. Закрытые ответы и `TEST_HIDDEN` не использовались. Код работает только локально на homeserver.

## Исполняемая цепочка

1. [Векторный локатор](../../scripts/locate-drawing-vector-public.py) дал 54 геометрических предложения на p.17. Это не утверждённые приборы.
2. [Связь с выноской](../../scripts/link-drawing-vector-callouts-public.py) для каждого предложения рендерит фрагмент, вызывает локальный OCR и требует синюю линию от контура до строки `PRADO` с моделью под ней. На всём листе 43 результата `LINKED_LABEL_REVIEW_REQUIRED`, 10 `ABSTAIN_AMBIGUOUS_OR_MISSING_CALLOUT`, один `ABSTAIN_NO_LEADER`. [Четыре пакета отчётов](../../datasets/templates/experimental-public-v1/review/callout-p17-all/) сохраняют OCR/PDF provenance; полные PNG и ответы OCR хранятся на homeserver в `dataset-smoke/probes/template-public-v1/callout-p17-all/`.
3. Новый [локатор группы помещения](../../scripts/probe-drawing-room-link-public.py) рассматривает только чёрные номера из текстового слоя внутри векторной окружности. Такой номер может быть родительской группой для красных подномеров и не записывается как точное помещение. Сторона интерьера определяется по стороне, противоположной выноске. Луч к номеру проверяется на длинные тёмные горизонтальные и вертикальные линии в растре PDF; близкий номер за препятствием исключается. Если нет однозначного близкого номера, результат — abstention. Максимальная дальность 220 pt, фильтр стены 15 px и отношение расстояний 1,45 — исследовательские параметры этого листа, **не калиброванные оценки уверенности**.

[Полный отчёт p.17](../../datasets/templates/experimental-public-v1/review/room-group-p17-all.json) (SHA-256 `bbcbb46d8a050ca2f56278f318129fd34d0e17c148f35f9bb4fe500de5ae8414`) содержит 21 `ROOM_GROUP_CANDIDATE_REVIEW_REQUIRED`, 22 `ABSTAIN_NO_UNOBSTRUCTED_ROOM_LABEL` и 11 `ABSTAIN_CALLOUT_UNLINKED`. Сумма — все 54 предложения. В этом отдельном этапе кандидат 61 не получил чёрную группу: номер `233` находится за перегородкой. Кандидат 100 также остановлен: ближайшие номера разделены стенами, а `256` дальше допустимого радиуса. Эти статусы не означают отсутствие прибора или помещения.

## Красные подномера

[Новый OCR красных окружностей](../../scripts/ocr-drawing-red-circles-public.py) на том же исходном PDF нашёл четыре векторные окружности. Перед локальным OCR удаляется только штрих окружности; иначе у `.1` OCR возвращал `233.` и `234.`. [Отчёт OCR](../../datasets/templates/experimental-public-v1/review/red-circle-ocr-p17/summary.json) (SHA-256 `2047b40d9cb832d5d9b39f02b65c5a43af7e576a691060dda8723b70e3a808a9`) предлагает `233.1`, `233.2`, `234.1`, `234.2`. Для каждого сохранены [исходный и очищенный фрагменты, ответ OCR](../../datasets/templates/experimental-public-v1/review/red-circle-ocr-p17/) и SHA. На визуальном AI-просмотре все четыре надписи читаются так же; статус остаётся `REVIEW_REQUIRED`.

[Связь прибора с подномером](../../scripts/probe-drawing-subroom-link-public.py) использует OCR окружностей, сторону интерьера от синей выноски, расстояние, растровый луч и пересечение с парными чёрными горизонтальными линиями PDF. Она повторно сверяет SHA исходного PDF, всех отчётов, OCR и PNG. [Отчёт по 54 предложениям](../../datasets/templates/experimental-public-v1/review/subroom-p17-all.json) (SHA-256 `5b583168129c01dc5df0186e575807af520ebf9fe4abd87aa2ef6f88f7c4d9bd`): 8 `SUBROOM_CANDIDATE_REVIEW_REQUIRED`, 35 `ABSTAIN_NO_UNOBSTRUCTED_RED_SUBROOM`, 11 `ABSTAIN_CALLOUT_UNLINKED`. Кандидаты 58/59 предложены к `233.1`, 61/63 к `233.2`, 65/71 к `234.1`, 73/76 к `234.2`. [Воспроизводимый генератор пакета](../../scripts/build-drawing-subroom-review-packet.py) создал [восемь фрагментов](../../datasets/templates/experimental-public-v1/review/subroom-p17/review-index.json) с SHA индекса `47a240cceefbe4a5ca6b53099b029bde57d0d8608108b4f20f35b4c0377b1567`; SHA PNG совпадают с исходными crop в отчётах выносок. Все восемь записей `UNREVIEWED`.

На соседнем p.18 тот же OCR в явном режиме `integer` нашёл две красные окружности с целыми `254` и `256`; [отчёт и фрагменты](../../datasets/templates/experimental-public-v1/review/red-circle-ocr-p18/summary.json) (SHA-256 `33799ce2ee2a751f8b1d86e1cd6533e5ca85ae106c733626d667dd03baa3ed78`) дают два `RED_ROOM_LABEL_REVIEW_REQUIRED`. Это не подномера `.1/.2`. Оба красных номера дальше 350 pt от ближайших приборов p.18, автоматической связи с ними нет.

Для всех 25 геометрических предложений p.18 выполнен OCR выносок: 24 `LINKED_LABEL_REVIEW_REQUIRED`, одно `ABSTAIN_AMBIGUOUS_OR_MISSING_CALLOUT`. [Два отчёта](../../datasets/templates/experimental-public-v1/review/callout-p18-all/) сохранены с SHA PDF, координатами и хешами OCR/PNG; полные фрагменты и ответы OCR находятся на homeserver. [Локатор чёрной группы](../../datasets/templates/experimental-public-v1/review/room-group-p18-all.json) (SHA-256 `1957e5886a5ce7957d833024799abcde98251c3ed7698bec32f06465b2193b6d`) предложил 14 групп, остановил 7 случаев без свободного луча, 3 с несколькими номерами и один без выноски. [Пакет из 14 карточек и трёх обзорных листов](../../datasets/templates/experimental-public-v1/review/room-group-p18/review-index.json) (SHA-256 `e045c6be85700a125af98fedae4d9e58b6ab586f7e2bb57d7e69afeb136d258f`) проверен по SHA и визуально просмотрен AI. Группы выглядят правдоподобно, но все 14 записей `UNREVIEWED` и не превращаются в точный `room_id`.

На [59](../../datasets/templates/experimental-public-v1/review/subroom-p17/candidate-0059.png) `233.2` попадает в кадр, но находится за перегородкой: предложен `233.1`. На [71](../../datasets/templates/experimental-public-v1/review/subroom-p17/candidate-0071.png) аналогично предложен `234.1`, а `234.2` отделён стеной. У [76](../../datasets/templates/experimental-public-v1/review/subroom-p17/candidate-0076.png) растровая маска ошибочно пропускала луч к `234.1`. В PDF найдены две параллельные чёрные линии перегородки на y=628,2/630,6 pt: новый векторный фильтр фиксирует два пересечения к `234.1` и ноль к `234.2`. Те же восемь подномеров остались предложениями, но выбор 76 больше не опирается лишь на расстояние. Порог 1,45 и фильтр парных линий — исследовательские эвристики, не оценка вероятности. Предложения подтверждают лишь направление для ручной проверки, **не принятый точный `room_id`**.

Воспроизведение на homeserver после запуска локального `document-ai` OCR на `127.0.0.1:18084`:

```bash
cd /home/freetok/Projects/inspector-ai-homeserver-smoke/dataset-smoke
.venv-template-probe/bin/python probes/template-public-v1/ocr-drawing-red-circles-public.py \
  --manifest probes/template-public-v1/document_manifest.jsonl --source-pdf F0202_raw.pdf \
  --locator-report probes/template-public-v1/all-pages-locator-report.json \
  --template-library probes/template-public-v1/library.json --page-number 17 \
  --output-dir probes/template-public-v1/red-circle-ocr-p17
.venv-template-probe/bin/python probes/template-public-v1/probe-drawing-subroom-link-public.py \
  --manifest probes/template-public-v1/document_manifest.jsonl --source-pdf F0202_raw.pdf \
  --locator-report probes/template-public-v1/all-pages-locator-report.json \
  --template-library probes/template-public-v1/library.json \
  --room-group-report probes/template-public-v1/room-group-p17-all.json \
  --red-circle-report probes/template-public-v1/red-circle-ocr-p17/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-01/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-02/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-03/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-04/summary.json \
  --output probes/template-public-v1/subroom-link-p17-all.json
.venv-template-probe/bin/python probes/template-public-v1/build-drawing-subroom-review-packet.py \
  --manifest probes/template-public-v1/document_manifest.jsonl --source-pdf F0202_raw.pdf \
  --subroom-report probes/template-public-v1/subroom-link-p17-all.json \
  --red-circle-report probes/template-public-v1/red-circle-ocr-p17/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-01/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-02/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-03/summary.json \
  --callout-report probes/template-public-v1/callout-p17-all/batch-04/summary.json \
  --output-dir probes/template-public-v1/subroom-p17-review
```

## Просмотр и граница вывода

[Генератор пакета](../../scripts/build-drawing-room-review-packet.py) создал [индекс](../../datasets/templates/experimental-public-v1/review/room-group-p17/review-index.json) (SHA-256 `2d3623825ddc9fb260133d7ca946a21466214e12bac77ae33c191153db740d3d`), 21 отдельную карточку и [четыре обзорных листа](../../datasets/templates/experimental-public-v1/review/room-group-p17/contact-001.png) ([2](../../datasets/templates/experimental-public-v1/review/room-group-p17/contact-002.png), [3](../../datasets/templates/experimental-public-v1/review/room-group-p17/contact-003.png), [4](../../datasets/templates/experimental-public-v1/review/room-group-p17/contact-004.png)). Красная рамка показывает предложенный прибор, зелёная — чёрный номер группы; все 25 изображений повторно сверены по SHA из индекса. На визуальном AI-просмотре 21 карточки группы выглядят правдоподобно, но красные подномера не разрешены; сложные кандидаты 105 и 108 отдельно просмотрены в широком контексте. **Все 21 записи остаются `UNREVIEWED`**: это не независимая человеческая проверка, не precision/recall и не разрешение автоматически записывать `room_id`.

Красные номера подзон нарисованы векторными контурами без текстового слоя. Удаление окружности позволило OCR прочитать четыре подписи, но метод проверен только на одном стиле одного объекта и не доказывает полный охват приборов. Чёрные группы и красные подномера остаются отдельными предложениями для review; ближайший чёрный номер нельзя подставлять вместо точного помещения. Следующий gate — независимая разметка связей на полностью просмотренных листах другого `TRAIN_PUBLIC` объекта, затем сравнение соответствующих сущностей ПД/РД и серверная проверка evidence. До этого результаты остаются в offline review, `NORMAL` и coverage не меняются.

Проверено: focused Python tests связи выноски, группы, подномера и review-пакета; remote прогон исходного PDF; SHA PDF, отчётов, OCR-фрагментов, восьми карточек и листов. Производительность H100 и предметная точность на новых объектах не проверялись.
