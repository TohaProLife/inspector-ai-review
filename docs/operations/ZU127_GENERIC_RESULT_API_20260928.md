# Независимая проверка ZU-127 generic stage v3

`apps/api/src/zu127-generic-stage-v3.ts` проверяет результат отдельного worker-профиля `zu127-generic-poppler-page-review-v3`. Это opt-in внутренний контракт; маршрут сохранения, seal, GET, очередь и штатный worker к нему пока не подключены.

Проверка принимает только данные, которые вызывающий API получил из неизменяемых снимков run, release, решений по источникам и `document-text-v2`. Для каждой выбранной страницы вызывающий API должен предоставить **оригинальные** байты PDF по `sourceFileId`; путь и байты из результата worker не принимаются. Проверяющий:

1. независимо пересчитывает выбор страниц из проверенных снимков текста и решений;
2. сверяет SHA профиля `e593f2298e672177bbeac05cd9b6cda6f4926a3a9260ea3b3c35dbf63010264c`, SHA снимка решений, идентификаторы run/job/release, точный состав и canonical SHA wrapper;
3. требует ровно один receipt на каждый источник с выбранными страницами, в порядке snapshot;
4. для каждого receipt сверяет размер и SHA оригинального PDF и заново извлекает полный список слов выбранных страниц Poppler 25.12.0; проверяет координаты, XML/plain-text SHA и вложенный `contentHash`;
5. принимает только `ABSTAIN`, `REVIEW_ONLY`, `NOT_AVAILABLE`, `typedFacts/findings/parameterCoverage = null`.

Локальные тесты принимают результат Python worker с четырьмя выбранными
страницами и отказ без выбора. Подмена wrapper, снимка решений, профиля,
PDF, слова, текста, списка receipts и положительных findings отклоняется.
В тесте составного контракта Poppler использует заглушку процесса с
фиксированными XML/plain-text. Отдельные worker и API Poppler providers
повторно проверены друг против друга на исходном публичном F0152 в
закреплённых образах: 135/173 слова и один contentHash. Составной
ZU-127 v3 wrapper на реальном источнике не запускался. Этот модуль ещё
не подключён к DB save/seal/GET и не доказывает предметную применимость,
пару ПД/РД или наличие расхождения.

Проверка 28 сентября: `npx vitest run apps/api/test/zu127-generic-stage-v3.test.ts` — 4/4; `npm run typecheck -w @inspector-ai/api` — PASS; `git diff --check` — PASS. Следующий gate: API должен независимо загрузить immutable DB snapshots и исходный объект из object storage, затем выполнить save/seal/GET и isolated Compose на разрешённом PDF. До этого durable результат не разрешён.
