# T18: высоты эвакуационного коридора и двери — AR-042

17.10.2026. Узкий Python-срез реализован; приёмка API, durable run и браузера проводится отдельно. Правила не подтверждают нормативное соответствие проекта автоматически. Положительная реальная пара ПД/РД по этим высотам в ограниченном публичном поиске не найдена.

## Основание

Исходная запись неизменна: `services/worker/rules/parameter_catalog_132.jsonl`, строка 42, `AR-042`, matrix row 43. Trigger дословно: «Высота коридоров < 2.0 м или дверей < 1.9 м (СП 1.13130).» Unit — `м`; ПД — разрезы и высотные отметки АР; РД — рабочие размеры и чертежи лестничных клеток АР; ИД — исполнительная геодезическая схема высот интерьеров.

Это источник двух каталожных порогов, не доказательство применимости конкретной редакции нормы, исключений или способа измерения к объекту. Предметный review обязан установить их до сравнения. Criticality каталога задаёт приоритет review, не автоматическое юридическое действие. См. [07_RULES_AND_EVIDENCE](../architecture/07_RULES_AND_EVIDENCE.md) и [14_PARAMETER_IMPLEMENTATION_MATRIX](../architecture/14_PARAMETER_IMPLEMENTATION_MATRIX.md).

## Реализованный ограниченный контракт

| Поле | Коридор | Дверь |
|---|---|---|
| ruleId | `matrix-ar-042-evacuation_corridor_clear_height` | `matrix-ar-042-evacuation_door_clear_height` |
| attribute | `EVACUATION_CORRIDOR_CLEAR_HEIGHT` | `EVACUATION_DOOR_CLEAR_HEIGHT` |
| Единственная literal label | `Высота эвакуационного коридора в свету` | `Высота эвакуационной двери в свету` |
| threshold.value | `2` | `1.9` |
| componentRole | `EVACUATION_CORRIDOR_CLEARANCE` | `EVACUATION_DOOR_CLEARANCE` |
| measurementBasisKey | `CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION` | `CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD` |

Общие поля: version `1`, family `LOWER_BOUND`, canonicalUnit/threshold.unit `m`, strict `true`, valueKind `DECIMAL`, expected/actual sections `['AR']`, allowedStagePairs `[['PD','RD']]`, comparisonVariants `['PD_RD']`, scopePolicy `EXPLICIT_REVIEWED_CONTEXT`, comparisonPurpose `CATALOG_TRIGGER`. Только точные units `['м','m','мм','mm','см','cm']`; существующие Decimal conversions сохраняются.

Только одна полная source line: literal label, разделитель существующей grammar, одно число и одна единица. Casefold применяется к label; spelling единицы не расширяется. Числа используют существующую `_NUMBER`, включая точные десятичные и допустимые разделители тысяч. Primary evidence — ровно один исходный fragment. Таблицы с разнесёнными ячейками и общий поиск размеров этим срезом не разбираются.

У обоих атомов requiredContext строго:

1. `NORM_APPLICABILITY_VERIFIED`.
2. `EVACUATION_ROUTE_IDENTITY`.
3. `ATOMIC_SUBRULE_SCOPE:<собственный ruleId>`.

`subruleContext` имеет schemaVersion `matched-atomic-context-v1`, собственный componentRole и identityFields ровно `['componentKey','zoneKey','operatingModeKey','measurementBasisKey']`. На обеих сторонах все четыре поля должны быть непустыми и совпадать. Дополнительно `operatingModeKey` строго `EVACUATION`, measurementBasisKey строго из таблицы выше. Совпадающие `NOMINAL_DOOR_LEAF`, `FLOOR_TO_FLOOR` либо режим обычной эксплуатации не проходят.

Новые роли допускаются только для точных двух rule definitions, кода AR-042, family, labels, units, threshold, sections, contexts и stage pair. Пять legacy DECREASE roles и отдельная sidewalk policy не расширены.

Остаточный gap сохраняется дословно:

```text
SCOPED_LITERAL_HEIGHT_ONLY;DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_AND_PD_BASELINE_REVIEW_REQUIRED
```

После добавления: 132 кода, 51 параметр с атомами, 58 атомов, 87 разрешённых stage groups, 81 unsupported parameter. Это число установленных определений; оно не означает real corpus extraction, успешное сравнение или полный scope AR-042.

