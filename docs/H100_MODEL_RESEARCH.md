# Модели класса Laya и профиль проверочного H100

Срез: 24 сентября 2026 года. Это исследование кандидатов, не утверждённый model release и не результат измерения на H100. Под «Laya» здесь понимается семейство `convaiinnovations/laya` для типизированных решений по тексту. На физическом сервере стоят **два H100 по 80 ГБ**; по сообщению организаторов одной команде могут выделить **не более одного H100 80 ГБ**, 24 физических CPU-ядра, 640 ГБ RAM и 300 ГБ диска. Выделенный GPU может делиться с другими командами. Внешний API запрещён.

## Вывод

Laya полезна как **дешёвый классификатор уже извлечённых фрагментов**: предварительная маршрутизация страниц/параметров, приоритет ручной проверки, проверка узких текстовых гипотез. Основной provider для OCR, чтения чертежей, таблиц и извлечения полей она не заменит. Её ответ не содержит source page/bbox/token evidence и не может выполнять 132 предметных правил или устанавливать нарушение. Это вывод из интерфейса модели и [контракта evidence](architecture/07_RULES_AND_EVIDENCE.md), а не измеренная точность проекта.

Профиль `server` настроен на один H100: PDFium/Paddle OCR, `Qwen3-VL-8B-Instruct-FP8` как стартовый baseline, `Qwen3-Embedding-0.6B` на CPU и без отдельного GPU reranker. `Qwen3.5-9B` — первый проверяемый кандидат на повышение качества чтения документов; `Qwen3-VL-30B-A3B-Instruct-FP8` — более тяжёлый кандидат после GPU soak и предметного сравнения. Настройка Compose ещё не доказывает запуск и производительность на H100. Профиль `laptop` остаётся отдельным.

## ML-скиллы для выбора и проверки моделей

