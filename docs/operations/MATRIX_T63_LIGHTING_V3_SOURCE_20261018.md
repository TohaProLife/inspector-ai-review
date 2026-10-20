# T63 — буквальные технологии освещения поверх полного v3

Принят новый pure consumer в TypeScript/Python. Вход содержит весь исходный `document-text-v3`, точные source ID/SHA и явный выбор original native paths/raw lines. Проверяются все страницы/profile/native/unlocated/quality/hash; v2 facade не создаётся. Все три recorded traversal profiles читаются по своей семантике. Старый lighting v1 и v3 producer/readers неизменны.

Поддержаны только явные LED/светодиодный, люминесцентный и лампа накаливания с замороженными множественными формами. Однострочная именованная позиция и двухстрочная групповая декларация различаются. Название модели/производителя или слово «энергосберегающий» тип не доказывают. Пересекающие посторонние строки, unlocated на выбранной странице, неоднозначный текст дают abstention.

Новая explicit lexical view снимает ровно один terminal LF и только краевые U0020 SPACE для грамматики. Raw текст сохраняется целиком; `usedTextRange` задаётся полуинтервалом Unicode codepoints. Никакой скрытой нормализации или выдуманной геометрии.

13 исходных full-output manual cases (12 authored PDF и полный реальный F0161),17 portable whole cases, native/forgery boundaries заморожены до реализации. Финальная independent QA:8новых TS +8новых Python methods,109старых TS/14Python neighbors =139PASS. Три подтверждённых guard дефекта исправлены после отдельных manual RED: Python parser fields/range/position для hash, TS positive exact native boxes/frame, Python frozen lighting key diagnostic parity. Первые RED сохранены, исходные30whole outputs/6methods не переписаны.

Все30 manual outputs/hash совпали между TS/Python; полный authenticated source из homeserver также совпал с заранее заданной реальной декларацией с явной привязкой source ID/stage/hash. Installed wheel/sdist вне checkout повторили31whole outputs +3source guards +5hash rejects;22rule resources прежние. API typecheck/build и web typecheck PASS. Root scripts исправлены отдельно: некоторые portable manuals не содержали готового поля expectedDeclarationContentHash, поэтому hash их полного ручного expected output вычислен независимыми builtin JSON/SHA; первые script failures сохранены, production/оракулы не ослаблены.

Реальный F0161 PDF7: paths[25,0]/[28,0], ranges[1,83)/[0,51), LED, `UNBOUND_GROUP_DECLARATION`. В исходнике нет именованной позиции или согласованной пары РД. Authority SOURCE_DECLARED_UNVERIFIED, renderedVisibility UNVERIFIED, calibratedProbabilitynull. Pure source declarations не повышают machine eligibility.

Source freeze922files:895старых неизменны, один разрешённый type-only package export,26новых source/schema/fixture/test files. На стенде этот pure consumer ещё не включён в машинный профиль; runtime mutations0. Coverage59параметров/67частичных атомов/73UNSUPPORTED,qualifiedreal0 остаётся прежним. Browser acceptance pending по существующему hold; browser calls0.

Receipt: `output/matrix-t63-20261018/acceptance.json`. Без паузы T64: только направленные LED→FLUORESCENT/INCANDESCENT для одной явно сопоставленной именованной позиции ПД/РД; затем T65 versioned durable/review/runtime integration.
