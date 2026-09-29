# Документация проекта

Срез передачи: **29 сентября 2026**. Текущий проект включает рабочий кабинет, сохранение документов и решений, ограниченные профили анализа и версионированный протокол. Справочник содержит 132 параметра; автоматическая проверка всех 132 не реализована. Архитектурные документы описывают также целевое поведение, которое нельзя считать выполненным без подтверждения в отчёте проверки.

## С чего начать

1. [Передача проекта](SUBMISSION.md) — состав, сценарий демонстрации и границы результата.
2. [Финальная проверка](FINAL_VALIDATION_2026-09-29.md) — проверенная версия, фактические команды, результаты и непроверенные сценарии.
3. [Запуск из корня проекта](../README.md) — PostgreSQL, открытая рабочая сессия, ClamAV, Linux Compose и переносимый запуск тестов.
4. [Статус реализации](IMPLEMENTATION_STATUS.md) — история принятых изменений и ограничения конкретных профилей.
5. [Архитектура](ARCHITECTURE.md) и [план приёмки](architecture/12_DELIVERY_AND_ACCEPTANCE.md) — инварианты, целевые контракты и критерии.
6. [Открытые решения](architecture/13_OPEN_QUESTIONS.md) — недостающие внешние контракты и вопросы методики.

Для текущего web нужны PostgreSQL и `INSPECTOR_OPEN_WORKSPACE=1`; пользователи этого режима работают от общей учётной записи без формы входа. Загрузка требует доступного ClamAV, завершение анализа — relay/workers и провайдеров выбранного профиля. Миграции `001`–`029` применяет единый runner. Полные Python-проверки запускаются через `node scripts/run-python-tests.mjs` на Windows и Linux.

Старые отчёты фиксируют состояние на дату своего заголовка. Ссылки из исследований на `output/` относятся к локальным артефактам, которые не входят в Git; они не заменяют [финальный отчёт](FINAL_VALIDATION_2026-09-29.md).

## Источники и разрешение противоречий

Первичное основание — [PDF-ТЗ](source/10-Мосстройнадзор.pdf) с обязательными приложениями. Официальная [сессия вопросов и ответов](HACKATHON_QA_SESSION.md) уточняет хакатонный scope, но обещание будущего файла или формулировка «скорее всего» не считаются полученным контрактом. Официальные dataset/schema/scorer contracts определяют машинный формат и методику конкурса, когда получены и проверены. Если источники конфликтуют, конфликт регистрируется и уточняется; выбирать удобную версию молча нельзя.

Следующий уровень — проектные решения в этой папке. UI-референсы и mockups не задают бизнес-логику. Старые сопроводительные материалы не заменяют первичную методику. Приложение №2 с формой протокола нельзя целиком считать необязательным визуальным примером; его доступность и точная форма отмечены в Q-07.

## Карта

