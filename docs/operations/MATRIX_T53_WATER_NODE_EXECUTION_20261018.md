# T53: исполнение сравнения вводного узла ХВС

Отдельный профиль `matrix-text-facts-water-node-v8` добавляет частичное сравнение ZU-129 к прежним scalar/AR-053/ODI-123/ODI-120. Исходные grammar T51, comparator T52 и старые профили сохраняются. Найденное различие — кандидат с `calibratedProbability=null`; физическое отсутствие счётчика и весь параметр не подтверждаются.

1. [x] План и wire зафиксированы до интеграции. Независимый manual packet:16 операций, полные результаты/evidence/132coverage,10 integrity rejections. Полные outputs TS/Python совпадают; исходные PDF и goldens прежние.
2. [x] Optional `waterNodeScope` в общем source review. Сервер повторно восстанавливает состав из retained original-backed text; клиент не передаёт snapshot. Общий CAS, omission-preserve, явный отзыв `claims:[]`, parent budgets и старые hash preimages сохранены. Миграция037 не меняет прежние строки; rollback не удаляет историю review.
3. [x] Authenticated loader v4 несёт четыре siblings и общий набор retained origins. Каждый исходник, review snapshot, SHA, manifest и original bytes проверяется до выбора identity/approval. PDF I/O выполняется вне write locks, затем проверка fence и неизменности данных.
4. [x] Durable v8 исполняется непосредственно; старый lease/release не подделывается. API независимо перестраивает typed result, coverage и outputCount до записи. Seal/read проверяют stored identity и полные outputs; submission содержит консервативный M-129 `COMPARISON_IMPOSSIBLE`.
5. [x] Actual PostgreSQL:5 новых review tests +13 прежних siblings;2 новых полных execution tests. Новая общая регрессия выполняется отдельно. Root whole typecheck/build PASS; TS47 execution +23 review +3 preview +2 protected route PASS.
6. [x] Настоящие wheel/sdist и изолированный установленный worker:16 операций, production dispatch четырёх siblings,63scalar+4typed,132coverage. Все22 ресурса равны текущим исходникам. Историческая непрерывность:4 registry по T52 pins и16 по Git; для прежнего public-source-id-map отдельного старого hash нет. Независимый source review интеграции дефектов не выявил.
7. [x] Полные API/worker/PostgreSQL regression, freeze, coherent feedback-only deploy с migration037. До активации сохраняются60 прежних snapshots,203 актуальных и132 legacy targets, сохранённый local review и FAILED run.
8. [x] HTTP на отдельных authored original PDF: origin UNKNOWN/unbound, approved candidate с15 full fragments, UNKNOWN approval abstention, восстановление. Никаких synthetic assertions в реальных объектах.
9. [x] Свежий полный реальный F0106/F0139 на v8:161 страница,15 фактов,63scalar,4unbound typed; источники UNKNOWN, qualified0. Restart и повторная проверка истории.

Backend принят 18.10 (2026-10-18T06:21:55.324003+00:00): `output/matrix-t53-20261018/acceptance.json` фиксирует точное время. Проверенный технический счётчик v8 —59 параметров с67 атомами и73 UNSUPPORTED из132. Прежние результаты v7 сохраняют58/66/74. Это частичное техническое покрытие, не число полностью проверенных параметров объекта.

Браузер остаётся отдельной незавершённой приёмкой по существующему security URL hold. HTTP/unit/SSR и сборка не объявляются browser proof. UI нового water-node review следует отдельным этапом T54 после приёмки backend.

Доказательства: `output/matrix-t53-20261018/`. Первые RED сохранены: отсутствующие execution/runtime методы, точные исправления тестовых literals и закрытия PG pool, QA packaging harness. Результаты первых неуспешных запусков не заменяются зелёными логами.

Полная регрессия: API3831PASS/141skip, worker2401PASS/17skip, actual PostgreSQL127PASS/43files/0skip; typecheck/buildPASS. Пять новых запусков выполнили46заданий с первой попытки: authored PDFs по9безOCR, реальный пакет10сOCR. Контрольный цикл0/1/0/1 кандидатов, положительный исход содержит15fragment evidence; probabilitynull. Реальный CHK-66354F71:161страница/15facts/63scalar/4unbound/qualified0.

После окончательного второго restart сохранены65snapshots,203currenttargets,132legacytargets,1localreview,FAILED bytes;20другихконтейнеров иweb не менялись. Первый restart пересёк окончание capture на0.574s и не принят как доказательство порядка; отдельный второй выполнен после готового checkpoint. Все первые RED и ошибочная mtime-only проверка сохранены. `source-freeze-metadata-amendment.json` явно исправляет унаследованные описательные поля T52, не переписывая pin map и receipts. Косметический V7 label старого real harness не используется как доказательство профиля: actualDB подтверждает v8+точныйconfig для всех5запусков.
