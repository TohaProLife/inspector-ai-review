## 2026-10-20 18:14 МСК — подсказка двойных единиц в OCR

Принят web-only кандидат для одной полной строки кВт/Гкал/ч с непересекающимися точными интервалами округления; список, переход к исходной странице/строке и focus сохраняются после reload. Human CONFIRMED не скрывает противоречие. Реальный264-line replay дал1подсказкуF0201p8. Helper72, web1368, PostgreSQL22 и browser14 PASS; typecheck/build PASS. [Приёмка](operations/SOURCE_OCR_UNIT_QUALITY_20261020.md). Никаких исправлений исходных чисел, новых engineering warnings или роста покрытия.

## 2026-10-20 17:54 МСК — текущие CPU-образы и два архива v4

Чистый код3728162 принят в установленных API/web/worker образах: три сборки, offline export/worker self-check,51миграция,18/18заданий и весь676-страничный F0201; после перезапуска полный ответ совпал побайтно. [Квитанция](operations/evidence/final-qa-20261020/installed-cpu-3728162.json). Source и companion ZIP v4 зафиксированы SHA; companion111Python tests и два настоящих CLI replay PASS. Source вне Git/ancestor node_modules принят: fresh npm ci, typecheck/build, API4877/web1294/PostgreSQL22/Python2931 PASS;236 API и42 Python SKIP. Все2715 source payload pins неизменны; [квитанция](operations/evidence/final-qa-20261020/outside-checkout-3728162.json). Первые tmpfs ENOSPC отказы сохранены. [Точная передача](operations/FINAL_PACKAGE_V4_20261020.md). Новое инженерное покрытие, аппаратная приёмка H100 и отправка не заявлены.

## 2026-10-20 17:36 МСК — отдельный OCR-импорт и чистая CPU-сборка

Импорт сохранённых OCR responses теперь отдельный immutable derivative полного V4: сервер проверяет оригинальный PDF, сохраняет точные строки и человеческую сверку, UI даёт поиск/страницы/JSON. Реальный offline replay264строки/12страниц/8UNRESOLVED; происхождение внешнего растра и исполнение провайдера не подтверждены. PostgreSQL7, browser11, общий API4879/web1294 PASS; машинное покрытие остаётся62/132 с хотя бы одним узким правилом. Чистые CPU-образы5e95eb3 и runner075ce60 отдельно прошли18/18 заданий,676страниц и побайтное чтение после перезапуска; OCR требует новой установленной сборки. [Текущая передача](operations/FINAL_HANDOFF_20261020.md).

## 2026-10-20 17:07 МСК — экспорт и сохраняемые native сверки

Экспорт PDF/DOCX/XML из одного immutable snapshot принят (`f812e94`), хакатонный authenticated ИАИС pull facade — `1afe649`; внешняя доставка/подпись не заявлены. Сверка вместимости ПД/РД по полным V4 origins с PostgreSQL, историей, JSON и парным viewer принята в `85c3df1`. Реальная пара600/600мест:30 цитат ПД и9 РД; отдельный синтетический PG7/7 и browser9/9. Вентиляция П17: чистый движок79/79 на9060=3340+5720, PG8/8 и browser9/9; после независимого ревью приняты shared storage88/88, nested binding migration050 и итоговые PG15/15/browser9/9. Новая общая регрессияAPI4711/web1290 PASS; H100offline5cases+3resource mergesPASS, аппаратный запуск не выполнен. Исторические статусы ниже сохраняются как история, актуальная передача — [FINAL_HANDOFF_20261020.md](operations/FINAL_HANDOFF_20261020.md).

Актуализация 20 октября, 12:22 МСК: подготовлен V9 для H100 без доступа к GPU: 8B FP8 SAMPLE/FULL, явные пропуски, context-v2/crop2048, исправленный native RabbitMQ healthcheck. Локальные API/worker/web-образы собраны и проверены изолированно. Реальные публичные пары упакованы отдельно; новые квалифицированные инженерные нарушения и независимая точность не заявлены. [Приёмка V9 и границы доказательств](operations/H100_V9_ACCEPTANCE_20261020.md). Полный переносимый прогон завершён: 8480 pass/246 skip/0 failed, typecheck/build и три installed-image probes PASS; для передачи использовать актуальный V9 review ZIP. H100 runtime и браузерная приёмка отсутствуют.

Актуализация 20 октября, 04:18 МСК: локальный CPU-контур принят на свежем PDF через ClamAV/RabbitMQ/outbox/worker: девять заданий, `PARTIAL/100`, сохранённые чтения и полная очистка. Новые API/web-образы PPM-113 отдельно прошли TCP/HTTP; инженерное правило диаметра реализуется. [Текущая приёмка](operations/CURRENT_ACCEPTANCE_20261019.md). Браузер на SECURITY_HOLD; форма не отправлена.

## 2026-10-20 03:50 МСК — установленный TCP/HTTP принят, PPM-113 продолжается

20 октября, 03:50 МСК: установленная локальная CPU-сборка прошла настоящий TCP/HTTP-прогон: 45 миграций, 132 записи каталога, действующая сессия, CSRF, logout и 29 web-ресурсов. ROOT сверил 58 команд и 40 ответов; четыре контейнера, два тома и две сети удалены, соседние ресурсы сохранены. Приёмка: `output/local-work-20261020/local-http-smoke-v14-v6/root-actual-review.json`. Очередь в этом прогоне не запускалась.

PPM-113: принят просмотр кандидатов из источника — 59 новых тестов, 186 регрессионных проверок дренажа, полный typecheck и web build. `output/local-work-20261020/ppm113-source-qualification-v3/root-actual-review.json`. Ответ сохраняет точные цитаты и SHA, `SOURCE_REVIEW_ONLY`, вероятность и покрытие `null`; это ещё не инженерная проверка. Два обновлённых API/web-образа собираются, worker остаётся прежним. Отдельное правило V14 для снижения внутреннего диаметра выбранного кольца ВПВ реализуется; реальная подтверждённая пара ПД/РД пока не установлена.

Следом — настоящий NORMAL-прогон через ClamAV/RabbitMQ/worker. Браузер остаётся на SECURITY_HOLD после отказа автоматической проверки разрешения; причина отказа в доступных данных не сохранена, повторные попытки не выполняются. HTTP и SSR не подтверждают взаимодействие в браузере. Homeserver отложен по указанию пользователя; периодических SSH-проверок нет.

## 2026-10-20 03:00 МСК — offline image probes и инструмент калибровки

20 октября, 03:00 МСК: три локальных образа прошли отдельные offline probes. Установленные176модулей worker,25правил,336файлов API и29web-ресурсов совпали с эталонами; whole canonical policy и4исторические политики сверены. Одноразовые контейнеры удалены, наборы соседних контейнеров и томов не изменились. Приёмка: `output/local-work-20261020/local-image-probes-v14-v1/root-actual-review.json`. Это ещё не HTTP/очередь. Новый офлайн-инструмент калибровки `scripts/prepare-machine-confidence-calibration.py` принят с23синтетическими тестами; вычисляет PAV/Brier/ECE, проверяет hashes/разделение объектов и документов, вне fit-диапазона abstain. Реальная калибровка и runtime activation не приняты; документация `docs/operations/MACHINE_CONFIDENCE_CALIBRATION.md`.

Текущее дополнение20октября02:53МСК: DockerV4 собрал все три обычных образа API/worker/web из1089исходников. ROOT принял1253привязки/160выходных файлов/38команд, реальные image IDs и очистку собственного builder при сохранности соседних контейнеров/томов. Итог `d9c7ab7748c9c375ff617ea51610aec8bf707c9ec3f3605490360ca4a29c6686`, ROOT review `53f99e413f7933598b525133e7b9002276788dabb09f4e68f47d5b0cd4b521e7`. Следом готовятся изолированные проверки содержимого образов и локальный HTTP-стенд. В confidence найден отдельный пробел офлайн-обучения калибровки: реализуется подготовка артефакта с независимыми метками и heldout-оценкой; активации вероятностей/независимых меток пока нет. Homeserver отложен по указанию пользователя.

Текущее дополнение20октября02:43МСК: homeserver отложен по указанию пользователя; работа продолжается локально без периодических SSH-проверок. Создан и целиком проверен локальный ZIP контекста1089исходников плюс10материалов ревью: SHA `af90e88f3d32d3d9020b17954b7c5722e8008076ef143676e8943a0d82d8d7ea`, права0600; это не финальная сдача и не полный репозиторий. DockerV2 успешно загрузил BuildKit, затем остановился до сборки приложений: проверка ошибочно запрещала штатный daemon-флаг Buildx, несмотря на реальный bridge. Очистка и соседние контейнеры/тома проверены; исправляется только эта проверка. Текущая локальная приёмка full94/HTTP16/witness37 сохраняется. Подробности — [CURRENT_ACCEPTANCE_20261019.md](operations/CURRENT_ACCEPTANCE_20261019.md).

Текущее дополнение20октября02:24МСК: source107 V14 прошёл полный94-набор, совместные API/web16HTTP-сценариев и отдельный сценарий одной заполненной области37runtime-фаз плюс сборка. Последний итог `b1cd8b68e8162ddd85e5224fd001620e5fd551dd055de173618a8e6f305cef5d`; ROOT review `output/matrix-t85-20261020/one-populated-inventory-inherit-v3/root-actual-review.json`, SHA `e9f8e6dfb4091a9100d613d408e965720b549f71fd80f6231140ecc941573970`. Пик447406080B,1266привязок,38шагов/журналы/JSON и очистка проверены. Эталон9заданий выведен отдельно из planner/валидатора/фиксированного текста; продукт и лимиты не менялись. Наследование/отзыв одной inventory-области подтверждены; шесть заполненных семейств, свежий OCR, инженерная квалификация, браузер и установка не подтверждены. Исправлены две ошибки Dockerfile; готовится локальная сборка. Последний SSH homeserver02:17МСК завершился timeout.

## 20 октября, 01:31 МСК — drainage API с настоящей сессией и БД

20октября02:03МСК: текущий source107 V14 прошёл original94 сценария с прежними лимитами; max group RSS517738496B. Итог3704daf335eb31ada1eef228ac882def1a64be6832b188877d44858f131f4fb0, ROOT review74aaddd50ee1bf6bdd9f202147f10c5ffe19a38050b20e7d9048479bb6696ea5; 1235pins,95steps/log/privateJSON и очистка БД/private точны. Перед ним прошли lifetime9 без принудительного GC, свежие worker202/wheel/sdist/две установки и14policy. Это локальная приёмка исходного набора сценариев; browser/стенд/реальные инженерные пары ещё не приняты. Совместный API/web HTTP16 прогон выполняется.

Полное приложение прошло16 Fastify.inject сценариев с PostgreSQL/45миграциями, входом, CSRF, READ-доступом, отзывом доступа между чтениями, сменой проверки и сохранностью истории. Целый ответ на495реальных OCR-строк совпал с независимым эталоном7исходных ссылок. Итог `661da2e9a31a3f5bb430b61cfa7510697c94a518bc12469417f4a5442c0f309e`; приёмка — `output/local-work-20261020/drainage-source-api-http-preparation-v2/root-actual-review.json`. Слушающий TCP-сервер/браузер/инженерное покрытие не подтверждены.

## 2026-10-20 01:19 МСК — дренажный preview API и причина конкурентного сбоя

API предпросмотра исходных дренажных цитат: полный typecheck API/contracts,156 pure проверок и14 Fastify.inject проверок маршрута прошли. Реальный OCR-кэш495 строк дал полный ожидаемый ответ с7 ссылками. Цитаты имеют SOURCE_CANDIDATE, вероятностьnull и непроверенную геометрию; покрытие параметров не повышается. Приёмка: `output/local-work-20261020/drainage-source-api-preview-v2/root-actual-review.json`, outcomeSHA `90ede75eda12b6b434334bb84b190c83fd69f4e4dd966ddc75716c726f28f2d6`. Настоящий HTTP с PostgreSQL/сессией ещё готовится.

После85 успешных сценариев full94 отдельный SQL-прогон подтвердил55P03 на блокировке квитанции одинаковой команды. Первая команда успешна; вторая не дождалась блокировки. Диагностика: `output/matrix-t85-20261020/concurrent-same-command-diagnosis-v1/root-actual-review.json`. Исходная ошибка и все лимиты сохранены. Новая межпроцессная очередь допуска пока не принята; полный94-набор и установкаv13 ещё впереди.

Текущее состояние и оставшиеся границы: [CURRENT_ACCEPTANCE_20261019.md](operations/CURRENT_ACCEPTANCE_20261019.md).


## 2026-10-19 — T85 память и совместная маршрутизация

Focused V4: BUILD +71 runtime PASS; 70.572s, runtime peak501325824B <512MiB. Outcome `4a26bbbb11a491941fc9e82ce1cf2e36d7bc590fec636b36e26eccc208b32f56`; guarded DUT imports, same assertions/limits, cleanup/source exact.

Combined104 inherited44: BUILD +44 runtime PASS,77.349s, max437100544B. Outcome `0bfb1693af579c909c396685e253056a87c10917771dfdc9b4e60892604ed97a`; actual inherited durable inventory/replay/CAS/current source/PDF guard tests accepted.

Combined104 full94 first RED retained:35 runtime steps passed, including previous memory refusal at08WORK (now484368384B) and seal completion10 (525766656B). `BOOTSTRAP_TARGETS` rejected public read value before target oracle assertions. Outcome `ba55a37a70618ba50f976ae26a2d26a806546a1ba3b0d5ea8e01887ca58c1455`. DB cleanup0/private gone/protected exact; full94 NOT accepted. Read-only root-cause diagnosis underway.

T84 candidate PG4/4 +focused2/2 and final independent binding review accepted. Explicit API/outbox-only install now running on authorized ordinary stand; no ordinary-host20s PASS claimed yet.


## 2026-10-19 19:52 MSK — локальные проверки перед продолжением homeserver

- T84: genuine PG4/4 и focused2/2 прошли вместе с двумя noEmit. Outcome `a8735e2e309ae00e3ee9e4b93e068f7e763a489479366868fe1704f75bac6849`; owned DB cleanup0, private/source pins exact. Node384, aggregate PG suite1024MiB/CPU300/wall600, операция20s сохранена. Ordinary-host20s ещё не подтверждён, overlay пока не установлен.
- T85 focused V3 подтвердил единственное запрещённое действие загрузчика `tsx/dist/client-D_mPDF5S.mjs`: `node:net.createConnection` до DUT. Все41 whole-assembly/getter проверки прошли, весь71-набор не принят из-за exit1. Outcome `b77b7012525f308c13a8dafb3104d4debd5c1c738fa91fb6fe2a4143987ca5f0`; исходники/cleanup exact. Готовится отдельная коррекция bootstrap без ослабления запретов или caps.
- Combined104: ROOT сверил780/751 pins двух неизменённых runtime-наборов94/44. Запусков пока нет.

## 19.10 19:45 МСК — inherited inventory44 PASS; memory focused41 assertions PASS, harness refusal retained

- Inherited inventory consumerV2 genuine BUILD+44 runtime phases PASS,71.953s. Outcome `a1910beb61ee00ea0b0779e988165ae657da7c68091e0f772fa52654d22477e0`, ROOT acceptance в consumer-v2/root-actual-acceptance.json. Max runtimeRSS432500736B при512МиБ; normalDROP0/private527 removed/allpins exact. Настоящие9jobs SEAL, populated inventory + inherited scalar[]/omittedNULL, exact receipt/conflict/CAS/PDF/revocation/current-stage/raw-origin/resource/refinal revocation проверены. One populated family only; other5/full6, nonempty scalarrevocation и61 durableengineeringoracles остаются отдельными границами.
- Memory focusedV2: BUILD_ONLYPASS; все41wholeassertion/getterPASS при437428224B. Childexit1 от отдельного preload FORBIDDEN_RUNTIME_ATTEMPTS:1 после записи observedPASS. Эти41 не считаются полным71PASS. Исследуется служебный tsx IPC; разрешения DUT не ослабляются. V1/V2 результаты сохранены.
- MemoPG V5 ещё остановлен на aggregate1024МиБ при1076146176B, source/test/cleanup exact. НовыйV6 уменьшает V8heap768 до384, оставляет aggregate1024/CPU300/wall600 и20soperation; добавляет только metadata по процессам. РезультатV6 пока pending. Stand overlay не установлен.

## 19.10 18:15 МСК — проверки продолжаются; отказы сборки и harness сохранены

- Memo-кандидат v12: V2 остановлен на BUILD RSS537665536B при512МиБ, runtime не выполнялся (`f5b96e4d068c17a30934e0b399a2d7f3664858345c800e986229164d7e0740c3`). В отдельном V4 build-only1024МиБ/Node768 оба noEmit и focused2 PASS; genuinePG4 остановлен на суммарной памяти1081794560B при1024МиБ до готового отчёта (`aa1ee0957aa52c475a48c481f47133698dd1cd4783d549bf8f09c1b331ce6f01`). Cleanup0, private removed, source pins exact в обоих. Рабочий20s deadline не менялся; установка этого кандидата ещё не разрешена результатами.
- Memory focused71 V1: BUILD_ONLY TS2554 в cleanup тестового generator.return без аргумента; runtime0. Ошибка расположена в consumer, source/private pins exact и cleanupPASS. Готовится отдельная type-only коррекция вызова с явным undefined; прежний RED сохраняется.
- Для будущего v13 подготовлена явная композиция memory/routing/memo,104 targets. Четыре пересечения объединены с сохранением budget precharge и transaction-local memo. Ready `a1e768005cdba1ad7254d6ad4afa9bad544bf68261425f4cef6a0f3eee3b90be`; только исходники, runtime пока не принят.
- Browser HOLD, calibratedProbability=null, realQualifiedPairs0; новое покрытие этими подготовками не заявлено.

## 19.10 17:57 МСК — упаковщик проверен; две оптимизации подготовлены

- Packaging fixture consumer: actual25/25 PASS за1.295с, source pins exact, temp cleanup PASS. Receipt `output/submission-snapshot-consumer-20261019-v1/first-result.json`, SHA `f8e9beb1a175e882582b14ea62894a016ff70d59272621a42d2ad7b816d21db2`. Настоящий архив сдачи пока не создан; это проверка целостности упаковки.
- v12 подготовлен transaction-local memo для повторной реконструкции двух immutable origins; fresh current source/review/job headers и независимый C сохранены. v13 подготовлен validate-only entry вместо23 выбрасываемых полных canonical strings. Обе версии output-only, ускорение и снижение памяти пока не подтверждены.
- Genuine one-inventory inheritance consumer: actual30 runtime phases PASS, затем test-only RED — harness ожидал10 jobs при настоящем9-job профиле безOCR. Outcome `10ea619d626357c889697c6ae5be09db55d7b2bb83e8c9aae7bc4b186c16cb2e`; cleanup DB0/private removed/all pins exact. Готовится отдельная версия ожиданий9 без изменения профиля. Полные шесть семейств, fresh extraction и реальная инженерная квалификация этим не заявлены.

## 19.10 17:41 МСК — v12 baseline проверен; причины двух отказов локализованы

- Тот же CHK-12F624DC прошёл полную проверку настроенного OCR v2: 10 заданий, 63 scalar/70 outputs/132 coverage, две обработанные страницы ПД99/100 и десять отложенных. Проверка исходных документов тоже PASS. Нового baseline POST не было. Receipt `configured-ocr-verification-correction-v2/controlled-v12-v3-normal-baseline.json`, SHA `c66aab94da88ecf9b6bb3d13e4010c5e315b0384fc40e1520a245da6fc59c320`.
- Следующая команда пары вернула503 KR060_PDF_IO_DEADLINE за22.447с. SHA сохранённого тела совпадает с точным native JSON ошибки. Свежая БД: receipt для ключа0, source reviews2, только UNKNOWN draft1, runs2, active0. Неопределённый ключ/тело сохранены, повтор не выполнялся. Read-only diagnosis `cae9e951eb9342cce24c54e7dc838ca7367b82eee60ed246358e7220979302d8`. Готовится устранение повторной реконструкции immutable origin внутри одной транзакции; лимит20с остаётся.
- v13 V8 без tsx supervisor всё ещё превысил512МиБ. V9 с ограниченными metadata-наблюдателями прошёл те же27 фаз: пик544694272B = Node473755648B + Python70938624B, маршрут REVIEWED_LOADER_V13. Outcome `6f9d53f00eae731a958b6b86ba199f3153603d0a8b8c19a595475d3b078f2901`. База и private copy удалены, все pins точны. Атрибуция подтверждена; оптимизация ещё не проверена. Ни лимиты, ни assertions не ослаблялись.
- Полная приёмка v12/v13 пока не завершена. Browser HOLD, probability=null, realQualifiedPairs0.

## 19.10 17:07 МСК — первый полный анализ v12 завершён; проверка OCR уточняется

## 19.10 17:26 МСК — v13 полный worker PASS; PostgreSQL остановлен лимитом памяти

- Genuine compatible wrapper v13: четыре сценария PASS — полный RULE, подмена retained target, forged fact ID и изменение source stage. Outcome `output/matrix-t85-20261019/compatible-rule-seal-consumer-v4/first-results/outcome.json`, SHA `9a846912e3e3991abcae178386fed1cd182ad0d7dfa1f92ad59c21e6930761ee`. Положительный сценарий 33.362 с / 257816 КиБ; 64 скалярных результата, 71 выход, 132 строки покрытия. Все private/source/dependency pins сохранены, временная копия удалена. Это настоящий worker/HTTP transport на полных PDF-derived artifacts с синтетической связью; server SEAL и реальная квалификация этим не подтверждены.
- Durable PG V7 прошёл 27 runtime этапов, затем BOOTSTRAP_08_WORK остановлен PROCESS_GROUP_RSS_LIMIT: 561618944 байт при 512 МиБ. Outcome `eeb8f33df8f8283c86e5ce951c5d2d42901dc13c4e0535c8fc028efa2ad3d414`. Тестовая база удалена, 526 private copies очищены, source103 и protected pins точны. Лимиты не повышались; исследуется лишний процесс tsx CLI supervisor. Исходный RED сохранён.
- OCR verification overlay V2 прошёл локальный selftest: корректный вход, swapped/+2 geometry приняты, 16 повреждений отвергнуты. Receipt `output/matrix-t84-20261018/configured-ocr-verification-correction-v2/local-selftest-first-result.json`, SHA `ebb4cf2db4ba3708ef7b1f9476ecfc17a10833d1792371ec49e64b4e5287a9e1`. Проверка стенда пока pending. Fresh read-only precheck подтвердил один существующий baseline CHK-12F624DC/одну command receipt, никаких новых запусков или source reviews; jobs/runs0, сессия действительна.
- Все прежние RED сохранены. Browser HOLD, calibratedProbability=null, realQualifiedPairs0.

- Единственная сохранённая команда после исправления прав вернула 201: `CHK-12F624DC`. Все десять заданий завершились с первой попытки, сохранены 63 скалярных результата и 70 выходов. Повторного анализа не создавали. Свежая сверка 785 прежних ответов после исправления API/outbox PASS.
- Проверка остановилась на устаревшем ожидании `UNCONFIGURED`: стенд уже включает `INSPECTOR_MATRIX_OCR_LAYOUT=1`. Настоящий bounded OCR v2 обработал страницы 99/100 ПД, десять требующих OCR страниц отложены; для РД требующих OCR страниц нет. Готовится отдельная версия проверки профиля, хешей, геометрии и отложенных страниц. Провайдер не отключается; исходный отказ сохранён. Полные 79 заданий, перезапуск и итоговая приёмка ещё pending.
- Извлечение текстового слоя полных оригиналов заняло около 189 секунд. Замер 41.799 секунды ниже относится к расчётному ядру, а не ко всему свежему PDF/OCR pipeline. OCR scores не являются калиброванной вероятностью инженерного вывода.

## 19.10 — v12 установлен; исправлен отказ запуска SUPERVISOR

- Напоминание `inspector-ai-homeserver` удалено. Доступ восстановлен; работа идёт на обычном CPU тестового стенда.
- Семь ролей v12 установлены; исходники API, 168 модулей и 25 правил каждого worker, три web-ассета сверены. Миграции 044/045 добавлены, прежние 43 сохранены. История: 785 GET и SQL до/после установки совпали. Аудит полных ПД139/РД32 прошёл девять настоящих заданий очереди.
- Полный анализ сначала получил 409 `KR060_SNAPSHOT_INPUT_INTEGRITY`: проверка admission требовала capability RUN_START, хотя API разрешает SUPERVISOR по роли. Исходный отказ и ключ команды сохранены. На настоящей PostgreSQL старый код дал ожидаемые 3/4, исправленный 4/4; свежие права организации, сессии и объекта проверяются по-прежнему.
- Установлено явное исправление одного файла API; пересозданы только API/outbox. Остальные 25 контейнеров, настройки и 45 миграций сохранены. Полная сверка установленного кода после исправления PASS. Новая приёмка, семь обычных запусков/79 заданий и перезапуск ещё pending; первоначальный freeze не переписан.
- T85: полный noEmit API+contracts V4 PASS (`32dfd5a5d31cc92cc13d857329b610701f8db326273613faa44c042558c5c279`); genuine base guards/API/worker/wheel/sdist+две установки PASS (`b306c8890af1380295f622889a593aa1243078877c084111b029e45bcdfeee0a`); общие лимиты rowset проверены двумя настоящими PG-тестами. Полный durable v13 ещё не принят.
- Браузерная проверка удерживается прежним отказом automatic approval review. CLI/HTTP/SSR не являются browser proof. Реально квалифицированных пар 0, калиброванная вероятность null.

## 19.10 15:39 МСК — обычный homeserver CPU PASS, сервисы сохранены

- Пользователь подтвердил восстановление доступа и разрешил продолжение на homeserver; heartbeat `inspector-ai-homeserver` удалён штатным automation tool. SSH доступен. Первая metadata-попытка после восстановления поймала реальную ошибку Docker template для отсутствующего optional `Health`; исправлено только чтение через safe map index. Все26 прежних ID/images/running/health подтверждены, jobs/runs/leases0, MemAvailable2970776KiB. Исходные отказы сохранены.
- Genuine ordinary-host semantic capacity PASS: `output/matrix-t83-20261018/ordinary-capacity/transport-v5-order-fixed/actual-first-receipt.json`, SHA `1fd87a91e4c16d90ed9553eb3eedf3a3fbae111f46e3ab3de8295f26560798c5`. Полный настоящий v12 dispatch + column evidence replay +11 whole hashes,41.799s/CPU41.993s/maxRSS275804KiB, bootstrap42.123s. Пределы55CPU/60wall/512MiB и available-memory gate1.5GiB прежние; GPU/networkAPI0. Temporary removed, independent own-dir absence verified.63scalar/70outputs/62partial parameters/70atoms/70unsupported — результаты этого тестового input, realQualifiedPairs0, не новое подтверждение реальных пар или calibration.
- Остановка сервисов не понадобилась: памяти достаточно. Fresh before/after26 whole metadata rows exact, API/web/relay healthy, jobs0. ROOT preservation receipt `24ed830b304f1e8a5f0ea916ee1113e4900541a7fa4e70146611a9c16c75e0c3` в `capacity-diagnosis/availability-after-ordinary-capacity-v1/root-no-service-mutation-preservation.json`. Lifecycle mutations0; restoration не выполнялась и не объявлена PASS. Новый aggregate-v5 сохраняет semantic gates и добавляет явную no-service-mutation ветку; приёмка aggregate ещё pending. Стенд остаётся T81v11.
- Shared budget V3 independent consumer проверен ROOT по исходникам/535pins, сейчас выполняется один local noEmit +mock1 +real PostgreSQL4 в собственной disposable DB. No full-v13/runtime/release authority. Target/review и steel admission source продолжаются; browser HOLD прежний.

## 19.10 15:30 МСК — локальный composer V3 noEmit PASS; SSH закрыт

- После истечения пятичасового окна выполнена одна bounded metadata-only SSH-попытка: exit255, `Connection closed by 192.168.31.175 port 22`, 11:19:28UTC. Никаких сервисных изменений/semantic calls, свежего baseline или ordinary-host acceptance нет. Outcome: `output/matrix-t83-20261018/capacity-diagnosis/owned-runtime-isolation-v6-order-fixed/availability-read-outcome.json`. Автоматического повтора нет; локальная реализация продолжается.
- Composer V3: полная настоящая проверка типов API+contracts PASS, outcome `98aa048b790b2ce68b5c7a317b32258120ebabdfe190a81231869ae9773faa4d`;6.180s/592064512B BUILD_ONLY,469 private copies, исходные/proposal pins exact, cleanup. Исправлены строгая типизация length descriptor и структурная копия WallFact; charge после inspection/run locks закрывает найденную статически гонку с completion. Оба scalar profile probe ограничены2 строками; настоящие конструкторы сохраняют ровно1 RULE slot, включая unconfigured source audit. Runtime race ещё не доказан PG-тестом.
- Shared budget V3/source-address source готовы; реальные PG budget tests готовятся. Public targets/review и pre-run steel resource seam реализуются в отдельных узких пакетах. Capsule/config остаются null до genuine accepted base; новые исходники output-only. Browser HOLD прежний; CLI/SSR не заменяют browser proof.

## 19.10 14:13 МСК — T85 source-address29 PASS; composer compile RED retained

- Genuine source-address consumer2noEmit+29whole cases PASS. Full PD139/RD32, exact text/context/bbox/union/target/source/stage refusals, whole input immutability/detached return, native getter0. Outcome `3bcd5ad784400f6532e612ef3bb56edbb45749a23f2c3de846252238213cbc7e`;49.468s/peak378720KiB, all1664protected/1650copied pins exact, cleanup. Source-address only, not engineering/review/PDF authorization.
- Composer v2 source frozen `7b6d9870a30d5ed78c68ab890700ce82c8728bca75d51b19710c3d05339777c9`: all7 typed/current immutable parents, bounded scalar origins, PDF union, claim original-manifest projection, optional budgets before full JSON. Full noEmit first RED `5b458a7bd3260b3fa81642794439b5e47b4776cc758a791d95b3d49de6368c7e` preserved: array descriptor mapped typing and WallFact index signature conversion. No runtime;469private/live441/proposal pins exact and cleanup. Separate narrow source corrections in progress; no unsafe cast requirement accepted.
- Shared budget v2 adds omitted whole `analysis_jobs.result_json` bytes. Source-only ready `e1c90de27bfabbc50e816610c1f9eb660bd824ab93fdcd2fb35c59214da7040d`, ROOT exact reverse/static review `c4a1476c144f21911d48858d3fb9d123e4424e62ea199dca3cb4fe26ae770865`. Real PG consumer and independent transfer audit pending.
- Ordinary-host isolation v6 rebased exact current packet/PG/review paths, ROOT static review `921f8cbf9b1a76933561fa9c1236fa30574eb31b8d32c4f1290e7cf53d8f66b3`; remote safety/lifecycle/caps exact. No SSH before11:19UTC. Aggregate v3 lacked outer restoration gate; separate v4 preparation requires genuine capacity plus exact six-role restore/twenty-neighbor preservation. No authority invented.

## 19.10 14:08 МСК — T85 worker90 PASS; полная проверка типов API PASS

- Guarded worker: 90/90 actual local checks PASS, outcome `53a01146947cc12c155954a31ca4f11f7b79576954506e623647c0633d1cd720` in `output/matrix-t85-20261019/durable-worker-integration-v1/independent-consumer-v1/first-results/outcome.json`. Genuine24 refusal/native/marker cases plus BUILD_ONLY66 whole inherited-base validation/mutations. 6.239s; child peaks45860/182976KiB, no network/subprocess, all226protected/199packet pins exact, private cleanup. No accepted v13 capsule or successful RULE/SEAL claimed.
- Full API/contracts noEmit PASS after two narrow source corrections. First failure `f357f31e6fe0a650468f122bc21ea167b562dc4ef88ca2b888a39502339fc1d6` retained: stale projection import and erased full-definition type. Second failure `1e12234afd1bf81ecf7615bfed589b73967d574f3808c1ac0316ce5784d4a20c` retained: previousPolicy union still lost project fields. Selected v3 uses actual typed base definitions plus full canonical equality; no casts or weaker validation. PASS `874214d2f3d285c40edacaf2d8b242e7fb8c3b67738819d7a27379813427ffaf`, 6.827s/592302080B BUILD_ONLY1024MiB. Live441/private467 pins exact, cleanup.
- Packaging proposal v2 ready `c15831d94fdda1c68220448f6170cb0f6c1a6d76cb2db217d58974e57a00d027`: API six worker modules/resource, wheel+sdist capsule inclusion, installed module/source identity checks. Prior static construction defect preserved: accepted definitions return dict, not tuple. No image/wheel build or capsule generated.
- Shared64MiB preparation precharge source ready; six loader copies retain old branches. Found actual inventory loader full manifest/release read before authenticateBase callback; composer must precharge before runIdentity. API composer and external run-state forwarding in progress. Source-address29 independent consumer running once with unchanged55CPU/60wall/512MiB; no result yet.
- All new proposals remain output-only. Stand T81v11; T83 actual ordinary-host capacity pending. No SSH before11:19UTC/14:19МСК; browser HOLD remains.

## 19.10 13:48 МСК — T85 guarded worker integration source prepared

- Prepared complete guarded worker release/SEAL source proposal, ready `232e973609e9058666b60bb3bd2aa24828d9d0ca47d3c631e7c0d402c6515c0c` in `output/matrix-t85-20261019/durable-worker-integration-v1/`. Own wrapper `90fa21d50f0734662d0c3757443d6bf915880fe82b3d56a4432401377ad475c4`, actual tested Python-v5 scalar, unchanged five selected leaves, tested main/pilot transport copies. Eight ASTs pass; inherited v12 validation body reverse AST exact, real HTTP loader and eight-domain execution body AST exact. These static checks do not prove execution.
- Explicit before-code amendment permits source preparation before genuine T83 base acceptance. Finite history-v3 capsule contract fixed: three unchanged v2 rows plus accepted v12 row, exact4 row keys; byte-identical API/worker resource, fixed2MiB resource read cap. Accepted capsule/config pins remain null; resource is absent; own v13 RULE/SEAL cannot execute. No fake capsule or accepted config generated.
- Preserved two ROOT static construction defects before freeze: selected metadata instead of closedLeafBlueprint; token transform also prefixed attribute names. Both corrected, source snapshots/receipts retained; no runtime occurred before correction. Independent worker consumer now being prepared, including genuine inherited-body validation against current whole prepared v12 definitions; this will remain BUILD_ONLY base validation, not v13 authority.
- API vertical source proposal and source-address reconstruction seam in progress. Live1461 source/profile/stand remain unchanged. No SSH before11:19UTC/browser HOLD unchanged.

## 19.10 13:38 МСК — T85 historical scalar raw SQL4 PASS; source-address contract clarified

- Genuine focused noEmit + actual PostgreSQL4/4 PASS. Whole stage14/release/source raw captures for sealed SUCCEEDED/PARTIAL, unknown profile/corrupt hashes preserved for downstream refusal; seven real SQL gate fixtures, wrong object/check, historical capture after current-stage/latest-review mutations, genuine22P02 same error identity, three actual23505 constraints. Outcome `output/matrix-t85-20261019/scalar-origin-query-v13/pg-consumer-v1/first-results/after.json`, SHA `e2d5f41a0e939dd2a313cadd67a483a2b2275e31f926af98d0a0c7387cc60100`. Own disposable DB normal cleanup0; all9owned/10source/45migration/12tool pins exact. Raw SQL proof only, no release/PDF/engineering/actor authority.
- Architecture correction to previous 13:24 entry: recursive old-comparison DAG is unnecessary for the frozen oldOrigin source-address contract. The new protected address-only boundary must authenticate exact sealed stage/release/hash, full own-original artifact/stages and selected raw/context/geometry/portable target. It must never authenticate previous engineering results. Existing full fact-origin helper stays unchanged; current consuming run still rebuilds complete scalar + all seven typed domains at completion/seal/saved read. Versioned genuine reconstruction seam and explicit before-code addendum in preparation.
- No installed v13/profile promotion. Ordinary-host accepted base remains absent. No SSH before11:19UTC; browser HOLD unchanged.

## 19.10 13:24 МСК — T85 scalar assembly42 и real PG composition3 PASS

