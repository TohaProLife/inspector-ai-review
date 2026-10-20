# T46: сравнение reviewed ведомостей поручней

Рабочий следующий этап после pure-приёмки T45. Консервативная граница утверждена root в T45: ПД явно содержит оба типа WC-поручней, полная непустая reviewed ведомость РД того же санузла не содержит ни одного. Один отсутствующий тип остаётся неопределённым. Поручень раковины не заменяет поручень унитаза. Pure, review и durable v7 приняты по backend и активированы на обычном homeserver. Browser gate остаётся pending; real qualification остаётся нулевой.

1. [x] Заморозить отдельные projection/review/comparison DTO и независимые целые ожидаемые результаты до сравнительного кода. Source body — только принятый T45, без изменения literal grammar или исходных goldens.
2. [x] Независимые TS/Python comparators, затем взаимные exact-output проверки. Все конкурирующие claim учитываются до CURRENT/APPROVED/полноты/section-фильтров. Разные помещения, stale/UNKNOWN, смешанные стадии, несколько ведомостей, basin/seat substitution не становятся пустой РД.
3. [x] Серверная materialization отдельного rail-domain review, CAS/omission/withdrawal, полный parent review hash. Сохранить matrixScope, AR inventoryScope и callInventoryScope с прежней семантикой. Выделить общую механику оригиналов/target/review, если она сокращает копирование без изменения frozen legacy helpers; vocabulary, identity и predicate остаются domain-specific.
4. [x] Отдельный typed capability/profile после pure и review gates. Формировать rules и provider slot из согласованной политики; проверить настоящее создание release через feature flags и установленный worker. Тесты с подменой release metadata не подтверждают этот путь.
5. [x] Evidence содержит оригинальные header/scope/end и все multiline fragments обоих операндов. Фиксировать исходные bytes, frame, полный text artifact и immutable run snapshots. Сравнение не подтверждает количество, монтаж, нагрузку, размеры или физическое отсутствие.
6. [x] Полные тесты и actual PostgreSQL, сквозной HTTP на обычном homeserver, supersession и restart сохранности. Browser gate отдельно: прежний security URL hold не обходить.
7. [x] Принять ограниченный scope и сразу перейти к исправлению общего pipeline реальных source/fact bindings в T47. Real qualification отдельно от authored-fixture проверки и количества реализованных atoms.

Точное имя будущей identity: `ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY`; entity/building/floor/room задаются явным review. Source room token сохраняется и связывается человеком; совпавший номер не доказывает соответствие. ПД/ОДИ, РД/АР, один object и непустой link group, CURRENT/APPROVED. Обе ведомости имеют `HUMAN_ASSERTED_COMPLETE` только для всех поручней выбранного санузла. Итог — `Кандидат`, `calibratedProbability:null`; `NO_VIOLATION` и утверждение физического отсутствия из этой проверки не следуют.

Исходная реальная ПД F0151 содержит подписи fixed/folding/basin и повторные детали, но не authentic same-room РД и не утверждённую полную ведомость. Этот этап не создаёт отсутствующую реальную пару. См. T45 research и provenance оригиналов.

## Решения интеграции перед реализацией

Обнаруженный T44 defect делает обязательным единый runtime selector: выбранные definitions, profileId, adapterVersion и configHash возвращаются одним согласованным объектом. Проверка всех сочетаний трёх feature flags должна создавать настоящий release, без подмены metadata. Старые v1–v6 definitions/config hashes не меняются; v7, если дойдёт до durable приёмки, остаётся additive.

Общие механические части: native limits полного parent envelope, target origin resolution, immutable review/preimage verification, A/B/C snapshot reread и source-byte verification. Семантические части остаются отдельными: source grammar, rail identity, PD/RD section roles, полнота room rail inventory и предикат обоих отсутствующих WC типов. Извлечение общей механики допустимо только с byte-equal regression старых доменов; большие рефакторинги не нужны. Не создавать универсальный «есть слово/нет слова» evaluator.

Порядок поставки: T45 source parity и точный перенос; T46 wire/manual goldens; независимые pure comparators; review+server reconstruction; typed durable profile+installed resources; actual release selection/PG; original HTTP positive/UNKNOWN/restart. Старые результаты читаются своим pinned policy, новая mutable latest review не пересчитывает их. UI каждого положительного результата показывает «Кандидат», пока calibratedProbability отсутствует.

## Wire and source prerequisites, 03:29 UTC

T45productionpure accepted with160whole-output parity perlanguage,158uniqueinputs and original20PDF/53fixture integrity. T46wire+manualplan+58fullcomparisonexpected+2requestprojectionvectors frozen before comparator implementation and approved separately in `root-wire-and-manual-goldens-approval.json`. Four expected candidates/54abstentions; all20originals represented. TS independent first baseline141checks/291assertions PASS; Python independent implementation in progress, cross not yet authorized. Staged review contracts/validation separately pass2frozenrequestvectors,8candidate source decisions,20validation cases/traps0; parent512KiB/8M enforcement explicit. These staged pieces do not establish server review authority, activation or coverage.

## Локальный review-срез принят 03:41 UTC

Отдельный `railInventoryScope`, migration036, серверная materialization из sealed original, общий parent hash, CAS, omission/withdrawal/idempotency и routed preview реализованы. Старые миграции и frozen v1-v6 definitions не менялись. Новый web editor сохраняет исходные multiline строки, независимые UNKNOWN/полноту и deep request projection; fact review сохраняет rail sibling. API123/5files, web160/4files, actual PostgreSQL8/2files без skip, API/web typecheck PASS. Receipt: `output/matrix-t46-20261018/root-review-slice-acceptance.json`. Первый authoring RED schema discriminator/SQL mapping сохранён, исправлен до приёмки. Durable v7/profile/complete/seal/read и stand acceptance ещё впереди; browser отдельно остаётся pending. Synthetic qualification не означает real-pair qualification.

