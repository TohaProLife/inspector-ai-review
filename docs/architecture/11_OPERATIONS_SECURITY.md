# Развёртывание, защита и эксплуатация

Версия 1.1. Проектные требования; текущий Docker Compose не доказывает их выполнение. По итогам [Q&A](../HACKATHON_QA_SESSION.md) внешние AI/OCR/VLM API для конкурсных документов запрещены. Конкретные локальные модели и мощности выбираются через qualification gate.

## Топология и границы

Pilot compose: reverse proxy/TLS, React assets, Node API, outbox/scheduler, Python document workers, Python rule workers, PostgreSQL, RabbitMQ, Redis, S3-compatible storage и ClamAV. Это способ воспроизводимого запуска, не высокодоступная production-схема. Сервисы имеют health checks и закреплённые версии образов; startup order дополняется реальными retry/readiness checks.

Во внешний контур доступны только HTTPS UI/API. PostgreSQL, Redis, RabbitMQ management, object storage admin, ClamAV и internal jobs API доступны в приватной сети. Браузер получает ограниченные signed URLs через авторизованный API. Worker использует service identity; права чтения входов и записи outputs ограничиваются выданным job. Evaluation и demo имеют отдельные БД, credentials, bucket/prefix policy и очереди.

Целевой профиль ТЗ включает TLS 1.3, защиту от DDoS и IDS: edge rate/body/connection limits дополняются инфраструктурным DDoS-контуром и мониторингом подозрительной сетевой активности на согласованной площадке. API rate limiter не объявляется полноценной заменой этим средствам. Совместимость клиентов и инфраструктурные поставщики фиксируются перед R3.

Production требует независимого хранения данных, резервирования PostgreSQL/очереди/storage, failover, мониторинга и проверенного восстановления. Возможность SLA 99,9% подтверждается измерением и архитектурой размещения заказчика; один сервер/Compose это обещание не выполняет. Недоступность Redis не уничтожает задания или решения: источник истины PostgreSQL. При недоступном RabbitMQ outbox сохраняется, новый run остаётся QUEUED с явным degraded status.

## Identity и RBAC

| Capability | Inspector | Supervisor | Admin | ML engineer / curator | Integration service |
|---|---|---|---|---|---|
| Читать разрешённый объект и evidence | Да | Да | По назначенному scope | Только назначенный dataset/object scope | Только payload заданной передачи |
| Загружать / запускать анализ | Да | Да | При отдельной capability | Только evaluation scope | По контракту intake |
| Подтверждать/отклонять/уточнять | Да | Да | Только если назначена роль инспектора | Нет | Нет |
| Финализировать | Да при разрешении объекта | Да | Только при отдельной capability | Нет | Нет |
| Отзывать финализацию | Нет | Да | Да | Нет | Нет |
| Управлять пользователями/политиками | Нет | Нет | Да | Нет | Нет |
| Редактировать draft правил/норм | Нет | Экспертная проверка | Организация доступа | При назначении rule editor | Нет |
| Публиковать нормы/матрицу | Нет | Назначенный нормативный эксперт | Не автоматически | Не автоматически | Нет |
| Curate GOLD / запускать evaluation | Нет | При назначении curator | Не автоматически | По capability | Нет |
| Approve/deploy model release | Нет | По release approval capability | По deploy capability | Подготовить candidate; approval отдельно | Нет |

Роли — набор capability, object membership дополнительно ограничивает каждую операцию. Администратор не становится автором экспертного решения по умолчанию. Для пилота один человек может совмещать роли, но каждое действие сохраняет actor и выбранное полномочие; разделение обязанностей согласуется перед эксплуатацией.

Локальный login допускается в пилоте: password hashing современным специализированным алгоритмом, параметры по измерению, rate limit, отзыв сессий при отключении пользователя/смене прав. Session ID ротируется при login/смене привилегий; cookie Secure/HttpOnly/SameSite, CSRF на mutations. Секреты не попадают в repo, docs, browser bundle или URLs. SSO/OIDC и сертификаты интеграции подключаются адаптерами после согласования identity provider.

