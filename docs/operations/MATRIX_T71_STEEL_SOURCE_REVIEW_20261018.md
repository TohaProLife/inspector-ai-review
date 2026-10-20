# T71: журнал разметки стали, 18.10.2026

Разметка `steelComparisonScope` подключена к существующему source-review API и PostgreSQL. Сервер находит точное исходное указание стали по sealed full-v2 artifact и прежнему producer, сам добавляет declaration snapshot, проверяет исходные page/line/raw/bbox привязки элемента. Стадия оригинала сохраняется отдельно от текущей редакционной пригодности источника.

Отсутствующее поле сохраняет прежний hash preimage; существующая разметка наследуется и проверяется заново. Явное `claims: []` отзывает разметку. Общий CAS защищает изменения, optional nullable migration040 не добавляет значения по умолчанию старым строкам. Все затронутые source-review hash/read sites, включая v3 source audit, учитывают новое поле только при наличии.

Независимые пять сценариев на свежей PostgreSQL прошли обычный v4 run из девяти заданий, материализацию двух original-backed синтетических источников, idempotency/CAS, наследование пяти прежних typed scopes, отзыв и проверку повреждения полного hash. Найден и исправлен возврат сохранённого snapshot при replay после отзыва object membership: доступ теперь проверяется до receipt response. Первые RED сохранены. 18 focused тестов, 274 соседних, contracts/API typecheck и обычный API build PASS.

Это сохранение source claims, а не подтверждение применимости пары или новое runtime покрытие. Стенд остаётся v9: 60 параметров / 68 частичных атомов / 72 UNSUPPORTED. Продолжается отдельный pair applicability journal, затем durable v10 и UI. Браузерная приёмка pending по прежнему security hold.

Доказательства: `output/matrix-t71-20261018/acceptance.json`, `qa-postgres-final-receipt.json`, `ts-review-integration-acceptance.json`. Source freeze: `1027490914f3851260ea37b6992755b2309cae29286a67622e527c8b673aeb30`.
