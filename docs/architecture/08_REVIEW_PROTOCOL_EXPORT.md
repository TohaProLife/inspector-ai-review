# Review, протоколы и выходные адаптеры

Версия 1.1. [State contract](03_STATE_AND_CONSISTENCY.md) задаёт допустимость команд; здесь — содержание review и выходных артефактов. Хакатонные границы ИАИС/УКЭП уточнены по [Q&A](../HACKATHON_QA_SESSION.md).

## Review item и machine result

Machine result неизменяем. Рабочая карточка `review_item` ссылается на него, добавляет scope review и текущую проекцию decision events. Первоначально связь 1:1. Поля: inspection_id, run_id, origin=MACHINE/HUMAN_SPLIT/HUMAN_PROMOTION, source_result_ids, entity_key, evidence_refs, fingerprint, parent_item_id?, lifecycle=ACTIVE/SUPERSEDED, row_version.

Review item не может самовольно добавить evidence вне manifest. Human annotations (уточнённая область или атомарная интерпретация) хранятся отдельными immutable записями с actor/reason. Если меняются источники, значения или metadata, требуется новый analysis run. Разделение составной карточки по уже имеющимся источникам нового inference не требует, но не меняет frozen predictions и метрики модели.

SPLIT атомарно делает parent SUPERSEDED и создаёт дочерние ACTIVE items с собственными scope/evidence/fingerprint. Частичное подтверждение не создаёт единого GOLD-label на parent. Дочерние решения не наследуются автоматически из составного решения; прежняя история остаётся видимой.

## Решения и причины

| Action | Условия | Обязательные данные |
|---|---|---|
| CONFIRM | Достаточное evidence, утверждённые сопоставимые источники, отсутствие отменяющего согласования | VIOLATION_EVIDENCE_VERIFIED, комментарий |
| REJECT | Кандидат просмотрен, основание объяснено | Один из reason_code ниже, комментарий |
| CLARIFY | Не хватает основания для окончательного решения | Причина и перечень необходимого уточнения |
| VERIFY_NEGATIVE | Machine negative проверен экспертом | NEGATIVE_EVIDENCE_VERIFIED, комментарий |

Rejection codes: OCR_ERROR, WRONG_LINK, OUTDATED_REVISION, APPROVED_CHANGE, NOT_APPLICABLE, VALUE_NORMALIZATION_ERROR, DUPLICATE_FINDING, NO_DISCREPANCY, OTHER. OTHER требует развёрнутый комментарий. Не все причины создают надёжный отрицательный пример предметного сравнения: WRONG_LINK/OCR_ERROR направляются куратору как ошибки pipeline, а GOLD требует валидного evidence_group и отдельного отбора.

Decision хранит actor_id из сессии, timestamp сервера, item fingerprint, previous decision reference, reason_code и comment. UI отправляет максимум 2000 символов комментария; сервер проверяет минимум 5 непустых символов и заданный code. Source links/attachments должны принадлежать объекту. Автоматического внешнего письма при CLARIFY нет: создаётся внутренняя задача, коммуникационная интеграция подключается отдельно.

## Перенос решений

Inherited decision создаётся только при exact semantic fingerprint и проверенном отсутствии новых competing revisions. Его original_actor/original_time остаются прежними; copied_at и source_decision_id показывают происхождение. Устаревшее решение видно в истории, но не используется в active projection.

Изменение модели/правила/нормативного основания по default инвалидирует перенос. Если позже понадобится более мягкая совместимость версий, её следует утвердить отдельным ADR и fixture suite; v1 не угадывает эквивалентность релизов.

## Snapshot протокола

Snapshot содержит:

1. schema_version, protocol_id/version/kind, inspection/object identity, created/finalized metadata.
2. dataset, matrix, mapping, rule, model, normalization и template versions; input_manifest_hash, output_hash и decision_set_hash.
3. Реестр оригиналов, SHA, logical documents, stages, selected revisions и approvals.
4. Сценарий FULL/PD_RD_ONLY/PD_ID_ONLY/RD_ID_ONLY/SINGLE_ONLY/PARTIALLY_LOADED; completeness с основаниями.
5. Отдельные разделы: техническое покрытие, комплектность/сопоставимость, кандидаты, confirmed, negative, clarifications, suspicions.
6. Полные evidence bundles, human decisions и inherited provenance, superseded lineage.
7. Невыполненные правила, причины gaps, acknowledgement неполноты, ограничения качества.
8. Ссылки на предыдущую версию и основание выпуска.

Массивы canonical snapshot сортируются: sources по source_file_id/document_version_id, результаты по parameter/rule/entity/id, decisions по item_id/sequence. Presentation order в PDF определяется template и не меняет snapshot hash.

snapshot_hash вычисляется по canonical payload без самого hash, detached signatures, storage URLs и изменяемых render/sync/revocation statuses. Эти поля находятся во внешнем envelope. ID, дата и порядковый номер выдаются до хеширования в транзакции. Изначально выбранная template version фиксируется в snapshot; альтернативный render хранит собственную версию template в artifact metadata и явно обозначается как другое представление того же содержания.