- Assembly: genuine2noEmit +41 whole cases/getter42 calls PASS,6whole returns/35exact errors, legacy binder regression1, full139/32 opaque artifact transport, entire input/manual/source/tool/private pin immutability and detached graph mutations. Outcome `output/matrix-t85-20261019/scalar-input-assembly-v13/independent-consumer-v1/first-results/outcome.json`, SHA `615deb5ab75463a8c0491c4e4bf0f7f4d02393c767d366a251608f2a00b44390`. Total3.549s/runtime1.829s/peak449552KiB; fixed55CPU60wall512MiB; private copy removed. No DB/PDF/release/engineering authority claimed.
- Immutable SQL loader bridge: genuine focused noEmit +actual3/3 PG methods PASS, full139/32 artifacts unchanged, all19 review fields/seven opaque siblings, UNKNOWN/null, saved history despite current-stage/new-review changes,10 genuine inserted corruption refusals, real25P02 propagation. Outcome `output/matrix-t85-20261019/immutable-source-loader-v13/pg-consumer-v3/first-results/after.json`, SHA `b973b9b8e74dcabc643bec6a9b58f1ad2f190c5e348ea07dbbf9ac569b70e5a1`. Own DB normal cleanup0/remaining0, source/data exact. BUILD_ONLY SQL/materializer composition, not semantic capacity/PDF/release/membership proof.
- Both setup REDs retained: v1 duplicate manifest namespace49dcd135..., v2 one-inspection-per-object b61b56c2.... ROOT missed both constraints in initial review/suggestion. V3 only inserts distinct valid review preimage/basis/hash for each fault; same inspection/sources, no bypass/delete/immutable UPDATE; all method bodies and10 exact assertions unchanged.
- Confirmed next integration gap: source bridge lacks protected scalar FACT_BINDINGS origin closure/PDF fingerprint; previous-v13 origins can form chains. Need one operation-local acyclic bounded composer, unique-run memo and A-client raw capture; no second semantics in C. Existing live1461 source closure and installed profile unchanged. Acceptedbase/ordinaryhost absent; no SSH before11:19UTC/browserHOLD.

## 19.10 13:18 МСК — T85 materializer99 и dispatcher20 PASS; PG fixture RED сохранён

- Materializer: genuine2 noEmit +98 synthetic calls +1 full139/32 linkage PASS. Outcome `output/matrix-t85-20261019/immutable-source-inputs-v13/independent-consumer-v2/first-result.json`, SHA `8de00a1d5622d359ff6fefca83901f8faf88877133a60f648d4e2e55d9a398eb`. Total3.438s, peak full-data397803520B; all source/data/private pins exact, owned copy removed. Только dependency mapping на уже исправленный native6e202d; v1 noEmit RED сохранён.
- Dispatcher: actual20 serial steps PASS — genuine2 noEmit,244 unchanged golden fixtures ×12 old profiles, manual refusals/native getter0, whole DATA4 original139/32. Outcome `output/matrix-t85-20261019/scalar-stage-dispatch-v13/independent-consumer-v2/first-results/outcome.json`, SHA `1276da05c065b01ed92338271e9a19276881410b57eba86bfcedd988c279e867`. Total104.986s, per-child55CPU/60wall/512MiB preserved, peak483328KiB. Private/source/tool pins exact, temp removed. v1 missing-catalog RED and ROOT wrong-grant-argument preflight refusal retained; v2 only genuine catalog resource mapping.
- SQL loader bridge: focused genuine noEmit PASS; actual PG2 PASS (whole3-source parent and full139/32). Third method stopped at test fixture duplicate `(inspection_id,sha256)` manifest INSERT before corruption checks; no claimed3PASS. Outcome `output/matrix-t85-20261019/immutable-source-loader-v13/pg-consumer-v1/first-results/after.json`, SHA `49dcd135bbef957c0d4260b005150410cbef6ae255739ef6ff3c0d3d46e0f95a`. Own DB normal DROP/remaining0; source/data exact. Separate v2 fixture isolation correction prepared; no constraint removal.
- Scalar assembly41+getter consumer ready, ROOT review pending. No installed v13 profile, accepted v12 capsule/ordinary-host proof remain absent; current1461 unchanged. Browser HOLD and no SSH before11:19UTC remain.


## 19.10 13:03 МСК — T85 immutable source query + fact origins, actual local checks

- Raw immutable-source SQL: actual PostgreSQL3/3 PASS, own disposable DB removed (remaining0). Original manifest/stage/review snapshot unchanged after current-stage/new-review mutations. Receipt `output/matrix-t85-20261019/immutable-source-query-v13/pg-consumer-v1/first-results/after.json`, SHA `4ebcc81e73f341072e0f3d4608cf2c7ab07ab450ba7ac59f96189a4a33994287`. Raw SQL/schema only; downstream authority is separate.
- Fact origins: genuine2 noEmit + full DATA4 four original139/32 children + native getter child PASS; exact independent PD/RD selectors/targets and private mutation closure. Receipt `output/matrix-t85-20261019/fact-origin-preparation-v13/independent-consumer-v2/first-results/outcome.json`, SHA `dae0a19875e6155e0c9163b0ddd3d661f6e529dad3a34cee7a28b2e054026681`. Local only; no PDF/release/SQL authorization or ordinary-host proof. Initial test-only TS7022 RED preserved; exactly3 annotations, DUT unchanged.
- Materializer first noEmit RED selected stale native dependency; runtime0. Preserved SHA `5e5ee1950eb239c5521eb575347c27982c3505cddd2a63d81ae32566a86222e9`. Prepared v2 changes only mapping to already-tested native6e202d; no rerun yet.
- Scalar dispatcher consumer now running exclusively; assembly source prepared and independent consumer pending. No v13 profile promotion, current1461 source closure unchanged. Browser HOLD; no SSH before11:19UTC.

## Обновление 19.10 12:48 МСК — API18 и историческая композиция25+getter PASS

T85 API transport v6: actual18/18 PASS в отдельных serial runtime children;2 полных noEmit отдельно BUILD_ONLY1024MiB. Runtime caps55CPU/60wall/512MiB/Node384 прежние, peak421.3MiB, total42.920s. Outcome `output/matrix-t85-20261019/api-origin-get-transport-v6-consumer/first-result.json`, SHA3ede4837268bce7325009af41dc6c80c575e23901ed4118b541b9cc77da3c972. Исправлен только prototype-sensitive consumer assertion: Fastify query имеет null-derived prototype; точные own keys/values сохранены. Все исходные compiler/CJS/RSS/callback RED сохранены. DUT proposal неизменен. Это mock repository/Fastify inject, не DB/PDF/release/browser proof.

Immutable source composition UUIDv2:2 настоящих focused noEmit и literal manual24+UUIDaddendum1+getter actual26calls PASS. Outcome `output/matrix-t85-20261019/source-snapshot-composition-v13-uuid-v2/independent-consumer-v1/first-results/outcome.json`, SHA41d7c0b532576c9fc8e5a104546aeb3ba2532bfaaa32a868e048a40cac4d4b81. Полные4returns/21refusals/zero getter callbacks/detached whole graph;1649protected/1642copies exact, private copy removed. Case-insensitive UUID uniqueness исправлена двумя Set-key expressions; parent identity/hash/stages домены прежние. SQL capture prepared separately; actual DB/PDF/fullstage/release authority pending. Accepted v12 capsule/final v13 policy отсутствуют, live profile не установлен. Homeserver hold до14:19МСК и browser security hold сохраняются. Следующая реализация — immutable SQL projection и один stage/seal/read scalar dispatch.

## Обновление 19.10 12:28 МСК — original manifest и полный review parent проверены

Frozenmanifest: genuine2noEmit +22 whole cases/getter23 PASS, outcome3dc684fb8ac168718913673d38f6ce7815928a7706d4a3219151f0491604f0a1;1.774s/163352KiB. Parent review: genuine2noEmit+26whole/getter27 PASS, outcome7f33f9a3a61505cad5428eba97a9d04135d30203581012256ae464868c4015ec;28.262s/151028KiB. Whole19parent/snapshotID/hash/all7siblings/null/UNKNOWN/detachment/nativegetter0 подтверждены в заявленной pure-data границе; все pins/tempcleanup exact. DB/PDF/typedchild/releaseauthority этим не подтверждены.

Подтверждён structural gap generic loader: current source_file_stages использовались для пересборки historical manifest. Подготовлены отдельные output-only SQL2 без mutable stages и composition24, связывающий исходные stages+полный parent+manifestreviewhash; независимый consumer готовится. Live2existingloader не изменён, v13 runtime ещё не установлен.

API v4 первые5 PASS, затемRSS538673152B>512MiB. V5 сериализовал18 исходных checks по свежим children с прежними runtimecaps и общей180sграницей: actual8PASS, девятый conditional200 получил500 при~378MB; исход сохранён, callback/assertion причина исследуется. Обе полные noEmit пройдены; no claimed18PASS. Homeserver до14:19МСК/browserhold прежние.

## Обновление 19.10 12:20 МСК — настоящий HTTP loader10 PASS; API typecheck2 PASS

Локальный HTTP:10/10, настоящий owned127.0.0.1 server+HTTPConnection, полный7.6MB v7 payload принят;409/503, malformedheaders/hash/schema/manifest/truncatedbody/duplicateJSON отвергнуты. Outcome 553332e5c92f16b668293d59874ae85b03fee3d91d97f77f2998465779b18f95;22.627s/childVmHWM265564KiB,55CPU60wall512MiB прежние;202 protected/199private exact, server/socket/thread/temp cleanup. Это transport-only; DB/release/origin/PDF/browser/ordinaryhost этим не подтверждены.

API v3: оба genuine full noEmit PASS с отдельным BUILD_ONLY cap1024MiB (RSS577314816/611598336B). Runtime512MiB отказал доDUT: tsx top-level await CJS transform,0 routechecks. Outcome 19084e9390ae0e056fe5bd2fa834a7b6b2286d1205b56a7442b1e044d57bd85c; первая ошибка/логи сохранены,441sources exact/tempcleanup. Узкая harness .mts correction готовится; код/18 assertions не ослаблены. Проверка frozenmanifest22+nativegetter запущена отдельно; parent27 ждёт такой же ESM correction до первого запуска. Live1461/standT81v11 неизменны;SSH до14:19МСК/browserhold прежние.

## Обновление 19.10 12:06 МСК — policy14 PASS; API transport compiler resource RED

Policy seam:14 genuine calls PASS,2 DATA-only conditions остаются отложены. Exact tuple/data detach,13 refusals, native callbacks0, whole inputs unchanged,218 protected/195 private pins exact, cleanup done. Outcome9a83286288ddcf263758a2a6c99d66d14116a63544ebb508a9c0ec6e4461d96a;0.173s total,19148KiB processHWM. Accepted base/capsule/policy/release по-прежнему NULL; это проверка отказов и метаданных.

API transport consumer первая попытка RED до runtime: genuine source-noemit killed RSS546521088>536870912 bytes at0.806s,CPU3.57s; empty diagnosticlog, ни одного runtime check. Outcomefc1e5f0cb36f46f43d5fa8b754028ac1cf9542b3623cc900b377d650b8f3497c; source441+5 overrides unchanged, private cleanup done. Исторический RED сохранён, compiler-memory diagnosis отдельно; unchanged retry/ослабления sourcecoverage нет.

Новый output-only полный parent-review hash/snapshot-ID helper подготовлен:25 frozen cases+1 optional-null case; независимая проверка готовится. Не подтверждает persisted DB/PDF/domain eligibility. HTTP loader consumer готовится с настоящим локальным сервером. Live1461/standT81v11 сохранены. До14:19МСК SSH запрещён пользователем; browser hold прежний.

## Обновление 19.10 11:44 МСК — Python/TypeScript full-originals parity PASS

T85: genuine2noEmit +4 DATA4 full-originals cases PASS. Оба положительных raw DTO прошли полный admission/rebuild с ручными KR055 rows/coverage; corrupt retained evidence/factID отвергнуты TARGET_UNVERIFIED без DTO. Python/TS whole consistency сохранена, other61/131 только regression. Outcome `output/matrix-t85-20261019/full-scalar-v13-originals-memory-diagnosis-v2/first-results/outcome.json`, SHAc62bd0cec20b31c9d9fa38131b0d5eb13c64cf80bd1161ffb77055fe0681a5af. Total40.068s, maxgroupRSS461368KiB<524288,55CPU/60wall/384Node прежние. Exact1952 protected/1660 copies, temp removed. Убран лишний lifetime копий в consumer и разрешён только один точный исторический пустой crashlog; продукт/oracle неизменны, прежние RED сохранены. Это не свежий PDF I/O, accepted review/release/capsule или homeserver proof.

API own GET transport static reviewed:5output copies/7 edits, exact reverse proof, genuine v13 policy remains unavailable/failclosed. ROOT review745e55f6fb3de798fdb1f2cb1c12e68a63cbf0f452567acdbeadfbeb81e04d76; consumer готовится отдельно. T84 current1461 DATA-only amendment ROOT reviewed41a5f246becd4362915e24453f2a54d4e302f0b8b893b337fe1cc25138f334cc:SQL2/test1,1458unchanged;88migrations/168worker25rules42inputs unchanged. Ни API transport, ни T84 rollout не установлены. Acceptedbase/capsule/aggregate отсутствуют; homeserver hold14:19МСК/browser hold прежние.

## Обновление 19.10 11:37 МСК — transport19 PASS; aggregate tooling исправлен статически

T85 output-only worker main/adapter wiring: actual19/19 PASS, child0.519s/CPU0.549s/VmHWM69812KiB; source207/private174modules+25rules exact, own temporary removed. Outcome `output/matrix-t85-20261019/worker-transport-wiring-v1-consumer/first-results/outcome.json`, SHA081f3618867f5de74f4317d1fb4e692f8fab9a5dfa977b456856583709aa3a15. Genuine draft marker/adapter/native refusals проверены; future heartbeat/alias success — только явно обозначенный MOCK_ONLY_TRANSPORT. Реального принятого v13 release/capsule/engine/PDF/installed proof нет; live sources неизменны.

T83 final197file packet независимо static reviewed:193runtime/1461sources/18evidence, source-keyed32/139,2manual+9consistency hashes точны; ROOT final reviewa0396352b4aece78a538a7d12b83949856987ccfc0e84f44f3b1262f6d3cad0e. Новый aggregate-v3 меняет только3 executable строки: отдельный actual TOOL_BASE и новый builderSHA; historical DATA SCOPE неизменен. ROOT static review678dbb91767c7a30bfae13df493b0f0d6310f763a95f2500f0ddd77198f9cbdc. Aggregate не запускался, настоящий ordinary homeserver результат ещё обязателен.

TS originals: память исправляется только в тестовой обвязке (короче lifetime лишних полных копий; streaming all-byte hashes; whole deep equality после каждого publiccall). До DUT пойманы два preflight отказа: ROOT лишние grant поля и bytes>0 guard для единственного пустого аварийного лога. Первые RED сохранены; готовится точное исключение только для этого path/0/emptySHA. DUT/native/oracle/limits прежние. Homeserver hold14:19МСК и browser security hold сохраняются.

## Обновление 19.10 11:31 МСК — local CPU PASS; TS full originals: отказ по памяти

Actual local order-fixed packet: PASS, полный worker+отдельный column evidence replay+11 whole hashes, total19.282s/CPU19.271s/maxRSS277372KiB; исходные55CPU/60wall/512MiB и1.5GiB RAM gate прежние. Source1461 exact,1 semantic+1 own cleanup, temporary removed, без SSH/DB/network/GPU. Receipt `output/matrix-t83-20261018/ordinary-capacity/local-order-fixed-diagnostic-v1/actual-first-receipt.json`, SHA4e53d7872d229a31e3bc244e4efb5d796401eb75cf86dbfd31dff8243485c97c. Это только местная диагностика CPU; ordinary homeserver/aggregate acceptance=false. Пакет197files/193runtime frozen, bootstrap18/18 PASS, packet-readyfb7ded2d1066227462380e880ab37992cb79c9e81f2e96033691a11df157713e. Actual PG3 принят отдельным collector:8e3a7466b547819acbfdf98169597a66c0420c86cf1a3da75fcfd7af07918001; старый collector JSONDecodeError сохранён, исправлен только raw-log digest check.

T85 TS native v2:2 настоящих noEmit+25/25 cases PASS, outcome56555693046ecc7e4665658f1c214c5d6c47576d21e77e01b1e09854476b04c6. Full-originals отдельный consumer v1 остановлен на TS7022 до DUT; v2 добавил только Value[] annotation. Actual v2 contracts/focused noEmit и первые3 случая PASS, четвёртый nullable current-stage остановлен RSS532628KiB>524288, exit-9, не semantic assertion. Outcome4af88966b2668fe079a66fb2a7388fca69bcf1f45d39f3bf8cef09652173991c сохранён. Причина лишних allocations исследуется; лимиты/ручной DATA4 oracle неизменны. Python originals4/4 PASS остаётся отдельным доказательством. Live/runtime/capsule не установлены.

Итоговый aggregate v2 не запускался: ROOT static review нашёл TOOL_BASE, указывающий на старый каталог при новых executable hashes. Нужна узкая versioned correction с отдельными историческим SCOPE и текущим TOOL_BASE; никакого ослабления acceptance. Homeserver hold14:19МСК/browser security hold прежние. Worker transport wiring проходит отдельную изолированную проверку.

## Обновление 19.10 11:13 МСК — Python full originals4/4 PASS; TS native type fix проверяется

T85: независимые ручные DATA4 проверены фактически на полных artifacts PD139/RD32:4/4 PASS, positive B60=B60 и nullable currentRD точны по полным KR055 rows/coverage; обе coordinated retained-target corruption отклонены TARGET_UNVERIFIED без scalar. Остальные61/131+metadata — только regression. Outcome `output/matrix-t85-20261019/full-scalar-python-v5-originals-consumer/first-results/outcome.json`, SHAdbe20c00603120a999134ea0d3a0dd72a75bb69396c78805c85a1f11d297a865. Максимальный childVmHWM191544KiB,55CPU/60wall/512MiB прежние;206 source pins exact/private copy removed. Это не authenticated review, fresh original PDF I/O, release/capsule или homeserver capacity.

TS первая серия завершилась на настоящем focused noEmit с TS2345: контракты прошли, DUTcases0. RED925e7bccbbd731304d7d8dba715ee2b6e6e7dfc0abf23cb7ca61a568a1a3896d сохранён. Новая output-only версия меняет ровно один guard на return fail; predicates/proxy/error/caps прежние, runner/consumer/cases byteexact. ROOT review5cd1245b04ec69924d058c60792ca4101eb9631ed460f356981b3018e2349414,1695 protected/1665copies/old1685 unchanged. Actual2noEmit+25 запущены отдельным grantfeb2f21c8ece0252f90b16416394eef384f47da2fc8cdf8d92fa95d1be69356c,session15295; исход пока null. Homeserver hold14:19МСК/browser security hold прежние. Две ROOT command argument опечатки в предыдущих grant/ready вызовах отказали до children/results; отдельные preflightRED сохранены, исходники/ожидания не менялись.

## Обновление 19.10 11:03 МСК — genuine fullPG после SQL исправления:3/3 PASS

Текущий полный PostgreSQL-прогон естественно завершён:3PASS/0FAIL/0PENDING, JSONsuccess=true, exit0, watchdog=false;1461 source pins exact до/после/ROOT повторной проверки. `saved-read-order-correction/qualification-renewal/pg/after.json`, SHA3ae9aaec962f8b1873f4f2387205c4464251b231a6e1bc750081654841c7b459. Actual сохранение/UNKNOWN/WITHDRAWN/source change/history/restart/original corruption gates прежнего полного integration test прошли. Старый fullPGv3RED остаётся; его конкретный SQLcause не доказан этим последующим PASS.

ROOT отдельно проверил owned local PG container ID/image/running, ownqa_t83 databases0, scopedPGprocesses0; receipt `pg/root-cleanup-and-functional-review.json`, SHA4aec07888a0725d9d14fb8bb0744308a2881c6c34fda3cdb615d0b2c2cf66091. Runner monotonic1002.540s/Vitest1001.88s записаны как есть; host suspend observation отдельно, ordinarycapacity этим не заявляется. Новый order-fixed acceptedPG collector/capacity/aggregate ещё впереди. После освобождения heavy slot запущен reviewed isolated TSconsumer: реальные2noEmit затем25 cases, session71454, исход пока null. Homeserver до14:19МСК не трогаем, browser security hold прежний.

## Обновление 19.10 10:59 МСК — полные исходники KR055: ручные ожидания приняты

T85 DATA4 проверены до consumer: полные139/32 artifacts, positive В60=В60 с отдельной null-entity abstention, nullable current-stage с actualObservationId/value=null и2 coordinated target corruption. Полные KR055 rows/coverage заданы вручную; остальные61/131 только regression. Источник и9 входных pins точны, изменения positive window ограничены2 заранее объявленными actual byteSize. ROOT review29d88db287940020ea01f52e5464a513eb2e62bc1db3147ad6f0f2ca12d29811. Код Python consumer готовится отдельно; новых запусков/реальных approvals/capsule нет.

TS полный scalar consumer DATA7+18 mutations независимо static reviewed:1685 protected/1665 byteexact copies,2 настоящих noEmit перед25 cases, source/native/contract guards и прежние caps. ROOT review85262fda4f1e0222f4d76daabbcd96216fc380831711aa1206419dc63b23f1a4; запуск отложен до освобождения heavy slot. Текущий fullPG session82856 подтверждён живым, прошёл прежний saved-readseq49 без mismatch и перешёл к третьей проверке history/corruption; исход пока неизвестен. Снимок CLOCK_BOOTTIME-CLOCK_MONOTONIC показывает накопленный suspend host~2191.65s с boot; без исходного clock sample не приписываем его конкретной фазе/причине и не используем прогон как ordinary capacity.

Post-fix closure DATA v2 приняты static e44c773fb0ac1a5bd9e9975b38db9d8a6c5fbbdc9df59411686b80834fbbf624: точные2 production+1 test renewals/1458 unchanged; worker168/25/42 прежний. Найден будущий ложный aggregate gate по отсутствующей строке132 passed: реальный JSON reporter подтверждает132/132/0/0. Отдельный versioned builder будет проверять pinned JSON+success, старые инструменты/логи сохраняются. Actual fullPG/capacity/aggregate остаются null; homeserver hold14:19МСК, browser security hold.

## Обновление 19.10 10:03 МСК — Python все варианты KR055 PASS; SQL исправлен локально

T85 output-only Pythonv5: actual8/8 PASS — первый baseline воспроизводит устаревший RD_ID, затем6 полных ручных положительных случаев и1 inherited source-stage refusal. Ручные ожидания зафиксированы до кода. Whole observations/KR055 results/coverage точны; остальные61 правило/131 coverage проверены регрессией, input/registry неизменны.168 live+6 draft modules/25rules в изолированной копии, исходные pins точны, temporary copy удалена. Receipt `output/matrix-t85-20261019/full-scalar-python-v5/first-results/outcome.json`, SHA4c8dfe8276205e9db45d5d608cf8aa2a28b90d193c11d3ff2f58a29470f4f0c1; wall2.013s, max childVmHWM29108KiB. Runtime/release/capsule не установлены; TS parity и полный139/32 ещё впереди.

SQL saved-read: обнаружен SELECT rule_results без ORDER BY при строгом ordered transcript. Независимый настоящий PG regression принудительно меняет seq/index план: baseline1FAIL/2PASS, candidate3PASS, payload и field-OID corruption по-прежнему отклоняются. Узкое исправление ORDER BY UUID PK и только безопасная mismatch metadata установлены в2 локальных API файлах. Receipt `output/matrix-t83-20261018/prepared-scalar-requalification/saved-read-order-correction/live-promotion/root-install-receipt.json`, SHA9bbe059e0fe648ee773f10c4b07222832184e620a9e7646cfece8ec66b60a054; ровно2 изменения из1461, worker closure прежняя. Причина конкретного предыдущего fullPG отказа пока не доказана. Actual current API132/0/0 PASS14.646s, typecheck2.070s/build1.819s PASS,1461 pins точны. Receipt `qualification-renewal/api/first-result.json`, SHAaaddd86fb0dee0d28284e94337c29891903f82a441a1c3028c52df97c2ff949e. Новый fullPG обязателен; старый v3 RED сохранён, T83 aggregate не принята. Homeserver не трогаем до14:19МСК; browser security hold прежний.

## Обновление 19.10 09:38 МСК — actual prepared PG: 2 PASS / 1 FAIL

Локальный полный PostgreSQL-прогон естественно завершён за896.31s:2PASS/1FAIL,1461 исходных pin неизменны, outer watchdog не сработал. Отказ `SAVED_READ_TRANSCRIPT_INTEGRITY` при повторной проверке сохранённого результата после разрешённого изменения source review; причина ещё исследуется. Исходные log/after-v3 сохранены, новый PASS receipt не создавался. Собственная qa_t83 БД удалена, тяжёлых процессов прогона0. Следующий шаг — найти различающийся SQL input, узко исправить и проверить regression; текущая T83 aggregate остаётся непринятой.

T85: static audit выявил отдельный пробел output-only wall adapter: пересчитывается только KR055 PD_RD, а PD_ID/RD_ID могут сохранить устаревшие строки после добавления wall observations. Готовятся независимые полные ручные случаи и versioned Python/TS пересчёт всех разрешённых KR055 variants. Фактического PASS по новым случаям пока нет. Homeserver не трогаем до14:19МСК, browser hold сохраняется.

## Обновление 19.10 09:26 МСК — локальная работа, homeserver отложен

Пользователь сообщил: homeserver недоступен ещё пять часов. SSH и серверные изменения отложены до 19.10 14:19 МСК. Создана thread heartbeat `inspector-ai-homeserver` для одной последующей проверки; локальная реализация продолжается. Два подлинных PDF восстановлены локально с прежними SHA: F0106 139 страниц, F0141 32. Приватные файлы путей/доступа восстановлены с0600; секреты/пути в журнал не выведены. Собственный существующий `inspector-t30-postgres-test` поднят с прежними ID/image/volume, PostgreSQL ready; соседние контейнеры не изменялись.

Свежий actual PGv3 запущен локально на1461 точном source pin и настоящих оригиналах; временная собственная qa_t83 БД, исходные900000ms/test и2400s outer watchdog, без повторов. ROOT static review `prepared-scalar-requalification/api-schema-qualified-pg/root-static-review-v3.json`, SHA68cf633c4d2232c8aa7b8d6578ff4346204175cd981e1ddd322fc3f5763cd396. Результата ещё нет. Время ожидания используется для подготовки v5/aggregate и проверки confidence-v2. Server capacity/stand acceptance и browser proof остаются отдельными неполученными доказательствами.

## Обновление 19.10 09:04 МСК — текущий API PASS; genuine TS original3 PASS

API schema metadata optimization: прежние loader19 PASS сохранены; первый full178 дал177PASS/1ENOENT из-за отсутствия динамических открытых reference inputs в тестовой копии. Исходный отказ сохранён. Отдельная копия добавила ровно3 настоящих публичных файла без изменения1465 прежних копий, tests/assertions/default5000ms/существующих explicit120000ms. Actual full178 PASS178/0/0,33.448s; receipt `output/matrix-t83-20261018/api-loader-performance-correction/isolated-consumer-v2/full178-first-receipt.json`, SHA0ea8c8af0cdd14f2161b17e71d34abd6369721d41693449b1de55c8707f74173. Два reviewed API modules локально установлены с preimages; receipt `live-promotion/root-install-receipt.json`, SHA76dcca0168f90ebcaa4220f0598e400a3ad8ff3701af14e6a410fe0bca6c3a29. Это только private per-operation schema metadata, без value/result/source cache.

Actual current API132/0/0 PASS15.501s, typecheck2.421s/build2.081s PASS;1461 source pins до/после точны. Receipt `output/matrix-t83-20261018/api-loader-performance-correction/live-api-qualification/first-result.json`, SHA9beca7b407b2a6e68fec031fc9c32f59846dfe3f086d6245fe0dc122e79c13c6. Два предыдущих full132 timeout RED остаются историческими отказами. Actual worker wheel/sdist35 methods each/168modules25rules42inputs PASS39d954 reused; TS-only2 edits вне этой worker closure. Fresh prepared-first PG3 и ordinary homeserver capacity ещё не запускались.

T85 TS genuine retained-original mapping: unmutated fullPD/RD и2 исходных corruption mutations actual3/3 PASS, wall10.188s, max sampled groupRSS408432KiB;324protected/338ownedpins unchanged, private temporary copy удалена. Receipt `output/matrix-t85-20261019/ts-original-materialized-adapter/first-results/outcome.json`, SHA13e1b0b9db7f44d980729738f72c3a76c150c0e11f59ccb884b6d7d6cc4d874c. Это helper reconstruction/error mapping, не fullengine/server authority/runtime/capacity; Node sampledRSS не RLIMIT_AS. Python original3 PASS5cb336 остаётся отдельным доказательством. Accepted-v12 capsule/finalv13policy остаются null.

V5capacity template независимо static reviewed80bd3e58a2628bbeed28f15ea87c922ddaae800ae0ec192062a1cb2059b336de:193runtime/197archive, source-keyed exactID+physicalSHA pages32/139 gate до исходов, прежние55CPU/60wall/512MiB и1.5GiB RAM. Actual archive/selfchecks/remote attempt pending currentPG3. V4 FAILED/UNKNOWN сохранён. T83/T84 aggregate не приняты; стенд T81v11, browser security hold сохраняется. Геопривязка и realQualified0 этими проверками не изменены.

## Обновление 19.10 08:49 МСК — actual installed worker PASS

Свежая квалификация prepared-first: actual wheel и wheel из реально пересобранного sdist установлены в отдельные временные targets вне checkout;35/35 methods в каждой установке PASS.168 source modules,25rules,42 входных pins, все7 полных expected outputs и снимки прежние; реальные installed origins/RECORD проверены, временные targets удалены. Receipt `output/matrix-t83-20261018/prepared-scalar-requalification/installed-package/prepared-first-result.json`, SHA39d954e9a8f92a6d14794d39a129c95ec58c678de5f0b5d7cb77a098301d20c2. Plan28f1ffd62eed4f2181b2ba950c2f79ff3af8163f1dabfc194fd40740acdc5707. Зависимости не загружались, стенд не менялся.

API schema metadata candidate static review PASS, ещё output-only. Следующий actual consumer: unchanged loader19, затем unchanged132+46 direct domain=178; default5000ms/существующие explicit120000ms exact. Два прежних full132 RED сохранены. T84 source-closure168 proposal independently static reviewed, не установлен; T83 aggregate/новый actualPG/current ordinarycapacity остаются впереди. Browser hold без изменений.

## Обновление 19.10 08:42 МСК — worker parity PASS; API timeout остаётся открытым

T83: versioned scalar40+полный139/32 PASS, прежний scalar hashf5823d9223eabe1a022d19b16410544084203f14e6445c26310f37b8c2a2f841. Column operation-local reuse: независимые20 branch cases,13 неизменных domain methods, полный139/32 build и отдельный evidence replay PASS. Receipt `output/matrix-t83-20261018/capacity-diagnosis/column-operation-local-reuse/serial-consumer/first-result.json`, SHA59d699b215af06af45a824558a123cb719001bedb8b1c76063a8c3d1b70e1f6f. Полный column10.243s/wall,10.168sCPU; старый historical engine точен. Локально установлены6 reviewed modifications+2new; closure1461 exact,168 worker modules/25rules. Receipt `output/matrix-t83-20261018/prepared-scalar-requalification/root-install-receipt.json`, SHA44c9b30e5de22d2bc66f90ebb3a15bc47d4eac3e6809d30aa1d2edda27d55afd. Это не стендовая активация.

API: первый полный132 прогон131PASS/1timeout; isolated original case прошёл4.818s при прежнем5000ms. Один свежий full132 снова131PASS/1timeout. Все отказы сохранены, assertions/timeout не повышены. Typecheck/build отдельно PASS, но API-набор не принят. V8 diagnostic подтвердил дорогой retained reconstruction/несколько полных canonical traversals; причина первого превышения не сведена к внешней нагрузке. Готовится bounded schema metadata optimization; production API correction ещё не внесена. Worker wheel/sdist квалификация идёт отдельно под явной поправкой порядка этапов; API PASS остаётся обязательным до freshPG и aggregate.

T85: настоящий materialized Python adapter boundary прошёл3 случая — полный положительный retained PD/RD и две исходные mutations evidenceHash/fact.id. Receipt `output/matrix-t85-20261019/python-v3-serial-independent-consumer/retained-two-corrected/materialized-adapter-consumer/first-materialized-results/outcome.json`, SHA5cb3363455ef3baf2442c365c547ec42f723069e5a7bb03ed278cb92e95ae081.232 protected pins exact, wall10.155s, max childVmHWM197324KiB; без authority mocks. TS original3 остаётся открытым и готовится отдельно. v13 release/seal design reviewed для подготовки; accepted-v12 capsule/final policy пока null. Реальная геопривязка/инженерная корректность этим не подтверждены.

T83/T84 aggregate не приняты, стенд T81v11. Capacityv4 FAILED/UNKNOWN сохранён, повторов нет. Browser security hold сохраняется. Coverage62parameters/70atoms/70unsupported — кандидат архитектурного профиля, не точность на реальном объекте; realQualified0.

## Обновление 19.10 08:28 МСК — полный scalar PASS; подключение и column проверяются

T83 versioned scalar: независимые40 векторов PASS. Полный сохранённый139/32 пакет дал прежний полный scalar hash `f5823d9223eabe1a022d19b16410544084203f14e6445c26310f37b8c2a2f841`,63 результата, без изменения исходников/артефактов/входов. Actual local CPU8.277s/wall8.283s/process VmHWM241385472B. Receipt `output/matrix-t83-20261018/capacity-diagnosis/scalar-versioned-leaf/serial-consumer/source-keyed-pages-corrected/scalar-first-outcome.json`, SHA `bf7bcf0a2e7ead74ced46ab078b6e29842c50712d18fd668f7f79fe40b85b0b3`. Первая попытка отказала до leaf из-за неверного порядка страниц в consumer; она сохранена. Исправленный consumer сверяет sourceID/SHA и полный artifact hash. Это локальная parity, не ordinary homeserver capacity.

Column output-only candidate устраняет повтор retained/current сравнения только при полном совпадении ordered sources внутри одной операции. Static review PASS; независимые20 branch векторов,13 domain methods и полный139/32 build+отдельный evidence replay готовятся к последовательному запуску. Новая current-v12 policy явно добавит3 scalar-поля; historical engine/v11/v9/v4 остаются точными. Live source пока прежний; T83/T84 не приняты, стенд T81v11.

T85 Python: дополнительные2 priority shape-before-association проверки PASS, wall0.251s/222 pins exact. Старый serial21PASS/22RED сохранён; после диагностики materialized adapter consumer проверит реальный mapping seam на положительном retained side и двух исходных corruption mutations. Это ещё не runtime/PG authority. TS21+2 PASS и UI28 unit/SSR остаются; browser security hold сохраняется. Capacityv4 FAILED/UNKNOWN не переименован и не повторён.

## Обновление 19.10 03:49 МСК — T85 фактические границы и T83 оптимизация

T85 TS дополнительные2 priority сценария PASS, <0.3s; старые21 результата сохранены. Pythonv3 actual serial:21 boundary PASS,22-й сценарий RED; дальнейшие3 не запускались. Причина: consumer требует adapter TARGET_UNVERIFIED от прямого strict-helper, который вернул SOURCE_PROVENANCE_UNVERIFIED. Полный итог RED сохранён, ожидаемые значения не переписаны; проверяется настоящий путь преобразования ошибки в adapter. Receipt `output/matrix-t85-20261019/python-v3-serial-independent-consumer/proc-hwm-corrected/first-results/outcome.json`, SHA68e907a0bf7f0257bedec1668268233f17bf5c6676869406386b499500a5db21. Wall4.172s, process VmHWM83700KiB,222 pins exact. Использован `/proc/self/status VmHWM`; inherited ru_maxrss не считается доказательством памяти.

T83: output-only versioned scalar leaf готов и static review matching PASS; historical matrix_engine856b остаётся точным. Новый leaf имеет собственный будущий SHA в childv12, прежние v11/v9/v4 определения не переписываются. Runtime parity/новая квалификация ещё впереди. Второй локальный профиль column подтвердил повтор полного сравнения retained/current внутри одного расчёта; готовится operation-local reuse лишь при полной идентичности источников. Capacity v4 остаётся FAILED/UNKNOWN, T83/T84 не приняты, стенд T81v11. Browser hold сохраняется.

## Обновление 19.10 03:36 МСК — T83 capacity RED, стенд восстановлен

Ordinary homeserver v4: фактический FAILED, SSH255/пустой stderr; last breadcrumb после whole worker54.472602CPU/54.590064wall/RSS278224KiB, затем ENTER rebuild-column-evidence. Точный сигнал/причина обрыва не доказаны. Receipt `output/matrix-t83-20261018/ordinary-capacity/transport-v4-canonical/actual-first-receipt.json`, SHAbb0500f04ad6a36379f965d8775d84841c8b07613686173e46383c7109982731. Один semantic SSH, cleanup удалил только свой private directory; без автоматического повтора. Все6 собственных сервисов восстановлены с теми жеID/images, API/web health200ok;20 соседних точны относительно свежего baseline, исторические3 StartedAt drift явно сохранены. T83 aggregate/T84 остаются непринятыми.

Local cProfile unchanged whole worker PASS по полному прежнему PG hash; это diagnostic, не capacity PASS. Обнаружено9,472,709 `_clean` /3,170,534 `_match` calls; output-only single-module optimization готовится с прежней грамматикой/геометрией/ID и полными ожидаемыми результатами. Profile ru_maxrss1123672KiB не используется как доказательство512MiB. Продуктовые limits55CPU/60wall/512MiB и1.5GiB RAM gate сохраняются.