Проверены [документация SkillsMP API](https://skillsmp.com/docs/api), поиск каталога по Hugging Face/model evaluation/MLOps и каталог [официальных скиллов Hugging Face](https://www.skills.sh/huggingface). Поиск SkillsMP даёт много общих и дублирующихся записей; поле `stars` относится к исходному репозиторию, не к числу установок конкретного скилла. Скилл помогает организовать исследование, но сам по себе не измеряет качество модели на наших PDF.

| Скилл | Применение в проекте | Решение |
|---|---|---|
| Установленный `mle-workflow` | Контракт данных и метрик, одинаковый frozen split, latency/VRAM, разбор ошибок и критерий продвижения модели | Использовать для этой матрицы и последующих A/B прогонов. |
| [hugging-face-evaluation](https://www.skills.sh/huggingface/skills/hugging-face-evaluation) | Запуск локальных оценок через vLLM/accelerate и lighteval/inspect-ai; оформление результатов в HF model card | Опционально установить перед серией воспроизводимых экспериментов. Текущий проектный scorer всё равно нужен отдельно. |
| [huggingface-local-models](https://www.skills.sh/huggingface/skills/huggingface-local-models) | Поиск GGUF, проверка quant и запуск llama.cpp | Пригоден для профиля ноутбука, не для выбора H100 serving stack. |
| [train-sentence-transformers](https://www.skills.sh/huggingface/skills/train-sentence-transformers) | Настройка retrieval после появления размеченных пар документов/фрагментов | Пока рано: доступных positives/negatives недостаточно для честного обучения и оценки. |

Новые скиллы не устанавливались: действующего `mle-workflow` достаточно для этапа исследования, а облачные Hugging Face Jobs не отвечают офлайн-условию конкурсного inference.

## Кандидаты с Hugging Face

| Модель | Проверенная роль | Пригодность и ограничение |
|---|---|---|
| [Laya multilingual](https://huggingface.co/convaiinnovations/laya-multilingual) | Типизированный `choice`/`score`/yes-no по русскому OCR-тексту | 322M параметров, Apache-2.0, default 1024 токена, encoder до 8192. Пробовать для **небольшого числа вариантов за вызов** и на коротких evidence fragments. Заявленный охват 100+ языков не заменяет отдельной оценки русского строительного языка. Не использовать вероятность без локальной калибровки. |
| [Laya English](https://huggingface.co/convaiinnovations/laya) | То же для английских фрагментов | 421M, Apache-2.0, default 512 токенов. Для русских исходников не годится: авторы показывают провал английского checkpoint на нелатинских языках. |
| [Laya typed-decisions](https://huggingface.co/convaiinnovations/laya-typed-decisions) | Пример предметной настройки | Результат 0,766 получен на четырёх собственных workflows после fine-tuning. Не переносить эту цифру на строительные документы. Базовые checkpoints на том же тесте были около chance/ниже majority baseline по [карточке семейства](https://huggingface.co/convaiinnovations/laya). |
| [mDeBERTa-v3-base-mnli-xnli](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli) | Независимый baseline для RU NLI/zero-shot классификации | MIT; русский входит в XNLI-обучение. Сравнивать с Laya на одинаковых коротких парах «фрагмент + гипотеза». Не выдаёт доказательную геометрию и не выполняет числовые сравнения. |
| [GLiNER multi v2.1](https://huggingface.co/urchade/gliner_multi-v2.1) | Извлечение кандидатов на именованные сущности и span offsets из OCR | 209M, Apache-2.0, multilingual. Лучше Laya подходит для поиска текстовых диапазонов; ещё нужен mapping span в OCR tokens/bbox, нормализация единиц, связей и редакций. |
| [GLiClass multilang mini](https://huggingface.co/knowledgator/gliclass-multilang-mini) | Альтернативный классификатор | Apache-2.0, около 0,3B. В карточке перечислены 20 языков обучения, **русского среди них нет**. Для русскоязычного проекта ниже приоритетом, пока нет RU benchmark. |
| [Laya Vision ModernVBERT 250M](https://huggingface.co/thaitea/laya-vision-modernvbert-250m) | Экспериментальный visual decision model | Непригодна для выбранного deployment: `CC BY-NC-SA 4.0` не соответствует требованию коммерческого/государственного применения. Авторы также отмечают слабую геометрию и потерю мелкого текста на 512 px tiles. |
| [NuExtract3](https://huggingface.co/numind/NuExtract3) | Специализированный challenger для JSON-полей из текста/изображений | Apache-2.0, мультиязычный. Карточка называет модель 4B, метаданные HF показывают 5B параметров; размер загрузки уточнять по зафиксированной ревизии. Сравнивать с Qwen на field exact match и полном source binding; внутренний benchmark авторов на иных документах не доказывает качество наших чертежей. Не загружать одновременно с другим VLM на H100 без измерения памяти. |
| [Qwen3-VL-8B-Instruct-FP8](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-FP8) | H100 baseline для изображений, таблиц, штампов и структурированных предложений | Apache-2.0; репозиторий около 10,6 GB. Карточка документирует vLLM/SGLang и 32 OCR-языка. Веса и runtime memory — разные величины; нужен реальный peak VRAM. |
| [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) | Первый H100 challenger для чтения чертежей, таблиц и доказательных фрагментов | Apache-2.0, multimodal, 9B. Авторы публикуют OmniDocBench1.5 87,7 против 86,8 у Qwen3-VL-30B-A3B, CharXiv(RQ) 73,0 против 56,6, CC-OCR 79,3 против 77,8; это **не результат на нашем корпусе**. Карточка требует vLLM nightly/main branch; текущий pinned образ сначала проверить на совместимость. BF16 веса порядка 18 GB по числу параметров, runtime peak зависит от изображений/context/concurrency. |
| [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) | Дополнительный OCR/layout challenger для сканов, таблиц, штампов и text spotting | Apache-2.0, 0,9B. Заявленные авторами 96,33% на OmniDocBench v1.6 относятся к другому корпусу. Карточка не подтверждает русский OCR и необходимую нам точность bbox: сравнить с текущим Cyrillic/East Slavic PP-OCRv5 на RU/EN/mixed страницах. Для pipeline нужны PaddleOCR ≥3.6 и отдельный adapter/lock. |
| [Qwen3-VL-30B-A3B-Instruct-FP8](https://huggingface.co/Qwen/Qwen3-VL-30B-A3B-Instruct-FP8) | H100 quality challenger; прежний H200 baseline | Apache-2.0; репозиторий около 32,3 GB. Может поместиться на 80 GB при сокращённом context/concurrency и выводе embeddings/reranker с GPU, но это только ресурсная гипотеза. До H100 soak не считать работоспособным профилем. |

Laya сообщает, что `action.act_probability` пока не несёт полезного сигнала, базовые checkpoints переуверены до temperature fitting, а вопросы с десятками вариантов ухудшают результат. Поэтому **не задавать все 132 параметра одним `choice`** и не считать `confidence` доказательством нарушения. Для Laya нужны узкие 2–5-way вопросы, фиксированный prompt/schema, validation threshold по независимой экспертной выборке и обычный abstention при сомнении. [Источник: ограничения модели](https://huggingface.co/convaiinnovations/laya).

## Разделение ролей в pipeline

1. PDF text layer и PDFium/Paddle OCR возвращают текст, страницу, координаты, layout и качество.
2. GLiNER может предложить spans; Qwen VLM или NuExtract3 может предложить типизированные поля из сложного фрагмента/страницы. Adapter принимает значение только при привязке к исходным tokens и геометрии.
3. Laya multilingual или mDeBERTa может сортировать кандидатов и помечать текст для ручной проверки. Результат модели не меняет исходный текст и не создаёт evidence.
4. Версия/стадия/объект связываются детерминированной политикой; Decimal/units/tolerances сравнивает typed rule engine; evidence validator отклоняет неполную группу. Человек принимает итоговое решение.

Текущий код ещё не подключает provider adapters: `analysis-release-v1` остаётся `SCAFFOLD/UNCONFIGURED`, поэтому даже удачный smoke модели не означает работающую автоматическую проверку 132 параметров. [Текущий статус](IMPLEMENTATION_STATUS.md), [provider selection](architecture/15_PROVIDER_SELECTION.md).

## Ресурсный план для одного H100

**Первый H100 baseline для замера:** Qwen3-VL-8B FP8, Paddle server OCR на GPU, `Qwen3-Embedding-0.6B` на CPU, reranker выключен; до 2 VLM requests одновременно, context 8192, максимум 2 изображения на запрос. GPU admission проверяет **фактически занятую** память в момент старта: при совместном использовании H100 80 GB не равны гарантированно свободным 80 GB. Стартовые budgets: VLM 30 GiB и OCR 10 GiB, admission cap 85% VRAM. Runtime fractions: VLM 0,35 и Paddle 0,10. Цифры следует уточнить peak-замерами; admission не резервирует память на всё окно проверки.

**9B challenger сначала:** выделить отдельный lock/образ для Qwen3.5-9B, поскольку авторы рекомендуют vLLM nightly; оценить совместимость, cold start, peak VRAM и качество на тех же страницах/полях, что 8B baseline. Не менять default до прохождения project eval и GPU soak. PaddleOCR-VL-1.6 измерять отдельно как OCR challenger; первоначально не держать три VLM/OCR модели одновременно в VRAM.

**30B challenger затем:** тот же CPU embedding и без GPU reranker; начать с VLM allocation около 48 GiB, OCR около 8 GiB, context 8192, `max-num-seqs=1–2`, ограничить image count и измерять пик на таблицах/штампах/крупных листах. Если OCR и VLM реально удерживаются вместе, сумма measured peak плюс память соседних процессов должна оставаться ниже доступной памяти с запасом. Если нет — последовательная выгрузка/приостановка GPU stages либо 8B baseline. Не уменьшать DPI или context скрытно при OOM: новый profile/config hash и повторная проверка качества.

Для текущего 8B baseline `profileId`, Compose overlay, preflight/admission limits и model lock с revision и SHA-256 файлов уже обновлены. Для 30B нужны отдельные настройки и lock после измерений. Immutable release и CPU/worker quotas ещё требуют доводки. CUDA runtime и зависимости должны быть внутри образов; драйвер NVIDIA предоставляет host через Container Toolkit. Provisioning весов и images выполнить **до** офлайн-прогона; inference-сервисы не должны скачивать модель при запросе. Текущий Compose состоит из нескольких образов/сервисов: способ поставки и API/JSON для организаторов надо сверить с финальным контрактом. [Docker-профили](operations/DOCKER_PROFILES.md), [уточнения Q&A](HACKATHON_QA_SESSION.md).

## Локальный профиль и критерий выбора

`laptop` остаётся для RTX 4060 8 GiB: Bonsai 2 27B PTQ1_0 в CUDA, Paddle OCR и Qwen3-Embedding-0.6B на CPU. Лёгкий дополнительный опыт с Laya/GLiNER можно вести CPU-only и без включения в обязательный runtime, чтобы не отнимать 8 GiB VRAM. Из-за отсутствия свободных RAM/диска на ранее измеренном ноутбуке provisioning потребует новой проверки ресурсов. [Текущий runbook](operations/DOCKER_PROFILES.md).

Выбор 8B/30B/NuExtract/Laya делать на одном frozen, разрешённом наборе: RU/EN/mixed text, сканы, таблицы, штампы, крупные чертежи, неверные редакции, подтверждённые negatives, отсутствующие документы и неоднозначные совпадения. Отдельно считать OCR CER/geometry, field exact match, linking, полный evidence, Precision/Recall/F1/FPR и abstention; параллельно фиксировать p50/p95, throughput, CPU/RAM, peak/free VRAM, OOM и время cold start. Проверить повторяемость 3/3 и offline cold start. Целевые пороги перечислены в [оценивании](DATASET_AND_EVALUATION.md). В репозитории только 10 public positives и нет полных оригиналов; дополнительно скачанный на homeserver TRAIN_PUBLIC содержит 15 checks, из них пять negatives. Этого мало для устойчивой оценки FPR, поэтому предметное качество кандидатов сейчас **не оценено**.
