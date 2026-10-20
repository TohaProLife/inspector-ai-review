# ИАИС: хакатонный pull facade, 20 октября 2026

Основание: [Q&A, 08:23–08:56 и 29:47–30:15](../HACKATHON_QA_SESSION.md) и [архитектура экспорта](../architecture/08_REVIEW_PROTOCOL_EXPORT.md#иаис). Для хакатона достаточно endpoint/facade. Production schema, сертификаты, MQ/sandbox и подтверждение внешнего приёма здесь не реализуются.

`GET /api/integrations/iais/protocols/:id` — только authenticated object READ, сохранённый NORMAL FINAL и текущий VALID. Нет fallback на DEMO_SEED или legacy JSON без canonical artifact. SOURCE_AUDIT_ONLY не выдаётся как результат сопоставления. Маршрут не меняет решения, протоколы, cache или состояние доставки; исходящих запросов нет.

Фиксированные до реализации ожидания:

- Нет сессии: 401 до repository lookup. Чужой объект/tenant: 404 без snapshot.
- DRAFT, REVOKED, неизвестная validity, DEMO_SEED и SOURCE_AUDIT_ONLY: отказ до выдачи данных.
- Canonical hash, длина, UTF-8/c14n и protocol/check/object/organization identity проверяются; битый, отсутствующий или чужой artifact не заменяется текущими findings.
- После чтения bytes повторно проверяются сессия, scoped protocol validity и NORMAL check. Изменение доступа, hash или отзыв во время чтения дают отказ.
- Canonical JSON string/hash неизменны между запросами; checkedAt/readAt относятся только к текущему envelope. Нет утверждения exactly-once, атомарности с внешним получателем или защиты от отзыва после последней проверки.

Ответ имеет `mode=MOCK_PULL_FACADE`, `payloadPolicy=FULL_SNAPSHOT_MOCK_ONLY`, `signature.status=NOT_CONFIGURED`, `externalDelivery.status=NOT_CONFIRMED`, `outboundRequests=0`. Полный frozen snapshot может содержать кандидатов и gaps: это диагностический mock payload, не согласованная production schema ИАИС с confirmed atomic items.

`canonicalSnapshot.json` — точная UTF-8 строка сохранённых canonical bytes. Проверка: SHA256(UTF8(json)) должен равняться `canonicalSnapshot.contentHash`, `protocol.snapshotHash` и `X-Protocol-Snapshot-SHA256`. Не пересериализовывать parsed JSON для этой проверки. Ссылки PDF/DOCX/XML и canonical JSON — локальные authenticated downloads; их доступность не подтверждает внешний приём. Envelope validity читается заново при каждом pull; отдельные исторические download endpoints могут выдавать уже отозванную версию с пометкой.

Подключение: `registerIaisPullRoutes(app, { repository, requireActor, schema: fastifySchemaFor("getIaisProtocolPull") })`. Вызов requireActor должен использовать штатную identity/session проверку. `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`; лимит canonical snapshot 8 MiB. Ответы: 401 auth, 404 scope/not found, 409 eligibility/integrity/state change, 413 size, 503 unavailable adapter.

```sh
# SESSION_COOKIE_FILE — локальный файл с ранее полученной сессией; не публиковать.
curl --fail-with-body --cookie "$SESSION_COOKIE_FILE" \
  "http://127.0.0.1:8080/api/integrations/iais/protocols/$PROTOCOL_ID"

npm exec --workspace @inspector-ai/api -- vitest run --maxWorkers=1 test/iais-pull-routes.test.ts
```

Ограничение приёмки: focused HTTP fixtures проверяют маршрут и отказы; не доказывают внешний ИАИС, подпись, production schema или доставку.

Проверено локально: 40 Fastify HTTP cases PASS (37 guard cases и 3 проверки настоящего buildApp/OpenAPI) — auth до lookup, tenant/user scope, eligibility, exact canonical bytes/hash/UTF-8/c14n (включая BOM/duplicate keys), recheck session/access/revocation перед ответом; outbound fetch и mutation methods не вызываются. Подключение к основному app/schema и API typecheck PASS. Клиентская ссылка экранирует ID; 6 focused client tests PASS. Для действующего FINAL в интерфейсе протокола доступна ссылка «Пакет для тестового обмена с ИАИС».