DRAFT тоже immutable snapshot на момент команды. «Текущая рабочая сводка» — отдельный GET, а не скрыто изменяемая версия протокола. JSON export конкретного protocol_id возвращает его сохранённое содержание, не текущие findings.

## Форматы и подпись

JSON — канонический основной артефакт. PDF генерируется из snapshot с фиксированными template/fonts/renderer versions; повтор скачивания возвращает сохранённые bytes. Перегенерация иного шаблона создаёт новый protocol_artifact, не заменяет старый. Формат оригинального приложения №2 обязателен после получения и разбора; текущий layout — provisional.

PDF включает страницу/лист, фрагменты и locator, readable summary ограничений, номера версии и hash. Длинные таблицы имеют повторяющиеся заголовки и контролируемые разрывы. DOCX/XML — адаптеры того же snapshot, без повторного чтения mutable DB.

Finalization — фиксация решения, не доказательство наличия УКЭП. Если профиль поставки требует подпись, отдельно хранить signature envelope: snapshot hash, signer identity/certificate reference, algorithm, timestamp, validation result. Реализация конкретной подписи зависит от официального интеграционного контракта. UI не пишет «подписано УКЭП», пока криптографическая проверка не успешна.

Для хакатона сертификаты и продуктовые ключи УКЭП не выдаются. Допустим mock connector, демонстрирующий payload/state предполагаемого взаимодействия, но он не создаёт signature envelope и не меняет статус на `SIGNED`.

## Конкурсный inference export

Input: sealed run, frozen predictions, официальный dataset binding, verified adapter/schema/scorer versions. Human decisions и seed labels не являются входом. Export job выполняет schema validation, reference checks, page bounds, object/split integrity, сохраняет output hash и validation report.

Предварительное семантическое соответствие, подлежащее подтверждению официальной схемой:

| Внутренний результат | Внешний label |
|---|---|
| Machine CANDIDATE с достаточным evidence | VIOLATION_PRESENT как прогноз, не юридическое подтверждение |
| Machine NEGATIVE_VERIFIED | NO_VIOLATION |
| MISSING_EVIDENCE с причиной SOURCE_DOCUMENT_MISSING | MISSING_DOCUMENT |
| Недостаточный fragment / NOT_COMPARABLE / CLARIFICATION_REQUIRED | COMPARISON_IMPOSSIBLE, если разрешено методикой |
| NOT_APPLICABLE | Решение адаптера по официальной методике; не преобразовывать молча в NO_VIOLATION |
| UNSUPPORTED/FAILED/CANCELLED | Явный export gap; mapping/omission только по официальной методике |
| SUSPICION / FREE scope | Отдельная policy организатора; по default не превращать в положительную matrix label |

Если обязательный mapping неизвестен, export state BLOCKED_CONTRACT, а не файл «для сдачи». Внутренний predictions JSON доступен для диагностики с явной пометкой. Официальные location/file_id сохраняются точно, display label не экспортируется.

## ИАИС

Хакатонный минимум — pull facade/endpoint, из которого внешняя система сможет получить результат. Реальный MQ/sandbox, credentials и подтверждённая совместимость не требуются без письменного контракта. Этот минимум не отменяет production-модель ниже: mock/facade должен быть явно помечен и не изображать успешную внешнюю доставку.

Input — действующий FINAL snapshot, только confirmed atomic items, версии и реестр входов. Trigger отдельный от prediction export. Delivery key = destination+protocol_id+snapshot_hash+operation. Перед каждой отправкой перепроверить отсутствие revocation. Outbox событие не даёт права отправить уже отозванную версию.

Переход QUEUED→SENDING резервируется транзакционно под inspection/protocol gate; сетевой вызов выполняется вне DB-транзакции. Отзыв после резервирования может пересечься с внешним приёмом: атомарности между двумя системами нет. Для in-flight отправки отзыв устанавливает reconciliation flag, а пришедший receipt сохраняется даже для отозванного протокола. Оператор/адаптер согласует корректирующее действие по внешнему контракту. Нельзя скрыть успешную внешнюю передачу, записав локально CANCELLED.

Отдельные states QUEUED/SENDING/PENDING_SYNC/SYNCED/FAILED/CANCELLED/RECONCILIATION_REQUIRED. При 5xx/timeout — до трёх повторов после первоначальной попытки с задержками 1, 5, 15 минут согласно ТЗ. 4xx требует исправления/оператора, не бесконечного retry. Auth/certificate failure имеет отдельный alert.

На timeout исход может быть неизвестен: использовать idempotency и endpoint сверки получателя, если они предусмотрены контрактом. Если нет — reconciliation, без заявления об exactly-once внешнем эффекте. Локальный протокол остаётся FINALIZED при сбое синхронизации. Отзыв уже доставленного протокола требует отдельного согласованного уведомления/корректирующей операции.

Автоматический забор новых файлов: проверять подпись/происхождение, реестр объекта и upload pipeline. Для FINALIZED inspection — уведомление, не автоматическая дозагрузка в закрытый цикл. Сервис интеграции не имеет права создавать решения инспектора.