## Production pure принят 03:44 UTC

Независимые TS/Python:156/156 whole outputs в каждом языке,149уникальных входов. Первый cross RED по диагностике duplicate-source/origin сохранён; применено предшествующее baseline уточнение gate2 SOURCE_PROVENANCE_UNVERIFIED. Старый52-corpus сохранён отдельно от clarified-v2 (изменены только2reason). Pure relocation: Python точные bytes, TS только2import paths. API859PASS/10files; Python28owned methods (156whole+24native+fixture) и304neighborsPASS; APItypecheck/pycompile/diffcheckPASS. Receipt `output/matrix-t46-20261018/root-production-pure-acceptance.json`. Новый typed wrapper TS/Python независимо разрабатывается; profilev7 и durability ещё не приняты.

## Durable v7 локально проверен, 04:02 UTC

Новый профиль `matrix-text-facts-rail-inventory-v7`, adapter7, config `35be151bd0eff262bb7e19feb2b91c6d6e5e0f70ea41dee43f05ea331ebdcd36`; прежний v6 config `dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad` и v1-v5 сохранены. Один policy tuple выбирается по фактическим feature flags для definitions, rule config и provider slot; все8комбинаций проверены. Actual PostgreSQL2новых durable tests без подмены ensureAnalysisRelease прошли: candidate/UNKNOWN/withdraw/restore/frozen history, A/B/C source I/O, fence, authorization, malformed siblings/counts/coverage/scalar namespace, нулевые writes после rejection.

TS/Python typed wrappers:129whole-output parity в каждом языке; первый RED и уточнения целиком сохранены. Python durable independent QA20новых+21legacyv6 PASS,270definition faults+20source drifts+18projection faults, все3typed siblings/nullconfidence,63scalarresults/1constraint/8declarations byte-equal. Старые execute/release validators ни разу не вызываются. Настоящий localhost HTTP проверяет redirects/status/body/deadline/cleanup. Installed wheel вне checkout4PASS: реальный v7 dispatch, реальные21resources, hashes4новых modules и registries.

Общий API3605PASS/126skip, web558PASS/55files, typecheck/build PASS. Полные Python и actual PostgreSQL ещё выполняются. Первый fullPG RED — устаревшие список миграций и skipped-count в старом generic test:36-я additive migration отсутствовала в ожидании. Исправлены оба ожидания; runtime не менялся. Лог `/tmp/matrix-t46-full-postgres-first.log` сохранён privately. Freeze446source+3unchanged dependencies: `output/matrix-t46-20261018/source-freeze.json`, SHA `50921ead4f581ae57d516395a5626895f9642e2d2f8568bfa97363daec4a9837`.

Семь images собраны после проверки56старых snapshots/132targets/1localreview и0active runs. Running-контейнеры на этот момент не заменены. HTTP manual expectations+scripts отдельно заморожены до первого live вызова. Target58/66/74 ещё не принят на стенде; synthetic workflow не даёт real qualification.

Следующий T47 уже определён read-only аудитом: immutable scalar fact target reader ограничен v1-v4 и блокирует сохранение привязок фактов из v5/v6/v7. Это отдельный известный дефект существующего workflow, не причина расширять старые immutable profiles; нужен aggregate reader с policy-specific validation и actualPG regression. После исправления — actionable очередь недостающих source/fact bindings по уже реализованным правилам. До подтверждённых реальных пар не наращивать число synthetic-only профилей.

## Backend принят, T47 продолжается, 04:14 UTC

Итоговый receipt `output/matrix-t46-20261018/acceptance.json`: 6727 PASS/143 skip основных gates; actual PostgreSQL 90 PASS/18 files/0 skip. Typecheck/build/diff PASS. Seven-role runtime pins до и после restart совпали; 59 snapshots/13 groups, 132 legacy targets и одно local review сохранены. Старый FAILED CHK-EA89EC57 побайтно сохранён. DB и модели не перезапускались; RTX 2080 SUPER, H100 не использован.

Сквозной original-PDF HTTP: CHK-D3768C1C unbound, CHK-48846E34 один rail candidate с 12 исходными фрагментами, CHK-D16F80BE UNKNOWN и ноль кандидатов. Полные прежние machine/submission bytes не менялись. Calibrated probability null; effective coverage 58 parameters/66 atoms/74 unsupported, scalar 55/63/77 сохранён. Это authored synthetic fixture: квалифицированных реальных пар 0, полнота всех 58 параметров не заявлена.

Первый live RED: harness вызывал call route вместо rail route; readonly preview отклонён до review writes. Исправлена только строка route; прежний harness и RED сохранены. Цепь freeze v1/v2/v3 хранит оба migration-test amendments и route-only amendment; production build inputs между ними не менялись. Финальный v3 SHA ecd48f02c9a513bc58baf12736538d7339aa4302b8d784ec2f4d56dd77812b0d. Browser calls 0, прежний security hold не обходился.

T47 уже исполняется: actual PG воспроизвёл target reader defect на v5-v7 (null вместо двух scalar targets), v1-v4 positive. Исправляется общий transactional reader и очередь реальных source/fact confirmations; новые synthetic-only profiles сейчас не добавляются.