## Что подтверждает review

Факт сам не устанавливает, что коридор/дверь входят в выбранный путь эвакуации. `EVACUATION_ROUTE_IDENTITY` содержит отдельное основание проверки маршрута. Typed component/zone keys задают конкретный элемент, этаж/зону; одинаковый linkGroup PDF этого не заменяет.

`NORM_APPLICABILITY_VERIFIED` проверяется отдельно для каждого факта и атома: `applicable=true`, `parameterCode='AR-042'`, точные attribute, threshold string (`2` или `1.9`), canonicalUnit `m` и reference. Reference должен указывать предметно проверенные нормативную версию, применимость и исключения; отдельного машинного поля версии нормы существующий контракт не содержит. Машина проверяет связность решения инспектора, а не актуальность права.

Общий пример context для коридора внутри authenticated fact binding:

```json
{
  "NORM_APPLICABILITY_VERIFIED": {
    "reference": "Основание применимости проверено инспектором для данного элемента",
    "applicable": true,
    "parameterCode": "AR-042",
    "attribute": "EVACUATION_CORRIDOR_CLEAR_HEIGHT",
    "threshold": "2",
    "canonicalUnit": "m"
  },
  "EVACUATION_ROUTE_IDENTITY": {
    "reference": "Маршрут и принадлежность коридора проверены по исходным листам"
  },
  "ATOMIC_SUBRULE_SCOPE:matrix-ar-042-evacuation_corridor_clear_height": {
    "reference": "Сопоставлены один коридор, зона и чистая высота до препятствия",
    "parameterCode": "AR-042",
    "attribute": "EVACUATION_CORRIDOR_CLEAR_HEIGHT",
    "canonicalUnit": "m",
    "componentRole": "EVACUATION_CORRIDOR_CLEARANCE",
    "componentKey": "reviewed-corridor-id",
    "zoneKey": "reviewed-floor-and-route-zone",
    "operatingModeKey": "EVACUATION",
    "measurementBasisKey": "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION"
  }
}
```

Это пример структуры, не созданное решение по реальному объекту. T13 binding остаётся привязан к exact observation/rule/version/parameter, исходному SHA, portable evidence/textArtifact hashes и server-validated immutable origin. Source CURRENT/APPROVED, section, linkGroup и quality gates независимы. UNKNOWN не заменяется догадкой из штампа.

## Математика и отказы

Существующий LOWER_BOUND comparator не изменён. Сначала требуется `PD >= threshold`. Иначе `NOT_COMPARABLE / PROJECT_BASELINE_OUTSIDE_BOUND`: нельзя превратить исходное ПД ниже порога в автоматическую нормативную экспертизу. Затем trigger — строго `RD < threshold`; delta — `RD - threshold`, не разница с ПД. Decimal boundary не округляется.

- Коридор: ПД 2,1 м / РД 1,999 м — candidate при всех gates; delta -0,001 м.
- Дверь: ПД 2,1 м / РД 1,89 м — candidate; delta -0,01 м.
- РД ровно 2/1,9 м и выше не срабатывает. Без полного checked rule scope — `NEGATIVE_SCOPE_UNVERIFIED`, qualified false.
- T13 fact-scope bindings не принимают completeness и не наследуют legacy completeness. Coverage остаётся PARTIAL.
- ПД/РД разных элементов, зон, режима или basis; отсутствующий/неприменимый norm proof; чужой atom; UNKNOWN source; неверная section; дубликаты — abstention.
- Нет literal fact — `MISSING_EVIDENCE`, не отсутствие требуемой высоты и не отрицательный результат.

Обязательные отрицательные fixtures: nominal leaf/structural opening/floor height вместо чистой высоты; кабина или дверь лифта; отделка стены; диапазон, альтернатива, «не менее», посторонний размер; неверная единица/регистр; разнесённые ячейки; PD_ID/RD_ID; обе стороны с одинаковым неверным basis/mode; попытка перенести corridor norm proof на door fact. Тест двух типов высоты в одном PDF проверяет отдельные факты, rule bindings, component keys и norm proofs.

## Публичные примеры и ограничение поиска

Использован только manifest allowlist `TRAIN_PUBLIC + INCLUDE + PUBLIC_TRAIN` из `datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl` и read-only public index homeserver. Не читались закрытые ответы или организаторские документы. Поиск ограничен F0104/F0156/F0157/F0138; это не exhaustive inventory 203 файлов.

