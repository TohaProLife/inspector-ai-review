# T50: порядок проверки и переход к исходникам

План сформирован во время финальных проверок T49; runtime меняется только после его приёмки. Текущий реальный CHK-5752877C содержит63 scalar отказа:2 имеют исходные факты обеих стадий,4 одной,57 ни одной. Это наличие исходного материала, а не готовность пары к сравнению.

1. [x] Независимый read-only аудит actual frozen execution и план до production edits: `output/matrix-t50-20261018/plan-before-implementation.json` и `qa-plan-*`.
2. [x] Независимые первые RED-тесты helper/UI до реализации.
3. [x] По умолчанию все результаты в прежнем порядке. Явные фильтры наличия фактов и optional stable сортировка. Неподтверждённые ссылки видны при любом фильтре.
4. [x] Один общий список текущих исходников: пользователь явно выбирает файл по ID+SHA. Факт, стадия, пара и человеческое согласование не назначаются.
5. [x] Полные web tests/typecheck/build и coherent feedback stand deployment. Прежние60 запусков и адреса фактов сохранены.

Одинаковый SHA разных source IDs не разрешает подмену адреса. Старый fixture FIL-EFFB9834/FIL-4D91EF2A не служит current-file evidence для actual FIL-CD2E6B3A/FIL-00F786A2. Shared source chooser использует переданные файлы объекта; T49 source-text loader независимо проверяет check/object/manifest.

Машинное покрытие и вероятность не меняются. SSR/HTTP не являются browser evidence; действующий browser security hold сохраняется.

## Приёмка 18 октября, 05:16 UTC

Backend принят, browser pending. Полный web suite686PASS/60files, независимые controls83PASS, typecheck/buildPASS. Первый runtime RED сохранён: stateless presentation отделена от stateful controller и общего chooser без изменения прежних test expectations. Independent controls QA corrections (CSS100% assertion scope и type-only annotation) отдельно записаны.

ActualHTTP13GET/8pureSSRviews подтвердил63/2/4/57/0, точные keys/indices/bytes и prefix32,33,3,4,13,35. Source chooser только явно выбранные current ID+SHA; callbacks/fetch в SSR0. Матрица/submission/targets/files байтово прежние; source review0, confidence promotions0. Served web assets побайтово совпали с локальной сборкой; исполнения bundle/DOM это не доказывает.

Обновлён только web. API/outbox/4workers ID/image/StartedAt прежние;20 других контейнеров прежние, GPU RTX2080SUPER8192MiB. Сохранены60snapshots/203targets/132legacytargets/1localreview иFAILED run. API3611/131skip, PG120/0skip и Python2564/17skip унаследованы из принятых неизменных исходников, повторно не запускались.

Receipt: `output/matrix-t50-20261018/acceptance.json`; freeze653files+3deps SHA551d8eea5184d1fd5bc2b7063f1f91c9c5e8ddb628653e69b790f3ff55cdd0a0. Следующий этапT51: отдельная source-only grammar водомерного узла, независимые full-PDF goldens/PY/TS до reviewed comparator. Coverage58/66/74 не меняется.