T85 TS corrected transport/projection/merge21/21 фактический PASS metadata boundaries only (9+6+6), <0.4s, sampled RSS158464KiB. Два original-corruption сценария остаются pending genuine-helper reconstruction; authority/runtime/PG/browser не доказаны. Pythonv3 output copy исправляет полный shape-before-association порядок, ждёт review и исполнения. Live runtime исходники прежние, текущий стенд T81v11.

## Обновление 19.10 03:31 МСК — T85 проверки helpers, ресурсная предпроверка T83

T85 corrected native guard: фактический PASS33 применимых вызовов,1 явно неприменимый Python mapping-subclass. Повтор использовал отдельный builder с исправленным только construction ceiling68,000,023; продуктовые limits и frozen expected прежние. Первая RED попытка сохранена. Receipt `output/matrix-t85-20261019/native-guard-construction-v2-consumer/first-outcome.json`, SHA74df6f6eefc48ad68ca95b3d81902952716005674c17bc57a99cb815de0527cf. Local test-construction RSS602528KiB; это не продуктовая приёмка512MiB. Source-scope projection9/9 PASS, receipt `source-scope-projection-consumer/first-result.json`; authority/DB/runtime этим не доказаны. UI28 unit/SSR PASS остаются действующими; browser hold сохраняется.

T83 own-runtime isolation: первая предпроверка отказала ДО любых изменений и semantic вызовов. Обнаружены3 прежних StartedAt изменения у соседних review-candidates workers22:55/22:58Z; все20 ID/images точны,17 исторических StartedAt точны, все работают. Причина этих прежних рестартов не установлена; отсутствие OOM в ограниченном journal окне не доказывает его отсутствие. Исходный отказ сохранён. ROOT до нового исхода закрепил свежий20-container baseline и явную поправку17+3; проверяется отсутствие изменений во время нашего действия. Только6 собственных runtime roles временно останавливаются с восстановлением тех жеID/images, лимиты55CPU/60wall/512MiB и RAM gate1.5GiB прежние. Старый smoke-VLM исключён; отдельный вопрос пользователю без ответа. Фактический capacity исход ещё не получен. Стенд T81v11; T83 aggregate/T84/T85 runtime не приняты.

## Обновление 19.10 03:13 МСК — T85 unit/SSR и первый native RED

T85 output-only UI: frozen14 boundary vectors, первый фактический прогон22PASS/6FAIL нашёл три причины: нормализация checkId пробелами, принятие лишнего ключа scope, принятие лишнего ключа review. Отдельная исправленная копия `ui-draft-closed-scope` прошла28/28 (14unit+14React SSR), receipt `output/matrix-t85-20261019/ui-scope-boundary-consumer/closed-scope-unit-ssr-result.json`. Live UI не изменён, DOM/browser не исполнялся. Предыдущее static замечание про terminal-LF regex ошибочно: JavaScript без multiline не принял конечный LF; оно отозвано, исходный review сохранён.

Native guard: первый actual consumer завершился RED за7.312s, max sampled RSS616488KiB; причина `CLOSED_BUILDER_INPUT` в сборщике одного последующего сценария, не memory/cpu/wall gate. Предыдущие case-result сохранены; повтор не запускался. Receipt `output/matrix-t85-20261019/native-guard-independent-consumer/first-outcome.json` (19a93c32bb366da4d17aac8e5eecb3b62ae599424713a78c600aa801b2758949). Это отдельная local native проверка с заранее указанным test-construction budget, не ordinary-capacity доказательство.

T83 actual PostgreSQL3 PASS и cleanup0 остаются действующими. Remote capacity v4 не запускался, gate RAM последнего чтения ниже1.5GiB; вопрос о временной остановке старого smoke-VLM ещё без ответа, контейнеры не менялись. Стенд T81v11; T83 aggregate/T84 installation/T85 runtime не приняты. Browser hold сохраняется. Работа по v13 server/worker связи продолжается output-only.

## Обновление 19.10 03:03 МСК — T83 PostgreSQL принят локально

Свежий canonical-first actual PostgreSQL: 3/3 PASS, 1013.20 s, natural exit0. Подтверждены пять обычных графов по10 jobs, OCR unconfigured/output0, полные оригиналы139/32 страниц,14 новых native evidence; synthetic assertions, realQualifiedPairs0. Проверка после завершения: собственных QA DB0, процессов0; исходники до/после совпали. Receipt: `output/matrix-t83-20261018/canonical-optimized-requalification/actual-pg/qa-canonical-first-PASS-receipt.json` (4845f2ce100ddf9ae755d95a6a5821b10cba2c27532a35ecc784eba655ed99c9).

Capacity v4: заморожен текущий пакет196 entries/192runtime;18 local bootstrap selfchecks PASS; независимая финальная static review PASS. Actual remote semantic ещё НЕ запускался. Свежая read-only RAM-проверка00:00Z:1,440,680KiB, ниже неизменного порога1,572,864KiB. Прежний вопрос пользователю про временную остановку только старого smoke-VLM остаётся без ответа; контейнеры не менялись. T83 aggregate/T84 installation ещё НЕ приняты; текущий стенд T81v11. Browser security hold сохраняется.

T85: output-only UI draft и native/runtime drafts не считаются installed/runtime proof. Первоначальный static terminal-LF finding отозван после прямой проверки JavaScript; актуальные unit/SSR и native результаты приведены выше.

Дополнение 19.10 02:46 МСК: две узкие оптимизации canonical strings реализованы
в Python: тот же stdlib encoder и проверка surrogate регулярным выражением.
На неизменных 131 ручном векторе / 279 вызовах baseline 18.706s, candidate 6.431s;
это замер отдельных helpers на локальной машине. Независимый domain replay
13 методов PASS, полные прежние результаты и ошибки совпали. Новые wheel/sdist
вне checkout: по35 методов PASS; 167 модулей/25 ресурсов точны, остальные165
модулей и все прежние эталоны сохранены. Итоговые129 API-тестов, typecheck/build PASS.
Свежий actual PG3 canonical-first запущен19.10 02:39МСК и ещё выполняется;
исходники/тесты заморожены. Новая policy честно связывает новые2source pins.
После естественного завершения нужны новый capacity packet и ordinary homeserver
проверка с прежними55CPU/60wall/512MiB и RAM gate1.5GiB; прежний SSH255 остаётся
FAILED/UNKNOWN. T83/T84 пока не приняты, установлен T81v11. T85 подготовлены
15 полных wire-сценариев +3 CAS и43 дополнительных ручных вектора; runtime ещё
не подключён. Реальные qualified pairs0, browser hold сохраняется.

Дополнение 19.10 02:26МСК: LOCAL phase diagnostic PASS за38.849с CPU38.841с,
maxRSS277568KiB (271.06МиБ). Все11 frozen hashes и полные результаты совпали:
63 scalar/70 outputs/62 parameters/70 partial atoms/70 UNSUPPORTED, qualified0.
Это локальный Ryzen7940H, не приёмка homeserver. Первая remote SSH255 причина
UNKNOWN, повтор ниже memory gate не запускается. В работе только2 Python
canonical string leaves: fixed surrogate regex и тот же stdlib string encoder;
независимый before-code review PASS,131 ручной native vector заморожен.
До изменения выполняется baseline; затем те же vectors/domain/installed,
новая честная PG policy/capture и новый capacity packet с прежними лимитами.
T85 wire design принят до кода, runtime ещё не подключён. T83/T84 не приняты,
стенд T81v11; browser hold сохраняется. Лимиты и исторические эталоны прежние.

Текущий срез19.10 02:10МСК: actual PostgreSQL transcript-first завершён естественно:
3/3 PASS, пять immutable job graphs, исходники точны, временная БД удалена.
Первая ordinary-capacity попытка homeserver FAILED: SSH255, пустой вывод,
свой временный каталог удалён. Причина UNKNOWN; замеров времени/CPU/RSS нет.
Первый отказ сохранён; готовится отдельная наблюдаемая попытка с прежними
55CPU/60wall/512MiB. T83 не принят, T84 не установлен, стенд остаётся T81v11.
Метаданные homeserver: свободно1.30GiB (<1.5GiB gate), в ограниченном kernel
окне OOM записей не найдено; это не доказывает отсутствие OOM. T85 бетон стен:
pure TS/Python PASS; wire contract проходит независимую проверку до кода.

Предыдущий срез19.10 01:40МСК: Inspector v12 остаётся локальным кандидатом,
стенд T81v11. Новый operation-local full SELECT saved-read boundary прошёл
129 focused tests/typecheck/build/independent review; actual PG3 transcript-first
идёт, лимит55s прежний. Предыдущий actual2PASS/1RED сохранён (excluded
SOURCE_REVIEW_REFERENCE_CHANGED, не restored candidate; reapproval не достигнут).
Capacity и T84 установка ещё не выполнялись. T85 бетон стен: TS/Python pure
whole32/grammar14 PASS и read-only adapter plan; runtimefalse/realpairs0.

# Статус реализации

## Продолжение 18 октября 2026, T82 принят локально; T83 выполняется

T79 принят локально: полный large vertical source audit проходит очередь, PostgreSQL, storage/cache и UI. Реальные PDF: 139/32 страницы, 27522/10303 native строк; фактические 9 jobs, seal/reopen, 12 независимых PG/API методов, 174 UI-проверки, wheel/sdist PASS. [Приёмка T79](operations/MATRIX_T79_LARGE_VERTICAL_AUDIT_20261018.md), `output/matrix-t79-20261018/acceptance.json`. Source-only этап coverage не увеличивает.

T80 принят ROOT: 94 API-проверки, 19 независимых методов (9 PostgreSQL), сборка/typecheck и две установленные поставки worker PASS. Исторические v9/v10 сохраняют точные определения; новые запуски и запись результатов архивного runtime отклоняются, terminal replay сохранён. Отдельный v11 связывает текущий reader/wrapper. Приёмка `output/matrix-t80-20261018/acceptance.json`, SHA `507647353da092900a7d0b66dbb89edd2c14aa185b5d1536238bf7f2235e1986`.

T81 принят: обычный homeserver работает на v11. Три сверки по 761 историческому ответу совпали; семь новых проверок прошли 63 jobs, отдельный реальный большой audit сохранил полные 139/32 страницы после restart. Installed pins четырёх workers/API/web совпали; двадцать соседних контейнеров прежние. [Приёмка T81](operations/MATRIX_T81_STAND_LARGE_V11_20261018.md), SHA `efa434913fe1e0666c9e61d4f75fc415ead6e8436ad983f1db8f02c52102fffd`.

T82 принят локально: один v2 контракт для literal/native выбора размеров, строгий wire, независимые 32 полных эталона, append-only журнал и миграция 044. TS10/PY5, actual HTTP/PostgreSQL3, миграция PostgreSQL4, ROOT20 API, UI93, typecheck/build и wheel/sdist PASS. Приёмка `output/matrix-t82-20261018/acceptance.json`, SHA `e51e6a0aa28b19613cc7585b426c8a7673f924ef26ba2afb2252d7f2ae6db200`; [границы доказательства](operations/MATRIX_T82_COLUMN_PYLON_REVIEW_20261018.md). Код T82 ещё не установлен на стенд. Coverage 61/69/71, qualified real pairs 0, browser hold сохраняется.

T83 выполняется: typed KR-060 в обычном запуске с неизменяемым снимком последних пар и отдельнымv12. Pure TS/Python, SQL045, wrapper и установленные wheel/sdist по35 методов прошли. На полных139/32 оригиналах loader, Python70 outputs/coverage62-70-70 и положительный complete/seal прошли; saved-read67.978s и UNKNOWNseal69.528s дали настоящий RED по55s budget. ROOT убрал только повторный semantic replay C с полным свежим fingerprint данных/прав; независимые design/code review без подтверждённых дефектов, новые56/focused107/typecheck/build PASS. Реальный PostgreSQL повтор ещё нужен: ускорение и end-to-end не приняты. Сохранённый UI проверен unit/source/SSR, browser hold. [Текущие задачи](../output/matrix-t83-20261018/tasks.md).


## Продолжение 18 октября 2026, T78 принят; T79 выполняется

T78 принят ROOT: пять независимых PDF, полные реальные оригиналы 139/32 страницы, точные 274 строки контрольной страницы, actual TS/Python и установленные wheel/sdist PASS. [Доказательства T78](operations/MATRIX_T78_VERTICAL_SOURCE_20261018.md). Приёмка SHA `5e30dfbe14e8b854a455a368cef38f0245854ee544c74ab6792bc294b83a6d10`. Вертикальный текст восстановлен native whole-line анализом без ручной склейки символов.

T79: отдельный большой source audit интегрируется в API, очередь, PostgreSQL, cache и UI; независимые wire8 и owner9 прошли, isolated PostgreSQL и worker проверки продолжаются. Стенд T75 v10, 61/69/71; source-only код coverage не увеличивает. Реальные qualified pairs 0, browser hold. Работа продолжается без остановки между этапами.

## Продолжение 18 октября 2026, T77 принят; T78/T79 выполняются

T77 принят ROOT: actual TS6/Python6, полные источники 139/32 страницы и 6/0 исходных строк, full API/contracts typecheck и API build PASS. Wheel/sdist проверены вне checkout: по 160 модулей, 24 ресурса, QA6 и оба полных артефакта. Приёмка: `output/matrix-t77-20261018/acceptance.json`, SHA `c3b1ac426072904cdddfb8fcada64adba2f9f9ed30bf01da62b85b1d7631d7f4`. Это source-only извлечение; member/area authority не подтверждена, вероятность null, coverage не увеличена.

T78: независимые пять PDF и 12 проверок зафиксированы до кода; TS/Python предложения проходят приёмку. T79: архитектурный план полного HTTP/queue/cache/storage/UI пути готов; отдельный обработчик передачи прошёл первые 8 независимых проверок с границами 32M/1.5M/depth68. Runtime пока T75 v10, 61/69/71. Browser hold сохраняется. Работа продолжается без паузы между этапами.


## Проверенное продолжение 18 октября 2026, T76; T77–T79 продолжаются

T76 принят: новый explicit large-source reader/producer, 32M canonical bytes / 1.4M nodes, прежний default 8M/200k сохранён. Actual полные оригиналы: 139/32 страницы и 37064/15470 строк совпали целиком с прежними captures за исключением actual producer/profile identity; TS/Python whole hashes совпали. QA16 + 126 neighbors, actual installed wheel/sdist по 9 методов / 159 sources / 24 resources PASS. [Приёмка T76](operations/MATRIX_T76_LARGE_SOURCE_20261018.md). T77 source literals уже в TS/Python: actual 12 методов, оба текущих полных источника: 6/0, full API typecheck/build PASS; installed 160 proof продолжается. T78: пять authored original PDF и whole manual frozen before code, firstRED сохранён; TS proposal 6 PASS, PYproposal ещё впереди. T79 готовит explicit LARGE_VERTICAL HTTP/queue/cache/storage/UTF8 путь; старый SOURCE_AUDIT_V3 и текущий стенд не расширяются этим source-only кодом. Runtime остаётся принятый T75 v10 61/69/71; реальные qualified pairs 0; browser hold.

## Проверенное продолжение 18 октября 2026, T75

Обычный homeserver v10 принят ROOT: 7 FULL запусков / 63 SUCCEEDED jobs, 6 сценариев source/applicability review, restart семи ролей и три серии по 747 исторических HTTP-чтений PASS. Установленные API/worker/HTTP assets и 42 миграции точны; 20 соседних контейнеров сохранены. Активный стенд **61 параметр / 69 частичных атомов / 71 UNSUPPORTED**, реальные qualified pairs0, вероятность кандидатов null. [Приёмка T75](operations/MATRIX_T75_V10_STAND_20261018.md), `output/matrix-t75-20261018/acceptance.json`. Browser pending по прежнему security hold. Без паузы T76: actual large-source capacity, полные оригиналы 139/32 страницы, wheel/sdist; затем T77 исходные размеры колонн/пилонов. Новый reader меняет source pin, поэтому исторический config v10 не переименовывается и не принимается как новый.

## Проверенное продолжение 18 октября 2026, T73/T74

T73 полностью принят локально, включая actual offline installed wheel/sdist: по 9 Pilot v10, 9 release вызовов, 5 snapshots, 104 прежних вызова и два original PDF replay; 159 Python sources/24 resources точны. T74 UI принят: source/member mapping с исходными страницами, отдельный applicability журнал и immutable evidence; ROOT18 + independent14, итог с соседними workflows257/257, typecheck/build PASS. [T74](operations/MATRIX_T74_STEEL_UI_20261018.md). Сразу T75 ordinary homeserver rollout. Стенд пока v9 60/68/72; локальный v10 61/69/71; реальные qualified pairs0, calibratedProbability null. Browser pending по прежнему hold. Следом T76 source-linked KR060 foundation с адресной проверкой реальных оригиналов.

## Проверенное продолжение 18 октября 2026, T73

Локальное durable ядро v10 принято: 43 TS, 11 Python owner, 38 neighbors, 9 ROOT helper methods и independent actual PG3/3. Снимок последних pair decisions, stale exclusion без fallback, loader v6, original PDF checks, completion/seal/historical read/submission проверены. Typecheck/build PASS. 61 частично реализованный параметр / 69 атомов / 71 UNSUPPORTED в synthetic original-backed сценарии; реальные qualified pairs0. [Приёмка](operations/MATRIX_T73_STEEL_DURABLE_20261018.md), `output/matrix-t73-20261018/core-acceptance.json`. Стенд пока v9 60/68/72. T74 UI проходит независимую проверку; installed package и T75 rollout продолжаются, browser pending по hold.

## Проверенное продолжение 18 октября 2026, T72

Отдельный журнал применимости пары ПД/РД принят: 34 focused + независимые stable actual PG4/4, typecheck/build PASS. Свежие права перед replay, два source refs, пара CAS, отдельные projection/journal hashes, terminal historical withdrawal, latest-before-status и append-only проверены. [Приёмка](operations/MATRIX_T72_STEEL_APPLICABILITY_20261018.md), `output/matrix-t72-20261018/acceptance.json`. Без остановки T73: immutable run snapshot и ordinary durable v10; runtime стенда пока 60/68/72.

## Проверенное продолжение 18 октября 2026, T71

Source review стали подключён к API/PostgreSQL: сервер реконструирует exact old-producer snapshots из полного оригинального v2, поддерживает наследование, explicit empty withdrawal и общий CAS. Старые хеши при отсутствии поля сохранены. Independent actual PG5/5, focused18 и neighbors274, typecheck/build PASS; закрыт подтверждённый replay после отзыва доступа. [Приёмка](operations/MATRIX_T71_STEEL_SOURCE_REVIEW_20261018.md), `output/matrix-t71-20261018/acceptance.json`. Без паузы T72: отдельное authenticated решение о применимости конкретной пары, затем durable v10 и UI. Runtime стенда пока 60/68/72.

## Проверенное продолжение 18 октября 2026, T70

Typed KR-056 execution принят в TS/Python: шесть операций, 9 полных сценариев, 12 integrity-отказов и 3 null-registry отказа. Полные outputs совпали; installed wheel/sdist выполнили по 104 вызова и по два original-PDF replay. Найденный None/default дефект закрыт, первые RED сохранены. Синтетический кандидат имеет 13 evidence fragments, вероятность null; остальные 131 coverage строки точны. [Приёмка](operations/MATRIX_T70_STEEL_EXECUTION_20261018.md), `output/matrix-t70-20261018/acceptance.json`. Runtime стенда пока v9 60/68/72. Продолжается T71: authenticated source-review journal, серверная реконструкция snapshots и CAS; затем pair applicability и durable execution.

## Проверенное продолжение 18 октября 2026, T69

KR-056 pure comparison принят в TS/Python: 33 полных примера и 35 вызовов в каждом языке, точное совпадение результатов, входы неизменны. Actual offline wheel/sdist и два синтетических оригинальных PDF воспроизведены вне проекта. Поддержан только явный С345/С245 для согласованной физической конструкции с отдельным решением о применимости; CANDIDATE/null. 631 прежний файл сохранён, первый RED и эталоны неизменны. [Приёмка](operations/MATRIX_T69_STEEL_COMPARISON_20261018.md), `output/matrix-t69-20261018/acceptance.json`. Стенд v9 пока 60/68/72; без паузы T70 typed execution и durable review/loader.

## Проверенное продолжение 18 октября 2026, T67–T68 на стенде

На обычном homeserver принят v9: **60 параметров / 68 частичных атомов / 72 UNSUPPORTED**. Настоящий HTTP и очередь: 36 заданий, 36 попыток, один source audit и три обычные проверки. Кандидат, отзыв с ABSTAIN, восстановленный кандидат; native evidence 2/0/2, вероятность null. После restart семи ролей новые три matrix/submission ответа побайтно неизменны. Сохранены прежние 66 выбранных snapshots, 203 targets, 132 legacy targets, одно review, FAILED response, полные v3 artifacts и 20 прочих контейнеров. Установленные API/worker файлы и HTTP web assets совпали с freeze. T68: 55 новых тестов, 359 регрессий, 32 проверки confidence после исправления пояснения; typecheck и production build PASS. Реальных квалифицированных пар 0; browser pending по прежнему hold. [Приёмка](operations/MATRIX_T67_T68_V9_20261018.md), `output/matrix-t67-20261018/acceptance.json`. Goal active; сразу T69 KR-056: существующие steel declarations, явная привязка конструкции и отдельная проверка применимости пары.

## Проверенное продолжение 18 октября 2026, T65–T67

T65 typed освещение принято: 48 методов, 14 полных операций TS/Python, installed wheel/sdist 23 ресурса. T66 source audit и append-only разметка приняты: 57 boundary/neighbor, 2 public route, 4 PostgreSQL сценария. [T65](operations/MATRIX_T65_TYPED_LIGHTING_20261018.md), [T66](operations/MATRIX_T66_LIGHTING_REVIEW_20261018.md).

T67 actual v9 локально: пять typed пакетов плюс scalar engine, независимые PG3/3 PASS, 60 параметров / 68 частичных атомов / 72 UNSUPPORTED. Подмена исходников, отзыв/восстановление, исторические чтения и reopen проверены. Полный стенд пока T62:59/67/73, реальные квалифицированные пары0. Продолжаются installed-package проверка, transport checks, T68 UI и установка на feedback стенд. Confidence-v2 строго >80% готова; без калибровки выводы остаются кандидатами. OCR CPU benchmark на трёх реальных страницах завершён; ошибки повёрнутых размеров запрещают повышать достоверность чисел. Browser pending по прежнему security hold.

## Проверенное продолжение 18 октября 2026, T64

Принят pure directed ZU-130 comparator TS/Python поверх полного originalv3: только ПДLED заменён вРД наFLUORESCENT/INCANDESCENT, разные оригинальныеSHA, явное physical-position mapping и frozen reviewed electrical scope.39whole outputs/lang,36methods, installed33+6outputs иAPItypecheck/buildPASS; всеRED сохранены,937pins. Кандидат/null, реальныйF0161UNBOUND; runtime/coverage59/67/73 прежние. [T64](operations/MATRIX_T64_LIGHTING_COMPARISON_20261018.md), output/matrix-t64-20261018/acceptance.json. Без паузы T65 typed execution, затем review/v3loader/v9runtime/UI. Параллельно strict>80confidence-v2.

## Проверенное продолжение 18 октября 2026, T63

Принят pure full-v3 lighting source consumer в TS/Python: точные raw/native paths, lossless grammar view/codepoint ranges,3явных типа света, named/group scope. Independent139methodsPASS,30whole manual output/hash parity, actualauthenticatedreal38 и installedwheel/sdist31whole+8guards/22resourcesPASS; APItypecheck/build/webtypecheckPASS. Три guard дефекта закрыты с сохранением первого RED.922pins/895старых+разрешённыйtypeexport. РеальныйF0161 остаётся LED/UNBOUND/null/UNVERIFIED;coverage59/67/73 прежнее. [T63](operations/MATRIX_T63_LIGHTING_V3_SOURCE_20261018.md), output/matrix-t63-20261018/acceptance.json. Сразу T64: направленное сравнение именованных позиций ПД/РД, затем durable integration.

## Проверенное продолжение 18 октября 2026, T62

На обычном homeserver установлен durable source-audit v3: полный original PDF, immutable artifact/cache, authenticated full-source endpoint и поиск по raw native paths. Реальный F0161:38pages/4207located/2unlocated; новый явный stable traversal устранил process-specific grouping порядок, старые profiles/artifacts сохранены. Installedwheel/sdist+fencedHTTP, independent39+35PY/81TS, root20API/6PG, typecheck/buildPASS. После установки и restart7ролей66snapshots/203targets/132legacy/1review/FAILED bytes и оба полных v3 artifacts сохранены;20прочихконтейнеров прежние. Coverage59/67/73,qualified0/nullprobability. Browser pending по hold. [T62](operations/MATRIX_T62_DURABLE_TEXT_V3_20261018.md), output/matrix-t62-stable-20261018/acceptance.json. Сразу T63: разбор явных технологий освещения поверх полного оригинального v3, затем directed ZU-130 comparison.

## Проверенное продолжение 18 октября 2026, T61

Принят явный analyzed-Form профиль v3 с полными native paths. 74 TS/36 Python/26 neighbors, 53 whole reader cases/lang, пять новых whole original replays, installed wheel/sdist17originals/9expected refusals/22resources PASS. Полный реальный F0161:38pages/4207located/2unlocated, whole TS/PY hash parity. Стандартный профиль прежний. 873pins,855из859 прежних сохранены, изменены четыре разрешённых файла. Исходный текст внутри Form может быть скрыт renderer clipping: видимость/полнота/уверенность не подтверждены. Runtime и coverage59/67/73 прежние,qualified0/null. [T61](operations/MATRIX_T61_FORM_TEXT_PROFILE_20261018.md), output/matrix-t61-20261018/acceptance.json. Без паузы T62: отдельный durable source-audit профиль v3/cache/admission/PG/UI, далее явные v3 consumers и lighting comparison.

## Проверенное продолжение 18 октября 2026, T60

Принята pure foundation `document-text-v3`: полные raw строки, located/unlocated каналы, точная десятичная геометрия, полный профиль/hash и независимые readers. 61 TS/25 Python/26 neighbors, 40 whole reader cases, 11PDF/14pages и installed wheel/sdist PASS. 859pins; из828 прежних изменён только разрешённый type-only export. Полный F0161 пока честно `UNSUPPORTED_TEXT_LAYOUT` на вложенном Form страницы13; artifact не создан, runtime не обновлён. Coverage59/67/73, qualified0/null прежние. [T60](operations/MATRIX_T60_DOCUMENT_TEXT_V3_20261018.md), output/matrix-t60-20261018/acceptance.json. Без паузы T61: явный analyzed-Form профиль с полными native paths; затем durable API/cache/UI и lighting comparison.

## Проверенное продолжение 18 октября 2026, T59

Принят source-only repair нулевой native text geometry.26 QA+14 root methods,36 old/new full artifacts,12PDF/13pages tripleparity, installed wheel/sdist5originals/22resources и cache MISS/HIT PASS.828pins, прежние817primary+2dependencies сохранены. ПолныйF0161 честно FAILED: настоящие положительные строки высотой0.00012pt нельзя представить milli-point. RED и correction rootoracle сохранены; рамки не подменены. Runtime не обновлён до следующего v3 канала raw unlocated text. Coverage59/67/73 прежнее,qualified0/null. [T59](operations/MATRIX_T59_TEXT_GEOMETRY_20261018.md), output/matrix-t59-20261018/acceptance.json. Без паузы T60: located/unlocated fullartifact с durable audit и явным consumer gate, далее lightingcomparison.

## Проверенное продолжение 18 октября 2026, T58

Принят source-only извлекатель явного типа света в TS/Python.12 авторских PDF/13pages; TS60tests/Python14methods с43wholecases, neighbors367/224,45wholeoutput/hash parity и installedwheel/sdist22resources PASS; workspace typecheck/build PASS.817pins/780 прежних сохранены. Полный реальныйF0161 дал честныйABSTAIN: текущий producer испускает2нулевые рамки на других страницах. Первоначальный semanticoracle/RED сохранён, валидаторы не ослаблены. Coverage59/67/73 прежнее, runtime ещё не подключён. [T58](operations/MATRIX_T58_LIGHTING_SOURCE_20261018.md), output/matrix-t58-20261018/acceptance.json. Без паузы T59: исправить общий text-layer geometryproducer, затем directed ZU-130 comparator.

## Проверенное продолжение 18 октября 2026, T57

Приняты точные source-declared заметки о системе координат, высот и масштабе рядом с preview геопривязки. Реальный PDF13: две строки/три заметки/три точных перехода; содержание исключено, недостающая line geometry не подменяется block bbox. Authority SOURCE_DECLARED_UNVERIFIED, probabilitynull, arithmetic T55 прежняя. Web933PASS/72files, independent31+53neighbors, typecheck/buildPASS. После web-only restart66snapshots/203targets/132legacy/1review/FAILED bytes сохранены;6backend+20containers прежние. Coverage59/67/73 прежнее. [T57](operations/MATRIX_T57_COORDINATE_REFERENCE_NOTES_20261018.md), output/matrix-t57-20261018/acceptance.json. Browser pending по существующему hold. Сразу T58: буквальные типы источников света, затем направленное сравнение ZU-130.

## Проверенное продолжение 18 октября 2026, T56

Принято read-only объяснение сохранённых решений выбранного scalar факта: source revision/approval/section/link, current/historical binding, контексты/table/PZ pointer и точный переход ID+SHA. Saved result и latest decision отдельно; UNKNOWN/NOT_CHECKED не повышаются. Web902PASS/70files, independent63included, typecheck/buildPASS. ActualHTTP15real+8controlled views/23callbacks, после web-only restart66snapshots/203targets/132legacy/1review/FAILED bytes сохранены;6backend+20containers прежние. Coverage59/67/73, realqualified0/nullprobability прежние. [T56](operations/MATRIX_T56_STORED_FACT_REVIEW_20261018.md), output/matrix-t56-20261018/acceptance.json. Browser pending по существующему hold; сразу T57 exact-page source-declared coordinate reference notes.

## Проверенное продолжение 18 октября2026, T55

Предварительная привязка к напечатанным координатам реализована и проверена на полном реальном ПЗУ18страниц, PDF13. Отдельный authenticated stateless preview,3FIT+1HOLDOUT; ошибка0.0113173761067 в явно заявленных единицах, strict0.005ABSTAIN. Никакой независимой геодезической authority, probabilitynull/facts[]. API3874PASS, web832PASS, actualPG129PASS/44files; typecheck/buildPASS. API/web установлены и перезапущены на обычном homeserver;66snapshots/203oldtargets/132legacy/1review/FAILED bytes сохранены. Coverage59/67/73 прежнее. [T55](operations/MATRIX_T55_REAL_COORDINATE_DRAFT_20261018.md), output/matrix-t55-20261018/acceptance.json. Browser pending по действующему hold; немедленно T56 source-review explanation.

## Проверенное продолжение 18 октября 2026, T53

Backend v8 сравнения вводного узла ХВС принят на обычном homeserver RTX2080SUPER.59параметров с67частичными атомами,73UNSUPPORTED из132; это техническое покрытие, не полнота параметров. API3831PASS/141skip, worker2401PASS/17skip, actualPostgreSQL127PASS/43files/0skip, installedwheel/sdist22ресурса, typecheck/buildPASS. Контрольный цикл0/1/0/1 кандидатов и15originalfragments; реальный CHK-66354F71:161страница/15facts/63scalar/4unbound,qualified0,sourceapprovalUNKNOWN,probabilitynull. После окончательного restart65snapshots/203targets/132legacy/1review/FAILED сохранены;20другихконтейнеров иweb прежние. [T53](operations/MATRIX_T53_WATER_NODE_EXECUTION_20261018.md), `output/matrix-t53-20261018/acceptance.json`; browser pending по существующему security hold. Без паузы T54: исходные листы, явная разметка узла и просмотр15фрагментов вUI.

## Проверенное продолжение 18 октября 2026, T52

Принят отдельный pure comparator ZU-129 для именованного общедомового вводного узла ХВС.40 whole comparison+8review outputs совпали PY/TS; installed package,72TSfocused/576neighbors,166PYmethods,12independentprobes и typecheck/build PASS. Проверяются все retained origins и claims до выбора identity/approval, затем явные ZU/IOS2/link/mapping/completeness. Результат только CANDIDATE/null probability. Coverage58/66/74 пока прежнее: runtime не подключён. [T52](operations/MATRIX_T52_WATER_NODE_COMPARISON_20261018.md), `output/matrix-t52-20261018/acceptance.json`. Сразу T53: server review/materialization/loader/pinned execution и feedback-стенд.

## Проверенное продолжение 18 октября 2026, T51

Отдельное чтение буквального состава общедомового вводного узла ХВС принято source-only.20 независимых authored PDF,53 whole goldens и хеши совпали в PY/TS; installed wheel+sdist PASS. API3682PASS/134skip, worker2365PASS/17skip, typecheck/build PASS.653 прежних pins сохранены. Это foundation частичного ZU-129, runtime dispatch/coverage58/66/74 не менялись, реальных qualified pairs0. [T51](operations/MATRIX_T51_WATER_NODE_SOURCE_20261018.md), `output/matrix-t51-20261018/acceptance.json`. Без паузы T52: отдельное сравнение явно согласованных составов ПД/РД; manual projections и ожидаемые complete outputs до comparator code.

## Проверенное продолжение 18 октября 2026, T50

Фильтры наличия исходных фактов и stable optional sort внедрены на feedback web. По умолчанию63 результата в прежнем порядке;2 имеют факты обеих стадий,4 одной,57 без фактов. Неподтверждённые ссылки видны при каждом фильтре. Общий source chooser требует явный current ID+SHA, не назначает пару/стадию/approval.

Web686PASS/60files, focused83PASS, typecheck/buildPASS; actual13GET+8pureSSRviews сохранили матрицу/submission/targets/files. Обновлён только web,6 прочих ролей и20 других контейнеров прежние;60snapshots/203targets/132legacy/1review/FAILED run сохранены. Backend принят05:16UTC; browser pending, DOM/bundle не исполнены. Машинное покрытие58/66/74 и calibrated probabilitynull неизменны. [T50](operations/MATRIX_T50_REVIEW_PRIORITY_20261018.md), `output/matrix-t50-20261018/acceptance.json`. Без паузы выполняется T51: отдельная source grammar cold-water inlet-node по независимым authored PDF/full-artifact goldens; новый coverage пока не присваивается.

## Проверенное продолжение 18 октября 2026, T48–T49

T48 подтвердил свежий реальный v7 запуск CHK-5752877C из полных F0106/F0139:161страница/15facts/63scalar results/15targets. T49 добавил явный read-only поиск по всему сохранённому исходному тексту и открытие точной строки на PDF. ActualHTTP до/после restart подтвердил все139+22 страницы, исходные raw строки и геометрию2PNG. Отдельный full-source read budget устранил404 большого документа; review command limits и machine profiles не менялись.

T49: API3611PASS/131skip, web633PASS, actual PostgreSQL120PASS/41files/0skip; typecheck/build PASS. API/outbox/web обновлены на обычном homeserver RTX2080SUPER;60snapshots/203oldtargets/132legacytargets/1localreview/failedrun сохранены,4worker и20другихконтейнеров прежние. Backend принят; browser pending по действующему security hold, unit/SSR/HTTP не заменяют browser. Coverage58/66/74, scalar55/63/77, realqualified0/approvalUNKNOWN/calibrated probabilitynull прежние. [T49](operations/MATRIX_T49_SOURCE_TEXT_20261018.md), `output/matrix-t49-20261018/acceptance.json`. Немедленно выполняется [T50](operations/MATRIX_T50_REVIEW_PRIORITY_20261018.md): фильтры наличия фактов и явная навигация к исходникам.

## Проверенное продолжение 18 октября 2026, T47

На обычном homeserver принят backend T47: scalar fact targets доступны для конечных профилей v1–v7, исторические адреса сохраняются без replay сегодняшнего engine. Очередь отказов открывает точный исходный факт, правило и источник по ID+SHA; подтверждения инспектора автоматически не выставляются. API3605PASS/131skip, web591PASS, actual PostgreSQL117PASS/40files/0skip, typecheck/build PASS. После обновления и restart сохранены59 запусков,203 текущих target responses,132 legacy targets,1local review и failed-run bytes. Полный реальный пакет161страница/15facts проверен через HTTP, source approval UNKNOWN, qualified0.

Машинное покрытие T46 не расширялось:58параметров/66частичных атомов/74UNSUPPORTED из132, scalar55/63/77; полнота целого параметра не утверждается. Геопривязка и calibrated probability не подтверждены. Браузерная приёмка остаётся pending по существующему security hold; API/SSR её не заменяют. Детали и receipt: [T47](operations/MATRIX_T47_IMPLEMENTATION_20261018.md), `output/matrix-t47-20261018/acceptance.json`. Без паузы выполняется [T48](operations/MATRIX_T48_REAL_V7_20261018.md): свежий полный реальный v7 запуск с независимой проверкой всех15 адресов фактов.

