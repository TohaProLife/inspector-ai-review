# Статус реализации

Базовый аудит выполнен 17 сентября 2026 на commit `8200a03`; backend-срез identity/durable commands зафиксирован 18 сентября в `a85047f`, authoritative finalization — в `a93bc99`, отзыв и canonical JSON artifacts — в `303e22e`. B07 продолжен коммитами `4f72350` (durable jobs/outbox/relay), `b568f54` (heartbeat/cancellation), `770f502` (relay health/metrics), `ac30f70` (persisted stage dependencies), `7ab4015` (terminal failure propagation), `cbe0998` (PDF text-layer artifacts), `50e0985` (page text-layer qualification) и `967b327` (provider-neutral analysis scaffold). Основание — [аудит](AUDIT_REPORT_2026-09-17.md), включая исходные команды и ограничения окружения.

## Локальное продолжение после аудита

В текущем рабочем дереве закрыта первая часть этапа достоверности G0:

- проверки новых объектов имеют явный режим `NORMAL` и больше не получают публичные seed-находки учебного объекта;
- normal-run асинхронно завершается честным состоянием `PARTIAL`: durable worker сохраняет 132 строки coverage со статусом `UNSUPPORTED`, findings отсутствуют; финальный PARTIAL-протокол допускается только с явным подтверждением точного текущего gaps hash и текстовым основанием;
- добавлен `GET /api/checks/{id}/coverage` с полным ledger из 132 параметров;
- submission normal-run с неподдержанными правилами остаётся заблокированным как `INCOMPLETE_ANALYSIS`; PARTIAL-протокол не считается полной приёмкой;
- синтетические `117` отрицательных результатов и проценты confidence удалены; неизвестный confidence возвращается как `null`;
- demo seed имеет отдельный режим `DEMO_SEED` и помечается в UI как публичный пример, а не inference новых документов;
- текущий legacy/internal API сведён в один исполняемый реестр: 29 операций задают path/query/body, ответы и фактические ошибки;
- Fastify использует этот реестр для request validation и response serialization, а `/api/openapi.json` строится из него же;
- contract-тест проверяет все операции, обязательные path-параметры, разрешение `$ref` и документирование статусов реальных HTTP-запросов;
- Fastify и ingest переведены с конкретного `InspectorStore` на async repository contract;
- добавлена forward migration `002_domain_core.sql` и отдельный rollback reference: organization/object scope, inspections, immutable manifests, runs, coverage, rule/review/protocol core, FK/unique/check constraints и append-only triggers;
- при наличии `DATABASE_URL` server использует PostgreSQL для новых normal objects/uploads/manifests/runs/coverage, а `DEMO_SEED` остаётся в изолированном memory-adapter;
- PostgreSQL-adapter использует транзакции, inspection lock при запуске, DB-level hash deduplication и атомарно создаёт `QUEUED` run, provider-neutral persisted DAG `ANALYSIS_INVENTORY → DOCUMENT_TEXT_LAYER → DOCUMENT_RENDER → DOCUMENT_METADATA → DOCUMENT_LINKING → ENTITY_EXTRACTION → RULE_EVALUATION → EVIDENCE_VALIDATION → ANALYSIS_SEAL_UNSUPPORTED` и root `job.ready`/`analysis.started` outbox events; `DOCUMENT_OCR_LAYOUT` вставляется между render и metadata только при наличии страниц `OCR_REQUIRED` (для legacy v1 — консервативно для всех страниц);
- migration `006_durable_jobs_outbox.sql` добавляет `analysis_jobs`, immutable history попыток и transactional `domain_outbox` с lease/fence/retry/lock состояниями; rollback reference хранится отдельно;
- внутренние claim/input/heartbeat/complete/fail endpoints защищены worker token, проверяют capability, OPEN active-run scope, attempt и fencing token; input download дополнительно ограничен source из immutable manifest и не раскрывает storage key; каждый non-seal complete одной транзакцией сохраняет результат, `stage.finished`, активирует child и пишет downstream `job.ready`; seal complete сохраняет `PARTIAL` run и `analysis.sealed`;
- отдельный `outbox-relay` публикует persistent messages с RabbitMQ publisher confirms, восстанавливает зависшие outbox locks, просроченные leases и due retries; topology явно содержит durable `rules.evaluate`, `documents.render`, `documents.extract`, `documents.link` и соответствующие DLQ;
- relay экспортирует внутренние DB-backed `/health` и Prometheus `/metrics`: outbox rows/lag/retries, job states/age и expired attempts; Compose worker ждёт healthy relay;
- workers валидируют envelope `1.0`, получают lease через API и ack-ают RabbitMQ message только после durable complete/fail ответа; отдельный document worker потоково скачивает manifest PDF, сверяет byte size/SHA-256 и извлекает существующий text layer с целочисленной page/block geometry через `pdfminer.six`; `text-layer-quality-v1` детерминированно делит страницы на `TEXT_LAYER_CANDIDATE` и `OCR_REQUIRED`, не называя первый статус доказанной пригодностью; неизвестный envelope dead-letter-ится;
- worker запускает отдельный heartbeat loop с default-интервалом 20 секунд; потеря lease, terminal job или недоступный control plane останавливают дальнейший result commit;
- migration `007_job_attempt_cancellation.sql` сохраняет cancellation attempt отдельно от worker failure; heartbeat отменяет текущие job/attempt при закрытом inspection, заменённом active run или terminal run, а поздний complete остаётся без эффекта;
- migration `008_analysis_job_dag.sql` добавляет `BLOCKED`, тип inventory job, persisted dependency table и независимую последовательность event versions analysis run; отдельный rollback отказывается удалять схему при наличии DAG-данных;
- migration `009_document_text_layer.sql` добавляет `DOCUMENT_TEXT_LAYER` и append-only `analysis_text_artifacts`; API канонизирует и повторно проверяет provenance, geometry и совокупный лимит 8 MiB, сам рассчитывает content hash/byte size и сохраняет полный JSON artifact, оставляя в job result только компактные refs;
- migration `010_document_text_quality.sql` расширяет schema discriminator до `document-text-v2`, сохраняя v1 rows; v2 содержит page metrics, reason codes и summary, которые API полностью пересчитывает из принятых блоков перед commit;
- migration `011_analysis_pipeline_scaffold.sql` добавляет оставшиеся job types и append-only `analysis_stage_artifacts`; незаполненные provider/policy slots принимают только точный `analysis-stage-result-v1` с нулевым output и явными dispositions, поэтому orchestration завершается честным `PARTIAL` без синтетических OCR/metadata/entities/rules/evidence;
- migration `012_analysis_release_manifests.sql` добавляет immutable `analysis_releases`, backfill legacy release IDs и FK от runs/jobs; новый scaffold release канонизируется и хешируется API, фиксирует запрет внешней сети и все provider slots как `UNCONFIGURED`, а claim передаёт worker только slot текущей stage;
- два полных Docker overlay `laptop`/`server` поднимают application stack и выбранные provider runtimes: PostgreSQL 17 + pgvector 0.8.6, PaddleOCR/PDFium document sidecar, checksum-locked Qwen model store, sentence-transformers CPU embeddings, Bonsai/llama.cpp на laptop и Qwen3-VL-8B/vLLM на одном H100; init-контейнеры отделены от internal runtime network, model volumes read-only, base images digest-pinned, secrets генерируются в profile-specific env, server имеет GPU admission/ordered startup, launcher делает hardware preflight, а smoke проверяет render/OCR/VLM/embedding и deny-egress; H100-профиль требует реального smoke/soak, а stage adapters ещё не подключены;
- terminal worker failure под тем же inspection/run lock каскадно переводит незавершённых descendants в `CANCELLED` с `PREREQUISITE_FAILED`, завершает run как `FAILED` и пишет versioned `stage.finished`; transient failure сохраняет `BLOCKED` descendants и использует серверный retry schedule;
- PostgreSQL integration test поднимает отдельную временную БД, применяет `001`–`012`, проверяет immutable release manifest и stage-specific slots, полный provider-neutral DAG, отсутствие OCR-job для полностью кандидатного v2 text layer, динамическую OCR-вершину для legacy/неоценённых страниц, blocked claim, fenced input download, immutable manifest refs, отказ для неверной geometry и поддельной quality metric, серверные artifact hashes/schema discriminators, DB-level append-only, compact job results, atomic child activation/outbox, transient retry, terminal descendant cancellation, worker auth/capability, heartbeat, idempotent complete, stale fence после lease expiry, stale-scope cancellation, reconnect, durable coverage и запрет изменения sealed run;
- исправлены две найденные integration-test гонки: повторный concurrent start после ожидания lock теперь возвращает действующий run, а обрыв idle `pg.Pool` соединений при рестарте БД больше не завершает API-процесс; безопасные read-запросы имеют ограниченный retry только для connection/admin-shutdown ошибок.
- PostgreSQL-adapter читает сохранённые rule/review rows, последнее append-only решение и версии протокола в organization scope; integration test подтверждает их сохранность после принудительного reconnect и запрет UPDATE для decisions/protocols;
- JSON export протокола возвращает сохранённый snapshot, а не пересобирает старую версию из изменившихся findings; demo draft также проверен на неизменяемость;
- legacy `author` больше не считается доверенной личностью: demo использует явного `Демо-инспектор`, а NORMAL-команда получает actor только из серверной сессии;
- отдельная expand migration `003_identity_scope_audit.sql` добавляет users, organization/object memberships, только hashed session/CSRF tokens, command receipts и append-only audit events; миграция не содержит seed credentials и имеет отдельный destructive rollback reference.
- добавлены login/session/logout с opaque session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` по environment), отдельным CSRF token, scrypt password verifier и rate limit входа; БД хранит только хеши session/CSRF tokens;
- чтение отдельного NORMAL finding скрыто object scope, а решение требует organization capability `REVIEW_DECIDE`, object permissions `READ`+`REVIEW_DECIDE`, CSRF, `If-Match` и `Idempotency-Key`;
- authoritative review command блокирует inspection → active sealed run → review item, проверяет evidence fingerprint, пишет append-only decision, immutable receipt и hash-chained audit в одной транзакции; actor/timestamp задаёт сервер;
- replay того же command key возвращает сохранённый ответ до stale-version проверки, смена payload даёт `409`, stale ETag — `412`; конкурентный тест двух инспекторов подтверждает один commit и один `412` без lost update.
- operator CLI создаёт/ротирует локального пользователя и назначает organization/object scope транзакционно; пароль и его hash не печатаются, повторное provision увеличивает `auth_version` и инвалидирует прежние сессии.
- все текущие legacy GET для NORMAL object/upload/check/findings/coverage/protocol/submission проверяют серверную сессию и активный object membership с `READ`; отсутствие сессии даёт `401`, чужой или отозванный scope скрывается как `404`, а публичный `DEMO_SEED` остаётся доступен отдельно;
- список объектов без сессии содержит только demo; сессия с недействительным token не понижает запрос до анонимного, а возвращает `401`;
- create NORMAL-object требует сессию, CSRF, `Idempotency-Key` и роль инспектора/руководителя либо явную `OBJECT_CREATE`; объект, inspection, membership создателя с `READ/UPLOAD/RUN/REVIEW_DECIDE/FINALIZE`, command receipt и hash-chained audit записываются одной транзакцией;
- upload/start/reprocess NORMAL-команды требуют `Idempotency-Key`; повтор с тем же содержимым возвращает прежний upload/object/run с `Idempotency-Replayed`, а несовместимое повторное использование ключа отклоняется. Регистрация upload либо run, receipt и audit атомарны в PostgreSQL;
- upload/start/reprocess/finalize NORMAL-маршруты требуют сессию, CSRF, операционную роль/явную capability и соответствующий object permission; PostgreSQL повторно проверяет `UPLOAD`/`RUN` внутри mutation-транзакции, а `FINALIZE` — перед предметным gate;
- authoritative finalize блокирует inspection → active run → review items, проверяет `If-Match`, exact decision-set hash, отсутствие pending decisions и evidence fingerprints; для `PARTIAL` дополнительно требует exact gaps hash и явное основание;
- immutable protocol snapshot, его внешний `snapshotHash`, durable command receipt и hash-chained audit создаются одной PostgreSQL-транзакцией; повтор с тем же ключом возвращает прежний протокол до stale-version проверки, другой payload конфликтует, а новый finalize после закрытия inspection запрещён;
- `POST /api/protocols/{id}/revoke` требует роль `SUPERVISOR`/`ADMIN`, object permission `REVOKE`, CSRF, `If-Match` и `Idempotency-Key`; одной транзакцией сохраняет append-only причину, переводит прежний FINAL во внешнее состояние `REVOKED`, открывает inspection и создаёт новый DRAFT с lineage на неизменяемый snapshot/hash;
- migration `004_protocol_revocations.sql` применена к текущему Compose volume; integration test подтверждает stale-version отказ, replay/conflict, ровно одну запись revocation/receipt/audit, неизменность старого hash и запрет UPDATE записи отзыва;
- web-экран протокола показывает отозванную версию, причину и новый черновик; форма отзыва видна только руководителю/администратору, а сервер отдельно повторно проверяет object scope;
- migration `005_protocol_canonical_artifacts.sql` добавляет append-only artifact точных `inspector-c14n-v1` JSON bytes; FINAL и созданный отзывом DRAFT сохраняют artifact/hash в той же транзакции, scoped download отдаёт сохранённые bytes с ETag и `X-Content-SHA256`;
- integration test сравнивает canonical bytes до/после отзыва, проверяет hash, отдельный artifact нового DRAFT и DB-level запрет UPDATE; web показывает download сохранённого snapshot отдельно от динамического envelope `/export`;
- единый migration runner применяет все нумерованные SQL-файлы под PostgreSQL advisory lock, хранит checksum в `schema_migrations`, распознаёт полностью установленную legacy-схему и fail-closed отклоняет partial install или изменённый уже применённый SQL;
- Compose запускает отдельный одноразовый `migrate` перед API, поэтому и новый, и существующий volume проходят один gate при каждом deployment; ошибка миграции блокирует старт API;
- после schema gate выполняется идемпотентный bounded backfill canonical artifacts старых протоколов: JSON заново канонизируется, точные bytes хешируются и вставляются только при совпадении с неизменяемым `snapshot_hash`; integration test подтверждает backfill bytes/hash и повторный no-op;
- web-клиент использует реальную server session: экран профиля выполняет login/logout, показывает полученного от API пользователя, а не статического actor, и после смены сессии заново загружает доступный object scope;
- все текущие web-mutations отправляют CSRF из отдельного cookie, включая JSON-команды и multipart upload; create/upload/start дополнительно получают отдельный command key, а неавторизованные create/upload entry points переводят пользователя на экран входа;
- runtime/OpenAPI-контракт дополнен фактическими session/CSRF/403/404/503 вариантами для scoped маршрутов; PostgreSQL integration test проходит полную read-матрицу для anonymous, authorized, out-of-scope и запрещённой ML-роли.

Проверено локально: `npm run check` (38 API-тестов, 4 PostgreSQL-теста штатно пропущены без отдельного URL; 8 web-тестов; 21 worker Python-тест и provider unit tests; typecheck и production build); `laptop` и `server` проходят `docker compose config`. Provider suite теперь проверяет exact-size download/import, exact model/Paddle cache inventory, raster limits, text runtime и server GPU admission. Отдельный `test:postgres` ранее прошёл 4/4 и на временной БД применил `001`–`012` тем же runner. Lightweight model-store и GPU-admission images собираются и исполняют lock/budget validation. Тяжёлые Paddle, sentence-transformers, Bonsai/vLLM images и inference с реальными весами в этом срезе не запускались: preflight корректно блокирует текущий host с менее 20 GiB свободного диска. Поэтому full provider smoke реализован, но на этом host не выполнен. Новый extractor smoke на реальном 32-страничном PDF ранее создал `document-text-v2` artifact на 157088 bytes: text layer найден на 31 странице, 31 получила `TEXT_LAYER_CANDIDATE`, одна — `OCR_REQUIRED`. Существующий Compose volume остаётся на `009`; миграции `010`–`012` и полный RabbitMQ smoke в этом срезе на нём не запускались. Provider-neutral job со статусом `SUCCEEDED` означает только принятый stage-disposition artifact, а не выполненный inference. B05 остаётся частичным: admin UI/API отсутствуют. B07 остаётся частичным до stage adapters, реальных page render/OCR/link/rules/evidence outputs, chunked artifact commit, явной отмены jobs из domain commands и alert rules/runbook. В B15 ещё не реализованы compensation delivery/jobs при отзыве, protocol render/PDF, полный состав секций/ревизий источников/шаблона/подписей и gates незавершённых upload/jobs. Event schemas пока runtime-only, generated client отсутствует.

## Что есть

- React-прототип пользовательского пути: объекты, загрузка, сводка, карточки, решения, протоколы и каталог.
- Node.js/Fastify API, импорт каталога 132 параметров и десяти публичных примеров.
- Реальный streaming ingest: SHA-256, проверка расширения/MIME/сигнатуры, ClamAV fail-closed, дедупликация, immutable bytes в local/S3 storage; дополнительные проверки DOCX/XML.
- Python workers с PDF text-layer extraction, versioned page qualification, детерминированным сравнением переданных значений, abstention при недостаточных данных и durable claim/complete/fail protocol.
- SQL-схема и Docker Compose с migration gate, PostgreSQL, RabbitMQ, outbox relay, rules worker и document worker.
- Переносимые Docker overlays `laptop`/`server`: полное приложение, pgvector, PaddleOCR/PDFium, VLM, embeddings/reranker, model provisioners, internal inference network и online/offline runbook.
- Автоматические тесты компонентов/API/worker и изображения отдельных страниц для демонстрационного viewer.

## Существенные ограничения

| Область | Фактическое поведение |
|---|---|
| Новый анализ | Seed больше не переносится. PDF text layer извлекается, сохраняется и постранично квалифицируется. Профиль по умолчанию `SCAFFOLD` даёт `PARTIAL` и 132 `UNSUPPORTED`. Изолированный пилот `PILOT_PZ002_PZ017` исполняет два ограниченных правила и на проверенных F0150/F0201 дал 130 `UNSUPPORTED`, две `PARTIAL`, 0 findings. Render/link/evidence stages и полный OCR остаются незаполненными либо ограниченными пилотом. |
| API contract | Текущие 29 legacy/internal операций связаны с каноническими runtime/OpenAPI-схемами; целевой `/api/v1`, выделенные event schemas и generated client ещё отсутствуют |
| Persistence | Normal objects/uploads/manifests/runs/coverage, review decision, finalize и revoke commands, а также чтение сохранённых review/decision/protocol snapshots имеют PostgreSQL-adapter; versioned migration gate обновляет fresh/existing Compose volume и восстанавливает проверяемые canonical artifacts старых протоколов. Migration/reconnect/restart, concurrent review и command replay для этих срезов пройдены. Без `DATABASE_URL` остаётся memory fallback |
| Worker integration | Локально доказан полный persisted provider-neutral DAG: dependencies хранятся в PostgreSQL, OCR-job создаётся только при необходимости, child до prerequisite имеет `BLOCKED`, complete атомарно сохраняет immutable text/stage artifact и активирует следующий job через outbox, а terminal failure каскадно отменяет descendants. V2 page qualification и обе OCR-ветки проверены PostgreSQL integration, но не повторным полным RabbitMQ smoke. Heartbeat/fence защищают commit; relay отдаёт backlog/lag/job/retry/expiry metrics. Реальные providers для render/OCR/link/rules/evidence, chunked artifact commit, явная domain-command cancellation и alert rules/runbook ещё отсутствуют |
| Coverage/confidence | Ledger содержит все 132 позиции: `SCAFFOLD` показывает 132 `UNSUPPORTED`, протестированный пилот — 130 `UNSUPPORTED` и две `PARTIAL`. Ни один пилотный вывод не объявлен полной отрицательной проверкой; калиброванный confidence отсутствует. |
| Finalization/protocol | JSON finalize транзакционно создаёт immutable snapshot, canonical JSON bytes, durable receipt и audit. Revoke сохраняет append-only причину, открывает inspection и создаёт lineage-DRAFT с собственным artifact, не меняя старый FINAL/hash/bytes. Ещё нужны отмена/компенсация delivery/jobs, protocol render/PDF outbox flow, полный состав snapshot, gates незавершённых работ и безопасный перенос решений при reprocess |
| Viewer | Для загруженного PDF доступны оригинал, проверенный по SHA полноформатный лист и увеличенный фрагмент вокруг неклассифицированного геометрического предложения. Есть просмотр источников и отдельная история решений по предложениям. Полная привязка evidence, редакций и классов элементов ещё не реализована. |
| Дозагрузка | UI-путь не обеспечивает требуемое продолжение текущей проверки с безопасным переносом решений |
| Identity/audit | Все текущие NORMAL HTTP reads скрыты server session + object `READ`; mutations дополнительно требуют CSRF, role/capability и object permission. Create/upload/start/reprocess, review, finalize и revoke имеют durable command receipt и transactional hash-chained audit; review/finalize/revoke защищены `If-Match`. Aggregate concurrency остальных команд и admin UI/API ещё отсутствуют |
| Submission | Schema участников найдена и закреплена; официальный scorer/matching отсутствуют. Локальный scorer v1 реализован, текущий export после review не является независимым прогнозом |
| Ingest readiness | Нужны structural PDF validation и согласованный proxy/API лимит для крупных загрузок |
| ML/эксплуатация | Оба provider runtime-профиля упакованы, но adapters к stage contracts, configured release manifest, реальный CUDA/OCR/VLM inference smoke, GOLD/model gate, измеренные quality/SLO, recovery и ИАИС не подтверждены |

Это работающая демонстрационная основа и частичный ingest, а не готовый автоматический инспектор на 132 параметра. Сильные стороны сохранены; исправления перечислены в [плане реализации](architecture/12_DELIVERY_AND_ACCEPTANCE.md).

## Проверки при аудите

`npm ci --ignore-scripts`, TypeScript checks, 18 API-тестов, 5 web-тестов, 4 Python-теста и отдельная production build прошли; `npm audit` показал 0 уязвимостей на момент аудита. Это не доказывает предметную точность, полноту ТЗ или отсутствие других дефектов.

Общий `npm run check` в Windows остановился на shell-синтаксисе `PYTHONPATH=...`; Python-тесты запускались отдельно. Docker CLI в окружении отсутствовал, Compose end-to-end не проверен. История точных команд — в разделе 10 аудита. При подготовке архитектуры эти тесты повторно не запускались, поскольку код не менялся.

## Дальше

Точка входа — [ARCHITECTURE](ARCHITECTURE.md). Перед объявлением функции реализованной обновить этот статус ссылкой на принятый B-item, фактический тест/артефакт и ограничение покрытия. Не переносить формулировки из целевой спецификации в раздел «работает» без проверки.

## Проверка с локальной моделью на homeserver, 24 сентября 2026

На RTX 2080 SUPER запущена закреплённая Bonsai 2 27B. Исходные PDF из `TRAIN_PUBLIC` сверены с manifest по размеру и SHA-256; три контрольные пары страниц прошли отдельный локальный текстовый model probe. Во всех трёх Bonsai вернула `INSUFFICIENT_EVIDENCE` при положительной публичной разметке, поэтому предметная полнота пока не доказана. Одностраничный vision-probe на реальном листе дал неверно прочитанные термины. Подробности и отчёты — в [homeserver smoke](operations/HOMESERVER_SMOKE.md).

На той же тестовой машине основной API/worker/outbox DAG обработал две пары исходных PDF: 177+36 и 177+676 страниц; recovery после истечения lease проверен фактической повторной доставкой. Последний run завершился за 404 секунды в лимите 2 GiB для document-worker. Итоги остались `PARTIAL`, все 132 параметра `UNSUPPORTED`, findings отсутствуют. Локальная модель пока не подключена к stage adapters/release manifest. Эти прогоны доказывают ingest, durable orchestration и inference endpoint по отдельности; они не являются полной сквозной ML-проверкой. H100-профиль и его производительность не запускались.

25 сентября 2026 локальная квалификационная цепочка впервые проверена одним процессом на исходных `TRAIN_PUBLIC` PDF: manifest SHA → text layer → PDFium render → PaddleOCR → Bonsai → дословные цитаты/проверка OCR bbox → отчёт с публичной меткой после inference. Добавлен лёгкий `homeserver` OCR-профиль без tables/orientation, отдельный Compose для уже provisioned моделей и offline cache verification. На `F0201` p.50 OCR восстановил 122 строки при почти пустом text layer; HTTP-ответ уменьшен примерно с 280 МБ до 27,7 КБ после исправления сериализации PaddleX. На трёх известных положительных кейсах Bonsai вернула `INSUFFICIENT_EVIDENCE`; модельные результаты остаются `NOT_ACCEPTED_PROBE_ONLY`. Это рабочий provider/evaluation path, но номера листов задаёт публичная метка, а приложение всё ещё не вызывает модели из своих stage adapters. Полные команды, измерения и ограничения: [локальный model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

В тот же профиль подключена CPU Qwen3-Embedding-0.6B с offline проверкой 10 артефактов. Независимый поиск по всем 889 страницам трёх исходных TRAIN_PUBLIC PDF обработал 73 кандидата за 1000,55 с. Шесть публично подтверждённых листов сохранились среди кандидатов, но заняли позиции ПД/РД 3/3, 5/5 и 3/13: top-1 поиск ошибся во всех трёх кейсах. На шести выбранных top-1 листах затем выполнены live OCR и Bonsai. Выбранные листы не совпали с публичной парой (0/6); два ответа `INSUFFICIENT_EVIDENCE`, один JSON обрезан лимитом 512 токенов, в двух отказах все 7 цитат привязаны к исходному text layer/OCR. Локальные модели технически работают, но текущие linking/retrieval policy, сравнение и CPU-время не проходят предметный gate. Этот отдельный smoke не меняет `SCAFFOLD` release или 132 `UNSUPPORTED` основного приложения. Методика и отчёты — в [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На том же `TRAIN_PUBLIC` дополнительная Qwen3-VL-4B Q4 локально распознала подпись и графический контур тёплого пола на ПД для помещений `267/270` и не нашла аналогичный контур в изолированных областях РД; соседнее `277` прошло отрицательный контроль после отдельного crop. OCR при 200 dpi подтвердил подпись ПД и маркировку радиатора РД. Это первый **локальный визуальный кандидат** по двум публичным примерам, сохранённый только как `NOT_ACCEPTED_PROBE_ONLY`: листы/области выбраны вручную, на общем crop модель ошиблась в привязке к соседнему помещению, а полный поиск отсутствующего элемента и stage adapters ещё не реализованы. В [model probe](operations/LOCAL_MODEL_PROBE_20260925.md) записаны SHA, ответы, отрицательный контроль и границы результата.

Структурный отбор страниц на тех же трёх публичных парах поднял нужные листы в top-1 для 4/6 этапов, в top-2 для 5/6 и в top-6 для 6/6. Он использует признаки схемы/плана и раздела документа до чтения публичного ответа; результат пока offline probe, а не часть основного DAG. Следующий локальный gate на homeserver — автоматическая локализация комнаты и выносок в top-6, визуальное сравнение Qwen3-VL-4B с OCR/text layer и проверяемый evidence bundle. H100 доступен только при финальной проверке организаторов; до неё производительность и качество измеряются на RTX 2080 SUPER. Подробности в [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На следующем локальном опыте `TRAIN-0002`–`0005` структурный поиск поставил нужный лист ПД первым в 4/4 проверках, лист РД — на местах 2/1/1/1. Автоматический поиск комнаты на ПД выделил четыре замкнутые области; внутри всех четырёх цветовой детектор и Qwen3-VL-4B увидели красно-синий контур. Без текстовой подсказки модель полностью прочла подпись группы лишь в 2/4 ответах; номер нужно независимо сверять с text layer/OCR. Соседняя комната `277` дала отрицательный сигнал детектора, модель воздержалась. Это помещения одной пары документов. В РД строгий поиск границ не сработал, поэтому отсутствие элемента и предметный finding не подтверждены. Оба скрипта остаются отдельными `NOT_ACCEPTED_PROBE_ONLY`; основной release всё ещё `SCAFFOLD/UNCONFIGURED`, 132 параметра `UNSUPPORTED`. Отчёты и команды: [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На другом публичном кейсе `TRAIN-0001` локатор создал 10 crops из 12 top-6 кандидатов, но не нашёл замкнутую комнату ни на одном: вентиляционный лист содержит открытую схему с выносками. Для этой ветки нужен отдельный поиск связи оборудования с помещением. Подробности: [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

Проверен состав доступной обучающей разметки: 30 286 автоматических боксов описывают текстовые поля, подтверждённых evidence-аннотаций только 20, открытых проверок 15 на двух объектах. Поэтому следующий ML-опыт — небольшой детектор символов с ручной разметкой и объектно изолированной оценкой; полноразмерное дообучение VLM пока не имеет надёжной предметной выборки. [Решение и критерии опыта](operations/DRAWING_MODEL_TRAINING_DECISION.md).

Независимый [аудит TRAIN_PUBLIC-разметки](operations/TRAIN_PUBLIC_ANNOTATION_AUDIT_20260925.md) проверил все 30 318 строк структурно и визуально все 20 gold/12 second-review рамок: gold обозначает номера помещений или область листа, не контуры инженерных элементов. Из 1112 автоматических рамок за пределами страницы часть объясняется нестандартным MediaBox/CropBox, часть остаётся непригодной для обучения без ручной проверки. Подготовка обучающих меток символов остаётся отдельной работой.

## Офлайн-пилот маршрута и PZ-002, 26 сентября 2026

В worker добавлен отдельный воспроизводимый пилот для открытых `TRAIN_PUBLIC` PDF: SHA/размер по `document_manifest.jsonl`, `document-text-v2`, подбор листов по атомарному правилу, локальный OCR только для страниц `OCR_REQUIRED`, извлечение общей площади здания, `Decimal`-сравнение ПД/РД и локаторы evidence с раздельными PDF/OCR координатами. Неизвестная редакция, согласование, смешанная стадия, иной объект, подменённый хеш/значение/единица, неполный OCR-поиск и неустановленная связь источников дают abstention. `NEGATIVE_VERIFIED` отключён до достоверной проверки полного scope. Проверка: 47 Python-тестов; Docker build/CLI; два синтетических PDF через реальное извлечение текста дали кандидат при 100/102 м². Подробности и команды — [пилот](operations/PARAMETER_ROUTING_PILOT_20260926.md).

На момент первого офлайн-пилота это ещё не было подключено к normal-run API. Этот исторический статус изменён последующими работами ниже: исходные конкурсные `TRAIN_PUBLIC` PDF проверены на homeserver, durable PZ-002 и локальный OCR запущены. Предметная точность и H100 по-прежнему не заявляются.

Для подключения downstream stages добавлен внутренний `GET /api/internal/v1/jobs/:id/text-artifacts/:sourceFileId`: API отдаёт сохранённый canonical JSON `document-text-v1/v2` только по действующему lease/fencing token и source из immutable manifest того же run, сверяя размер, SHA-256 содержимого и SHA-256 исходного PDF. Worker-клиент дополнительно проверяет заголовки, байты и схему `document-text-v2`. На предыдущем срезе прошли TypeScript typecheck, 38 API unit tests, 4 PostgreSQL integration tests и 50 Python tests. В следующем срезе этот клиент подключён к пилотному правилу; `SCAFFOLD` по-прежнему не создаёт предметных выводов.

## Опциональный durable-пилот PZ-002, 26 сентября 2026

Для новых NORMAL-run добавлен opt-in `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002`. API фиксирует отдельный immutable `DRAFT` release с хешем определений правила; worker получает их только через lease, читает уже сохранённые `document-text-v2` по действующему fencing token, при необходимости обращается к локальному document-ai за OCR и исполняет PZ-002 без чтения публичных меток. Миграция `013_pilot_rule_results.sql` разрешает append-only ненулевой rule artifact и статус coverage `PARTIAL`. Seal сохраняет один `rule_results` для PZ-002, 131 `UNSUPPORTED` и PZ-002 `PARTIAL`. Обычный `SCAFFOLD` остаётся режимом по умолчанию и регрессией проверен.

Миграция `014_source_review_snapshots.sql` добавила append-only решения инспектора об актуальности, согласовании, связи источников и стадии смешанных PDF. Аутентифицированный `POST/GET /api/objects/:id/files/:sourceFileId/source-review` проверяет object scope, SHA исходного файла, CSRF и idempotency. Новый run фиксирует хеш выбранного решения в manifest, а lease получает неизменяемый snapshot. Позднее изменение решения не меняет уже запущенную проверку.

API независимо проверяет `CANDIDATE` PZ-002: перечитывает все сохранённые блоки `document-text-v2`, требует ровно одно значение площади в ПД и РД, две актуальные согласованные редакции с общей группой связи, совпадение локаторов, единиц, fingerprint и превышение строго 1%. Только такой текстовый кандидат создаёт `rule_results` и `review_items` и появляется в `/api/checks/:id/findings` со статусом `CANDIDATE`; решение принимает инспектор. OCR-кандидаты durable worker переводит в `CLARIFICATION_REQUIRED` с сохранением локаторов: серверной независимой проверки рендера и строк OCR ещё нет. Неподтверждённые источники дают abstention. `NEGATIVE_VERIFIED` отключён до достоверной проверки полного scope. Это не доказанная точность на конкурсных документах и не завершённая проверка всех 132 параметров; visual, metadata/linking/entity/evidence adapters и 131 другое правило остаются открытыми.

Добавлен второй путь извлечения PZ-002 для строк таблицы, где подпись, единица и значение находятся в разных text blocks. Worker повторно разбирает только найденные маршрутом страницы исходного PDF, требует совпадения всех блоков с immutable `document-text-v2`, сохраняет три строковых локатора и отказывается от неоднозначной строки. Для автоматического `CANDIDATE` дополнительно требуется отдельный локальный OCR того же листа, который видит ту же подпись и число на одной строке; без него правило воздерживается. API повторяет проверки текстовых ячеек, OCR-строк и fingerprint. Бюджеты `PZ002_MAX_TABLE_PAGES` и `PZ002_MAX_TABLE_OCR_PAGES` не скрывают непроверенные страницы. OCR-бюджет также направляется на страницы около предметных попаданий с чередованием релевантных стадий. Полный run на homeserver `CHK-1E3D8D30` сохранил два факта с исходных `TRAIN_PUBLIC` F0150/F0201, 10/10 jobs завершились, но `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`, 0 findings. Run `CHK-71B5BB7B` проверил новый порядок OCR внутри штатного DAG: выбраны F0150 p.29 и F0201 p.9, новых фактов нет, 10/10 jobs `SUCCEEDED`, два исходных факта сохранены. В `CHK-A9C2743D` штатный worker выполнил дополнительный OCR F0150 p.26 и сохранил подтверждение строки с hash артефакта; 10/10 jobs `SUCCEEDED`, итог по правилу остался `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`, 0 findings. Подробности — [журнал homeserver](operations/HOMESERVER_SMOKE.md#строка-таблицы-в-полном-durable-прогоне).

Во время длинного DOCUMENT_TEXT_LAYER RabbitMQ прекращал соединение после пропущенного AMQP heartbeat. Consumer вынес вычисление из потока Pika и возвращает подтверждение сообщения через `add_callback_threadsafe`. На homeserver повторный полный `CHK-B93E6F4C` сохранил тот же hash rule artifact, 10/10 jobs завершились с одной попытки; у document/rules worker перезапусков не было. Это локальный RTX 2080 SUPER smoke, а не проверка стенда H100.

Проверено локально: PostgreSQL integration на временной PostgreSQL 17 (миграции через `014`, отказ поддельному кандидату, полный второй run с двумя источниками и finding через API), отдельные unit tests серверной проверки, Python worker tests, `npm run check`, оба Compose config и сборка API/worker/web Docker-образов с закреплёнными base digest. После этой локальной проверки выполнен отдельный прогон на homeserver, описанный ниже. Производительность H100 не проверялась.

## Офлайн-проверка шаблонного поиска на чертежах, 26 сентября 2026

На homeserver выполнен [воспроизводимый поиск по растровым шаблонам и векторной геометрии PDF](operations/DRAWING_TEMPLATE_PROBE_20260926.md) на трёх сверенных `TRAIN_PUBLIC` PDF. Собрана экспериментальная хешированная библиотека из трёх образцов; поиск с ней выдаёт тот же список кандидатов, что и исследовательский режим, без чтения разметки. На F0202 p.17–18 найдены все четыре отмеченных радиатора: векторная проверка поддержала 68/69 растровых предложений, отдельный векторный локатор предложил 79 областей. На вентиляционном F0201 p.18 из 71 растрового предложения ни одно не прошло геометрическую проверку; векторный локатор также выдал 0. Спиральный шаблон на F0171 p.99 нашёл две отмеченные области, одна из них исходная. Локальная Qwen3-VL-4B ошибочно назвала похожий воздуховод радиатором; этот пример сохранён как регрессия и остаётся abstention. Это проверка локатора, а не полные precision/recall: известные области не исчерпывают лист и относятся к одному объекту. `NORMAL`, coverage и findings этим кодом не меняются; обучение модели не запускалось.

Для 79 векторных предложений собран и сохранён [пакет просмотра](../datasets/templates/experimental-public-v1/review/review-index.json): пять контактных страниц, ID, координаты, SHA исходного PDF, отчёта и изображений. Все 79 фрагментов просмотрены визуально; они похожи на радиаторы PRADO, но статус остаётся `UNREVIEWED` до независимой проверки. Генератор отвергает закрытый split, чужой PDF и невалидную геометрию. Это подготавливает оценку качества, не выпускает детектор в `NORMAL`.

На всех 36 страницах F0202 тот же векторный локатор дал 138 предложений: 58 на p.16, 54 на p.17, 25 на p.18 и одно на p.20; остальные страницы без предложений. Все 138 фрагментов собраны в десять контактных страниц и визуально просмотрены. p.20 — прибор PRADO на схеме; автоматической связи с помещением у этого фрагмента нет. Совпадение координат трёх пакетов с полным отчётом и SHA всех изображений проверены.

Три PDF второго открытого объекта извлечены из архива и сверены с manifest. На F0122 (70 страниц) шаблон из F0202 дал одно визуально ложное предложение на красной трубе с арматурой; на F0131 (21) и F0132 (77) — 0. Локальная Qwen3-VL-4B тоже ошибочно назвала трубу радиатором. Для такого переноса режим визуальной проверки возвращает `ABSTAIN_CROSS_OBJECT_STYLE_UNVERIFIED`, несмотря на согласие двух сигналов. Это не позволяет объявить библиотеку переносимой между объектами. Двенадцать focused Python tests прошли на homeserver; локальный Python не имеет `cv2`, поэтому тесты зависимостей запускались в изолированном remote venv. Полной независимой разметки нет, результаты не являются precision/recall или основанием для изменения coverage.

Добавлен офлайн-срез [связи кандидата с выноской](operations/DRAWING_TEMPLATE_PROBE_20260926.md#связь-с-выноской-первый-исполняемый-срез): на homeserver локальные OCR и геометрия синей линии связали семь выбранных предложений F0202 p.17 с конкретной строкой PRADO и моделью; восьмой, со схемы p.20, остановлен `ABSTAIN_NO_LEADER`. Это `REVIEW_REQUIRED`, без комнаты и без вывода ПД/РД. Скрипт отвергает библиотеку другого объекта до OCR. Пять новых unit tests прошли локально. В durable `NORMAL` адаптер пока не подключён; полнота листа, ошибка связи с помещением и качество на независимом объекте не измерены.

После точечной проверки выполнен [полный офлайн-прогон F0202 p.17](operations/DRAWING_ROOM_LINK_PROBE_20260926.md): 54 геометрических предложения, 43 связи с OCR-выноской, 21 кандидат чёрного номера группы помещения для review. Из 21 кандидата создан хешированный пакет просмотра. Отдельный OCR четырёх красных окружностей после удаления их штриха прочитал `233.1`, `233.2`, `234.1`, `234.2`; геометрия и луч через перегородки предложили точный подномер для 8 приборов, остальные 46 остановлены. Создан пакет восьми фрагментов с SHA и статусом `UNREVIEWED`. Для кандидата 76 растровая маска пропустила стену; проверка двух параллельных чёрных векторных линий PDF исключила соседнее `234.1`, оставив `234.2` для review. Это не измеряет precision/recall: нет независимой полной разметки и переноса на другой стиль. ПД/РД по найденным приборам ещё не сопоставляются; `NORMAL`, coverage и findings не меняются.

Следующий полный лист F0202 p.18 прошёл тот же локатор и локальный OCR выносок: 25 геометрических предложений, 24 связи с PRADO и 14 кандидатов чёрной группы помещения. Для 14 собран хешированный пакет карточек, все `UNREVIEWED`. Две красные окружности содержат целые `254` и `256`, их OCR выделен отдельным режимом `integer`; оба номера слишком далеко от ближайших кандидатов для автоматической связи. Чёрные группы p.18 визуально правдоподобны, но точный `room_id` не принят. Пакет восьми подномеров p.17 теперь воспроизводится отдельным генератором с повторной проверкой SHA исходных crop. Детали и ограничения — в [протоколе комнат](operations/DRAWING_ROOM_LINK_PROBE_20260926.md).

Добавлен [fail-closed оценщик локатора](operations/DRAWING_EVALUATION_GATE_20260926.md) с проверкой полного человеческого review выбранных листов, SHA входов и максимальным одно-к-одному сопоставлением рамок. На homeserver повторный F0202 p.17–18 дал 79 предложений, независимый F0122 p.45 — одно; оба отчёта честно вернули `NOT_ESTIMABLE`, потому что полные листы ещё не размечены человеком. Семь focused tests проверили отказ для неполной разметки, скрытого split, подменённых кандидатов и SHA, а также учёт дублей/пропусков. Для всех трёх листов создан хешированный обзор с нанесёнными рамками предложений; три теста генератора прошли на homeserver. Локатор и оценщик остаются offline: durable visual stage, review в API, предметная точность и H100 пока не подтверждены.

## Реальный durable-прогон PZ-002, 26 сентября 2026

Изолированный homeserver smoke-проект переключён на `PILOT_PZ002`, миграции `013/014` применены, web/API/worker пересобраны. Лимит исходного PDF повышен до 100 MiB согласованно в контракте, API, ClamAV и web proxy после реального HTTP 413 на 62 364 734-байтном F0150. Через пользовательский API загружены два проверенных исходных `TRAIN_PUBLIC` документа одного объекта: F0150 (ПД) и F0201 (смешанный РД/ИД). Run `CHK-64A1D37B` завершил 10 jobs с `SUCCEEDED`, сохранил ненулевой артефакт PZ-002, результат `PARTIAL` с 131 `UNSUPPORTED` и одной `PARTIAL` строкой, 0 findings. Отсутствие finding не считается отрицательным результатом: 398 страниц помечены для OCR, а основная таблица ПД разбита на отдельные текстовые блоки. Подробности, команды и ограничения — в [журнале homeserver](operations/HOMESERVER_SMOKE.md#durable-pz-002-на-проверенных-исходных-документах-26-сентября).

По проверенным PDF создан [пакет просмотра общей площади](../output/pz002-public-review-20260926/review.json): F0150 p.26 — 11 618,27 м²; F0201 p.14 — 11 030,3 м²; предварительная разница 587,97 м² (около 5,06%). Статус пакета `MEASUREMENT_PREVIEW_ONLY`. Стадия конкретного листа смешанного F0201, редакции, согласование и связь двух источников не подтверждены; в публичных контрольных проверках нет PZ-002. Это не доказанное нарушение и не метрика точности. Геометрическая привязка ячеек таблицы и независимая серверная проверка OCR остаются открытыми.

После подключения внутреннего локального `document-ai` повторный immutable run `CHK-673B2639` также завершил 10/10 jobs успешно. В `RULE_EVALUATION` сохранены 1 текстовый факт РД, 2 OCR-артефакта для первых страниц ПД, 396 отложенных OCR-страниц, итог `MISSING_EVIDENCE/REQUIRED_STAGE_FACT_MISSING`, 0 findings. Целевой офлайн-OCR F0150 p.26 и F0201 p.14 распознал оба значения на изображениях; полные отчёты приложены к пакету просмотра. В этом историческом run привязки трёх ячеек таблицы и целевого порядка OCR ещё не было; новый результат описан выше.

Экран результатов NORMAL-run теперь ведёт к проверке исходных документов. Инспектор видит список файлов и SHA, скачивает исходный PDF, вносит основанное на документе решение о редакции, согласовании, связи файлов и стадии страниц смешанного РД/ИД, затем запускает новый immutable run. Для уже загруженного РД или ИД доступна привязка второй стадии через интерфейс: браузер перед отправкой сверяет размер и SHA-256 выбранного PDF с оригиналом. API возвращает права `upload/review/run` для конкретного объекта, экран показывает действия по ним. Серверные маршруты списка и загрузки оригинала проверяют READ-scope; PostgreSQL integration покрывает файл, статус решения, права на действия и чужой объект. На homeserver через web proxy скачан и сверен по SHA-256 полный F0201 (43 033 348 байт); тестовый reviewer с `SOURCE_REVIEW` получил 409 на неверный hash, решение не сохранилось. F0201 зарегистрирован также как ИД по тому же SHA без нового source ID, но **постраничная классификация и статусы документов ещё не утверждены**. Локально прошли `npm run check` и 5 PostgreSQL integration tests. Порядок воспроизведения — в [журнале homeserver](operations/HOMESERVER_SMOKE.md#проверка-исходных-файлов-в-приложении-26-сентября-2026).

Новый run `CHK-9E8EF1CD` после регистрации двух стадий завершил 10/10 jobs с первой попытки и сохранил `STAGE_SEGMENTATION_REQUIRED`: пока 676 страниц F0201 не размечены человеком, правило не относит их к РД и не создаёт finding. Headless Chrome проверил реальный экран с двумя файлами и полем постраничной стадии; [скриншот](../output/pz002-public-review-20260926/source-review-ui-20260926.png). Итог остаётся `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings; H100 не проверялся.

