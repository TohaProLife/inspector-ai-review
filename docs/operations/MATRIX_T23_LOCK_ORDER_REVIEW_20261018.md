# T23: порядок блокировок агрегата inspection

Дата: 18 октября 2026, 00:01 MSK. Только чтение кода. Runtime, registry, тесты и БД не изменялись; фактический deadlock в этой исследовательской задаче не воспроизводился.

## Вывод

Минимальная общая причина — две команды блокируют одновременно строки `objects` и `inspections` через joined `SELECT FOR UPDATE`, тогда как worker и восстановление начинают с `inspections` и позже обновляют `objects`. Если joined-запрос успел заблокировать object до ожидания inspection, возникает цикл: пользовательская команда удерживает object и ждёт inspection; завершение worker удерживает inspection и ждёт object.

Исправлять следует общую точку входа двух команд: **явно взять inspection первой отдельной SQL-командой; затем отдельной командой перечитать и при необходимости заблокировать object**. Менять только порядок имён в `OF` недостаточно для явного протокола приложения. Простое удаление object из списка блокировки также не закрывает вопрос свежести `file_count`.

Основной протокол доменных блокировок: сначала inspection; затем нужные существующие run/job/review rows; изменения object допустимы после владения inspection. Inspection служит общим mutex для того же агрегата. Порядок advisory-блокировки command receipt — отдельный вопрос, здесь не найденной причиной цикла не объявляется.

## Проверенный снимок исходников

Номера строк относятся к снимку 2026-10-17T21:01:14Z:

- `apps/api/src/postgres-repository.ts`: SHA-256 `d58f067ea6d108b1101e466fd1efcfe7a5d7706911765e372a73ef2187ae1ce6`.
- `apps/api/src/outbox-relay.ts`: SHA-256 `dee705a34764b846a1564a449c38ee0e77c7c48ee011dd61b82ea199d0e51f68`.
- `apps/api/src/job-terminal-failure.ts`: SHA-256 `91ad92a24a71e8461d900ffbca971859c23fbaf4a49e8bbcb1a1e8af83a3d433`.

## Карта путей

| Путь | Фактические блокировки | Последующее действие |
| --- | --- | --- |
| `executeRegisterIngestedFiles`, repository:2730 | Joined `FOR UPDATE OF objects, inspection` | Вставки blob/source со ссылкой на object; `UPDATE objects` на 2836 |
| `executeStartCheck`, repository:3010 | Joined `FOR UPDATE OF object, inspection` | Чтение active run, создание нового run/manifest/jobs; `UPDATE inspections` 3286, `UPDATE objects` 3292 |
| `startCheckCommand`, repository:2945 | Делегирует `executeStartCheck` | Наследует риск |
| `reprocessCommand`, repository:11006 | Делегирует `executeStartCheck` | Наследует тот же риск, отдельная исправляемая реализация не нужна |
| Legacy `startCheck` / `registerIngestedFiles` | Те же приватные реализации | Исправление общей реализации покрывает обёртки |
| `claimJob`, repository:3468/3479/3517 | Inspection, затем run, затем job | При исчерпании попыток вызывает общий terminal helper |
| `heartbeatJob`, repository:3779/3786/3798 | Inspection, затем run, затем job | Продлевает lease либо отменяет устаревшую попытку |
| `completeJob`, repository:4171/4183/4197 | Inspection, затем run, затем job | Seal в конце обновляет object |
| `failJob`, repository:5149/5161/5179 | Inspection, затем run, затем job | Terminal failure через общий helper; retryable failure сохраняет retry |
| `propagateTerminalJobFailure`, helper:19/21/29 | Inspection, затем run, затем job; descendants в `ORDER BY job.id` | Закрывает attempts/jobs/descendants; `UPDATE analysis_runs` 67; `UPDATE objects` 72; failure event |
| `OutboxRelay.recoverDueJobsOnce`, relay:274–349 | Сначала незаблокированное обнаружение ID; каждый кандидат отдельной транзакцией | Terminal repair вызывает общий helper; retry repair явно inspection 313, run 318, job 326 |
| `decideFindingCommand`, repository:10726/10744/10771 | Inspection, затем run, затем review item | Позже изменяет inspection/object |
| `finalizeCommand`, repository:11163/11196/11209 | Inspection, затем run, затем review items | Позже inspection/object; совпадает с основным протоколом |
| `revokeProtocolCommand`, repository:11624/11643 | Inspection, затем active run | Позже inspection/object; совпадает с основным протоколом |
| OCR/fact/candidate/visual review commands | `FOR UPDATE OF inspection` на 7860, 8631, 9128, 9748, 10047, 10382, 10537 | Явного object-first lock в просмотренных входах нет |
| `recordSourceReviewCommand`, repository:2427 | Scope lookup без row lock, затем отдельная блокировка OPEN inspection | Receipt advisory lock берётся раньше, но row lock object первым не берётся |

