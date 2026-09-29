# Проверки реализации

`npm run check` проверяет TypeScript, API, web, Python-сервисы и сборку.
PostgreSQL integration, инфраструктурные и исследовательские скрипты запускаются
отдельно. Это разные границы проверки; зелёная сборка не заменяет полный run.

```bash
npm run check
python3 -m unittest discover -s infra/tests -v

python3 -m venv /tmp/inspector-script-tests
/tmp/inspector-script-tests/bin/python -m pip install -r scripts/requirements-tests.txt
/tmp/inspector-script-tests/bin/python -m unittest discover -s scripts/tests -v
python3 scripts/check-ocr-heat-worker-api-contract.py
```

PostgreSQL integration требует отдельную тестовую БД через
`INSPECTOR_POSTGRES_ADMIN_URL`. Набор создаёт и удаляет собственную временную БД;
его нельзя запускать с production URL:

```bash
INSPECTOR_POSTGRES_ADMIN_URL=postgres://... \
  INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v1 \
  INSPECTOR_OCR_HEAT_ROW_PROFILE= \
  npm run test:postgres -w @inspector-ai/api
```

После тестов нужны runtime smoke на изолированном Compose и исходных
`TRAIN_PUBLIC` PDF. [Журнал homeserver](HOMESERVER_SMOKE.md) фиксирует два
полных OCR-heat run, API, браузер и локальный Qwen. Проверка H100 проводится
отдельно на конкурсном сервере: текущий homeserver имеет RTX 2080 SUPER.

27 сентября 2026: `npm run check` прошёл (API 113, web 13, worker 175),
PostgreSQL integration 15/15 на временной БД homeserver, `infra/tests` 7/7,
`scripts/tests` 127/127 в среде с указанными зависимостями. Скриптовый набор
включает v6 visual contract, повторный PDFium-рендер OCR и проверку результата
Python-экстрактора реальным API-валидатором и поимённый учёт 132 параметров.
Этот контракт также отдельно
прошёл в smoke checkout homeserver после синхронизации исправления стадии.

27 сентября, общий контракт фактов: полный `npm run check` прошёл после
интеграции `fact-family-pilot-v1` (API 125/125, web 14/14, worker 224/224,
остальные сервисы и production build). PostgreSQL integration на временной
БД изолированного homeserver прошла 16/16 через Node 22 container. Эти
проверки подтверждают контракт, сохранение и чтение opt-in профиля, но не
предметную точность на всём наборе. Для неё отдельно фиксируются исходные
PDF, SHA по открытому manifest, локаторы фактов, причины `ABSTAIN` и
результат полного DAG в [журнале homeserver](HOMESERVER_SMOKE.md).

После выбора проверенного раздела источника, реестра 132 кодов и исправления
пути к правилам в Docker повторный `npm run check` прошёл: API 127/127,
web 16/16, worker 231/231, остальные сервисы и сборка. PostgreSQL
integration с миграцией 018 прошла 16/16 на отдельной временной БД homeserver.
Файл правил также загружен внутри собранного worker-образа: 5 пилотных
правил и 132 записи реестра.
`infra/tests` прошли 7/7, `scripts/tests` — 127/127 через `uv` с закреплёнными
тестовыми зависимостями.

После добавления решений о связи фактов PostgreSQL integration с миграцией
019 прошла **17/17** через SSH-туннель к изолированной БД homeserver; набор
создал и удалил временную базу. Проверены POST/replay, GET, снимок для нового
run, неизменность таблиц, передача в RULE lease, Python `REVIEW_REQUIRED` и
повторная проверка API. Реальный браузерный smoke после пересборки контейнеров
проверил пять строк fact-family, пять ссылок на страницы, форму связи и
`GET /fact-links` с пустым журналом. Новый тест маршрутизирующего репозитория
проверяет передачу обоих методов в PostgreSQL; первый browser run выявил
отсутствие этой передачи, после исправления повторный run прошёл.
Финальный `npm run check` после исправления: API 132/132 локальных теста,
web 18/18, worker 232/232, остальные Python-сервисы и production build.
17 PostgreSQL тестов запускаются отдельно и прошли на временной БД.

После добавления направленного увеличения, относительного увеличения,
наблюдений PZ-010/KR-061 и строгой проверки класса бетона повторный
`npm run check` прошёл: API 137/137 локальных тестов, web 18/18, worker
241/241, остальные Python-сервисы и production build. Отдельно `infra/tests`
7/7, `scripts/tests` 127/127. PostgreSQL integration 17/17 относится к
предыдущему изменению журнала связей; новый comparator проверен локальными
межъязыковыми тестами. Полный реальный reprocess после миграции 019 завершился
на homeserver как `CHK-B8ACC123` без нового finding.

После индексации разрешённых 203 документов и подключения адресного
SHA/page OCR-кеша повторный `npm run check` прошёл: API 155/155
(19 PostgreSQL тестов в локальном запуске пропущены), web 21/21,
worker 599/599, остальные Python-сервисы и production build.
`infra/tests` прошли 8/8; оба Compose-профиля разрешаются, а статическая
проверка серверного профиля проходит с временными настройками. Запуск на
H100 пока не проводился.

На изолированном homeserver выполнены четыре immutable `NORMAL` reprocess
для двух разрешённых PDF общим объёмом 1290 страниц. Десять jobs каждого
run завершились с первой попытки; итог `PARTIAL` (7/125), findings 0.
После заполнения двух persistent кешей повторный run сократился с 582 до
102 с, стадия текста — с 460 до 3 с, OCR layout — 2 с. Совпали SHA
текстовых артефактов и результатов OCR/правил. Результаты и ограничения —
в [квитанции](DURABLE_CACHE_E2E_20260927.md). Чтение API дополнительно
проверило 47 уникальных `ABSTAIN` preview и 47 `REVIEW_ONLY` строк
observations: это не подтверждение предметной точности или полноты 132
параметров.

