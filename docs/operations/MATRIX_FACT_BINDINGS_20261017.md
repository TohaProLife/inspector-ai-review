# T13: привязка конкретного машинного факта

Статус: принят 17.10.2026, 22:52 МСК. Доказательства: `output/matrix-t13-20261017/acceptance.json`.

Общий entity scope файла недостаточен, когда один PDF содержит несколько конструкций. Новая версия решения инспектора связывает конкретную строку и правило с конкретным элементом. Машинный артефакт старого запуска остаётся неизменным; решение применяется только новым запуском.

## Контракт

- `matrixScope` принимает legacy scope или `matrix-fact-scopes-v1` с массивом bindings. Пустой массив явно снимает привязки; возврата к legacy scope нет.
- Binding фиксирует ruleId/version, parameterCode, entityKey, основание, origin check/artifact hash/observationId и переносимый evidence hash.
- Evidence hash включает исходный SHA, стадию, страницу, blockId, значение/единицу, raw text, bbox, все primary/context fragments, extractor version и весь канонический текстовый артефакт. Изменение геометрии или страницы делает прежнее решение неприменимым.
- Новый portable hash кодирует числа IEEE754 binary64 hex; типизированное дерево различает числа, массивы и объекты. Ключи сортируются по UTF-8 bytes. Legacy hashes не меняются.
- Origin run refs подтверждаются сервером по immutable artifact внутри того же объекта и исходного файла. Клиентский evidence hash сам по себе не даёт полномочий.
- Сохранение: session + CSRF + REVIEW_DECIDE + OPEN inspection + idempotency + expected previous source review hash. Новая версия решения append-only, без переписывания старого source review.
- Trusted worker input использует `scopeProofs.FACT_BINDINGS`, привязанный к source/object/new manifest. Legacy `ENTITY_SCOPE` не применяется при наличии этой версии.
- Контекст конкретного правила берётся только из binding конкретного факта. Нельзя перенести его на соседнюю строку.
- Raw `TABLE_CONTEXT_UNVERIFIED` остаётся в observation. Для конкретного сравнения его можно считать проверенным только при отдельном tableContextReview, совпадающем с hash всех контекстных fragments. OCR, stage, revision и approval ограничения этим не снимаются.
- Эта версия не принимает RULE_SCOPE_COMPLETE/PARAMETER_SCOPE_COMPLETE. Отрицательный результат остаётся abstention; coverage PARTIAL. Confidence не повышается.

## Приёмка

1. Один PDF: два разных элемента; только выбранная строка получает entity и контекст. Непривязанные строки остаются видимыми.
2. Привязки ПД/РД одинакового элемента дают точное числовое сравнение; разные элементы, режимы, источник, hash, stage, frame или extractor отказывают.
3. Изменённый origin execution / чужой object / stale review / duplicate binding отклоняются до INSERT. Идемпотентный повтор возвращает исходное решение.
4. Табличное сравнение без отдельного review контекста не квалифицируется. Проверенный контекст не снимает UNKNOWN approval/revision.
5. Новый run использует frozen source review snapshot; old machine hash/bytes остаются прежними после source review, повторного запуска и restart.
6. Браузер: открыть primary и context originals, заполнить binding, сохранить синтетическую проверенную фикстуру, запустить новый run, проверить выбранную строку и отказ по соседним; 1440/768/375.