`OutboxRelay.claimBatch`, relay:394, блокирует только строки outbox через `SKIP LOCKED`. Этот путь сам по себе не держит inspection/run/job и не объясняет найденный цикл. Переставлять его блокировки ради данного исправления оснований нет.

## Где именно worker требует object

- Обычный scaffold seal: `sealUnsupportedRun`, repository:5648.
- Pilot seal: repository:6841.
- Matrix seal: repository:12130.
- Terminal failure: `job-terminal-failure.ts:72`.
- Решения, финализация и отзыв протокола также обновляют object: repository:10906, 11521, 11794.

Не каждый `completeJob` обновляет object: обычное завершение промежуточной стадии обновляет run/jobs/outbox. Наиболее прямое воспроизведение — terminal failure или конечный seal.

PostgreSQL блокирует конфликтующие обновления до конца транзакции и рекомендует единый порядок захвата нескольких объектов. Жертва обнаруженного deadlock не гарантирована: тест не должен ожидать падение только worker либо только start. [Официальное описание row locks и deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS).

## Минимальное исправление

Для обеих приватных object-команд:

1. Найти object/OPEN inspection с существующими organization/access predicates, не захватывая object row lock.
2. Отдельным запросом заблокировать **только inspection**, повторно проверить lifecycle и принадлежность object/organization. После ожидания закрытая inspection должна дать прежний корректный отказ, а не продолжить мутацию.
3. Отдельным SQL-запросом перечитать object; если нужен row lock, взять его только теперь. `file_count`, используемый `executeStartCheck` для `DOCUMENTS_REQUIRED`, читать здесь.
4. Сохранить существующие receipt replay, permission check, source manifest freeze, active run reuse, explicit analysis-mode conflict, audit и единственность нового run.

Можно вынести маленький общий helper для двух входов; новая система distributed/advisory locking для решения этой причины не требуется. Переносить все worker-пути на object-first значительно шире и затронет уже согласованные recovery/fencing semantics.