Полный review-пакет источников 103/103 создан из SHA-закреплённых публичного
manifest, матрицы и отчёта титулов без повышения статусов источников;
`test_source_review_packet` прошёл 6/6, включая режим без титульной подсказки.
Четыре адресные титульные OCR-страницы прошли без ошибок. Новый титульный
отчёт повторно сверил 202 PDF/597 первых страниц с `PASS`-аудитом; F0146
дала подсказку PD/PZ, F0186 — ни одной марочной подсказки.
Исходный PDF F0146 повторно прошёл size/SHA/page-count проверку; его p.1
визуально сверена с OCR-подсказкой раздела.
После добавления полной очереди и отдельных заданий без титульной подсказки
новый `npm run check` прошёл: API 155/155 (19 integration пропущены без БД),
web 21/21, worker 601/601, остальные сервисы и production build.
`infra/tests` повторно прошли 8/8; `git diff --check` чист.

Адресный `public_region_ocr` добавлен для выборочного чтения штампов
чертежей со SHA/page/region/profile кешем. Его 6 локальных тестов прошли:
HIT без OCR, повторная сверка исходного PDF, инвалидация по области/DPI,
запрет TEST_HIDDEN и внешнего provider, отказ при испорченном ответе и
подмене PDF-координат. Реальный F0198 p.1 на homeserver дал 46 строк и
`MISS_WRITTEN/HIT` с одинаковым artifact hash; аудит
[здесь](F0198_MIXED_STAGE_VISUAL_REVIEW_20260927.md). Этот OCR не даёт
finding и не повышает покрытие: источник остаётся `RD_ID_MIXED`.
На трёх других смешанных одностраничных PDF из той же публичной группы
адресный OCR также прошёл: F0197 58, F0199 52, F0200 70 строк, ошибки 0;
[пачка](MIXED_STAGE_REGION_OCR_BATCH_20260927.md) сохранена с SHA.
Полный `npm run check` в `services/worker/.venv` после новых тестов прошёл:
API 155/155 (19 integration пропущены локально), web 21/21,
worker 607/607, остальные сервисы и production build. Системный
`python3` не имеет `pdfminer`, поэтому запуск без worker venv дал
окруженческую ошибку до повторного успешного прогона.
Экстрактор `mixed_stage_region_proposals` прошёл 4/4 локальных теста;
полный worker suite после его добавления — 611/611. Четыре реальных
SHA-закреплённых OCR-отчёта дали 4/4 пар локаторов РД/исполнительной
отметки в [пакете проверки](MIXED_STAGE_REGION_OCR_BATCH_20260927.md),
каждая пара остаётся `REVIEW_ONLY_ABSTAIN`.
Форма source review теперь прямо требует `UNRESOLVED` для одностраничного
РД-листа с исполнительной отметкой; тест диапазонов проверяет `1=UNRESOLVED`
и отсутствие принудительного выбора РД или ИД.
После уточнения формы web typecheck прошёл, web tests 22/22. Только web
изолированного Compose-проекта homeserver пересобран и запущен с `--no-deps`;
`GET /` вернул HTTP 200, `/api/health` — `ok`, а надпись о двух стадиях
найдена в собранном JS работающего web-контейнера.
Итоговый полный `npm run check` после всех изменений этого пакета прошёл
в worker venv: API 155/155 (19 PostgreSQL integration без локальной БД
пропущены), web 22/22, worker 611/611, остальные Python-сервисы,
TypeScript и production build. `git diff --check` чист.
Таблица проверки источников повторно собрана из тех же двух SHA-закреплённых
пакетов: 103/103 уникальных строк, четыре строки с региональными подсказками,
все поля решений пусты; оба прогона дали CSV SHA-256
`a11bbc73be71db80c78815f1d4f8b4cf4dd5b9f5dac90e369e108bbc30b7e591`.
Копия на homeserver имеет тот же SHA.

Индекс v4 после выявления CID-заглушек прошёл полный независимый аудит:
203 разрешённых источника, 10 142 страницы, 10 142 FTS/карт, 0 ошибок.
Из v3 перенесены 93 страницы в `OCR_REQUIRED` без чтения закрытых данных.
Все 47 кодов повторно прошли лексические прогоны и остались `ABSTAIN`;
связь [с аудитом](PUBLIC_DOCUMENT_INDEX_V4_20260927.md) закреплена SHA.
Выбранные 60/60 OCR-страниц обработаны на оригиналах ZIP. В отдельной
проверке 60 receipts повторно сверены с очередью, манифестом, кешем и
точными OCR-локаторами: `PASS`, 11 267 строк, 41 буквальный лид только для
review. Два крупных листа F0193 обработаны при 116 DPI из-за пиксельного
лимита; три теста выбора DPI прошли.

После изменения версии качества `npm run check` в `services/worker/.venv`
прошёл: API 155/155 (19 PostgreSQL integration локально пропущены без БД),
web 22/22, worker 613/613, остальные сервисы, TypeScript и production
build. Отдельный PostgreSQL integration suite на временной БД прошёл
19/19, включая release-pinned v1/v2 и OCR DAG. Сквозной изолированный
Compose homeserver по F0153 затем прошёл дважды: 10/10 jobs с первой
попытки в каждом run, одинаковый SHA текстового артефакта, v2 policy в
release и артефакте, p.1 `OCR_REQUIRED/TEXT_DECODING_ANOMALY`, 47/47
кандидатных `ABSTAIN`, 0 findings. [Квитанция](PUBLIC_DOCUMENT_INDEX_V4_20260927.md)
содержит исходный SHA и read-only DB audit. Стенд H100 в этой работе
недоступен.