Затем [самостоятельно проверен F0201](operations/F0201_SOURCE_AUDIT_20260926.md) по открытому manifest, текстовому слою и изображению p.14. Сохранено append-only решение для 9 подтверждённых страниц РД и 667 `UNRESOLVED`; редакция, согласование и связь с ПД оставлены неизвестными. Контракт, API, интерфейс, маршрутизатор и независимый verifier поддерживают такую неполную карту без догадок о стадии остальных листов. Финальный повторный `CHK-4672F74B` после пересборки worker завершил 10/10 jobs с первой попытки, нашёл предметный текст на подтверждённой p.14 и сохранил `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`: `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. 303 из 305 OCR-страниц текущего scope отложены. Положительного заключения о нарушении ещё нет.

Отдельный браузерный тест добавления второй стадии через UI выполнен на новом smoke-объекте `OBJ-FA65BC97` с исходным F0201 только как РД. Первый полный run `CHK-7C1FC2DC` завершился `PARTIAL` с 131 `UNSUPPORTED` + PZ-002 `PARTIAL`. Браузер выбрал тот же 43 033 348-байтный PDF, проверил размер/SHA-256 и загрузил как ИД; сервер сохранил один источник с тем же ID `FIL-B50EA8B8`. Повторная загрузка оригинала прошла SHA-проверку, решение о редакции/согласовании осталось отсутствующим (`404`). [Скриншот UI после операции](../output/pz002-public-review-20260926/source-stage-upload-ui-20260926.png). Это проверяет связь стадий через UI, но не подтверждает классификацию страниц человеком.

## Визуальные предложения в durable run, 26 сентября 2026

В пилотных release подключён `ENTITY_EXTRACTION`: worker сверяет исходный PDF по SHA-256, ищет ограниченное число геометрических областей и сохраняет append-only артефакт `VISUAL_PROPOSAL_SCAN`. Сервер сверяет идентификаторы, SHA, число страниц, координаты и профиль с immutable manifest. Артефакт не содержит finding или покрытия. Текущий профиль v4 просматривает все страницы PDF до 1024 включительно; для большего файла выбирает 1024 детерминированных страницы и явно записывает непросмотренные. На один файл сохраняется не более 500 предложений. v4 отдельно сохраняет подсказку о разделе из первых двух титульных страниц; она не классифицирует найденные области. Исторические v1 (`SKIPPED_PAGE_LIMIT`), v2 (выборка 64 листов) и v3 (полный проход без подсказки) доступны через тот же API. `NORMAL` без пилотного профиля не получил неподтверждённых выводов.

На homeserver изолированный run `CHK-7B010C54` для проверенного `TRAIN_PUBLIC` F0202 (36 страниц) завершил 10 jobs, сохранил 160 **неклассифицированных** предложений, `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. API читает сохранённый результат по праву доступа к объекту. Экран показывает предложения и исходный лист PDF с рамкой выбранной области; сервер перед рендером повторно сверяет байты оригинала. [Снимок просмотра листа 17](../output/f0202-visual-proposals-20260926/preview.png). Браузерный smoke проверил загрузку изображения и положение рамки внутри листа. Этот метод соответствует конкретному красно-синему векторному стилю F0202 и не доказывает класс прибора, полноту листа, precision/recall или отсутствие элемента. Подробности и команды — в [homeserver smoke](operations/HOMESERVER_SMOKE.md#durable-визуальные-предложения-на-f0202-26-сентября).

Историческая регрессия v1 на F0150 + F0201 (`CHK-5C362232`) завершилась `PARTIAL` с прежними 131 `UNSUPPORTED` и одной `PARTIAL`, без findings. Визуальный артефакт v1 записал `SKIPPED_PAGE_LIMIT` для обоих источников (614 и 676 страниц, по 0 просмотренных листов и предложений).

После перехода на v2 повторный immutable run `CHK-BECA7EB7` завершил 10/10 jobs за 488 с: `PARTIAL`, 131 `UNSUPPORTED`, одна `PARTIAL`, 0 findings. Артефакт `4fb2134b-facc-450e-a92a-b932246383da` (SHA-256 `446a35d8791440c63a89f7896db31144ed2dd811f888df238c7a26c8fe9ceaf6`) показывает `PARTIALLY_SCANNED_PAGE_LIMIT`: просмотрены 64 из 614 страниц F0150 и 64 из 676 F0201; 550 и 612 страниц соответственно не проверялись. На выбранных листах метод не нашёл геометрических предложений. Это измерение **не** доказывает отсутствия приборов: метод привязан к красно-синему векторному стилю F0202. API smoke проверил оба источника и manifest, браузер показал границу выборки [на экране объекта](../output/large-source-visual-v2-20260927/ui.png).

Полный v3 run `CHK-3D6C7BB3` после отдельного обновления `extract-worker` завершил 10/10 jobs за 552 с: `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. Артефакт `89f0737b-7518-4c98-94a8-08fbc37b0438` (SHA-256 `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436`) сохранил `SCANNED` на всех 614 страницах F0150 и 676 страницах F0201. Найдено 2 геометрических совпадения на F0150 p.566 и 20 на F0201 p.31, 34–39 — те же количества, что при отдельном полном диагностическом проходе. Примеры являются геологическим разрезом и вентиляционными схемами, а не доказанными отопительными приборами. API проверил оба публичных исходника, preview PNG и отсутствие findings; браузер открыл [F0150 p.566](../output/large-source-visual-v3-20260927/f0150-page-566.png) и [F0201 p.36](../output/large-source-visual-v3-20260927/f0201-page-36.png). Первый v3 run `CHK-F5FD7782` остался `FAILED` из-за старого образа `extract-worker`; исправление и повтор описаны в [журнале](operations/HOMESERVER_SMOKE.md#durable-визуальные-предложения-на-f0202-26-сентября). Полнота по страницам не равна полноте обнаружения элементов: нужны другие стили локатора, контекст листа и независимая разметка целых листов.

Для предложений добавлена отдельная append-only история решений инспектора (`KEEP_FOR_REVIEW`, `REJECT`, `UNSURE`). Запись требует права на объект, CSRF, ключ повтора и точного совпадения активного run, артефакта, исходного SHA и порядкового номера области. Она не меняет findings, coverage и статус проверки. Миграция `016`, 6 PostgreSQL integration tests и браузерный просмотр формы на homeserver прошли. На F0202 в тестовой среде записано одно явно помеченное `UNSURE` для проверки записи и повторного запроса; findings остались 0. Это **не** экспертная разметка класса и не оценка precision/recall.

Загрузка PDF теперь проверяет структуру через Poppler до принятия файла, включая страницу, шифрование и ошибки синтаксиса. Для F0201 отдельно создана read-only очередь текстовой проверки стадий: 9 листов с явным признаком РД, 114 почти пустых, 421 vendor, 2 коммерческих и 130 прочих; эти группы не являются постраничным решением о стадии. Чистый модуль PZ-017 извлекает нагрузки из двух контрольных страниц, но не подключён к durable verdict: значение горячего водоснабжения на РД отсылает к ВК, а стадия/редакция не подтверждены.

## Проверенный пилот PZ-017 и увеличенный просмотр, 27 сентября 2026

PZ-017 подключён к отдельному immutable release `PILOT_PZ002_PZ017`, сохраняя предыдущий `PILOT_PZ002`. Worker читает только закреплённые `document-text-v2` исходники, а API независимо сверяет SHA, страницу, текст блока, bbox и постраничную стадию. При несовпадении состава компонентов результат остаётся `CLARIFICATION_REQUIRED`, без расчёта общей нагрузки и без finding. Старый исторический текст выше описывает состояние **до** этого подключения.

На изолированном homeserver повторная проверка `CHK-A72D41AE` завершила 10/10 jobs с `SUCCEEDED`. Release `release:pz002-pz017:a823dcaddd8a93e4c65e3dea` сохранён с manifest hash `ca0fe584d816c3e48bf7c928eed3b412e3204d36846a7817ed84eb8ecff37adb`. Из открытых `TRAIN_PUBLIC/INCLUDE` F0150 p.23 извлечены четыре компонента ПД (отопление 0,331; вентиляция 0,927; завесы 0,108; ГВС 0,6024 Гкал/ч), из F0201 p.14 — два компонента РД (отопление 0,335; вентиляция 0,926 Гкал/ч). Сохранённый результат: `ABSTAIN/COMPONENT_BASIS_MISMATCH`, 130 `UNSUPPORTED`, две `PARTIAL`, 0 findings. Это доказательство работы сквозного пути и корректного воздержания на этой паре, **не** подтверждение соответствия объекта. Новый визуальный артефакт совпал по content hash `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436` с предыдущим v3-прогоном. Общий `npm run check`, 7 PostgreSQL integration tests и реальный API smoke прошли.

Для предложений браузер показывает рядом целый лист и увеличенный фрагмент PDF. API до рендера сверяет полный исходный SHA, ограничивает размеры, время и параллелизм; класс остаётся неизвестным. Browser smoke прошёл на [F0150 p.566](../output/large-source-visual-v3-20260927/f0150-crop-square-ui.png) и [F0201 p.36](../output/large-source-visual-v3-20260927/f0201-crop-square-ui.png): обе области относятся к геологии/вентиляции, не к доказанным приборам отопления. Для F0150 первое увеличение было узким; исправленная версия дала PNG шириной 1198 px и пригодный для просмотра фрагмент.

Добавлен отдельный [оценщик durable visual](operations/VISUAL_PROPOSAL_EVALUATION.md) с проверкой оригинального PDF по открытому manifest, геометрии и полноты независимой ручной разметки листов. Двенадцать тестов прошли. Реальный артефакт F0202 p.17 с 160 предложениями дал [`NOT_ESTIMABLE`](../output/large-source-visual-v3-20260927/f0202-evaluation-not-estimable.json), поскольку полной независимой разметки нет; это не численная оценка precision/recall. 130 пунктов матрицы, классификация чертежей, надёжная связь с комнатами, предметное положительное срабатывание и H100-проверка остаются открытыми.

## Сквозной visual v4 и видимость пилотных результатов, 27 сентября 2026

Новый immutable run `CHK-8C6FFA72` на том же проверенном `TRAIN_PUBLIC/INCLUDE` комплекте F0150 + F0201 завершил 10/10 jobs успешно. Итог `PARTIAL`: 130 `UNSUPPORTED`, PZ-002 и PZ-017 `PARTIAL`, findings 0. Визуальный артефакт v4 `484c7798-5456-414b-813f-22098cbc191e` имеет content hash `c4993a6b4b2c9865d122f99b5bad67ee9bbe1e6243ca05a2fdae4d8a2df3b3c3`. Полный проход снова сохранил 2 предложения F0150 p.566 и 20 предложений F0201 p.31, 34–39. Контекст титула F0150 — `UNKNOWN` из-за нечитаемого текста, F0201 — `VENTILATION`; это подсказка о файле, не тип каждого листа. Оба исходника, полный PNG, увеличенный PNG, координаты и ноль findings проверены живым API smoke; [браузерный просмотр F0201 p.36](../output/large-source-visual-v4-20260927/f0201-v4-ui-20260927.png) подтвердил сохранение неклассифицированной области.

Экран покрытия теперь получает все 132 строки и показывает причины двух частичных и 130 неподдерживаемых параметров. Новый объектно защищённый `GET /api/checks/:id/pilot-results` читает сохранённые PZ-002/PZ-017: на активном run API вернул обе записи и шесть фактов тепловой нагрузки с страницами F0150 p.23 и F0201 p.14, `ABSTAIN/COMPONENT_BASIS_MISMATCH`; анонимный запрос получил 401, старый run — 404. При первом живом тесте маршрут ошибочно возвращал пустой список из-за отсутствовавшей пересылки через demo/normal repository; пересылка исправлена, добавлен её тест, повторный API и [браузерный smoke](../output/large-source-visual-v4-20260927/pilot-coverage-ru-20260927.png) прошли. В интерфейсе это явно названо частичным анализом, без утверждения о нарушении.

Для независимой проверки качества создан [просмотрщик полного листа](operations/INDEPENDENT_VISUAL_SHEET_ANNOTATION.md): F0202 p.16 рендерен из сверенного оригинала в 5796×8192 px без предложений модели, [браузерный снимок](../output/independent-visual-annotation-20260927/browser.png). Экспорт остаётся `UNREVIEWED`; модель не подтверждала ни одной метки. Оценщик v4 независимо пересчитал контекст из PDF и на реальном F0150 p.566 вернул [`NOT_ESTIMABLE/FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING`](../output/large-source-visual-v4-20260927/f0150-v4-evaluation-not-estimable.json). Численная точность распознавания по-прежнему неизвестна.

PZ-007 изучен по открытому manifest: ПД F0150 p.26 и F0156/F0157 подтверждает три надземных и один подземный этаж, но комплект РД АР этого объекта в разрешённой поставке отсутствует; F0201 содержит лишь перечень отсутствующих чертежей. Поэтому правило сравнения этажности и finding не добавлены. H100 runtime по-прежнему недоступен для испытания; текущий стенд — homeserver с RTX 2080 SUPER.

## Ограниченный OCR и свободный поиск, 27 сентября 2026

Для профиля `PILOT_PZ002_PZ017` теперь настроен настоящий `DOCUMENT_OCR_LAYOUT`: локальный document-ai обрабатывает не более двух страниц `OCR_REQUIRED` за run, только PDF до 64 МиБ; API независимо сверяет release, manifest, источник, номера страниц, структуру OCR и счётчики, затем сохраняет append-only stage artifact. Миграция 017 расширяет допустимый disposition. Отдельная проверка обнаружила и исправила пропуск адреса OCR-сервиса именно у `extract-worker` в homeserver overlay. В laptop/H100 Compose этот адрес уже был задан на нужном worker. Весь этап остаётся ограниченным: сервер пока доверяет заявленному worker хешу рендера и не подтверждает правильность распознанных слов.

На homeserver новый `CHK-4CAE4879` завершил 10/10 jobs: `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. Из 398 требуемых OCR-страниц обработаны только F0150 p.1–2, 396 отложены. Артефакт OCR (7584 байта) имеет SHA-256 `ae6218bccf5694da924bed21b03fe4035ecb86d777908efa8c6132b00ea914c8`; оба text artifact сверены с хешами БД. Повторный API smoke сохранил прежние визуальные 2/20 неклассифицированных областей на 614/676 страницах, browser smoke показал факты и частичное покрытие. [Подробный журнал](operations/HOMESERVER_SMOKE.md#ограниченный-ocr-в-durable-run-27-сентября). OCR stage пока не используется PZ-002: его пилотный адаптер вызывает OCR отдельно.

Отдельный [офлайн-поиск FREE-HEATING-001](operations/FREE_HEATING_SUSPICION_PROBE_20260927.md) на сверенных `TRAIN_PUBLIC` F0171/F0202 сформировал один `SUSPICION`, 0 findings и не изменил матрицу 132. 13 страниц F0202 требуют OCR; отсутствие тёплого пола в полном РД не установлено. Сигнал пока не подключён к durable run, поскольку сервер не имеет отдельного проверяющего контракта для свободного поиска.

Независимый [OCR verifier](operations/BOUNDED_OCR_VERIFICATION.md) на homeserver пересоздал PNG из открытых оригиналов F0150 p.1–2 тем же PDFium 5.12.1 и сверил SHA-256/геометрию с сохранённым artifact: `SOURCE_RENDER_SCOPE_VERIFIED`, 2 страницы, `ocrLineTextVerified=false`. Правильность текста остаётся для эксперта.

Опциональный визуальный v5 прошёл [реальный run F0202](operations/VISUAL_V5_F0202_PROBE_20260927.md): 36/36 листов, 160 предложений, два локальных ответа Qwen на выбранные crop, 10/10 jobs, 0 findings. Оба ответа `OTHER_HINT` пришлись на фрагменты с видимыми подписями PRADO, поэтому такой ответ нельзя считать отрицательным доказательством. Независимый пересчёт crop из PDF прошёл; оценка качества остаётся `NOT_ESTIMABLE` без экспертной разметки всего листа. На H100 этот 4B-профиль не проверялся и не соответствует закреплённому там 8B runtime.

Отдельный [пробный разбор IOS4-077](operations/IOS4_077_SPEC_PROBE.md) на F0171/F0202 извлёк 16 строк спецификации ПД и 102 OCR-строки смешанного РД/ИД; семь обозначений моделей встречаются в обоих источниках. Результат `ABSTAIN`, finding отсутствует: OCR не подтвердил единицу мощности, а актуальность редакций, связи приборов и температурная база не проверены. Это исследовательский CLI, не durable-правило и не изменение покрытия 132 параметров.

Для IOS4-077 добавлен opt-in bounded срез `--observation-slice` с проверкой
публичных PDF по манифесту и отдельной схемой `CLARIFICATION_REQUIRED`.
На homeserver F0171 p.133 + F0202 p.26 дали 6 строк ПД, 24 частичные OCR-строки
смешанного источника, 2 лексических совпадения моделей и ноль сопоставимых
фактов/находок за 12 с. [Отчёт](../output/ios4-077-20260927/observation-slice-f0171-p133-f0202-p26.json)
имеет SHA-256 `6b3f8a357a732ff8c508e3093e00c5a616f9a366c42ba66d5a4fffa649d1f718`.
Покрытие durable run не изменилось; OCR и принадлежность листа РД требуют
ручной проверки.

Для H100 подготовлен отдельный [opt-in визуальный профиль v6](operations/VISUAL_V6_H100_PROFILE.md) под закреплённый Qwen3-VL-8B FP8. Локальные тесты и серверный Compose прошли; реальный ответ модели на H100 до проверки организаторов недоступен. Профиль v6 сохраняет ответ `OTHER` как воздержание, не как отрицательный вывод.

На homeserver завершён новый [полный run с OCR v2](operations/HOMESERVER_SMOKE.md#ocr-v2-и-повторный-полный-прогон-27-сентября) `CHK-75051E60`: 10/10 jobs, 130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. OCR обработал F0150 p.295 и F0201 p.30; независимая проверка оригиналов, выбора страниц, геометрии и PNG-хешей прошла. Однако оба листа оказались нерелевантны текущим правилам отопления/площади. Из 398 требуемых OCR-страниц 396 отложены. Профиль v2 доказал техническую работоспособность этапа, но не предметную полноту; требуется более строгий выбор контекста и просмотр распознанного текста.

Новый [полный run с OCR v3](operations/HOMESERVER_SMOKE.md#ocr-v3-листы-рд-ов-по-контексту-27-сентября) `CHK-1D9443FD` завершил 10/10 jobs, 130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. Из 398 OCR-требующих страниц v3 нашёл 3 предметных кандидата и обработал F0201 p.7–8 (90 и 85 строк); F0150 явно пропустил без контекста РД-ОВ. Отдельный проверочный скрипт подтвердил исходные публичные PDF, выбор страниц и повторный PNG-рендер (2/2); OCR-строки остаются неподтверждёнными. Выборочно видны верные названия отопительных приборов, но единица тепловой нагрузки прочитана с ошибками. Профиль H100 теперь требует v3 по конфигурации; сам H100 не проверялся. Покрытие и findings не улучшились: нерешённые стадии/редакции и отсутствие достоверной связи ПД↔РД не допускают утверждения о нарушении.

Экран [ручной сверки OCR](operations/BOUNDED_OCR_READ.md) теперь показывает
выбранную строку, её рамку на исходном листе и увеличенный фрагмент PDF.
Параллельный browser smoke F0150/F0201 на homeserver подтвердил автоматическое
восстановление после временного `429` рендера; F0201 p.7 и визуальный p.36
открылись. Это помогает эксперту проверять OCR, но не является автоматической
верификацией текста. Факты PZ-017 по-прежнему происходят только из текстового
слоя: OCR не повышается до факта или finding.

Добавлен отдельный [закреплённый OCR heat review aid](operations/OCR_HEAT_ROW_REVIEW.md).
Он получает OCR v3 через fenced internal read и сохраняет предложения либо
причины воздержания внутри RULE_EVALUATION; API повторно сверяет строки,
координаты, хеши и снимок решения о стадии листа. Первый новый полный
`TRAIN_PUBLIC` run F0171+F0202 `CHK-D905DD61` завершил 10/10 jobs:
130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. Сохранены 0 предложений и
4 воздержания `PAGE_STAGE_UNRESOLVED`; локальный Qwen через управляемый
Compose-сервис просмотрел 36/36 листов F0202, 160 геометрических областей и
2 выбранных crop. [Подробности](operations/HOMESERVER_SMOKE.md#ocr-heat-review-aid-первый-сквозной-run-27-сентября).
Второй полный run F0150+F0201 `CHK-9C474C9A` также завершил 10/10 jobs:
130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings; OCR сохранил 0 предложений и
4 воздержания. READ API обоих run проверен с авторизацией, а экран F0202
проверен в headless Chrome вместе со ссылкой на оригинальный лист.
[Скриншот OCR-подсказок](../output/ocr-heat-review-20260927/coverage-f0202-expanded.png).
Это техническое подтверждение цепочки, не положительная метрика распознавания
и не предметное доказательство нарушения.

Для конкурсного запуска на одном H100 добавлены [проверка фактически выбранного профиля и инструкция](operations/COMPETITION_H100_LAUNCH.md). Текущий `.env.server` остаётся `SCAFFOLD`; guard ожидаемо блокирует его как конкурсный запуск. Явный пилотный preset проверен на временной копии env и Compose, без H100 runtime.

## Новые проверяемые срезы и полный набор тестов, 27 сентября 2026

Исправлено наследование стадии для OCR-строк тепловой нагрузки: одностадийный
РД берёт стадию из immutable manifest, а смешанный комплект по-прежнему
требует проверенной карты страниц. Python worker и API независимо получают
закреплённый список стадий. PostgreSQL integration теперь содержит оба
положительных варианта и прошла 15/15 на временной БД homeserver. Отдельный
контракт передал **фактический вывод Python-экстрактора** в TypeScript-валидатор:
три корректных сценария приняты, четыре подмены отклонены локально и на
homeserver. Это тест алгоритма на fixture; OCR-текст реального PDF не
подтверждён. [Подробности OCR](operations/OCR_HEAT_ROW_REVIEW.md).

После обновления изолированных API и rules worker новый публичный reprocess
F0150+F0201 `CHK-EA02587C` завершил 10/10 jobs за 581 с. Итог не изменился:
130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings; смешанный РД/ИД
источник дал 0 OCR-предложений и 4 воздержания. RULE_EVALUATION и OCR v3
артефакты совпали по SHA-256 с предыдущим run на тех же данных.
[Журнал и хеши](operations/HOMESERVER_SMOKE.md#повтор-после-исправления-стадии-одностадийного-рд-27-сентября).

На исходных публичных PDF проверены три автономных предметных среза.
[KR-058/KR-059](operations/KR_SLAB_PUBLIC_PROBE.md) сохранил 30 наблюдений с
листами и рамками ПД F0106 / РД F0140 и F0144; зоны фундаментных плит и
элементы перекрытий пока не связаны, итог `ABSTAIN`, находок нет.
[PZ-004](operations/PZ004_VOLUME_PROBE.md) сохранил одинаковое напечатанное
значение объёма `60997,93 м³` на F0150 и F0201, но F0201 является смешанным
ОВ, тогда как каталог ожидает РД АР/КР; итог также `ABSTAIN`, находок нет.
[KR-055](operations/KR055_CONCRETE_PUBLIC_PROBE.md) отдельно сохранил 11
наблюдений классов бетона `B30/B40/B60` на F0106/F0139/F0140/F0141.
Сверка оригинала F0140 с. 27 показывает, что `B40` относится к спецификации
фундаментной плиты на отметке −13,750. Сопоставления отдельных конструкций
между редакциями пока нет; итог `ABSTAIN`, находок нет. Все три среза сверяют
исходные PDF по открытому manifest и не подключены к durable
release. Они не увеличивают заявленное покрытие 132 параметров.

Дополнительный read-only поиск для PZ-007 нашёл ПД-утверждения об этажности:
F0150 с. 26 и F0156/F0157 с. 16–17 для одного объекта (3 наземных этажа и
подвал), F0104 с. 10 для другого (корпуса на 19 и 16 этажей). Размер и SHA
исходных PDF сверены с открытым manifest. В доступном `TRAIN_PUBLIC/INCLUDE`
наборе нет самостоятельного РД/АР для этих объектов; листы РД/КР с плитами
подвала не задают общее число надземных этажей. Поэтому независимая пара для
сравнения PZ-007 не найдена и статус параметра не повышен.

Инвентаризация открытого manifest (`TRAIN_PUBLIC/INCLUDE`, PDF) даёт 202
документа: среди них 3 ПД/АР и 7 РД/КР, но **нет РД/АР и РД/ОВ как
одностадийных файлов**. ОВ встречается как ПД либо смешанный РД/ИД. Это
ограничивает реальную проверку ряда правил на доступном публичном наборе;
генерировать положительную метрику для всех 132 из него нельзя.
Открытая `public_train_checks.jsonl` содержит всего 10 размеченных проверок:
5 IOS4-078, 1 IOS4-079 и 4 FREE-HEATING-001. Для KR-055/058/059, PZ-004 и
PZ-007 в ней нет независимого положительного эталона. Этот файл допустим
только для открытой обучающей оценки; закрытые ответы и `TEST_HIDDEN` не
используются.

[Независимая проверка пяти IOS4-078](operations/IOS4_078_PUBLIC_CASE_AUDIT.md)
по исходным F0171/F0201 не подтвердила ни один положительный машинный результат
на указанных листах. В двух случаях различие обозначений подходит для ручной
проверки, но нет доказанной связи веток и редакций; один пример сопоставляет
помещения разных назначений, ещё один — листы разных этажей. Каталог ожидает
сравнения сечения воздуховодов в мм², а публичные формулировки описывают
отсутствие вытяжки или конфигурацию. Статус всех пяти по проверенным листам —
`ABSTAIN`; это не объявляет публичные метки ошибочными.

[Единственный открытый IOS4-079](operations/IOS4_079_PUBLIC_CASE_AUDIT.md)
также даёт `ABSTAIN`: ПД p.104 показывает теплоснабжение приточных установок,
РД p.17 — план подвала, но нет сопоставленной пары вентилятора с расходом,
давлением и мощностью. Штамп РД расходится с номером листа в публичной записи,
а страница смешанного источника остаётся `UNRESOLVED` в сохранённой карте.
Формулировка публичного примера о конфигурации не заменяет триггер каталога о
меньшей кратности воздухообмена.

[Воспроизводимая инвентаризация 132 кодов](operations/CATALOG_READINESS_PUBLIC.md)
закрепляет хеши трёх открытых JSONL и показывает для каждого код, исходные
требования к ПД/РД/ИД, counts документов-кандидатов и число публичных checks.
Всего 203 включённых публичных документа (202 PDF и один иной формат), шесть
checks по кодам каталога и четыре FREE-HEATING-001 вне каталога. Она сохраняет
2 `PARTIAL` и 130 `UNSUPPORTED`; наличие источника или метки не повышает статус.
Скрипт не проверяет сопоставимые пары и findings. Канонический `reportSha256`
`e0efa9a52d65dd313ea5dc5becd8ed5971d88fab07c335e7ef306cf182ec7885`.

[Матрица тестов](operations/TEST_MATRIX.md) теперь охватывает весь доступный
локальный набор: `npm run check` (API 113, web 13, worker 175 плюс сервисы и
сборка), `infra/tests` 7/7, `scripts/tests` 127/127, PostgreSQL 15/15.
H100 runtime и предметная точность по всем 132 параметрам остаются за
границей этих проверок.

## Общий контракт фактов и первые две группы правил, 27 сентября 2026

Добавлены `typed-fact-v1`, общий fail-closed comparator, извлечение из
зафиксированного `document-text-v2` для PZ-004/PZ-007 и KR-055/KR-058/KR-059,
а также независимая проверка результата в API. Новый opt-in release profile
сохраняет предложения в durable stage artifact и показывает их в
`/pilot-results` и интерфейсе как материал для ручной проверки. Он не
создаёт новых findings и не удостоверяет отсутствие нарушений. При его
включении текущий pilot ledger должен содержать 7 `PARTIAL` (PZ-002/PZ-017
и пять новых) и 125 `UNSUPPORTED`. PostgreSQL integration с миграцией 018
прошла 16/16, а полный durable run `CHK-B210F921` на открытых F0106/F0140
подтвердил именно 7/125, пять исходных фактов, пять `ABSTAIN`, ноль findings
и 10/10 успешных jobs. Это проверка сквозной доставки и сохранения, а не
положительная предметная метрика.

[Повторяемая проба TRAIN_PUBLIC](operations/FACT_FAMILY_PILOT.md) на исходных
F0106/F0140/F0144 после сверки SHA обработала 180 страниц, сохранила пять
локализованных предложений и пять `ABSTAIN`, findings `0`. Ложные кандидаты
из бетонной подготовки и шага арматуры исключены тестами на строках этих PDF.
Полная проверка 132 кодов, автоматическая связь конструкций, утверждённые
редакции и проверенный положительный результат на оригиналах пока не доказаны.
Ручная связь конкретных фактов теперь сохраняется как решение эксперта и
фиксируется в следующем immutable run/lease. PostgreSQL integration с
миграцией 019 прошла 17/17: синтетические ПД/РД факты прошли через POST,
повтор, снимок, worker `REVIEW_REQUIRED` и независимое чтение API. Отдельный
браузерный smoke на homeserver подтвердил форму и `GET /fact-links` с пустым
журналом реального `CHK-B210F921`; связь этих разнородных фактов не записана.
Явный `sectionCode` уже
сохраняется в source review и передаётся в immutable lease; старые решения
остаются `null` с прежним каноническим хешем. Новый раздел выбранного
источника проверен API, PostgreSQL и браузером homeserver.

[Реестр семейств 132 кодов](operations/PARAMETER_FAMILY_REGISTRY.md) имеет
5 review-only пилотов, 47 проектных кандидатов и 80 нерешённых. Он проверяет
полноту каталога, но не расширяет исполняемое coverage; 125 строк нового
профиля пока остаются `UNSUPPORTED`.

После миграции 019 повторный полный run F0106/F0140 `CHK-B8ACC123` сохранил
7 `PARTIAL`, 125 `UNSUPPORTED`, пять `ABSTAIN` и ноль findings. Общий
движок и независимый API verifier теперь проверяют направленное и
относительное увеличение; тесты охватывают строгий порог, отрицательную
разность и нулевую базу. PZ-010 (92 квартиры в F0101 p.10) и KR-061
(перечень толщин в F0141 p.4) сохранены только как отдельные наблюдения.
Отсутствуют подтверждённая пара стадий и привязка конкретного элемента,
поэтому новые правила и coverage для этих кодов не объявлены. Последний
полный `npm run check`: API 137/137, web 18/18, worker 241/241,
остальные сервисы и сборка; `infra/tests` 7/7, `scripts/tests` 127/127.

Следующим этапом был единый постраничный индекс 203 разрешённых публичных файлов
(202 PDF на 10 142 страницах и один TXT только как метаданные), затем
пакетная проверка семейств на исходных PDF. Индекс должен хранить текст,
геометрию, кандидаты таблиц/разделов и качество, а OCR-кеш — различать SHA
источника, страницу и версии рендера/модели. До проверки семейства на реальных
PDF сквозной release profile не расширяется.

27 сентября единый индекс построен и прошёл полный аудит `PASS`: 202 PDF,
10 142 страницы, 8 668 текстовых кандидатов и 1 474 страницы для адресного
OCR, ноль ошибок целостности. Адресный OCR F0106 p.5 прошёл `MISS_WRITTEN`
и повторный `HIT` с тем же content hash; отдельный OCR-адаптер сохранил
проверенные исходные строки и координаты этой страницы. Матрица 47 проектных
кодов нашла точные пары категорий ПД/РД по manifest только для KR-061/062/067;
для остальных разделы или стадия требуют подтверждения. Реальная первая
пачка KR-061/062 на 100 выбранных страницах дала только `ABSTAIN`, потому что
точная связь элементов отсутствует; поиск был усечён. Поэтому исполняемые
правила и coverage пока не расширены. Отчёты и ограничения — в
[индексе](operations/PUBLIC_DOCUMENT_INDEX.md),
[матрице источников](operations/CANDIDATE_SOURCE_MATRIX.md) и
[пачке КР](operations/KR_DECREASE_BATCH.md).

Вторая семейная пачка KR-067 также проверена на 100 выбранных страницах
десяти исходных PDF: 0 квалифицированных кандидатов по объёму бетона и
массе стали, 100 `ABSTAIN` на каждый атрибут; поиск усечён. Это
подтверждает отказ от произвольного склеивания табличных ячеек, а не
отсутствие расхождений. Детали — в
[отчёте KR-067](operations/KR_RELATIVE_DELTA_BATCH.md).

После первого лимитированного KR-061/062 запуска отдельно просмотрены все
521 индексных страниц десяти КР PDF, со сверкой SHA страниц. Среди 477
страниц текстового слоя нет строки с однозначной связкой целевого элемента,
этажа, зоны и размера; 44 страницы требуют адресного OCR. Причины
воздержания и опасные ложные совпадения — в
[проверке KR-061/062](operations/KR_DECREASE_FAMILY.md).

Повтор KR-067 с полностраничной проверкой геометрии завершился: 93 страницы
допустимы для поиска локальных табличных итогов, семь отказали по
некорректному bbox. Два проверенных по SHA наблюдения РД — 432 и 310 м³
бетона на разных листах; сопоставимого объёма ПД и связи конструкции нет,
поэтому фактов для сравнения и findings нет. Проверка кандидатов раздела на
всех 344 страницах индекса, где он был выделен, дала 80 предложений, но
ни одного подтверждённого раздела РД. Этот метод читает только эвристические
строки разделов, поэтому нулевой результат не означает отсутствия раздела:
титульные листы и шифры документов проверяются отдельно. Подробности — в
[пакете KR-067](operations/KR_RELATIVE_DELTA_BATCH.md) и
[предложениях разделов](operations/PUBLIC_SECTION_PROPOSALS.md).

Для всех 47 проектных кодов теперь есть каталожно закреплённые правила
сравнения `NON_EXECUTING_ABSTAIN` и три семейных группы кандидатов:
31 числовой код, восемь классов и восемь проверок состава/наличия.
Синтетический comparator прогоняет каждый из 47 кодов; основания раздела,
редакции и пары фактов требуют привязки к исходным SHA. Полные лексические
прогоны по 10 142 страницам выполнены для числовых и классовых меток;
для проверок состава использован FTS-поиск якорей с адресным просмотром,
который не доказывает отсутствия метки на остальных листах. Пять точных
совпадений метки относятся к четырём кодам PZ-002/PZ-008/PZ-022/SPZU-024,
но не проходят требования к источнику или нуждаются в проверке раздела;
43 дополнительных упоминания набора не имеют однозначной области. Очередь
из 1 474 страниц означает необходимость адресного OCR, а не отсутствие
параметра на этих листах.

[Сводка по 47 кодам](operations/PUBLIC_FAMILY_READINESS.md) валидирует
хеши трёх полных отчётов, точные пары категорий исходников для трёх кодов,
метаданные всех 203 документов и причины отказа по каждому коду.
Все 47 пока дают `ABSTAIN`: подтверждённых исполняемых фактов `0`, findings
и coverage не выводятся. SHA сводки
`7975e62c4dde6f1f363359c07be7745d610695e58485777c9a03f68afb73e84c`.
Обобщённый извлекатель табличной строки проверил все 29 страниц 18 PDF,
найденных FTS по 54 буквальным числовым подписям, без усечения. Он нашёл на
F0150 p.26: PZ-002 `11 618,27 м²` и PZ-008 `15,814 м` с координатами
метки, единицы и значения. Это адресные наблюдения для эксперта, а не
полная проверка всех форм записи в корпусе. Для PZ-002
проверка F0150/F0152/F0201 показала разные определения площади и отсутствие
подходящей РД/АР пары; [разбор](operations/PZ002_AREA_SEMANTIC_REVIEW.md)
запрещает превращать числовую разницу в нарушение.

Адресный OCR-кеш проверен на реальных страницах F0106, F0107 и F0150;
титул F0150 p.1 даёт предложение раздела ПЗ, но метаданные манифеста не
изменены. Новый OCR-адаптер допускает поиск меток 47 кодов по выбранным
SHA-проверенным строкам, оставляя результат review-only. Следующий шаг —
приоритетные OCR-страницы КР и остальные семейные пачки, затем сквозной
homeserver run с утверждённым, не повышающим coverage профилем.

Адресный OCR для KR-061/062 дополнительно проверил 10 новых и четыре ранее
закешированных листа из 44 `OCR_REQUIRED` в десяти КР-источниках. Тридцать
остальных оставлены в очереди с явными причинами; даже на обработанных
листах не удалось связать толщину или арматуру с тем же элементом ПД и РД.
[Отчёт](../output/kr-decrease-ocr-20260927/triage.json) имеет SHA-256
`b259025e14917db00ac3ed52c3786daa17d1d3b06842f15ad4c3165d95fce21f`.
Планировщик OCR для всех девяти семейств выбрал 47 уникальных страниц из
1 474 требующих OCR (144 связи «страница — семейство», лимит 16 на семейство)
и счётчик отсечённых лимитом связей. Сам план не создаёт
фактов и не утверждает отсутствие параметров.

Уточнённая очередь v2 выбрала 48 уникальных страниц с учётом роли источника.
Все 33 новые страницы прочитаны адресным OCR, ещё 12 были в предыдущей
пачке и три — в отдельной КР-проверке. На семи листах найдено 27 буквальных
совпадений; два крупноформатных листа успешно перечитаны при 115 DPI после
достижения лимита рендера при 120 DPI. Повторный запрос из кеша вернул тот же
SHA. За пределами этой ограниченной очереди 1 426 страниц `OCR_REQUIRED`
остаются неизвестными. Ни один OCR-лид не повышен до findings или coverage.
[Разбор OCR](operations/PUBLIC_FAMILY_OCR_V2_BATCH.md).

Run-scoped просмотр 47 кандидатных кодов добавлен к opt-in профилю как
`candidateFamilyPreview`: ровно одна строка `ABSTAIN` на код, до 16 исходных
лидов на строку, проверка SHA/страницы/раздела/редакции и независимый
TypeScript verifier. Он не меняет 7 `PARTIAL` и 125 `UNSUPPORTED`.
PostgreSQL integration 18/18 прошла на временной БД. На homeserver два
полных run с исходными F0105/F0136 после исправления rule adapter завершили
10/10 jobs: оба `PARTIAL`, 0 findings, 47/47 `ABSTAIN`. Headless Chrome
показал панель 47 кодов. Relay после найденного разрыва RabbitMQ получил
восстановление соединения; принудительное закрытие только его AMQP-канала
и новый полный run подтвердили работу. Подробные receipt и ограничения — в
[отчёте homeserver](operations/CANDIDATE_PREVIEW_HOMESERVER_20260927.md).

Семь семейных офлайн-пакетов для 80 `UNRESOLVED` кодов проверили КР, АР,
ПОС, инженерные схемы, ПЗ/СПЗУ, ПОД/ООС и остальные разделы. Итоговая
[сверка](operations/UNRESOLVED_PUBLIC_BATCH_SUMMARY.md) закрепила SHA всех
семи отчётов, ровно 80 уникальных кодов и три намеренных пересечения.
Все 80 остаются `ABSTAIN`: не доказаны совместимые стадии/разделы, редакции
и одинаковые элементы для сравнения. В инженерной, ПЗ/СПЗУ и ПОД/ООС
пачках часть тематических адресов отсечена лимитом и отмечена явно.
Текущий проект не заявляет предметную полноту 132 параметров или
готовность на H100.

Адресный [OCR-пакет для 80 кодов](operations/UNRESOLVED_TARGETED_OCR.md)
завершил 64/64 страниц с 0 итоговых ошибок и тремя повторными `HIT` по тому
же SHA артефакта. Из 1 474 `OCR_REQUIRED` страниц 1 410 вне его очереди
остаются неизвестными. Пакет дал 519 тематических строк на 46 листах для
27 кодов и 60 меточных совпадений на 19 листах для четырёх кодов из 47;
ни один OCR-лид не повышен до факта или покрытия.

Новый [пакет наблюдений](operations/CANDIDATE_OBSERVATIONS_PUBLIC_BATCH.md)
повторно сверил 202 публичных PDF и 10 142 страницы индекса по SHA и FTS,
прогнал все 47 кодов девяти семейств и честно сохранил 0 run-наблюдений:
проверенных `CURRENT/APPROVED` и раздела чертежа в открытом пакете нет.
Ручной [аудит пяти пар КР](operations/KR_PUBLIC_PAIR_AUDIT.md) показал
потенциально общие конструкции, но не доказал один физический элемент и
применимую редакцию; все пары `ABSTAIN`.

Opt-in `candidateFamilyObservations` теперь извлекает проверенные
локализованные строки, числовые typed-fact предложения и буквальные
классовые токены из того же
run-scoped текстового слоя, что и 47-кодовый preview. Независимый API
verifier перепроверяет SHA/локатор/единицу перед сохранением и чтением;
PostgreSQL integration прошла 19/19 на временной БД. Отдельный
[сквозной прогон homeserver](operations/CANDIDATE_OBSERVATIONS_HOMESERVER_20260927.md)
`CHK-CCA09CAC` завершил 10/10 jobs с первой попытки: `PARTIAL`, 7/125,
0 findings, 47 preview `ABSTAIN` и 47 observations `REVIEW_ONLY` без
лидов по причинам source review. Headless Chrome подтвердил экран.
Синтетический набор после добавления классов содержит 39 типизированных
предложений из 47 строк: 31 числовое и 8 классовых. Класс требует отдельно
проверенной шкалы; восемь кодов состава остаются без complete-set факта.
Синтетические тесты 47 правил и инфраструктурный guard не являются
оценкой точности на чертежах; H100 остаётся непроверенным.

Для bounded OCR v2/v3 добавлен [проверяемый durable кеш страниц](operations/DURABLE_OCR_PAGE_CACHE.md)
по SHA исходного PDF, физической странице и точным профилям рендера/OCR.
Тест адаптера подтвердил повторное использование без нового OCR и с
повторной проверкой исходных байтов. На homeserver реальный F0144 p.3
дал `MISS_WRITTEN/HIT` на локальном OCR sidecar; повторный durable run
через очередь дважды завершился 10/10 jobs с одинаковым OCR artifact hash
и без повторной записи кеша. Дополнительный
[визуальный аудит KR-059](operations/KR059_VISUAL_PAIR_REVIEW.md) подтвердил
`t=250` на плане РД, но не установил связь с конкретной зоной ПД;
сравнение остаётся `ABSTAIN`.

Добавлен отдельный [durable кеш текстового слоя](operations/DURABLE_TEXT_LAYER_CACHE.md):
повторный run того же PDF и `sourceFileId` повторно проверяет исходные
байты, но может использовать валидированный результат PDFMiner. Инвалидация
привязана к SHA кода извлечения и версии PDFMiner; локальные тесты прошли.
[Четыре homeserver run](operations/DURABLE_CACHE_E2E_20260927.md) дали
одинаковые хеши текстовых, OCR и rule артефактов. После заполнения обоих
кешей текстовая стадия сократилась с 460 до 3 с, OCR layout с 17 до 2 с,
rule evaluation с 41 до 17 с, весь run с 582 до 102 с; 10/10 jobs
завершились с первой попытки, но результат остался `PARTIAL` без findings.
Это замер на двух публичных PDF homeserver, не доказательство качества
сравнения и не прогноз времени H100.

[Полная очередь проверки титулов](operations/SOURCE_REVIEW_PACKET.md)
собрана для всех 103 неоднозначных источников матрицы 47 кодов: после
обновления из индекса v4 98 с титульными подсказками и пять без них. Она
дополняет приоритетный пакет 25,
сохраняя SHA и локаторы там, где они доступны. Семь источников
имеют буквальную марку нужного раздела, в том числе F0146 и F0150 после
адресного OCR; все 103 по-прежнему требуют
подтверждения стадии, раздела, редакции и согласования.
[Отдельно F0198](operations/F0198_MIXED_STAGE_VISUAL_REVIEW_20260927.md)
визуально показал РД-штамп и исполнительную отметку на той же p.1:
постраничная метка не может представить обе роли, поэтому источник
оставлен `ABSTAIN` до привязки фактов к областям листа.
Адресный OCR нижнего правого региона F0198 на homeserver прочитал 46 строк,
включая «ИСПОЛНИТЕЛЬНЫЙ», «РД» и «Отопление и теплоснабжение», пропущенные
текстовым слоем при 362 индексированных блоках. Повторный запрос вернул
`HIT` с тем же artifact hash. Это подтверждает необходимость региональной
привязки источника; стадия/редакция и предметный факт не установлены.
[Пачка F0197–F0200](operations/MIXED_STAGE_REGION_OCR_BATCH_20260927.md)
показала, что область штампа можно читать адресно для четырёх
`RD_ID_MIXED` листов: 58/46/52/70 строк соответственно. Все четыре
остаются `ABSTAIN`. Регионы всех четырёх визуально сверены с SHA исходных
PDF; это подтверждает две надписи на листе, но не применимую редакцию.
Отдельный [пакет локаторов](operations/MIXED_STAGE_REGION_OCR_BATCH_20260927.md)
связал каждую из двух надписей с разными crop-координатами для 4/4 PDF;
он оставляет все источники на проверке и не создаёт параметрические факты.
Подсказка `1=UNRESOLVED` для одного листа с РД и исполнительной отметкой
добавлена в Source Review и развернута в изолированном web homeserver;
типизация и 22 web-теста прошли, API health и web HTTP 200 проверены.
[Таблица ручной проверки](operations/SOURCE_REVIEW_PACKET.md) свела все
103 неоднозначных источника с четырьмя подсказками OCR по областям;
столбцы решений оставлены пустыми и не меняют source gates.

Полный [публичный индекс v4](operations/PUBLIC_DOCUMENT_INDEX_V4_20260927.md)
прошёл независимый аудит 203 источников и 10 142 страниц. Политика чтения
перенесла 93 страницы с CID-заглушками из кандидатов текстового слоя в
адресный OCR: теперь 8 575 `TEXT_LAYER_CANDIDATE` и 1 567 `OCR_REQUIRED`.
Повторная проверка 47 кодов на v4 остаётся лексической: 47/47
`NO_EXECUTABLE_FACT_ABSTAIN`, ноль исполняемых фактов, findings и coverage
не измеряются. Производственный выпуск сохраняет прежнюю закреплённую версию
набора меток; оригинальные PDF и новый индекс используются для review.

[Ограниченный OCR v4](operations/BOUNDED_OCR_V4_TITLE_RECOVERY.md) устранил
пропуск повреждённого титула F0153 в сквозном запуске: новый immutable run
обработал p.1–2 из 39 страниц `OCR_REQUIRED`; независимая сверка оригинала,
SHA артефактов и повторного рендера прошла. Все 47 кандидатных кодов
остались `ABSTAIN`, находок нет. Остальные страницы и пригодность OCR строк
для предметного сравнения требуют отдельной проверки.
Регрессия на открытом F0202 показала, что v4 сохраняет выбор предметных
p.7–8 и хеши их OCR-содержимого из v3; 10/10 jobs завершились с первой
попытки, независимая сверка PDF и рендера прошла. Обновлённая
[очередь проверки источников](operations/SOURCE_REVIEW_PACKET.md)
использует аудированный индекс v4: F0153 теперь имеет буквальную подсказку
стадии ПД, но раздел, редакция и утверждение остаются неподтверждёнными.
Все 47 кандидатных кодов сохраняют `ABSTAIN`.
Для восьми правил `PRESENCE_SET` добавлен [offline мост к проверенному
сравнению](operations/PRESENCE_FAMILY_CANDIDATES.md): отдельно подтверждённый
факт состава привязывается к исходному наблюдению и SHA, после чего
движок всё равно требует доказанную полноту обеих сторон и одинаковую
область поиска. Синтетические проверки восьми кодов дали только
`REVIEW_REQUIRED` при полном наборе доказательств и `ABSTAIN` при его
отсутствии; публичный корпус не получил новых фактов или findings.
Дополнительная проверка офлайн-моста запрещает сравнение наблюдения или
типизированного факта, чей `inputManifestHash` отличается от пакета.
Аргумент `reviewed_sets` вне `PRESENCE_SET` также отвергается. Локальный
worker-набор после SHA-связки прошёл 620 тестов, профильный модуль после
последнего изменения — 13. Это защита контракта, не подтверждение
пар ПД/РД на реальных документах.

Расширенный адресный OCR v4 на homeserver проверил все 105 страниц,
отобранных [очередью без пропусков по лимиту](operations/PUBLIC_DOCUMENT_INDEX_V4_20260927.md):
216 связей «семейство — страница», 14 982 OCR-строки, 42 буквальные
подсказки; независимый аудит 105 receipts и кеша вернул `PASS`.
Новое совпадение — контекстное слово, исполняемых фактов и утверждённых
пар ПД/РД по-прежнему нет. Полный локальный `npm run check` прошёл с
Python окружением `scripts/.venv` в `PATH`; старый 60-страничный отчёт
повторно прошёл обновлённый аудит.
В изолированном Compose выполнен регрессионный reprocess F0202
`CHK-892B92D9`: `PARTIAL` 7/125, 0 findings, пять сравнений
`ABSTAIN`, 47 preview `ABSTAIN`, 0 run-наблюдений. Расширенная offline
OCR-очередь в этот run не импортировалась; результат проверяет отсутствие
регрессии сквозного пути, а не новую предметную полноту.
Отдельный opt-in release profile теперь сохраняет review-only OCR sidecar
47 правил; API независимо проверяет его SHA, строки, геометрию, оценки,
решения по источникам и счётчики при сохранении, sealing и чтении.
PostgreSQL integration 20/20 и два Compose run на открытых F0202/F0153 прошли.
F0153 обработал OCR p.1–2 из 39 требующих, но не имеет утверждённого
источника для предметного лида; оба run сохранили 47 `ABSTAIN` и 0 findings.
Панель web с 47 кодами проверена headless Chrome на сохранённом F0202 run;
она показывает `ABSTAIN` и происхождение возможных OCR-подсказок.
Дополнительная сортировка 105 SHA-аудированных OCR receipts отделила 35
контекстных и 7 предметных буквальных совпадений; после свёртки написаний
остались четыре предметные OCR-строки на двух страницах. На оригинальных
публичных PDF проверены 14 выбранных совпадений: подпись кнопки находится
в легенде, приборы — в спецификации без доказанной пары/раздела, прочие
подписи дают только контекст или ошибку OCR. Все результаты остаются
`REVIEW_ONLY_ABSTAIN`; [протокол проверки](operations/PUBLIC_FAMILY_OCR_LEAD_TRIAGE_20260928.md).
Эти проверки подтверждают сквозной транспорт и отказ от неподтверждённых
выводов, но не качество извлечения или покрытие остальных 80 кодов.

Опциональный OCR v5 проверен сквозным Compose-прогоном F0202: три
предметно отобранные страницы p.7–9 против двух в v4, 10/10 jobs,
`PARTIAL` 7/125, 0 findings, 47 OCR-sidecar `ABSTAIN`.
[Независимая проверка](operations/BOUNDED_OCR_V5_PUBLIC_RUN_20260928.md)
сверила исходный PDF и повторный рендер всех трёх страниц; точность OCR-строк
и пригодность листа как утверждённого источника не установлены.

Для сохранённой OCR-стадии F0202 добавлен отдельный разбор строк таблицы:
16 review-only геометрических пар (p.7 — 3, p.9 — 13), оригинал p.9 визуально
сверён. Новый opt-in release сохраняет эти некодированные строки в run;
API независимо пересчитывает их из OCR-стадии при save/seal/GET, web
показывает происхождение. Изолированный Compose `CHK-1BD8477F` завершил
10/10 jobs, `PARTIAL` 7/125, 0 findings; авторизованный GET и browser smoke
прошли. Коды и типизированные факты не назначены; [протокол и SHA](operations/OCR_TABLE_ROWS_COMPOSE_20260928.md).
[Ручной журнал транскрипции](operations/OCR_ROW_TRANSCRIPTION_COMPOSE_20260928.md)
теперь реализован и проверен в изолированном Compose: миграция 020,
аутентифицированный GET 16 строк, отказ чужому fingerprint без записи,
браузерная форма с отключённым сохранением до действия человека. На реальном
F0202 решений в журнале 0. [Визуальная сверка p.7](operations/F0202_OCR_TABLE_P7_VISUAL_AUDIT_20260928.md)
нашла пропуск единицы `м³`, подмену знака `÷` и ещё одну отсутствующую
многострочную строку. Версионированный v2-извлекатель добавил четвёртую
некодированную пару p.7, не меняя v1. Изолированный Compose
`CHK-FA35FEA0`: 10/10 jobs, 17 OCR-строк, три воздержания, `PARTIAL` 7/125,
0 findings; API/offline совпали. Миграция 021 сохраняет проверенный
append-only снимок последних решений о транскрипции при новом run; в
реальном F0202 решений и снимков 0. [Протокол](operations/OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928.md).
[Следующая граница](operations/OCR_ROW_CONFIRMATION_GATE.md) — отдельное
решение о предметной применимости и OCR-локатор типизированного факта;
`TEXT_BLOCK` для OCR использовать нельзя.
Для ручного выбора раздела источника расширен словарь до всех кодов
47 кандидатных правил, включая 11 обозначений РД; миграция 022, UI и
PostgreSQL integration проверены. [Граница и проверка](operations/SOURCE_SECTION_RD_VOCABULARY_20260928.md).
Ни одному реальному источнику новый раздел автоматически не назначен.
Отдельный журнал предметной применимости OCR-строки реализован миграцией 023,
строгим API `GET/POST` и web-формой. Решение связывается с неизменяемыми
снимками транскрипции и источника и повторно проверяется по исходным OCR/rule
артефактам, PDF и SHA при записи и чтении. `APPLICABLE` требует подтверждённую
транскрипцию и актуальный утверждённый источник, а `UNSURE` и
`NOT_APPLICABLE` не дают права на факт. Положительный путь проверен только
на синтетической PostgreSQL fixture; реальных человеческих решений F0202 нет.
Миграция 024 добавила неизменяемый снимок последнего проверенного решения
о применимости в следующий run; отрицательное/неопределённое решение
перекрывает прежнее положительное. PostgreSQL suite с новым снимком 23/23;
изолированный homeserver reprocess `CHK-368C9D3C` завершил 10 jobs,
`PARTIAL` 7/125, 0 findings, 17 OCR-строк, три воздержания и 0 снимков
применимости, так как экспертных решений нет.
Чистый валидатор `typed-fact-v2` с отдельным локатором `OCR_ROW` и opt-in
read-only API заново проверяют origin/target решения, OCR и SHA. Локальный
положительный путь пока только синтетический; новый F0202 дал 0 кандидатов.
Старый read-only API не меняет сравнения. Локальный полный check этого этапа:
API 219 pass/26 skip, web 33, worker 648, сборка; PostgreSQL tests 24/24. Изолированный homeserver Compose применил миграции 022–024;
у публичного F0202 `CHK-FA35FEA0` авторизованный GET дал 0 кандидатов и
0 решений, неподтверждённый POST — 409 без записи.
[Граница](operations/OCR_ROW_CONFIRMATION_GATE.md) и
[сквозная проверка](operations/OCR_ROW_APPLICABILITY_COMPOSE_20260928.md).

Миграция 025 и отдельный opt-in release profile сохраняют неизменяемый
артефакт OCR_ROW кандидатов после снимков решений об источнике,
транскрипции и применимости. API заново выводит его из исходных артефактов
и решений при seal/GET и отвергает подмену. Старый `typed-fact-v1` и
сравнения не изменены. Полный локальный `npm run check` прошёл: API 219
pass/27 skip, web 33, worker 648, сборка; PostgreSQL integration 25/25,
отдельный синтетический положительный OCR_ROW тест также прошёл.
Изолированный Compose `CHK-927C1BB0` на открытом F0202 завершил 10 jobs,
`PARTIAL` 7/125, 0 findings, 47 кандидатных правил `ABSTAIN`.
Артефакт создан с нулём фактов и решений эксперта, поскольку в реальном
run таких решений нет. Это проверка сохранения и границ доверия, а не
предметной точности или полноты каталога. [Подробный протокол](operations/OCR_TYPED_FACT_DURABLE_20260928.md).

Отдельный OCR-table v3 добавил проверяемое продолжение подписи для
одной публичной строки F0202 p.7; API заново выводит составную подпись из
сохранённой OCR-стадии и проверяет каждую OCR-строку. Изолированный Compose
`CHK-8D62C98D`: 10/10 jobs, 17 некодированных предложений, три
воздержания, одно продолжение; headless Chrome подтвердил его происхождение
и пустую форму решения. Результат остался `PARTIAL` 7/125, 0 findings,
47 кандидатных кодов `ABSTAIN`, 0 OCR_ROW фактов и экспертных решений.
Полный локальный check: API 234 pass/28 skip, web 35, worker 658;
PostgreSQL integration 28/28. Для скалярных кандидатов API теперь
проверяет точные обозначения единиц и сохраняет регистр SI.
[Протокол и SHA](operations/OCR_TABLE_V3_PUBLIC_RUN_20260928.md).

Миграция 026, API и web добавили отдельный ручной журнал пары ПД/РД
`OCR_ROW` фактов. Положительный путь проверен только синтетически в
PostgreSQL; реальная публичная F0202 пара отсутствует. Полный локальный
check: API 237 pass/30 skip, web 38, worker 658, PostgreSQL 30/30.
Изолированный homeserver `CHK-761854B6`: 10/10 jobs, `PARTIAL` 7/125,
0 findings, 47 candidate `ABSTAIN`, 0 кандидатов пар и 0 решений.
API отверг подложный `PAIR_CONFIRMED` с 409, браузер показал пустую
панель без сохранения. [Граница и протокол](operations/OCR_FACT_PAIR_JOURNAL_20260928.md).

Для ещё двух `UNRESOLVED` кодов KR-056/KR-057 готов отдельный read-only
семейный срез: 10 исходных публичных PDF и 521 страница индекса v4 сверены
по SHA, четыре ключевые страницы визуально сверены с рендером. Обозначения
материала остаются лексическими наблюдениями; каждый элемент и связь
ПД/РД не подтверждены, статус `ABSTAIN`. Это не переводит коды в
покрытие. [Пакет и SHA](operations/KR_MATERIAL_REVIEW_20260928.md).

Миграция 027 добавила immutable снимок последнего решения о паре
`OCR_ROW` в новом run: оба факта повторно привязываются и получают новые
fact ID; `UNSURE` перекрывает старое подтверждение, пропавший факт
остаётся `TARGET_FACT_UNAVAILABLE`. Полный локальный check: API 245
pass/30 skip, web 38, worker 660; PostgreSQL 30/30. Изолированный
Compose F0202 `CHK-96F8AE32`: 10/10 jobs, `PARTIAL` 7/125, 0 findings,
47 candidate `ABSTAIN`, 0 реальных OCR_ROW фактов, пар и снимков.
Pure comparison preview для семи относительных правил ещё не подключён
к release, так как нет проверенного решения о количественном смысле.
[Протокол](operations/OCR_FACT_PAIR_SNAPSHOT_20260928.md).

Миграция 028 и отдельный API/web журнал добавили ручное решение о
количественной сопоставимости точной OCR_ROW пары после immutable снимка
следующего run. Сервер сам вычисляет evidence hash, сверяет артефакт,
источники, правило и локаторы при записи и чтении; клиентский hash не
принимает. Полный локальный `npm run check` и 30/30 PostgreSQL тестов
прошли. Изолированный homeserver F0202 `CHK-69B4215C`: `PARTIAL` 7/125,
0 findings, 47 candidate `ABSTAIN`, 17 некодированных OCR-строк,
0 пар и решений количества. Подложный положительный POST отвергнут 409,
браузер показал закрытую форму. Отдельный read-only comparator GET
перепроверяет журнал и отдаёт `REVIEW_ONLY` подсказки; на публичном run
их 0. Он не создаёт findings и coverage, поскольку нет подтверждённого
количественного решения на реальной паре.
[Протокол](operations/OCR_QUANTITY_REVIEW_COMPOSE_20260928.md).

Для `AR-042` отдельный review-only семейный пакет проверил три публичных
оригинала по SHA и 125 страниц индекса: 10 строк текстового слоя и 19
страниц с `OCR_REQUIRED`. Адресный OCR завершён для 19/19 страниц:
15 попаданий в кеш, четыре новые записи; 19 SHA рендеров и receipts
перепроверены. Два новых лексических лида визуально относятся к оконным
проёмам. Пороги и проёмы остаются локальными контекстами без доказанной
эвакуационной связи; весь пакет `ABSTAIN`, без finding и coverage.
[Пакет и независимый аудит](operations/AR_EVACUATION_HEIGHT_REVIEW_20260928.md).

Для `IOS2-072`/`IOS3-075` отдельный review-only пакет сверил исходные SHA
восьми разрешённых PDF и 293 страницы индекса. В 195 страницах с текстом
найдены 28 буквальных подсказок, включая пять однострочных совпадений сети
и материала. Адресный OCR выполнен для всех 98/98 страниц выбранного
среза: отдельно проверенная F0204 p.6 и ещё 97 страниц, 17 291 строка
на последних 97. Независимый аудит оригинальных PDF, кеша и повторных
PDFium-рендеров прошёл 97/97; 118 OCR-подсказок требуют просмотра.
Ошибки чтения, класс давления, стадия и идентичность ветви ПД/РД не
установлены. Итог `ABSTAIN`, 0 фактов, пар, findings и coverage.
[Пакет](operations/PIPE_MATERIAL_REVIEW_20260928.md).

Для `PPM-102`/`PPM-113` отдельный review-only срез сверил SHA четырёх
публичных PDF, 394 страницы индекса v4 и шесть исходных листов. Из 325
читаемых страниц получены 38 и 19 лексических строк. Все 69 OCR_REQUIRED
страниц обработаны; независимый аудит оригиналов, 69 receipts/кешей и
повторных рендеров прошёл. Из 11 431 OCR-строки один буквальный лид
визуально оказался названием ссылочного документа. Сопоставимой
утверждённой пары ПД/РД для одного отсека или сети нет. Оба кода `ABSTAIN`,
без фактов, findings и coverage.
[Пакет](operations/FIRE_SAFETY_REVIEW_20260928.md).

Для выбранных публичных КР и ПОС пачек адресный OCR также закрыт с
независимым SHA-аудитом: КР 44/44 страницы, 2 458 строк, ноль точных
однострочных размерных лидов; ПОС 19/19 страниц, 3 206 строк и 111
лексических подсказок. Проверены исходные ZIP/PDF, receipts, кеш и
повторные PDFium-рендеры каждой страницы. Положительных решений по шести
кодам ПОС и выбранным кодам КР нет; все остаются `ABSTAIN`, без findings
и coverage. [КР](operations/KR_TARGETED_OCR_20260928.md),
[ПОС](operations/POS_TARGETED_OCR_20260928.md).

После этих семейных проверок добавлен opt-in immutable run-пакет для
`AR-042`, `IOS2-072`, `IOS3-075`: лексические подсказки берутся только из
committed текстового слоя конкретного запуска, независимо сверяются API по
SHA и локаторам, отображаются в web как `ABSTAIN`. Изолированный homeserver
`CHK-04B3B7AA`: 10/10 jobs `SUCCEEDED`, общий `PARTIAL` 7/125,
0 findings, три новых кода `ABSTAIN`, 0 строк из-за отсутствия проверенного
`CURRENT`/`APPROVED` источника; браузерный smoke прошёл. Старый профиль
сохраняется. Результат не повышает offline подсказки до фактов.
[Протокол](operations/UNRESOLVED_FAMILY_RUN_COMPOSE_20260928.md).

Дополнительный изолированный Compose на тематическом публичном ПД/ВК
`F0163` проверил новый объект `OBJ-58FA0B7B` и run `CHK-0D43285B`:
исходный SHA PDF и 21 страница совпали с manifest, 10/10 jobs `SUCCEEDED`,
итог `PARTIAL` 7/125, 0 findings, три кода `ABSTAIN`/0 leads из-за отсутствия
проверенного решения по источнику. API и браузер прошли. Обнаруженное
различие внутреннего UUID и публичного `OBJ-*` при построении ссылки на
лист исправлено в web; прямой preview требует сессию и прошёл 200/401.
Положительная ссылка с реальным проверенным лидом ещё не наблюдалась.
[Протокол](operations/UNRESOLVED_FAMILY_TOPIC_COMPOSE_20260928.md).

Отдельный opt-in OCR v6 ограничивает адресное чтение четырьмя
`OCR_REQUIRED` страницами из immutable `CURRENT`/`APPROVED` источника
раздела АР/ВК. Worker и API независимо сверяют выбор страниц,
`document-text-v2`, снимки решений и SHA. Локальный полный check прошёл;
PostgreSQL проверил синтетический положительный источник и подмены.
В изолированном homeserver Compose на исходном публичном F0163 run
`CHK-6D761C86` завершил 10/10 jobs, `PARTIAL`, 0 findings: две страницы
отложены из-за отсутствия решения эксперта, 0 обработано. Авторизованный
GET, отказ анонимному запросу и браузерная панель прошли. Это проверяет
безопасное воздержание, а не качество OCR.
[Протокол](operations/OCR_V6_COMPOSE_20260928.md).

Отдельный OCR v6 sidecar для `AR-042`/`IOS2-072`/`IOS3-075` реализован
как review-only пакет с независимой проверкой на save/seal/GET;
локальный полный check и PostgreSQL синтетические/tamper тесты прошли.
На первом изолированном развертывании обнаружена и исправлена потеря
определения правила при передаче release в worker lease; добавлен
PostgreSQL регрессионный тест. Второй запуск выявил неполное копирование
OCR v6 загрузчика в изолированную копию worker; локальные и удалённые
SHA исполняемых файлов сверены после исправления. Новый F0163
`CHK-D85632B7` завершил 10/10 jobs, `PARTIAL`, 0 findings; sidecar
сохранил три `ABSTAIN` и ноль строк, так как нет подтверждённого
источника. OCR отложил две требующие страницы. Авторизованный GET и
независимая проверка SHA прошли, анонимный GET вернул 401; браузерная
проверка показала три `ABSTAIN` и ноль OCR-строк. Это транспорт и безопасное
воздержание, не предметная полнота или качество OCR.
[План](operations/OCR_V6_FAMILY_SIDECAR_PLAN_20260928.md) и
[протокол Compose](operations/OCR_V6_FAMILY_SIDECAR_COMPOSE_20260928.md).

Следующее семейство `SITE_TEP_AREA` для `PZ-001`, `SPZU-026`, `SPZU-027`
подготовлено отдельным opt-in профилем. Worker извлекает только точные
строки текстового слоя ПД/ГП из immutable проверенного источника; API
независимо пересчитывает локаторы, SHA, счётчики и полный пакет при
сохранении, sealing и чтении. Web показывает три `ABSTAIN` с происхождением.
Синтетический положительный пакет Python принят TypeScript валидатором;
PostgreSQL тест проверил положительный путь и подмены. Проверены SHA
оригинальных разрешённых F0126/F0154/F0155 и страниц индекса, но ни один
из них не получил экспертного `CURRENT`/`APPROVED` решения. Полный локальный
check после интеграции прошёл: API 278/278, web 62/62, worker 707,
сборка. Изолированный homeserver Compose на публичном F0154
`CHK-F71034FE` завершил 10/10 jobs, sealed `PARTIAL`, 0 findings;
три кода `ABSTAIN`/0 лидов без экспертного решения. Адресный OCR
отложил 8/8 требующих страниц. Оригинальные ZIP/manifest/PDF SHA,
авторизованный GET, независимый sidecar audit и браузерный просмотр
прошли; старый run не изменился. Это не проверка извлечения значений.
[Исходники и границы](operations/SITE_TEP_AREA_REVIEW_20260928.md),
[протокол Compose](operations/SITE_TEP_AREA_COMPOSE_20260928.md).

Для следующей пачки `SPZU-029/032/033/035/036` сделан отдельный
`SITE_GP_CONTEXT_TEXT` review-only профиль с точными строковыми
локаторами. Пять исходных листов F0126/F0154 визуально и по SHA
сверены; среди них есть таблицы слоёв и МАФ, но текущий профиль
сохраняет только навигационные строки. Локальный полный check:
API 282, web 64, worker 713, сборка PASS; PostgreSQL 11 файлов/35 тестов
PASS. Изолированный homeserver Compose на публичном F0126
`CHK-A97C4079` завершил 9/9 jobs, sealed `PARTIAL`, 0 findings:
OCR job не требовался, пять кодов `ABSTAIN`/0 лидов без проверенного
источника. Оригинальные ZIP/manifest/PDF SHA, авторизованный GET,
браузерный просмотр и прежний run проверены. Это безопасное воздержание,
не предметная полнота.
[Контракт](operations/SITE_GP_CONTEXT_REVIEW_20260928.md),
[визуальный аудит](operations/SITE_GP_CONTEXT_VISUAL_AUDIT_20260928.md),
[протокол Compose](operations/SITE_GP_CONTEXT_COMPOSE_20260928.md).

Для `SPZU-029/032` реализован отдельный review-only пакет предложений о
соседстве текстовых блоков таблицы. На SHA-проверенном оригинале F0126
p.20 получены 21 предложение и 3 неоднозначности по слоям дорожной одежды,
на p.21 — 11 предложений «позиция — наименование МАФ». Сохранённый
`document-text-v2` не имеет bbox строки/ячейки, поэтому каждая связь
`ROW_ASSOCIATION_UNVERIFIED`, количество МАФ `null`, оба кода `ABSTAIN`.
Worker/API/web opt-in профиль независимо проверяет immutable источник,
SHA текста, геометрию блоков, предложения и причины. Полный локальный
`npm run check` прошёл (API 285, web 66, Python suites, build);
последовательный PostgreSQL suite — 12 файлов/36 тестов без пропусков.
Изолированный homeserver F0126 `CHK-192193C0`: ZIP/manifest/PDF SHA
сверены, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, два
`ABSTAIN`/0 предложений без решения эксперта, auth API/browser PASS.
Старый GP stage сохранил SHA; его `pilot-results` API GET после повторной
обработки того же объекта возвращает 404 по документированной области
только активного запуска. Прямой SQL read подтвердил неизменность.
[Семейство](operations/SITE_GP_TABLE_ROW_REVIEW_20260928.md)
и [Compose](operations/SITE_GP_TABLE_ROW_COMPOSE_20260928.md).

Следующее семейство `EQUIPMENT_SPEC` для unresolved `IOS4-077`,
`IOS4-079`, `PPM-112` прошло предметный review-only аудит оригинальных
F0171/F0202 по SHA и шести листов. Найдены настоящие строки спецификации,
расчётные подписи и ложные реестровые совпадения. Pure worker извлекатель
разделяет их, сохраняет точные локаторы и три `ABSTAIN`; F0202 со смешанной
стадией не проходит без отдельного решения. Worker/API/web opt-in профиль
с независимой проверкой SHA при save/seal/GET реализован. Полный локальный
check прошёл: API 288, web 68, worker 732 и сборка. Последовательный
PostgreSQL suite: 13 файлов/37 тестов PASS. Изолированный homeserver
F0171 `CHK-C8360E50`: ZIP/manifest/PDF SHA сверены, 177/177 читаемых
текстовых страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
три `ABSTAIN`/0 строк без экспертного решения по источнику. Auth API
200/401 и браузерный просмотр прошли; старый GP-table stage SHA
не изменился. Положительная ветка реального проверенного источника не
испытывалась. [Аудит](operations/NEXT_UNRESOLVED_FAMILY_AUDIT_20260928.md),
[контракт](operations/EQUIPMENT_SPEC_REVIEW_20260928.md),
[Compose](operations/EQUIPMENT_SPEC_COMPOSE_20260928.md).

Следующий чистый review-only `MATERIAL_CLASS` пакет для unresolved
`KR-056/057/066` проверен на разрешённых оригиналах F0106/F0140 и
четырёх листах с SHA. Общие марки С245/А500С и требования REI нельзя
назначать одному физическому элементу и считать фактическим составом
защиты. Pure worker сохраняет точные лексические локаторы и три
`ABSTAIN`; OCR_REQUIRED листы отложены. Отдельный opt-in worker/API/web
профиль проверяет source/text SHA при save/seal/GET. Полный локальный
check прошёл: API 291, web 70, worker 741, сборка; последовательный
PostgreSQL suite 14 файлов/38 тестов PASS. Изолированный homeserver
F0140 `CHK-44D0DC61`: ZIP/manifest/PDF SHA сверены, 27/27 текстовых
страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, три
`ABSTAIN`/0 строк без экспертного решения по источнику. Auth API
200/401 и браузерный просмотр прошли; старый EQUIPMENT_SPEC stage/sidecar
SHA не изменился. Положительная ветка реального проверенного источника
не испытывалась. [Аудит](operations/NEXT_UNRESOLVED_FAMILY_AUDIT_2_20260928.md),
[контракт](operations/MATERIAL_CLASS_REVIEW_20260928.md),
[Compose](operations/MATERIAL_CLASS_COMPOSE_20260928.md).

План группировки оставшихся 74 unresolved кодов после отдельно разобранных
шести — [21 предлагаемый extractor и общая immutable конфигурация](operations/UNRESOLVED_BATCH_PRIORITY_20260928.md).
Первый общий review-only пакет `AREA_PROGRAM` (7) и `DIMENSION_LAYOUT`
(12) имеет SHA-закреплённую конфигурацию и отдельный opt-in worker
adapter. Проверены публичные F0126/F0154/F0104 по SHA; worker 751/751,
независимый pure API verifier 5/5, web 72/72. Durable API хранит
конфигурацию в immutable release и сверяет save/seal/GET;
последовательный PostgreSQL suite 15 файлов/39 тестов PASS. Все 19 кодов только
`ABSTAIN`, а локаторы остаются подсказками по тексту. Первый isolated
F0126 `CHK-4C4C29C4` выявил ошибку пути к JSON в wheel; исправлена
загрузка через `INSPECTOR_RULES_DIR`, тест relocated package 11/11.
Повторный F0126 `CHK-0855D3C6`: ZIP/manifest/PDF SHA PASS, 23/23
текстовых страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
19 `ABSTAIN`/0 подсказок без решения по источнику; auth API/Chrome и
legacy MATERIAL_CLASS SHA PASS. [Compose](operations/UNRESOLVED_CONFIG_COMPOSE_20260928.md).
Полный локальный `npm run check` после
исправлений прошёл: API 296, web 72, worker 751 и сборка. В очереди
пакетной предметной проверки остаются 55 кодов; 19 получили только
навигацию, не исполняемые правила. Числа 74/19/55 относятся к
организации работы, не к реализованному покрытию или доказанным
нарушениям. [Контракт](operations/UNRESOLVED_CONFIG_REVIEW_20260928.md).

Следующие семейные оригиналы проверены в режиме просмотра:
[DOCUMENT_APPROVAL/SAFETY_COVERAGE — 10 кодов, семь разрешённых PDF и
11 визуально сверенных страниц](operations/NEXT_APPROVAL_SAFETY_AUDIT_20260928.md),
[NETWORK_TOPOLOGY — семь кодов, шесть PDF и пять визуально сверенных
страниц](operations/NEXT_NETWORK_TOPOLOGY_AUDIT_20260928.md). Все остаются
`ABSTAIN`. Для первых десяти построена отдельная pure config v2 с 16
буквальными якорями, привязанными к SHA PDF/страницы/рендера; старый
v1 профиль не изменён. Opt-in v2 worker/API/web и independent verifier
реализованы, PostgreSQL 16 файлов/40 тестов PASS; полный локальный
`npm run check` API 302, web 75, worker 760 и сборка PASS. Изолированный
Compose v2 на публичном F0156 `CHK-3F610706` завершён: ZIP/manifest/PDF
SHA сверены, 10/10 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
10 `ABSTAIN`/0 подсказок без проверенного источника. OCR v6 обработал
0/9 требующих страниц и отложил их до решения по источнику. Авторизованный
GET, отказ анонимному GET, браузерный просмотр и неизменность v1 stage
прошли. Ранний запуск `CHK-A9D3F315` стартовал при пропущенном Python
модуле в remote allowlist; после исправления worker он тоже запечатан
`PARTIAL` с 10/10 успешными jobs, но прерванный smoke-клиент не принят
как итог проверки. [Контракт](operations/UNRESOLVED_CONFIG_V2_REVIEW_20260928.md),
[Compose](operations/UNRESOLVED_CONFIG_V2_COMPOSE_20260928.md).

Третий opt-in пакет `NETWORK_TOPOLOGY` для семи кодов использует
отдельную config v3 с семью буквальными якорями, закреплёнными SHA
оригинальных PDF/страницы/рендера. Worker/API/web интеграция сохраняет
только лексические подсказки со статусом `ABSTAIN`, а независимый API
сверяет source/text/config/result при save/seal/GET. Локальный полный
`npm run check` прошёл: API 309, web 77, worker 769, сборка PASS;
последовательный PostgreSQL suite — 17 файлов/41 тест PASS.
Изолированный Compose v3 на разрешённом F0171 `CHK-A2EC9D6E` завершён:
оригинальные ZIP/manifest/PDF SHA сверены, 177/177 страниц текстового
слоя, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, семь
`ABSTAIN`/0 подсказок без экспертного решения по источнику. Auth API
200/401, браузерный просмотр и неизменность v1/v2 stage SHA прошли.
[Протокол](operations/UNRESOLVED_CONFIG_V3_COMPOSE_20260928.md).
Из исходных 80 unresolved
кодов шесть были разобраны отдельными семействами, 36 получили только
конфигурационную навигацию v1/v2/v3, 38 ещё не получили такой профиль.
Из последних девять `BOUNDARY_OVERLAY` уже признаны непригодными для
одной лишь лексической навигации; ещё 29 требуют семейной проверки.
Эти числа описывают разработку интерфейсов, не предметное
покрытие или точность проверки. [Предметный аудит](operations/NEXT_NETWORK_TOPOLOGY_AUDIT_20260928.md),
[контракт](operations/UNRESOLVED_CONFIG_V3_REVIEW_20260928.md).

Проверка следующих девяти `BOUNDARY_OVERLAY` кодов по оригинальным
публичным PDF и семи рендерам показала, что строки и легенды не дают
координатного наложения контуров. Лексический v4 для них отложен;
все остаются `ABSTAIN`. Для реальной оценки нужны геометрический
извлекатель, общая система координат, фаза и подтверждённые источники.
[Предметный отчёт](operations/NEXT_UNRESOLVED_BATCH_AUDIT_20260928.md).

Ещё четыре `COORDINATE_ALIGNMENT` кода проверены на оригинальном
публичном ZIP: четыре PDF и четыре страницы/рендера со SHA. Текстовые
совпадения отметки, точки подключения, оси и шахты не устанавливают
общую систему координат или сопоставимую пару редакций. Лексический
профиль отложен до геометрического слоя с проверенным датумом,
масштабом и контрольными точками; все четыре `ABSTAIN`.
[Аудит](operations/NEXT_COORDINATE_ALIGNMENT_AUDIT_20260928.md).

Три `LAYER_ASSEMBLY` кода проверены на четырёх разрешённых оригинальных
PDF и пяти страницах/рендерах по SHA. Таблица дорожной одежды и несколько
типов кровли/стен видны, но bbox отдельного блока не подтверждает
одну строку «тип — материал — толщина» и назначение слоя участку.
`F0154` с.22 требует адресного OCR. Все три `ABSTAIN`; построены
ограниченные предложения о соседстве с обязательной ручной проверкой,
без типизированных слоёв и выводов о нарушении.
[Аудит](operations/NEXT_LAYER_ASSEMBLY_AUDIT_20260928.md).

Отдельный opt-in `LAYER_ASSEMBLY` worker/API/web профиль построен для
`SPZU-032`, `AR-044`, `ZU-125`. `SPZU-032` не дублирует уже существующую
проверку дорожной таблицы; для двух других кодов сохранены только
адресные предложения о соседстве заголовка и текста. Связь строки,
типа конструкции, элемента и зоны остаётся `UNVERIFIED`; толщина и
количество не назначаются. Независимый API сверяет source/text/locator
и immutable release при save/seal/GET. Локальный полный `npm run check`
прошёл: API 313, web 79, worker 786, сборка; последовательный
PostgreSQL suite — 18 файлов/42 теста. Изолированный Compose на
публичных F0156 `CHK-0AFF6FD5` и F0126 `CHK-577B4890` завершён:
оригинальные ZIP/manifest/PDF SHA сверены, 10/10 и 9/9 jobs
`SUCCEEDED`, оба run sealed `PARTIAL`, 0 findings, три `ABSTAIN`
и 0 предложений без проверенного источника. Auth API 200/401,
браузерный просмотр и неизменность v1-v3 SHA прошли; F0126 не
дублирует предложения `SPZU-032`. Адресный OCR F0154 с.22
по оригинальному PDF и повторному кешу показал ошибки распознавания;
все строки остались review-only и `ABSTAIN`.
[Контракт](operations/LAYER_ASSEMBLY_REVIEW_20260928.md),
[OCR-аудит](operations/LAYER_ASSEMBLY_F0154_OCR_AUDIT_20260928.md),
[Compose](operations/LAYER_ASSEMBLY_COMPOSE_20260928.md).

Чистый `geometry-proposal-v1` валидатор проверяет SHA исходного PDF и
PNG, рамку страницы с CropBox/Rotate, координатные преобразования и
границы предлагаемых точек/полигонов. Семь synthetic тестов прошли;
оригинальный F0126 с.17 со сверенным SHA PDF/рендера дал `ABSTAIN`
и ноль кандидатов. Это контракт происхождения геометрии, не
извлекатель объектов, не общая система координат и не предметный факт.
API/release/web для него ещё не подключены. Отдельный read-only Poppler
provider проверяет рамку PDF и для фиксированного `pdftoppm` profile
повторно рендерит PNG с точным сравнением байтов. Шесть тестов,
включая исходный F0126 с.17, прошли. На публичном листе Poppler
округляет box до двух знаков, а worker хранит float32; строгая
независимая проверка отклоняет несовпадение. Формат page frame
нуждается в отдельной согласованной версии. `pdfseparate` тоже
перезаписывает числовые операнды с ограниченной точностью; для
положительных выводов нужен независимый lossless PDF page-tree parser.
[Аудит точности](operations/GEOMETRY_POPPLER_PRECISION_AUDIT_20260928.md).

Отдельный `geometry-page-frame-v2` пакет оставляет только `ABSTAIN` и
пустой список кандидатов. Worker сохраняет frame PyMuPDF, исходный SHA и
точный Poppler PNG; API независимо повторяет PNG и проверяет координаты
worker внутри явно заявленного интервала печати `pdfinfo` ±0,005 pt.
На оригинальном разрешённом F0126 с.17 Python→TS parity прошёл,
worker 5/5 и API 3/3 теста. Это лишь проверенная навигация по листу.
Дополнительный strict verifier сверяет `Math.fround` независимых
исходных числовых операндов PDF с float32 worker. Публичный F0126
с.17 прошёл и этот путь; неизвестный масштаб `/UserUnit` отвергается.
release/save/seal/GET, UI и предметная геометрия пока не подключены.
[Контракт v2](operations/GEOMETRY_PAGE_FRAME_V2_REVIEW_20260928.md).
[План](operations/GEOMETRY_EVIDENCE_PIPELINE_PLAN_20260928.md).

Пять одиночных unresolved-семейств `PZ-006`, `PZ-013`, `AR-045`,
`ZU-127`, `POD-094` проверены на 10 исходных разрешённых PDF и 14
рендерах со сверенными manifest/PDF/page SHA. Все остаются `ABSTAIN`.
Особенно важно, что в F0152 с.49/51 найдена настоящая табличная
строка окна с R=0,65 и требованием 0,50, которую прежний лексический
поиск `ZU-127` пропустил. Источник помечен `PD/OTHER`, РД-спецификация
того же окна не подтверждена; это адрес для review, не факт кода.
Табличные строки `PZ-006` имеют конфликт единиц общего/надземного
объёма, а название школы не доказывает функциональную вместимость
`PZ-013`. Для `AR-045` нужна геометрия кровли, для `POD-094` —
разделение расчёта, договорного лимита и фактического талона.
[Аудит](operations/SINGLETON_UNRESOLVED_FAMILY_AUDIT_20260928.md).

Для `PZ-006` чистый extractor на SHA-верном F0101 с.9 дал семь
некодированных word-cell подсказок. Он явно сохраняет конфликт единиц
общего/частного объёма и несоответствие названия/триггера каталога,
всегда возвращает `ABSTAIN` и `typedFact=null`. Три теста прошли.
Чистый API verifier повторяет группировку и хеши полного списка слов.
На оригинальном F0101 с.9 независимый Poppler нашёл все 322 слова
PyMuPDF как уникальные пары текста и bbox, но в другом порядке.
Отдельный строгий полный bijection gate и Python-order replay приняли
семь предложений только как review-only; 6/6 тестов прошли.
`wordIndex` PyMuPDF не воспроизведён Poppler, а связь ячеек в строки
не доказана. Durable путь не подключён.
[Граница полной сверки](operations/PZ006_COMPLETE_WORD_REVIEW_GATE_20260928.md).

Для `ZU-127` отдельный pure extractor на исходном SHA-верном F0152
с.49/51 сохранил четыре word-bbox подсказки: окно и витраж разделены,
показатели R и U не смешаны, сводные 0,50/0,65 и 0,50/0,85 остаются
сырыми соседними ячейками. Пять профильных тестов прошли. Статус
`ABSTAIN`, row association и соответствие конкретному изделию
`UNVERIFIED`, фактов/coverage нет. Чистый API verifier проверяет
SHA/локаторы/счётчики только при наличии независимого полного списка
слов; synthetic parity и подмены, а также Poppler corroboration
отдельных слов на F0152 с.49/51 прошли 6/6. Poppler не воспроизводит
wordIndex PyMuPDF и не доказывает полноту списка, поэтому реальный
durable save/seal/GET пока остаётся fail-closed. Сквозная интеграция
не завершена.
[Контракт](operations/ZU127_WINDOW_TABLE_PROPOSALS_20260928.md).
Отдельный API-owned Poppler provider полного списка слов на оригинальном
F0152 с.49/51 подтвердил несовпадение сегментации с PyMuPDF:
132/135 и 175/173 слов соответственно. Строгая проверка корректно
отклоняет обе страницы; четыре адресных слова не заменяют полноту.
[Аудит полной независимой проверки](operations/ZU127_FULL_WORD_INDEPENDENCE_AUDIT_20260928.md).
Новый отдельный Poppler v2 профиль повторно нашёл четыре адреса на
F0152 с.49/51, сохранив сноски отдельными словами. Локально API
повторно прочитал исходный SHA-верный PDF и сверил все слова, версию
Poppler, хеши и предложения; synthetic и real parity прошли. Это
остаётся offline review: обычный homeserver API имеет Poppler 25.12.0,
worker пока не имеет `pdftotext`, тогда как первоначальный локальный
тест шёл на 25.03.0. Отдельный networkless/read-only Compose образ с
Poppler 25.12.0 затем прошёл локально и на homeserver по оригинальному
F0152: 135/173 слов, четыре предложения, `ABSTAIN`, null findings,
одинаковый contentHash. Обычные сервисы не менялись; durable профиль
по-прежнему выключен до интеграции версионированного runtime.
[Проверка v2](operations/ZU127_POPPLER_V2_REVIEW_20260928.md).
[Изолированный Compose](operations/ZU127_POPPLER_ONESHOT_PROOF_20260928.md).
Отдельный чистый worker wrapper для этого профиля требует явного
release slot, SHA F0152, решения `CURRENT/APPROVED` с вручную
подтверждённым `sectionCode=ZU` и Poppler 25.12.0 до чтения PDF.
Без решения он возвращает `ABSTAIN`/0 предложений. Пять focused
unittest прошли. Wrapper не зарегистрирован в штатном
`RULE_EVALUATION`, так что это не утверждение о run-интеграции.

Для `PZ-013` pure exclusion gate на оригинальных публичных F0148 с.167
и F0203 с.23 отделил название «Школа на 600 мест» от нагрузки
наружного освещения 4,49 кВт и водоснабжения 107,5 м³/сут.
Пять профильных тестов прошли; оба результата `ABSTAIN`, без вывода о
функциональной вместимости. [Контракт](operations/PZ013_CAPACITY_PROPOSALS_20260928.md).

Для `POD-094` pure review extractor на SHA-верных F0189 с.99–100 и
F0071 с.5 отделил два предложения расчётной массы отходов (259,875 т
IV класса и 28,875 т V класса) от договорного ориентировочного
количества железобетона 350 т V класса. Цена 55,00 не стала массой,
договорное количество не стало фактической передачей. Четыре теста
прошли; связь разных документов и партий не заявлена, всё `ABSTAIN`.
[Контракт](operations/POD094_WASTE_CHAIN_PROPOSALS_20260928.md).

Для 13 геометрических unresolved кодов появился отдельный чистый
`geometry-registration-v1`: аффинное преобразование по трём заранее
выбранным контрольным точкам, независимые holdout-точки, проверка
масштаба, ориентации, выпуклой области и численного roundtrip. Это
синтетически проверенный расчёт (19 геометрических тестов), всегда
`REVIEW_ONLY` с пустыми фактами; реальные реперы, CRS, render/source
решения и durable путь не подключены.
[Контракт](operations/GEOMETRY_REGISTRATION_V1_20260928.md).
Чистый TypeScript verifier отдельно воспроизводит affine, holdouts,
inverse, область и пустой `facts`; Python→TS synthetic parity и
пять профильных тестов прошли. Он требует доверенные решения о
контрольных точках и рамке, которых в текущем runtime ещё нет.
Проверка разрешённого public manifest, индекса и открытой разметки
не нашла подтверждённых пар контрольных точек или CRS: сохранённые
bbox задают лишь координаты на странице PDF. Поэтому все 13
геометрических кодов сохраняют `ABSTAIN`; synthetic affine fit не
является привязкой двух чертежей.

Четыре `EXTERNAL_EVENT_CHAIN` кода `OOS-098`–`101` проверены на
оригинальных разрешённых F0071/F0114/F0161: manifest/PDF/page SHA и
четыре рендера закреплены. Договорные обязанности, проектная
рекомендация и упоминание ГЛОНАСС у шкафа освещения не доказывают
реальное событие перевозки или статус внешнего реестра. Все четыре
`ABSTAIN`; новый лексический профиль отложен до авторизованного
снимка внешних событий с проверкой полномочия, времени и связей
объект–транспорт–рейс–партия.
[Предметный аудит](operations/EXTERNAL_EVENT_CHAIN_AUDIT_20260928.md).

Три `STRUCTURAL_DETAIL` кода `KR-063`, `KR-065`, `POD-096` проверены
на пяти исходных разрешённых PDF и шести рендерах со сверенными SHA.
Рабочий шов нельзя назначить деформационным; отверстия №7 и №5 на
разных листах нельзя считать одним элементом; проектная деталь
заделки не является нарушением. Для `POD-096` просмотренные временные
конструкции котлована не доказывают узел сохраняемой конструкции при
демонтаже. Все три `ABSTAIN`; ограниченный следующий технический
пакет — навигационные предложения по `KR-065` без привязки контура,
армирования или сравнения редакций.
[Аудит](operations/STRUCTURAL_DETAIL_AUDIT_20260928.md).

Для `KR-065` отдельно создан чистый bounded extractor навигационных
подписей проёмов с source/page/block/line SHA. На оригинальных F0141
с.23, F0143 с.21 и F0142 с.12 он различает номера отверстий и два
заголовка проектной заделки; все предложения `ABSTAIN`, связь с
контуром, элементом и армированием не установлена. Пять профильных
тестов с реальными разрешёнными PDF прошли. Отдельный opt-in worker/API/web
профиль теперь подключён; независимый API сверяет исходные source/text
SHA и локаторы при save/seal/GET. Полный локальный `npm run check`
прошёл: API 319, web 81, worker 804 и сборка; PostgreSQL suite —
19 файлов/43 теста. Публичный F0141/F0142/F0143 parity probe с
реальными `UNKNOWN` решениями дал 0 run proposals, без подмены
решения эксперта. Изолированный Compose на исходном публичном F0141
`CHK-DDFAE354` прошёл: ZIP/manifest/PDF SHA сверены, 9/9 jobs
`SUCCEEDED`, sealed `PARTIAL`, 0 findings, `KR-065 ABSTAIN`,
0 предложений и 0 допущенных источников. Авторизованный GET и
браузерная панель проверены, прежние sidecar SHA неизменны. После
исправления подписи при нуле предложений полный web suite — 82/82.
Установленный worker пакет проверен отдельным layout-тестом.
[Контракт](operations/KR065_OPENING_REVIEW_20260928.md),
[Compose](operations/KR065_OPENING_COMPOSE_20260928.md).

Два `METHOD_SEQUENCE` кода `POS-087` и `POD-091` проверены на трёх
разрешённых оригинальных PDF и шести рендерах с SHA. Описанная в ПД
последовательность не доказывает фактический журнал, утверждённый ППР
или согласование изменения; временная распорка котлована не равна
демонтажу здания. Оба `ABSTAIN`; предметное сравнение отложено до
проверенных операции, фазы и фактической записи.
[Аудит](operations/METHOD_SEQUENCE_AUDIT_20260928.md).

Два `SITE_FEATURE_LAYOUT` кода `SPZU-036` и `POS-089` проверены на
четырёх разрешённых оригинальных PDF и восьми страницах/рендерах
с SHA. Текст и легенды дают адреса для ручного просмотра, но не
регистрируют участок ограждения, положение мойки относительно выезда
или фактическое исполнение. Оба `ABSTAIN`; новый лексический профиль
не нужен, следующий технический срез — предложения геометрии на
F0154 с.19 и F0112 с.79 после независимого page-frame/рендера.
[Аудит](operations/SITE_FEATURE_LAYOUT_AUDIT_20260928.md).

Два `PARKING_LAYOUT` кода `SPZU-038` и `ODI-121` проверены на
четырёх разрешённых оригинальных PDF и девяти рендерах с SHA.
Расчётные 64/2 места и текст 3,6 × 6 м нельзя автоматически
приписать отдельным контурам; наземные места и подземная стоянка
должны оставаться разными областями. Для школьного объекта заявлено
отсутствие парковки внутри участка, но внешние места и высадка
имеют иной scope. Оба кода `ABSTAIN`, новый лексический профиль
отложен до геометрических предложений и проверки связи символа,
контура и размерной линии.
[Аудит](operations/PARKING_LAYOUT_AUDIT_20260928.md).

Для `OOS-098`–`101` построен чистый offline контракт цепочки внешних
событий. Девять synthetic тестов и полный worker suite 800/800
прошли; даже согласованная synthetic цепочка остаётся review-only с
`ABSTAIN` и null findings/coverage. Реальные подписанные снимки
реестров и независимая проверка полномочий отсутствуют, поэтому
release/API/Compose не подключены.

Последний полный локальный `npm run check` после ZU-127/PZ-006,
PZ-013/POD-094, geometry review и исправления web-этапа завершился
успешно: API 362 passed/45 skipped, web 82 passed, worker 843 tests
(5 skip), остальные Python suites и сборка прошли. Более поздние
новые семейные модули нужно проверять после их завершения.

Независимый API replay для `POD-094` сверяет исходные SHA, все три
страницы, локаторы, роли и `ABSTAIN`/null. Профильные тесты 4/4 и
API typecheck прошли. На оригинальных F0189 и F0071 проверка полного
списка слов через Poppler отклоняет результат: F0189 с.99 422/423,
с.100 388/393 слова (PyMuPDF/Poppler), F0071 с.5 одинаковые 365
слов, но полная пара текст/координаты не совпадает. Durable интеграция
закрыта до доказанного независимого соответствия.
[Аудит](operations/POD094_INDEPENDENT_REVIEW_GATE_20260928.md).

Следующий equipment-spec срез `IOS2-073`/`ODI-115` просмотрен на
исходных публичных F0165 с.26 и F0160 с.37 с PDF/render SHA.
Спецификация пожарной насосной установки не подтверждает станцию
хозяйственно питьевого водоснабжения; обозначение щита питания
подъёмника не подтверждает модель и режим самого подъёмника.
Оба кода `ABSTAIN`, находок и coverage нет. Строки и идентичность
оборудования остаются непроверенными.
[Аудит](operations/NEXT_EQUIPMENT_SPEC_PUBLIC_AUDIT_20260928.md).
Отдельный pure worker на тех же SHA-проверенных страницах нашёл
ровно по одному исключающему контексту: пожарный спринклерный насос
и щит питания подъёмника. Оба предложения помечены
`INELIGIBLE_FOR_PARAMETER_FACT`, оба результата `ABSTAIN` с null
фактами/findings/coverage. Профильные тесты на оригиналах 3/3;
API/release/save/seal/GET не подключены.
[Контракт](operations/EQUIPMENT_SPEC_FALSE_NEAR_REVIEW_20260928.md).

Для выбранных исключающих фраз F0165 с.26 и F0160 с.37 независимый
Poppler `25.03.0` подтвердил точный текст и локальные координаты:
максимальное расхождение границ соответственно 0,000103 pt и
0,533068 pt. Это допускает только адресную навигационную подсказку;
полнота сканирования страницы, факт об оборудовании и отсутствие
других контекстов не подтверждены. Отдельный API/durable профиль не
подключён.

Подготовлена отдельная политика очереди `ZU-127` Poppler v2.
Claim теперь сверяет неизменяемый release SHA/byte length, сохранённое
имя очереди и заявленное имя для специализированной очереди до
выдачи lease; PostgreSQL основной файл прошёл 23/23, включая подмену
очереди. Профиль ещё не включён в release/run/outbox, специализированный
F0152 адаптер остаётся fixture-only и не потребляет сообщения.
API повторной проверки требует Poppler ровно `25.12.0`; локальный
`25.03.0` отвергается. Пересобранный изолированный one-shot на
исходном F0152 прошёл локально и на homeserver: 135/173 слова, четыре
предложения только для просмотра, `ABSTAIN`, null findings, один и тот
же contentHash. Сквозного durable результата
пока нет. [Граница](operations/ZU127_QUEUE_POLICY_20260928.md).

Fixture-only ZU-127 specialist образ собран локально. Его pinned Poppler
`25.12.0` предварительная проверка прошла после исправления разбора
многострочного `-v`; штатный запуск по-прежнему отказывает до durable
контракта и не потребляет очередь. Это проверено в networkless/read-only
контейнере. [План](operations/ZU127_SPECIALIST_WORKER_PLAN_20260928.md).

API Docker image также теперь закрепляет `poppler-utils=25.12.0-r1` и
проверяет версии `pdftotext`/`pdfinfo` при сборке. Локальный probe image
`sha256:af07dc8eb562c16b40079aee9007616575c9922ae980c07d76cdf823cacd8ba0`
собран успешно; оба инструмента показали `25.12.0` в контейнере без сети и
с read-only filesystem. Обычный API на homeserver не заменялся; это
только согласование версии парсера, без durable результата ZU-127.

Общий ограниченный `poppler-page-evidence-v1` теперь извлекает полный
список слов и текст не более четырёх выбранных страниц из SHA-верного
PDF. Независимый API повторяет извлечение в закреплённом Poppler 25.12.0
и сверяет каждый wordIndex, bbox и hash. На оригинальном разрешённом
F0152 с.49/51 изолированный replay совпал: 135/173 слова и один
contentHash; удалённое слово отвергнуто. Это навигация, всегда
`ABSTAIN` без фактов и findings. Отдельный ZU-127 selector v3 выбирает
до четырёх кандидатов из SHA-проверенного `document-text-v2`, явно
считает OCR_REQUIRED и усечённые страницы; синтетические тесты 9/9.
Source review/committed artifact должны быть аутентифицированы durable
слоем; release, save/seal/GET и сквозной Compose ещё не подключены.
[Worker](operations/POPPLER_PAGE_EVIDENCE_V1_20260928.md),
[API](operations/POPPLER_PAGE_EVIDENCE_API_20260928.md),
[селектор](operations/ZU127_PAGE_SELECTION_V3_20260928.md).

Для ZU-127 v3 добавлен отдельный opt-in fenced stage: он связывает
селектор с полным Poppler evidence, проверяет исходный SHA и не открывает
PDF без проверяемого решения `CURRENT/APPROVED` и выбранного листа.
Независимый pure API verifier пересчитывает выбор страниц и сверяет
полный receipt по оригинальным PDF-байтам; Python/TypeScript synthetic
parity и проверки подмены пройдены. Stage не зарегистрирован в очереди,
release builder или durable save/seal/GET. Реального утверждённого
решения по источнику и сквозного run v3 нет.
[Stage](operations/ZU127_GENERIC_STAGE_V3_20260928.md),
[API verifier](operations/ZU127_GENERIC_RESULT_API_20260928.md).

После этих изменений полный локальный `env PATH=services/worker/.venv/bin:$PATH
npm run check` прошёл: API 380 tests passed/45 skipped, web 82 passed,
Python suites и production build завершились с кодом 0. Это не
подтверждает интеграцию нового пакета в durable run.

После добавления составного ZU-127 v3 контракта повторные typecheck,
тесты и build завершились: API 390 passed/45 skipped, web 82 passed,
worker 874 tests (6 skipped), остальные Python suites и production
build без ошибок. Повторный полный `npm run check` после исправления
обёртки журнала завершился с кодом 0.

Для F0165 с.26/F0160 с.37 добавлен отдельный pure API verifier выбранного
фрагмента. На двух SHA-верных оригиналах он независимо сверил единственную
исключающую фразу и bbox через Poppler `25.03.0`; 8/8 профильных тестов.
Результат явно содержит `PAGE_SCAN_COMPLETENESS_UNVERIFIED`, `ABSTAIN`,
null fact/findings/coverage и запрет durable save. Иная версия Poppler,
включая homeserver `25.12.0`, закрыта до отдельной проверки.
[Контракт](operations/EQUIPMENT_FALSE_NEAR_SELECTED_SPAN_API_20260928.md).

## Кандидаты на замечания, 29 сентября 2026

Отдельный `REVIEW_CANDIDATE` подключён к существующему durable run, API и
web. Артефакт не меняет findings и coverage; инспектор видит исходный PDF,
строку и фрагмент, причину неопределённости, может оставить подсказку для
проверки или отклонить её и выгрузить JSON. Независимая API-проверка
повторяет SHA и локаторы при записи и чтении.

На 36 SHA-проверенных исходных `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN` PDF
получено 164 карточки по 72 кодам матрицы и одному свободному коду; два
неразмеченных контрольных PDF дали одну карточку. Все 164 локатора прошли независимую
проверку и рендер. На открытых положительных метках page-level recall@50
равен 4/4 группам, но подтверждённых полных пар ПД/РД нет. Открытых
отрицательных меток нет; FPR и F1 не оценены.

В изолированном локальном Compose живые run F0171 и F0104 завершились
`PARTIAL` с 8 кандидатами каждый, 0 findings и 5 официальными `ABSTAIN`;
API и web открыли страницы и фрагменты, решения записаны и экспортированы.
На свежей проверенной сборке также завершился парный F0104+F0145 run
`CHK-5FA94BDE`: 15 адресных подсказок, 0 findings, исходный лист и фрагмент
AR-050 открыты в web; `ACCEPT_FOR_REVIEW`, `REJECT` и повтор решения проверены.
Неустановленный раздел не превратился в предполагаемую пару.
На финальной сборке новый run F0106 `CHK-26CA6BC0` дал 11 подсказок,
включая KR-058 на исходной странице 53; API и web открыли лист и фрагмент,
решение `ACCEPT_FOR_REVIEW` сохранено без finding или протокола.
На расширенной сборке F0126 `CHK-E0763719` дал 5 подсказок; PZ-012 на листе 14
открыт в API и web, решение принято для проверки и экспортировано отдельно,
официальный протокол пуст.
На последней сборке F0163 `CHK-D5DBED8E` дал 2 подсказки; IOS2-072 на листе 9
открыт в API и web, решение принято для проверки и экспортировано отдельно,
официальный протокол также пуст.
Парный F0171+F0202 здесь завершился `FAILED`, поскольку локальный OCR
provider не подключён. API unit 412 passed/47 skipped, PostgreSQL
integration 23 passed, адресные worker tests 5 passed в последнем прогоне, typecheck и web
build прошли. Закреплённые Docker образы не были доступны из реестра,
поэтому локальный Compose использовал диагностический overlay с уже
установленными образами. H100 не проверялся. Официальный конкурсный
экспорт остаётся `BLOCKED_CONTRACT` без scorer и уточнения matching.

[Доказательства и шаги воспроизведения](operations/REVIEW_CANDIDATES_20260929.md).

Дополнительный публичный проход 29 сентября увеличил адресные подсказки до
249 уникальных карточек по 110 из 132 кодов на 47 SHA-проверенных оригинальных
PDF. В повторном F0193 найден сигнал PPM-105 на странице 72; самостоятельная
проверка приняла 16/16 карточек и открыла 16/16 фрагментов исходного PDF.
Направление выходов В2/В3 непосредственно наружу не подтверждено. Для
всех 66 карточек шести предшествующих прогонов, 14 карточек повторного F0112
и 8 карточек F0158/F0170 также выполнены независимая API-проверка и рендер.
Это не меняет официальный coverage и не служит подтверждением нарушения.

Гостевой обзор трёх разрешённых оригиналов F0101/F0142/F0147 добавлен через
явный allowlist объектов в API. На изолированном homeserver после пересоздания
API и web браузер без пароля показал три объекта с 6/3/2 кандидатами,
открыл исходный лист и фрагмент. В API smoke подтверждены исходные SHA,
immutable hashes артефактов, PNG страниц, запрет записи (403) и скрытие
чужого объекта (404). В списке из 17 подсказок убран вложенный скролл;
последняя карточка достигается прокруткой страницы. Сводка больше не
показывает плитку «Не поддерживается 125» и прежний текст про неполный анализ;
причины ограничения оставлены в разделе «Ограничения анализа».
Повторный API suite прошёл 416/47 skipped с четырьмя workers и штатным
таймаутом; web suite 94/94, API/web typecheck и web build прошли.
H100 runtime недоступен; guard итогового server Compose на временном env
с семью конкурсными профилями и одним GPU прошёл, 7/7 тестов guard прошли.
[Инструкция и receipt](operations/PUBLIC_REVIEW_VISITOR_20260929.md).

## Открытый рабочий контур, 29 сентября 2026

Compose по умолчанию включает `INSPECTOR_OPEN_WORKSPACE=1`. Web убрал вход,
регистрацию и профиль: на старте получает серверную рабочую сессию без пароля.
Общий пользователь получает права на объекты текущей организации, включая
существующие; новые объекты наследуют обычный audited command path. Cookie,
CSRF, idempotency, объектные проверки и журнал решений сохранены. Парольный
маршрут возвращает 404 в этом режиме; при `INSPECTOR_OPEN_WORKSPACE=0`
старый API-путь остаётся для совместимости. Все посетители доступного стенда
могут менять данные его организации, поэтому Compose по умолчанию привязан
к loopback.

Проверка: web build/typecheck и 94 теста; API typecheck и 418 тестов
(48 пропущены без PostgreSQL); отдельный PostgreSQL integration создал
сессию без пароля, открыл ранее существовавший объект, создал новый через
CSRF/idempotency и прочёл его обратно. Изолированный локальный Compose
пересобрал API и web, оба healthy. В браузере `127.0.0.1:38081` кабинет
открылся без формы входа, список существующих объектов показан, форма
«Новый объект проверки» доступна. Это не проверка homeserver или H100.
