# T47: рабочий путь от реального факта к решению инспектора

18.10.2026. Только read-only аудит существующего кода, замороженных исследований и локальных full-artifact fixtures. Runtime, профили, registry, тесты и стенд не изменены; новых retrieval/extraction нет. Машинный отчёт: `output/matrix-t47-20261018/ts-real-pipeline-audit.json`.

Приоритет — восстановить immutable scalar targets в новых профилях. Затем добавить actionable worklist существующих отказов. Новый parser/атом сейчас уступает этим двум изменениям: настоящий scalar факт уже извлекается, но пользователь не получает короткого рабочего пути до подтверждения его области. База остаётся55 параметров с63 scalar atoms и77 scalar UNSUPPORTED; никакого прироста покрытия этот пакет не заявляет.

## 1. Подтверждённый blocker: reader допускает только v1–v4

`apps/api/src/matrix-execution.ts:22` экспортирует `MATRIX_READ_PROFILES` только для scalar профилей v1–v4. `loadMatrixFactOrigin` в `postgres-repository.ts:12758` использует этот массив в SQL `stage.provider_profile_id=ANY($3::text[])`. Поэтому сохранённый scalar факт v5/v6/v7 не попадает в origin reader. Это статическое доказательство пути; HTTP/PG воспроизведение в данном аудите не выполнялось.

Все три callers:

- `postgres-repository.ts:12787`, `getMatrixFactTargets`: immutable адреса не возвращаются; `MatrixFactScopeReview.tsx:28` не может загрузить target выбранного факта.
- `postgres-repository.ts:2529`, `recordSourceReviewCommand`: проверка каждой per-fact binding через тот же helper. Исправление только GET недостаточно: сохранение всё равно вернёт `MATRIX_FACT_TARGET_MISMATCH`.
- `postgres-repository.ts:2568`, тот же writer: проверка ссылки РД на исходный ПД-факт геодезического основания. PD origin из нового профиля также недоступен.

Минимальный отдельный implementation packet: additive version-aware origin reader и регрессии до UI worklist. Использовать конечный `MATRIX_RAIL_INVENTORY_READ_PROFILES` и `matrixFullPolicyForProfile`, а не произвольный профиль с похожим именем/schema. В SQL понадобятся profile/config/manifest/release metadata; проверить точную provider slot/profile/adapter/config/definitions связку, canonical hash/byte size, единственность stage и same-object scope. Исходные observation ID и target5 остаются неизменны; никакой latest-review подмены старого запуска.

Уже проверенные точки для переиспользования: `assertInventoryRelease` около4328, `inventoryStoredRead` около4388, `validateMatrixStage` около12535 и публичный `verifiedInventoryRead` с A/B/C. Resolver подходит непосредственно. Полный `inventoryStoredRead` нельзя слепо вызвать внутри source-review writer: он требует actor/read scope, может выполнить большое typed replay, а оригинальный PDF I/O обязан оставаться вне транзакции с write locks. Для публичного GET новых профилей можно переиспользовать bounded verified-read; общую проверку immutable origin row/target нужно разделить так, чтобы writer выполнял только transactional recheck. Прямой рекурсивный вызов public API/repository read внутри writer не нужен.

Регрессии пакета:

1. Известные v1–v7 принимаются только с точной profile/config/release/manifest связкой; unknown и mismatch отвергаются. v1–v4 target bytes/IDs сохранены.
2. Полный реальный F0106/F0139 даёт исходные scalar targets в v5/v6/v7. Обычная binding сохраняется без повышения UNKNOWN revision/approval; source hash, evidence/text/context hashes, чужой объект и duplicate stage проверяются негативно.
3. Новый-profile PD project-zero target может быть источником отдельного human authority claim; RD принимает только current PD review hash. Stale/foreign authority отвергается.
4. `projectConstraints` и steel/fire `sourceDeclarations` остаются вне scalar targets. Старые matrix/submission/review bytes не переписываются.

## 2. Следующий узкий UI срез: actionable scalar worklist

Что уже есть:

- `MatrixExecutionPanel.tsx:160–198`: просмотр candidate, всех extracted observations, оригинального PDF, context fragments и существующий `MatrixFactScopeReview` выбранного TEXT_LAYER факта.
- `MatrixFactScopeEditor.tsx:181` выбирает только существующие enabled rules по точным attribute/unit/parameter. Есть явные identity/context/table/section/project-zero authority поля; никакой автоматической authority.
- `MatrixFactScopeReview` сверяет target с check/content hash, читает последнее source review, сохраняет одним CAS command, сохраняет inventory/call/rail siblings и сообщает необходимость нового запуска.
- `SourceReviewScreen` меняет source revision/approval/link/section/pageStages отдельно; App уже имеет общий переход к этому экрану.

