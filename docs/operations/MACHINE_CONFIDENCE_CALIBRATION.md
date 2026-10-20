# Подготовка офлайн-калибровки machine confidence

`scripts/prepare-machine-confidence-calibration.py` готовит воспроизводимый кандидат
калибровки из исходных scores и отдельно полученных меток **`engineering_violation`**.
Метка `1` означает подтверждённое инженерное нарушение в конкретном кандидате;
`0` — отсутствие такого нарушения по принятому протоколу разметки. Это не метка
качества OCR, наличия текста, правильности классификации страницы или уверенности LLM.

Инструмент использует только Python 3.10+ stdlib. Он не импортирует приложение,
не обращается к БД, сети или providers, не читает другие датасеты и не меняет runtime.
В текущую замороженную сборку этот скрипт не включён.

## Вход

Нужны JSON manifest и два JSONL-файла: `fit` и `evaluation`. Разбиение назначают
**до просмотра результатов evaluation**. Принадлежность модели, версии, домену,
источнику меток и целевой переменной задаётся явно. Следующий пример — схема
с заполнителями, а не предоставленные реальные метки или готовый запуск:

```json
{
  "schema_version": 1,
  "calibration_version": "candidate-calibration-v1",
  "label_target": "engineering_violation",
  "domain": "precise-rule-family-and-document-domain",
  "model": {
    "id": "candidate-detector",
    "version": "immutable-model-or-rules-version",
    "score_name": "raw_candidate_score"
  },
  "score_domain": [0, 1],
  "label_provenance": {
    "source_id": "independent-label-register",
    "source_version": "immutable-label-register-version",
    "annotation_protocol": "protocol-reference-and-version",
    "annotator_authority": "reviewer-or-authority-reference",
    "independent_of_model_predictions": true
  },
  "split_provenance": {
    "method": "predeclared-object-and-document-disjoint-assignment",
    "assignment_id": "split-register-reference-and-version",
    "assigned_before_evaluation": true
  },
  "sources": {
    "fit": {"path": "fit.jsonl", "sha256": "<exact-64-lowercase-hex>", "bytes": 1234},
    "evaluation": {"path": "evaluation.jsonl", "sha256": "<exact-64-lowercase-hex>", "bytes": 1234}
  }
}
```

Одна JSONL-строка имеет ровно следующие поля; значения здесь тоже иллюстративные:

```json
{"candidate_id":"candidate-001","label_id":"label-001","object_id":"object-001","document_sha256s":["<exact-document-sha256>"],"score":0.35,"label":1,"label_target":"engineering_violation","domain":"precise-rule-family-and-document-domain","model_id":"candidate-detector","model_version":"immutable-model-or-rules-version","label_source_id":"independent-label-register"}
```

`document_sha256s` перечисляет все документы, от которых зависит кандидат. Для
сравнения ПД/РД указывают оба SHA. Нельзя убрать общий документ или переименовать
объект ради обхода проверки разделения. SHA документов являются заявленными
идентификаторами: инструмент не открывает PDF и не удостоверяет их происхождение.

Manifest фиксирует SHA-256 и число **исходных байтов** каждого JSONL. Скрипт
сверяет их до разбора. Пути разрешены только внутри каталога manifest; вход —
обычные файлы. Поля схемы закрытые, неизвестные поля запрещены. Повторяющиеся
ключи JSON, NaN/Infinity, переполнение float, неверный UTF-8, одиночные Unicode
surrogates в текстовых полях и повреждённые записи отклоняются.

Scores принимаются только как JSON number, **не boolean**, конечные, в заранее
заданном `score_domain`: строго возрастающий поддиапазон `[0,1]`. Метки принимаются
только как JSON boolean или целое `0`/`1`; `0.0`, `"1"` и scores boolean запрещены.
Кандидат, метка и объект имеют непустые строковые идентификаторы. `candidate_id`
и `label_id` уникальны во всём входе. Между fit и evaluation запрещены любые общие
`object_id` и SHA документов; внутри одного split повторение объекта допустимо.
Несовпадение target/domain/model/version/label source с manifest — отказ.

Обязательные provenance-утверждения должны быть `true`, но **их наличие не
доказывает независимость**. Нужна независимая проверка исходного реестра меток,
протокола, разбиения, связности объектов/документов и возможной утечки из обучения
основной модели. Связанные копии документов с разными SHA и объекты под разными ID
автоматически не распознаются. Значения меток нельзя создавать из scores, выводов
помощника или отсутствия обнаруженного текста. Скрипт метки не создаёт.

