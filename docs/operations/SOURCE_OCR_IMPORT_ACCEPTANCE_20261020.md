# Source OCR import: локальная приёмка 20.10.2026

Независимое ожидание до browser-кода: `output/source-ocr-import-acceptance-v1/manual-before-browser.json`. Свежие авторские PDF по три страницы: 1 — native text, 2 — изображение с `Тепловая нагрузка 107,687 кВт` и буквальной строкой `<script>window.OCR_XSS=1</script>`, 3 — только рамка. Настоящий Python V4 producer должен сохранить native gaps `[2,3]`. Bundle содержит авторские synthetic OCR responses, а не вывод модели.

Проверяется настоящий App со всеми CSS, production Fastify/session/CSRF, исходный PDF с полным SHA и отдельная UUID-база PostgreSQL. Локальный fixture задаёт identity и download transport. Ни Rabbit, ни внешний OCR/VLM provider не запускаются. Браузер работает на loopback28194, использует установленный Playwright и headless `/opt/google/chrome/chrome`.

Путь пользователя: сначала завершить полный V4-аудит того же PDF. В «Исходных документах» выбрать нужный источник, открыть «Историю OCR пропусков», выбрать JSON со schemaVersion `source-ocr-import-bundle-v1` и нажать «Сохранить отдельный импорт OCR». Затем найти текст, выбрать страницу и строку, сверить с исходным PDF, ввести «Основание сверки OCR» и подтвердить либо отклонить буквальную транскрипцию.

Сохранённые responses можно упаковать без нового OCR:

```sh
python3 scripts/package-source-ocr-import.py \
  --probe-dir SAVED_PROBE_DIR \
  --native-v4 NATIVE_V4_JSON \
  --pdf SAME_ORIGINAL_PDF \
  --expected-report-sha256 SAVED_REPORT_SHA256 \
  --output NEW_BUNDLE_JSON
```

Готовый пакет F0201: `output/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json`; в companion v4 — `audits/native-ocr-import-engine-v1/F0201-source-ocr-import-bundle-v1.json`. Его происхождение и хеши описаны рядом с пакетом. Browser-приёмка ниже использует отдельный авторский synthetic bundle.

Сценарий: открыть исходные документы и PD, открыть историю OCR, загрузить JSON bundle через file input и сохранить импорт201. Две строки должны совпасть буквально; script отображается текстом, `window.OCR_XSS` остаётся undefined. Пустая страница 3 остаётся UNRESOLVED. Поиск `107,687` открывает исходную физическую страницу 2. Видимый PNG сверяется по SHA с реальным аутентифицированным Fastify preview; OCR bbox не становится PDF-рамкой.

Далее выбирается строка 0 страницы 2, вводится основание и нажимается «Текст совпадает с PDF». Новый 201 review должен связывать import/content/line hashes и оставаться humanTranscriptionOnly. Импорт сохраняет IMPORTED_OCR_UNVERIFIED, providerExecutionVerified=false, renderDerivationVerified=false, p=null, factEligible=false, coverageDelta=0. Ручная сверка не подтверждает инженерное нарушение, соответствие, покрытие или происхождение внешнего растра.

Проверяются 1440/375 light/dark, отсутствие горизонтального overflow и обрезанных контролов, настоящий исходный PNG без OCR-рамок. Скачать JSON с record+review, выполнить настоящий reload и сравнить скачанные bytes и PostgreSQL history. Состояние sealed parent, native artifacts/releases, rule_results, source decisions, protocols и machine coverage до/после должно совпасть. Разрешённые browser mutations ограничены auth/open, OCR import и OCR transcription review; инженерные решения запрещены.

```sh
node --import tsx scripts/smoke-source-ocr-app.mjs --help
node --import tsx scripts/smoke-source-ocr-app.mjs \
  --admin-url-file output/local-work-20261020/protocol-export-v1/private/admin-url.txt \
  --output output/source-ocr-import-acceptance-v1/NEW_RUN
```

Приватный URL 0600 не печатать. Каждый запуск требует новый output directory; сохраняет FIRST RED, source pins, SHA, API journal и PNG. Fixture удаляет только свою UUID-базу и временные PDF; общий PostgreSQL-контейнер оставляет. Единственные допустимые 404 — точные source-review URL исходников с NOT_FOUND / «Решение не найдено»: начальная fixture не содержит такого решения. Фактический итог записывается отдельным receipt; наличие документа само по себе не означает PASS.

Финальный browser-v3 после переноса permission recheck за history lock: 11/11 PASS за 17,557 с. Предыдущий browser-v2 сохранён отдельно. Гонка File.arrayBuffer A/B/A сохранила только последний выбранный B (проверен SHA фактического POST); в PostgreSQL ровно один импорт и одна сверка. Проверены 1440/375 light/dark: documentWidth равен viewport, обрезанных контролов и OCR-рамок нет, window.OCR_XSS undefined. Выполнено визуальное чтение desktop/light и mobile/dark PNG; исходник содержит обе буквальные строки. Сохранены восемь UI PNG и сам PNG страницы2, полученный production route. Его SHA совпал с bytes видимого browser blob.

Скачанный JSON record+review побайтово совпал после reload; история равна PostgreSQL. Sealed run, native text/release hashes, rule_results, source decisions, protocols и coverage до/после равны. Runtime source pins совпали. В 66 API-ответах только два ожидаемых source-review404; JS page errors нет. Отдельно сохранены 18 клиентских net::ERR_ABORTED запросов GET checks при навигации; HTTP-отказами они не являются.

Первый RED browser-v1 сохранён: неверный путь SourceImage в списке pins, до создания fixture/DB. Исправлен только harness path; продукт для PASS не менялся. Node syntax, --help и whitespace checks прошли. Собственные UUID-базы удалены, порт28194 закрыт, общий PostgreSQL-контейнер продолжает работу. Итог: output/source-ocr-import-acceptance-v1/receipt-final.json.

Переносимые подтверждения: [sanitized acceptance.json](evidence/source-ocr-import-20261020/acceptance.json), [desktop1440/light](evidence/source-ocr-import-20261020/desktop-light.png), [mobile375/dark](evidence/source-ocr-import-20261020/mobile-dark.png). PNG скопированы без преобразования; их SHA записаны в receipt.
