# T72: журнал применимости пары ПД/РД, 18 октября 2026

Принят отдельный authenticated append-only журнал KR-056. Запрос не задаёт actor, ID, готовый projection или snapshot. Сервер реконструирует полный original-v2 контекст, проверяет оба текущих source review для UNKNOWN/APPROVED и неизменный исторический контекст для терминального WITHDRAWN. Сохранение использует отдельные projection/journal hashes, CAS логической пары, свежие READ+REVIEW_DECIDE перед replay, OPEN inspection lock, ограниченное чтение оригинальных PDF вне транзакции и повторную проверку fingerprint перед записью.

GET выбирает последнюю запись каждой пары по sequence до фильтров состояния и возвращает её исторические refs даже после удаления текущих claims. Предыдущее APPROVED не восстанавливается после UNKNOWN/WITHDRAWN или устаревания. Source review hashes не включают pair review; hash cycle отсутствует.

Проверки: 34 focused, 4 независимых actual PostgreSQL на стабильных исходниках, contracts/API typecheck, normal API build. Отдельно проверены подмена оригинального PDF, source/pair CAS, отказ replay после отзыва доступа, append-only SQL и подмена нового journal hash. Первые RED и исходные эталоны сохранены.

Доказательства: `output/matrix-t72-20261018/acceptance.json`; freeze SHA `2b5f8907ba9bae176a82f8a49b1093c1978e42b8740bb8432eb748b4e3fea32b`, 672 файла; 654 прежних pin точны. Только синтетические authenticated fixtures, без реального инженерного согласования.

Следующий этап T73: обычный durable v10, immutable run snapshot всех последних решений пары, protected loader, actual worker и независимый server replay/evidence/read. Пока runtime стенда v9: 60 параметров / 68 частичных атомов / 72 UNSUPPORTED. Внешний стенд на этом этапе не менялся; browser security hold сохраняется.
