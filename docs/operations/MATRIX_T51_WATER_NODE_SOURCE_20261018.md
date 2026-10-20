# T51: исходный состав вводного узла холодной воды

Продолжение принятого T50. Новый source-only срез для частичного ZU-129: building/node/COLD_WATER/COMMON_BUILDING_INLET и буквальный состав узла (счётчик/сетчатый фильтр/запорный кран). Согласованные wire и два уточнения закреплены в `output/matrix-t51-20261018/source-wire*.json` до парсеров и goldens.

1. [x] Первичное участническое требование и реальный F0118 исследованы в ограниченном объёме. [Исследование](MATRIX_T51_NEXT_ATOMS_20261018.md).
2. [x] Отдельный wire и literal water-only policy утверждены до реализации. Все непустые строки выбранной страницы должны принадлежать закрытой full-width полосе; четыре source scope строки обязательны. Полнота всего документа не предполагается.
3. [x] Независимые оригинальные authored PDF, полная canonical extraction и ручные whole-output goldens frozen до парсеров.
4. [x] Независимые PY/TS source reconstruction, hostile native guards и полное совпадение goldens/hash.
5. [x] Узкие и смежные тесты, typecheck, установленный Python package. Все старые v1–v7 source/profile bytes неизменны.
6. [x] Приёмка source-only и переход к отдельному typed review/comparator.

Два оригинала осмотрены через static PNG: controlled PD page1 и real F0118 PDF7 (видимый штамп ИОС2.1, текст водомерного узла со счётчиком RS485). Это визуальная сверка PDF, не браузерная приёмка. Реальная prose не совпадает с закрытым wire и остаётся EVIDENCE_ONLY; synthetic markers в оригинал не добавляются. OTHER не превращается в ZU. Пара РД и источник полномочий ПД не установлены.

Source inventory не означает approved/current/complete/qualified. Межфайловые identity, section authority и scoped human completeness — следующий отдельный срез. T51 не меняет runtime dispatch, coverage58/66/74, calibratedProbability=null и real qualified0. Старые результаты не переисполняются.

Принят source-only05:36UTC: `output/matrix-t51-20261018/acceptance.json`, freeze705files+3dependencies.20 независимых оригинальных PDF/fullcanonical artifacts и53 manual whole outputs frozen до кода. TS71focused/PY14methods, cross53 whole results+hashes, independent12postprobes (8 portable повторены в PY) PASS. API3682PASS/134skip, worker unittest2382methods=2365PASS/17skip;440 соседних Python methods включают14 новых. Typecheck/build и installed wheel+sdist вне checkout с53goldens/21unchanged rules PASS. Первый ошибочный pytest runner RED сохранён; штатный unittest прошёл без правок тестов/ожиданий. Остальные213Python tests, web686 и actualPG120 наследуются из принятых этапов по неизменным source pins, не объявляются повторным выполнением.653 старых pins неизменны; deployment/domain writes0. Сразу выполняется T52 pure comparator с отдельными ручными projections, человеческим scoped mapping/completeness и отказом до eligibility при повреждённом retained origin.
