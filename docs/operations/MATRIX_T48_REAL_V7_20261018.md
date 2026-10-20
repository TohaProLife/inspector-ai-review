# T48: полный реальный пакет на v7

Продолжается сразу после T47. Новый объект из двух полных открытых исходников F0106/F0139:139+22 страницы. Исходные SHA, размер и число страниц сверены до HTTP. Старые объекты не получают новый check; их история остаётся прежней.

1. [x] План до реализации: `output/matrix-t48-20261018/real-public-plan-before-implementation.json`.
2. [x] Seed journal пишет idempotency key и body SHA до каждого запроса. Multipart boundary устойчив к resume. Только4 команды: объект, два оригинала, FULL check. Offline self-test прошёл, сеть0, review0.
3. [x] Независимый read-only oracle: все15 фактов,63 scalar results и15 full-text target hashes. SID и observation IDs меняются только по заранее определённому remap; raw text, context и geometry сохраняются.
4. [x] После coherent T47 acceptance: создать новый UNKNOWN пакет и дождаться terminal v7 run.
5. [x] Проверить original PDF bytes/SHA/161 pages, metadata UNKNOWN, effective58/66/74, scalar55/63/77,0qualified/null probability. Повторные GET побайтно прежние.
6. [x] Зафиксировать новый snapshot; restart только разрешённых API/outbox/web. Сохранить прежние59 runs,132 targets,1local review и новый real snapshot.

Браузер остаётся отдельной непроведённой приёмкой по существующему security hold. Differential API/original proof не измеряет предметную точность и не подтверждает реальную геопривязку.

Следующий исследуемый gap: F0106 PDF53, block0, строка0 — «Отметка нуля принята на абсолютной отметке +159.950.». Существующий grammar её не извлекает. На листе нет явной единицы этой отметки и точного floor reference; метры, общую высотную систему и тождество уровня пока не выводим. Старые scalar modules/configs нельзя переписывать ради этой строки; следующий срез должен сохранять версии и различать raw source declaration от исполнимого измерения.

Промежуточный actual результат: CHK-5752877C / OBJ-C75B3B94, профиль matrix-text-facts-rail-inventory-v7, config35be151b…bcd36. Все10 jobs SUCCEEDED с одной попытки; run PARTIAL sealed. Независимый GET-only harness прошёл19 запросов:15 фактов,63 результатов,15 targets,6 fire declarations,161 исходный PDF frame и полные байты обоих оригиналов. Effective58/66/74, qualified0, UNKNOWN, вероятностьnull. DB proof: real-run-db-proof.json. Две начальные read-only SQL-пробы неверно назвали manifest hash column; RED сохранены, исправлен только QA SQL на input_manifests.sha256. Runtime и oracle не менялись. Restart-приёмка выполняется.

T48 backend принят: acceptance.json. После restart сохранены60 snapshots,59 прежних target responses/203targets,132 legacy targets,1local review;6 raw HTTP responses нового run побайтно прежние. Семь runtime pins совпадают,20прочих контейнеров и4worker не изменялись. Новых runtime modules в T48 нет. Без паузы начинается T49: read-only поиск по полному исходному тексту, без превращения необработанной строки в измерение.
