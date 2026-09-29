# Jobs, события и восстановление

Версия 1.0. PostgreSQL хранит состояние, RabbitMQ доставляет задания at-least-once. Queue message содержит ссылки, не PDF и не все OCR-токены.

## DAG

Intake DAG upload session: scan → validate format → register-ready. До upload commit нет analysis jobs.

Analysis DAG: inventory → render/text-layer → OCR/layout при необходимости → metadata → revision/link → entity extraction → applicability/comparison → evidence validation → aggregate/seal. Независимые страницы выполняются параллельно; linking ждёт metadata нужных families, правила ждут свои prerequisites. Пропуск ненужного OCR = stage disposition SKIPPED_BY_POLICY с причиной; job для пропущенного OCR не создаётся, UI не показывает COMPLETED OCR.

Текущий исполняемый срез хранит provider-neutral каркас полного analysis DAG. При старте создаются девять persisted jobs: `ANALYSIS_INVENTORY → DOCUMENT_TEXT_LAYER → DOCUMENT_RENDER → DOCUMENT_METADATA → DOCUMENT_LINKING → ENTITY_EXTRACTION → RULE_EVALUATION → EVIDENCE_VALIDATION → ANALYSIS_SEAL_UNSUPPORTED`. После принятия text-layer artifact API транзакционно добавляет `DOCUMENT_OCR_LAYOUT` между render и metadata только при `ocrRequiredPageCount > 0`; для `document-text-v1`, где qualification ещё нет, консервативно требуются все страницы. Если OCR не нужен, job не создаётся.

Descendants создаются в `BLOCKED`; успешный complete каждого prerequisite одной транзакцией сохраняет result и `stage.finished`, переводит готовый child в `READY` и добавляет его `job.ready` в outbox. `DOCUMENT_TEXT_LAYER` — пока единственная document stage с реальным извлечённым содержимым: consumer `documents.render` получает существующий PDF text layer без page rasterization и OCR. Versioned policy отмечает страницу как `TEXT_LAYER_CANDIDATE` или `OCR_REQUIRED`; кандидат ещё требует render-based проверки покрытия и reading order.

Остальные стадии уже имеют очереди, lease/fence, dependencies, typed provider registry и строгий `analysis-stage-result-v1`, но до выбора provider/policy фиксируют только append-only disposition (`PROVIDER_NOT_CONFIGURED`, `POLICY_NOT_CONFIGURED`, `UNSUPPORTED_RULESET` или `NO_MACHINE_RESULTS`) с `outputCount=0`, `providerProfileId=null` и `providerConfigHash=null`. Registry не принимает adapter в чужой provider slot; конкретный adapter и его stage-specific output schema будут добавлены после qualification. Это позволяет проверить orchestration и дойти до честного `PARTIAL`, не создавая фиктивные OCR tokens, metadata, entities, rule results или evidence. Технический job становится `SUCCEEDED`, а предметный stage artifact явно сообщает, что inference не выполнялся.

Если prerequisite недоступен, dependent job получает technical terminal status и reason; текущий scheduler рекурсивно сохраняет `CANCELLED/PREREQUISITE_FAILED` для незавершённых descendants в транзакции terminal failure. Если файл успешно обработан, но нужного доказательства нет, comparison завершается предметным MISSING_EVIDENCE. Эти случаи не объединяются.

## Очереди v1

| Очередь | Работа | Pool |
|---|---|---|
| intake.validate | AV и проверка документов | Ограниченный document pool |
| documents.render | Рендер, text layer, page metadata | CPU document |
| documents.extract | OCR/layout/stamps/tables | CPU/GPU по worker capability |
| documents.link | Метаданные, revision selection, retrieval | Document |
| rules.evaluate | Typed rules, hypotheses, evidence gates | Rules |
| protocols.render | PDF и другие форматы из snapshot | Export |
| integration.deliver | Подписанный обмен ИАИС | Integration |
| models.train / models.evaluate | Изолированное обучение и evaluation | ML pool, вне production document workers |
| *.dead | Операционная диагностика исчерпанных/невалидных заданий | Без автоматического consumer |

Persistent messages, durable queues; publisher confirms. Топология очередей/dead-letter явно задаётся deployment, не появляется случайно при nack. Retry выполняет scheduler по БД, а не бесконечный requeue того же сообщения.

