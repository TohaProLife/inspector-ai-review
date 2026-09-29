# Контракты API

Версия 1.0. Нормативная спецификация будущего OpenAPI 3.0.3. Это не готовый файл OpenAPI и не описание текущего API. DTO должны появиться в packages/contracts и соответствовать этим правилам.

## Общие правила

Base path `/api/v1`. JSON использует snake_case. UUID — внутренний ID, `external_id` — официальный ID. Запросы валидируются до команд; неизвестные mutation-поля отклоняются. Decimal — строки, dates — RFC3339/date, суммы байтов — integers.

Аутентификация браузера: серверная сессия в Secure/HttpOnly/SameSite cookie, CSRF-token для mutations, same-origin UI/API. Service principals внутреннего API имеют отдельную аутентификацию и scope, не пользовательские cookie. RBAC проверяется на каждом объектном запросе.

POST-команды принимают `Idempotency-Key`; ключ связан с actor+operation+target+request hash. Повтор одинакового запроса возвращает исходный результат, другой payload с тем же ключом — 409. Команды над изменяемым агрегатом дополнительно требуют `If-Match` текущего ETag: отсутствие — 428, устаревшее значение — 412. На create без существующего агрегата If-Match не нужен. Receipt хранится минимум 30 дней; финансово/юридически значимый finalize receipt — столько же, сколько протокол. Поведение после истечения ключа документируется; финализация дополнительно защищена unique constraints.

Исключения: session login/logout имеют собственную auth/session semantics и не сохраняют пароли в command receipts; внутренние jobs используют attempt/fence receipt по 05. Multipart request hash строится по нормализованному списку фактически принятых item hashes и metadata; до приёма bytes сервер резервирует ключ/session. Параллельный повтор in-flight возвращает status URL/409 COMMAND_IN_PROGRESS, не запускает вторую запись. При committed receipt idempotency lookup выполняется до проверки устаревшего If-Match, но после текущей аутентификации/авторизации: корректный retry не получает ложный 412.

Списки: `{items, next_cursor}`; limit default 50, max 200; сортировка `created_at,id`, cursor непрозрачный, scoped к фильтрам. GET агрегата возвращает ETag с row_version. Предметные статусы не кодируются HTTP-ошибкой: MISSING_EVIDENCE — успешный результат. HTTP 5xx — техническая ошибка.

## Маршруты пользователя

| Метод и путь | Назначение / обязательный вход | Выход |
|---|---|---|
| POST /auth/login | login, password | Сессия, 200; без пароля в логах |
| POST /auth/logout | CSRF | 204, сессия отозвана |
| GET /me | — | actor, roles, capabilities |
| POST /objects | name, address, external_id? | 201 Object |
| GET /objects | query, cursor | Список доступных объектов |
| GET /objects/{id} | — | Object + разрешённые действия |
| POST /objects/{id}/inspections | mode=NORMAL, as_of_date, scenario, dataset_version? | 201 Inspection |
| GET /inspections/{id} | — | Lifecycle, active run, row_version, blockers |
| POST /inspections/{id}/uploads | declared_files, stage_hints, total_bytes | 201 UploadSession, лимиты, expires_at |
| POST /uploads/{id}/content | Multipart, ограниченный пакет | 202, intake status URL; bytes в quarantine |
| GET /uploads/{id} | — | File-level статусы/ошибки/scan progress |
| POST /uploads/{id}/commit | manifest of READY items, inspection If-Match | 200, file registrations и новая inspection version |
| POST /uploads/{id}/cancel | reason | 200, terminal session |
| GET /inspections/{id}/files | stage, format, quality, cursor | SourceFiles и completeness отдельно |
| GET /files/{id} | — | Metadata, versions, provenance |
| GET /files/{id}/download | — | Краткоживущий доступ к оригиналу после scope check |
| GET /files/{id}/pages/{page} | renderer/config version | Page metadata, preview/tile refs, transforms |
| POST /inspections/{id}/metadata-resolutions | assertion_ids, chosen value, reason_code, comment | 201 Resolution; новый run требуется явно |
| POST /inspections/{id}/runs | base_run_id?, release_id, expected_manifest_hash? | 202 Run, Location |
| GET /runs/{id} | — | State, progress, versions, timings, gaps |
| POST /runs/{id}/cancel | reason | 202 cancellation requested |
| GET /runs/{id}/coverage | section, implementation_status | ParameterCoverage[] |
| GET /runs/{id}/results | parameter, machine_status, entity, cursor | Frozen machine results |
| GET /runs/{id}/review-items | review_status, risk, cursor | Рабочая очередь |
| GET /review-items/{id} | — | EvidenceBundle, machine origin, review, ETag |
| POST /review-items/{id}/decisions | action, reason_code, comment, evidence_fingerprint | 201 Decision + обновлённый ETag |
| POST /review-items/{id}/split | atomic children, evidence subsets, reasons | 201, дочерние review items |
| POST /review-items/{id}/promote | rule identity, evidence subsets, reason_code, comment | 201 HUMAN_PROMOTION item; только достаточно обоснованная SUSPICION |
| POST /review-items/{id}/clarifications | requirements, target?, due_at?, comment | 201 task; не отправляет внешнее письмо |
| POST /inspections/{id}/draft-protocols | run_id, expected_decision_set_hash | 201 immutable DRAFT snapshot |
| POST /inspections/{id}/finalize | run_id, decision_set_hash, acknowledged_gaps_hash? | 201 FINAL snapshot, render job refs |
| POST /protocols/{id}/revoke | reason_code, comment | 201 Revocation, inspection reopened |
| GET /inspections/{id}/protocols | cursor | Версии и validity/revocation |
| GET /protocols/{id} | — | Snapshot и artifact status |
| GET /protocols/{id}/export | format=json/pdf/docx/xml | 200/redirect на готовый артефакт; 409 если ещё не готов |
| POST /protocols/{id}/renders | format, template_version | 202, только разрешённые версии/форматы |
| POST /runs/{id}/prediction-exports | adapter_version, dataset_version | 202 export job, без необходимости human review |
| GET /exports/{id} | — | State, schema/hash, validation report, file ref |
| POST /protocols/{id}/sync | destination | 202 Delivery; FINAL и действительность обязательны |
| GET /deliveries/{id} | — | State, попытки, receipt; без секретов |
| GET /catalog/parameters | matrix_version, section | Исходный каталог и implementation coverage |
| GET /audit | inspection_id, cursor | Только доступный пользователю audit |