Public index: `/mnt/edberries-backup-disk/inspector-ai-public-document-index-v3-20260927/index.sqlite3`. Три выбранных page artifacts скопированы read-only в `/tmp/matrix-t18-public-evidence/`. Их gzip SHA совпал с public `pages.artifact_sha256`. Артефакты имеют schemaVersion `public-document-index-v1`, provenance PDFMINER; это исходная индексная геометрия, не новый `document-text-v2` и не runtime evidence текущего run. Исходные PDF bytes в этом этапе повторно не скачивались; source SHA/size сверены между предоставленным manifest и public index.

| Public source | Исходный путь | SHA256 | Bytes |
|---|---|---|---|
| F0104, OBJ-NOVOSLOBODSKAYA, PD/AR | `Новослободская/Новослободская/Стадия П/НВС-2025.03-3-АР.pdf` | `bbfef68dad703d33c63d73549b0c4a1007f74213a236580346262491839d80f8` | 16690046 |
| F0156, OBJ-TYUMENSKAYA-5-GOLD-SEED, PD/AR | `Пример нарушений на чертежах/ПД/3 Архитектурные решения/V2_01-03-00-01-20_Том 3.РЕД.pdf` | `16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf` | 6585369 |

Индексные bbox — `[x0,y0,x1,y1]` в `PDF_BOTTOM_LEFT_MILLI_POINTS`; blockIndex ниже относится только к старому indexed page, не current engine blockId:

1. F0104 PDF11/blockIndex29, bbox `[115910,254706,547285,264726]`, page 595220×842000. Строка: «Высота кабины лифтов принята 2,5 м, высота дверей лифтов принята 2,4 м в соответствии». Компонент — лифт. 2,4 м не эвакуационная door clear height. Artifact `F0104-p11.json.gz`, SHA `b2d8aff8eb46aa1fe4496e015de81c174ff9dadd06e7eb787aec9eb5dc8467a0`.
2. F0104 PDF15/blockIndex5, bbox `[92218,325566,549746,393066]`, page 595220×842000. Блок помещения уборочной техники содержит отделку стен керамогранитом на высоте не менее 2 м. Это высота отделки; не высота коридора. Artifact `F0104-p15.json.gz`, SHA `7955940b96192dd0bbbe2a25da308131be65106837aab2aca0ed60a12a917726`.
3. F0156 PDF18/blockIndex39, bbox `[78000,214476,578760,226476]`, page 606720×842040. Строка: «противоположной светонесущей. Локальные проемы выполнить высотой не менее 2,2 м от пола». Световые локальные проёмы и lower-bound constraint не дают exact actual egress height. Artifact `F0156-p18.json.gz`, SHA `0693cd63d3ad8a36e86ab378dab482ef263d07a61e713844f0de5e4a007263ce`.

`/tmp/matrix-t18-public-evidence/evidence.json` сохраняет полные выбранные блоки и provenance. F0157 показывает аналогичные текстовые примечания в другой ПД-версии, не независимую РД-пару. F0138 — РД по защите подземной части от подтопления (`2451.Р.ДР.ГИ` на PDF1), section OTHER. Имя файла «ДР» не превращает его в архитектурный door schedule.

## Что остаётся за срезом

Нет автоматического извлечения размерных цепей/векторной геометрии; door schedule с номинальными габаритами не считается clear opening; не строится полный маршрут и inventory препятствий, этажей или дверей. ИД из каталога остаётся отдельным неисполненным stage path. Не устанавливаются редакция/исключения нормы, применимость и complete negative scope из одного числа. Нет реального положительного примера пары и независимой предметной калибровки confidence.

Повторяемая fixture: `egress_height_fixture(kind='corridor'|'door', expected='2.1', actual='1.99', norm_applicable=True, fact_scopes=False)` в `services/worker/tests/test_matrix_engine.py`. Для положительной door fixture надо передать `actual='1.89'`; общий default 1,99 м выше дверного порога и честно abstains. Проверки Python фиксируют exact thresholds, units, source flags, legacy/v2 proof isolation, absence/multi-atom handling и registry policy tamper. API/PG/browser acceptance записывает родительский этап отдельно.