## Envelope

```json
{
  "schema_version": "1.0",
  "event_id": "<uuid>",
  "event_type": "job.ready",
  "occurred_at": "2026-09-17T12:00:00Z",
  "trace_id": "<trace>",
  "organization_id": "<uuid>",
  "object_id": "<uuid>",
  "inspection_id": "<uuid>",
  "run_id": "<uuid>",
  "job_id": "<uuid>",
  "job_type": "DOCUMENT_RENDER",
  "scope_type": "ANALYSIS",
  "input_manifest_hash": "<sha256>",
  "semantic_key": "<sha256>",
  "release_id": "<uuid>"
}
```

Envelope выше — analysis job. Discriminator `scope_type` задаёт один из контрактов: INTAKE (upload_session_id, без run_id), ANALYSIS (run_id/input_manifest_hash/release_id), PROTOCOL (protocol_id/snapshot_hash/render_profile), PREDICTION_EXPORT (run_id/output_hash/adapter_version), DELIVERY (delivery_id/protocol_id/snapshot_hash), EVALUATION (evaluation_run_id/dataset_hash/release_id). Поля object/inspection обязательны для объектных scope; evaluation имеет dataset scope с явным разрешённым списком объектов. Artifact URLs не живут в долговременном сообщении: worker получает доступ при claim.

TRAINING использует training_run_id/dataset_hash/base_model/config_hash и ограниченный training split; credentials не разрешают читать hidden или переключать deployment. ML jobs живут в отдельном resource pool, чтобы обучение не блокировало работу инспектора. Intake/catalog import без object scope не может зарегистрировать источник без явного object binding.

Analysis complete требует OPEN, активный run и актуальную generation. Protocol render разрешён при FINALIZED и после revocation для исторического скачивания: он читает неизменяемый snapshot и не редактирует domain output. Prediction export может читать любой разрешённый sealed run, включая исторический. Delivery дополнительно проверяет действительность FINAL и revocation; evaluation не пишет в normal inspection. Единая проверка «все jobs требуют OPEN» запрещена, иначе выпуск протокола после финализации остановится.

Semantic key: hash(object, run or upload generation, stage, input hashes, adapter/rule/model/config versions, shard/page selector). Global reusable extraction cache key не содержит run, но включает object access scope и все смысловые версии; cache hit материализуется новым result reference текущего run.

## Worker protocol

1. Получить сообщение, провалидировать envelope; неизвестную major version отправить в dead-letter с audit.
2. Вызвать внутренний `POST /internal/v1/jobs/{id}/claim` с worker identity/capabilities. Сервер проверяет состояние, scope и run generation, выдаёт attempt_id, fencing_token, lease_until и input refs. Для terminal job возвращает ALREADY_TERMINAL, сообщение ack.
3. Heartbeat через `/heartbeat` продлевает lease только текущей попытке. Проектный default: heartbeat 20 секунд, lease 90 секунд; stage deadline отдельно задаётся resource profile.
4. Получить разрешённые inputs, выполнить stage с ограничениями ресурсов; output записать в immutable временный artifact key.
5. `/complete` передаёт attempt/fence, artifact refs/hash/size, schema version, quality/timing, компактный result или ссылку на chunk manifest.
6. API проверяет текущий fence, input generation, hash/размер артефактов, schema, object scope и provenance; в одной транзакции фиксирует result, terminal state, audit, outbox downstream.
7. Worker ack сообщения **после durable ответа**. При неясном сетевом исходе повторяет complete с тем же attempt receipt. Отправка только в stdout запрещена.

Claim возвращает для каждого manifest source только API id, SHA-256, размер, media type и внутренний download path. `GET /internal/v1/jobs/{id}/inputs/{sourceFileId}` требует worker token, текущие attempt/fence и неистёкший lease; storage key наружу не выдаётся. Worker потоково скачивает PDF во временный файл и повторно сверяет размер и SHA-256. Bounded `document-text-v2` JSON использует целочисленную геометрию `PDF_BOTTOM_LEFT_MILLI_POINTS`; v1 остаётся допустимым для rolling compatibility. Policy `text-layer-quality-v1` считает block/non-whitespace/alphanumeric/replacement/control metrics и выдаёт только `TEXT_LAYER_CANDIDATE` либо `OCR_REQUIRED` с reason codes. API не доверяет worker classification: заново вычисляет metrics/summary из блоков, канонизирует JSON, проверяет source provenance, page/block geometry и совокупный лимит 8 MiB, сохраняет полный append-only artifact, а в job result оставляет только компактные refs/hash/счётчики. До появления chunk protocol artifact передаётся inline в `/complete`. Unsupported non-PDF source получает явный `SKIPPED_UNSUPPORTED_FORMAT`; PDF parse/schema error не маскируется под успешный OCR.

