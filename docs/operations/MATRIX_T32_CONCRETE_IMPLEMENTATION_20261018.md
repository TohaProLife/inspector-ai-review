# T32: извлечение лестничного бетона для KR-055

Статус: **BACKEND_ACCEPTED_BROWSER_PENDING**. T31 backend принят, браузерная приёмка открыта из-за URL policy. На homeserver выполнен rollout T32; runtime pins7roles и restart46snapshots приняты.

Цель: извлечь две явные лестничные строки из полных оригиналов F0106/F0139. Реальная пара В30/В30 остаётся UNKNOWN без review; равенство не доказывает полноту. Число установленных правил остаётся 55 параметров /63 атома /77 UNSUPPORTED.

- [x] Исследование полных161 страниц и независимый frozen packet:123 случая, явная независимость от арматуры.
- [x] Независимые новые Python/TypeScript helpers, исходные строки и геометрия, header предыдущей страницы.
- [x] Интеграция engine/portable selectors/API verification/durable source pins без изменения registry и старых IDs.
- [x] Обе FACT_BINDINGS, конкретная лестничная конструкция/зона/условия, основа прочности на сжатие.
- [x] UI: контекст материала отдельно от table review, точные поля scope; candidate probability=null.
- [x] Unit/full check/actual PostgreSQL, directed В30/В25 delta=-5, withdrawal/restore и equality gate.
- [x] Обычный homeserver: новые immutable real и synthetic runs, readback и сохранность истории после restart.
- [ ] Browser1440/768/375. Пока policy hold; API не считается browserPASS.

Доказательства: `output/matrix-t32-20261018/`. Полная feasibility: `MATRIX_T32_CONCRETE_FEASIBILITY_20261018.md`.

Локальные отдельные проверки: Python305PASS (159focused+146regression), TS200parser+51boundaryPASS, actualPG4PASS; web196/typecheck/buildPASS. Старые13полных payload и6табличных классов бетона сохранены. Итоговый fullcheck/общийPG ещё не принят.

Общий check:2941PASS/118skip (API1285/web196/Python1460); actual PostgreSQL65PASS/10files/0errors. Sourcefreeze64files+5dependencies SHA4014785cee95c3e220a86d8792613486731fa4d11199650d90e7094593a53d48.

Приёмка: `output/matrix-t32-20261018/acceptance.json`. RealOBJ-E93E83A7/CHK-E6FAFDD3,161pages/15facts/2newconcreteВ30/В30/0qualified/UNKNOWN; все13oldpayloadиoldmatrixbytesunchanged. ControlledOBJ-CD28F823:0/1/0/1,6reviews/13domainwrites,delta−5/probnull. Restart7roles:46snapshots+localreview+132oldtargetsPASS. Same-object reprocess добавил ровно один CHK-E6FAFDD3 в историю: строгий old-history тест сначалаRED; exactauthorizedappend receipt сохраняетвсеостальныеoldfields/источникcheckpointнепереписан. Браузер остаётсяPENDING по прежнемуURLpolicyhold, обходов0. БезH100/DB/modelrestart.
