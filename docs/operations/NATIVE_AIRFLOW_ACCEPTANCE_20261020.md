# NativeAirflow: локальная приёмка 20.10.2026

До кода зафиксирован независимый эталон: `output/local-work-20261020/native-airflow-acceptance-v1/manual-before-code.json`. Свежие авторские PDF по три страницы. ПД на физических страницах 1 и 3: `П17 (L=9060 м3/ч, Pc=350 Па)`. РД на этих же страницах: `Проект: П17.1 (L=3340 м3/ч, Pc=540 Па)` и `Проект: П17.2 (L=5720 м3/ч, Pc=540 Па)`. Страница 2 нейтральная. Ожидание: 9060 = 3340 + 5720, EQUAL, delta 0, две цитаты ПД и четыре РД. Давления 350/540 Па сохраняются по членам, не складываются.

Результат SOURCE_ONLY: вероятность null, factEligible false, coverageDelta 0, PUBLIC_MAPPING_CONFLICT. Пользователь явно задаёт состав группы. Физическое соответствие установок, совместный режим, кратность воздухообмена, инженерное нарушение и его отсутствие этим не подтверждаются.

Путь приёмки: полные SHA авторских оригиналов, свежий Python V4 producer с текущим PDFminer, dedicated completion HTTP, PostgreSQL и настоящий App/CSS/Fastify/PNG. Подменён только локальный download transport и scoped identity fixture. Исходники не получают эталоны или публичные метки. Нет Rabbit/ML/анализа реального объекта. `seedNativeCapacityFixture(..., {scenario:'AIRFLOW'})` включает отдельный сценарий; capacity default сохраняется.

PostgreSQL-тест проверяет две первые одновременные команды и восемь последующих параллельных команд, idempotency replay/conflict, selectionHash, отдельную историю для состава `[П17.1]` (3340, delta -5720), ABSTAIN при отсутствующем П17.3, session/CSRF/schema, чужого пользователя/организацию/исходник, отзыв READ, append-only строки, tamper с пересчитанным внешним хешем, DB CHECK для missing/null полей и подменённых artifact/selection hash, повторное подключение и историю после нового старого профиля. rule_results, решения, протоколы и coverage остаются прежними.

```sh
# Приватный URL 0600 не печатать в терминал/логи.
python3 -c 'import os,pathlib,subprocess; e=dict(os.environ); e["INSPECTOR_POSTGRES_ADMIN_URL"]=pathlib.Path("output/local-work-20261020/protocol-export-v1/private/admin-url.txt").read_text().strip(); raise SystemExit(subprocess.call(["npm","exec","--workspace","@inspector-ai/api","--","vitest","run","test/native-capacity-postgres.integration.test.ts","test/native-airflow-postgres.integration.test.ts","--maxWorkers=1"],env=e))'

node --import tsx scripts/smoke-native-airflow-app.mjs \
  --admin-url-file output/local-work-20261020/protocol-export-v1/private/admin-url.txt \
  --output output/local-work-20261020/native-airflow-acceptance-v1/browser/new-run
```

Каждый запуск создаёт и удаляет только свою UUID-базу; общий контейнер оставляет. Без INSPECTOR_POSTGRES_ADMIN_URL PostgreSQL-тест явно пропущен. Browser использует loopback28193. Нет review/decision writes. История читается после настоящего одиночного reload, без второй навигации, мешающей Vite module loading. Финальные receipt/source pins/PNG фиксируют фактический результат; наличие этого документа не означает PASS.

Финальный запуск после shared storage fix и migration050: `postgres-final-v3.log` — capacity7 + airflow8, 15/15 PASS за 7,97 с. Подмена nested PD source SHA и RD quote SHA при пересчитанном outer hash получила SQLSTATE23514 и точные сообщения нового binding trigger. Предыдущая проверка повреждения inner comparison hash на чтении сохранена. API `tsc --noEmit`, Node syntax и whitespace checks прошли.

`browser/v3/acceptance.json`: 9/9 PASS за 16,105 с. Открытие сверки проверено сразу на 375 px, затем 1440/375 light/dark: documentWidth равен viewport, обрезанных контролов нет. Обе PDF показали реальные PNG, выбранные фрагменты физической страницы 3 и активные рамки после resize/theme. Скачанный JSON равен сохранённой записи; после reload история равна PostgreSQL. Runtime SHA до/после совпали. Сохранены 16 PNG; читаемый desktop viewport: `browser/v3/native-visible-rd-1440-light.png`, mobile viewport: `browser/v3/native-visible-rd-375-dark.png`.

В журнале 67 API-ответов: два ожидаемых404 только для точных `source-review` URL выбранных исходников с NOT_FOUND / «Решение не найдено». Fixture начинается без решения. Прочих 4xx/5xx и JS page errors нет; SOURCE_AUDIT_ONLY не запрашивает matrix-execution, visual-proposals или ocr-layout. Resource-диагностика отдельно сохраняет 18 клиентских net::ERR_ABORTED GET истории проверок; это не HTTP-отказы.

Первый browser RED сохранён в `browser/v1/first-red.json`: длинная кнопка истории увеличивала документ до386 px на375 px. Основной агент исправил scoped wrapping; v2 принял UI до storage fix, v3 подтвердил итоговый runtime. UUID-базы удалены, порт28193 закрыт, общий PostgreSQL-контейнер оставлен. Нагрузочный прогон1000 записей и внешний ML/provider в этот QA-пакет не входят.