## Документы и вычисления

Quarantine изолирован от renderer, browser и training. При AV unavailable intake fail-closed; разрешённый retry не обходит проверку. Parser/OCR/container не получает сеть по умолчанию, работает непривилегированно, с read-only root, временным рабочим каталогом и лимитами CPU/RAM/time/disk. Контейнеры с исходными документами не получают platform credentials.

Метаданные документа, XML, OCR и LLM output — недоверенные данные. Извлечённые инструкции не управляют инструментами или очередями. LLM получает ограниченную задачу и typed schema; результат проходит валидацию значений, source references и evidence. Нельзя разрешать модели произвольное исполнение кода, загрузку URL или доступ к другим объектам. Применимость и финализация проверяются сервером независимо от вывода модели.

Renderer/OCR/VLM/LLM работают локально в закрытом контуре и не передают документы или фрагменты внешнему API. Model artifact должен иметь доступные веса, сохранённый hash и лицензию, разрешающую коммерческое и государственное использование. Worker по умолчанию не имеет исходящей сети; установка dependencies/model artifacts выполняется до обработки конкурсных документов из проверенного immutable mirror или release bundle.

Хранение шифруется средствами согласованной инфраструктуры, сетевые соединения — TLS в production. Политика хранения оригиналов/протоколов/GOLD задаётся заказчиком; 30 дней относится к backup, а не автоматически ко всем документам. Удаление по retention не разрушает действующие protocol references: legal hold, архивный export и согласованная процедура удаления обязательны до включения автоочистки. Никаких lifecycle deletion rules без утверждённой политики.

## Лимиты и ресурсы

Интерактивный ingest: 50 MiB на файл и 200 MiB на пакет — принятый технический default интерпретации МБ, подлежит подтверждению Q-03. Reverse proxy body limit должен превышать 200 MiB на ограниченный multipart overhead; рекомендуемый initial cap 210 MiB. API независимо считает реальные file/package bytes и не принимает лишний payload. Значение 210 MiB не увеличивает разрешённый размер документов. Большие исходные массивы могут поступать отдельным предварительным import из доверенной БД/storage только по явному профилю; это не обход лимитов обычного UI. Timeouts согласуются со streaming upload; большие OCR jobs не держат HTTP request.

Интерактивные, intake, CPU OCR, GPU inference и export очереди имеют отдельные concurrency/prefetch/resource profiles. Большой пакет не блокирует все объекты: fair scheduling по organization/object, ограничение одновременно тяжёлых jobs и per-user quotas. GPU памяти и worker RAM недостаточно оценивать по размеру PDF; измерять по разрешению страниц/числу tiles/model footprint. Retry не должен создавать неограниченные копии артефактов.

Точная конфигурация серверов — выход qualification benchmark. Capacity sheet фиксирует модель CPU/GPU, RAM/VRAM, storage IOPS, сетевую скорость, число workers, batch size, версии inference и тип страниц. Требуемая пропускная способность оценивается как страницы/пик периода; запас и очередь проверяются load test, а не объявляются на основании числа контейнеров.

## SLO и измерения

| Требование ТЗ | Что измерять | Условие подтверждения |
|---|---|---|
| 100 пользователей; API p95 ≤200 мс | Авторизованные интерактивные JSON endpoints под согласованным mix | Отдельно ошибки/p99; bytes upload/async OCR не прятать в среднем |
| Загрузка 10 файлов по 50 МБ ≤2 мин | Общая пользовательская сессия из пакетов не более 200 МБ | До Q-03 не трактовать как разрешение одного 500-МБ запроса; сеть и AV timings указаны |
| OCR 100 страниц ≤3 мин; 500 ≤10 мин | Accepted job → OCR ready, включая queue wait; отдельно service time | Реальные форматы/качество и зафиксированное оборудование |
| 132 параметра ≤2 мин | Начало comparison после готовых prerequisite artifacts → sealed results | Все применимые реализованные правила, не 132 пустые записи |
| Протокол ≤30 сек | Commit snapshot → готовый обязательный артефакт | Зафиксированы размер и шаблон |
| Инкрементальность ≤1 мин | Commit дозагрузки/старт запуска → новое пригодное состояние, граница уточняется | Новые источники/затронутые правила указаны, cache hit не единственный кейс |
| SLA 99,9% | Availability ключевых пользовательских операций | Период/исключения/наблюдение согласованы |
| RPO ≤15 мин; RTO ≤1 час | Потерянный интервал данных; фактическое время восстановления | Регулярный restore drill, не только наличие backup job |

