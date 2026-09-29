# Визуальная очередь по открытым PDF

[HTML-атлас](../../output/source-review-atlas-v2-20260927/index.html) показывает
103 исходных PDF из [очереди 47 кандидатных кодов](SOURCE_REVIEW_PACKET.md).
В нём 222 полноформатных изображения страниц и увеличенных штампов. Для
каждого PDF перед рендером сверены размер, число страниц и SHA-256 с
`TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN` манифестом. Изображения в
[отчёте](../../output/source-review-atlas-v2-20260927/report.json) также
имеют SHA-256 и размер. F0194 TXT, `TEST_HIDDEN` и закрытые ответы не читались.

Это материал для сверки стадии, раздела, редакции и утверждения по
исходным страницам. `index.html` удобен для локального просмотра. Он не
подтверждает роли источников и не передаёт решения в инспектор. В отчёте
`findingCount` и `parameterCoverage` равны `null`; все 103 источника
остаются на ручной проверке.

Атлас получен из закреплённого полного пакета SHA-256
`b1ad972a6c268f36d88665e29a161b9eb614dbe73c8df2e05d5d5ee18fd39328`
и манифеста SHA-256
`853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
SHA-256 `report.json`:
`9934c1308c10263f274cbe11752808ef3298b9d3989a88d432cb420329eaec9a`.
SHA-256 `index.html`:
`f2e779caa2ce8306c43c5d01469954f2cb7cf8dbd72b8a009a4a90934fc1ca88`.

Отдельно проверен F0138 p.3 (PDF SHA-256
`94a8c8436906ec7e66047e9c43d5fafe7e514bb1356e2065d1826867fddc700d`):
адресный OCR дал 495 строк и кэш-артефакт SHA-256
`ec6a8154647a6e463d04e7f4218d20c40c8e5d0e652aa1a33524827be79c60d4`.
Исходная страница и штамп указывают на РД и шифр `2451.Р.ДР.ГИ`;
раздел `КР` из этой подсказки не следует. Источник остаётся
`UNVERIFIED_REVIEW_ONLY`.

Сборщик: [build-source-review-atlas.py](../../scripts/build-source-review-atlas.py).
Тесты проверяют allowlist, SHA, защиту HTML и выбор листов:

```bash
services/worker/.venv/bin/python -m unittest \
  scripts.tests.test_build_source_review_atlas -v
```
