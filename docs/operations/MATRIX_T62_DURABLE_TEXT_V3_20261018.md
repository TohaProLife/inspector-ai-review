# T62 — сохранённый исходный текст v3 и стабильные native paths

Принято 18 октября 2026 на обычном homeserver RTX2080SUPER 8GiB. H100 не использовался. Новый `SOURCE_AUDIT_V3` сохраняет полный исходный текст отдельно от машинной проверки; default `MATRIX_V1` прежний.

## Что работает

- Worker получает полный PDF по fenced HTTP, сверяет SHA/размер, извлекает полный `document-text-v3`, сохраняет immutable artifact. Cache привязан к полному исходнику и фактическому профилю/коду; повреждённый cache отклоняется.
- Forward migration038 разрешает v3 в `analysis_text_artifacts`; старые записи не переписываются. Запуск audit имеет собственный frozen scaffold/release. Его DAG не назначает OCR или machine findings на основании качества исходного текстового слоя.
- `GET /api/checks/:id/source-text-v3?sourceFileId=...` проверяет session/object scope, manifest, запечатанный run, job/release, provenance, байты/hash полного artifact. `Cache-Control: private, no-store`. Исторический release читается как исторический.
- Поиск в web поддерживает v3 после точного404 старого v2 endpoint. Хранит исходные LF/пробелы, полный native path, frame и unlocated reason. Для unlocated строки переход по выдуманной рамке не создаётся. Координатные consumers по-прежнему используют свой v2 contract.

## Найденный дефект и исправление

Первый полный реальный audit `CHK-EDA07A73` дал несовпадение порядка шести native roots на странице17. Текст, native boxes и качество всех38страниц совпали. Первоначальный FAILED и полная разница сохранены в `output/matrix-t62-20261018`; они не переименованы в PASS.

Причина: pdfminer при равных расстояниях использует process-specific object id в grouping heap. Добавлен третий явный traversal profile `pdfminer-analyzed-figures-boxes-flow-none-v1`: page и Form analysis используют `boxes_flow=None`, native paths снимаются после этого анализа. Старые два профиля/исторические artifacts сохраняют свою семантику. Это отдельная политика чтения, не миграция старых адресов.

Полный F0161: исходный SHA `ba76f0685eca5dadc591554af14cf82345397fbe2fd2b48d1e1cc26917d46bf1`, 7064174bytes,38pages,4207located/2unlocated. Два независимых процесса дали одинаковый полный результат; installed wheel/sdist с actual fenced HTTP повторил его. Quality33candidate/2partial/3OCR-required. Source-only результат не доказывает видимость текста Form на рендере.

## Приёмка

Новые стабильные эталоны были вручную заморожены до реализации, первый RED сохранён. Independent QA:39v3 Python +35durable/legacy Python +81TS methods; это пересекается с root/owner проверками и не суммируется с ними. Дополнительно root:20API integration +6actual PostgreSQL methods, API/web typecheck/build PASS.

Новый реальный durable run `CHK-B4165838` прошёл полный authenticated HTTP readback: байты исходного PDF, весь38-pageartifact, полный profile/native paths/raw text, повторные ответы, legacy404 и401 без session. Run честно `PARTIAL`:132UNSUPPORTED,0machine results,0machine snapshots. Полный HTTP response SHA `7d22ae5be1dc44cd5b7c3360dc9119d75724568dab2f646a2e23318f5cfb1cb6` одинаков после restart.

После установки и отдельного restart семи ролей:66snapshots/16groups,203oldtargets/59runs,132legacytargets,1savedreview и failed-runbytes сохранены.20прочихконтейнеров прежние. Полный старый v3 artifact также сохранён byte-for-byte. Runtime source freeze896files; actual worker Python3.13.15/pdfminer20260107 и API Node22.23.2 сверены с release и SHA модулей.

Browser acceptance остаётся pending по действующему security hold. HTTP/static assets/unit/SSR не являются browser proof. Новых browser вызовов0.

Машинное покрытие прежнее:59параметров/67частичных атомов/73UNSUPPORTED из132; qualified real pairs0, source authority unverified, calibratedProbabilitynull. После T62 без паузы выполняется T63: pure lighting consumer для полного v3; затем направленное сравнение ZU-130 и runtime wiring.

Приёмочные receipts: `output/matrix-t62-stable-20261018/acceptance.json`. Исторические доказательства первоначального audit: `output/matrix-t62-20261018/`.
