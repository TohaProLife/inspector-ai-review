# T38: табличные значения огнестойкости из таблицы

Статус: реализация готова, общая приёмка и проверка на стенде продолжаются. Целевой результат — шесть **EVIDENCE_ONLY** деклараций исходной верхней таблицы. Исполняемого KR066, сравнения ПД/РД, привязки элемента и прироста покрытия здесь нет. Реестр остаётся 132 / 55 / 63 / 77.

## Полный источник и точные якоря

Полный F0106: 139 страниц; SHA PDF `ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655`. Неизменённый artifact: `output/matrix-t31-20261018/parser-F0106-full.text.json`, SHA `1aa99c72405982a5e67f7a669d3df297f7379c61738f99cc01ab1db4715b5473`. PDF51, кадр 595200 × 841920 milli-points — координата регрессионного примера, не условие extractor.

Заголовки: `2:0 «Наименование строительной конструкции»`, `0:0 «Предел огнестойкости,»`, `0:1 «мин»`. Точные bbox, полные raw строки и шесть пар строк приведены в `output/matrix-t38-20261018/api-design.json`.

| Полные строки категории | Primary | Исходное значение, только регрессионное ожидание |
|---|---|---|
| 4:0 Несущие стены, колонны и другие несущие элементы | 0:2 | R 120 |
| 4:1 Перекрытия  междуэтажные,  разделяющие  здание  на; 4:2 пожарные отсеки | 6:0 | REI 120 |
| 4:3 Лифтовые и лестничные шахты | 8:0 | REI 150 |
| 4:4 Плита покрытия | 8:1 | REI 120 |
| 4:5 Мостовой переход | 8:2 | REI 120 |
| 4:6 Марши и площадки | 8:3 | REI 60 |

Нижняя таблица содержит `Þ»` в обозначениях покрытия. Эти строки остаются неинтерпретированными вне верхнего региона. Пересечение повреждённой/посторонней строки с верхним регионом отклоняет все шесть. Глобальный запрет `Þ»` на странице уничтожил бы валидный исходный пример.

## Механика без ожидаемых значений

До discovery используются публичные `read_table_row_page` / `readTableRowPage` — проверенные копии строк T37. Он сохраняет полную проверку страницы, native descriptor guards, лимиты и порядок ошибок. Разбор нативного объекта до проверки запрещён.

Discovery: только уникальные полнострочные заголовки и шесть полных кортежей категорий по всей странице. Допустимы collapse ASCII space/TAB/NBSP/U202F и trim для поиска; все emitted raw остаются исходными, unit требует буквально `мин`. Никакого sourceID, номера страницы, ожидаемого R/REI или числа в policy.

Колонка категории: min/max x выбранных labels и её header. Колонка значения: точный x-span value-header; unit обязан целиком помещаться. Колонки упорядочены, не пересекаются. Полосы строк — точные bbox union соответствующих 1–2 label lines; геометрия значений при построении не читается. Table box: left категории, bottom последнего label, right value-header, max top заголовков/unit. Дополнительная строка даже в зазоре колонок не получает роли и отклоняет таблицу.

Узкие guards исходного layout: высота 11000–13000, spread ≤1000; left-spread labels ≤1000; header/body gap ≤15000; соседние строки/части label gap ≤7000 milli-points. Binder получает целую страницу и производную policy: шесть `valueLineCounts=1`, max gap 7000. Только BOUND всех шести, затем корректные шесть значений дают output; частичный output запрещён.

Value grammar: uppercase ASCII `R` или `REI`, один/несколько ASCII пробелов, каноническое положительное целое ≤MAX_SAFE_INTEGER. Без leading zero, TAB/NBSP, краевых пробелов, дробей, диапазонов, порогов, альтернатив и ремонта glyphs. `R` и `REI` отдельные критерии; числового сравнения нет. PD/RD допустимы как literal source-authored evidence; реальный пример пока только PD. Wrapper сохраняет strict single-stage/pageStages policy.

## Wire и версии

Pure candidate: `criterion`, integer `minutes`, whole-line `rawValue`, `rawUnit:"мин"`, `canonicalUnit:"min"`, original `constructionLabelLines`, `primaryFragments[1]`, `scopeFragments[1|2]`, `headerFragments[2]`, `unitFragments[1]`, `bindingPolicyVersion:"matrix-fire-resistance-upper-table-v1"`, integer `tableBoxMilliPoints`. Fragments `{pageNumber,blockIndex,lineIndex,rawText,bboxMilliPoints}` сохраняют исходный T37 pageNumber без перенумерации.

