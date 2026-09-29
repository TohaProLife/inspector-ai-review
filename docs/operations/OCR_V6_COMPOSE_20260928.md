# Изолированный Compose: OCR v6 на публичном F0163

28 сентября 2026. Проверен отдельный opt-in OCR v6 в
`/home/freetok/Projects/inspector-ai-homeserver-smoke` на homeserver.
Действующий v5 run сохранён. Экспертного решения `CURRENT/APPROVED`,
утверждённой пары ПД/РД и ручного подтверждения OCR-строк не создавали.
Этот прогон доказывает доставку, сохранение и безопасный отказ OCR v6 при
непроверенном источнике; он не измеряет качество чтения чертежей.

## Исходный публичный документ

- ZIP `01_ПАКЕТ_УЧАСТНИКАМ_3_ОБЪЕКТА.zip` на homeserver пересчитан целиком:
  SHA-256 `79d71bfaa747c704e41e73d059d06a78f74dd34b4264ee9cf8205d6bc7335417`.
- `document_manifest.jsonl` SHA-256
  `853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7`.
- Запись `F0163`: `TRAIN_PUBLIC / INCLUDE / PUBLIC_TRAIN`, ПД/ВК.
  Исходный PDF 5 738 729 байт, 21 страница, SHA-256
  `18282c9104974a462338ff2d246bf081545bdfcafde1a85ee5e6d4ca54584861`.
  Загрузка API и повторное чтение байтов сверены скриптом `smoke-core.py`.
  `TEST_HIDDEN` и закрытые ответы не использовались.

## Доставка и конфигурация

До запуска скопировали только OCR v6 исходники API и worker. Для каждого
файла локальный и remote SHA-256 совпали после копирования:

| Файл | SHA-256 |
| --- | --- |
| `apps/api/src/postgres-repository.ts` | `c759c744d70baa406cf9cebd111db418649fa0470a18ec0afd6bd2e67dfe4c14` |
| `apps/api/src/ocr-layout.ts` | `1ab53af0dbeca528f75dd95051614d2af05a6eb941e031c746440c28355c8cf6` |
| `apps/api/src/ocr-layout-read.ts` | `626e6afec8a7c0e21c831491f6080bf2783aa19c47690b370b9713f908929e57` |
| `apps/api/src/api-contract.ts` | `4f36b1079dcb95c22ea0e19d822c1f12e02c8ea52916730f465b31481d67be04` |
| `apps/api/src/repository.ts` | `4f57fc84cd0cba563e24819557c4bf1a097e8af1b078e9918a25d04d87f1d7b7` |
| `services/worker/inspector_worker/durable_ocr_layout.py` | `01b3e0e47bbee0d5a0111254c35ba4a33b39fd53799df45df8e105892331c667` |
| `apps/web/src/SourceReviewScreen.tsx` | `f69a6f8d195538545299c30b7b4b9603243396f4bfebf30e79a6d967f22b2e33` |

Remote backup этих файлов и исходного env:
`.sync-backup-20260928-ocr-v6/`. В isolated env установлено
`INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v6`; восемь OCR heat/fact/candidate/
table/unresolved consumer flags пустые. Пересобраны и пересозданы только
`api` и `extract-worker`. После отдельной правки подписей пересобран и
пересоздан только `web`. Остальные контейнеры не перезапускались.

## Сохранённый run

Новый объект `OBJ-C194B608`, файл `FIL-F92A4C6C`, run `CHK-6D761C86`.
[Smoke receipt](../../output/ocr-v6-compose-20260928/run-receipt.json)
SHA-256 `18885e1aadbd8b122ed04e0ce203e5774e014e0229765bdcb565d8edfc4af3c5`.
Независимый read-only [SQL](../../output/ocr-v6-compose-20260928/read-only-audit.sql)
и [результат](../../output/ocr-v6-compose-20260928/read-only-audit-result.txt):

- 10/10 jobs `SUCCEEDED`, run sealed, статус `PARTIAL`, 0 findings.
  Исполнительные статусы каталога: 2 `PARTIAL`, 130 `UNSUPPORTED`.
  Это не подтверждённая предметная полнота.
