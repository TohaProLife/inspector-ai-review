# T74: source/member, applicability и evidence UI

Локальная приёмка: `output/matrix-t74-20261018/acceptance.json`, SHA `b05645a927624b4533352a51654bd7cd3060e19fdd0b1661e690c05d4b4ce39a`. Freeze 199 web inputs, SHA `7878d19ac52e3aa8d16de2c3e72836fc6a928c0ef06231a0ac5c2c5751f81e8e`. Все 498 backend pins T73 неизменны.

Редактор source review получает полные оригинальные страницы, сверяет source SHA, review CAS, manifest и text artifacts. Человек явно выбирает исходное declaration, элемент и его основания, включая фрагменты других страниц. Сохранение сохраняет соседние scopes; omission наследует прежние claims, явный пустой список отзывает их. Смена исходника или решения сбрасывает устаревшее состояние.

Отдельное согласование пары ПД/РД использует существующий authenticated журнал T72. UNKNOWN по умолчанию; APPROVED требует явного действия. Отзыв сохраняет точные прежние refs/basis/CAS даже после отзыва source claims. Нет автоматического согласования или автоматического повторного POST после конфликта.

Результат проверки показывает immutable run snapshot и все 13 исходных фрагментов. Переход в PDF проверяет полную исходную строку и рамку именно её страницы. Без измеренной вероятности вывод остаётся кандидатом; сила стали и весь KR-056 этим правилом не подтверждаются.

Проверки: ROOT 18 + independent 14; последний совмещённый прогон с соседними workflows — 257/257, 8 файлов. Web typecheck, production build и whitespace PASS. Independent receipt SHA `a63a49ce1840395230967b9c9bbbdf39d5932ac23fcfd0c955b5d09d40baa039`. Ручной эталон зафиксирован до production-кода. Первые RED сохранены: сравнение object-key order, sparse arrays и sparse bbox; дополнительно зафиксирован RED перед новым original-frame helper для разных страниц. Новых подтверждённых блокеров нет.

Это static/SSR и transport проверка. Mounted React effects и действия page selector просмотрены в коде; браузер и DOM harness не использовались из-за прежнего security hold. HTTP/assets после установки также не заменят браузерную приёмку. На стенде на момент приёмки ещё v9 60/68/72; реальные qualified pairs — 0. Следующий этап T75: установка принятого v10 на обычный homeserver, очередь, журналы, отзыв/восстановление, сохранность истории и restart семи ролей.