Новая декларация: `kind:"SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION"`, individual `schemaVersion:"matrix-source-declaration-v1"`, `extractorVersion:"matrix-fire-resistance-table-v1"`, общие SHA/source/frame поля, `entityKey:null`, `applicabilityStatus:"UNREVIEWED"`, полный candidate payload. Нет `value`, parameterCode/attribute/rule/probability/productScope/чужой authority. Смысл — заявленное проектом табличное значение; отношение GE/minimum, фактическая достигнутая огнестойкость и универсальная норма не утверждаются.

Новый envelope `matrix-source-declarations-v2`; declarations union steel-v1|fire-v1. Новый профиль `matrix-text-facts-evidence-v4`, adapter `4`. Существующие v1 wrapper и профиль v3 заморожены; новые Python/TS v2 wrappers вызывают прежний steel extractor и независимо добавляют fire. Old steel bodies/IDs не меняются. Read DTO принимает v1|v2, текущие v3/v2/v1 definitions сохраняются byte-identical.

ID использует прежний domain `matrix-source-declaration-id-v1` и полное тело кроме id. Text hash — прежний `matrix-source-declaration-text-artifact-v1`, весь оригинальный envelope. PolicyHash не нужен: API заново строит policy и output, artifact hash связывает всю геометрию, ID — полные fragments и version. Canonical JSON — прежние Unicode scalar / ASCII keys / safe integers / depth64 guards. Новые pins только в v4: v2 wrapper, fire helper, mechanical binder, версии policy/hash; старые config hashes указаны в JSON.

## Точки интеграции и сохранение старых снимков

`packages/contracts/src/matrix-source-declarations.ts:26,49`: сохранить steel/v1, добавить fire/v2 + read union. `packages/contracts/src/matrix-execution.ts:103`: optional sibling union. API OpenAPI `apps/api/src/api-contract.ts:2265` — strict discriminator, отдельные schemas envelopes.

Новые `source_declarations_v2.py` и `matrix-source-declarations-v2.ts`: full artifact validation, authenticated source/hash/pageStages, независимый policy builder и binder. Старый `apps/api/src/matrix-source-declarations.ts:151,215` остаётся v1. Rehashed forgery не становится доказательством: API реконструирует весь ожидаемый envelope.

`services/worker/inspector_worker/durable_matrix.py:20` и `apps/api/src/matrix-execution.ts:17,49,65`: явная v4 capability, pins и dispatch; v3 требует только v1 declarations, v4 — v2; profiles1/2 запрещают declarations. `matrix-execution.ts:124`: scalar reserved-field isolation новых полей.

`apps/api/src/postgres-repository.ts:12069`: validator по профилю перед atomic completion. `:12256` — read allowlist и точная схема сохранённого профиля. **Миграция БД не нужна**: immutable JSON sibling и существующая whole-content seal уже достаточны. Ни исторические данные, ни submission snapshots не переписывать. `outputCount` остаётся execution.results.length; targets/reviews/findings/coverage/submission не получают fire declarations.

`apps/web/src/MatrixSourceDeclarations.tsx:6`: switch kind до обращения productScope/value; fire label, отдельные R/REI и минуты, search по original labels/raw. Доступны original primary, labels, headers и unit; никаких bind/review/approve/compare actions. Новые Python helpers/binder нужны в COPY и release pins `apps/api/Dockerfile`.

## Приёмка и порядок реализации

1. Использовать согласованные pure wire и prevalidated T37 reader; независимые Python/TS helper, full139 goldens и атаки на anchors/geometry/native inputs. Runtime pins подключать после pure Python freeze.
2. Contract union и отдельные v2 wrappers; exact steel ID/body stability, full-envelope reconstruction, all6-or0.
3. Explicit v4 pins и atomic PG: валидные шесть сохраняются, подделка с пересчитанным ID не сохраняет частичных данных. Equal scalar execution/coverage/targets/findings/submission before/after evidence; реальные старые v1/v2/v3 snapshots и config hashes прежние.
4. Kind-aware UI. Браузерная проверка остаётся pending до отдельного снятия browser policy HOLD; этот дизайн браузерной приёмкой не является.

Подробный набор pure/boundary/PG/UI тестов — `api-design.json`. Реальной RD пары и соответствия физических элементов не установлено. 77 UNSUPPORTED не уменьшаются от добавления доказательств.
