# NativeCapacity: локальная приёмка 20.10.2026

Независимое ожидание до запуска: два разных синтетических PDF ПД/РД, по три страницы. На физических страницах 1 и 3 каждого PDF напечатано «Школа на 600 мест», на странице 2 нейтральный текст. Ожидается EQUAL, 600/600, delta 0, две native цитаты на каждую роль. Вероятность null, factEligible false, coverageDelta 0; инженерного заключения нет.

Проверка использует свежий Python V4 producer с текущим PDFminer, полные SHA оригиналов, dedicated completion API и PostgreSQL. Подменён только локальный download transport. Остальные stage providers дают нулевые выходы; нет Rabbit/ML или анализа реального объекта. Браузер использует настоящий App/CSS, session/CSRF, Fastify и PNG из этих PDF.

Отрицательные случаи: отсутствие session/CSRF/idempotency, лишние поля, незавершённый/старый профиль, чужой пользователь/организация/источник, одинаковый исходник, отозванный READ, изменённый input при том же ключе, изменение immutable row и повреждение вложенного comparison hash. Проверены DB CHECK для отсутствующих/null защищённых полей и подменённого artifact hash. Две первые одновременные команды, повтор ключа и восемь последующих параллельных команд обязаны вернуть один сохранённый winner. Никаких новых rule_results/решений/протоколов; coverage прежний.

```sh
# URL в приватном файле 0600; не печатать его в терминал/логи.
python3 -c 'import os,pathlib,subprocess; e=dict(os.environ); e["INSPECTOR_POSTGRES_ADMIN_URL"]=pathlib.Path("output/local-work-20261020/protocol-export-v1/private/admin-url.txt").read_text().strip(); raise SystemExit(subprocess.call(["npm","exec","--workspace","@inspector-ai/api","--","vitest","run","test/native-capacity-postgres.integration.test.ts","--maxWorkers=1"],env=e))'

node --import tsx scripts/smoke-native-capacity-app.mjs \
  --admin-url-file output/local-work-20261020/protocol-export-v1/private/admin-url.txt \
  --output output/local-work-20261020/native-capacity-acceptance-v1/browser/new-run
```

Каждый запуск создаёт свою UUID-базу и удаляет только её; общий контейнер остаётся. Без `INSPECTOR_POSTGRES_ADMIN_URL` PostgreSQL-модуль явно пропущен. Receipt/screenshot в output фиксируют фактический результат; этот документ не заменяет PASS.

Принятый запуск: `postgres-final-v7.log` — 7/7 PASS за 4,45 с; `browser/v7/acceptance.json` — 9 проверок PASS за 18,415 с. Настоящий App проверен на 1440 и 375 px, light/dark: ширина документа равна viewport, обрезанных контролов нет. Фрагменты обоих оригиналов переключены на физическую страницу 3, рамки остаются видимыми после resize/theme; JSON скачан и равен сохранённой записи, после настоящего reload история равна PostgreSQL. Сохранены 16 PNG, включая читаемые viewport-only `native-visible-rd-375-dark.png` и `native-visible-rd-1440-light.png`. Исходные runtime SHA до/после совпали.

В браузерном журнале 66 HTTP-ответов API: два ожидаемых 404 только для точных URL `source-review` выбранных исходников с `NOT_FOUND` / «Решение не найдено». Fixture начинает без решения; остальные 4xx/5xx запрещены. SOURCE_AUDIT_ONLY не запрашивает matrix-execution, visual-proposals или ocr-layout. JS page errors нет. Отдельная resource-диагностика сохранила 18 клиентских `net::ERR_ABORTED` GET `/api/objects/:id/checks`; это не HTTP-отказы. Консольные GPU ReadPixels предупреждения относятся к headless Chrome.

Первые RED сохранены отдельно: SQL 42P08, неподдерживаемый суффикс авторского заголовка, mobile overflow и лишние source-audit запросы; исправления продукта сделал основной агент. RED v5/v6 на reload вызван лишней второй навигацией harness сразу после reload; финальная проверка выполняет один reload, без подмены данных или пропуска истории. Полный API typecheck с `--noEmit` отдельно выявил текущие ошибки в соседнем `native-airflow-comparison.ts`; они не относятся к этому QA-модулю и переданы основному агенту.

Реальная публичная пара отдельно проверена чистым движком на полных V4: F0171,177 страниц и F0201,676 страниц; 30 цитат ПД (29 однострочных, одна двухстрочная) и9 РД. Результат600/600мест, delta0, исключённых заголовочных фрагментов0. Это отдельная проверка исходных данных; PostgreSQL/browser fixture выше синтетический. Двухстрочная цитата хранит обе исходные строки без склейки, с отдельными координатами. Source-only результат не утверждает редакцию, физическое тождество или полноту конфигурации.

Открытие в продукте: завершённый полный аудит V4, «Открыть сверку вместимости ПД/РД», выбрать два оригинала, «Сравнить вместимость по исходному тексту». История привязана к конкретным run/manifest/release и SHA двух исходников/текстовых артефактов. Отдельный JSON включает неизменяемую запись; существующий инженерный протокол автоматически не изменяется.

Общая регрессия этапа: API4614 PASS/217 SKIP; web1281 PASS; build PASS. Финальный focused capacity набор после удаления generated .js —63 PASS/1 SKIP; реальный opt-in набор движка отдельно51 PASS. Соседний airflow разрабатывается независимо и проверяется своим этапом.