Базовый аудит выполнен 17 сентября 2026 на commit `8200a03`; backend-срез identity/durable commands зафиксирован 18 сентября в `a85047f`, authoritative finalization — в `a93bc99`, отзыв и canonical JSON artifacts — в `303e22e`. B07 продолжен коммитами `4f72350` (durable jobs/outbox/relay), `b568f54` (heartbeat/cancellation), `770f502` (relay health/metrics), `ac30f70` (persisted stage dependencies), `7ab4015` (terminal failure propagation), `cbe0998` (PDF text-layer artifacts), `50e0985` (page text-layer qualification) и `967b327` (provider-neutral analysis scaffold). Основание — [аудит](AUDIT_REPORT_2026-09-17.md), включая исходные команды и ограничения окружения.

## Локальное продолжение после аудита

В текущем рабочем дереве закрыта первая часть этапа достоверности G0:

- проверки новых объектов имеют явный режим `NORMAL` и больше не получают публичные seed-находки учебного объекта;
- normal-run асинхронно завершается честным состоянием `PARTIAL`: durable worker сохраняет 132 строки coverage со статусом `UNSUPPORTED`, findings отсутствуют; финальный PARTIAL-протокол допускается только с явным подтверждением точного текущего gaps hash и текстовым основанием;
- добавлен `GET /api/checks/{id}/coverage` с полным ledger из 132 параметров;
- submission normal-run с неподдержанными правилами остаётся заблокированным как `INCOMPLETE_ANALYSIS`; PARTIAL-протокол не считается полной приёмкой;
- синтетические `117` отрицательных результатов и проценты confidence удалены; неизвестный confidence возвращается как `null`;
- demo seed имеет отдельный режим `DEMO_SEED` и помечается в UI как публичный пример, а не inference новых документов;
- текущий legacy/internal API сведён в один исполняемый реестр: 29 операций задают path/query/body, ответы и фактические ошибки;
- Fastify использует этот реестр для request validation и response serialization, а `/api/openapi.json` строится из него же;
- contract-тест проверяет все операции, обязательные path-параметры, разрешение `$ref` и документирование статусов реальных HTTP-запросов;
- Fastify и ingest переведены с конкретного `InspectorStore` на async repository contract;
- добавлена forward migration `002_domain_core.sql` и отдельный rollback reference: organization/object scope, inspections, immutable manifests, runs, coverage, rule/review/protocol core, FK/unique/check constraints и append-only triggers;
- при наличии `DATABASE_URL` server использует PostgreSQL для новых normal objects/uploads/manifests/runs/coverage, а `DEMO_SEED` остаётся в изолированном memory-adapter;
- PostgreSQL-adapter использует транзакции, inspection lock при запуске, DB-level hash deduplication и атомарно создаёт `QUEUED` run, provider-neutral persisted DAG `ANALYSIS_INVENTORY → DOCUMENT_TEXT_LAYER → DOCUMENT_RENDER → DOCUMENT_METADATA → DOCUMENT_LINKING → ENTITY_EXTRACTION → RULE_EVALUATION → EVIDENCE_VALIDATION → ANALYSIS_SEAL_UNSUPPORTED` и root `job.ready`/`analysis.started` outbox events; `DOCUMENT_OCR_LAYOUT` вставляется между render и metadata только при наличии страниц `OCR_REQUIRED` (для legacy v1 — консервативно для всех страниц);
- migration `006_durable_jobs_outbox.sql` добавляет `analysis_jobs`, immutable history попыток и transactional `domain_outbox` с lease/fence/retry/lock состояниями; rollback reference хранится отдельно;
- внутренние claim/input/heartbeat/complete/fail endpoints защищены worker token, проверяют capability, OPEN active-run scope, attempt и fencing token; input download дополнительно ограничен source из immutable manifest и не раскрывает storage key; каждый non-seal complete одной транзакцией сохраняет результат, `stage.finished`, активирует child и пишет downstream `job.ready`; seal complete сохраняет `PARTIAL` run и `analysis.sealed`;
- отдельный `outbox-relay` публикует persistent messages с RabbitMQ publisher confirms, восстанавливает зависшие outbox locks, просроченные leases и due retries; topology явно содержит durable `rules.evaluate`, `documents.render`, `documents.extract`, `documents.link` и соответствующие DLQ;
- relay экспортирует внутренние DB-backed `/health` и Prometheus `/metrics`: outbox rows/lag/retries, job states/age и expired attempts; Compose worker ждёт healthy relay;
- workers валидируют envelope `1.0`, получают lease через API и ack-ают RabbitMQ message только после durable complete/fail ответа; отдельный document worker потоково скачивает manifest PDF, сверяет byte size/SHA-256 и извлекает существующий text layer с целочисленной page/block geometry через `pdfminer.six`; `text-layer-quality-v1` детерминированно делит страницы на `TEXT_LAYER_CANDIDATE` и `OCR_REQUIRED`, не называя первый статус доказанной пригодностью; неизвестный envelope dead-letter-ится;
- worker запускает отдельный heartbeat loop с default-интервалом 20 секунд; потеря lease, terminal job или недоступный control plane останавливают дальнейший result commit;
- migration `007_job_attempt_cancellation.sql` сохраняет cancellation attempt отдельно от worker failure; heartbeat отменяет текущие job/attempt при закрытом inspection, заменённом active run или terminal run, а поздний complete остаётся без эффекта;
- migration `008_analysis_job_dag.sql` добавляет `BLOCKED`, тип inventory job, persisted dependency table и независимую последовательность event versions analysis run; отдельный rollback отказывается удалять схему при наличии DAG-данных;
- migration `009_document_text_layer.sql` добавляет `DOCUMENT_TEXT_LAYER` и append-only `analysis_text_artifacts`; API канонизирует и повторно проверяет provenance, geometry и совокупный лимит 8 MiB, сам рассчитывает content hash/byte size и сохраняет полный JSON artifact, оставляя в job result только компактные refs;
- migration `010_document_text_quality.sql` расширяет schema discriminator до `document-text-v2`, сохраняя v1 rows; v2 содержит page metrics, reason codes и summary, которые API полностью пересчитывает из принятых блоков перед commit;
- migration `011_analysis_pipeline_scaffold.sql` добавляет оставшиеся job types и append-only `analysis_stage_artifacts`; незаполненные provider/policy slots принимают только точный `analysis-stage-result-v1` с нулевым output и явными dispositions, поэтому orchestration завершается честным `PARTIAL` без синтетических OCR/metadata/entities/rules/evidence;
- migration `012_analysis_release_manifests.sql` добавляет immutable `analysis_releases`, backfill legacy release IDs и FK от runs/jobs; новый scaffold release канонизируется и хешируется API, фиксирует запрет внешней сети и все provider slots как `UNCONFIGURED`, а claim передаёт worker только slot текущей stage;
- два полных Docker overlay `laptop`/`server` поднимают application stack и выбранные provider runtimes: PostgreSQL 17 + pgvector 0.8.6, PaddleOCR/PDFium document sidecar, checksum-locked Qwen model store, sentence-transformers CPU embeddings, Bonsai/llama.cpp на laptop и Qwen3-VL-8B/vLLM на одном H100; init-контейнеры отделены от internal runtime network, model volumes read-only, base images digest-pinned, secrets генерируются в profile-specific env, server имеет GPU admission/ordered startup, launcher делает hardware preflight, а smoke проверяет render/OCR/VLM/embedding и deny-egress; H100-профиль требует реального smoke/soak, а stage adapters ещё не подключены;
- terminal worker failure под тем же inspection/run lock каскадно переводит незавершённых descendants в `CANCELLED` с `PREREQUISITE_FAILED`, завершает run как `FAILED` и пишет versioned `stage.finished`; transient failure сохраняет `BLOCKED` descendants и использует серверный retry schedule;
- PostgreSQL integration test поднимает отдельную временную БД, применяет `001`–`012`, проверяет immutable release manifest и stage-specific slots, полный provider-neutral DAG, отсутствие OCR-job для полностью кандидатного v2 text layer, динамическую OCR-вершину для legacy/неоценённых страниц, blocked claim, fenced input download, immutable manifest refs, отказ для неверной geometry и поддельной quality metric, серверные artifact hashes/schema discriminators, DB-level append-only, compact job results, atomic child activation/outbox, transient retry, terminal descendant cancellation, worker auth/capability, heartbeat, idempotent complete, stale fence после lease expiry, stale-scope cancellation, reconnect, durable coverage и запрет изменения sealed run;
- исправлены две найденные integration-test гонки: повторный concurrent start после ожидания lock теперь возвращает действующий run, а обрыв idle `pg.Pool` соединений при рестарте БД больше не завершает API-процесс; безопасные read-запросы имеют ограниченный retry только для connection/admin-shutdown ошибок.
- PostgreSQL-adapter читает сохранённые rule/review rows, последнее append-only решение и версии протокола в organization scope; integration test подтверждает их сохранность после принудительного reconnect и запрет UPDATE для decisions/protocols;
- JSON export протокола возвращает сохранённый snapshot, а не пересобирает старую версию из изменившихся findings; demo draft также проверен на неизменяемость;
- legacy `author` больше не считается доверенной личностью: demo использует явного `Демо-инспектор`, а NORMAL-команда получает actor только из серверной сессии;
- отдельная expand migration `003_identity_scope_audit.sql` добавляет users, organization/object memberships, только hashed session/CSRF tokens, command receipts и append-only audit events; миграция не содержит seed credentials и имеет отдельный destructive rollback reference.
- добавлены login/session/logout с opaque session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` по environment), отдельным CSRF token, scrypt password verifier и rate limit входа; БД хранит только хеши session/CSRF tokens;
- чтение отдельного NORMAL finding скрыто object scope, а решение требует organization capability `REVIEW_DECIDE`, object permissions `READ`+`REVIEW_DECIDE`, CSRF, `If-Match` и `Idempotency-Key`;
- authoritative review command блокирует inspection → active sealed run → review item, проверяет evidence fingerprint, пишет append-only decision, immutable receipt и hash-chained audit в одной транзакции; actor/timestamp задаёт сервер;
- replay того же command key возвращает сохранённый ответ до stale-version проверки, смена payload даёт `409`, stale ETag — `412`; конкурентный тест двух инспекторов подтверждает один commit и один `412` без lost update.
- operator CLI создаёт/ротирует локального пользователя и назначает organization/object scope транзакционно; пароль и его hash не печатаются, повторное provision увеличивает `auth_version` и инвалидирует прежние сессии.
- все текущие legacy GET для NORMAL object/upload/check/findings/coverage/protocol/submission проверяют серверную сессию и активный object membership с `READ`; отсутствие сессии даёт `401`, чужой или отозванный scope скрывается как `404`, а публичный `DEMO_SEED` остаётся доступен отдельно;
- список объектов без сессии содержит только demo; сессия с недействительным token не понижает запрос до анонимного, а возвращает `401`;
- create NORMAL-object требует сессию, CSRF, `Idempotency-Key` и роль инспектора/руководителя либо явную `OBJECT_CREATE`; объект, inspection, membership создателя с `READ/UPLOAD/RUN/REVIEW_DECIDE/FINALIZE`, command receipt и hash-chained audit записываются одной транзакцией;
- upload/start/reprocess NORMAL-команды требуют `Idempotency-Key`; повтор с тем же содержимым возвращает прежний upload/object/run с `Idempotency-Replayed`, а несовместимое повторное использование ключа отклоняется. Регистрация upload либо run, receipt и audit атомарны в PostgreSQL;
- upload/start/reprocess/finalize NORMAL-маршруты требуют сессию, CSRF, операционную роль/явную capability и соответствующий object permission; PostgreSQL повторно проверяет `UPLOAD`/`RUN` внутри mutation-транзакции, а `FINALIZE` — перед предметным gate;
- authoritative finalize блокирует inspection → active run → review items, проверяет `If-Match`, exact decision-set hash, отсутствие pending decisions и evidence fingerprints; для `PARTIAL` дополнительно требует exact gaps hash и явное основание;
- immutable protocol snapshot, его внешний `snapshotHash`, durable command receipt и hash-chained audit создаются одной PostgreSQL-транзакцией; повтор с тем же ключом возвращает прежний протокол до stale-version проверки, другой payload конфликтует, а новый finalize после закрытия inspection запрещён;
- `POST /api/protocols/{id}/revoke` требует роль `SUPERVISOR`/`ADMIN`, object permission `REVOKE`, CSRF, `If-Match` и `Idempotency-Key`; одной транзакцией сохраняет append-only причину, переводит прежний FINAL во внешнее состояние `REVOKED`, открывает inspection и создаёт новый DRAFT с lineage на неизменяемый snapshot/hash;
- migration `004_protocol_revocations.sql` применена к текущему Compose volume; integration test подтверждает stale-version отказ, replay/conflict, ровно одну запись revocation/receipt/audit, неизменность старого hash и запрет UPDATE записи отзыва;
- web-экран протокола показывает отозванную версию, причину и новый черновик; форма отзыва видна только руководителю/администратору, а сервер отдельно повторно проверяет object scope;
- migration `005_protocol_canonical_artifacts.sql` добавляет append-only artifact точных `inspector-c14n-v1` JSON bytes; FINAL и созданный отзывом DRAFT сохраняют artifact/hash в той же транзакции, scoped download отдаёт сохранённые bytes с ETag и `X-Content-SHA256`;
- integration test сравнивает canonical bytes до/после отзыва, проверяет hash, отдельный artifact нового DRAFT и DB-level запрет UPDATE; web показывает download сохранённого snapshot отдельно от динамического envelope `/export`;
- единый migration runner применяет все нумерованные SQL-файлы под PostgreSQL advisory lock, хранит checksum в `schema_migrations`, распознаёт полностью установленную legacy-схему и fail-closed отклоняет partial install или изменённый уже применённый SQL;
- Compose запускает отдельный одноразовый `migrate` перед API, поэтому и новый, и существующий volume проходят один gate при каждом deployment; ошибка миграции блокирует старт API;
- после schema gate выполняется идемпотентный bounded backfill canonical artifacts старых протоколов: JSON заново канонизируется, точные bytes хешируются и вставляются только при совпадении с неизменяемым `snapshot_hash`; integration test подтверждает backfill bytes/hash и повторный no-op;
- web-клиент использует реальную server session: экран профиля выполняет login/logout, показывает полученного от API пользователя, а не статического actor, и после смены сессии заново загружает доступный object scope;
- все текущие web-mutations отправляют CSRF из отдельного cookie, включая JSON-команды и multipart upload; create/upload/start дополнительно получают отдельный command key, а неавторизованные create/upload entry points переводят пользователя на экран входа;
- runtime/OpenAPI-контракт дополнен фактическими session/CSRF/403/404/503 вариантами для scoped маршрутов; PostgreSQL integration test проходит полную read-матрицу для anonymous, authorized, out-of-scope и запрещённой ML-роли.

Проверено локально: `npm run check` (38 API-тестов, 4 PostgreSQL-теста штатно пропущены без отдельного URL; 8 web-тестов; 21 worker Python-тест и provider unit tests; typecheck и production build); `laptop` и `server` проходят `docker compose config`. Provider suite теперь проверяет exact-size download/import, exact model/Paddle cache inventory, raster limits, text runtime и server GPU admission. Отдельный `test:postgres` ранее прошёл 4/4 и на временной БД применил `001`–`012` тем же runner. Lightweight model-store и GPU-admission images собираются и исполняют lock/budget validation. Тяжёлые Paddle, sentence-transformers, Bonsai/vLLM images и inference с реальными весами в этом срезе не запускались: preflight корректно блокирует текущий host с менее 20 GiB свободного диска. Поэтому full provider smoke реализован, но на этом host не выполнен. Новый extractor smoke на реальном 32-страничном PDF ранее создал `document-text-v2` artifact на 157088 bytes: text layer найден на 31 странице, 31 получила `TEXT_LAYER_CANDIDATE`, одна — `OCR_REQUIRED`. Существующий Compose volume остаётся на `009`; миграции `010`–`012` и полный RabbitMQ smoke в этом срезе на нём не запускались. Provider-neutral job со статусом `SUCCEEDED` означает только принятый stage-disposition artifact, а не выполненный inference. B05 остаётся частичным: admin UI/API отсутствуют. B07 остаётся частичным до stage adapters, реальных page render/OCR/link/rules/evidence outputs, chunked artifact commit, явной отмены jobs из domain commands и alert rules/runbook. В B15 ещё не реализованы compensation delivery/jobs при отзыве, protocol render/PDF, полный состав секций/ревизий источников/шаблона/подписей и gates незавершённых upload/jobs. Event schemas пока runtime-only, generated client отсутствует.

## Что есть

- React-прототип пользовательского пути: объекты, загрузка, сводка, карточки, решения, протоколы и каталог.
- Node.js/Fastify API, импорт каталога 132 параметров и десяти публичных примеров.
- Реальный streaming ingest: SHA-256, проверка расширения/MIME/сигнатуры, ClamAV fail-closed, дедупликация, immutable bytes в local/S3 storage; дополнительные проверки DOCX/XML.
- Python workers с PDF text-layer extraction, versioned page qualification, детерминированным сравнением переданных значений, abstention при недостаточных данных и durable claim/complete/fail protocol.
- SQL-схема и Docker Compose с migration gate, PostgreSQL, RabbitMQ, outbox relay, rules worker и document worker.
- Переносимые Docker overlays `laptop`/`server`: полное приложение, pgvector, PaddleOCR/PDFium, VLM, embeddings/reranker, model provisioners, internal inference network и online/offline runbook.
- Автоматические тесты компонентов/API/worker и изображения отдельных страниц для демонстрационного viewer.

## Существенные ограничения

| Область | Фактическое поведение |
|---|---|
| Новый анализ | Seed больше не переносится. PDF text layer извлекается, сохраняется и постранично квалифицируется. Профиль по умолчанию `SCAFFOLD` даёт `PARTIAL` и 132 `UNSUPPORTED`. Изолированный пилот `PILOT_PZ002_PZ017` исполняет два ограниченных правила и на проверенных F0150/F0201 дал 130 `UNSUPPORTED`, две `PARTIAL`, 0 findings. Render/link/evidence stages и полный OCR остаются незаполненными либо ограниченными пилотом. |
| API contract | Текущие 29 legacy/internal операций связаны с каноническими runtime/OpenAPI-схемами; целевой `/api/v1`, выделенные event schemas и generated client ещё отсутствуют |
| Persistence | Normal objects/uploads/manifests/runs/coverage, review decision, finalize и revoke commands, а также чтение сохранённых review/decision/protocol snapshots имеют PostgreSQL-adapter; versioned migration gate обновляет fresh/existing Compose volume и восстанавливает проверяемые canonical artifacts старых протоколов. Migration/reconnect/restart, concurrent review и command replay для этих срезов пройдены. Без `DATABASE_URL` остаётся memory fallback |
| Worker integration | Локально доказан полный persisted provider-neutral DAG: dependencies хранятся в PostgreSQL, OCR-job создаётся только при необходимости, child до prerequisite имеет `BLOCKED`, complete атомарно сохраняет immutable text/stage artifact и активирует следующий job через outbox, а terminal failure каскадно отменяет descendants. V2 page qualification и обе OCR-ветки проверены PostgreSQL integration, но не повторным полным RabbitMQ smoke. Heartbeat/fence защищают commit; relay отдаёт backlog/lag/job/retry/expiry metrics. Реальные providers для render/OCR/link/rules/evidence, chunked artifact commit, явная domain-command cancellation и alert rules/runbook ещё отсутствуют |
| Coverage/confidence | Ledger содержит все 132 позиции: `SCAFFOLD` показывает 132 `UNSUPPORTED`, протестированный пилот — 130 `UNSUPPORTED` и две `PARTIAL`. Ни один пилотный вывод не объявлен полной отрицательной проверкой; калиброванный confidence отсутствует. |
| Finalization/protocol | JSON finalize транзакционно создаёт immutable snapshot, canonical JSON bytes, durable receipt и audit. Revoke сохраняет append-only причину, открывает inspection и создаёт lineage-DRAFT с собственным artifact, не меняя старый FINAL/hash/bytes. Ещё нужны отмена/компенсация delivery/jobs, protocol render/PDF outbox flow, полный состав snapshot, gates незавершённых работ и безопасный перенос решений при reprocess |
| Viewer | Для загруженного PDF доступны оригинал, проверенный по SHA полноформатный лист и увеличенный фрагмент вокруг неклассифицированного геометрического предложения. Есть просмотр источников и отдельная история решений по предложениям. Полная привязка evidence, редакций и классов элементов ещё не реализована. |
| Дозагрузка | UI-путь не обеспечивает требуемое продолжение текущей проверки с безопасным переносом решений |
| Identity/audit | Все текущие NORMAL HTTP reads скрыты server session + object `READ`; mutations дополнительно требуют CSRF, role/capability и object permission. Create/upload/start/reprocess, review, finalize и revoke имеют durable command receipt и transactional hash-chained audit; review/finalize/revoke защищены `If-Match`. Aggregate concurrency остальных команд и admin UI/API ещё отсутствуют |
| Submission | Schema участников найдена и закреплена; официальный scorer/matching отсутствуют. Локальный scorer v1 реализован, текущий export после review не является независимым прогнозом |
| Ingest readiness | Нужны structural PDF validation и согласованный proxy/API лимит для крупных загрузок |
| ML/эксплуатация | Оба provider runtime-профиля упакованы, но adapters к stage contracts, configured release manifest, реальный CUDA/OCR/VLM inference smoke, GOLD/model gate, измеренные quality/SLO, recovery и ИАИС не подтверждены |

Это работающая демонстрационная основа и частичный ingest, а не готовый автоматический инспектор на 132 параметра. Сильные стороны сохранены; исправления перечислены в [плане реализации](architecture/12_DELIVERY_AND_ACCEPTANCE.md).

## Проверки при аудите

`npm ci --ignore-scripts`, TypeScript checks, 18 API-тестов, 5 web-тестов, 4 Python-теста и отдельная production build прошли; `npm audit` показал 0 уязвимостей на момент аудита. Это не доказывает предметную точность, полноту ТЗ или отсутствие других дефектов.

Общий `npm run check` в Windows остановился на shell-синтаксисе `PYTHONPATH=...`; Python-тесты запускались отдельно. Docker CLI в окружении отсутствовал, Compose end-to-end не проверен. История точных команд — в разделе 10 аудита. При подготовке архитектуры эти тесты повторно не запускались, поскольку код не менялся.

## Дальше

Точка входа — [ARCHITECTURE](ARCHITECTURE.md). Перед объявлением функции реализованной обновить этот статус ссылкой на принятый B-item, фактический тест/артефакт и ограничение покрытия. Не переносить формулировки из целевой спецификации в раздел «работает» без проверки.

## Проверка с локальной моделью на homeserver, 24 сентября 2026

На RTX 2080 SUPER запущена закреплённая Bonsai 2 27B. Исходные PDF из `TRAIN_PUBLIC` сверены с manifest по размеру и SHA-256; три контрольные пары страниц прошли отдельный локальный текстовый model probe. Во всех трёх Bonsai вернула `INSUFFICIENT_EVIDENCE` при положительной публичной разметке, поэтому предметная полнота пока не доказана. Одностраничный vision-probe на реальном листе дал неверно прочитанные термины. Подробности и отчёты — в [homeserver smoke](operations/HOMESERVER_SMOKE.md).

На той же тестовой машине основной API/worker/outbox DAG обработал две пары исходных PDF: 177+36 и 177+676 страниц; recovery после истечения lease проверен фактической повторной доставкой. Последний run завершился за 404 секунды в лимите 2 GiB для document-worker. Итоги остались `PARTIAL`, все 132 параметра `UNSUPPORTED`, findings отсутствуют. Локальная модель пока не подключена к stage adapters/release manifest. Эти прогоны доказывают ingest, durable orchestration и inference endpoint по отдельности; они не являются полной сквозной ML-проверкой. H100-профиль и его производительность не запускались.

25 сентября 2026 локальная квалификационная цепочка впервые проверена одним процессом на исходных `TRAIN_PUBLIC` PDF: manifest SHA → text layer → PDFium render → PaddleOCR → Bonsai → дословные цитаты/проверка OCR bbox → отчёт с публичной меткой после inference. Добавлен лёгкий `homeserver` OCR-профиль без tables/orientation, отдельный Compose для уже provisioned моделей и offline cache verification. На `F0201` p.50 OCR восстановил 122 строки при почти пустом text layer; HTTP-ответ уменьшен примерно с 280 МБ до 27,7 КБ после исправления сериализации PaddleX. На трёх известных положительных кейсах Bonsai вернула `INSUFFICIENT_EVIDENCE`; модельные результаты остаются `NOT_ACCEPTED_PROBE_ONLY`. Это рабочий provider/evaluation path, но номера листов задаёт публичная метка, а приложение всё ещё не вызывает модели из своих stage adapters. Полные команды, измерения и ограничения: [локальный model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

В тот же профиль подключена CPU Qwen3-Embedding-0.6B с offline проверкой 10 артефактов. Независимый поиск по всем 889 страницам трёх исходных TRAIN_PUBLIC PDF обработал 73 кандидата за 1000,55 с. Шесть публично подтверждённых листов сохранились среди кандидатов, но заняли позиции ПД/РД 3/3, 5/5 и 3/13: top-1 поиск ошибся во всех трёх кейсах. На шести выбранных top-1 листах затем выполнены live OCR и Bonsai. Выбранные листы не совпали с публичной парой (0/6); два ответа `INSUFFICIENT_EVIDENCE`, один JSON обрезан лимитом 512 токенов, в двух отказах все 7 цитат привязаны к исходному text layer/OCR. Локальные модели технически работают, но текущие linking/retrieval policy, сравнение и CPU-время не проходят предметный gate. Этот отдельный smoke не меняет `SCAFFOLD` release или 132 `UNSUPPORTED` основного приложения. Методика и отчёты — в [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На том же `TRAIN_PUBLIC` дополнительная Qwen3-VL-4B Q4 локально распознала подпись и графический контур тёплого пола на ПД для помещений `267/270` и не нашла аналогичный контур в изолированных областях РД; соседнее `277` прошло отрицательный контроль после отдельного crop. OCR при 200 dpi подтвердил подпись ПД и маркировку радиатора РД. Это первый **локальный визуальный кандидат** по двум публичным примерам, сохранённый только как `NOT_ACCEPTED_PROBE_ONLY`: листы/области выбраны вручную, на общем crop модель ошиблась в привязке к соседнему помещению, а полный поиск отсутствующего элемента и stage adapters ещё не реализованы. В [model probe](operations/LOCAL_MODEL_PROBE_20260925.md) записаны SHA, ответы, отрицательный контроль и границы результата.

Структурный отбор страниц на тех же трёх публичных парах поднял нужные листы в top-1 для 4/6 этапов, в top-2 для 5/6 и в top-6 для 6/6. Он использует признаки схемы/плана и раздела документа до чтения публичного ответа; результат пока offline probe, а не часть основного DAG. Следующий локальный gate на homeserver — автоматическая локализация комнаты и выносок в top-6, визуальное сравнение Qwen3-VL-4B с OCR/text layer и проверяемый evidence bundle. H100 доступен только при финальной проверке организаторов; до неё производительность и качество измеряются на RTX 2080 SUPER. Подробности в [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На следующем локальном опыте `TRAIN-0002`–`0005` структурный поиск поставил нужный лист ПД первым в 4/4 проверках, лист РД — на местах 2/1/1/1. Автоматический поиск комнаты на ПД выделил четыре замкнутые области; внутри всех четырёх цветовой детектор и Qwen3-VL-4B увидели красно-синий контур. Без текстовой подсказки модель полностью прочла подпись группы лишь в 2/4 ответах; номер нужно независимо сверять с text layer/OCR. Соседняя комната `277` дала отрицательный сигнал детектора, модель воздержалась. Это помещения одной пары документов. В РД строгий поиск границ не сработал, поэтому отсутствие элемента и предметный finding не подтверждены. Оба скрипта остаются отдельными `NOT_ACCEPTED_PROBE_ONLY`; основной release всё ещё `SCAFFOLD/UNCONFIGURED`, 132 параметра `UNSUPPORTED`. Отчёты и команды: [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

На другом публичном кейсе `TRAIN-0001` локатор создал 10 crops из 12 top-6 кандидатов, но не нашёл замкнутую комнату ни на одном: вентиляционный лист содержит открытую схему с выносками. Для этой ветки нужен отдельный поиск связи оборудования с помещением. Подробности: [model probe](operations/LOCAL_MODEL_PROBE_20260925.md).

Проверен состав доступной обучающей разметки: 30 286 автоматических боксов описывают текстовые поля, подтверждённых evidence-аннотаций только 20, открытых проверок 15 на двух объектах. Поэтому следующий ML-опыт — небольшой детектор символов с ручной разметкой и объектно изолированной оценкой; полноразмерное дообучение VLM пока не имеет надёжной предметной выборки. [Решение и критерии опыта](operations/DRAWING_MODEL_TRAINING_DECISION.md).

Независимый [аудит TRAIN_PUBLIC-разметки](operations/TRAIN_PUBLIC_ANNOTATION_AUDIT_20260925.md) проверил все 30 318 строк структурно и визуально все 20 gold/12 second-review рамок: gold обозначает номера помещений или область листа, не контуры инженерных элементов. Из 1112 автоматических рамок за пределами страницы часть объясняется нестандартным MediaBox/CropBox, часть остаётся непригодной для обучения без ручной проверки. Подготовка обучающих меток символов остаётся отдельной работой.

## Офлайн-пилот маршрута и PZ-002, 26 сентября 2026

В worker добавлен отдельный воспроизводимый пилот для открытых `TRAIN_PUBLIC` PDF: SHA/размер по `document_manifest.jsonl`, `document-text-v2`, подбор листов по атомарному правилу, локальный OCR только для страниц `OCR_REQUIRED`, извлечение общей площади здания, `Decimal`-сравнение ПД/РД и локаторы evidence с раздельными PDF/OCR координатами. Неизвестная редакция, согласование, смешанная стадия, иной объект, подменённый хеш/значение/единица, неполный OCR-поиск и неустановленная связь источников дают abstention. `NEGATIVE_VERIFIED` отключён до достоверной проверки полного scope. Проверка: 47 Python-тестов; Docker build/CLI; два синтетических PDF через реальное извлечение текста дали кандидат при 100/102 м². Подробности и команды — [пилот](operations/PARAMETER_ROUTING_PILOT_20260926.md).

На момент первого офлайн-пилота это ещё не было подключено к normal-run API. Этот исторический статус изменён последующими работами ниже: исходные конкурсные `TRAIN_PUBLIC` PDF проверены на homeserver, durable PZ-002 и локальный OCR запущены. Предметная точность и H100 по-прежнему не заявляются.

Для подключения downstream stages добавлен внутренний `GET /api/internal/v1/jobs/:id/text-artifacts/:sourceFileId`: API отдаёт сохранённый canonical JSON `document-text-v1/v2` только по действующему lease/fencing token и source из immutable manifest того же run, сверяя размер, SHA-256 содержимого и SHA-256 исходного PDF. Worker-клиент дополнительно проверяет заголовки, байты и схему `document-text-v2`. На предыдущем срезе прошли TypeScript typecheck, 38 API unit tests, 4 PostgreSQL integration tests и 50 Python tests. В следующем срезе этот клиент подключён к пилотному правилу; `SCAFFOLD` по-прежнему не создаёт предметных выводов.

## Опциональный durable-пилот PZ-002, 26 сентября 2026

Для новых NORMAL-run добавлен opt-in `INSPECTOR_ANALYSIS_PROFILE=PILOT_PZ002`. API фиксирует отдельный immutable `DRAFT` release с хешем определений правила; worker получает их только через lease, читает уже сохранённые `document-text-v2` по действующему fencing token, при необходимости обращается к локальному document-ai за OCR и исполняет PZ-002 без чтения публичных меток. Миграция `013_pilot_rule_results.sql` разрешает append-only ненулевой rule artifact и статус coverage `PARTIAL`. Seal сохраняет один `rule_results` для PZ-002, 131 `UNSUPPORTED` и PZ-002 `PARTIAL`. Обычный `SCAFFOLD` остаётся режимом по умолчанию и регрессией проверен.

Миграция `014_source_review_snapshots.sql` добавила append-only решения инспектора об актуальности, согласовании, связи источников и стадии смешанных PDF. Аутентифицированный `POST/GET /api/objects/:id/files/:sourceFileId/source-review` проверяет object scope, SHA исходного файла, CSRF и idempotency. Новый run фиксирует хеш выбранного решения в manifest, а lease получает неизменяемый snapshot. Позднее изменение решения не меняет уже запущенную проверку.

API независимо проверяет `CANDIDATE` PZ-002: перечитывает все сохранённые блоки `document-text-v2`, требует ровно одно значение площади в ПД и РД, две актуальные согласованные редакции с общей группой связи, совпадение локаторов, единиц, fingerprint и превышение строго 1%. Только такой текстовый кандидат создаёт `rule_results` и `review_items` и появляется в `/api/checks/:id/findings` со статусом `CANDIDATE`; решение принимает инспектор. OCR-кандидаты durable worker переводит в `CLARIFICATION_REQUIRED` с сохранением локаторов: серверной независимой проверки рендера и строк OCR ещё нет. Неподтверждённые источники дают abstention. `NEGATIVE_VERIFIED` отключён до достоверной проверки полного scope. Это не доказанная точность на конкурсных документах и не завершённая проверка всех 132 параметров; visual, metadata/linking/entity/evidence adapters и 131 другое правило остаются открытыми.

Добавлен второй путь извлечения PZ-002 для строк таблицы, где подпись, единица и значение находятся в разных text blocks. Worker повторно разбирает только найденные маршрутом страницы исходного PDF, требует совпадения всех блоков с immutable `document-text-v2`, сохраняет три строковых локатора и отказывается от неоднозначной строки. Для автоматического `CANDIDATE` дополнительно требуется отдельный локальный OCR того же листа, который видит ту же подпись и число на одной строке; без него правило воздерживается. API повторяет проверки текстовых ячеек, OCR-строк и fingerprint. Бюджеты `PZ002_MAX_TABLE_PAGES` и `PZ002_MAX_TABLE_OCR_PAGES` не скрывают непроверенные страницы. OCR-бюджет также направляется на страницы около предметных попаданий с чередованием релевантных стадий. Полный run на homeserver `CHK-1E3D8D30` сохранил два факта с исходных `TRAIN_PUBLIC` F0150/F0201, 10/10 jobs завершились, но `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`, 0 findings. Run `CHK-71B5BB7B` проверил новый порядок OCR внутри штатного DAG: выбраны F0150 p.29 и F0201 p.9, новых фактов нет, 10/10 jobs `SUCCEEDED`, два исходных факта сохранены. В `CHK-A9C2743D` штатный worker выполнил дополнительный OCR F0150 p.26 и сохранил подтверждение строки с hash артефакта; 10/10 jobs `SUCCEEDED`, итог по правилу остался `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`, 0 findings. Подробности — [журнал homeserver](operations/HOMESERVER_SMOKE.md#строка-таблицы-в-полном-durable-прогоне).

Во время длинного DOCUMENT_TEXT_LAYER RabbitMQ прекращал соединение после пропущенного AMQP heartbeat. Consumer вынес вычисление из потока Pika и возвращает подтверждение сообщения через `add_callback_threadsafe`. На homeserver повторный полный `CHK-B93E6F4C` сохранил тот же hash rule artifact, 10/10 jobs завершились с одной попытки; у document/rules worker перезапусков не было. Это локальный RTX 2080 SUPER smoke, а не проверка стенда H100.

Проверено локально: PostgreSQL integration на временной PostgreSQL 17 (миграции через `014`, отказ поддельному кандидату, полный второй run с двумя источниками и finding через API), отдельные unit tests серверной проверки, Python worker tests, `npm run check`, оба Compose config и сборка API/worker/web Docker-образов с закреплёнными base digest. После этой локальной проверки выполнен отдельный прогон на homeserver, описанный ниже. Производительность H100 не проверялась.

## Офлайн-проверка шаблонного поиска на чертежах, 26 сентября 2026

На homeserver выполнен [воспроизводимый поиск по растровым шаблонам и векторной геометрии PDF](operations/DRAWING_TEMPLATE_PROBE_20260926.md) на трёх сверенных `TRAIN_PUBLIC` PDF. Собрана экспериментальная хешированная библиотека из трёх образцов; поиск с ней выдаёт тот же список кандидатов, что и исследовательский режим, без чтения разметки. На F0202 p.17–18 найдены все четыре отмеченных радиатора: векторная проверка поддержала 68/69 растровых предложений, отдельный векторный локатор предложил 79 областей. На вентиляционном F0201 p.18 из 71 растрового предложения ни одно не прошло геометрическую проверку; векторный локатор также выдал 0. Спиральный шаблон на F0171 p.99 нашёл две отмеченные области, одна из них исходная. Локальная Qwen3-VL-4B ошибочно назвала похожий воздуховод радиатором; этот пример сохранён как регрессия и остаётся abstention. Это проверка локатора, а не полные precision/recall: известные области не исчерпывают лист и относятся к одному объекту. `NORMAL`, coverage и findings этим кодом не меняются; обучение модели не запускалось.

Для 79 векторных предложений собран и сохранён [пакет просмотра](../datasets/templates/experimental-public-v1/review/review-index.json): пять контактных страниц, ID, координаты, SHA исходного PDF, отчёта и изображений. Все 79 фрагментов просмотрены визуально; они похожи на радиаторы PRADO, но статус остаётся `UNREVIEWED` до независимой проверки. Генератор отвергает закрытый split, чужой PDF и невалидную геометрию. Это подготавливает оценку качества, не выпускает детектор в `NORMAL`.

На всех 36 страницах F0202 тот же векторный локатор дал 138 предложений: 58 на p.16, 54 на p.17, 25 на p.18 и одно на p.20; остальные страницы без предложений. Все 138 фрагментов собраны в десять контактных страниц и визуально просмотрены. p.20 — прибор PRADO на схеме; автоматической связи с помещением у этого фрагмента нет. Совпадение координат трёх пакетов с полным отчётом и SHA всех изображений проверены.

Три PDF второго открытого объекта извлечены из архива и сверены с manifest. На F0122 (70 страниц) шаблон из F0202 дал одно визуально ложное предложение на красной трубе с арматурой; на F0131 (21) и F0132 (77) — 0. Локальная Qwen3-VL-4B тоже ошибочно назвала трубу радиатором. Для такого переноса режим визуальной проверки возвращает `ABSTAIN_CROSS_OBJECT_STYLE_UNVERIFIED`, несмотря на согласие двух сигналов. Это не позволяет объявить библиотеку переносимой между объектами. Двенадцать focused Python tests прошли на homeserver; локальный Python не имеет `cv2`, поэтому тесты зависимостей запускались в изолированном remote venv. Полной независимой разметки нет, результаты не являются precision/recall или основанием для изменения coverage.

Добавлен офлайн-срез [связи кандидата с выноской](operations/DRAWING_TEMPLATE_PROBE_20260926.md#связь-с-выноской-первый-исполняемый-срез): на homeserver локальные OCR и геометрия синей линии связали семь выбранных предложений F0202 p.17 с конкретной строкой PRADO и моделью; восьмой, со схемы p.20, остановлен `ABSTAIN_NO_LEADER`. Это `REVIEW_REQUIRED`, без комнаты и без вывода ПД/РД. Скрипт отвергает библиотеку другого объекта до OCR. Пять новых unit tests прошли локально. В durable `NORMAL` адаптер пока не подключён; полнота листа, ошибка связи с помещением и качество на независимом объекте не измерены.

После точечной проверки выполнен [полный офлайн-прогон F0202 p.17](operations/DRAWING_ROOM_LINK_PROBE_20260926.md): 54 геометрических предложения, 43 связи с OCR-выноской, 21 кандидат чёрного номера группы помещения для review. Из 21 кандидата создан хешированный пакет просмотра. Отдельный OCR четырёх красных окружностей после удаления их штриха прочитал `233.1`, `233.2`, `234.1`, `234.2`; геометрия и луч через перегородки предложили точный подномер для 8 приборов, остальные 46 остановлены. Создан пакет восьми фрагментов с SHA и статусом `UNREVIEWED`. Для кандидата 76 растровая маска пропустила стену; проверка двух параллельных чёрных векторных линий PDF исключила соседнее `234.1`, оставив `234.2` для review. Это не измеряет precision/recall: нет независимой полной разметки и переноса на другой стиль. ПД/РД по найденным приборам ещё не сопоставляются; `NORMAL`, coverage и findings не меняются.

Следующий полный лист F0202 p.18 прошёл тот же локатор и локальный OCR выносок: 25 геометрических предложений, 24 связи с PRADO и 14 кандидатов чёрной группы помещения. Для 14 собран хешированный пакет карточек, все `UNREVIEWED`. Две красные окружности содержат целые `254` и `256`, их OCR выделен отдельным режимом `integer`; оба номера слишком далеко от ближайших кандидатов для автоматической связи. Чёрные группы p.18 визуально правдоподобны, но точный `room_id` не принят. Пакет восьми подномеров p.17 теперь воспроизводится отдельным генератором с повторной проверкой SHA исходных crop. Детали и ограничения — в [протоколе комнат](operations/DRAWING_ROOM_LINK_PROBE_20260926.md).

Добавлен [fail-closed оценщик локатора](operations/DRAWING_EVALUATION_GATE_20260926.md) с проверкой полного человеческого review выбранных листов, SHA входов и максимальным одно-к-одному сопоставлением рамок. На homeserver повторный F0202 p.17–18 дал 79 предложений, независимый F0122 p.45 — одно; оба отчёта честно вернули `NOT_ESTIMABLE`, потому что полные листы ещё не размечены человеком. Семь focused tests проверили отказ для неполной разметки, скрытого split, подменённых кандидатов и SHA, а также учёт дублей/пропусков. Для всех трёх листов создан хешированный обзор с нанесёнными рамками предложений; три теста генератора прошли на homeserver. Локатор и оценщик остаются offline: durable visual stage, review в API, предметная точность и H100 пока не подтверждены.

## Реальный durable-прогон PZ-002, 26 сентября 2026

Изолированный homeserver smoke-проект переключён на `PILOT_PZ002`, миграции `013/014` применены, web/API/worker пересобраны. Лимит исходного PDF повышен до 100 MiB согласованно в контракте, API, ClamAV и web proxy после реального HTTP 413 на 62 364 734-байтном F0150. Через пользовательский API загружены два проверенных исходных `TRAIN_PUBLIC` документа одного объекта: F0150 (ПД) и F0201 (смешанный РД/ИД). Run `CHK-64A1D37B` завершил 10 jobs с `SUCCEEDED`, сохранил ненулевой артефакт PZ-002, результат `PARTIAL` с 131 `UNSUPPORTED` и одной `PARTIAL` строкой, 0 findings. Отсутствие finding не считается отрицательным результатом: 398 страниц помечены для OCR, а основная таблица ПД разбита на отдельные текстовые блоки. Подробности, команды и ограничения — в [журнале homeserver](operations/HOMESERVER_SMOKE.md#durable-pz-002-на-проверенных-исходных-документах-26-сентября).

По проверенным PDF создан [пакет просмотра общей площади](../output/pz002-public-review-20260926/review.json): F0150 p.26 — 11 618,27 м²; F0201 p.14 — 11 030,3 м²; предварительная разница 587,97 м² (около 5,06%). Статус пакета `MEASUREMENT_PREVIEW_ONLY`. Стадия конкретного листа смешанного F0201, редакции, согласование и связь двух источников не подтверждены; в публичных контрольных проверках нет PZ-002. Это не доказанное нарушение и не метрика точности. Геометрическая привязка ячеек таблицы и независимая серверная проверка OCR остаются открытыми.

После подключения внутреннего локального `document-ai` повторный immutable run `CHK-673B2639` также завершил 10/10 jobs успешно. В `RULE_EVALUATION` сохранены 1 текстовый факт РД, 2 OCR-артефакта для первых страниц ПД, 396 отложенных OCR-страниц, итог `MISSING_EVIDENCE/REQUIRED_STAGE_FACT_MISSING`, 0 findings. Целевой офлайн-OCR F0150 p.26 и F0201 p.14 распознал оба значения на изображениях; полные отчёты приложены к пакету просмотра. В этом историческом run привязки трёх ячеек таблицы и целевого порядка OCR ещё не было; новый результат описан выше.

Экран результатов NORMAL-run теперь ведёт к проверке исходных документов. Инспектор видит список файлов и SHA, скачивает исходный PDF, вносит основанное на документе решение о редакции, согласовании, связи файлов и стадии страниц смешанного РД/ИД, затем запускает новый immutable run. Для уже загруженного РД или ИД доступна привязка второй стадии через интерфейс: браузер перед отправкой сверяет размер и SHA-256 выбранного PDF с оригиналом. API возвращает права `upload/review/run` для конкретного объекта, экран показывает действия по ним. Серверные маршруты списка и загрузки оригинала проверяют READ-scope; PostgreSQL integration покрывает файл, статус решения, права на действия и чужой объект. На homeserver через web proxy скачан и сверен по SHA-256 полный F0201 (43 033 348 байт); тестовый reviewer с `SOURCE_REVIEW` получил 409 на неверный hash, решение не сохранилось. F0201 зарегистрирован также как ИД по тому же SHA без нового source ID, но **постраничная классификация и статусы документов ещё не утверждены**. Локально прошли `npm run check` и 5 PostgreSQL integration tests. Порядок воспроизведения — в [журнале homeserver](operations/HOMESERVER_SMOKE.md#проверка-исходных-файлов-в-приложении-26-сентября-2026).

Новый run `CHK-9E8EF1CD` после регистрации двух стадий завершил 10/10 jobs с первой попытки и сохранил `STAGE_SEGMENTATION_REQUIRED`: пока 676 страниц F0201 не размечены человеком, правило не относит их к РД и не создаёт finding. Headless Chrome проверил реальный экран с двумя файлами и полем постраничной стадии; [скриншот](../output/pz002-public-review-20260926/source-review-ui-20260926.png). Итог остаётся `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings; H100 не проверялся.