Для provider-neutral стадий API также не доверяет произвольному worker JSON: принимает только точный ожидаемый контракт, сам канонизирует его, считает hash/size и сохраняет `analysis_stage_artifacts`. Каждый run/job связан FK с immutable release manifest; claim отдаёт его hash, lifecycle, запрет external network и только slot текущей stage. Provider identity/config остаются пустыми до qualification gate; подмена ненулевого output или неизвестного disposition отклоняется. Если release объявит slot `CONFIGURED`, но соответствующий adapter не зарегистрирован, worker fail-closed вместо возврата ложного результата.

При ошибке worker вызывает `/internal/v1/jobs/{id}/fail` с attempt/fence, error_code, retryable_hint, безопасной диагностикой и timings. Сервер определяет retry policy, а не доверяет флагу worker; пишет attempt и следующий retry/DLQ атомарно. Heartbeat/complete/fail требуют действующей identity и fencing token. Утрата lease прекращает дальнейшую публикацию результатов попытки. Cancellation проверяется heartbeat и между ограниченными единицами работы; непрерываемый внешний inference может закончиться, но его stale output не принимается.

Большие результаты коммитятся набором ограниченных chunks. Каждый chunk имеет ordinal/hash и idempotent receipt; seal job принимает их только при полном manifest. Частично загруженный output не виден review.

## Состояния и повторы

Job: BLOCKED → READY после успешных persisted prerequisites; READY → LEASED → SUCCEEDED; LEASED → RETRY_WAIT → READY; окончательный отказ → FAILED; invalid envelope → DEAD; отмена run → CANCELLED. STALE_RESULT — disposition отвергнутого commit, а не успех job.

Transient storage/network/provider failure: максимум три попытки всего, задержки перед второй/третьей 30 и 120 секунд с jitter. Это default проекта, согласуемый с требованием до двух повторов обработки файла. Invalid document, unsupported format и schema error автоматически не повторяются. Операционный redrive создаёт новую попытку/команду с причиной, не удаляет прошлые ошибки.

Scheduler восстанавливает просроченный lease, увеличивает fence и публикует новый job.ready. Старый worker после этого не может применить результат даже при успешном завершении. Timeout отдельно от worker crash; частичный output остаётся для диагностики/GC.

## Crash cases

| Момент сбоя | Восстановление |
|---|---|
| Commit job в БД до публикации | Outbox dispatcher публикует после рестарта |
| Publish подтвердился, outbox mark не записан | Возможна повторная доставка, semantic key/claim защищают эффект |
| Worker умер после claim | Lease expires, scheduler создаёт новую попытку |
| Output записан, commit не выполнен | Повтор complete или orphan GC; доменного результата ещё нет |
| Commit выполнен, ответ/ack потерян | Repeat complete возвращает сохранённый receipt |
| Запущен новый run / inspection закрыта | Старый commit отклонён по gate/fence; старые данные не активируются |
| Потерян Redis | Кэш восстанавливается, correctness сохраняется |

UI progress строится из persisted DAG counts и stage timings. Redis ускоряет чтение, но не создаёт фиктивные проценты. Ожидаемое время показывается только при наличии статистики сходных задач; иначе «время оценивается».

## Events

Domain outbox events: upload.committed, analysis.started, stage.finished, analysis.sealed, review.decided, protocol.finalized, protocol.revoked, delivery.updated, dataset.published, model.approved. Payload содержит immutable refs и aggregate_version. Consumers хранят receipt по event_id; для read-model важен порядок aggregate_version, глобальный порядок между объектами не нужен.

Нельзя строить human protocol только из событий очереди: snapshot читается из транзакционно согласованной БД. Operational logs не содержат полного документа, секретов или private model prompts с исходным текстом.