Все `{id}` и `{page}` должны иметь явные OpenAPI parameters. У каждого endpoint описываются request/response schemas и все фактически возможные ошибки. Бинарный multipart — документированное исключение из JSON, не попытка закодировать PDF в base64 JSON.

## DTO run и review

Пример формы; строки `<uuid>` и `<sha256>` являются метапеременными спецификации, а не валидными значениями production JSON.

```json
{
  "id": "<uuid>",
  "inspection_id": "<uuid>",
  "state": "PARTIAL",
  "manifest_hash": "<sha256>",
  "release_id": "<uuid>",
  "sealed": true,
  "progress": {"phase": "COMPLETE", "completed_units": 132, "total_units": 132},
  "coverage": {"catalog_parameters": 132, "executed_parameters": 8, "unsupported_parameters": 124},
  "review": {"pending_candidates": 2, "confirmed_atomic_items": 0},
  "gaps_hash": "<sha256>",
  "allowed_actions": ["REVIEW", "START_NEW_RUN"]
}
```

progress.units обозначает завершённый scheduling accounting, включая явные UNSUPPORTED; UI никогда не подписывает это как «проверено 132». В примере цифры только иллюстрируют различие; product API вычисляет их из ledger.

```json
{
  "action": "REJECT",
  "reason_code": "APPROVED_CHANGE",
  "comment": "Изменение подтверждено приложенным согласованием",
  "evidence_fingerprint": "<sha256>"
}
```

actor, decided_at и status клиент не задаёт. If-Match относится к review item; сервер дополнительно проверяет inspection OPEN и активный run в транзакции. Ответ включает decision_id, effective_review_status, item ETag и inspection_version для обновления сводки.

Минимальные DTO: Object(id, external_id?, name, address, allowed_actions); Inspection(id, object_id, lifecycle, as_of_date, scenario, active_run_id?, row_version, blockers); UploadSession(id, inspection_id, state, declared/received bytes, item statuses, expires_at); ReviewItem(id, run_id, origin, lifecycle, machine_origin, effective_review_status?, evidence_bundle, row_version, allowed_actions); Protocol(id, version, kind, snapshot_hash, validity, render_artifacts, sync_summary). Blocker = code + target_ref + message + required_action; клиент не парсит текст ошибки, чтобы выбрать действие. Полный EvidenceBundle задан в 07, snapshot — в 08. Null означает неизвестно/неприменимо по полю; отсутствие обязательного поля — schema error.

## Ошибки

Единый envelope: `{error:{code,message,details,retryable},request_id}`. details не раскрывает storage credentials, внутренние пути и traceback.

| HTTP | Коды |
|---|---|
| 400 | VALIDATION_ERROR, INVALID_CURSOR, INVALID_GEOMETRY |
| 401/403 | AUTH_REQUIRED / ACCESS_DENIED, ROLE_REQUIRED |
| 404 | NOT_FOUND; недоступный объект можно скрывать этой же ошибкой |
| 409 | INVALID_TRANSITION, ACTIVE_RUN_EXISTS, UPLOADS_PENDING, PENDING_DECISIONS, EVIDENCE_INCOMPLETE, STALE_INPUT, IDEMPOTENCY_CONFLICT, COMMAND_IN_PROGRESS, EXPORT_NOT_READY, CONTRACT_UNVERIFIED |
| 412/428 | VERSION_MISMATCH / PRECONDITION_REQUIRED |
| 413/415 | FILE_TOO_LARGE, BATCH_TOO_LARGE / UNSUPPORTED_FORMAT |
| 422 | MALWARE_DETECTED, CORRUPT_DOCUMENT, INVALID_EVIDENCE_REFERENCE |
| 429 | RATE_LIMITED с Retry-After |
| 503 | DEPENDENCY_UNAVAILABLE, MALWARE_SCANNER_UNAVAILABLE |