Почему нужен свежий object read: в READ COMMITTED отдельный SQL получает новый snapshot. Upload сейчас блокирует inspection, но не обновляет её tuple; при ожидании lock только этой неизменённой строки joined-запрос не обязан обновить видимость параллельного изменения `objects.file_count`. Нельзя возвращать `DOCUMENTS_REQUIRED` после уже завершившейся первой загрузки. Это следствие текущего кода и statement snapshot; его следует подтвердить отдельным PG-тестом. [Официальная семантика READ COMMITTED](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

Автоматический retry всей транзакции после `40P01` может быть отдельным защитным механизмом, но не заменяет исправление порядка. Текущая `transaction`, repository:12494, делает rollback и пробрасывает ошибку; read retry в `readQuery` не относится к этим мутациям. Здесь не рекомендуется добавлять скрытый generic retry без отдельной проверки транзакционных побочных эффектов.

## Дополнительный старый путь: completeCheck

`completeCheck`, repository:3427–3445, начинает с `FOR UPDATE OF run` и не берёт inspection перед `sealUnsupportedRun`. Это отклонение от протокола, но основной цикл реального worker объясняется без него.

В HTTP-коде `completeCheck` вызывается только для `DEMO_SEED` либо repository без `completeJob` (`app.ts:985–987`, `1763–1765`). Обычный durable run использует `completeJob`; в интеграционных тестах direct `repository.completeCheck` остаётся доступен. Для полной унификации этой ветке нужен scope lookup, inspection lock, затем свежий run lock и повторная проверка active/lifecycle/run state. При pilot seal вставка `review_items` также обращается к inspection через FK. Не следует объявлять эту ветку причиной текущего stand-инцидента без лога фактического вызова.

## Детерминированный PostgreSQL regression

Существующие тесты `postgres.integration.test.ts:2285` проверяют upload/upload и start/start через `Promise.all`. `job-terminal-failure-postgres.integration.test.ts:82` проверяет relay/relay. Эти гонки не гарантируют перекрёстную последовательность **start/upload против worker terminal failure**.

Предлагаемый тест использует disposable migrated DB и реальные repository/helper/relay calls. Production hook не нужен: барьер реализуется test-only trigger в этой БД.

1. Создать объект с одним синтетическим источником; начать run, взять действующий lease на READY job. Для relay-варианта подготовить исчерпанный expired lease либо stranded FAILED job как в существующем recovery test.
2. Controller connection держит `pg_advisory_lock(testKey)`.
3. Установить `AFTER UPDATE ON analysis_runs` trigger, ограниченный UUID этого fixture run и переходом `QUEUED/RUNNING` в `FAILED`. Trigger вызывает `pg_advisory_xact_lock(testKey)`.
4. Запустить реальный `repository.failJob` с terminal error либо `relay.recoverDueJobsOnce`. Worker остановится после захвата inspection/run/job и обновления run, до `UPDATE objects`.
5. Через отдельный observer connection дождаться настоящего ожидания worker на controller с `pg_blocking_pids`; фиксированная задержка не заменяет эту проверку.
6. Запустить реальный `startCheckCommand` (либо `registerIngestedFilesCommand`). Дождаться его ожидания inspection, удерживаемой worker, также через `pg_blocking_pids`.
7. Освободить advisory lock controller. На старом коде, если object уже удерживается start/upload, получается реальный цикл. Один из вызовов отклонится `40P01`. На исправленном коде start/upload не держит object во время ожидания inspection: worker завершится, затем завершится команда.
8. Проверить durable результат, затем удалить test-only trigger/function. В `finally` обязательно advisory unlock, rollback незавершённых controller transactions и `Promise.allSettled` запущенных операций. Настроить bounded `statement_timeout` около 5 секунд, чтобы не оставлять повисшие тесты.

Проверки результата:

- Оба вызова разрешены успешно, нет `40P01`/timeout.
- Старый run остаётся FAILED с исходным error code, ровно одним failure event; descendants terminal, lease очищены; повторный recovery не меняет снимок.
- Для start: после ошибки старого run создан ровно один новый active run, его manifest/release pin корректен; replay той же команды не создаёт ещё run. Для reprocess используется та же приватная реализация; один отдельный command-тест полезен для receipt target.
- Для upload: запись добавлена один раз, original old-run snapshot/manifest не переписан. Итоговый object display status определяется последней последовательной командой; нельзя требовать `FAILED` после успешно закончившейся новой загрузки.
- Существующий seal test можно дополнить тем же барьером на переход `PARTIAL`, чтобы проверить `completeJob` и все три seal implementations на применимых профилях. Для самой общей причины сначала достаточно reported terminal failure и relay terminal repair.

Отдельный тест свежести: остановить первую загрузку, уже владеющую inspection, перед её commit; начать start так, чтобы он реально ожидал эту inspection; завершить upload без изменения inspection tuple. Start после освобождения должен увидеть новый source/`file_count=1`, получить корректный manifest и не вернуть `DOCUMENTS_REQUIRED`. Так тест отличит полноценное исправление от удаления object из joined `OF` без свежего чтения.

Это проект регрессионного теста, а не результат его исполнения. RED/GREEN и stand-проверка остаются задачей реализации root.

## Продолжение: actual PostgreSQL RED/GREEN

После завершения общего PostgreSQL-прогона добавлен отдельный файл `apps/api/test/aggregate-lock-order-postgres.integration.test.ts`. Runtime исправлен root; исследовательский агент runtime не менял.

Один и тот же тестовый файл, SHA-256 `5c17c5b4528a5e7fe5bcede01ee038d714ceb0048904f8402d9a49b645bd268a`, выполнен до и после исправления:

- **RED:** 2 failed / 1 passed. Actual `startCheckCommand` и `registerIngestedFilesCommand`, конкурирующие с настоящим `failJob`, получили `40P01`. Тест свежести первой загрузки прошёл и на исходном коде.
- **GREEN:** 3 passed / 0 failed, exit 0. Две приватные команды теперь сначала блокируют inspection, затем отдельным свежим запросом блокируют/читают object; start использует свежий `file_count`.
- В обоих запусках отсутствовали unhandled error markers. Тест закрыл свои repository/pool/controller connections, дождался отсутствия backends и удалил disposable DB без `FORCE` и без `pg_terminate_backend`.

Барьер использует test-only trigger `AFTER UPDATE analysis_runs` для одного fixture UUID и перехода в FAILED. Перед освобождением advisory lock тест действительно наблюдает ожидание worker, затем пользовательской команды через `pg_blocking_pids`. Никакого фиксированного сна вместо подтверждения порядка нет. Третий тест останавливает настоящую первую загрузку на `AFTER INSERT upload_receipts`, пока `file_count` ещё равен нулю; затем проверяет включение source в manifest ожидавшего запуска.

Проверены единственность terminal failure event, исходный error code, закрытие потомков/lease, неизменность старого manifest/release/source snapshot, отсутствие дубликатов при command replay, единственный новый active run для start и свежесть первой загрузки. Запросы bounded `statement_timeout=7000`; pending operations в `finally` доводятся до settled состояния перед удалением trigger и закрытием БД.

Доказательства: [test-results.json](../../output/matrix-t23-20261018/test-results.json), [RED log](../../output/matrix-t23-20261018/red-postgres.log), [GREEN log](../../output/matrix-t23-20261018/green-postgres.log). Логи проверены на отсутствие connection URL/секретов и сериализованных PG clients перед сохранением. SHA-256 receipt: `473f84d153928b997930f39f1470bacd0ea6b215c570410a7fb1b04f50c926f6`.

Это доказательство focused PostgreSQL-исправления. Оно не заменяет полный общий прогон, проверку relay/completeCheck веток или перезапуск и browser acceptance на homeserver.

## Приёмка root

Общийcheck1948PASS/98skip, actualPostgreSQL45PASS/0unhandled. APIобновлён на обычномhomeserver;24immutable snapshots и1localregistration совпали. Read-only publicF0151 browser1440/768/375PASS. СтатусACCEPTED: output/matrix-t23-20261018/acceptance.json.
