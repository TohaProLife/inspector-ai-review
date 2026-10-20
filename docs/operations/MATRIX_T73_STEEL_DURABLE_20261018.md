# T73: ordinary durable steel comparison v10

Локальный T73 принят по `output/matrix-t73-20261018/acceptance.json`; 498 source pins ядра, freeze `4e1279a114166cb87a196cb0bae83ec6df9c1fce2592be519cb6346a41a6eac4`. Actual installed wheel/sdist приняты отдельно внутри T73; UI T74 и обновление feedback стенда имеют собственную приёмку.

## Реализовано

- Аддитивный `matrix-text-facts-steel-comparison-v10`, adapter `10`, config `ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6`. Предыдущие пять typed domains и scalar engine сохранены; v9 config неизменён.
- При запуске фиксируются последние решения каждой логической пары до фильтра статуса и источников. UNKNOWN/WITHDRAWN сохраняются; устаревшие ссылки остаются в снимке с `included=false`. Старое APPROVED не подставляется.
- Миграция 042: отдельные append-only state/entry таблицы. Снимок хранит строковый BIGINT sequence, ID журнала и оба хеша; отдельный hash domain исключает цикл с manifest. Подмена JSON с пересчитанным хешем выявляется сопоставлением защищённых записей и оригиналов.
- Защищённый loader v6 передаёт шесть typed пакетов и снимок. Полные retained reviews, исходные text artifacts, исторические журналы и исходные PDF проверяются перед выполнением; PDF I/O вынесен за транзакцию с повторной проверкой fingerprint.
- Worker, completion, seal, historical read и submission проверяют общую принадлежность и независимо реконструируют результат. Изменения согласований не меняют старые машинные результаты.

## Проверки

43 focused TS, 11 Python owner, 38 frozen neighbors, 9 ROOT helper methods; contracts/API typecheck и normal API build — PASS. Независимый PostgreSQL: 3/3, один обычный v4 origin audit и шесть v10 запусков по девять заданий. Проверены кандидат, UNKNOWN, отзыв, восстановление, stale-source exclusion, новое точное согласование, reopen и исторические ответы. Подмены результата, вероятности, snapshot, source refs, оригинальных PDF и stale completion отвергаются.

Кандидат сохраняет 13 native evidence fragments и `calibratedProbability:null`. Проверено 61 частично реализованный параметр / 69 атомов / 71 UNSUPPORTED; остальные 131 coverage строки сохранены. Это локальный synthetic original-backed сценарий, не квалификация реального объекта.

Actual offline wheel и wheel, перестроенный из sdist, побайтно совпали. Каждый установлен вне проекта во временный каталог: 9 настоящих Pilot v10 запусков, 9 direct-release вызовов, 5 целых snapshot эталонов; отдельно 104 прежних public вызова и два воспроизведения оригинальных authored PDF. Все 159 Python sources и 24 packaged resources совпали с pins. Сеть и установка зависимостей не использовались. Receipt `root-offline-package-final-receipt.json`, SHA `2db8ad496a367bc3e192cb13f6841caf4899d8e1b0761d8e7d0e408f63b1c821`.

Сохранены первые RED: отдельная обработка finite decimal release metadata и соответствие реальному JobLease без отсутствующих `decisionId/contentHash`. Проверки полных refs остаются на protected-loader/typed границах. Исправление абсолютного regex конца BIGINT запрещает строку с завершающим LF.

## Лимиты и границы

Outer loader 64 MiB; каждый frozen child 8 000 000 bytes; snapshot 524 288 bytes, до 16 последних пар. Internal pinned metadata ограничены 8 000 000 bytes отдельно. До 64 различных PDF, суммарно 128 MiB. Превышение вызывает отказ без усечения.

Правило проверяет только явную запись С345 в ПД и С245 в РД одного сопоставленного человеком элемента распределительного пояса с отдельным согласованием применимости. Прочность, нормативная эквивалентность стандартов, другие классы и полное условие KR-056 не подтверждены. Реальных квалифицированных пар пока 0. Уверенность без калибровки остаётся null; warning требует строго больше 80% и достаточных доказательств.

На feedback стенде пока v9 60/68/72. Browser остаётся pending по прежнему security hold. SSR, HTTP и статические assets не считаются браузерной проверкой.

## Дальше

T74 source/member editor, отдельное pair applicability review/withdrawal и immutable evidence/snapshot UI локально принят; см. [T74](MATRIX_T74_STEEL_UI_20261018.md). Далее T75 — seven-role ordinary homeserver rollout, HTTP/queue/restart и сохранность прежних checkpoints. Следующий параметр KR-060 требует source-linked единиц, прямоугольной формы и одного сечения; наличие `600х1500мм` само по себе не устанавливает эти условия.