Точные gaps:

- `MatrixExecutionPanel.tsx:199–208`: declined scalar rows и coverage — текст без кнопок к конкретному факту/правилу/решению.
- Источники около164–173 показывают frozen metadata без адресного перехода к source review. `MatrixExecutionPanel` не получает такой callback; `SourceReviewScreen:175` не принимает initialSourceFileId.
- При `AMBIGUOUS_FACTS` или `ENTITY_SCOPE_MISMATCH` engine около1288–1294 не записывает observation IDs в row. Нужен список всех подходящих фактов, а не догадка о паре.
- Существующий editor начинает с первого подходящего rule (`MatrixFactScopeEditor:366`); переход из конкретного отказа должен передавать validated preferredRuleId, без переноса человеческих подтверждений.
- Source-list load error около144 подавляется. Worklist должен отличать ошибку загрузки от отсутствия прав/фактов.

Первый UI-only packet после reader fix: новый `MatrixReviewWorklist`, pure derivation helper и небольшая wiring в panel/App/source screen. Ключ строки — `{checkId,executionContentHash,resultIndex,ruleId,comparisonVariant}`, без вымышленного observation ID. При наличии exact expected/actual IDs — переход к ним. Иначе показать все TEXT_LAYER факты с точными parameter/attribute/unit и нужной stage, без first/nearest/best matching. Возможные действия: оригинал/context, редактор именно этого fact/rule, source review именно этого source. Missing stage остаётся потребностью в исходном факте; review не создаёт недостающее измерение.

Показывать **сообщённую frozen причину**, а не притворяться полным server diagnostic. RequiredContext checklist — перечень того, что инспектор должен проверить, а не автоматически вычисленное отсутствие всех proofs. Latest review после явного открытия маркировать отдельно от saved-run metadata. Сохранение только существующей формой/CAS; после него старый отказ остаётся и появляется «нужен новый запуск». Отдельная lane для technical failure. `NEGATIVE_SCOPE_UNVERIFIED` не получает checkbox полноты: текущий factScope прямо запрещает `RULE_SCOPE_COMPLETE`/`PARAMETER_SCOPE_COMPLETE`.

Не нужен новый API endpoint для первой worklist: saved execution/registry/source files уже загружены, immutable targets и source review читать лениво при выборе. Не делать fanout latest review по всему комплекту на render. Abort/selection generation, source SHA, check/content hash и права проверять существующим loader/editor. Никаких domain writes от render/фильтров/переходов.

## Проверенные реальные inputs и честные пределы

- **T32, главный acceptance input:** `services/worker/tests/fixtures/rebar-F0106-F0139.json`, полные139+22 страницы. Реальные PD50/RD4 В30/В30, PD49 material header, все15 observations сохранены. Accepted real run `CHK-E6FAFDD3` имел0qualified/UNKNOWN. Подходит для targets, multi-page context и source/fact navigation; равенство не доказывает полноту и не требует успешного negative результата.
- **T29/T30:** `project-zero-F0101-F0139.json`,13+22 страницы,159.95/159.95, RD unit notes. Подходит для authority blocker/drilldown; не независимая геопривязка.
- **T20:** полный F0151 в `pd-door-bound-F0151-p22.json`,40 страниц; PDF17 содержит tread300/riser150 и две целые primary lines. Реальная RD пара не найдена. Worklist должен показывать PD факты и missing-RD, не обещать сравнение после согласования PD.
- **T18:** bounded real height pair не найдена. Scope/norm review не заменяет отсутствующие измерения.
- **T26:** parking — внешние planned counts, нет общей RD пары/ширины/denominator applicability. Остаётся вне исполнимого среза.
- **T34:** full43 steel pages дают2 evidence-only declarations, но PD70Б3/tier и generic RD I-beam/OTHER не образуют member pair. Не добавлять binding shortcut.
- **T38:** F0106 full139, шесть fire table declarations — отдельное evidence-only, не scalar KR066.
- **T45:** реальные rail details F0151 PDF40 не дают closed unique same-room RD inventory. Synthetic rail comparator не доказывает реальную пару.

Тесты UI: реальные frozen facts и их unknown metadata; все ambiguous варианты; no fake IDs; нужный rule выбран без checklist confirmations; abort/stale target/CAS; явная ошибка source loading; no render writes; old results/submission unchanged после review. Unit/SSR доступны сейчас. Браузер1440/768/375 — отдельная приёмка после снятия существующего security hold; API/unit PASS её не заменяет.
