# Переносимые тесты, 20 октября 2026

Команды подготовки окружения и запуска: [H100_READINESS_20261020.md](H100_READINESS_20261020.md). Они работают без H100; GPU-приёмка выполняется отдельно. В Git checkout корень приложения совпадает с корнем репозитория; в review ZIP это `source/`, квитанции — соседняя директория `evidence/`. В Git квитанции сохранены в `docs/operations/evidence/h100-v9-20261020/`.

Срез приложения взят из `source-map1095.json`, а не из более старого API в рабочем checkout. Тестовые JSON/PDF заморожены до прогона; ожидаемые результаты не пересчитывались из проверяемого результата. Для переносимости заменены только пути к тем же JSON-эталонам. Два API-теста приведены к текущей сигнатуре методов; OpenAPI проверяет также цифры в именах схем и по-прежнему требует разрешимость каждой ссылки. Исторические вычисления lighting V9 проверяются прямым executor с прежними assertions; нынешний adapter отдельно обязан отклонить несовместимый старый reader до сети.

Включены 201 worker test module: шесть из исходного среза и 195 добавленных helpers/tests. Восемь исторических модулей вне TypeScript helper closure требуют локальных исследовательских output; их исходные тесты не объявляются пройденными и не включены в этот переносимый срез:

| File under services/worker/tests | Reason |
| --- | --- |
| test_durable_column_pylon_section_matrix_v12_owner.py | Reads output/matrix-t83-20261018/root-v12-policy-template.json during module import. |
| test_durable_steel_comparison_matrix_owner.py | Reads output/matrix-t73-20261018/python-steel-policy-before-code.json during module import. |
| test_durable_steel_comparison_matrix_v11_owner.py | Reads output/matrix-t80-20261018/python-v11-policy-proposal.json during module import; also imports the preceding historical steel test. |
| test_pipe_material_review.py | Requires output/pipe-material-review-20260928 research artifacts. |
| test_public_family_ocr_queue.py | Requires output/public-index-20260927/index-audit.json. |
| test_public_family_readiness.py | Requires output/public-index-20260927/index-audit.json, class-label-probe-20260927-v2.json and presence-label-probe-v3-20260927.json. |
| test_pz_spzu_unresolved_batch.py | Requires output/unresolved-parameter-strategy-20260927/report.json. |
| test_utility_unresolved_batch.py | Requires output/unresolved-parameter-strategy-20260927/report.json. |


Исторические API/worker-тесты настоящих оригиналов требуют полного original manifest, исходных PDF, иногда архивного wheel/plan. При отсутствии prerequisite возможен явный skip; присутствующие повреждённые данные должны давать ошибку. Закрытые ответы, служебные output и модельные веса в исходный архив не включаются. Полные условия локальных проверок и фактические числа pass/skip/fail записаны в `evidence/acceptance.json`.

Полный локальный прогон — проверка всего включённого переносимого набора. Он не подтверждает оригиналы, отсутствующие в пакете, аппаратную работу CUDA или взаимодействие в браузере. Временное QA-окружение использует существующие локальные Python-библиотеки; свежая установка зависимостей worker проверяется отдельной настоящей Docker-сборкой.

В Git восемь перечисленных исторических модулей сохранены без изменения байтов в `services/worker/historical_tests/`. Они не входят в стандартный переносимый runner и могут запускаться явно при наличии внешних данных. Исходное расположение в таблице относится к прежней рабочей копии.
