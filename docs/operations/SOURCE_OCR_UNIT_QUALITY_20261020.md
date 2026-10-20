# Подсказка двойных единиц в OCR, 20 октября 2026

Принята отдельная подсказка качества буквального OCR: одна полная строка с положительной парой `кВт (Гкал/ч)` или `кВт (Гкал/час)`. Точные BigInt-интервалы округления записанных чисел должны не пересекаться. Пересечение, неподдерживаемая запись или отсутствие подсказки не означают, что документ прошёл проверку.

Определение: международная калория, 4.1868 J; 1 Гкал/ч =1163 кВт. [NIST SP811, footnote9](https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes). Применимость этой конвенции к проекту отдельно не доказана. Диапазоны, отрицательные/нулевые значения, латинские lookalikes, разделители тысяч, несколько пар, переносы и чужие единицы отклоняются. Исходный текст не исправляется.

В сохранённом OCR полного V4 доступен список «Кандидаты для сверки единиц». Кнопка открывает страницу и строку, переводит фокус и прокручивает к проверяемому тексту. Исходный PDF показан рядом на desktop и ниже на mobile. Подсказка остаётся после CONFIRMED: человек мог верно подтвердить противоречивый оригинал. Вероятность не рассчитана; инженерное замечание не создаётся.

Реальный replay всех264 строк/12страниц F0201 дал ровно1подсказку: физическая страница8, `107,687 кВт (0,926 Гкал/час)`. Из0,926Гкал/ч получается интервал1076,3565–1077,5195кВт с учётом последнего записанного разряда. Raw provider ordinal13 сохраняется без изменений: это14-я позиция исходного массива,13-я непустая строка. Номер кнопки использует raw ordinal+1. Остальные три пары совместимы с их округлением. Это буквальная несогласованность, не квалифицированное нарушение.

Приёмка: helper72/72 с реальным opt-in, полный web1368/1368, PostgreSQL22/22, workspace typecheck/build PASS. Production App с настоящей auth/PG и authored image-only PDF прошёл14 browser checks: точный PNG до дополнительного поиска, jump/focus во всех четырёх layout и после reload, CONFIRMED не скрывает подсказку, downloaded JSON неизменен. Light/dark1440/375 без горизонтального overflow или JS errors. Synthetic browser не доказывает правильность реального OCR; отдельный real replay проверяет только literal artifact. [Квитанция](evidence/source-ocr-unit-quality-20261020/acceptance.json), [desktop](evidence/source-ocr-unit-quality-20261020/desktop-light.png), [mobile](evidence/source-ocr-unit-quality-20261020/mobile-dark.png).

Первая попытка Chrome остановилась на слишком длинном Unix socket path; сохранена. Свежая попытка использовала короткий собственный TMPDIR, без ослабления checks. API4877/236skip и Python2931/42skip взяты из отдельной принятой чистой распаковки3728162; их product source этим этапом не меняется. Текущие62 частично покрытых/70unsupported, профили, import/review hashes и источник доверия прежние. H100 runtime и независимая инженерная калибровка не заявлены.

## Номера строк при пустых ответах OCR

Исправлена нумерация видимого списка: номера соответствуют raw ordinal+1, как поиск, кнопка кандидата и журнал. Пустые строки ответа не перенумеровывают остальные. Поиск и заголовок ручной сверки показывают страницу и номер строки явно. Для реального примера F0201 это строка14, а не13.

Новая browser fixture содержит пустую первую строку: два видимых текста имеют номера2/3, подтверждение отправляет ordinal1 и точный lineHash. Все15 browser checks PASS за22.281с: настоящий PDF2, desktop/mobile light/dark, поиск, фокус, сохранение и побайтный JSON после reload. Web1368/1368, workspace typecheck/build PASS; [квитанция](evidence/source-ocr-line-numbers-20261020/acceptance.json), [desktop](evidence/source-ocr-line-numbers-20261020/desktop-light.png), [mobile](evidence/source-ocr-line-numbers-20261020/mobile-dark.png). API/worker, hashes и правила не менялись.

Повторить helper с companion:

```bash
INSPECTOR_SOURCE_OCR_UNIT_QUALITY_DERIVED="$COMPANION/audits/native-ocr-import-engine-v1/F0201-source-ocr-import-derived-v1.json" npm exec --workspace @inspector-ai/web -- vitest run src/source-ocr-unit-quality.test.ts
```
