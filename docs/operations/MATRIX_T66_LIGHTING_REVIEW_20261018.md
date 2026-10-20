# T66 — исходный аудит и разметка освещения

Обычный пользователь с RUN запускает source-audit-v3 через отдельную команду объекта. Сессия, CSRF, idempotency и права объекта проверяются; создаётся обычный DAG из девяти jobs. Сервер не завершает его внутри HTTP команды.

Предпросмотр использует полный immutable document-text-v3. Запрос содержит одну или две точные строки с native sourcePath. Сохранение source review принимает только target, selection, именованную физическую позицию, явное сопоставление и основание. Сервер сам восстанавливает declarationSnapshot из ранее запечатанного audit origin. Подмена source SHA, stage, hash, текста либо snapshot отклоняется.

Разметка сохраняется append-only с CAS по expectedReviewHash. Пропущенный scope наследуется после повторной проверки; пустой claims отзывает его. Полные review hashes включают новое поле только при наличии; старые решения сохраняют прежние байты. Миграция 039 добавляет nullable колонку.

Проверки: 20 boundary методов, 57 с соседними; два public route сценария; четыре независимых PostgreSQL сценария с настоящими jobs, previews, inheritance, revoke и историей. Contracts/API typecheck PASS. Receipt: `output/matrix-t66-20261018/acceptance.json`. На момент локальной приёмки стенд не обновлён. T67 продолжает actual v9 execution, T68 — пользовательский экран.
