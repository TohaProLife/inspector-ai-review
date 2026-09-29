# Адресный поиск меток 47 семейств в кеше OCR

`scripts/probe-public-ocr-labels.py` читает **одну явно выбранную** страницу из
проверенного локального OCR-кеша. Скрипт не запускает OCR и не обращается к сети.
`load_ocr_family_evidence` сверяет `TRAIN_PUBLIC`/`INCLUDE`/`PUBLIC_TRAIN`, SHA
исходного PDF в manifest и index, статус страницы `OCR_REQUIRED`, точный ключ
кеша, хеши кеша и OCR-артефакта. Вход ограничен 128 исходными индексами строк.

Метки берутся только из закреплённых пакетов numeric (31 код), class (8 кодов)
и presence (8 кодов). Совпадение буквальной метки в одной строке получает
`LITERAL_LABEL_IN_SINGLE_OCR_LINE`. Метка, которая складывается лишь из двух
соседних исходных OCR-строк, получает `ADJACENT_OCR_FRAGMENT_UNCERTAIN`. Каждая
зацепка хранит номера строк, исходный текст, OCR score и `bboxPx` в
`IMAGE_TOP_LEFT_PIXELS`; отчет хранит source, manifest, index, cache, artifact,
evidence и policy SHA. Проверка категории manifest — лишь диагностический
`sourceGate`; стадия листа, раздел чертежа и связь объектов требуют review.

Отчет всегда `ABSTAIN`/`REVIEW_ONLY`/`NON_EXECUTING_ABSTAIN`. Ни совпадение,
ни пустой список меток не создают типизированный факт, finding, coverage,
доказательство отсутствия элемента или оценку точности. Величины, единицы и
условия применения правила здесь не извлекаются.

Пример адресного чтения F0150 p.1 на homeserver: запустить скрипт в существующем
worker-образе, примонтировать checkout, полный публичный индекс и OCR-кеш
только на чтение. Передать `--manifest`, `--index-root`, `--cache-root`,
`--source-id F0150 --page 1`, точные значения `--object-id`, `--stage`,
`--section` из manifest, `--lines 0,1,...,20`, `--dpi 120 --script eslav`,
`--renderer-profile-id renderer-pdfium-5.12.1-linux-x86_64-v1` и
`--provider-profile-id ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1`.

27 сентября 2026 этот вызов проверен на исходном F0150 SHA
`30c456b308c9f9e7e5c7fb009217777b8ce754490ccc39d662f21ac30eab031b`.
Выбраны все 21 OCR-строка обложки. Кеш
`15a0e2fb0507e81cf56925f4e98c49cc91e452a533d7358d4f61d8657b03ea2c`
прошёл сверку; результат `ABSTAIN`, 0 меток из 47 кодов, SHA отчёта
`e22edc0ffadbb57d1ee6d688a797f0201a126400a8fddebde3cdeff3ef3a09ef`.
Отчёт сохранён в `output/public-index-20260927/ocr-label-f0150-p1.json`.
Это титульная страница: результат не говорит о содержимом остальных страниц.

Синтетический кеш проверен четырьмя тестами: метки numeric/class/presence,
разорванная на соседние строки метка, координаты, запрет несоседнего
склеивания, закрытый split, подмена хеша, неверный scope и отсутствие кеша.
Тесты прошли в `inspector-ai-homeserver-smoke-worker` с `--network none`,
read-only checkout и лимитами 2 CPU / 2 GiB. Полный OCR-корпус этим тестом не
проверен.
