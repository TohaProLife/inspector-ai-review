# План отдельного OCR v6 для проверенных АР/ВК источников

Статус: отдельный opt-in release v6 и независимые save/seal/GET подключены;
изолированный Compose на публичном F0163 ещё завершается. Действующий OCR v5
и профили OCR-table v3 остаются без изменений.

## Зачем

На тематическом публичном F0163 текущий `document-text-v2` пометил две из
21 страниц `OCR_REQUIRED`, а OCR v5 не выбрал ни одной: его окна отбора
настроены на другие признаки. Offline-пакеты АР/ИОС подтвердили, что
адресный OCR этих семейств нужен. Ни один OCR-лид не становится фактом без
проверенных источника, страницы, элемента и контекста.

## Контракт v6

1. Новый opt-in immutable OCR profile/slot, отдельные `profileId`, version,
   config hash и schema. Максимум четыре страницы на run; остальные
   `OCR_REQUIRED` явным образом deferred. Кеш остаётся keyed по SHA PDF,
   странице, DPI, рендеру и provider profile.
2. Worker читает только committed `document-text-v2` текущего fenced job и
   immutable `sourceDecisions` из lease. Выбирает страницы лишь при
   `CURRENT`/`APPROVED`, разделе АР/ВК и разрешённой стадии ПД/РД.
   Отсутствие решения или смешанная/неразрешённая страница дают deferred с
   причиной; не подменяют их утверждением об отсутствии параметра.
3. API на save/seal/GET заново читает snapshot решения **этого run**, SHA
   исходного PDF и `content_hash` текстового артефакта, повторяет отбор и
   независимо проверяет список страниц, геометрию, рендер, provider и
   счётчики. Текущие mutable решения пользователя не участвуют.
4. Новый OCR-sidecar нужен отдельно от текстового
   `unresolved-family-run-review-v1`: привязка к committed OCR stage SHA,
   точным строкам и исходным листам, всегда `ABSTAIN`, без findings и
   coverage. Старые OCR heat/table потребители v4/v5 не должны молча
   принимать v6.

## Gate включения

Python/TypeScript profile hash совпал:
`ea7be21c64146e379183f7e01b047bb2fcbeb8882ee688158f5662ad0979ce21`.
На синтетическом `CURRENT`/`APPROVED` worker выдал две страницы, а независимый
API принял stage; подмены счётчика, номера страницы и provider profile отвергнуты.
Проверка API повторяет selection, SHA committed text artifact, page geometry,
page hash и provider metadata. Физический cache receipt и повторный PDF render
проверяются отдельным аудитом, поскольку в stage artifact их файлов нет.

Независимый PostgreSQL save/seal/GET прошёл: 2/2 синтетических теста с
`CURRENT`/`APPROVED`, подменой source-review snapshot, текста и страницы;
старый v5 release изолирован. Локальный полный `npm run check` с Python worker
venv прошёл: API 268 pass/32 skip, web 49, worker 688, сборка. Весь PostgreSQL
suite при последовательном запуске прошёл: 9 файлов, 33 теста. При
параллельном запуске assertions также прошли, но Vitest получил `57P01` от
гонки очистки временной БД; для воспроизводимого gate используется
`vitest run postgres --no-file-parallelism`.

Следующий gate: изолированный homeserver Compose на разрешённом публичном PDF,
аутентифицированный API/браузер и SHA-аудит. Реальный положительный предметный
результат не заявлять без экспертных решений по источникам и сопоставимой паре
ПД/РД.