| Документ | Назначение |
|---|---|
| [SUBMISSION](SUBMISSION.md) | Передача проекта, запуск и сценарий демонстрации |
| [FINAL_VALIDATION_2026-09-29](FINAL_VALIDATION_2026-09-29.md) | Итог выполненных проверок и оставшиеся ограничения |
| [PRODUCT_SPEC](PRODUCT_SPEC.md) | Продуктовые обязательства и границы |
| [ARCHITECTURE](ARCHITECTURE.md) | Вход в спецификации 01–15 |
| [PROVIDER_SELECTION](architecture/15_PROVIDER_SELECTION.md) | Выбор providers для laptop и H100-сервера, alternatives и qualification gates |
| [H100_MODEL_RESEARCH](H100_MODEL_RESEARCH.md) | Модели класса Laya, применимость к проекту и выбор baseline для H100 80 ГБ |
| [DOCKER_PROFILES](operations/DOCKER_PROFILES.md) | Полное Docker-развёртывание laptop/server: приложение, OCR, VLM, embeddings и pgvector |
| [BONSAI_LAPTOP_DEPLOYMENT](operations/BONSAI_LAPTOP_DEPLOYMENT.md) | Детали Bonsai 2 27B: CUDA runtime, model lock и offline import |
| [LOCAL_MODEL_PROBE_20260925](operations/LOCAL_MODEL_PROBE_20260925.md) | Реальные PDF на homeserver: PDFium → PaddleOCR → Bonsai → проверка цитат, облегчённый Compose |
| [DRAWING_TEMPLATE_PROBE_20260926](operations/DRAWING_TEMPLATE_PROBE_20260926.md) | Поиск обозначений по шаблонам и векторному контексту на `TRAIN_PUBLIC`; результаты и ограничения |
| [PARAMETER_ROUTING_PILOT_20260926](operations/PARAMETER_ROUTING_PILOT_20260926.md) | Запуск PZ-002, решения по источникам, проверяемый кандидат и ограничения |
| [OCR_HEAT_ROW_REVIEW](operations/OCR_HEAT_ROW_REVIEW.md) | Ограниченная помощь эксперту по OCR-строкам тепловых нагрузок и границы доказательств |
| [PUBLIC_FAMILY_OCR_LEAD_TRIAGE_20260928](operations/PUBLIC_FAMILY_OCR_LEAD_TRIAGE_20260928.md) | Разбор SHA-аудированных OCR-совпадений: контекст против предметных строк и визуальные ошибки |
| [BOUNDED_OCR_V5_PUBLIC_RUN_20260928](operations/BOUNDED_OCR_V5_PUBLIC_RUN_20260928.md) | Сквозной v5 на открытом F0202: три страницы, независимая проверка рендера и границы вывода |
| [OCR_TABLE_ROWS_REVIEW_20260928](operations/OCR_TABLE_ROWS_REVIEW_20260928.md) | Review-only извлечение строк таблицы из сохранённого OCR F0202, без назначения кодов и фактов |
| [OCR_TABLE_ROWS_COMPOSE_20260928](operations/OCR_TABLE_ROWS_COMPOSE_20260928.md) | Opt-in сохранение, независимая API-проверка и browser smoke 16 некодированных строк F0202 |
| [OCR_ROW_TRANSCRIPTION_COMPOSE_20260928](operations/OCR_ROW_TRANSCRIPTION_COMPOSE_20260928.md) | Append-only журнал ручного чтения OCR-строки; API, PostgreSQL и браузер проверены на homeserver без реальных решений |
| [OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928](operations/OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928.md) | Отдельный OCR-табличный v2: 17 некодированных строк F0202; снимок решений в новом run, сквозной Compose и границы проверки |
| [SOURCE_SECTION_RD_VOCABULARY_20260928](operations/SOURCE_SECTION_RD_VOCABULARY_20260928.md) | Ручной выбор 11 дополнительных разделов РД для 47 кандидатных правил; без автоматического утверждения источника |
| [F0202_OCR_TABLE_P7_VISUAL_AUDIT_20260928](operations/F0202_OCR_TABLE_P7_VISUAL_AUDIT_20260928.md) | Сверка p.7 оригинального F0202: три пары, ошибки OCR и неполный список |
| [OCR_ROW_CONFIRMATION_GATE](operations/OCR_ROW_CONFIRMATION_GATE.md) | Граница между чтением OCR-строки, предметным фактом и сопоставлением ПД/РД |
| [OCR_ROW_APPLICABILITY_COMPOSE_20260928](operations/OCR_ROW_APPLICABILITY_COMPOSE_20260928.md) | Журнал применимости, снимок нового run и read-only OCR_ROW кандидаты: PostgreSQL и изолированный homeserver Compose |
| [OCR_TYPED_FACT_DURABLE_20260928](operations/OCR_TYPED_FACT_DURABLE_20260928.md) | Opt-in неизменяемый артефакт OCR_ROW кандидатов: независимая проверка при сохранении, завершении и чтении; Compose на открытом F0202 |
| [OCR_TABLE_V3_PUBLIC_RUN_20260928](operations/OCR_TABLE_V3_PUBLIC_RUN_20260928.md) | Отдельный v3 с продолжением подписи OCR-таблицы: SHA, PostgreSQL, Compose и браузерная проверка на открытом F0202 |
| [OCR_FACT_PAIR_JOURNAL_20260928](operations/OCR_FACT_PAIR_JOURNAL_20260928.md) | Отдельный журнал решений о паре OCR_ROW фактов: синтетическая положительная PG проверка и публичный Compose ABSTAIN |
| [KR_MATERIAL_REVIEW_20260928](operations/KR_MATERIAL_REVIEW_20260928.md) | KR-056/KR-057: 10 разрешённых исходных PDF, 521 страница v4, SHA и визуальная проверка; все наблюдения ABSTAIN |
| [OCR_FACT_PAIR_SNAPSHOT_20260928](operations/OCR_FACT_PAIR_SNAPSHOT_20260928.md) | Неизменяемый перенос последнего решения о паре OCR_ROW в новый запуск с пересчётом ID фактов; публичный Compose ABSTAIN |
| [OCR_QUANTITY_REVIEW_COMPOSE_20260928](operations/OCR_QUANTITY_REVIEW_COMPOSE_20260928.md) | Отдельный журнал количественной сопоставимости OCR_ROW пары, серверный evidence hash и сквозной публичный ABSTAIN |
| [AR_EVACUATION_HEIGHT_REVIEW_20260928](operations/AR_EVACUATION_HEIGHT_REVIEW_20260928.md) | AR-042: три публичных PDF, 125 страниц, SHA и визуальная проверка; все наблюдения ABSTAIN |
| [ZU129_PUBLIC_OCR_LEAD_AUDIT_20260928](operations/ZU129_PUBLIC_OCR_LEAD_AUDIT_20260928.md) | Шесть визуально проверенных публичных OCR-подсказок ZU-129 с SHA, все ABSTAIN |
| [KR_SLAB_PUBLIC_PROBE](operations/KR_SLAB_PUBLIC_PROBE.md) | Проверенные наблюдения KR-058/KR-059 на листах ПД и РД, без вывода о нарушении |
| [KR055_CONCRETE_PUBLIC_PROBE](operations/KR055_CONCRETE_PUBLIC_PROBE.md) | Проверенные классы бетона KR-055 на открытых листах КР и границы сопоставления |
| [PZ004_VOLUME_PROBE](operations/PZ004_VOLUME_PROBE.md) | Проверка двух записей строительного объёма и ограничение по источнику РД |
| [IOS4_078_PUBLIC_CASE_AUDIT](operations/IOS4_078_PUBLIC_CASE_AUDIT.md) | Независимая проверка пяти открытых примеров вентиляции и причин воздержания |
| [IOS4_079_PUBLIC_CASE_AUDIT](operations/IOS4_079_PUBLIC_CASE_AUDIT.md) | Независимая проверка открытого примера вентилятора и требования к сравнению |
| [CATALOG_READINESS_PUBLIC](operations/CATALOG_READINESS_PUBLIC.md) | Поимённая инвентаризация 132 параметров, открытых источников и границ проверки |
| [TEST_MATRIX](operations/TEST_MATRIX.md) | Полный набор локальных, PostgreSQL и инфраструктурных проверок |
| [PUBLIC_REVIEW_VISITOR_20260929](operations/PUBLIC_REVIEW_VISITOR_20260929.md) | Подготовка трёх публичных PDF-примеров; отличие текущего кабинета от прежнего гостевого режима |
| [UX](UX.md) | Принципы и пользовательские сценарии |
| [DATASET_AND_EVALUATION](DATASET_AND_EVALUATION.md) | Фактически доступные данные и ограничения оценки |
| [MVP_PLAN](MVP_PLAN.md) | Релизные границы и порядок старта |
| [HACKATHON_QA_SESSION](HACKATHON_QA_SESSION.md) | Выводы из записи Q&A с временными ссылками и границами уверенности |
| [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) | Проверенное текущее состояние кода |
| [UI_REFERENCES](UI_REFERENCES.md) | Визуальные источники; не критерий функциональной готовности |
| [MATERIALS_ANALYSIS](../MATERIALS_ANALYSIS.md) | Исторический разбор материалов, сверять с актуальным аудитом |

## Как поддерживать документацию

Состояния и транзакции определены в 03; API — в 04; правила и coverage — в 07; review/export — в 08; оценивание — в 09. Остальные документы ссылаются на них, а не создают собственные enums. При изменении контракта обновляются его версия, затронутые DTO/fixtures и acceptance mapping. IMPLEMENTATION_STATUS меняется только после проверки реализованного поведения.