- Release ID `release:pz002-pz017:57f17a29cbdfc8611929b1d3`, SHA-256
  `05f171a4b26ba951a6b136952735bcbf1fd505c363c4f2d3f7b6a7bb41c7b626`.
  OCR slot: `local-bounded-ocr-layout-v6`, adapter `6`, config SHA-256
  `ea7be21c64146e379183f7e01b047bb2fcbeb8882ee688158f5662ad0979ce21`.
- `DOCUMENT_OCR_LAYOUT` stage сохранён с SHA-256
  `fcb3c930d704ef660defd7f65d9ba8d5f34b4cc2cb42cd3687c899c5f203400c`,
  `inputManifestHash` `3fabd83a0e1ded524296fe89f2d4a7030ee00d41b554716538a31156914bd70d`,
  `outputCount=0`. `document-text-v2` SHA-256
  `ac54ac426c1a6d04360e4dca459ef1b4740bd99f7b8080b4fecd1de14ff79326`.
  Его 21 страница обработана текстовым слоем; две `OCR_REQUIRED`.
- OCR v6: 2 требующие OCR страницы, 0 обработано, 2 отложено.
  Источник `SKIPPED_SOURCE_REVIEW_REQUIRED`, причина
  `SOURCE_REVIEW_REQUIRED`, `reviewEligiblePageCount=0`. В immutable run
  ноль `run_source_review_snapshots`; никакого OCR текста не утверждается.

Авторизованный `GET /api/checks/CHK-6D761C86/ocr-layout` вернул 200,
анонимный 401. API заново сверил сохранённый OCR artifact и immutable run;
SHA ответа `1b434a428900e1d71739fcb88eb89c266c7bdb750cd4c954a76bc7ba43cbacc5`.
Аутентифицированный GET решения по источнику вернул 404.
[Аудит API](../../output/ocr-v6-compose-20260928/audit-summary.json),
[OCR ответ](../../output/ocr-v6-compose-20260928/ocr-read.json).

Старый v5 `CHK-0D43285B` после новой сборки по-прежнему читается через
авторизованный GET 200; его stage SHA
`0ff9436a2e39b7524b98ca0ccbd8c6a8e64ec96b3e7af19f47fe660a1326eccd`
совпал с предыдущим зафиксированным прогоном. Для шести причин задержки
v6 добавлены понятные русские подписи и название режима без внутреннего
`profileId`; прежнее предупреждение `PARTIALLY_SCANNED` сохранено.
Focused web-тест 9/9, полный web suite 60/60 и typecheck прошли.
Headless Chrome после пересборки web открыл новый объект, увидел 21/21
визуально обработанных страниц, 0 предложений и панель OCR с текстом
«источник ещё не проверен экспертом» и «Адресное OCR для проверенных
разделов АР/ВК»; [UI receipt](../../output/ocr-v6-compose-20260928/ui-smoke.json),
[снимок экрана](../../output/ocr-v6-compose-20260928/ocr-ui.png)
SHA-256 `b720222e7d13c2cdee1bf27cfaf5153544364a64e958c9ded87338f7b9ac8c00`.

## Граница проверки

Отсутствие `CURRENT/APPROVED` решения правильно отложило две страницы.
Для фактического чтения v6 нужна отдельно подтверждённая редакция,
согласование, раздел и стадия страницы, затем **новый** immutable run.
Только после этого можно проверять page receipt, повторный PDF render,
строки OCR и предметную применимость. Проверка не создавала положительных
решений, пары ПД/РД, findings или заявлений о качестве модели.

### Что проверить

- После реального решения эксперта выполнить новый run и проверить OCR
  выбранных `OCR_REQUIRED` страниц по исходному PDF и cache receipt.
- Проверить новые русские подписи на иных реальных ветках v6, когда такие
  безопасно возникнут в новом run; текущий runtime подтвердил только
  `SOURCE_REVIEW_REQUIRED`.