Затем [самостоятельно проверен F0201](operations/F0201_SOURCE_AUDIT_20260926.md) по открытому manifest, текстовому слою и изображению p.14. Сохранено append-only решение для 9 подтверждённых страниц РД и 667 `UNRESOLVED`; редакция, согласование и связь с ПД оставлены неизвестными. Контракт, API, интерфейс, маршрутизатор и независимый verifier поддерживают такую неполную карту без догадок о стадии остальных листов. Финальный повторный `CHK-4672F74B` после пересборки worker завершил 10/10 jobs с первой попытки, нашёл предметный текст на подтверждённой p.14 и сохранил `CLARIFICATION_REQUIRED/REVISION_UNRESOLVED`: `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. 303 из 305 OCR-страниц текущего scope отложены. Положительного заключения о нарушении ещё нет.

Отдельный браузерный тест добавления второй стадии через UI выполнен на новом smoke-объекте `OBJ-FA65BC97` с исходным F0201 только как РД. Первый полный run `CHK-7C1FC2DC` завершился `PARTIAL` с 131 `UNSUPPORTED` + PZ-002 `PARTIAL`. Браузер выбрал тот же 43 033 348-байтный PDF, проверил размер/SHA-256 и загрузил как ИД; сервер сохранил один источник с тем же ID `FIL-B50EA8B8`. Повторная загрузка оригинала прошла SHA-проверку, решение о редакции/согласовании осталось отсутствующим (`404`). [Скриншот UI после операции](../output/pz002-public-review-20260926/source-stage-upload-ui-20260926.png). Это проверяет связь стадий через UI, но не подтверждает классификацию страниц человеком.

## Визуальные предложения в durable run, 26 сентября 2026

В пилотных release подключён `ENTITY_EXTRACTION`: worker сверяет исходный PDF по SHA-256, ищет ограниченное число геометрических областей и сохраняет append-only артефакт `VISUAL_PROPOSAL_SCAN`. Сервер сверяет идентификаторы, SHA, число страниц, координаты и профиль с immutable manifest. Артефакт не содержит finding или покрытия. Текущий профиль v4 просматривает все страницы PDF до 1024 включительно; для большего файла выбирает 1024 детерминированных страницы и явно записывает непросмотренные. На один файл сохраняется не более 500 предложений. v4 отдельно сохраняет подсказку о разделе из первых двух титульных страниц; она не классифицирует найденные области. Исторические v1 (`SKIPPED_PAGE_LIMIT`), v2 (выборка 64 листов) и v3 (полный проход без подсказки) доступны через тот же API. `NORMAL` без пилотного профиля не получил неподтверждённых выводов.

На homeserver изолированный run `CHK-7B010C54` для проверенного `TRAIN_PUBLIC` F0202 (36 страниц) завершил 10 jobs, сохранил 160 **неклассифицированных** предложений, `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. API читает сохранённый результат по праву доступа к объекту. Экран показывает предложения и исходный лист PDF с рамкой выбранной области; сервер перед рендером повторно сверяет байты оригинала. [Снимок просмотра листа 17](../output/f0202-visual-proposals-20260926/preview.png). Браузерный smoke проверил загрузку изображения и положение рамки внутри листа. Этот метод соответствует конкретному красно-синему векторному стилю F0202 и не доказывает класс прибора, полноту листа, precision/recall или отсутствие элемента. Подробности и команды — в [homeserver smoke](operations/HOMESERVER_SMOKE.md#durable-визуальные-предложения-на-f0202-26-сентября).

Историческая регрессия v1 на F0150 + F0201 (`CHK-5C362232`) завершилась `PARTIAL` с прежними 131 `UNSUPPORTED` и одной `PARTIAL`, без findings. Визуальный артефакт v1 записал `SKIPPED_PAGE_LIMIT` для обоих источников (614 и 676 страниц, по 0 просмотренных листов и предложений).

После перехода на v2 повторный immutable run `CHK-BECA7EB7` завершил 10/10 jobs за 488 с: `PARTIAL`, 131 `UNSUPPORTED`, одна `PARTIAL`, 0 findings. Артефакт `4fb2134b-facc-450e-a92a-b932246383da` (SHA-256 `446a35d8791440c63a89f7896db31144ed2dd811f888df238c7a26c8fe9ceaf6`) показывает `PARTIALLY_SCANNED_PAGE_LIMIT`: просмотрены 64 из 614 страниц F0150 и 64 из 676 F0201; 550 и 612 страниц соответственно не проверялись. На выбранных листах метод не нашёл геометрических предложений. Это измерение **не** доказывает отсутствия приборов: метод привязан к красно-синему векторному стилю F0202. API smoke проверил оба источника и manifest, браузер показал границу выборки [на экране объекта](../output/large-source-visual-v2-20260927/ui.png).

Полный v3 run `CHK-3D6C7BB3` после отдельного обновления `extract-worker` завершил 10/10 jobs за 552 с: `PARTIAL`, 131 `UNSUPPORTED`, PZ-002 `PARTIAL`, 0 findings. Артефакт `89f0737b-7518-4c98-94a8-08fbc37b0438` (SHA-256 `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436`) сохранил `SCANNED` на всех 614 страницах F0150 и 676 страницах F0201. Найдено 2 геометрических совпадения на F0150 p.566 и 20 на F0201 p.31, 34–39 — те же количества, что при отдельном полном диагностическом проходе. Примеры являются геологическим разрезом и вентиляционными схемами, а не доказанными отопительными приборами. API проверил оба публичных исходника, preview PNG и отсутствие findings; браузер открыл [F0150 p.566](../output/large-source-visual-v3-20260927/f0150-page-566.png) и [F0201 p.36](../output/large-source-visual-v3-20260927/f0201-page-36.png). Первый v3 run `CHK-F5FD7782` остался `FAILED` из-за старого образа `extract-worker`; исправление и повтор описаны в [журнале](operations/HOMESERVER_SMOKE.md#durable-визуальные-предложения-на-f0202-26-сентября). Полнота по страницам не равна полноте обнаружения элементов: нужны другие стили локатора, контекст листа и независимая разметка целых листов.

Для предложений добавлена отдельная append-only история решений инспектора (`KEEP_FOR_REVIEW`, `REJECT`, `UNSURE`). Запись требует права на объект, CSRF, ключ повтора и точного совпадения активного run, артефакта, исходного SHA и порядкового номера области. Она не меняет findings, coverage и статус проверки. Миграция `016`, 6 PostgreSQL integration tests и браузерный просмотр формы на homeserver прошли. На F0202 в тестовой среде записано одно явно помеченное `UNSURE` для проверки записи и повторного запроса; findings остались 0. Это **не** экспертная разметка класса и не оценка precision/recall.

Загрузка PDF теперь проверяет структуру через Poppler до принятия файла, включая страницу, шифрование и ошибки синтаксиса. Для F0201 отдельно создана read-only очередь текстовой проверки стадий: 9 листов с явным признаком РД, 114 почти пустых, 421 vendor, 2 коммерческих и 130 прочих; эти группы не являются постраничным решением о стадии. Чистый модуль PZ-017 извлекает нагрузки из двух контрольных страниц, но не подключён к durable verdict: значение горячего водоснабжения на РД отсылает к ВК, а стадия/редакция не подтверждены.

## Проверенный пилот PZ-017 и увеличенный просмотр, 27 сентября 2026

PZ-017 подключён к отдельному immutable release `PILOT_PZ002_PZ017`, сохраняя предыдущий `PILOT_PZ002`. Worker читает только закреплённые `document-text-v2` исходники, а API независимо сверяет SHA, страницу, текст блока, bbox и постраничную стадию. При несовпадении состава компонентов результат остаётся `CLARIFICATION_REQUIRED`, без расчёта общей нагрузки и без finding. Старый исторический текст выше описывает состояние **до** этого подключения.

На изолированном homeserver повторная проверка `CHK-A72D41AE` завершила 10/10 jobs с `SUCCEEDED`. Release `release:pz002-pz017:a823dcaddd8a93e4c65e3dea` сохранён с manifest hash `ca0fe584d816c3e48bf7c928eed3b412e3204d36846a7817ed84eb8ecff37adb`. Из открытых `TRAIN_PUBLIC/INCLUDE` F0150 p.23 извлечены четыре компонента ПД (отопление 0,331; вентиляция 0,927; завесы 0,108; ГВС 0,6024 Гкал/ч), из F0201 p.14 — два компонента РД (отопление 0,335; вентиляция 0,926 Гкал/ч). Сохранённый результат: `ABSTAIN/COMPONENT_BASIS_MISMATCH`, 130 `UNSUPPORTED`, две `PARTIAL`, 0 findings. Это доказательство работы сквозного пути и корректного воздержания на этой паре, **не** подтверждение соответствия объекта. Новый визуальный артефакт совпал по content hash `16c31cebb846565e6c8fd02af7c67f4a83465616c7959befeb93f290af832436` с предыдущим v3-прогоном. Общий `npm run check`, 7 PostgreSQL integration tests и реальный API smoke прошли.

Для предложений браузер показывает рядом целый лист и увеличенный фрагмент PDF. API до рендера сверяет полный исходный SHA, ограничивает размеры, время и параллелизм; класс остаётся неизвестным. Browser smoke прошёл на [F0150 p.566](../output/large-source-visual-v3-20260927/f0150-crop-square-ui.png) и [F0201 p.36](../output/large-source-visual-v3-20260927/f0201-crop-square-ui.png): обе области относятся к геологии/вентиляции, не к доказанным приборам отопления. Для F0150 первое увеличение было узким; исправленная версия дала PNG шириной 1198 px и пригодный для просмотра фрагмент.

Добавлен отдельный [оценщик durable visual](operations/VISUAL_PROPOSAL_EVALUATION.md) с проверкой оригинального PDF по открытому manifest, геометрии и полноты независимой ручной разметки листов. Двенадцать тестов прошли. Реальный артефакт F0202 p.17 с 160 предложениями дал [`NOT_ESTIMABLE`](../output/large-source-visual-v3-20260927/f0202-evaluation-not-estimable.json), поскольку полной независимой разметки нет; это не численная оценка precision/recall. 130 пунктов матрицы, классификация чертежей, надёжная связь с комнатами, предметное положительное срабатывание и H100-проверка остаются открытыми.

## Сквозной visual v4 и видимость пилотных результатов, 27 сентября 2026

Новый immutable run `CHK-8C6FFA72` на том же проверенном `TRAIN_PUBLIC/INCLUDE` комплекте F0150 + F0201 завершил 10/10 jobs успешно. Итог `PARTIAL`: 130 `UNSUPPORTED`, PZ-002 и PZ-017 `PARTIAL`, findings 0. Визуальный артефакт v4 `484c7798-5456-414b-813f-22098cbc191e` имеет content hash `c4993a6b4b2c9865d122f99b5bad67ee9bbe1e6243ca05a2fdae4d8a2df3b3c3`. Полный проход снова сохранил 2 предложения F0150 p.566 и 20 предложений F0201 p.31, 34–39. Контекст титула F0150 — `UNKNOWN` из-за нечитаемого текста, F0201 — `VENTILATION`; это подсказка о файле, не тип каждого листа. Оба исходника, полный PNG, увеличенный PNG, координаты и ноль findings проверены живым API smoke; [браузерный просмотр F0201 p.36](../output/large-source-visual-v4-20260927/f0201-v4-ui-20260927.png) подтвердил сохранение неклассифицированной области.

Экран покрытия теперь получает все 132 строки и показывает причины двух частичных и 130 неподдерживаемых параметров. Новый объектно защищённый `GET /api/checks/:id/pilot-results` читает сохранённые PZ-002/PZ-017: на активном run API вернул обе записи и шесть фактов тепловой нагрузки с страницами F0150 p.23 и F0201 p.14, `ABSTAIN/COMPONENT_BASIS_MISMATCH`; анонимный запрос получил 401, старый run — 404. При первом живом тесте маршрут ошибочно возвращал пустой список из-за отсутствовавшей пересылки через demo/normal repository; пересылка исправлена, добавлен её тест, повторный API и [браузерный smoke](../output/large-source-visual-v4-20260927/pilot-coverage-ru-20260927.png) прошли. В интерфейсе это явно названо частичным анализом, без утверждения о нарушении.

Для независимой проверки качества создан [просмотрщик полного листа](operations/INDEPENDENT_VISUAL_SHEET_ANNOTATION.md): F0202 p.16 рендерен из сверенного оригинала в 5796×8192 px без предложений модели, [браузерный снимок](../output/independent-visual-annotation-20260927/browser.png). Экспорт остаётся `UNREVIEWED`; модель не подтверждала ни одной метки. Оценщик v4 независимо пересчитал контекст из PDF и на реальном F0150 p.566 вернул [`NOT_ESTIMABLE/FULL_SHEET_INDEPENDENT_HUMAN_REVIEW_MISSING`](../output/large-source-visual-v4-20260927/f0150-v4-evaluation-not-estimable.json). Численная точность распознавания по-прежнему неизвестна.

PZ-007 изучен по открытому manifest: ПД F0150 p.26 и F0156/F0157 подтверждает три надземных и один подземный этаж, но комплект РД АР этого объекта в разрешённой поставке отсутствует; F0201 содержит лишь перечень отсутствующих чертежей. Поэтому правило сравнения этажности и finding не добавлены. H100 runtime по-прежнему недоступен для испытания; текущий стенд — homeserver с RTX 2080 SUPER.

## Ограниченный OCR и свободный поиск, 27 сентября 2026

Для профиля `PILOT_PZ002_PZ017` теперь настроен настоящий `DOCUMENT_OCR_LAYOUT`: локальный document-ai обрабатывает не более двух страниц `OCR_REQUIRED` за run, только PDF до 64 МиБ; API независимо сверяет release, manifest, источник, номера страниц, структуру OCR и счётчики, затем сохраняет append-only stage artifact. Миграция 017 расширяет допустимый disposition. Отдельная проверка обнаружила и исправила пропуск адреса OCR-сервиса именно у `extract-worker` в homeserver overlay. В laptop/H100 Compose этот адрес уже был задан на нужном worker. Весь этап остаётся ограниченным: сервер пока доверяет заявленному worker хешу рендера и не подтверждает правильность распознанных слов.

На homeserver новый `CHK-4CAE4879` завершил 10/10 jobs: `PARTIAL`, 130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings. Из 398 требуемых OCR-страниц обработаны только F0150 p.1–2, 396 отложены. Артефакт OCR (7584 байта) имеет SHA-256 `ae6218bccf5694da924bed21b03fe4035ecb86d777908efa8c6132b00ea914c8`; оба text artifact сверены с хешами БД. Повторный API smoke сохранил прежние визуальные 2/20 неклассифицированных областей на 614/676 страницах, browser smoke показал факты и частичное покрытие. [Подробный журнал](operations/HOMESERVER_SMOKE.md#ограниченный-ocr-в-durable-run-27-сентября). OCR stage пока не используется PZ-002: его пилотный адаптер вызывает OCR отдельно.

Отдельный [офлайн-поиск FREE-HEATING-001](operations/FREE_HEATING_SUSPICION_PROBE_20260927.md) на сверенных `TRAIN_PUBLIC` F0171/F0202 сформировал один `SUSPICION`, 0 findings и не изменил матрицу 132. 13 страниц F0202 требуют OCR; отсутствие тёплого пола в полном РД не установлено. Сигнал пока не подключён к durable run, поскольку сервер не имеет отдельного проверяющего контракта для свободного поиска.

Независимый [OCR verifier](operations/BOUNDED_OCR_VERIFICATION.md) на homeserver пересоздал PNG из открытых оригиналов F0150 p.1–2 тем же PDFium 5.12.1 и сверил SHA-256/геометрию с сохранённым artifact: `SOURCE_RENDER_SCOPE_VERIFIED`, 2 страницы, `ocrLineTextVerified=false`. Правильность текста остаётся для эксперта.

Опциональный визуальный v5 прошёл [реальный run F0202](operations/VISUAL_V5_F0202_PROBE_20260927.md): 36/36 листов, 160 предложений, два локальных ответа Qwen на выбранные crop, 10/10 jobs, 0 findings. Оба ответа `OTHER_HINT` пришлись на фрагменты с видимыми подписями PRADO, поэтому такой ответ нельзя считать отрицательным доказательством. Независимый пересчёт crop из PDF прошёл; оценка качества остаётся `NOT_ESTIMABLE` без экспертной разметки всего листа. На H100 этот 4B-профиль не проверялся и не соответствует закреплённому там 8B runtime.

Отдельный [пробный разбор IOS4-077](operations/IOS4_077_SPEC_PROBE.md) на F0171/F0202 извлёк 16 строк спецификации ПД и 102 OCR-строки смешанного РД/ИД; семь обозначений моделей встречаются в обоих источниках. Результат `ABSTAIN`, finding отсутствует: OCR не подтвердил единицу мощности, а актуальность редакций, связи приборов и температурная база не проверены. Это исследовательский CLI, не durable-правило и не изменение покрытия 132 параметров.

Для IOS4-077 добавлен opt-in bounded срез `--observation-slice` с проверкой
публичных PDF по манифесту и отдельной схемой `CLARIFICATION_REQUIRED`.
На homeserver F0171 p.133 + F0202 p.26 дали 6 строк ПД, 24 частичные OCR-строки
смешанного источника, 2 лексических совпадения моделей и ноль сопоставимых
фактов/находок за 12 с. [Отчёт](../output/ios4-077-20260927/observation-slice-f0171-p133-f0202-p26.json)
имеет SHA-256 `6b3f8a357a732ff8c508e3093e00c5a616f9a366c42ba66d5a4fffa649d1f718`.
Покрытие durable run не изменилось; OCR и принадлежность листа РД требуют
ручной проверки.

Для H100 подготовлен отдельный [opt-in визуальный профиль v6](operations/VISUAL_V6_H100_PROFILE.md) под закреплённый Qwen3-VL-8B FP8. Локальные тесты и серверный Compose прошли; реальный ответ модели на H100 до проверки организаторов недоступен. Профиль v6 сохраняет ответ `OTHER` как воздержание, не как отрицательный вывод.

На homeserver завершён новый [полный run с OCR v2](operations/HOMESERVER_SMOKE.md#ocr-v2-и-повторный-полный-прогон-27-сентября) `CHK-75051E60`: 10/10 jobs, 130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. OCR обработал F0150 p.295 и F0201 p.30; независимая проверка оригиналов, выбора страниц, геометрии и PNG-хешей прошла. Однако оба листа оказались нерелевантны текущим правилам отопления/площади. Из 398 требуемых OCR-страниц 396 отложены. Профиль v2 доказал техническую работоспособность этапа, но не предметную полноту; требуется более строгий выбор контекста и просмотр распознанного текста.

Новый [полный run с OCR v3](operations/HOMESERVER_SMOKE.md#ocr-v3-листы-рд-ов-по-контексту-27-сентября) `CHK-1D9443FD` завершил 10/10 jobs, 130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. Из 398 OCR-требующих страниц v3 нашёл 3 предметных кандидата и обработал F0201 p.7–8 (90 и 85 строк); F0150 явно пропустил без контекста РД-ОВ. Отдельный проверочный скрипт подтвердил исходные публичные PDF, выбор страниц и повторный PNG-рендер (2/2); OCR-строки остаются неподтверждёнными. Выборочно видны верные названия отопительных приборов, но единица тепловой нагрузки прочитана с ошибками. Профиль H100 теперь требует v3 по конфигурации; сам H100 не проверялся. Покрытие и findings не улучшились: нерешённые стадии/редакции и отсутствие достоверной связи ПД↔РД не допускают утверждения о нарушении.

Экран [ручной сверки OCR](operations/BOUNDED_OCR_READ.md) теперь показывает
выбранную строку, её рамку на исходном листе и увеличенный фрагмент PDF.
Параллельный browser smoke F0150/F0201 на homeserver подтвердил автоматическое
восстановление после временного `429` рендера; F0201 p.7 и визуальный p.36
открылись. Это помогает эксперту проверять OCR, но не является автоматической
верификацией текста. Факты PZ-017 по-прежнему происходят только из текстового
слоя: OCR не повышается до факта или finding.

Добавлен отдельный [закреплённый OCR heat review aid](operations/OCR_HEAT_ROW_REVIEW.md).
Он получает OCR v3 через fenced internal read и сохраняет предложения либо
причины воздержания внутри RULE_EVALUATION; API повторно сверяет строки,
координаты, хеши и снимок решения о стадии листа. Первый новый полный
`TRAIN_PUBLIC` run F0171+F0202 `CHK-D905DD61` завершил 10/10 jobs:
130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings. Сохранены 0 предложений и
4 воздержания `PAGE_STAGE_UNRESOLVED`; локальный Qwen через управляемый
Compose-сервис просмотрел 36/36 листов F0202, 160 геометрических областей и
2 выбранных crop. [Подробности](operations/HOMESERVER_SMOKE.md#ocr-heat-review-aid-первый-сквозной-run-27-сентября).
Второй полный run F0150+F0201 `CHK-9C474C9A` также завершил 10/10 jobs:
130 `UNSUPPORTED`, 2 `PARTIAL`, 0 findings; OCR сохранил 0 предложений и
4 воздержания. READ API обоих run проверен с авторизацией, а экран F0202
проверен в headless Chrome вместе со ссылкой на оригинальный лист.
[Скриншот OCR-подсказок](../output/ocr-heat-review-20260927/coverage-f0202-expanded.png).
Это техническое подтверждение цепочки, не положительная метрика распознавания
и не предметное доказательство нарушения.

Для конкурсного запуска на одном H100 добавлены [проверка фактически выбранного профиля и инструкция](operations/COMPETITION_H100_LAUNCH.md). Текущий `.env.server` остаётся `SCAFFOLD`; guard ожидаемо блокирует его как конкурсный запуск. Явный пилотный preset проверен на временной копии env и Compose, без H100 runtime.

## Новые проверяемые срезы и полный набор тестов, 27 сентября 2026

Исправлено наследование стадии для OCR-строк тепловой нагрузки: одностадийный
РД берёт стадию из immutable manifest, а смешанный комплект по-прежнему
требует проверенной карты страниц. Python worker и API независимо получают
закреплённый список стадий. PostgreSQL integration теперь содержит оба
положительных варианта и прошла 15/15 на временной БД homeserver. Отдельный
контракт передал **фактический вывод Python-экстрактора** в TypeScript-валидатор:
три корректных сценария приняты, четыре подмены отклонены локально и на
homeserver. Это тест алгоритма на fixture; OCR-текст реального PDF не
подтверждён. [Подробности OCR](operations/OCR_HEAT_ROW_REVIEW.md).

После обновления изолированных API и rules worker новый публичный reprocess
F0150+F0201 `CHK-EA02587C` завершил 10/10 jobs за 581 с. Итог не изменился:
130 `UNSUPPORTED`, PZ-002/PZ-017 `PARTIAL`, 0 findings; смешанный РД/ИД
источник дал 0 OCR-предложений и 4 воздержания. RULE_EVALUATION и OCR v3
артефакты совпали по SHA-256 с предыдущим run на тех же данных.
[Журнал и хеши](operations/HOMESERVER_SMOKE.md#повтор-после-исправления-стадии-одностадийного-рд-27-сентября).

На исходных публичных PDF проверены три автономных предметных среза.
[KR-058/KR-059](operations/KR_SLAB_PUBLIC_PROBE.md) сохранил 30 наблюдений с
листами и рамками ПД F0106 / РД F0140 и F0144; зоны фундаментных плит и
элементы перекрытий пока не связаны, итог `ABSTAIN`, находок нет.
[PZ-004](operations/PZ004_VOLUME_PROBE.md) сохранил одинаковое напечатанное
значение объёма `60997,93 м³` на F0150 и F0201, но F0201 является смешанным
ОВ, тогда как каталог ожидает РД АР/КР; итог также `ABSTAIN`, находок нет.
[KR-055](operations/KR055_CONCRETE_PUBLIC_PROBE.md) отдельно сохранил 11
наблюдений классов бетона `B30/B40/B60` на F0106/F0139/F0140/F0141.
Сверка оригинала F0140 с. 27 показывает, что `B40` относится к спецификации
фундаментной плиты на отметке −13,750. Сопоставления отдельных конструкций
между редакциями пока нет; итог `ABSTAIN`, находок нет. Все три среза сверяют
исходные PDF по открытому manifest и не подключены к durable
release. Они не увеличивают заявленное покрытие 132 параметров.

Дополнительный read-only поиск для PZ-007 нашёл ПД-утверждения об этажности:
F0150 с. 26 и F0156/F0157 с. 16–17 для одного объекта (3 наземных этажа и
подвал), F0104 с. 10 для другого (корпуса на 19 и 16 этажей). Размер и SHA
исходных PDF сверены с открытым manifest. В доступном `TRAIN_PUBLIC/INCLUDE`
наборе нет самостоятельного РД/АР для этих объектов; листы РД/КР с плитами
подвала не задают общее число надземных этажей. Поэтому независимая пара для
сравнения PZ-007 не найдена и статус параметра не повышен.

Инвентаризация открытого manifest (`TRAIN_PUBLIC/INCLUDE`, PDF) даёт 202
документа: среди них 3 ПД/АР и 7 РД/КР, но **нет РД/АР и РД/ОВ как
одностадийных файлов**. ОВ встречается как ПД либо смешанный РД/ИД. Это
ограничивает реальную проверку ряда правил на доступном публичном наборе;
генерировать положительную метрику для всех 132 из него нельзя.
Открытая `public_train_checks.jsonl` содержит всего 10 размеченных проверок:
5 IOS4-078, 1 IOS4-079 и 4 FREE-HEATING-001. Для KR-055/058/059, PZ-004 и
PZ-007 в ней нет независимого положительного эталона. Этот файл допустим
только для открытой обучающей оценки; закрытые ответы и `TEST_HIDDEN` не
используются.

[Независимая проверка пяти IOS4-078](operations/IOS4_078_PUBLIC_CASE_AUDIT.md)
по исходным F0171/F0201 не подтвердила ни один положительный машинный результат
на указанных листах. В двух случаях различие обозначений подходит для ручной
проверки, но нет доказанной связи веток и редакций; один пример сопоставляет
помещения разных назначений, ещё один — листы разных этажей. Каталог ожидает
сравнения сечения воздуховодов в мм², а публичные формулировки описывают
отсутствие вытяжки или конфигурацию. Статус всех пяти по проверенным листам —
`ABSTAIN`; это не объявляет публичные метки ошибочными.

[Единственный открытый IOS4-079](operations/IOS4_079_PUBLIC_CASE_AUDIT.md)
также даёт `ABSTAIN`: ПД p.104 показывает теплоснабжение приточных установок,
РД p.17 — план подвала, но нет сопоставленной пары вентилятора с расходом,
давлением и мощностью. Штамп РД расходится с номером листа в публичной записи,
а страница смешанного источника остаётся `UNRESOLVED` в сохранённой карте.
Формулировка публичного примера о конфигурации не заменяет триггер каталога о
меньшей кратности воздухообмена.

[Воспроизводимая инвентаризация 132 кодов](operations/CATALOG_READINESS_PUBLIC.md)
закрепляет хеши трёх открытых JSONL и показывает для каждого код, исходные
требования к ПД/РД/ИД, counts документов-кандидатов и число публичных checks.
Всего 203 включённых публичных документа (202 PDF и один иной формат), шесть
checks по кодам каталога и четыре FREE-HEATING-001 вне каталога. Она сохраняет
2 `PARTIAL` и 130 `UNSUPPORTED`; наличие источника или метки не повышает статус.
Скрипт не проверяет сопоставимые пары и findings. Канонический `reportSha256`
`e0efa9a52d65dd313ea5dc5becd8ed5971d88fab07c335e7ef306cf182ec7885`.

[Матрица тестов](operations/TEST_MATRIX.md) теперь охватывает весь доступный
локальный набор: `npm run check` (API 113, web 13, worker 175 плюс сервисы и
сборка), `infra/tests` 7/7, `scripts/tests` 127/127, PostgreSQL 15/15.
H100 runtime и предметная точность по всем 132 параметрам остаются за
границей этих проверок.

## Общий контракт фактов и первые две группы правил, 27 сентября 2026

Добавлены `typed-fact-v1`, общий fail-closed comparator, извлечение из
зафиксированного `document-text-v2` для PZ-004/PZ-007 и KR-055/KR-058/KR-059,
а также независимая проверка результата в API. Новый opt-in release profile
сохраняет предложения в durable stage artifact и показывает их в
`/pilot-results` и интерфейсе как материал для ручной проверки. Он не
создаёт новых findings и не удостоверяет отсутствие нарушений. При его
включении текущий pilot ledger должен содержать 7 `PARTIAL` (PZ-002/PZ-017
и пять новых) и 125 `UNSUPPORTED`. PostgreSQL integration с миграцией 018
прошла 16/16, а полный durable run `CHK-B210F921` на открытых F0106/F0140
подтвердил именно 7/125, пять исходных фактов, пять `ABSTAIN`, ноль findings
и 10/10 успешных jobs. Это проверка сквозной доставки и сохранения, а не
положительная предметная метрика.

[Повторяемая проба TRAIN_PUBLIC](operations/FACT_FAMILY_PILOT.md) на исходных
F0106/F0140/F0144 после сверки SHA обработала 180 страниц, сохранила пять
локализованных предложений и пять `ABSTAIN`, findings `0`. Ложные кандидаты
из бетонной подготовки и шага арматуры исключены тестами на строках этих PDF.
Полная проверка 132 кодов, автоматическая связь конструкций, утверждённые
редакции и проверенный положительный результат на оригиналах пока не доказаны.
Ручная связь конкретных фактов теперь сохраняется как решение эксперта и
фиксируется в следующем immutable run/lease. PostgreSQL integration с
миграцией 019 прошла 17/17: синтетические ПД/РД факты прошли через POST,
повтор, снимок, worker `REVIEW_REQUIRED` и независимое чтение API. Отдельный
браузерный smoke на homeserver подтвердил форму и `GET /fact-links` с пустым
журналом реального `CHK-B210F921`; связь этих разнородных фактов не записана.
Явный `sectionCode` уже
сохраняется в source review и передаётся в immutable lease; старые решения
остаются `null` с прежним каноническим хешем. Новый раздел выбранного
источника проверен API, PostgreSQL и браузером homeserver.

[Реестр семейств 132 кодов](operations/PARAMETER_FAMILY_REGISTRY.md) имеет
5 review-only пилотов, 47 проектных кандидатов и 80 нерешённых. Он проверяет
полноту каталога, но не расширяет исполняемое coverage; 125 строк нового
профиля пока остаются `UNSUPPORTED`.

После миграции 019 повторный полный run F0106/F0140 `CHK-B8ACC123` сохранил
7 `PARTIAL`, 125 `UNSUPPORTED`, пять `ABSTAIN` и ноль findings. Общий
движок и независимый API verifier теперь проверяют направленное и
относительное увеличение; тесты охватывают строгий порог, отрицательную
разность и нулевую базу. PZ-010 (92 квартиры в F0101 p.10) и KR-061
(перечень толщин в F0141 p.4) сохранены только как отдельные наблюдения.
Отсутствуют подтверждённая пара стадий и привязка конкретного элемента,
поэтому новые правила и coverage для этих кодов не объявлены. Последний
полный `npm run check`: API 137/137, web 18/18, worker 241/241,
остальные сервисы и сборка; `infra/tests` 7/7, `scripts/tests` 127/127.

Следующим этапом был единый постраничный индекс 203 разрешённых публичных файлов
(202 PDF на 10 142 страницах и один TXT только как метаданные), затем
пакетная проверка семейств на исходных PDF. Индекс должен хранить текст,
геометрию, кандидаты таблиц/разделов и качество, а OCR-кеш — различать SHA
источника, страницу и версии рендера/модели. До проверки семейства на реальных
PDF сквозной release profile не расширяется.

27 сентября единый индекс построен и прошёл полный аудит `PASS`: 202 PDF,
10 142 страницы, 8 668 текстовых кандидатов и 1 474 страницы для адресного
OCR, ноль ошибок целостности. Адресный OCR F0106 p.5 прошёл `MISS_WRITTEN`
и повторный `HIT` с тем же content hash; отдельный OCR-адаптер сохранил
проверенные исходные строки и координаты этой страницы. Матрица 47 проектных
кодов нашла точные пары категорий ПД/РД по manifest только для KR-061/062/067;
для остальных разделы или стадия требуют подтверждения. Реальная первая
пачка KR-061/062 на 100 выбранных страницах дала только `ABSTAIN`, потому что
точная связь элементов отсутствует; поиск был усечён. Поэтому исполняемые
правила и coverage пока не расширены. Отчёты и ограничения — в
[индексе](operations/PUBLIC_DOCUMENT_INDEX.md),
[матрице источников](operations/CANDIDATE_SOURCE_MATRIX.md) и
[пачке КР](operations/KR_DECREASE_BATCH.md).

Вторая семейная пачка KR-067 также проверена на 100 выбранных страницах
десяти исходных PDF: 0 квалифицированных кандидатов по объёму бетона и
массе стали, 100 `ABSTAIN` на каждый атрибут; поиск усечён. Это
подтверждает отказ от произвольного склеивания табличных ячеек, а не
отсутствие расхождений. Детали — в
[отчёте KR-067](operations/KR_RELATIVE_DELTA_BATCH.md).

После первого лимитированного KR-061/062 запуска отдельно просмотрены все
521 индексных страниц десяти КР PDF, со сверкой SHA страниц. Среди 477
страниц текстового слоя нет строки с однозначной связкой целевого элемента,
этажа, зоны и размера; 44 страницы требуют адресного OCR. Причины
воздержания и опасные ложные совпадения — в
[проверке KR-061/062](operations/KR_DECREASE_FAMILY.md).

Повтор KR-067 с полностраничной проверкой геометрии завершился: 93 страницы
допустимы для поиска локальных табличных итогов, семь отказали по
некорректному bbox. Два проверенных по SHA наблюдения РД — 432 и 310 м³
бетона на разных листах; сопоставимого объёма ПД и связи конструкции нет,
поэтому фактов для сравнения и findings нет. Проверка кандидатов раздела на
всех 344 страницах индекса, где он был выделен, дала 80 предложений, но
ни одного подтверждённого раздела РД. Этот метод читает только эвристические
строки разделов, поэтому нулевой результат не означает отсутствия раздела:
титульные листы и шифры документов проверяются отдельно. Подробности — в
[пакете KR-067](operations/KR_RELATIVE_DELTA_BATCH.md) и
[предложениях разделов](operations/PUBLIC_SECTION_PROPOSALS.md).

Для всех 47 проектных кодов теперь есть каталожно закреплённые правила
сравнения `NON_EXECUTING_ABSTAIN` и три семейных группы кандидатов:
31 числовой код, восемь классов и восемь проверок состава/наличия.
Синтетический comparator прогоняет каждый из 47 кодов; основания раздела,
редакции и пары фактов требуют привязки к исходным SHA. Полные лексические
прогоны по 10 142 страницам выполнены для числовых и классовых меток;
для проверок состава использован FTS-поиск якорей с адресным просмотром,
который не доказывает отсутствия метки на остальных листах. Пять точных
совпадений метки относятся к четырём кодам PZ-002/PZ-008/PZ-022/SPZU-024,
но не проходят требования к источнику или нуждаются в проверке раздела;
43 дополнительных упоминания набора не имеют однозначной области. Очередь
из 1 474 страниц означает необходимость адресного OCR, а не отсутствие
параметра на этих листах.

[Сводка по 47 кодам](operations/PUBLIC_FAMILY_READINESS.md) валидирует
хеши трёх полных отчётов, точные пары категорий исходников для трёх кодов,
метаданные всех 203 документов и причины отказа по каждому коду.
Все 47 пока дают `ABSTAIN`: подтверждённых исполняемых фактов `0`, findings
и coverage не выводятся. SHA сводки
`7975e62c4dde6f1f363359c07be7745d610695e58485777c9a03f68afb73e84c`.
Обобщённый извлекатель табличной строки проверил все 29 страниц 18 PDF,
найденных FTS по 54 буквальным числовым подписям, без усечения. Он нашёл на
F0150 p.26: PZ-002 `11 618,27 м²` и PZ-008 `15,814 м` с координатами
метки, единицы и значения. Это адресные наблюдения для эксперта, а не
полная проверка всех форм записи в корпусе. Для PZ-002
проверка F0150/F0152/F0201 показала разные определения площади и отсутствие
подходящей РД/АР пары; [разбор](operations/PZ002_AREA_SEMANTIC_REVIEW.md)
запрещает превращать числовую разницу в нарушение.

Адресный OCR-кеш проверен на реальных страницах F0106, F0107 и F0150;
титул F0150 p.1 даёт предложение раздела ПЗ, но метаданные манифеста не
изменены. Новый OCR-адаптер допускает поиск меток 47 кодов по выбранным
SHA-проверенным строкам, оставляя результат review-only. Следующий шаг —
приоритетные OCR-страницы КР и остальные семейные пачки, затем сквозной
homeserver run с утверждённым, не повышающим coverage профилем.

Адресный OCR для KR-061/062 дополнительно проверил 10 новых и четыре ранее
закешированных листа из 44 `OCR_REQUIRED` в десяти КР-источниках. Тридцать
остальных оставлены в очереди с явными причинами; даже на обработанных
листах не удалось связать толщину или арматуру с тем же элементом ПД и РД.
[Отчёт](../output/kr-decrease-ocr-20260927/triage.json) имеет SHA-256
`b259025e14917db00ac3ed52c3786daa17d1d3b06842f15ad4c3165d95fce21f`.
Планировщик OCR для всех девяти семейств выбрал 47 уникальных страниц из
1 474 требующих OCR (144 связи «страница — семейство», лимит 16 на семейство)
и счётчик отсечённых лимитом связей. Сам план не создаёт
фактов и не утверждает отсутствие параметров.

Уточнённая очередь v2 выбрала 48 уникальных страниц с учётом роли источника.
Все 33 новые страницы прочитаны адресным OCR, ещё 12 были в предыдущей
пачке и три — в отдельной КР-проверке. На семи листах найдено 27 буквальных
совпадений; два крупноформатных листа успешно перечитаны при 115 DPI после
достижения лимита рендера при 120 DPI. Повторный запрос из кеша вернул тот же
SHA. За пределами этой ограниченной очереди 1 426 страниц `OCR_REQUIRED`
остаются неизвестными. Ни один OCR-лид не повышен до findings или coverage.
[Разбор OCR](operations/PUBLIC_FAMILY_OCR_V2_BATCH.md).

Run-scoped просмотр 47 кандидатных кодов добавлен к opt-in профилю как
`candidateFamilyPreview`: ровно одна строка `ABSTAIN` на код, до 16 исходных
лидов на строку, проверка SHA/страницы/раздела/редакции и независимый
TypeScript verifier. Он не меняет 7 `PARTIAL` и 125 `UNSUPPORTED`.
PostgreSQL integration 18/18 прошла на временной БД. На homeserver два
полных run с исходными F0105/F0136 после исправления rule adapter завершили
10/10 jobs: оба `PARTIAL`, 0 findings, 47/47 `ABSTAIN`. Headless Chrome
показал панель 47 кодов. Relay после найденного разрыва RabbitMQ получил
восстановление соединения; принудительное закрытие только его AMQP-канала
и новый полный run подтвердили работу. Подробные receipt и ограничения — в
[отчёте homeserver](operations/CANDIDATE_PREVIEW_HOMESERVER_20260927.md).

Семь семейных офлайн-пакетов для 80 `UNRESOLVED` кодов проверили КР, АР,
ПОС, инженерные схемы, ПЗ/СПЗУ, ПОД/ООС и остальные разделы. Итоговая
[сверка](operations/UNRESOLVED_PUBLIC_BATCH_SUMMARY.md) закрепила SHA всех
семи отчётов, ровно 80 уникальных кодов и три намеренных пересечения.
Все 80 остаются `ABSTAIN`: не доказаны совместимые стадии/разделы, редакции
и одинаковые элементы для сравнения. В инженерной, ПЗ/СПЗУ и ПОД/ООС
пачках часть тематических адресов отсечена лимитом и отмечена явно.
Текущий проект не заявляет предметную полноту 132 параметров или
готовность на H100.

Адресный [OCR-пакет для 80 кодов](operations/UNRESOLVED_TARGETED_OCR.md)
завершил 64/64 страниц с 0 итоговых ошибок и тремя повторными `HIT` по тому
же SHA артефакта. Из 1 474 `OCR_REQUIRED` страниц 1 410 вне его очереди
остаются неизвестными. Пакет дал 519 тематических строк на 46 листах для
27 кодов и 60 меточных совпадений на 19 листах для четырёх кодов из 47;
ни один OCR-лид не повышен до факта или покрытия.

Новый [пакет наблюдений](operations/CANDIDATE_OBSERVATIONS_PUBLIC_BATCH.md)
повторно сверил 202 публичных PDF и 10 142 страницы индекса по SHA и FTS,
прогнал все 47 кодов девяти семейств и честно сохранил 0 run-наблюдений:
проверенных `CURRENT/APPROVED` и раздела чертежа в открытом пакете нет.
Ручной [аудит пяти пар КР](operations/KR_PUBLIC_PAIR_AUDIT.md) показал
потенциально общие конструкции, но не доказал один физический элемент и
применимую редакцию; все пары `ABSTAIN`.

Opt-in `candidateFamilyObservations` теперь извлекает проверенные
локализованные строки, числовые typed-fact предложения и буквальные
классовые токены из того же
run-scoped текстового слоя, что и 47-кодовый preview. Независимый API
verifier перепроверяет SHA/локатор/единицу перед сохранением и чтением;
PostgreSQL integration прошла 19/19 на временной БД. Отдельный
[сквозной прогон homeserver](operations/CANDIDATE_OBSERVATIONS_HOMESERVER_20260927.md)
`CHK-CCA09CAC` завершил 10/10 jobs с первой попытки: `PARTIAL`, 7/125,
0 findings, 47 preview `ABSTAIN` и 47 observations `REVIEW_ONLY` без
лидов по причинам source review. Headless Chrome подтвердил экран.
Синтетический набор после добавления классов содержит 39 типизированных
предложений из 47 строк: 31 числовое и 8 классовых. Класс требует отдельно
проверенной шкалы; восемь кодов состава остаются без complete-set факта.
Синтетические тесты 47 правил и инфраструктурный guard не являются
оценкой точности на чертежах; H100 остаётся непроверенным.

Для bounded OCR v2/v3 добавлен [проверяемый durable кеш страниц](operations/DURABLE_OCR_PAGE_CACHE.md)
по SHA исходного PDF, физической странице и точным профилям рендера/OCR.
Тест адаптера подтвердил повторное использование без нового OCR и с
повторной проверкой исходных байтов. На homeserver реальный F0144 p.3
дал `MISS_WRITTEN/HIT` на локальном OCR sidecar; повторный durable run
через очередь дважды завершился 10/10 jobs с одинаковым OCR artifact hash
и без повторной записи кеша. Дополнительный
[визуальный аудит KR-059](operations/KR059_VISUAL_PAIR_REVIEW.md) подтвердил
`t=250` на плане РД, но не установил связь с конкретной зоной ПД;
сравнение остаётся `ABSTAIN`.

Добавлен отдельный [durable кеш текстового слоя](operations/DURABLE_TEXT_LAYER_CACHE.md):
повторный run того же PDF и `sourceFileId` повторно проверяет исходные
байты, но может использовать валидированный результат PDFMiner. Инвалидация
привязана к SHA кода извлечения и версии PDFMiner; локальные тесты прошли.
[Четыре homeserver run](operations/DURABLE_CACHE_E2E_20260927.md) дали
одинаковые хеши текстовых, OCR и rule артефактов. После заполнения обоих
кешей текстовая стадия сократилась с 460 до 3 с, OCR layout с 17 до 2 с,
rule evaluation с 41 до 17 с, весь run с 582 до 102 с; 10/10 jobs
завершились с первой попытки, но результат остался `PARTIAL` без findings.
Это замер на двух публичных PDF homeserver, не доказательство качества
сравнения и не прогноз времени H100.

[Полная очередь проверки титулов](operations/SOURCE_REVIEW_PACKET.md)
собрана для всех 103 неоднозначных источников матрицы 47 кодов: после
обновления из индекса v4 98 с титульными подсказками и пять без них. Она
дополняет приоритетный пакет 25,
сохраняя SHA и локаторы там, где они доступны. Семь источников
имеют буквальную марку нужного раздела, в том числе F0146 и F0150 после
адресного OCR; все 103 по-прежнему требуют
подтверждения стадии, раздела, редакции и согласования.
[Отдельно F0198](operations/F0198_MIXED_STAGE_VISUAL_REVIEW_20260927.md)
визуально показал РД-штамп и исполнительную отметку на той же p.1:
постраничная метка не может представить обе роли, поэтому источник
оставлен `ABSTAIN` до привязки фактов к областям листа.
Адресный OCR нижнего правого региона F0198 на homeserver прочитал 46 строк,
включая «ИСПОЛНИТЕЛЬНЫЙ», «РД» и «Отопление и теплоснабжение», пропущенные
текстовым слоем при 362 индексированных блоках. Повторный запрос вернул
`HIT` с тем же artifact hash. Это подтверждает необходимость региональной
привязки источника; стадия/редакция и предметный факт не установлены.
[Пачка F0197–F0200](operations/MIXED_STAGE_REGION_OCR_BATCH_20260927.md)
показала, что область штампа можно читать адресно для четырёх
`RD_ID_MIXED` листов: 58/46/52/70 строк соответственно. Все четыре
остаются `ABSTAIN`. Регионы всех четырёх визуально сверены с SHA исходных
PDF; это подтверждает две надписи на листе, но не применимую редакцию.
Отдельный [пакет локаторов](operations/MIXED_STAGE_REGION_OCR_BATCH_20260927.md)
связал каждую из двух надписей с разными crop-координатами для 4/4 PDF;
он оставляет все источники на проверке и не создаёт параметрические факты.
Подсказка `1=UNRESOLVED` для одного листа с РД и исполнительной отметкой
добавлена в Source Review и развернута в изолированном web homeserver;
типизация и 22 web-теста прошли, API health и web HTTP 200 проверены.
[Таблица ручной проверки](operations/SOURCE_REVIEW_PACKET.md) свела все
103 неоднозначных источника с четырьмя подсказками OCR по областям;
столбцы решений оставлены пустыми и не меняют source gates.

Полный [публичный индекс v4](operations/PUBLIC_DOCUMENT_INDEX_V4_20260927.md)
прошёл независимый аудит 203 источников и 10 142 страниц. Политика чтения
перенесла 93 страницы с CID-заглушками из кандидатов текстового слоя в
адресный OCR: теперь 8 575 `TEXT_LAYER_CANDIDATE` и 1 567 `OCR_REQUIRED`.
Повторная проверка 47 кодов на v4 остаётся лексической: 47/47
`NO_EXECUTABLE_FACT_ABSTAIN`, ноль исполняемых фактов, findings и coverage
не измеряются. Производственный выпуск сохраняет прежнюю закреплённую версию
набора меток; оригинальные PDF и новый индекс используются для review.

[Ограниченный OCR v4](operations/BOUNDED_OCR_V4_TITLE_RECOVERY.md) устранил
пропуск повреждённого титула F0153 в сквозном запуске: новый immutable run
обработал p.1–2 из 39 страниц `OCR_REQUIRED`; независимая сверка оригинала,
SHA артефактов и повторного рендера прошла. Все 47 кандидатных кодов
остались `ABSTAIN`, находок нет. Остальные страницы и пригодность OCR строк
для предметного сравнения требуют отдельной проверки.
Регрессия на открытом F0202 показала, что v4 сохраняет выбор предметных
p.7–8 и хеши их OCR-содержимого из v3; 10/10 jobs завершились с первой
попытки, независимая сверка PDF и рендера прошла. Обновлённая
[очередь проверки источников](operations/SOURCE_REVIEW_PACKET.md)
использует аудированный индекс v4: F0153 теперь имеет буквальную подсказку
стадии ПД, но раздел, редакция и утверждение остаются неподтверждёнными.
Все 47 кандидатных кодов сохраняют `ABSTAIN`.
Для восьми правил `PRESENCE_SET` добавлен [offline мост к проверенному
сравнению](operations/PRESENCE_FAMILY_CANDIDATES.md): отдельно подтверждённый
факт состава привязывается к исходному наблюдению и SHA, после чего
движок всё равно требует доказанную полноту обеих сторон и одинаковую
область поиска. Синтетические проверки восьми кодов дали только
`REVIEW_REQUIRED` при полном наборе доказательств и `ABSTAIN` при его
отсутствии; публичный корпус не получил новых фактов или findings.
Дополнительная проверка офлайн-моста запрещает сравнение наблюдения или
типизированного факта, чей `inputManifestHash` отличается от пакета.
Аргумент `reviewed_sets` вне `PRESENCE_SET` также отвергается. Локальный
worker-набор после SHA-связки прошёл 620 тестов, профильный модуль после
последнего изменения — 13. Это защита контракта, не подтверждение
пар ПД/РД на реальных документах.

Расширенный адресный OCR v4 на homeserver проверил все 105 страниц,
отобранных [очередью без пропусков по лимиту](operations/PUBLIC_DOCUMENT_INDEX_V4_20260927.md):
216 связей «семейство — страница», 14 982 OCR-строки, 42 буквальные
подсказки; независимый аудит 105 receipts и кеша вернул `PASS`.
Новое совпадение — контекстное слово, исполняемых фактов и утверждённых
пар ПД/РД по-прежнему нет. Полный локальный `npm run check` прошёл с
Python окружением `scripts/.venv` в `PATH`; старый 60-страничный отчёт
повторно прошёл обновлённый аудит.
В изолированном Compose выполнен регрессионный reprocess F0202
`CHK-892B92D9`: `PARTIAL` 7/125, 0 findings, пять сравнений
`ABSTAIN`, 47 preview `ABSTAIN`, 0 run-наблюдений. Расширенная offline
OCR-очередь в этот run не импортировалась; результат проверяет отсутствие
регрессии сквозного пути, а не новую предметную полноту.
Отдельный opt-in release profile теперь сохраняет review-only OCR sidecar
47 правил; API независимо проверяет его SHA, строки, геометрию, оценки,
решения по источникам и счётчики при сохранении, sealing и чтении.
PostgreSQL integration 20/20 и два Compose run на открытых F0202/F0153 прошли.
F0153 обработал OCR p.1–2 из 39 требующих, но не имеет утверждённого
источника для предметного лида; оба run сохранили 47 `ABSTAIN` и 0 findings.
Панель web с 47 кодами проверена headless Chrome на сохранённом F0202 run;
она показывает `ABSTAIN` и происхождение возможных OCR-подсказок.
Дополнительная сортировка 105 SHA-аудированных OCR receipts отделила 35
контекстных и 7 предметных буквальных совпадений; после свёртки написаний
остались четыре предметные OCR-строки на двух страницах. На оригинальных
публичных PDF проверены 14 выбранных совпадений: подпись кнопки находится
в легенде, приборы — в спецификации без доказанной пары/раздела, прочие
подписи дают только контекст или ошибку OCR. Все результаты остаются
`REVIEW_ONLY_ABSTAIN`; [протокол проверки](operations/PUBLIC_FAMILY_OCR_LEAD_TRIAGE_20260928.md).
Эти проверки подтверждают сквозной транспорт и отказ от неподтверждённых
выводов, но не качество извлечения или покрытие остальных 80 кодов.

Опциональный OCR v5 проверен сквозным Compose-прогоном F0202: три
предметно отобранные страницы p.7–9 против двух в v4, 10/10 jobs,
`PARTIAL` 7/125, 0 findings, 47 OCR-sidecar `ABSTAIN`.
[Независимая проверка](operations/BOUNDED_OCR_V5_PUBLIC_RUN_20260928.md)
сверила исходный PDF и повторный рендер всех трёх страниц; точность OCR-строк
и пригодность листа как утверждённого источника не установлены.

Для сохранённой OCR-стадии F0202 добавлен отдельный разбор строк таблицы:
16 review-only геометрических пар (p.7 — 3, p.9 — 13), оригинал p.9 визуально
сверён. Новый opt-in release сохраняет эти некодированные строки в run;
API независимо пересчитывает их из OCR-стадии при save/seal/GET, web
показывает происхождение. Изолированный Compose `CHK-1BD8477F` завершил
10/10 jobs, `PARTIAL` 7/125, 0 findings; авторизованный GET и browser smoke
прошли. Коды и типизированные факты не назначены; [протокол и SHA](operations/OCR_TABLE_ROWS_COMPOSE_20260928.md).
[Ручной журнал транскрипции](operations/OCR_ROW_TRANSCRIPTION_COMPOSE_20260928.md)
теперь реализован и проверен в изолированном Compose: миграция 020,
аутентифицированный GET 16 строк, отказ чужому fingerprint без записи,
браузерная форма с отключённым сохранением до действия человека. На реальном
F0202 решений в журнале 0. [Визуальная сверка p.7](operations/F0202_OCR_TABLE_P7_VISUAL_AUDIT_20260928.md)
нашла пропуск единицы `м³`, подмену знака `÷` и ещё одну отсутствующую
многострочную строку. Версионированный v2-извлекатель добавил четвёртую
некодированную пару p.7, не меняя v1. Изолированный Compose
`CHK-FA35FEA0`: 10/10 jobs, 17 OCR-строк, три воздержания, `PARTIAL` 7/125,
0 findings; API/offline совпали. Миграция 021 сохраняет проверенный
append-only снимок последних решений о транскрипции при новом run; в
реальном F0202 решений и снимков 0. [Протокол](operations/OCR_TABLE_V2_AND_REVIEW_SNAPSHOT_20260928.md).
[Следующая граница](operations/OCR_ROW_CONFIRMATION_GATE.md) — отдельное
решение о предметной применимости и OCR-локатор типизированного факта;
`TEXT_BLOCK` для OCR использовать нельзя.
Для ручного выбора раздела источника расширен словарь до всех кодов
47 кандидатных правил, включая 11 обозначений РД; миграция 022, UI и
PostgreSQL integration проверены. [Граница и проверка](operations/SOURCE_SECTION_RD_VOCABULARY_20260928.md).
Ни одному реальному источнику новый раздел автоматически не назначен.
Отдельный журнал предметной применимости OCR-строки реализован миграцией 023,
строгим API `GET/POST` и web-формой. Решение связывается с неизменяемыми
снимками транскрипции и источника и повторно проверяется по исходным OCR/rule
артефактам, PDF и SHA при записи и чтении. `APPLICABLE` требует подтверждённую
транскрипцию и актуальный утверждённый источник, а `UNSURE` и
`NOT_APPLICABLE` не дают права на факт. Положительный путь проверен только
на синтетической PostgreSQL fixture; реальных человеческих решений F0202 нет.
Миграция 024 добавила неизменяемый снимок последнего проверенного решения
о применимости в следующий run; отрицательное/неопределённое решение
перекрывает прежнее положительное. PostgreSQL suite с новым снимком 23/23;
изолированный homeserver reprocess `CHK-368C9D3C` завершил 10 jobs,
`PARTIAL` 7/125, 0 findings, 17 OCR-строк, три воздержания и 0 снимков
применимости, так как экспертных решений нет.
Чистый валидатор `typed-fact-v2` с отдельным локатором `OCR_ROW` и opt-in
read-only API заново проверяют origin/target решения, OCR и SHA. Локальный
положительный путь пока только синтетический; новый F0202 дал 0 кандидатов.
Старый read-only API не меняет сравнения. Локальный полный check этого этапа:
API 219 pass/26 skip, web 33, worker 648, сборка; PostgreSQL tests 24/24. Изолированный homeserver Compose применил миграции 022–024;
у публичного F0202 `CHK-FA35FEA0` авторизованный GET дал 0 кандидатов и
0 решений, неподтверждённый POST — 409 без записи.
[Граница](operations/OCR_ROW_CONFIRMATION_GATE.md) и
[сквозная проверка](operations/OCR_ROW_APPLICABILITY_COMPOSE_20260928.md).

Миграция 025 и отдельный opt-in release profile сохраняют неизменяемый
артефакт OCR_ROW кандидатов после снимков решений об источнике,
транскрипции и применимости. API заново выводит его из исходных артефактов
и решений при seal/GET и отвергает подмену. Старый `typed-fact-v1` и
сравнения не изменены. Полный локальный `npm run check` прошёл: API 219
pass/27 skip, web 33, worker 648, сборка; PostgreSQL integration 25/25,
отдельный синтетический положительный OCR_ROW тест также прошёл.
Изолированный Compose `CHK-927C1BB0` на открытом F0202 завершил 10 jobs,
`PARTIAL` 7/125, 0 findings, 47 кандидатных правил `ABSTAIN`.
Артефакт создан с нулём фактов и решений эксперта, поскольку в реальном
run таких решений нет. Это проверка сохранения и границ доверия, а не
предметной точности или полноты каталога. [Подробный протокол](operations/OCR_TYPED_FACT_DURABLE_20260928.md).

Отдельный OCR-table v3 добавил проверяемое продолжение подписи для
одной публичной строки F0202 p.7; API заново выводит составную подпись из
сохранённой OCR-стадии и проверяет каждую OCR-строку. Изолированный Compose
`CHK-8D62C98D`: 10/10 jobs, 17 некодированных предложений, три
воздержания, одно продолжение; headless Chrome подтвердил его происхождение
и пустую форму решения. Результат остался `PARTIAL` 7/125, 0 findings,
47 кандидатных кодов `ABSTAIN`, 0 OCR_ROW фактов и экспертных решений.
Полный локальный check: API 234 pass/28 skip, web 35, worker 658;
PostgreSQL integration 28/28. Для скалярных кандидатов API теперь
проверяет точные обозначения единиц и сохраняет регистр SI.
[Протокол и SHA](operations/OCR_TABLE_V3_PUBLIC_RUN_20260928.md).

Миграция 026, API и web добавили отдельный ручной журнал пары ПД/РД
`OCR_ROW` фактов. Положительный путь проверен только синтетически в
PostgreSQL; реальная публичная F0202 пара отсутствует. Полный локальный
check: API 237 pass/30 skip, web 38, worker 658, PostgreSQL 30/30.
Изолированный homeserver `CHK-761854B6`: 10/10 jobs, `PARTIAL` 7/125,
0 findings, 47 candidate `ABSTAIN`, 0 кандидатов пар и 0 решений.
API отверг подложный `PAIR_CONFIRMED` с 409, браузер показал пустую
панель без сохранения. [Граница и протокол](operations/OCR_FACT_PAIR_JOURNAL_20260928.md).

Для ещё двух `UNRESOLVED` кодов KR-056/KR-057 готов отдельный read-only
семейный срез: 10 исходных публичных PDF и 521 страница индекса v4 сверены
по SHA, четыре ключевые страницы визуально сверены с рендером. Обозначения
материала остаются лексическими наблюдениями; каждый элемент и связь
ПД/РД не подтверждены, статус `ABSTAIN`. Это не переводит коды в
покрытие. [Пакет и SHA](operations/KR_MATERIAL_REVIEW_20260928.md).

Миграция 027 добавила immutable снимок последнего решения о паре
`OCR_ROW` в новом run: оба факта повторно привязываются и получают новые
fact ID; `UNSURE` перекрывает старое подтверждение, пропавший факт
остаётся `TARGET_FACT_UNAVAILABLE`. Полный локальный check: API 245
pass/30 skip, web 38, worker 660; PostgreSQL 30/30. Изолированный
Compose F0202 `CHK-96F8AE32`: 10/10 jobs, `PARTIAL` 7/125, 0 findings,
47 candidate `ABSTAIN`, 0 реальных OCR_ROW фактов, пар и снимков.
Pure comparison preview для семи относительных правил ещё не подключён
к release, так как нет проверенного решения о количественном смысле.
[Протокол](operations/OCR_FACT_PAIR_SNAPSHOT_20260928.md).

Миграция 028 и отдельный API/web журнал добавили ручное решение о
количественной сопоставимости точной OCR_ROW пары после immutable снимка
следующего run. Сервер сам вычисляет evidence hash, сверяет артефакт,
источники, правило и локаторы при записи и чтении; клиентский hash не
принимает. Полный локальный `npm run check` и 30/30 PostgreSQL тестов
прошли. Изолированный homeserver F0202 `CHK-69B4215C`: `PARTIAL` 7/125,
0 findings, 47 candidate `ABSTAIN`, 17 некодированных OCR-строк,
0 пар и решений количества. Подложный положительный POST отвергнут 409,
браузер показал закрытую форму. Отдельный read-only comparator GET
перепроверяет журнал и отдаёт `REVIEW_ONLY` подсказки; на публичном run
их 0. Он не создаёт findings и coverage, поскольку нет подтверждённого
количественного решения на реальной паре.
[Протокол](operations/OCR_QUANTITY_REVIEW_COMPOSE_20260928.md).

Для `AR-042` отдельный review-only семейный пакет проверил три публичных
оригинала по SHA и 125 страниц индекса: 10 строк текстового слоя и 19
страниц с `OCR_REQUIRED`. Адресный OCR завершён для 19/19 страниц:
15 попаданий в кеш, четыре новые записи; 19 SHA рендеров и receipts
перепроверены. Два новых лексических лида визуально относятся к оконным
проёмам. Пороги и проёмы остаются локальными контекстами без доказанной
эвакуационной связи; весь пакет `ABSTAIN`, без finding и coverage.
[Пакет и независимый аудит](operations/AR_EVACUATION_HEIGHT_REVIEW_20260928.md).

Для `IOS2-072`/`IOS3-075` отдельный review-only пакет сверил исходные SHA
восьми разрешённых PDF и 293 страницы индекса. В 195 страницах с текстом
найдены 28 буквальных подсказок, включая пять однострочных совпадений сети
и материала. Адресный OCR выполнен для всех 98/98 страниц выбранного
среза: отдельно проверенная F0204 p.6 и ещё 97 страниц, 17 291 строка
на последних 97. Независимый аудит оригинальных PDF, кеша и повторных
PDFium-рендеров прошёл 97/97; 118 OCR-подсказок требуют просмотра.
Ошибки чтения, класс давления, стадия и идентичность ветви ПД/РД не
установлены. Итог `ABSTAIN`, 0 фактов, пар, findings и coverage.
[Пакет](operations/PIPE_MATERIAL_REVIEW_20260928.md).

Для `PPM-102`/`PPM-113` отдельный review-only срез сверил SHA четырёх
публичных PDF, 394 страницы индекса v4 и шесть исходных листов. Из 325
читаемых страниц получены 38 и 19 лексических строк. Все 69 OCR_REQUIRED
страниц обработаны; независимый аудит оригиналов, 69 receipts/кешей и
повторных рендеров прошёл. Из 11 431 OCR-строки один буквальный лид
визуально оказался названием ссылочного документа. Сопоставимой
утверждённой пары ПД/РД для одного отсека или сети нет. Оба кода `ABSTAIN`,
без фактов, findings и coverage.
[Пакет](operations/FIRE_SAFETY_REVIEW_20260928.md).

Для выбранных публичных КР и ПОС пачек адресный OCR также закрыт с
независимым SHA-аудитом: КР 44/44 страницы, 2 458 строк, ноль точных
однострочных размерных лидов; ПОС 19/19 страниц, 3 206 строк и 111
лексических подсказок. Проверены исходные ZIP/PDF, receipts, кеш и
повторные PDFium-рендеры каждой страницы. Положительных решений по шести
кодам ПОС и выбранным кодам КР нет; все остаются `ABSTAIN`, без findings
и coverage. [КР](operations/KR_TARGETED_OCR_20260928.md),
[ПОС](operations/POS_TARGETED_OCR_20260928.md).

После этих семейных проверок добавлен opt-in immutable run-пакет для
`AR-042`, `IOS2-072`, `IOS3-075`: лексические подсказки берутся только из
committed текстового слоя конкретного запуска, независимо сверяются API по
SHA и локаторам, отображаются в web как `ABSTAIN`. Изолированный homeserver
`CHK-04B3B7AA`: 10/10 jobs `SUCCEEDED`, общий `PARTIAL` 7/125,
0 findings, три новых кода `ABSTAIN`, 0 строк из-за отсутствия проверенного
`CURRENT`/`APPROVED` источника; браузерный smoke прошёл. Старый профиль
сохраняется. Результат не повышает offline подсказки до фактов.
[Протокол](operations/UNRESOLVED_FAMILY_RUN_COMPOSE_20260928.md).

Дополнительный изолированный Compose на тематическом публичном ПД/ВК
`F0163` проверил новый объект `OBJ-58FA0B7B` и run `CHK-0D43285B`:
исходный SHA PDF и 21 страница совпали с manifest, 10/10 jobs `SUCCEEDED`,
итог `PARTIAL` 7/125, 0 findings, три кода `ABSTAIN`/0 leads из-за отсутствия
проверенного решения по источнику. API и браузер прошли. Обнаруженное
различие внутреннего UUID и публичного `OBJ-*` при построении ссылки на
лист исправлено в web; прямой preview требует сессию и прошёл 200/401.
Положительная ссылка с реальным проверенным лидом ещё не наблюдалась.
[Протокол](operations/UNRESOLVED_FAMILY_TOPIC_COMPOSE_20260928.md).

Отдельный opt-in OCR v6 ограничивает адресное чтение четырьмя
`OCR_REQUIRED` страницами из immutable `CURRENT`/`APPROVED` источника
раздела АР/ВК. Worker и API независимо сверяют выбор страниц,
`document-text-v2`, снимки решений и SHA. Локальный полный check прошёл;
PostgreSQL проверил синтетический положительный источник и подмены.
В изолированном homeserver Compose на исходном публичном F0163 run
`CHK-6D761C86` завершил 10/10 jobs, `PARTIAL`, 0 findings: две страницы
отложены из-за отсутствия решения эксперта, 0 обработано. Авторизованный
GET, отказ анонимному запросу и браузерная панель прошли. Это проверяет
безопасное воздержание, а не качество OCR.
[Протокол](operations/OCR_V6_COMPOSE_20260928.md).

Отдельный OCR v6 sidecar для `AR-042`/`IOS2-072`/`IOS3-075` реализован
как review-only пакет с независимой проверкой на save/seal/GET;
локальный полный check и PostgreSQL синтетические/tamper тесты прошли.
На первом изолированном развертывании обнаружена и исправлена потеря
определения правила при передаче release в worker lease; добавлен
PostgreSQL регрессионный тест. Второй запуск выявил неполное копирование
OCR v6 загрузчика в изолированную копию worker; локальные и удалённые
SHA исполняемых файлов сверены после исправления. Новый F0163
`CHK-D85632B7` завершил 10/10 jobs, `PARTIAL`, 0 findings; sidecar
сохранил три `ABSTAIN` и ноль строк, так как нет подтверждённого
источника. OCR отложил две требующие страницы. Авторизованный GET и
независимая проверка SHA прошли, анонимный GET вернул 401; браузерная
проверка показала три `ABSTAIN` и ноль OCR-строк. Это транспорт и безопасное
воздержание, не предметная полнота или качество OCR.
[План](operations/OCR_V6_FAMILY_SIDECAR_PLAN_20260928.md) и
[протокол Compose](operations/OCR_V6_FAMILY_SIDECAR_COMPOSE_20260928.md).

Следующее семейство `SITE_TEP_AREA` для `PZ-001`, `SPZU-026`, `SPZU-027`
подготовлено отдельным opt-in профилем. Worker извлекает только точные
строки текстового слоя ПД/ГП из immutable проверенного источника; API
независимо пересчитывает локаторы, SHA, счётчики и полный пакет при
сохранении, sealing и чтении. Web показывает три `ABSTAIN` с происхождением.
Синтетический положительный пакет Python принят TypeScript валидатором;
PostgreSQL тест проверил положительный путь и подмены. Проверены SHA
оригинальных разрешённых F0126/F0154/F0155 и страниц индекса, но ни один
из них не получил экспертного `CURRENT`/`APPROVED` решения. Полный локальный
check после интеграции прошёл: API 278/278, web 62/62, worker 707,
сборка. Изолированный homeserver Compose на публичном F0154
`CHK-F71034FE` завершил 10/10 jobs, sealed `PARTIAL`, 0 findings;
три кода `ABSTAIN`/0 лидов без экспертного решения. Адресный OCR
отложил 8/8 требующих страниц. Оригинальные ZIP/manifest/PDF SHA,
авторизованный GET, независимый sidecar audit и браузерный просмотр
прошли; старый run не изменился. Это не проверка извлечения значений.
[Исходники и границы](operations/SITE_TEP_AREA_REVIEW_20260928.md),
[протокол Compose](operations/SITE_TEP_AREA_COMPOSE_20260928.md).

Для следующей пачки `SPZU-029/032/033/035/036` сделан отдельный
`SITE_GP_CONTEXT_TEXT` review-only профиль с точными строковыми
локаторами. Пять исходных листов F0126/F0154 визуально и по SHA
сверены; среди них есть таблицы слоёв и МАФ, но текущий профиль
сохраняет только навигационные строки. Локальный полный check:
API 282, web 64, worker 713, сборка PASS; PostgreSQL 11 файлов/35 тестов
PASS. Изолированный homeserver Compose на публичном F0126
`CHK-A97C4079` завершил 9/9 jobs, sealed `PARTIAL`, 0 findings:
OCR job не требовался, пять кодов `ABSTAIN`/0 лидов без проверенного
источника. Оригинальные ZIP/manifest/PDF SHA, авторизованный GET,
браузерный просмотр и прежний run проверены. Это безопасное воздержание,
не предметная полнота.
[Контракт](operations/SITE_GP_CONTEXT_REVIEW_20260928.md),
[визуальный аудит](operations/SITE_GP_CONTEXT_VISUAL_AUDIT_20260928.md),
[протокол Compose](operations/SITE_GP_CONTEXT_COMPOSE_20260928.md).

Для `SPZU-029/032` реализован отдельный review-only пакет предложений о
соседстве текстовых блоков таблицы. На SHA-проверенном оригинале F0126
p.20 получены 21 предложение и 3 неоднозначности по слоям дорожной одежды,
на p.21 — 11 предложений «позиция — наименование МАФ». Сохранённый
`document-text-v2` не имеет bbox строки/ячейки, поэтому каждая связь
`ROW_ASSOCIATION_UNVERIFIED`, количество МАФ `null`, оба кода `ABSTAIN`.
Worker/API/web opt-in профиль независимо проверяет immutable источник,
SHA текста, геометрию блоков, предложения и причины. Полный локальный
`npm run check` прошёл (API 285, web 66, Python suites, build);
последовательный PostgreSQL suite — 12 файлов/36 тестов без пропусков.
Изолированный homeserver F0126 `CHK-192193C0`: ZIP/manifest/PDF SHA
сверены, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, два
`ABSTAIN`/0 предложений без решения эксперта, auth API/browser PASS.
Старый GP stage сохранил SHA; его `pilot-results` API GET после повторной
обработки того же объекта возвращает 404 по документированной области
только активного запуска. Прямой SQL read подтвердил неизменность.
[Семейство](operations/SITE_GP_TABLE_ROW_REVIEW_20260928.md)
и [Compose](operations/SITE_GP_TABLE_ROW_COMPOSE_20260928.md).

Следующее семейство `EQUIPMENT_SPEC` для unresolved `IOS4-077`,
`IOS4-079`, `PPM-112` прошло предметный review-only аудит оригинальных
F0171/F0202 по SHA и шести листов. Найдены настоящие строки спецификации,
расчётные подписи и ложные реестровые совпадения. Pure worker извлекатель
разделяет их, сохраняет точные локаторы и три `ABSTAIN`; F0202 со смешанной
стадией не проходит без отдельного решения. Worker/API/web opt-in профиль
с независимой проверкой SHA при save/seal/GET реализован. Полный локальный
check прошёл: API 288, web 68, worker 732 и сборка. Последовательный
PostgreSQL suite: 13 файлов/37 тестов PASS. Изолированный homeserver
F0171 `CHK-C8360E50`: ZIP/manifest/PDF SHA сверены, 177/177 читаемых
текстовых страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
три `ABSTAIN`/0 строк без экспертного решения по источнику. Auth API
200/401 и браузерный просмотр прошли; старый GP-table stage SHA
не изменился. Положительная ветка реального проверенного источника не
испытывалась. [Аудит](operations/NEXT_UNRESOLVED_FAMILY_AUDIT_20260928.md),
[контракт](operations/EQUIPMENT_SPEC_REVIEW_20260928.md),
[Compose](operations/EQUIPMENT_SPEC_COMPOSE_20260928.md).

Следующий чистый review-only `MATERIAL_CLASS` пакет для unresolved
`KR-056/057/066` проверен на разрешённых оригиналах F0106/F0140 и
четырёх листах с SHA. Общие марки С245/А500С и требования REI нельзя
назначать одному физическому элементу и считать фактическим составом
защиты. Pure worker сохраняет точные лексические локаторы и три
`ABSTAIN`; OCR_REQUIRED листы отложены. Отдельный opt-in worker/API/web
профиль проверяет source/text SHA при save/seal/GET. Полный локальный
check прошёл: API 291, web 70, worker 741, сборка; последовательный
PostgreSQL suite 14 файлов/38 тестов PASS. Изолированный homeserver
F0140 `CHK-44D0DC61`: ZIP/manifest/PDF SHA сверены, 27/27 текстовых
страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, три
`ABSTAIN`/0 строк без экспертного решения по источнику. Auth API
200/401 и браузерный просмотр прошли; старый EQUIPMENT_SPEC stage/sidecar
SHA не изменился. Положительная ветка реального проверенного источника
не испытывалась. [Аудит](operations/NEXT_UNRESOLVED_FAMILY_AUDIT_2_20260928.md),
[контракт](operations/MATERIAL_CLASS_REVIEW_20260928.md),
[Compose](operations/MATERIAL_CLASS_COMPOSE_20260928.md).

План группировки оставшихся 74 unresolved кодов после отдельно разобранных
шести — [21 предлагаемый extractor и общая immutable конфигурация](operations/UNRESOLVED_BATCH_PRIORITY_20260928.md).
Первый общий review-only пакет `AREA_PROGRAM` (7) и `DIMENSION_LAYOUT`
(12) имеет SHA-закреплённую конфигурацию и отдельный opt-in worker
adapter. Проверены публичные F0126/F0154/F0104 по SHA; worker 751/751,
независимый pure API verifier 5/5, web 72/72. Durable API хранит
конфигурацию в immutable release и сверяет save/seal/GET;
последовательный PostgreSQL suite 15 файлов/39 тестов PASS. Все 19 кодов только
`ABSTAIN`, а локаторы остаются подсказками по тексту. Первый isolated
F0126 `CHK-4C4C29C4` выявил ошибку пути к JSON в wheel; исправлена
загрузка через `INSPECTOR_RULES_DIR`, тест relocated package 11/11.
Повторный F0126 `CHK-0855D3C6`: ZIP/manifest/PDF SHA PASS, 23/23
текстовых страниц, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
19 `ABSTAIN`/0 подсказок без решения по источнику; auth API/Chrome и
legacy MATERIAL_CLASS SHA PASS. [Compose](operations/UNRESOLVED_CONFIG_COMPOSE_20260928.md).
Полный локальный `npm run check` после
исправлений прошёл: API 296, web 72, worker 751 и сборка. В очереди
пакетной предметной проверки остаются 55 кодов; 19 получили только
навигацию, не исполняемые правила. Числа 74/19/55 относятся к
организации работы, не к реализованному покрытию или доказанным
нарушениям. [Контракт](operations/UNRESOLVED_CONFIG_REVIEW_20260928.md).

Следующие семейные оригиналы проверены в режиме просмотра:
[DOCUMENT_APPROVAL/SAFETY_COVERAGE — 10 кодов, семь разрешённых PDF и
11 визуально сверенных страниц](operations/NEXT_APPROVAL_SAFETY_AUDIT_20260928.md),
[NETWORK_TOPOLOGY — семь кодов, шесть PDF и пять визуально сверенных
страниц](operations/NEXT_NETWORK_TOPOLOGY_AUDIT_20260928.md). Все остаются
`ABSTAIN`. Для первых десяти построена отдельная pure config v2 с 16
буквальными якорями, привязанными к SHA PDF/страницы/рендера; старый
v1 профиль не изменён. Opt-in v2 worker/API/web и independent verifier
реализованы, PostgreSQL 16 файлов/40 тестов PASS; полный локальный
`npm run check` API 302, web 75, worker 760 и сборка PASS. Изолированный
Compose v2 на публичном F0156 `CHK-3F610706` завершён: ZIP/manifest/PDF
SHA сверены, 10/10 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings,
10 `ABSTAIN`/0 подсказок без проверенного источника. OCR v6 обработал
0/9 требующих страниц и отложил их до решения по источнику. Авторизованный
GET, отказ анонимному GET, браузерный просмотр и неизменность v1 stage
прошли. Ранний запуск `CHK-A9D3F315` стартовал при пропущенном Python
модуле в remote allowlist; после исправления worker он тоже запечатан
`PARTIAL` с 10/10 успешными jobs, но прерванный smoke-клиент не принят
как итог проверки. [Контракт](operations/UNRESOLVED_CONFIG_V2_REVIEW_20260928.md),
[Compose](operations/UNRESOLVED_CONFIG_V2_COMPOSE_20260928.md).

Третий opt-in пакет `NETWORK_TOPOLOGY` для семи кодов использует
отдельную config v3 с семью буквальными якорями, закреплёнными SHA
оригинальных PDF/страницы/рендера. Worker/API/web интеграция сохраняет
только лексические подсказки со статусом `ABSTAIN`, а независимый API
сверяет source/text/config/result при save/seal/GET. Локальный полный
`npm run check` прошёл: API 309, web 77, worker 769, сборка PASS;
последовательный PostgreSQL suite — 17 файлов/41 тест PASS.
Изолированный Compose v3 на разрешённом F0171 `CHK-A2EC9D6E` завершён:
оригинальные ZIP/manifest/PDF SHA сверены, 177/177 страниц текстового
слоя, 9/9 jobs `SUCCEEDED`, sealed `PARTIAL`, 0 findings, семь
`ABSTAIN`/0 подсказок без экспертного решения по источнику. Auth API
200/401, браузерный просмотр и неизменность v1/v2 stage SHA прошли.
[Протокол](operations/UNRESOLVED_CONFIG_V3_COMPOSE_20260928.md).
Из исходных 80 unresolved
кодов шесть были разобраны отдельными семействами, 36 получили только
конфигурационную навигацию v1/v2/v3, 38 ещё не получили такой профиль.
Из последних девять `BOUNDARY_OVERLAY` уже признаны непригодными для
одной лишь лексической навигации; ещё 29 требуют семейной проверки.
Эти числа описывают разработку интерфейсов, не предметное
покрытие или точность проверки. [Предметный аудит](operations/NEXT_NETWORK_TOPOLOGY_AUDIT_20260928.md),
[контракт](operations/UNRESOLVED_CONFIG_V3_REVIEW_20260928.md).

Проверка следующих девяти `BOUNDARY_OVERLAY` кодов по оригинальным
публичным PDF и семи рендерам показала, что строки и легенды не дают
координатного наложения контуров. Лексический v4 для них отложен;
все остаются `ABSTAIN`. Для реальной оценки нужны геометрический
извлекатель, общая система координат, фаза и подтверждённые источники.
[Предметный отчёт](operations/NEXT_UNRESOLVED_BATCH_AUDIT_20260928.md).

Ещё четыре `COORDINATE_ALIGNMENT` кода проверены на оригинальном
публичном ZIP: четыре PDF и четыре страницы/рендера со SHA. Текстовые
совпадения отметки, точки подключения, оси и шахты не устанавливают
общую систему координат или сопоставимую пару редакций. Лексический
профиль отложен до геометрического слоя с проверенным датумом,
масштабом и контрольными точками; все четыре `ABSTAIN`.
[Аудит](operations/NEXT_COORDINATE_ALIGNMENT_AUDIT_20260928.md).

Три `LAYER_ASSEMBLY` кода проверены на четырёх разрешённых оригинальных
PDF и пяти страницах/рендерах по SHA. Таблица дорожной одежды и несколько
типов кровли/стен видны, но bbox отдельного блока не подтверждает
одну строку «тип — материал — толщина» и назначение слоя участку.
`F0154` с.22 требует адресного OCR. Все три `ABSTAIN`; построены
ограниченные предложения о соседстве с обязательной ручной проверкой,
без типизированных слоёв и выводов о нарушении.
[Аудит](operations/NEXT_LAYER_ASSEMBLY_AUDIT_20260928.md).

Отдельный opt-in `LAYER_ASSEMBLY` worker/API/web профиль построен для
`SPZU-032`, `AR-044`, `ZU-125`. `SPZU-032` не дублирует уже существующую
проверку дорожной таблицы; для двух других кодов сохранены только
адресные предложения о соседстве заголовка и текста. Связь строки,
типа конструкции, элемента и зоны остаётся `UNVERIFIED`; толщина и
количество не назначаются. Независимый API сверяет source/text/locator
и immutable release при save/seal/GET. Локальный полный `npm run check`
прошёл: API 313, web 79, worker 786, сборка; последовательный
PostgreSQL suite — 18 файлов/42 теста. Изолированный Compose на
публичных F0156 `CHK-0AFF6FD5` и F0126 `CHK-577B4890` завершён:
оригинальные ZIP/manifest/PDF SHA сверены, 10/10 и 9/9 jobs
`SUCCEEDED`, оба run sealed `PARTIAL`, 0 findings, три `ABSTAIN`
и 0 предложений без проверенного источника. Auth API 200/401,
браузерный просмотр и неизменность v1-v3 SHA прошли; F0126 не
дублирует предложения `SPZU-032`. Адресный OCR F0154 с.22
по оригинальному PDF и повторному кешу показал ошибки распознавания;
все строки остались review-only и `ABSTAIN`.
[Контракт](operations/LAYER_ASSEMBLY_REVIEW_20260928.md),
[OCR-аудит](operations/LAYER_ASSEMBLY_F0154_OCR_AUDIT_20260928.md),
[Compose](operations/LAYER_ASSEMBLY_COMPOSE_20260928.md).

Чистый `geometry-proposal-v1` валидатор проверяет SHA исходного PDF и
PNG, рамку страницы с CropBox/Rotate, координатные преобразования и
границы предлагаемых точек/полигонов. Семь synthetic тестов прошли;
оригинальный F0126 с.17 со сверенным SHA PDF/рендера дал `ABSTAIN`
и ноль кандидатов. Это контракт происхождения геометрии, не
извлекатель объектов, не общая система координат и не предметный факт.
API/release/web для него ещё не подключены. Отдельный read-only Poppler
provider проверяет рамку PDF и для фиксированного `pdftoppm` profile
повторно рендерит PNG с точным сравнением байтов. Шесть тестов,
включая исходный F0126 с.17, прошли. На публичном листе Poppler
округляет box до двух знаков, а worker хранит float32; строгая
независимая проверка отклоняет несовпадение. Формат page frame
нуждается в отдельной согласованной версии. `pdfseparate` тоже
перезаписывает числовые операнды с ограниченной точностью; для
положительных выводов нужен независимый lossless PDF page-tree parser.
[Аудит точности](operations/GEOMETRY_POPPLER_PRECISION_AUDIT_20260928.md).

Отдельный `geometry-page-frame-v2` пакет оставляет только `ABSTAIN` и
пустой список кандидатов. Worker сохраняет frame PyMuPDF, исходный SHA и
точный Poppler PNG; API независимо повторяет PNG и проверяет координаты
worker внутри явно заявленного интервала печати `pdfinfo` ±0,005 pt.
На оригинальном разрешённом F0126 с.17 Python→TS parity прошёл,
worker 5/5 и API 3/3 теста. Это лишь проверенная навигация по листу.
Дополнительный strict verifier сверяет `Math.fround` независимых
исходных числовых операндов PDF с float32 worker. Публичный F0126
с.17 прошёл и этот путь; неизвестный масштаб `/UserUnit` отвергается.
release/save/seal/GET, UI и предметная геометрия пока не подключены.
[Контракт v2](operations/GEOMETRY_PAGE_FRAME_V2_REVIEW_20260928.md).
[План](operations/GEOMETRY_EVIDENCE_PIPELINE_PLAN_20260928.md).

Пять одиночных unresolved-семейств `PZ-006`, `PZ-013`, `AR-045`,
`ZU-127`, `POD-094` проверены на 10 исходных разрешённых PDF и 14
рендерах со сверенными manifest/PDF/page SHA. Все остаются `ABSTAIN`.
Особенно важно, что в F0152 с.49/51 найдена настоящая табличная
строка окна с R=0,65 и требованием 0,50, которую прежний лексический
поиск `ZU-127` пропустил. Источник помечен `PD/OTHER`, РД-спецификация
того же окна не подтверждена; это адрес для review, не факт кода.
Табличные строки `PZ-006` имеют конфликт единиц общего/надземного
объёма, а название школы не доказывает функциональную вместимость
`PZ-013`. Для `AR-045` нужна геометрия кровли, для `POD-094` —
разделение расчёта, договорного лимита и фактического талона.
[Аудит](operations/SINGLETON_UNRESOLVED_FAMILY_AUDIT_20260928.md).

Для `PZ-006` чистый extractor на SHA-верном F0101 с.9 дал семь
некодированных word-cell подсказок. Он явно сохраняет конфликт единиц
общего/частного объёма и несоответствие названия/триггера каталога,
всегда возвращает `ABSTAIN` и `typedFact=null`. Три теста прошли.
Чистый API verifier повторяет группировку и хеши полного списка слов.
На оригинальном F0101 с.9 независимый Poppler нашёл все 322 слова
PyMuPDF как уникальные пары текста и bbox, но в другом порядке.
Отдельный строгий полный bijection gate и Python-order replay приняли
семь предложений только как review-only; 6/6 тестов прошли.
`wordIndex` PyMuPDF не воспроизведён Poppler, а связь ячеек в строки
не доказана. Durable путь не подключён.
[Граница полной сверки](operations/PZ006_COMPLETE_WORD_REVIEW_GATE_20260928.md).

Для `ZU-127` отдельный pure extractor на исходном SHA-верном F0152
с.49/51 сохранил четыре word-bbox подсказки: окно и витраж разделены,
показатели R и U не смешаны, сводные 0,50/0,65 и 0,50/0,85 остаются
сырыми соседними ячейками. Пять профильных тестов прошли. Статус
`ABSTAIN`, row association и соответствие конкретному изделию
`UNVERIFIED`, фактов/coverage нет. Чистый API verifier проверяет
SHA/локаторы/счётчики только при наличии независимого полного списка
слов; synthetic parity и подмены, а также Poppler corroboration
отдельных слов на F0152 с.49/51 прошли 6/6. Poppler не воспроизводит
wordIndex PyMuPDF и не доказывает полноту списка, поэтому реальный
durable save/seal/GET пока остаётся fail-closed. Сквозная интеграция
не завершена.
[Контракт](operations/ZU127_WINDOW_TABLE_PROPOSALS_20260928.md).
Отдельный API-owned Poppler provider полного списка слов на оригинальном
F0152 с.49/51 подтвердил несовпадение сегментации с PyMuPDF:
132/135 и 175/173 слов соответственно. Строгая проверка корректно
отклоняет обе страницы; четыре адресных слова не заменяют полноту.
[Аудит полной независимой проверки](operations/ZU127_FULL_WORD_INDEPENDENCE_AUDIT_20260928.md).
Новый отдельный Poppler v2 профиль повторно нашёл четыре адреса на
F0152 с.49/51, сохранив сноски отдельными словами. Локально API
повторно прочитал исходный SHA-верный PDF и сверил все слова, версию
Poppler, хеши и предложения; synthetic и real parity прошли. Это
остаётся offline review: обычный homeserver API имеет Poppler 25.12.0,
worker пока не имеет `pdftotext`, тогда как первоначальный локальный
тест шёл на 25.03.0. Отдельный networkless/read-only Compose образ с
Poppler 25.12.0 затем прошёл локально и на homeserver по оригинальному
F0152: 135/173 слов, четыре предложения, `ABSTAIN`, null findings,
одинаковый contentHash. Обычные сервисы не менялись; durable профиль
по-прежнему выключен до интеграции версионированного runtime.
[Проверка v2](operations/ZU127_POPPLER_V2_REVIEW_20260928.md).
[Изолированный Compose](operations/ZU127_POPPLER_ONESHOT_PROOF_20260928.md).
Отдельный чистый worker wrapper для этого профиля требует явного
release slot, SHA F0152, решения `CURRENT/APPROVED` с вручную
подтверждённым `sectionCode=ZU` и Poppler 25.12.0 до чтения PDF.
Без решения он возвращает `ABSTAIN`/0 предложений. Пять focused
unittest прошли. Wrapper не зарегистрирован в штатном
`RULE_EVALUATION`, так что это не утверждение о run-интеграции.

Для `PZ-013` pure exclusion gate на оригинальных публичных F0148 с.167
и F0203 с.23 отделил название «Школа на 600 мест» от нагрузки
наружного освещения 4,49 кВт и водоснабжения 107,5 м³/сут.
Пять профильных тестов прошли; оба результата `ABSTAIN`, без вывода о
функциональной вместимости. [Контракт](operations/PZ013_CAPACITY_PROPOSALS_20260928.md).

Для `POD-094` pure review extractor на SHA-верных F0189 с.99–100 и
F0071 с.5 отделил два предложения расчётной массы отходов (259,875 т
IV класса и 28,875 т V класса) от договорного ориентировочного
количества железобетона 350 т V класса. Цена 55,00 не стала массой,
договорное количество не стало фактической передачей. Четыре теста
прошли; связь разных документов и партий не заявлена, всё `ABSTAIN`.
[Контракт](operations/POD094_WASTE_CHAIN_PROPOSALS_20260928.md).

Для 13 геометрических unresolved кодов появился отдельный чистый
`geometry-registration-v1`: аффинное преобразование по трём заранее
выбранным контрольным точкам, независимые holdout-точки, проверка
масштаба, ориентации, выпуклой области и численного roundtrip. Это
синтетически проверенный расчёт (19 геометрических тестов), всегда
`REVIEW_ONLY` с пустыми фактами; реальные реперы, CRS, render/source
решения и durable путь не подключены.
[Контракт](operations/GEOMETRY_REGISTRATION_V1_20260928.md).
Чистый TypeScript verifier отдельно воспроизводит affine, holdouts,
inverse, область и пустой `facts`; Python→TS synthetic parity и
пять профильных тестов прошли. Он требует доверенные решения о
контрольных точках и рамке, которых в текущем runtime ещё нет.
Проверка разрешённого public manifest, индекса и открытой разметки
не нашла подтверждённых пар контрольных точек или CRS: сохранённые
bbox задают лишь координаты на странице PDF. Поэтому все 13
геометрических кодов сохраняют `ABSTAIN`; synthetic affine fit не
является привязкой двух чертежей.

Четыре `EXTERNAL_EVENT_CHAIN` кода `OOS-098`–`101` проверены на
оригинальных разрешённых F0071/F0114/F0161: manifest/PDF/page SHA и
четыре рендера закреплены. Договорные обязанности, проектная
рекомендация и упоминание ГЛОНАСС у шкафа освещения не доказывают
реальное событие перевозки или статус внешнего реестра. Все четыре
`ABSTAIN`; новый лексический профиль отложен до авторизованного
снимка внешних событий с проверкой полномочия, времени и связей
объект–транспорт–рейс–партия.
[Предметный аудит](operations/EXTERNAL_EVENT_CHAIN_AUDIT_20260928.md).

Три `STRUCTURAL_DETAIL` кода `KR-063`, `KR-065`, `POD-096` проверены
на пяти исходных разрешённых PDF и шести рендерах со сверенными SHA.
Рабочий шов нельзя назначить деформационным; отверстия №7 и №5 на
разных листах нельзя считать одним элементом; проектная деталь
заделки не является нарушением. Для `POD-096` просмотренные временные
конструкции котлована не доказывают узел сохраняемой конструкции при
демонтаже. Все три `ABSTAIN`; ограниченный следующий технический
пакет — навигационные предложения по `KR-065` без привязки контура,
армирования или сравнения редакций.
[Аудит](operations/STRUCTURAL_DETAIL_AUDIT_20260928.md).

Для `KR-065` отдельно создан чистый bounded extractor навигационных
подписей проёмов с source/page/block/line SHA. На оригинальных F0141
с.23, F0143 с.21 и F0142 с.12 он различает номера отверстий и два
заголовка проектной заделки; все предложения `ABSTAIN`, связь с
контуром, элементом и армированием не установлена. Пять профильных
тестов с реальными разрешёнными PDF прошли. Отдельный opt-in worker/API/web
профиль теперь подключён; независимый API сверяет исходные source/text
SHA и локаторы при save/seal/GET. Полный локальный `npm run check`
прошёл: API 319, web 81, worker 804 и сборка; PostgreSQL suite —
19 файлов/43 теста. Публичный F0141/F0142/F0143 parity probe с
реальными `UNKNOWN` решениями дал 0 run proposals, без подмены
решения эксперта. Изолированный Compose на исходном публичном F0141
`CHK-DDFAE354` прошёл: ZIP/manifest/PDF SHA сверены, 9/9 jobs
`SUCCEEDED`, sealed `PARTIAL`, 0 findings, `KR-065 ABSTAIN`,
0 предложений и 0 допущенных источников. Авторизованный GET и
браузерная панель проверены, прежние sidecar SHA неизменны. После
исправления подписи при нуле предложений полный web suite — 82/82.
Установленный worker пакет проверен отдельным layout-тестом.
[Контракт](operations/KR065_OPENING_REVIEW_20260928.md),
[Compose](operations/KR065_OPENING_COMPOSE_20260928.md).

Два `METHOD_SEQUENCE` кода `POS-087` и `POD-091` проверены на трёх
разрешённых оригинальных PDF и шести рендерах с SHA. Описанная в ПД
последовательность не доказывает фактический журнал, утверждённый ППР
или согласование изменения; временная распорка котлована не равна
демонтажу здания. Оба `ABSTAIN`; предметное сравнение отложено до
проверенных операции, фазы и фактической записи.
[Аудит](operations/METHOD_SEQUENCE_AUDIT_20260928.md).

Два `SITE_FEATURE_LAYOUT` кода `SPZU-036` и `POS-089` проверены на
четырёх разрешённых оригинальных PDF и восьми страницах/рендерах
с SHA. Текст и легенды дают адреса для ручного просмотра, но не
регистрируют участок ограждения, положение мойки относительно выезда
или фактическое исполнение. Оба `ABSTAIN`; новый лексический профиль
не нужен, следующий технический срез — предложения геометрии на
F0154 с.19 и F0112 с.79 после независимого page-frame/рендера.
[Аудит](operations/SITE_FEATURE_LAYOUT_AUDIT_20260928.md).

Два `PARKING_LAYOUT` кода `SPZU-038` и `ODI-121` проверены на
четырёх разрешённых оригинальных PDF и девяти рендерах с SHA.
Расчётные 64/2 места и текст 3,6 × 6 м нельзя автоматически
приписать отдельным контурам; наземные места и подземная стоянка
должны оставаться разными областями. Для школьного объекта заявлено
отсутствие парковки внутри участка, но внешние места и высадка
имеют иной scope. Оба кода `ABSTAIN`, новый лексический профиль
отложен до геометрических предложений и проверки связи символа,
контура и размерной линии.
[Аудит](operations/PARKING_LAYOUT_AUDIT_20260928.md).

Для `OOS-098`–`101` построен чистый offline контракт цепочки внешних
событий. Девять synthetic тестов и полный worker suite 800/800
прошли; даже согласованная synthetic цепочка остаётся review-only с
`ABSTAIN` и null findings/coverage. Реальные подписанные снимки
реестров и независимая проверка полномочий отсутствуют, поэтому
release/API/Compose не подключены.

Последний полный локальный `npm run check` после ZU-127/PZ-006,
PZ-013/POD-094, geometry review и исправления web-этапа завершился
успешно: API 362 passed/45 skipped, web 82 passed, worker 843 tests
(5 skip), остальные Python suites и сборка прошли. Более поздние
новые семейные модули нужно проверять после их завершения.

Независимый API replay для `POD-094` сверяет исходные SHA, все три
страницы, локаторы, роли и `ABSTAIN`/null. Профильные тесты 4/4 и
API typecheck прошли. На оригинальных F0189 и F0071 проверка полного
списка слов через Poppler отклоняет результат: F0189 с.99 422/423,
с.100 388/393 слова (PyMuPDF/Poppler), F0071 с.5 одинаковые 365
слов, но полная пара текст/координаты не совпадает. Durable интеграция
закрыта до доказанного независимого соответствия.
[Аудит](operations/POD094_INDEPENDENT_REVIEW_GATE_20260928.md).

Следующий equipment-spec срез `IOS2-073`/`ODI-115` просмотрен на
исходных публичных F0165 с.26 и F0160 с.37 с PDF/render SHA.
Спецификация пожарной насосной установки не подтверждает станцию
хозяйственно питьевого водоснабжения; обозначение щита питания
подъёмника не подтверждает модель и режим самого подъёмника.
Оба кода `ABSTAIN`, находок и coverage нет. Строки и идентичность
оборудования остаются непроверенными.
[Аудит](operations/NEXT_EQUIPMENT_SPEC_PUBLIC_AUDIT_20260928.md).
Отдельный pure worker на тех же SHA-проверенных страницах нашёл
ровно по одному исключающему контексту: пожарный спринклерный насос
и щит питания подъёмника. Оба предложения помечены
`INELIGIBLE_FOR_PARAMETER_FACT`, оба результата `ABSTAIN` с null
фактами/findings/coverage. Профильные тесты на оригиналах 3/3;
API/release/save/seal/GET не подключены.
[Контракт](operations/EQUIPMENT_SPEC_FALSE_NEAR_REVIEW_20260928.md).

Для выбранных исключающих фраз F0165 с.26 и F0160 с.37 независимый
Poppler `25.03.0` подтвердил точный текст и локальные координаты:
максимальное расхождение границ соответственно 0,000103 pt и
0,533068 pt. Это допускает только адресную навигационную подсказку;
полнота сканирования страницы, факт об оборудовании и отсутствие
других контекстов не подтверждены. Отдельный API/durable профиль не
подключён.

Подготовлена отдельная политика очереди `ZU-127` Poppler v2.
Claim теперь сверяет неизменяемый release SHA/byte length, сохранённое
имя очереди и заявленное имя для специализированной очереди до
выдачи lease; PostgreSQL основной файл прошёл 23/23, включая подмену
очереди. Профиль ещё не включён в release/run/outbox, специализированный
F0152 адаптер остаётся fixture-only и не потребляет сообщения.
API повторной проверки требует Poppler ровно `25.12.0`; локальный
`25.03.0` отвергается. Пересобранный изолированный one-shot на
исходном F0152 прошёл локально и на homeserver: 135/173 слова, четыре
предложения только для просмотра, `ABSTAIN`, null findings, один и тот
же contentHash. Сквозного durable результата
пока нет. [Граница](operations/ZU127_QUEUE_POLICY_20260928.md).

Fixture-only ZU-127 specialist образ собран локально. Его pinned Poppler
`25.12.0` предварительная проверка прошла после исправления разбора
многострочного `-v`; штатный запуск по-прежнему отказывает до durable
контракта и не потребляет очередь. Это проверено в networkless/read-only
контейнере. [План](operations/ZU127_SPECIALIST_WORKER_PLAN_20260928.md).

API Docker image также теперь закрепляет `poppler-utils=25.12.0-r1` и
проверяет версии `pdftotext`/`pdfinfo` при сборке. Локальный probe image
`sha256:af07dc8eb562c16b40079aee9007616575c9922ae980c07d76cdf823cacd8ba0`
собран успешно; оба инструмента показали `25.12.0` в контейнере без сети и
с read-only filesystem. Обычный API на homeserver не заменялся; это
только согласование версии парсера, без durable результата ZU-127.

Общий ограниченный `poppler-page-evidence-v1` теперь извлекает полный
список слов и текст не более четырёх выбранных страниц из SHA-верного
PDF. Независимый API повторяет извлечение в закреплённом Poppler 25.12.0
и сверяет каждый wordIndex, bbox и hash. На оригинальном разрешённом
F0152 с.49/51 изолированный replay совпал: 135/173 слова и один
contentHash; удалённое слово отвергнуто. Это навигация, всегда
`ABSTAIN` без фактов и findings. Отдельный ZU-127 selector v3 выбирает
до четырёх кандидатов из SHA-проверенного `document-text-v2`, явно
считает OCR_REQUIRED и усечённые страницы; синтетические тесты 9/9.
Source review/committed artifact должны быть аутентифицированы durable
слоем; release, save/seal/GET и сквозной Compose ещё не подключены.
[Worker](operations/POPPLER_PAGE_EVIDENCE_V1_20260928.md),
[API](operations/POPPLER_PAGE_EVIDENCE_API_20260928.md),
[селектор](operations/ZU127_PAGE_SELECTION_V3_20260928.md).

Для ZU-127 v3 добавлен отдельный opt-in fenced stage: он связывает
селектор с полным Poppler evidence, проверяет исходный SHA и не открывает
PDF без проверяемого решения `CURRENT/APPROVED` и выбранного листа.
Независимый pure API verifier пересчитывает выбор страниц и сверяет
полный receipt по оригинальным PDF-байтам; Python/TypeScript synthetic
parity и проверки подмены пройдены. Stage не зарегистрирован в очереди,
release builder или durable save/seal/GET. Реального утверждённого
решения по источнику и сквозного run v3 нет.
[Stage](operations/ZU127_GENERIC_STAGE_V3_20260928.md),
[API verifier](operations/ZU127_GENERIC_RESULT_API_20260928.md).

После этих изменений полный локальный `env PATH=services/worker/.venv/bin:$PATH
npm run check` прошёл: API 380 tests passed/45 skipped, web 82 passed,
Python suites и production build завершились с кодом 0. Это не
подтверждает интеграцию нового пакета в durable run.

После добавления составного ZU-127 v3 контракта повторные typecheck,
тесты и build завершились: API 390 passed/45 skipped, web 82 passed,
worker 874 tests (6 skipped), остальные Python suites и production
build без ошибок. Повторный полный `npm run check` после исправления
обёртки журнала завершился с кодом 0.

Для F0165 с.26/F0160 с.37 добавлен отдельный pure API verifier выбранного
фрагмента. На двух SHA-верных оригиналах он независимо сверил единственную
исключающую фразу и bbox через Poppler `25.03.0`; 8/8 профильных тестов.
Результат явно содержит `PAGE_SCAN_COMPLETENESS_UNVERIFIED`, `ABSTAIN`,
null fact/findings/coverage и запрет durable save. Иная версия Poppler,
включая homeserver `25.12.0`, закрыта до отдельной проверки.
[Контракт](operations/EQUIPMENT_FALSE_NEAR_SELECTED_SPAN_API_20260928.md).

## Кандидаты на замечания, 29 сентября 2026

Отдельный `REVIEW_CANDIDATE` подключён к существующему durable run, API и
web. Артефакт не меняет findings и coverage; инспектор видит исходный PDF,
строку и фрагмент, причину неопределённости, может оставить подсказку для
проверки или отклонить её и выгрузить JSON. Независимая API-проверка
повторяет SHA и локаторы при записи и чтении.

На 36 SHA-проверенных исходных `TRAIN_PUBLIC/INCLUDE/PUBLIC_TRAIN` PDF
получено 164 карточки по 72 кодам матрицы и одному свободному коду; два
неразмеченных контрольных PDF дали одну карточку. Все 164 локатора прошли независимую
проверку и рендер. На открытых положительных метках page-level recall@50
равен 4/4 группам, но подтверждённых полных пар ПД/РД нет. Открытых
отрицательных меток нет; FPR и F1 не оценены.

В изолированном локальном Compose живые run F0171 и F0104 завершились
`PARTIAL` с 8 кандидатами каждый, 0 findings и 5 официальными `ABSTAIN`;
API и web открыли страницы и фрагменты, решения записаны и экспортированы.
На свежей проверенной сборке также завершился парный F0104+F0145 run
`CHK-5FA94BDE`: 15 адресных подсказок, 0 findings, исходный лист и фрагмент
AR-050 открыты в web; `ACCEPT_FOR_REVIEW`, `REJECT` и повтор решения проверены.
Неустановленный раздел не превратился в предполагаемую пару.
На финальной сборке новый run F0106 `CHK-26CA6BC0` дал 11 подсказок,
включая KR-058 на исходной странице 53; API и web открыли лист и фрагмент,
решение `ACCEPT_FOR_REVIEW` сохранено без finding или протокола.
На расширенной сборке F0126 `CHK-E0763719` дал 5 подсказок; PZ-012 на листе 14
открыт в API и web, решение принято для проверки и экспортировано отдельно,
официальный протокол пуст.
На последней сборке F0163 `CHK-D5DBED8E` дал 2 подсказки; IOS2-072 на листе 9
открыт в API и web, решение принято для проверки и экспортировано отдельно,
официальный протокол также пуст.
Парный F0171+F0202 здесь завершился `FAILED`, поскольку локальный OCR
provider не подключён. API unit 412 passed/47 skipped, PostgreSQL
integration 23 passed, адресные worker tests 5 passed в последнем прогоне, typecheck и web
build прошли. Закреплённые Docker образы не были доступны из реестра,
поэтому локальный Compose использовал диагностический overlay с уже
установленными образами. H100 не проверялся. Официальный конкурсный
экспорт остаётся `BLOCKED_CONTRACT` без scorer и уточнения matching.

[Доказательства и шаги воспроизведения](operations/REVIEW_CANDIDATES_20260929.md).

Дополнительный публичный проход 29 сентября увеличил адресные подсказки до
249 уникальных карточек по 110 из 132 кодов на 47 SHA-проверенных оригинальных
PDF. В повторном F0193 найден сигнал PPM-105 на странице 72; самостоятельная
проверка приняла 16/16 карточек и открыла 16/16 фрагментов исходного PDF.
Направление выходов В2/В3 непосредственно наружу не подтверждено. Для
всех 66 карточек шести предшествующих прогонов, 14 карточек повторного F0112
и 8 карточек F0158/F0170 также выполнены независимая API-проверка и рендер.
Это не меняет официальный coverage и не служит подтверждением нарушения.

Гостевой обзор трёх разрешённых оригиналов F0101/F0142/F0147 добавлен через
явный allowlist объектов в API. На изолированном homeserver после пересоздания
API и web браузер без пароля показал три объекта с 6/3/2 кандидатами,
открыл исходный лист и фрагмент. В API smoke подтверждены исходные SHA,
immutable hashes артефактов, PNG страниц, запрет записи (403) и скрытие
чужого объекта (404). В списке из 17 подсказок убран вложенный скролл;
последняя карточка достигается прокруткой страницы. Сводка больше не
показывает плитку «Не поддерживается 125» и прежний текст про неполный анализ;
причины ограничения оставлены в разделе «Ограничения анализа».
Повторный API suite прошёл 416/47 skipped с четырьмя workers и штатным
таймаутом; web suite 94/94, API/web typecheck и web build прошли.
H100 runtime недоступен; guard итогового server Compose на временном env
с семью конкурсными профилями и одним GPU прошёл, 7/7 тестов guard прошли.
[Инструкция и receipt](operations/PUBLIC_REVIEW_VISITOR_20260929.md).

## Открытый рабочий контур, 29 сентября 2026

Compose по умолчанию включает `INSPECTOR_OPEN_WORKSPACE=1`. Web убрал вход,
регистрацию и профиль: на старте получает серверную рабочую сессию без пароля.
Общий пользователь получает права на объекты текущей организации, включая
существующие; новые объекты наследуют обычный audited command path. Cookie,
CSRF, idempotency, объектные проверки и журнал решений сохранены. Парольный
маршрут возвращает 404 в этом режиме; при `INSPECTOR_OPEN_WORKSPACE=0`
старый API-путь остаётся для совместимости. Все посетители доступного стенда
могут менять данные его организации, поэтому Compose по умолчанию привязан
к loopback.

Проверка: web build/typecheck и 94 теста; API typecheck и 418 тестов
(48 пропущены без PostgreSQL); отдельный PostgreSQL integration создал
сессию без пароля, открыл ранее существовавший объект, создал новый через
CSRF/idempotency и прочёл его обратно. Изолированный локальный Compose
пересобрал API и web, оба healthy. В браузере `127.0.0.1:38081` кабинет
открылся без формы входа, список существующих объектов показан, форма
«Новый объект проверки» доступна. Это не проверка homeserver или H100.


T54 2026-10-18 06:51 UTC: UI_ACCEPTED_BROWSER_PENDING. Water-node source review/comparison UI installed on ordinary homeserver, web774/774PASS, independent81 included.65snapshots/203scalar targets/132legacy targets/1local review/FAILED response unchanged. Only web replaced;6backend and20other containers unchanged. v8 coverage remains59parameters/67partial atoms/73UNSUPPORTED, realqualified0/nullprobability. Evidence: output/matrix-t54-20261018/acceptance.json. T55 real printed-coordinate preview starts immediately; browser hold remains explicit.

### 19.10 15:47 MSK — T83 aggregate accepted; continuing T84/T85

Actual ROOT v5 builder+acceptor exited 0. Acceptance `6dd3217ffa51dd69efd7e5b279453811dbabe07f686257d404a8e7c8534b656e`; evidence manifest `88e62b28ca689bc79779176df149ad166b8aa881c3a42738e7d2b83c958fa7ca`; source1461 freeze `e62c7b422114cba6bacae1fbfb2cc7f14898a046460e566931c73d2b2f45f6db`. Genuine local PG3/API/installed checks and ordinary homeserver sample accepted together. Runtime preservation mode NO_SERVICE_MUTATION: all26 exact before/after, lifecycle calls0, restoration unnecessary (false/null); historical StartedAt drift not requalified. Stand remains T81, browser security hold remains, real qualified pairs0/calibrated probability null.

T85 budget consumer V1 compiler RED (test array annotation) and V2 mock RED (stub returned wrong review ID before budget charge) retained separately. V3 corrects only stub to frozen manual [67108864,1]; one bounded compiler/mock1/realPG4 run in progress, no automatic retry. Targets/review/steel source proposals remain output-only pending full integration. T84 fresh seven-role rollout and finite genuine accepted-base capsule preparation now unblocked. Goal remains active.

### 19.10 15:53 MSK — T85 preparation checks progressed

Budget V3 independent consumer actually passed focused noEmit/mock1/realPG4 (outcome `545644bdc9cd48e6870986e5541ed5bf2ac3622b553076529c57641b638b39da`), own database remaining0, all protected inputs exact. Corrected targets/review/steel API composition V3 full API+contracts noEmit PASS (`87c33cb9b8c1127563e652deedd3b8ecb460ab7fba92d46803788315b79840ad`), build only, no runtime authority. Prior V2 typing RED retained.

UI whole floor scopes/editor state/strict confidence ReactSSR58 passed (`bc6f7deb7d7b99eec1e97da571bd773d43bf893c4b1b26e99020211d0ee50b3e`); complete web+contracts noEmit then passed (`54b2717d54ee59c12c4b9b6f2c4561749741991ba8d4696d4b2334b93ff66fea`). First web check omitted genuine transitive files in private copy; correction adds exact imports without changing DUT/tests/config/resource limits, first RED retained. No browser or mounted interaction proof.

Finite genuine accepted-base capsule and fresh T84 rollout preparation continue. Wall source proposals remain output-only. Generic v13 fact-target/origin support is an explicit next functional gap: current wall-only reader must not be treated as complete annotation coverage for other parameters. Real qualified pairs0, calibrated probabilitynull.


### 2026-10-19: steel preparation limits and genuine accepted-base composition

Actual supplemental steel consumer: noEmit + mock1 + genuine PostgreSQL3 PASS in9.398s; fixed512MiB/55CPU/60wall limits unchanged. Outcome `output/matrix-t85-20261019/steel-admission-precharge-v13-v1/independent-consumer-v2/first-results/after.json` SHA4d217aa00875f3c4f1b9df8859879a3aed914b70da8c1b9f0eee6dce0d179380. Default-forks V1 RSS first RED retained; V2 only selects threads, expectations/DUT/runner exact. Normal ownDB cleanup0 and all protected inputs unchanged. Resource tests grant no source/release/actor authority.

ROOT independently reviewed four whole finite historical definitions, genuine accepted v12 config10a652…7bf2,52 unchanged source/resource pins and identical API/worker capsule0632bc…f9e39. Output composition ready9a7b28…233a1 has final6 actual worker hashes and explicit API catalog COPY; no live promotion/runtime acceptance.

T84 reviewed9 output-harness promotions archived old bytes; fresh freeze6e1be45a02b870171e44d8f88e53a5f599ead0a95d78002a7f44d0672fc1c937 contains1051files including overlay. Auth-refresh failed locally beforeSSH/POST because expected ephemeral credential file is absent. Existing identity-only recovery preparation underway; stand still old v11. Reminder removed, homeserver available, no browser proof, real qualified0/probability null.

### 2026-10-19 16:14 MSK — T84 fresh existing identity and preflight

Existing actor session recovered by one audited open-workspace POST, usersCreated0/permissionWideningfalse/memberships exact. Fresh preflight PASS: all27 containers running, activeRuns/jobs0, old43 migration checksums and source inputs unchanged,20 unrelated runtime tuples exact. Historical785GET preservation is in progress before build/activation. Stand remains v11; no T84 runtime acceptance yet.

### 2026-10-19 16:20 MSK — T84 activated, installed pins PASS

Historical785GET before deployment PASS83af9969…e9d1a. Three serial image groups built, only additive044/045 applied; old43 exact. Seven named roles recreated. Actual installed probe PASS:168 modules and25 rules in each of4 workers, API/outbox source pins, genuine v12 policy10a652…7bf2 and3 served asset hashes exact. This is installed-code proof; post-deploy historical785GET preservation is running, normal queue79 jobs/restart/final acceptance still pending. Browser proof absent.


### 19 октября, 20:17 MSK — установка исправления и UI3

- На обычном homeserver установлено исправление повторного чтения происхождения пары. Проверка установленных модулей и все785 исторических HTTP/SQL результатов прошли;20 соседних контейнеров сохранены относительно фиксированной исходной точки.
- UI3 V3: два TypeScript build check, Vite build и123 pure SSR теста в пяти файлах PASS;29 собранных assets зарегистрированы. Это не браузерная проверка взаимодействий.
- Полный combined104 regression пока не принят: после35 успешных runtime фаз отказал PUBLIC_TARGETS. Отдельный diagnostic36 подтвердил совпадение сохранённой/текущей конфигурации; отказ возникает при чтении исходных scalar фактов. Исходные результаты RED сохранены, причина исследуется.
- Продолжение T84 первоначально остановилось до POST из-за неверного SQL-поля в consumer precheck. Consumer-only correction читает projection_json.status; исходные ключ/тело/assertions неизменны. Продолжение выполняется отдельным первым запуском.

Доказательства: output/matrix-t85-20261019/combined-ui3-consumer-preparation-v3/root-actual-acceptance.json; output/matrix-t84-20261018/pair-deadline-runtime-amendment-v1/preservation-after-deploy.json; output/matrix-t85-20261019/combined-targets-first-red-diagnosis-v1/diagnostic-consumer-v1/first-results/outcome.json.

### 19 октября, 20:32 MSK — реальный positive run T84 завершён

На обычном homeserver исходный pair-positive POST завершился201; normal run CHK-E09624DF завершён и запечатан. Whole comparison/evidence14/coverage/OCR/job assertions прошли. Проверка submission остановилась на старом ожидании пустых значений: действующий formatter сохраняет площади кандидата 900000 мм² и750000 мм² при COMPARISON_IMPOSSIBLE, evidence[] и calibrated probability null. Готовится отдельный consumer-only verification fix с literal whole-row oracle; повторный pair/run POST запрещён, уже завершённый positive будет проверен чтением. Оставшиеся5 сценариев ещё не запускались.

Гарантированное несоответствие canonical domain T85 исправлено в output-кандидате: raw provenance содержит confidence threshold0.8, тогда как старый V7 canonicalizer допускает только целые числа. V7 contract сохранён, выбран существующий V13 native canonicalizer с прежними капами. Exact full94 first corrected run выполняется отдельно; захваченный exception пока не установлен, runtime PASS не заявляется.

### 19 октября, 20:42 MSK — positive readback принят; два следующих ограничения

T84 positive CHK-E09624DF полностью проверен GET/SELECT, HTTPPostCalls0; повторных pair/run POST нет. Затем pair-unknown записан DONE/UNKNOWN, run-unknown ещё не создан. Чтение полного PDF139pages/23871472bytes остановилось на SSH75s. Следующий отдельный bounded SSH true тоже завершился ConnectTimeout8/exit255; причина исходного чтения не установлена как один только объём передачи. Начата consumer-only подготовка полного remote GET SHA+byte-count proof без передачи PDFbase64, с прежними пределами размера/времени. Старые RED/receipts неизменны.

T85 raw scalar canonical correction: actual build и5 pure node:test vectors PASS за7.56s, исходный порог0.8/V7 reject/целочисленный канон/изменение хеша/не-native types. Полный corrected94 остановился раньше TARGETS: RULE_EVALUATION COMPLETE8 API RSS537149440>536870912, cleanup0/ownDBdropped/privategone/sourcepins exact. Лимиты не подняты; исследуются удержание preparation A во время C и нужные canonical materializations.

Snapshot helper:6 synthetic fixture cases PASS за0.097s, whole literal manifest/copy/ошибочныеpins/unsafe paths/existing target/детерминированный source drift cleanup. Это только packaging proof, реальный финальный snapshot ещё не собран.

### 2026-10-19 20:57 MSK: память и транспорт

- Новый v13 compact preparation прошёл прежние места отказа RSS и BOOTSTRAP_TARGETS. Full94 остановлен после 38 успешных runtime-фаз на WRONG_FLOOR_SOURCE_ROLE: API MATRIX_FACT_TARGET_MISMATCH, ожидание MATRIX_FACT_RULE_MISMATCH. Полный набор ещё не принят; исходный отказ сохранён, идёт проверка контракта. Лимиты прежние, максимум пройденных runtime-фаз 495652864 bytes. Owned DB удалена, private526 убраны, protected pins exact.
- Whole-content transport: 14 закрытых локальных fixture-проверок PASS, outcome d80f42cf5408c2dca09fd8d845dd8f03fd13de0b5ff242f98a89ef08e77300ea. Проверены EOF/64KiB/32MiB/+1/truncation/hash/status/redirect/deadline. Это не доказательство реального server GET. V2 parent receipt bug сохранён отдельно.
- SSH восстановлен; новый прогон на homeserver не запускался: MemAvailable1405860 KiB ниже1572864 KiB. Соседние сервисы не менялись. Асинхронно запрошена координация памяти; локальная работа продолжается.

### 2026-10-19 21:50 MSK: текущая политика, реальные чтения и продолжение T84

- Current-policy parity: actual TypeScript build и14 genuine вызовов PASS (`d6d68232ff99bc0f9cc5efa84fe1ba0aac8ed52d0960f46a2fb4831cb0eee159`); whole v13 policy/definitions/installed identity и finite v9–v12 проверены. Все111 импортированных/проверенных файлов exact относительно104V5; это не полный PostgreSQL или browser gate.
- T84 unknown CHK-9164FA62 принят целиком: journal, полные original PDF GET/hash/bytes, matrix/submission/SQL/OCR,10 задач с первой попытки. Исходный unknown pair POST не повторён. Контроллер70457 затем потерян без exit status; withdrawn CHK-7698418C уже terminal/sealed, все10 задач SUCCEEDED/attempt1, но его whole verification тогда ещё отсутствовала. Причина потери контроллера UNKNOWN.
- Новый104V5 full94 сначала оставил68 успешных phase receipts, включая WRONG_FLOOR_SOURCE_ROLE; после потери процесса тестовая БД удалена отдельным bounded cleanup, private526 убраны. Полного PASS нет. Отдельный явно принятый повтор сохранил RED BOOTSTRAP_08_WORK: API467034112 + Python69926912 =536961024 bytes, выше512MiB на90112 bytes. Outcome `0ea1f0f6e848672ddda4acb23e589e251f3ae6823cc003e90ce54b334e96d8eb`; cleanup0/DB dropped/private gone/protected exact. Лимиты не менялись, автоматического повтора нет; исследуется удержание полного preparation при worker GET.
- Existing-user renewal реально PASS: один public endpoint POST, usersCreated0, permissionWideningfalse, whole memberships exact; новая сессия до20.10 02:47:51 UTC. Пакет `output/matrix-t84-20261018/existing-session-renewal-20261019-v1/`.
- После fresh active0/auth2h/MemAvailable1818436KiB запущен отдельный controller `done-withdrawn-handle-recovery-v1`: GET-only whole withdrawn readback, затем только ещё не выданные reapproved/stale/freshapproval. Старые DONE POST повторять запрещено; новый aggregate и postflight ещё не приняты.

Фактическое v12 покрытие остаётся62 параметра/70 partial atoms/70 UNSUPPORTED; real qualified pairs0, calibrated probability null. UI123 SSR не заменяет browser proof; browser security hold сохраняется. H100 и соседние сервисы не использовались.


## 19.10 22:07 МСК — продолжение приёмки, V13 worker memory

Завершённый withdrawn `CHK-7698418C` проверен целиком:9 GET,0 POST, исходные PDF, журнал, matrix/submission и SQL/OCR checks PASS. SHA отчёта `11733525e625e9cd56f90d0564ea447d45beccf1bd7d4bfa126a948e85c27381`. Контроллер затем завершился exit1 на RAM gate1.5GiB ДО выдачи reapproved; три следующих сценария не выдавались, PENDING нет. Старые DONE команды не повторяются.

Полный104V5 прогон сохранил firstRED BOOTSTRAP_08_WORK:536961024 bytes при лимите536870912; cleanup0, owned DB удалена, private copies удалены, защищённые pins exact. Подготовлен104V6: полный снимок A в worker GET освобождается отдельной областью владения после COMMIT; до PDF B и полного свежего C остаются только fingerprint и detached four-field references. Полные проверки C и V7 canonicalization сохранены. ROOT проверил diff,6 случаев и828 pins; полный94 сейчас выполняется отдельным процессом с durable terminal, исходные лимиты/оракулы/cleanup без изменений. Runtime PASS пока не заявлен.

Для обычного стенда подготовлены конкретные immutable build contexts и7 новых image tags, API opt-in V13; новые image IDs ещё не существуют. Standalone read-only collector реализован, не выполнен:27 контейнеров/45 checksums/конфигурация/OCR/785 whole HTTP и15 исторических SQL. Snapshot и установка ждут фактической приёмки T84 и104V6. Напоминание о доступе homeserver ранее удалено. Browser security hold сохраняется.


### 2026-10-19 22:21 MSK — T84 reapproved принят;104V7 проверяется

T84 reapproved CHK-A062D46A проверен целиком, SHA8696e6ba81bae0b3b6a306582f7954c88a9de937f92717ae5032eb6412fbdb9b; все10 заданий SUCCEEDED/attempt1. Контроллер tail-three-after-capacity-v2 завершился exit1 на следующем RAM gate1.5GiB; stale/freshapproval ещё не выданы,16 операций DONE, PENDING нет. Повторы завершённых команд не выполняются. Соседние сервисы сохраняются; запрошена координация памяти для продолжения двух оставшихся сценариев.

104V6 полный прогон сохранил RED REVIEWED_08_WORK: API474591232+Python70266880=544858112 bytes при лимите536870912.68 этапов с BUILD_ONLY прошли; cleanup0/owned DB удалена/private gone/protected pins exact. Outcome0a63c9cce8e612c3b68e0df6590c90616fdd82311d604df1aa17863f82c2994c.

104V7 сохраняет полную native admission и прежние canonical UTF-8 bytes; SHA вычисляется порциями без итоговой объединённой строки в scalar-origin fingerprint. Старый canonical string API и лимиты сохранены. Изолированные10 literal preimages/30 отказов PASS; current-policy build+14 genuine calls PASS, outcome29ea7a96557e1d37a29d409996956efd49c698e0cb9a9c73c2fa8980e995f1c1. Полный прежний94 набор запущен после ROOT review855 pins; первые42 runtime-фазы прошли, окончательная приёмка ещё отсутствует.

На homeserver реально проверен whole Compose render: меняются только7 image/build contexts и API V13 opt-in; OCR, mounts, networks и прочие настройки без изменений. Сохранены фактические policy/config inputs27 контейнеров/45 migrations/2 provider stages. Это metadata-only proof: при снимке активна работа, RAM ниже gate; fresh collector PASS не заявлен. Конкретный конечный build/adopt executor проверен ROOT статически;2 inert CLI refusal PASS. Реальная сборка/установка V13 ждёт T84 final и full94. Browser security hold сохранён.

104V7 actual full94 завершился firstRED REVIEWED_08_WORK:537882624>536870912 bytes;68 этапов с BUILD_ONLY PASS, cleanup0/ownedDB dropped/private gone/protected exact. Outcome 9fd744acff3e5d3d0f06ed4551c6b454e8abb3c5445db055fcbb615837e316aa. Порог/оракулы не менялись; BOOTSTRAP_08_WORK прошёл492941312 bytes. Начат разбор оставшегося удержания данных; полного94 PASS и разрешения на сборку нет.


### 2026-10-19 22:51 MSK — stale принят; V9 канонический SHA проверен

T84 stale CHK-56A94455 полностью проверен:10 jobs SUCCEEDED/attempt1, PARTIAL/sealed/completed,7 typed+63 scalar outputs,70 UNSUPPORTED, evidence0 и probability null. Whole receipt6d68860a243ebb1e070e2068a6e20737d9882c2d14e11123d921624c71c26f01. После этого tail-two завершился exit1 на RAM gate. Отдельный tail-one также остановился на повторном RAM gate ДО выдачи freshapproval: свежий grant отсутствует, pair/run операции отсутствуют, private state остаётся c2e4969dd458b8e2a3f3a83af2787423d002857487b1cfcfd55f525ebe33f204. Шесть normal whole-сценариев приняты; freshapproval, postflight/restart и T84 final ещё не приняты. Соседние20 сервисов не менялись.

104V8 полный94 сохранил RED REVIEWED_08_WORK:573272064>536870912 bytes, из них API503017472 и Python70254592.68 успешных этапов с BUILD_ONLY; cleanup0/ownedDB dropped/private gone/protected exact. Outcome fb4c0f42c0dae324695dba6849752712aca0186b0b0039d2f351f9ce5cf2ef99. Точное место пикового выделения не доказано.

104V9 меняет только способ вычисления SHA полного scalar-preparation envelope: прежние целочисленные V7 canonical bytes поступают в SHA порциями. Состав metadata/scalarInput/proofs/references и все пределы, классы/приоритеты отказов сохранены; original V7 canonical string API неизменён. API/contracts build реально PASS (bfa111bce9dd49db2377e521c65d6bb6ce9d0d17e87f81c67abc2975c67f5cba). Отдельный pure consumer PASS:21 допустимых V7 случаев,50 точных отказов, прежние10/30 проверки V13; границы64MiB/4500018 nodes/depth69/32768 members/Unicode проверены. Outcome30136b74ff366720ab7f46528584d510572694852a2d4c35aba8c7f2743537ce; max group RSS484016128, cleanup/protected pins exact. Два устаревших поля byte-count исправлены отдельным immutable map bca0027f6ffd9a89cfeb32bb1d08bc928c5ecf8d439d47f5496a7788e51f259c до binding; исходные файлы/хеши/старые receipts сохранены.

Полный94 на104V9 выполняется отдельно с прежним runner306b/all94 oracles/caps/cleanup; результат пока неизвестен. Новый current-policy112/14 consumer подготовлен, ещё не выполнялся. V13 source promotion/build/adoption не выполнены. Browser security hold сохраняется.


### 2026-10-19 23:05 MSK — точная граница памяти и политика V9

104V9 actual full94 сохранил firstRED REVIEWED_08_WORK:544362496>536870912 bytes; API474075136/Python70287360.68 успешных шагов с BUILD, cleanup0/ownedDB dropped/private copies gone/protected exact. Outcome694925143f5e35435cde5711d8c2a53ec8eb5e442142ada2f25d046971b37bf5. Отдельный metadata-only diagnostic того же исходного prefix и прежних caps подтвердил: историческая материализация/полная native SHA validation/emission завершились; последний HISTORICAL_SHA_EMIT_DONE RSS376131584. Затем до следующего SQL group вырос до544124928/API473968640/Python70156288. Diagnostic outcomeeee0a98b9e8abc34906c5e7e9c57e162352cdae3b6e85bbc929ef0b59c0b0d89; cleanup0/private gone/protected exact. Это не qualification PASS. Последующий статический путь начинается с полного portableEvidenceHash(artifact), который строит tagged tree и полную JSON строку даже для неиспользованного selector при submitted target. Готовится устранение этой аллокации с сохранением полного проверяемого portable hash; причина пика ещё не подтверждена успешным исправленным прогоном.

Current-policy112 V3 реально PASS: build+14 genuine calls,4.899311s, max246325248 bytes; outcome d89301e03913ae7d51cd92c899549a3be9053e9110556e059e8478142b16a2fa. Private cleanup и protected pins exact. Installed-proof V2 прошёл ROOT whole static review,19 stdlib helper cases и inert unbound CLI refusal; реальный installed probe ещё не запускался. Новый wall-only controlled packet READY793b2dccbdd4365a0aaa16a9c83bb218cf064c5c2f972e5ad8be33e1194aeb30 подготовлен, ещё не ROOT принят/не выполнен. Пакет честно ограничивает независимые goldens двумя KR055 rows, other61/global acceptance не заявляет.

Homeserver доступен;23:02 MSK MemAvailable1408216KiB ниже неизменного gate1572864KiB. T84 freshapproval и дальнейшая установка не запускались. Соседние сервисы не менялись. Напоминание уже удалено. Browser security hold сохраняется.


### 2026-10-19 23:16 MSK — portable SHA: реальные полные артефакты PASS

Новый native-only portable SHA вычисляет прежние typed bytes потоково, сохраняя IEEE754 number encoding и полный admission. Старые public V7/V13 bodies и caps неизменны. Pure actual outcome8182ed10ae9d9fe2ea805a164817d3ffb89aa9d04269f139c66c3fae7825e999: BUILD+11 runtime phases PASS,22 независимых literal hashes/7 boundary recipes/48 native refusals плюс прежние V7/V13 проверки; полные ПД139/РД32 дали прежние фиксированные SHA. Max groupRSS488640512 bytes относится к старому V7 bytes test; новый portable bytes103628800, фактические PD191733760/RD194465792. Cleanup/private/protected exact. Независимое static v3 review0feea4065adbfd87c92ee9f7cd74d88f608123fdbb107f6611f736f003806305:348 pins, литералы/рецепты и третий retained-pair diff проверены без DUT.

Source104V10 map b34c84d3fb5fff5ffa0317b48ec089c5b89cd278bfac3c5ac2731e7491ef8cae,19changed/85exact: lazy selector плюс streaming full artifact hashes только в admitted V13 private paths. Никакой подмены hash/source proof/trusted flag. Full94 запущен отдельно с прежним runner306b/oracles/caps/cleanup; BOOTSTRAP08WORK уже PASS479457280 bytes, полный результат ещё не известен. Политика V4 статически проверена, ещё не выполнена.

Controlled ordinary packet793b2dcc прошёл ROOT whole static review и реальный inert unbound refusal b89690048e5785fc83d1f4ee972e9ed5e8c141f3d1f28b5a8c65e7d558f5ab8c:0HTTP/0POST. Реальные сценарии/installed proof пока не запущены. На homeserver23:12MSK MemAvailable1286008KiB ниже gate1572864; соседние20 сервисов не трогались.

### 2026-10-19 23:24 MSK — V10 full94 RED preserved; policy V4 PASS

The V10 complete portable evidence streaming helper passed independent literal/boundary/native-error and whole 139/32 PDF hash checks. Full94 passed BUILD and 68 successful steps, then REVIEWED_08_WORK reached group RSS 541646848 bytes against the unchanged 536870912-byte cap. At that peak API RSS was 382423040 and Python RSS 159223808; the previous API allocation peak has moved to the worker. Outcome `6e5cabe86418a93b2a6dbf631d21a769c0904b0e93c67df5403c737858269470` is preserved, cleanup passed, and full94 remains unqualified. Diagnostic-only Python boundaries are being prepared before any further product change.

Current-policy V4 build and all 14 genuine TS calls passed (`7b0b51573aceb2cec55cc608d0efcf101432b9d4354680323ca3bd23f49005f1`); the 200-case worker package proof is reused byte-exactly. No new worker, stand, or browser acceptance follows from that result. Read-only homeserver capacity at 20:24 UTC was 1457324 KiB available, below the unchanged 1572864 KiB runtime gate; freshapproval remains unissued.

### 2026-10-19 23:36 MSK — worker diagnostic overhead isolated; wider corpus located

The diagnostic-only global Python profile changed no product sources but reached the original 55-second group CPU cap during BOOTSTRAP_08_WORK, before REVIEWED_08_WORK. Its first failure (`421e4168635dfd7447d1fa4d9d55588e88c7bc61d6791f7569b46144291e79db`) and all 58 numeric markers are retained; cleanup and all protected pins passed. This does not identify the reviewed-path allocation cause. The next diagnostic uses a one-shot lazy-import trigger followed by finite function-boundary wrappers, avoiding permanent profile overhead. No cap change or automatic retry.

Read-only homeserver metadata confirms additional public originals: F0136–F0145 are ten RD sets /194 pages, and F0117 is a 58-page PD fire-safety volume. Source payload SHA values remain manifest-derived, with current ZIP entry/path metadata checked separately. A bounded pass read 135 complete cached pages; this is text evidence only, not independent source approval or a new KR-066 qualified pair. Remaining named cached pages are being reviewed under a separate fixed budget. Homeserver available RAM was1413536 KiB at20:33:57 UTC, still below1572864; no freshapproval POST or neighboring lifecycle action occurred.


### 2026-10-19 23:45 MSK — Python portable-tree peak identified; full RD text pass

Diagnostic V2 preserved the original BOOTSTRAP success and reached REVIEWED_08_WORK. It failed at group RSS546770944 bytes (API394293248 + Python152477696), CPU13.36 seconds. The last numeric markers place execution inside the second original portable_evidence_json call under retained _integrity; no return was observed before the RSS kill. Outcome `c8bc6b65d378fae9f7b944a731278d854380e4514c47902f020f646b2df68dac`; ROOT review `0294032ed91ac2a7d29fb465cad70fa84060f7652dd10b3beaf0367c5147510d`. Database cleanup, private removal and945 protected pin slots were verified. This is diagnostic evidence, not full94 acceptance. Next correction targets whole portable tree/string allocation in the private V13 Python path while preserving hash bytes, original public pair behavior and all caps/oracles.

The bounded second text pass completed117 remaining pages using11184283 compressed+decoded bytes, below16MiB. Combined: all194 RD JSON pages (181 text candidates,13 OCR_REQUIRED) plus58 PD fire-safety JSON pages. No same-element fire-protection replacement pair was established; KR066 remains ABSTAIN. Isolated drawing R-number labels were not admitted as fire-resistance properties. OCR13 preparation is restricted to F0138 physical pages3–15. ROOT text review `da684e064ddd113cd09e4333d1192ef1d67eb63b4b5dc9d70950aa3017119a1f`.

Homeserver20:44:33UTC MemAvailable1449760KiB remains below the unchanged1572864KiB gate. T84 freshapproval still unissued; no neighbor lifecycle change.


### 2026-10-19 23:59 MSK — Python streaming pure14 PASS; package preflight preserved

Source104V11 adds bounded native admission and streaming typed portable SHA only in the private V13 Python execution path; the original public native/pair APIs and all hash encodings, limits and refusal precedence are preserved. Independent Python pure14 actually passed:22 fixed literal hashes,7 boundary recipes, hostile builtin-subclass refusal/callback0, byte/node/depth/container/Unicode boundaries and complete original PD139/RD32 hashes. Outcome `b7118be53a34fc655769c931c63b0702a2160918723513308f36ba98b0115cc1`; ROOT review `4b7f59c45f09f4bdc4b0d3a4c960a0db326ba4f25de720f0e838aaddf9bc2248`. MaxRSS131325952 bytes; summed phase wall11.2356s;58 protected pins rehashed and private copies removed. This is pure-helper proof, not full94/installed/server acceptance. Full94 is prepared with original94 order/oracles/consumers and only two count guards19/85 to22/82; current policy14/package proofs remain prerequisites.

Fresh worker200 package V1 stopped in preflight before first-results/DUT/compiler/build because all six previously pinned pip HTTP-cache wheel files were absent. Exact first failure is retained in `current-worker200-stream-reproof-v1/root-actual-review.json`; source2354/copy2191 pins and exact original scripts/cases were independently verified. Recovery is restricted to exact six original wheel versions/hashes, with a separate future packet; no silent retry or tool-version replacement.

Existing OCR CPU provider passed one read-only health/profile/eslav metadata probe. The planned13-page inference remains deferred: available335368192 bytes after1GiB reserve is below observed lifetime peak-growth638091264. No OCR/render/POST/model initialization occurred. Bounded source-data gate for SPZU039 will use existing F0138 cached text and F0121 drainage fragments; no feature-type/source-role substitution or real pair is asserted. Homeserver20:54:02UTC MemAvailable1358744KiB remains below1572864; T84 freshapproval still unissued.

### 20 октября 00:12 МСК — текущие проверки V11

- Python pure14 PASS; worker200/API и фактические wheel/sdist установки PASS (200 source pins, не 200 сценариев); current-policy14 V5 PASS.
- Полный original94 V11: 67 runtime шагов PASS, первый RED на REVIEWED_08_WORK: совместный RSS 540610560 B при фиксированном лимите 512 MiB; API 390037504 B + Python 150573056 B. Лимиты и ожидаемые результаты сохранены.
- Cleanup PASS: временная БД удалена; защищённые исходники, оригиналы и tooling повторно сверены ROOT. V11 не принят как полный regression PASS; автоматического повтора нет.