Ошибки фоновых заданий отражаются в GET ресурса через typed failure, а не меняют уже возвращённый 202. UploadSession хранит retryable и безопасную рекомендацию для каждой ошибки.

## Администрирование и ML-контур

Admin API: версии матрицы/норм, draft edit, approve/publish/deactivate, каталог пользователей/ролей, revocation и DLQ redrive. ML API: dataset drafts, annotation/curation, frozen dataset release, evaluation runs, model release candidate, approve/deploy/rollback. Все — версии и аудит; опубликованные записи не редактируются на месте. Роль ML engineer не получает право подтверждать нарушение.

Ниже `/admin` и `/ml` также находятся под `/api/v1`; те же receipt/If-Match/error rules обязательны. Append-only ресурсы не имеют PATCH после publication. Role/capability проверяется отдельно от namespace.

| Метод и путь | Вход / результат |
|---|---|
| POST /admin/users; GET /admin/users | Создать пользователя / доступный список, пароль не возвращается |
| POST /admin/users/{id}/memberships | organization/object, capabilities, reason; новая версия прав и audit |
| POST /admin/users/{id}/disable | reason; отключение и отзыв сессий |
| POST /admin/catalog-imports | source artifact/hash, matrix version; 202 validate/import draft, без publication |
| POST /admin/rule-versions | parent_id?, typed definition по 07, fixtures refs; 201 DRAFT |
| POST /admin/normative-versions | source refs/hash, effective dates, scope; 201 DRAFT |
| POST /admin/rule-versions/{id}/approve | expert review, fixture report; APPROVED immutable version |
| POST /admin/normative-versions/{id}/approve | expert review, applicable dates/scope; APPROVED |
| POST /admin/matrix-versions/{id}/publish | approved mappings/rules refs, reason; immutable release |
| POST /admin/jobs/{id}/redrive | failure diagnosis, reason; новая audited попытка, если вход ещё действителен |
| GET /ml/annotation-drafts | dataset/object/status cursor; без hidden data в training scope |
| POST /ml/annotation-drafts/{id}/curate | approve/reject, atomic labels, source refs, reason; curator identity |
| POST /ml/dataset-versions | approved annotation IDs, split policy/version; frozen manifest/hash |
| POST /ml/evaluations | dataset_version, release_id, scorer_version, hardware_profile; 202 evaluation |
| GET /ml/evaluations/{id} | State, timings, report/hash, metrics/denominators/CI, failures |
| POST /ml/training-runs | approved training dataset, base model, versioned config/resource profile; 202 candidate job |
| GET /ml/training-runs/{id} | State, provenance, output artifact and report; не deploy |
| POST /ml/model-releases | artifact/config/rule refs и hashes; 201 DRAFT |
| POST /ml/model-releases/{id}/approve | qualifying evaluation refs и reason; APPROVED или gate failure |
| POST /ml/deployments | approved release_id, environment, expected_active_release, reason; переключение для новых runs |
| POST /ml/deployments/{id}/rollback | approved prior_release_id, expected_active_release, reason; новый deployment event |

Для draft correction создаётся новая draft version с parent_id, а не незаметная правка published artifact. GET version/detail/history endpoints для этих ресурсов имеют те же UUID/scope/pagination conventions; их schemas обязательны в B02. Async catalog/training/evaluation возвращают task status URL. Обучающий job использует отдельный TRAINING scope и никогда не имеет production deploy capability.

GET /health/live проверяет процесс; GET /health/ready проверяет БД и возможность обслуживать заявленные операции. Diagnostics по очереди/OCR/scanner доступны оператору; отсутствие OCR не должно маскироваться общим health=ok для запуска анализа.

## Legacy и ИАИС

Текущие `/api/...` маршруты на время миграции оборачивают те же доменные команды. Запреты FINALIZED и object scope не обходятся legacy-маршрутом. author из старого payload игнорируется/отклоняется, machine и review projections не смешиваются. Frontend переводится на v1 до удаления адаптера.

`POST /api/v1/documents/upload → process_id` и интеграционный контракт ТЗ реализуются отдельным facade над upload+inspection. process_id однозначно связывается с inspection/run в adapter registry. Точное тело и авторизация ИАИС — внешний blocker; не объявлять собственный endpoint совместимым без контрактного теста.
