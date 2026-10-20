# Локальная регистрация и машинная уверенность: контракт 17.10.2026

Реализованы чистые контракты, HTTP-маршруты, append-only решения PostgreSQL и UI wrapper.
`LocalRegistrationWorkspace` подключается к экрану проверки через `objectId` и необязательный `checkId`.
Наличие этих файлов не означает подтверждённую регистрацию реального объекта.

## Машинная уверенность

`packages/contracts/src/machine-confidence.ts` принимает строгое envelope с пятью полями:
`confidenceKind`, `calibratedProbability`, `calibrationVersion`, `extractionScore`, `linkingScore`.
Значения OCR/linking сохраняются отдельно и не превращаются в вероятность правильности.
Legacy scalar, self-report, некорректный envelope, OOD и неизвестная вероятность остаются кандидатами.

`classifyMachineConfidence` разрешает `WARNING` только при `CALIBRATED`, исходной
вероятности `>= 0.80`, независимо закреплённой в release совпадающей calibration version
и квалифицированных доказательствах. `0.7996` остаётся кандидатом. Политика v1 не допускает
подмену порога под прежним именем. Техническая ошибка выделяется отдельно; human review
и severity функция не изменяет. Реальная калибровка этим срезом не обучалась и не оценивалась.

## Локальная регистрация

Общие DTO находятся в `packages/contracts/src/local-document-registration.ts`;
серверный расчёт — `apps/api/src/local-document-registration.ts`.
Два frame фиксируют исходные PDF SHA, file ID, страницу, SHA page-frame artifact,
канонический видимый размер/поворот, объект, этаж, этап строительства и редакцию.
Координаты опор нормированы на видимую страницу, но расчёт использует её реальные
пропорции в пунктах. Поворот PDF повторно не применяется.

Перед вызовом `evaluateLocalDocumentRegistration(packet, trusted)` вызывающая сторона должна:

1. Независимо сверить bytes SHA и page-frame обоих оригиналов с immutable manifest.
2. Проверить object access, актуальный run и достоверность совпадающего этажа/этапа.
3. Получить из authenticated append-only решения `reviewedRegistrationSha256` полного packet,
   рассчитанный `localDocumentRegistrationDigest`. Клиентский boolean подтверждения не заменяет решение.

Точки имеют явные роли `FIT` и `HOLDOUT`, минимум три неколлинеарные расчётные и одна
контрольная. Допустимы оси документа и устойчивые опоры; контур проверяемого здания
не может устранять собственное смещение. SHA review фиксирует также выбор модели,
допуски, погрешности и основание масштаба, чтобы их нельзя было менять после решения.

Поддержаны перенос/поворот (`RIGID`), единый масштаб (`SIMILARITY`) и `AFFINE` только
с явным основанием `SCAN_DISTORTION`. Проверяются fit/heldout residuals, положительный
детерминант, scale range, anisotropy, обратимость и ограниченная область выпуклой оболочки.
Результат всегда `absoluteGeoreference: false`; внешняя система координат не выводится.

`compareRegisteredDisplacement` сравнивает точки только внутри области опор обоих листов.
Без подтверждённого метрического масштаба — abstention. Интервал учитывает ошибки
локализации, регистрации и масштаба, включая их произведение. Порог внутри интервала
даёт `THRESHOLD_WITHIN_UNCERTAINTY`; само сравнение использует строгое `>`.
Результат comparator не является calibrated probability или authenticated finding.

## UI и точки подключения

`LocalDocumentRegistration.tsx` принимает `sourceFrame`, `targetFrame`, URLs двух
original-page preview, необязательные `initialPacket`, `initialReview`, `readOnly`, `onPreview`, `onSaveReview`.
Клик по двум листам добавляет пару; все координаты и адреса доступны для ручного ввода.
Роли расчётных/контрольных опор, модель, допуски, погрешности и масштаб задаются явно.

`onPreview(packet)` возвращает `{ status: "PREVIEW_ONLY", result }`. Результат расчёта
помечается предварительным. `onSaveReview(packet, preview)` возвращает
`{ reviewId, actorId, reviewedAt, registrationSha256, result }` из durable API;
только совпадающий receipt показывается сохранённым решением. Изменение packet сбрасывает
preview/review. Смена immutable frames сбрасывает черновик; запоздалый ответ старого
запроса игнорируется. Без callbacks соответствующие действия недоступны.

Старый `InspectorGeometryRegistration.tsx` теперь обозначен как абсолютная геопривязка
и явно разрешает отдельное локальное сопоставление по собственным осям.

## HTTP и durable решения

`GET /api/objects/:id/files/:sourceFileId/pages/:pageNumber/local-registration-frame?floorKey=...&phaseKey=...`
проверяет READ-доступ, CLEAN PDF, size/SHA оригинала из storage, затем извлекает CropBox,
MediaBox и Rotate через `pdfinfo`. Frame SHA связывает исходник, страницу, геометрию
и профиль точности 0.01 пункта. Этаж и этап остаются явным заявлением инспектора,
проверяемым при сохранении; сервер не выводит их из имени файла.

`GET /api/objects/:id/local-registrations` возвращает последнее решение текущей проверки,
его packet/result, expectedReviewHash и до 20 элементов истории.
`POST .../local-registrations/preview` требует READ и CSRF, повторно проверяет исходники,
server frames и принадлежность manifest текущего run. Возвращает только PREVIEW_ONLY,
не записывает решение. Локализационная погрешность меньше 0.01 пункта недопустима.

`POST .../local-registrations/reviews` дополнительно требует REVIEW_DECIDE, OPEN lifecycle,
актуальный checkId, expectedReviewHash и Idempotency-Key. Обязательны основание и три
явных подтверждения originalsReviewed/stableReferencesConfirmed/scopeConfirmed.
Сервер сам задаёт actor/time, блокирует inspection/run, повторяет расчёт, добавляет решение,
неизменяемый command receipt и событие общего audit chain в одной транзакции.
Другой payload под прежним ключом даёт 409; устаревший expectedReviewHash — 412.
Точный повтор возвращает прежнее решение, в том числе после завершения инспекции.
Сервис не меняет findings, coverage или human CONFIRMED.

Миграция 032 создаёт immutable `local_document_registration_reviews` с composite FK
на объект, инспекцию, run и два исходника. Rollback отказывается удалять сохранённые решения.
UI показывает две исходные страницы, выбор file/page/floor/phase, preview, сохранение,
reload. Смена исходников сбрасывает черновик; исходные опоры не создаются автоматически.

## Проверки

17.10.2026: API confidence + registration — 16/16; server frame и durable HTTP PG — 2/2;
web component/state — 8/8. Web typecheck — PASS. Проверены порог 0.7996/0.80, OOD/null,
потеря pin/evidence, подмена frame/review, fit/holdout, вырождение, отражение,
scale/anisotropy/residual gates, метрический интервал и отказ от экстраполяции.

На отдельной случайной PostgreSQL БД пройден authenticated HTTP save/reload,
READ-only preview, scope/CSRF/permissions, точный replay, конфликт ключа, stale hash/run,
FINALIZED, audit actor и immutable rows, SHA/frame tamper и отсутствие изменений findings/coverage.
Следующая приёмка: два реальных листа с выбранными по оригиналам опорами; браузерные клики, координаты,
ошибки изображений/сети и мобильный размер. Реальные пары опор этим срезом не утверждались.
