# T49: поиск по полному исходному тексту

Начат сразу после принятия T48. Основание: F0106 PDF53 содержит исходную декларацию проектного нуля, которую строгий extractor не превращает в измерение из-за неизвестных единиц и reference. Инспектору нужен доступ ко всему сохранённому тексту и точным строкам оригинала.

1. [x] План до изменений: `output/matrix-t49-20261018/plan-before-implementation.json`.
2. [x] Read-only UI: явная загрузка, буквальный поиск 2–200 Unicode codepoints, регистр/пробелы учитываются только при поиске. Исходный raw text не меняется. Первые100 результатов и полный счётчик.
3. [x] Object/check/source ID+SHA/latest review guard, отмена запросов и remount по identity. Сервер независимо проверяет seal. Latest page-stage decisions не выдают за стадию frozen run.
4. [x] Строки без точной line geometry остаются видимыми без подсветки. Только exact integer line box открывает исходный PDF. Block-box fallback отсутствует. Поиск находится вне формы принятия решения.
5. [x] Actual HTTP первый RED сохранён: F0106 source-text endpoint404 при399446nodes/3.3MB. Причина: к полному тексту применён review-envelope лимит200000nodes. Добавлен отдельный read guard1000000nodes/8MB; review limits, mutation contracts и машинные профили не меняются.
6. [x] Полные web/API suites, typecheck/build; actual PostgreSQL на полном139+22 artifact. Первый sparse-array RED UI сохранён, исправлен через проверку всех4 координат.
7. [x] Обновление только API/outbox/web разрешённого стенда; actual full-text139+22 + original frame50/53, неизменные machine/submission/targets. Сохранность всех60 snapshots и132 legacy targets.

Покрытие, qualified findings, согласование, calibrated probability и геопривязка этим срезом не повышаются. Текстовый поиск не охватывает графику и не доказывает отсутствие элемента. Браузерная приёмка остаётся pending по существующему security hold; SSR/unit/HTTP не заменяют браузер.

Проверки: API3611PASS/131skip, web633PASS, actual PostgreSQL120PASS/41files/0skip; API/web typecheck и build PASS. Полный источник получил отдельный bounded read guard, старые review guard и config/profile hashes прежние. Freeze650files+3dependencies SHA3143a7fc3e05c51176f0157974ff5dc96c07b1f61e4a9617dde63e4853c298e0. API/outbox/web заменены,60snapshots сохранены; actual HTTP и restart приёмка ещё выполняются.

Backend принят2026-10-18T05:05:53Z: оба actualHTTP14GET до/после restart PASS,161fullpages и2PNG побайтно прежние.60snapshots/203oldtargets/132legacytargets/1localreview/failedrun сохранены;7role pins одинаковы,20прочихконтейнеров/4workers прежние. Browser отдельно pending. Receipt `output/matrix-t49-20261018/acceptance.json`. Сразу начатT50.
