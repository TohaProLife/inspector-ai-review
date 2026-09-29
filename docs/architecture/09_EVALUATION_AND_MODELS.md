# Evaluation, GOLD и выпуск моделей

Версия 1.3. Модель считается принятой только при выполнении всех обязательных порогов на предусмотренной методикой выборке. Локальная validation не подменяет официальную hidden test-приёмку. По [Q&A](../HACKATHON_QA_SESSION.md) hidden test не выдаётся участникам и может охватывать не все 132 параметра; точный scorer всё ещё отсутствует. Оценка следует [маршрутизации по параметру](06_DOCUMENT_PIPELINE.md#21-маршрутизация-по-параметру), а не только качеству отдельного детектора.

## Изоляция данных

Dataset release содержит canonical manifest/hash, original source bindings, object_group_id, split, annotation version, access policy и licence/provenance. Одна стройка и все её редакции находятся в одном split, даже если source object_id переименован: нужен object_group registry.

Разделить training, validation, hidden evaluation и demo credentials/storage mounts. Inference worker не монтирует gold annotations; evaluator получает predictions после seal. Frozen hidden test нельзя использовать для threshold tuning или ручного исправления правил. Public checks используются как regression examples, а не как независимый test.

Текущие десять public positives одного объекта не позволяют оценить FPR. Неизвестные labels не считать отрицательными. Синтетические fixtures маркировать и не включать в реальные ML-метрики без отдельного согласованного отчёта.

## GOLD lifecycle

Human decision → annotation draft → curator validation → approved annotation → immutable dataset_version. В draft входят только CONFIRMED_VIOLATION и экспертно проверенные NEGATIVE_VERIFIED с достаточным evidence; остальные статусы не являются GOLD.

Куратор проверяет atomic scope, актуальность редакции, source hashes, правильность reason_code, наличие отрицательных примеров и отсутствие leakage. Для WRONG_LINK/OCR_ERROR сначала исправляется доказательная группа; запись нельзя автоматически считать валидным предметным negative. Составной finding получает labels только по атомарным детям.

Dataset item сохраняет expert_id, decision_id, curator_id, dates, reason, source fingerprints и versions. Публикация не меняет старый dataset release. Спорные записи помещаются в review queue и не участвуют в обучение до разрешения.

## Evaluation run

1. Проверить hash и split integrity входов, доступность только разрешённых files.
2. Зафиксировать model/rule/matrix/mapping/config release и hardware profile.
3. Выполнить обычный inference по оригиналам, сохранить frozen predictions и timings.
4. Провалидировать submission adapter и evidence references.
5. Выполнить one-to-one matching с gold через версионированный scorer; дубликаты не увеличивают TP.
6. Посчитать показатели и срезы, coverage/abstention, ошибки/время/ресурсы.
7. Сохранить evaluation report/hash, список ошибок и reproducibility manifest.

Единица matching — официальная evidence_group/atomic rule согласно методике. На сессии её описали как atomic control point с ключом как минимум `object_id` + `parameter_code`, но полный набор полей/location rules обещан письменно. До получения scorer использовать обозначенный LOCAL scorer с документированным matching; не публиковать его балл как официальный. Для exact file/page нужны все обязательные источники, а не один удачный фрагмент.

Верхний уровень конкурсной оценки: 75% technical и 25% pitch/demo. В technical названы functional completeness, OCR, F1, Precision и Recall; внутренние веса не раскрыты. Вероятная будущая публикация scorer/validator не считается доступностью инструмента до readback и hash/version.

## Метрики

| Метрика | Расчёт / gate |
|---|---|
| OCR Character Accuracy | 1−ΣLevenshtein/Σgold chars ≥0,95; NFC и повторные пробелы по ТЗ, CER/WER/coverage отдельно |
| Key fields EM | Доля точных совпадений после утверждённой field-specific normalization ≥0,90 |
| Linking | Полностью правильный object/stage/code/current revision в группе ≥0,95 |
| Evidence localization | Exact files/pages; bbox/polygon IoU ≥0,5; ≥0,95 групп с полным комплектом |
| Precision | TP/(TP+FP) ≥0,90 |
| Recall | TP/(TP+FN) ≥0,80 |
| F1 | 2PR/(P+R) ≥0,85; проверять отдельно от P/R |
| FPR | FP/(FP+TN) ≤0,10 на NEGATIVE_VERIFIED и stale-revision случаях |
| Coverage | Реализованные параметры / применимые группы / исполненные сравнения — раздельно |
| Abstention | По причинам и типам документов, с утверждённым denominator |

При нулевом знаменателе значение null/NOT_ESTIMABLE, не 0 или 1. Порог не считается пройденным при отсутствии пригодной выборки. Не округлять 0,847 до проходного F1 0,85.

Отчёт показывает sample sizes, TP/FP/FN/TN, 95% CI, срезы по объектам, разделам, типам нарушений и документам. Для зависимых наблюдений использовать object-cluster bootstrap, seed и число повторов фиксировать. Если объектов слишком мало для содержательного CI, явно указывать ограничение; нельзя выдавать тысячи страниц одного объекта за тысячи независимых наблюдений.

Потери обязательного positive из-за abstention учитываются в recall по официальной методике, а не исчезают из знаменателя. Missing/not-applicable cases оцениваются также как classification of status. Synthetic regression и реальные evaluation metrics — разные разделы.

## Проверка маршрутизации и визуального поиска

Для каждого выбранного параметра на `TRAIN_PUBLIC` отдельно фиксируются: правильность выбора документа/редакции/листа, полнота извлечения нужных фактов, точность привязки к системе и помещению, полнота отрицательного поиска, итоговый comparator и evidence bundle. Качество графического поиска считать на полностью просмотренных листах, включая все целевые знаки и проверенные похожие области; несколько предложенных рамок одного объекта подходят для регрессии, но не дают оценки полноты. Знаменатели и abstention у каждого этапа публикуются отдельно.

На одних и тех же разрешённых кейсах сравниваются: текст/таблицы/векторные правила; геометрия и шаблоны; локальная модель с визуальным примером; их объединение с проверкой выносок, подключений и помещений. Замеряются precision/recall кандидатов, ошибки привязки, итоговые P/R/F1/FPR, evidence completeness, время и память локального и стендового профилей там, где оборудование доступно. Порог и состав шаблонов настраиваются без `TEST_HIDDEN`; листы одного объекта не разделяются между обучением и независимой оценкой.

Отдельный обученный детектор допускается к сравнению только после документированного класса устойчивых пропусков и curated разметки. Его победа определяется итоговым результатом на замороженном наборе и ресурсным бюджетом, а не числом совпадений с похожими картинками. Пока такого сравнения нет, качество выбранной графической ветки — `NOT_ESTIMABLE`.

## Release manifest

Один immutable release связывает renderer/OCR/layout/linking/LLM artifacts, tokenizer/language packs, prompts, inference parameters, normalization/rules/matrix/mapping/normative versions и capability flags. Для каждого — artifact SHA, dependency/environment lock и resource profile. Инференс фиксирует применённый release_id; обновление зависимостей не меняет предыдущий release.

Текущий provider-neutral runtime уже создаёт append-only `analysis-release-v1` с content hash и FK от run/jobs. Он фиксирует text-layer и rules contracts, `externalNetworkAllowed=false` и отдельные slots для render/OCR/layout/metadata/linking/extraction/rules/evidence. До qualification все slots имеют `UNCONFIGURED` и пустые profile/version/artifact/config/license/resource fields. Это schema для будущего выбора, а не утверждение provider: перевод slot в `CONFIGURED` допустим только новым immutable release после проверки artifact hash, лицензии и resource profile.

Целевые кандидаты для двух resource profile выбраны в [Provider selection](15_PROVIDER_SELECTION.md). Это закрывает архитектурную развилку, но не меняет текущий release: пока adapters, локальные artifacts, quality/resource evaluation и manifest hashes не готовы, slots остаются `UNCONFIGURED`.

Model lifecycle: DRAFT → EVALUATED → APPROVED → DEPLOYED → RETIRED; отклонённая версия REJECTED. Approval не автоматический: ответственное лицо подписывает release decision. Rollback переключает active pointer для новых runs, не переписывает старые outputs.

Gate публикации: обязательные абсолютные пороги, отсутствие снижения recall по любой обязательной категории >2 п.п., отсутствие роста FPR >2 п.п., воспроизводимость, лицензии, artifact integrity и ресурсный budget. Сравнивать на одинаковом frozen evaluation наборе. Если категория не имеет достаточных данных — NOT_ESTIMABLE, решение о полном допуске блокируется либо требуется явно ограниченный пилотный release; это не «порог пройден».

## Управляемое дообучение

Для базового хакатонного зачёта достаточно воспроизводимого pipeline: object-isolated inputs, hashes, evidence validation, dataset versions и release manifest. Фактически дообученная модель может улучшить решение, но не заменяет этот контур; точная надбавка за обучение не объявлена.

Trigger — curated dataset release, не каждое нажатие REJECT. Учебный job получает разрешённый split, сохранённые hyperparameters/seed/environment и objective. Output — candidate artifact и report, без доступа к production deploy.

Еженедельный отчёт для ML-инженера: ошибки по reason_code, override rates, размеры positive/negative drafts, rejection/dispute backlog, coverage по категориям, предложения по новым fixtures. Никаких автоматических смен порога по production feedback без нового evaluation/release.

Production monitoring обнаруживает рост abstention/ошибок/latency и изменение распределения входов. Эти сигналы инициируют исследование, но не доказывают изменение F1 без новых экспертных labels.
