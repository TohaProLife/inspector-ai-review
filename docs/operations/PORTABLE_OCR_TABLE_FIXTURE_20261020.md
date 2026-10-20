# Переносимые проверки OCR-таблиц, 20 октября 2026

Принят обязательный публичный fixture F0202: [README](../../fixtures/ocr-table-rows-public-v1/README.md), [provenance](../../fixtures/ocr-table-rows-public-v1/provenance.json). Прежние 14 тестов V1/V2/V3 зависели от исторического `output/public-index-20260927/`, отсутствующего в source ZIP, и пропускались. Теперь они читают включённый в исходники `stage.json`; отсутствие или подмена байтов завершают проверку ошибкой.

Fixture — точные 23830 байт сохранённого OCR, SHA-256 `abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a`. Публичный participant manifest: F0202, TRAIN_PUBLIC/PUBLIC_TRAIN, исходный PDF SHA `632379a0e541f0c81e6b03e5528946730b4433939c796db4fdc1e5c3fc8b71ee`. Сохранены 225 строк страниц 7/8/9. Полный PDF и ответы организаторов в fixture не включены.

Изменены только адрес fixture и optional SkipTest в трёх setup helpers. Все 14 test-function AST, эталонные хеши результата, parser defaults, runtime и зависимости сохранены. Root отдельно прочитал diff и выполнил все 14 тестов: PASS, 0 SKIP. Соседний набор: 32 исполнения, 29 уникальных тестов, PASS. Негативные прогоны: отсутствие fixture даёт 14 ожидаемых ошибок, подмена — 14 ожидаемых отказов; SKIP отсутствуют. Это проверка отказов исходных тестов, а не ослабление их assertions.

Квитанция: [portable-ocr-table-fixture.json](evidence/final-qa-20261020/portable-ocr-table-fixture.json). Полные локальные логи, исходный diff и 17 проверяемых receipt SHA находятся в `output/local-work-20261020/portable-ocr-legacy-fixture-v1/`. Последующий полный прогон из нового source ZIP должен иметь отдельную квитанцию; базовые 2931 PASS/42 SKIP относятся к прежнему архиву3728162.

Fixture остаётся UNVERIFIED external raw cache. Его SHA подтверждает целостность, а не исполнение OCR-провайдера, происхождение растра, database run или утверждённую редакцию документа. Нового инженерного покрытия и замечаний этот этап не добавляет.
