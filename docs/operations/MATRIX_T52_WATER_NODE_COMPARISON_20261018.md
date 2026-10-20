# T52: сравнение составов вводного узла ХВС

Продолжение принятого source-only T51. Отдельный pure comparator частичного ZU-129 сравнивает явно согласованные именованные составы общедомового узла ПД/РД. ПД должен буквально перечислять счётчик, РД — закрытый непустой состав с фильтром и/или краном без счётчика. Результат только CANDIDATE, calibratedProbability=null. Равенство списков не означает NO_VIOLATION всего параметра.

1. [x] Wire и уточнения до comparator fixtures/code: `output/matrix-t52-20261018/comparison-wire*.json`. Source T51705pins+3dependencies сохраняются.
2. [x] Независимые полные projection/request/decision эталоны frozen до comparator code; human approval/mapping/completeness в них явно synthetic, не реальная authority.
3. [x] Независимые PY/TS реализации, whole-output differential и hostile native boundary.
4. [x] Узкие/смежные тесты, API typecheck/build и isolated installed Python package.
5. [x] Приёмка pure comparator, затем отдельная server materialization/DB/durable/profile интеграция.

Порядок отказов: native/DTO; все retained origin associations и полные canonical envelopes/hash; реконструкция всех claims независимо от выбранной identity и approval; identity; дубликаты обеих стадий/конкурирующие scope; одна ПД+РД пара; current/approved; разделы ZU/IOS2; link; scoped node mapping; human completeness; literal feature difference. Неподтверждённый конкурент не отбрасывается ради положительного вывода. Неиспользованный повреждённый original не игнорируется. Исторический origin должен совпадать с target pins, а существование sealed DB origin докажет следующий loader.

Manifest OTHER не назначает полномочия раздела. OTHER отсутствует в frozen sourceSectionCodes и как review section даёт INVALID_INPUT. Допустимые KR/null/OV при сравнении не заменяют ZU/IOS2. Человеческое утверждение полноты не становится машинным доказательством полноты.

T52 не меняет runtime profile/coverage58/66/74, не создаёт real qualified pairs, не утверждает physical отсутствие прибора. Браузерного кода здесь нет; прежний browser pending не подменяется unit/HTTP/SSR.

Принят pure comparator05:43UTC: `output/matrix-t52-20261018/acceptance.json`, freeze717files+3dependencies,705 прежних pins неизменны.40 независимых whole comparison outputs+8helper outputs полностью совпали PY/TS. TS72focused+576neighbor tests/5files PASS; PY166methods включая12focused PASS/0skip. Independent12postprobes/21calls PASS,8portable повторены PY. Installed wheel+sdist40+8/21unchangedrules, typecheck/build/diffcheck PASS. Full T51 suites наследуются по неизменным pins, их повторный запуск не утверждается. Runtime/domain writes0, coverage58/66/74 прежнее. Сразу T53: authenticated source materialization, optional waterNodeScope с совместимым review hash, pinned loader и отдельный durable profile.