Фиксированные ресурсные границы: manifest 65 536 байт; каждый JSONL 16 777 216 байт,
50 000 записей; строка JSONL 65 536 байт; глубина JSON 16; до 16 SHA на кандидата;
текстовое поле до 512 codepoints; результат до 16 777 216 байт. Пустые split
отклоняются. Это границы обработки, **не критерии качества и не минимальный
достаточный размер выборки**.

## Метод и метрики

Scores сортируются, одинаковые scores объединяются с их реальными количествами
меток. Increasing pool-adjacent-violators (PAV) минимизирует сумму квадратов ошибок
с ограничением монотонности; соседние блоки с нарушенным порядком объединяются.
Выбор объединений использует целые суммы меток/количества и cross-products.
Определение задачи и PAV приведены в [официальной документации SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.isotonic_regression.html).
SciPy не является зависимостью этого инструмента.

Параметры содержат все различные score knots, fitted probabilities, границы
блоков, числители и количества. В наблюдаемых knots возвращается fitted значение;
между соседними knots используется **линейная интерполяция**. Это заранее выбранная
политика данного артефакта, не доказательство вероятностной корректности.
[Документация scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.isotonic.IsotonicRegression.html)
описывает isotonic-модель с интерполяцией; библиотека также не устанавливается.

За пределами **наблюдаемого fit-диапазона**, даже внутри declared score domain,
результат — **ABSTAIN**. Нет clamp и extrapolation. Если fit содержит один
уникальный score, поддерживается только точно этот score. Другой домен/версия
модели не становятся поддержанными от использования похожего числового score.

Для fit и heldout раздельно выдаются:

- количество всех/положительных/отрицательных, scored и abstained кандидатов;
- coverage = scored / все кандидаты;
- Brier = среднее `(p - label)²` **среди scored**;
- ECE для 10 равных probability bins: `[j/10,(j+1)/10)`, последний включает `1`;
  сумма `count_bin / scored * abs(mean_probability_bin - event_rate_bin)`;
- количества, средняя probability и event rate каждого bin.

Если весь heldout вне fit-диапазона, coverage равен `0`, Brier и ECE равны `null`.
Их нельзя выдавать за нулевую ошибку. Fit-метрики описывают ту же выборку, на которой
подобраны параметры; heldout не используется при подборе. Метрики зависят от состава
кандидатов и разбиения. Универсального порога accuracy, размера выборки или
автоматического решения о пригодности здесь нет.

Артефакт сохраняет точный hash/размер manifest и обоих исходных файлов, provenance,
версию инструмента/модели/калибровки и hashes состава каждого split. `rows_sha256`
считает UTF-8 JSON записей, отсортированных по `candidate_id`, с sorted keys и
separators `(',', ':')`; labels нормализованы в integer, scores в float (`-0`
нормализован в `0.0`). Два остальных split hash считают отсортированные уникальные
списки object ID и document SHA тем же JSON encoding. Exact file SHA сохраняет
исходный порядок, форматирование и исходные типы отдельно.

## Запуск и граница разрешений

После подготовки реальных файлов и внешней проверки их происхождения:

```sh
python3 -I -B -S scripts/prepare-machine-confidence-calibration.py \
  --manifest /path/to/approved-label-package/manifest.json \
  --output /path/to/private-results/new-calibration-candidate.json
```

Каталог результата должен уже существовать. Результат публикуется атомарно только
по новому имени: временный файл в том же каталоге, mode `0600`, flush/fsync,
exclusive hard link конечного имени, удаление временного имени. Существующий файл
или symlink не заменяется; неподдерживаемая файловой системой публикация означает
отказ. Ошибка до публикации не оставляет частичный артефакт со статусом prepared.
В stdout печатаются только статус, SHA и размер результата; при отказе exit `1`.
Никаких clocks/random seeds в содержимом нет: одинаковые входные байты дают
одинаковые выходные байты при той же версии инструмента/Python.

Статус результата всегда **`PREPARED_REQUIRES_INDEPENDENT_LABEL_REVIEW`**,
`runtime_activation_permitted=false`, review остаётся `REQUIRED_NOT_PERFORMED`.
Даже идеальные метрики на синтетических тестах или реальном heldout не меняют статус.
Это кандидат для независимого review, **не принятая калибровка**. Артефакт сам не
задаёт `expectedCalibrationVersion`, не меняет threshold и не разрешает выводить
scores как probabilities. Подключение к продукту требует отдельного решения,
проверки domain/model/source provenance и квалификации; загрузчик runtime здесь
не добавлен. Исходные labels и результаты следует хранить с ограниченным доступом.

Focused tests используют только явные синтетические метки и hand-calculated
ожидания, без исходных/скрытых labels проекта:

```sh
python3 -I -B -S scripts/tests/test_machine_confidence_calibration.py
```
