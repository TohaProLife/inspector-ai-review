# T54: проверка исходников водомерного узла

Статус: UI_ACCEPTED_BROWSER_PENDING, 2026-10-18 06:51 UTC. T55 начат сразу.

- [x] Независимые13 manual-сценариев заморожены до реализации UI.
- [x] Клиент API: первый RED сохранён, после реализации7/7PASS. GET точного источника, POST только selection, CSRF, AbortSignal, полное сохранение четырёх прежних scope и CAS, без автоматического повтора409.
- [x] До изменений снята сохранность65snapshots/15groups,203точных адресов фактов,132legacy targets, одного local review и FAILED-запуска. Шесть backend-ролей и20остальных контейнеров прежние.
- [x] Пять настоящих HTTP-сценариев прочитаны: контрольный origin/approved/UNKNOWN/restored и реальный непроверенный объект. Кандидаты0/1/0/1/0, исходные фрагменты0/15/0/15/0, probabilitynull. Сохранённые machine/submission bytes после чтения прежние.
- [x] Три независимых UI test-файла: полный первый freeze и RED на отсутствующих компонентах.
- [x] Три новых компонента и интеграция в source review / matrix execution.
- [x] Независимые81 UI +7 API-client внутри774/64files web PASS, typecheck/build PASS. Пять HTTP payloads через локальный SSR;30точных callbacks двух контролируемых кандидатов. Mounted DOM и browser не проверены.
- [x] Только web установить на обычном homeserver; проверить static asset bytes и повторную сохранность. Backend/profile/coverage не меняются.
- [x] Принять этап с явным browser pending и сразу продолжить T55.

При обновлении web текущий v8 backend сохраняет59параметров/67частичных атомов/73UNSUPPORTED из132. Форма не повышает coverage, не подтверждает физическое отсутствие счётчика и не назначает вероятность.

Доказательства: `output/matrix-t54-20261018`. Прежний browser security hold сохраняется; HTTP/SSR не заменяют браузерную приёмку.
