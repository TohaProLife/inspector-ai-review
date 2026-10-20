# T16: исходная таблица площади плитки F0126

Статус: принят17.10.2026,23:18МСК. Доказательства: output/matrix-t16-20261017/acceptance.json.

## Цель и границы

Извлечь одну наблюдаемую площадь пешеходной бетонной плитки по грунту из реального PDF, сохранив исходные строки, заголовок колонки, название ведомости и область ГПЗУ. Отдельные площади на кровле, проезды, газоны, толщины слоёв, номера ГОСТ не подменяют эту строку. Source approval/revision/entity остаются UNKNOWN/null до отдельного решения.

Публичный F0126: исходный SHA `b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088`, 7676220bytes,23pages. Participant allowlist/index/ZIP member проверены. Canonical `/tmp/matrix-sidewalk-F0126.text.json` SHA `1929564eac91366983563b61fb7acc49601136b7679c6084cb38bbad2f980f35`; evidence `/tmp/matrix-sidewalk-F0126.evidence.json` SHA `355712d1a35dfb673f72d4c99f4e32e28e86728914d93ab282cdb15c22698724`. PDF20 oriented1684000×1191000mpt, originalRotate270; PDFium render визуально проверен.

## Узкий grammar

- Отдельный `_pd_sidewalk_tile_table_rows`, отдельный независимый TS `validSidewalkTileTableContext`. Generic `_rows` и single-line binding не расширять.
- PD / SIDEWALK_TILE_AREA / m2. Одна same-page ground ведомость, caption «ВЕДОМОСТЬ ПРОЕЗДОВ, ТРОТУАРОВ, / ДОРОЖЕК И ПЛОЩАДОК», scope «(в гр. ГПЗУ)», колонка «Площадь / покрытия, кв.м. в / гр. ГПЗУ».
- Точная трёхстрочная подпись «Тротуары пешеходные / из бетонной плитки, / по грунту» и отдельное «- тип 3». Один NUMBER м², геометрически в колонке заголовка и вертикальном span строки. Никаких hardcode blockId/page/value/координат.
- Primary fragments:3label lines,type,value. Context fragments:2caption lines,scope,3areaheader lines. Предел context fragments поднять с4 до8 только в валидаторе; точный grammar всё равно требует ровно6. Нельзя терять название ведомости ради прежнего технического лимита.
- Нижняя граница ведомости — следующая ведомость той же x-полосы. Правые схемы не прерывают левую таблицу; конкурирующие строки/ячейки/заголовки внутри колонки дают abstention.
- Все фрагменты имеют exact line boxes; primary bbox union. rawText ровно join primary, observation ID фиксирует context. TABLE_CONTEXT_UNVERIFIED всегда; T13 table review привязан ко всему canonical artifact и fragments hash.

## Приёмка

Оригинал: одна новая PD fact112m² по грунту, primary/context открываются в браузере по исходному PDF20,0qualified, probabilitynull. Прежний snapshot без tablegrammar не меняется. Registry остаётся50/56/82.

Fixtures: roof372/type3а, vehicle-access8/type2, lawns42/68, asphalt7, diagram dimensions/GOST; duplicate value/header/scope/caption; missing exactlineboxes; shifted values/columns/type; alternate units/ranges; wrong/mixedstage; удаление/подмена контекста или TABLEflag даже с пересчитанным ID. Python/TS reconstruction parity, PostgreSQL boundary, browser1440/768/375 и restart обязательны.