Границы таймеров, наборы нагрузки и длительность испытаний согласуются Q-09. Проверка 100 одновременных пользователей не входит в первый этап хакатона и остаётся production/pilot gate. Пока профиль не согласован, публиковать обе величины queue+service и service, не выбирать выгодную постфактум. Product должен показывать превышенный deadline как задержку, не как отрицательный предметный результат.

## Наблюдаемость и аудит

Каждый request/job/event несёт trace_id, object/inspection/run/job IDs, release_id и schema version. Structured logs содержат codes, durations и безопасные ссылки; без полного OCR-текста, паролей, токенов и содержимого документов. Метрики: queue age/depth, outbox lag, retries/DLQ, lease expiries, этапы страниц, throughput, run state, cache reuse, parser/OCR failure, evidence validation rejection, auth denials, finalization conflict, render/sync failures, backup age.

Audit append-only сохраняет command, actor, scope, timestamp, reason и ссылки на before/after versions. Доступ на запись только через доменные команды; администратор приложения не имеет endpoint редактирования audit. Hash chain/периодический подписанный digest и external backup позволяют выявлять изменение; один event_hash без защищённого внешнего якоря не доказывает неизменность от DB-admin. Способ внешнего якоря определяется инфраструктурой заказчика.

Alerts начального профиля: oldest queued job превышает deadline; outbox lag >60 сек; любое DLQ; повторяющиеся scanner failures; backup старше расписания; replication/archive lag угрожает RPO; свободное место ниже установленного запаса; недоступен protocol storage. Пороги после benchmark фиксируются config version, для каждого alert назначается owner и runbook.

## Backup и восстановление

Ежедневный backup с хранением 30 дней дополняется PostgreSQL WAL/PITR, чтобы обеспечить RPO 15 минут. Versioned object storage имеет независимую копию оригиналов, snapshots и артефактов; проверяются manifest/hash consistency и возможность восстановить ключи шифрования. DB-only backup недостаточен. Redis восстанавливается пустым; RabbitMQ — из устойчивых queues и сверки незавершённых jobs/outbox, без повторного человеческого эффекта.

Restore drill: восстановить инфраструктуру в изолированном контуре → БД на выбранный момент → связанные объекты → проверить hashes/scope → поднять API read-only → пересогласовать leases/outbox/deliveries → разрешить mutations. Перед возобновлением sync выяснить внешний receipt для неизвестных отправок. Зафиксировать фактические RPO/RTO, потери и ответственного. Drill обязателен перед production и после существенного изменения хранения.

## Runbooks и поставка

| Событие | Безопасное действие оператора |
|---|---|
| Worker crash / истёк lease | Scheduler выдаёт новую попытку/fence; не редактировать domain rows вручную |
| DLQ | Исследовать typed error и вход; redrive через audited command после устранения причины |
| Scanner unavailable | Восстановить scanner, повторить intake; quarantine не публиковать |
| Ошибочный model release | Откатить default для новых runs; старые результаты сохранить, предложить новый run |
| Неудачный render | Повторить из того же snapshot/config; не пересобирать из текущих findings |
| Неизвестный исход ИАИС | Reconcile по idempotency/receipt; не посылать бесконтрольно заново |
| Повреждённый blob | Запретить evidence action, восстановить verified copy, записать incident |

Миграции expand→backfill→switch→contract, совместимость с предыдущим приложением в период rollout. До destructive migration — backup и проверенный rollback/forward recovery. Release bundle содержит app/schema/contracts/model/rule/template versions, hashes, тестовый отчёт, known gaps и rollback procedure. Документация не задаёт команды деплоя до появления проверенных скриптов.
