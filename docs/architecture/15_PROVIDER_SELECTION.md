# Выбор локальных provider-компонентов

Версия 1.4, 24 сентября 2026. Статус: **provider runtimes для laptop/server упакованы, но H100 smoke, adapters, qualification и допущенный release ещё не реализованы**.

## 1. Решение в одном абзаце

Для R1 принимаются два полностью локальных профиля с одинаковыми контрактами и разной вычислительной частью:

- `laptop-rtx4060-8gb-v1`: PDFium через `pypdfium2 5.12.1`, PaddleOCR `3.7.0`/PP-StructureV3, **Bonsai 2 27B PTQ1_0** + Q8 projector через закреплённый PrismML fork `llama.cpp`, `Qwen3-Embedding-0.6B`, PostgreSQL 17 + `pgvector 0.8.6`;
- `server-h100-80gb-v1`: тот же renderer, GPU PP-StructureV3, `Qwen3-VL-8B-Instruct-FP8` через `vLLM 0.29.0`, `Qwen3-Embedding-0.6B` на CPU без reranker, PostgreSQL 17 + `pgvector 0.8.6`.

В обоих профилях `METADATA_EXTRACTOR` и `ENTITY_EXTRACTION_MODEL` являются гибридными: модель создаёт типизированное предложение, а adapter привязывает каждое значение к существующим OCR/text-layer tokens. `LINKING_POLICY`, `RULE_ENGINE` и `EVIDENCE_VALIDATOR` принимают итоговые решения детерминированно. Непривязанное значение, неоднозначная редакция или неполный evidence дают abstention, а не догадку.

## 2. Границы и обязательные инварианты

1. `externalNetworkAllowed=false` — жёсткий runtime-инвариант. Автозагрузка моделей, telemetry, URL-входы и внешние API запрещены. Все images, wheels и weights заранее импортируются в локальный artifact registry, проверяются по SHA-256 и запускаются с egress deny.
2. Текущий `analysis-release-v1` остаётся `SCAFFOLD`: код принимает только scaffold lifecycle и создаёт семь `UNCONFIGURED` slots. Эта рекомендация не переводит их в `CONFIGURED`; сначала нужны adapters, artifact/config hashes, evaluation и новый immutable release ([Evaluation](09_EVALUATION_AND_MODELS.md), [текущий manifest builder](../../apps/api/src/postgres-repository.ts)).
3. PDF-first R1, canonical geometry, CropBox/Rotate, 300 dpi, tiles `2048×2048` с overlap `128`, text-layer-first и source page semantics остаются по [document pipeline](06_DOCUMENT_PIPELINE.md). Provider не вправе перенумеровывать страницы или подменять source locator.
4. Модель извлекает и объясняет, но не исполняет правила. DSL остаётся allowlisted и типизированным; произвольный Python/JavaScript/SQL запрещён ([rules and evidence](07_RULES_AND_EVIDENCE.md)).
5. Vendor benchmark — только причина включить кандидата в qualification. Он не доказывает качество на русскоязычной проектной документации Inspector AI.
6. Лицензии ниже — технический inventory, не юридическое заключение. Перед release нужен SBOM и письменный license review всех transitive artifacts.

## 3. Критерии выбора

| Критерий | Обязательное требование |
|---|---|
| Offline | Полный cold start из локального mirror при физически/политиками заблокированном egress |
| Языки | Отдельные gates для русского, английского и mixed-script; среднее не может скрыть провал RU |
| Structured output | Версионированная JSON Schema; unknown fields запрещены; schema validation после inference обязательна |
| Geometry/evidence | Tokens/polygons в canonical frame; модельный ответ без проверяемого token/span locator не принимается |
| Reproducibility | Точные revision, file SHA-256, runtime image digest, config hash, seed и hardware profile |
| License | On-prem/коммерческое применение допускается лицензией и SBOM прошёл review |
| Resources | Нет OOM/host swapping; profile проходит отдельный soak и workload benchmark |
| Failure mode | Ошибка, ambiguity или low quality приводят к typed abstention/FAILED, не к silent fallback |

## 4. Матрица кандидатов

`Принят` означает «рекомендуется в qualification baseline», а не «quality gate уже пройден».

| Slot | Кандидат | Лицензия | RU/EN, offline, structure/geometry | Ресурсы и решение |
|---|---|---|---|---|
| `RENDERER` | **pypdfium2/PDFium** | pypdfium2: `Apache-2.0 OR BSD-3-Clause`; PDFium: BSD-style + dependency notices | Локальный PDF renderer; язык не зависит от renderer; Python binding не требует обязательных runtime dependencies кроме Python/PDFium. Точный binary license bundle зависит от wheel build ([README/licensing](https://github.com/pypdfium2-team/pypdfium2/blob/main/README.md), [5.12.1 release](https://github.com/pypdfium2-team/pypdfium2/releases/tag/5.12.1)). | Низкая RAM/CPU-стоимость, удобен worker stack. **Принят** для обоих профилей. |
| `RENDERER` | Apache PDFBox | `Apache-2.0` | Полностью локальный Java renderer ([project](https://pdfbox.apache.org/), [`PDFRenderer`](https://pdfbox.apache.org/docs/2.0.9/javadocs/org/apache/pdfbox/rendering/PDFRenderer.html)). | **Отложен** как differential oracle: JVM sidecar не нужен в основном Python pipeline. |
| `RENDERER` | MuPDF | `AGPL-3.0` или commercial | Сильный локальный renderer, но официальный сайт прямо требует AGPL compliance либо commercial license для embedding ([licensing](https://mupdf.com/releases)). | **Отклонён** для текущего release без отдельной коммерческой лицензии. |
| `RENDERER` | Poppler | GPL family | Локальный mature renderer ([official project](https://poppler.freedesktop.org/), [source/license](https://gitlab.freedesktop.org/poppler/poppler/-/blob/master/COPYING)). | **Отклонён** как default из-за copyleft boundary; допустим только отдельный legal decision/CLI boundary. |
| `OCR_LAYOUT` | **PaddleOCR 3.7.0 / PP-StructureV3** | `Apache-2.0` ([release](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0), [license](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/LICENSE)) | Offline при явных local model dirs. PP-StructureV3 возвращает reading order, `block_bbox`, block type/content и OCR polygons/confidence ([output contract](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html)). `eslav_PP-OCRv5_mobile_rec` покрывает RU/BE/UK, `latin_PP-OCRv5_mobile_rec` — EN и другие Latin languages ([multilingual model card](https://paddlepaddle.github.io/PaddleOCR/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html)). | `PP-DocLayout-M` — 22.578 MB/efficiency; `PP-DocLayout-L` — 123.76 MB/higher published mAP. Tables и optional modules можно включать выборочно ([PP-StructureV3 model table](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PP-StructureV3.html)). **Принят** с разными defaults по профилям. |
| `OCR_LAYOUT` | Tesseract + tessdata `rus+eng` | `Apache-2.0` | Полностью локальный; hOCR/TSV/ALTO/PAGE дают boxes и confidence ([CLI/output spec](https://github.com/tesseract-ocr/tesseract/blob/main/doc/tesseract.1.asc), [official language data](https://github.com/tesseract-ocr/tessdata)). | CPU-friendly. **Отложен** как fallback/differential oracle: нет сопоставимого единого layout/table contract. |
| `OCR_LAYOUT` | Docling | Code: `MIT`; каждый model artifact проверяется отдельно | Поддерживает local/air-gapped execution, lossless JSON, layout/tables и явный prefetch ([repository](https://github.com/docling-project/docling), [offline setup](https://docling-project.github.io/docling/usage/advanced_options/)). | **Отложен**: orchestration дублирует собственный pipeline, а полный lock должен охватить все вложенные модели. |
| `OCR_LAYOUT` | PaddleOCR-VL 1.6 | `Apache-2.0` для проекта; weights проверяются отдельно | Локальный 0.9B document parser; официальный pipeline поддерживает local vLLM/FastDeploy deployment ([usage](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html)). | **Отложен** как challenger: нужен отдельный RU/geometry benchmark; не заменяет token-level evidence contract. |
| `METADATA_EXTRACTOR`, `ENTITY_EXTRACTION_MODEL` | **Bonsai 2 27B PTQ1_0 на laptop** | `Apache-2.0` ([model card](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf), [demo/runtime source](https://github.com/PrismML-Eng/Bonsai-demo)) | Local multimodal input, text+images, 262K model context и OpenAI-compatible local server. Собственные тесты PrismML показывают сильное reasoning, но большее падение в vision/OCR; поэтому PaddleOCR остаётся primary, а RU/EN Inspector gate обязателен. | `5.95 GB` PTQ1_0 + `0.63 GB` Q8 projector. Projector остаётся в RAM, context `8192`, concurrency `1`. **Принят для laptop qualification**, не как OCR/evidence authority. |
| те же slots | **Qwen3-VL-8B FP8 на H100** | `Apache-2.0` ([model card](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-FP8)) | Local multimodal input и structured JSON через vLLM. Заявленная поддержка OCR 32 языков требует проверки на RU/EN строительных документах. | Repository около `10.6 GB`; ограничены context `8192`, `max-num-seqs=2`, два изображения на запрос. **Принят для server qualification**, не как OCR/evidence authority. |
| те же slots | Qwen3-VL-30B-A3B FP8 | `Apache-2.0` ([model card](https://huggingface.co/Qwen/Qwen3-VL-30B-A3B-Instruct-FP8)) | Потенциально более сильный extraction challenger. | Repository около `32.3 GB`; отдельный H100 resource profile возможен только после peak-VRAM/latency/quality A/B. В текущий server stack не входит. |
| те же slots | Qwen3-VL 4B Q4_K_M | `Apache-2.0` ([GGUF card](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF)) | Более зрелый stock llama.cpp path и сильный multilingual OCR, но слабее сложное reasoning/extraction. | **Отложен как laptop fallback и A/B baseline**; больше не default. |
| те же slots | NuExtract3 | `Apache-2.0` | 4B multilingual VLM: text/image + JSON template → JSON; официальный baseline советует non-thinking mode, temperature 0.2 ([model card](https://huggingface.co/numind/NuExtract3), [GGUF](https://huggingface.co/numind/NuExtract3-GGUF)). | **Отложен** как специализированный challenger. Не выбран сейчас, чтобы не держать второй VLM stack; сравнить на frozen extraction corpus. |
| `ENTITY_EXTRACTION_MODEL` | GLiNER multilingual | `Apache-2.0` | Local multilingual span NER ([model card](https://huggingface.co/urchade/gliner_multi-v2.1)). | **Отложен** как дешёвый candidate generator: span NER не закрывает typed values, relations, units и evidence completeness. |
| `ENTITY_EXTRACTION_MODEL` | Laya multilingual | `Apache-2.0` | Локальный text-only encoder для типизированных решений по уже извлечённым коротким фрагментам ([model card](https://huggingface.co/convaiinnovations/laya-multilingual)). | **Отложен** как маршрутизатор/классификатор: не читает PDF/изображения и не создаёт source geometry; нужна RU domain-калибровка. [Исследование](../H100_MODEL_RESEARCH.md). |
| `LINKING_POLICY` | **`linking-policy-v1` + Qwen3 Embedding** | Internal code; Qwen weights `Apache-2.0` | 0.6B/4B models multilingual, 32K context, MRL/custom dimensions; series включает embedding и reranking ([official cards](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), [4B/reranker specs](https://huggingface.co/Qwen/Qwen3-Reranker-4B)). | **Принят**: embeddings/reranker только сортируют кандидатов после hard filters; решение и abstention детерминированы. |
| `LINKING_POLICY` | embedding-only nearest neighbour | Зависит от модели | Offline и быстрый, но не доказывает object/stage/revision/approval compatibility. | **Отклонён как final policy**; разрешён только retrieval. |
| `LINKING_POLICY` | VLM/LLM final linker | Зависит от модели | Может учитывать контекст, но не обеспечивает воспроизводимый revision graph и provenance. | **Отклонён как final policy**; может предложить explanation после решения. |
| `RULE_ENGINE` | **`typed-rules-v1`** | Internal | Typed Decimal/units/enums/sets/geometry, allowlisted comparators, strict UNKNOWN propagation; offline и без модели. | **Принят**: единственный вариант, напрямую реализующий текущий domain contract. |
| `RULE_ENGINE` | CEL | `Apache-2.0` | Малый, typed, mutation-free и non-Turing-complete expression language ([spec](https://github.com/cel-expr/cel-spec)). | **Отложен** как expression substrate: нужны собственные Decimal/unit/evidence types и conformance fixtures. |
| `RULE_ENGINE` | OPA/Rego | `Apache-2.0` | General-purpose local policy engine и structured decisions ([official repository](https://github.com/open-policy-agent/opa)). | **Отложен**: отдельный service/bundle не убирает необходимость domain comparators и unit semantics. |
| `RULE_ENGINE` | arbitrary Python/JS/SQL | — | Формально offline, но не имеет безопасного ограниченного semantics. | **Отклонён** согласно текущему DSL contract. |
| `EVIDENCE_VALIDATOR` | **`evidence-validator-v1`: Ajv + geometry/source checks** | Ajv `MIT`; internal checks | Ajv поддерживает JSON Schema 2020-12 ([repository](https://github.com/ajv-validator/ajv)); schema — официальный [Draft 2020-12](https://json-schema.org/draft/2020-12); JCS даёт repeatable canonical JSON для hash ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)). | **Принят**: работает CPU-only, reject-only, не исправляет модельный output. |
| `EVIDENCE_VALIDATOR` | VLM-as-judge | Зависит от модели | Не может криптографически доказать source hash, page bounds или completeness. | **Отклонён**. Допустим только как offline diagnostic, не release gate. |

Облачные OCR/LLM/embedding APIs для всех slots **отклонены без qualification**: они нарушают `externalNetworkAllowed=false`, независимо от качества или цены.

## 5. Контракты принятых providers

### 5.1. `RENDERER`

Profile IDs:

- `renderer-pdfium-5.12.1-linux-x86_64-v1` — оба hardware profile.

Defaults:

```yaml
dpi: 300
colorMode: RGB
alpha: false
javascript: disabled
xfa: disabled
tile:
  widthPx: 2048
  heightPx: 2048
  overlapPx: 128
geometry:
  frame: visible-after-cropbox-and-rotate
  origin: top-left
  normalized: true
  persistMediaBoxCropBoxRotate: true
maxWholePagePixels: 40000000
```

Renderer сохраняет source page boxes, affine transforms и tile offsets. При превышении `maxWholePagePixels` он не создаёт огромный bitmap, а переходит к tiles. Ошибка/timeout → `RENDER_FAILED` или `RESOURCE_LIMIT`; silent downgrade dpi запрещён.

Pinned artifact: manylinux x86_64 wheel `pypdfium2-5.12.1`, SHA-256 `e10cbf41b21233ec5e20adfc170cf60edd77abead86a97dc708fff55a8a886c7` из [immutable release assets](https://github.com/pypdfium2-team/pypdfium2/releases/tag/5.12.1). License bundle wheel включается в SBOM.

### 5.2. `OCR_LAYOUT`

Общий adapter `ocr-layout-paddle-v1` нормализует Paddle pixel polygons в canonical `[0,1]`, сохраняет raw output и не смешивает OCR confidence с calibrated probability.

| Default | Laptop | H100 server |
|---|---|---|
| Profile ID | `ocr-paddle-3.7.0-ru-en-mobile-v1` | `ocr-paddle-3.7.0-ru-en-server-v1` |
| Layout | `PP-DocLayout-M` | `PP-DocLayout-L` |
| Detection | `PP-OCRv5_mobile_det` | `PP-OCRv5_server_det` |
| Recognition | `eslav_PP-OCRv5_mobile_rec` + `latin_PP-OCRv5_mobile_rec` | те же два recognizer; batch выше |
| Dual-script policy | оба recognizer последовательно, выбор по confidence + Unicode/script validity | оба recognizer batch, та же policy |
| Orientation | page orientation `true`; text-line orientation `false` | page orientation `true`; text-line orientation `true` |
| Unwarping | `false` | `false`; включать только новым profile после transform gate |
| Tables | `true`, только detected table regions | `true`, wired/wireless models |
| Formula/chart/seal | `false/false/false` | `true/true/true` |
| Layout threshold/NMS | `0.50` / `true` | `0.50` / `true` |
| Text detector | `limit_side_len=2048`, `thresh=0.30`, `box_thresh=0.60`, `unclip_ratio=1.50` | те же значения; batch `8` |

PaddleOCR `v3.7.0` pin: commit `b03f46425e8ff4442b268ce449e3eef758146cd4`; PaddlePaddle framework baseline [`3.2.1`](https://github.com/PaddlePaddle/Paddle/releases/tag/v3.2.1). Каждый model archive имеет отдельный SHA-256 в artifact lock; model name без hash не считается pin.

### 5.3. `METADATA_EXTRACTOR` и `ENTITY_EXTRACTION_MODEL`

Оба slots используют один VLM process, но разные schemas/prompts и разные profile IDs:

- laptop: `metadata-hybrid-bonsai2-27b-ptq1-v1`, `entity-bonsai2-27b-ptq1-v1`;
- server: `metadata-hybrid-qwen3vl8b-fp8-v1`, `entity-qwen3vl8b-fp8-v1`.

Общие generation defaults:

```yaml
temperature: 0.0
topP: 1.0
seed: 20260918
maxOutputTokens: 2048
responseFormat: json_schema
additionalProperties: false
input:
  remoteUrlsAllowed: false
  maxImages: 1               # server override: 2
  includeOcrTokenIds: true
  includeCanonicalGeometry: true
evidenceBinding:
  requireExistingTokenIds: true
  requireVerbatimOrNormalizedSpanMatch: true
  acceptModelProvidedBbox: false
  onAmbiguousMatch: abstain
```

Порядок: deterministic parsers → region selection → VLM proposal → JSON Schema → type/unit normalization → exact/fuzzy-bounded token match → evidence refs. Модельный bbox игнорируется; геометрия берётся только у подтверждённых text-layer/OCR tokens. Для absence вывод возможен только при явно полном search scope.

Laptop artifact lock:

- `prism-ml/Ternary-Bonsai-2-27B-gguf` revision `6ed5e12bf84b7a63069882c91dd9e9218647d17b`;
- `Ternary-Bonsai-2-27B-PTQ1_0.gguf`, `5,946,648,928` bytes, SHA-256 `53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3`;
- `Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf`, `629,246,976` bytes, SHA-256 `6807ede61d570bb86ba34b756a0fa109edc33668604de867c6ea6d8f1d631903`;
- полный machine-readable lock: [`services/bonsai/artifacts.lock.json`](../../services/bonsai/artifacts.lock.json), file SHA-256 `e5f4e64b90cb2b9170021c0339db55fbf00bdfc5466bf6e3b1bf65f43e564e8f`.

Server VLM входит в полный machine-readable [`server.json`](../../services/model-store/locks/server.json): `Qwen/Qwen3-VL-8B-Instruct-FP8@9cdc6310a8cb770ce18efaf4e9935334512aee45`, два safetensors shards, index, processor, tokenizer/config files с точными размерами и SHA-256. Тот же lock содержит `Qwen3-Embedding-0.6B`; reranker в профиле отсутствует.

### 5.4. `LINKING_POLICY`

Profile IDs:

- laptop: `linking-policy-v1-qwen3-embed-06b-pgvector-v1`;
- server: `linking-policy-v1-qwen3-embed-06b-pgvector-v1`.

Defaults:

```yaml
hardFilters:
  sameOrganization: true
  sameObject: true
  allowedManifestOnly: true
  requireCompatibleStagePair: true
  requireFamilyEntityCompatibility: true
  requireApplicableRevision: true
  approvalStatesAllowed: [APPROVED]
  unknownOrConflictingApproval: abstain
candidateLimit: 20
rerankLimit: 0                # оба профиля: disabled
embeddingDimension: 1024
distance: cosine
autoLinkEnabled: false        # until calibrated threshold is frozen in a release
onRevisionCycleOrGap: CLARIFICATION_REQUIRED
```

Embeddings никогда не обходят hard filters. «Последний загруженный» не является revision rule. До calibration все non-exact links идут в review; после qualification новый release фиксирует threshold, calibration version и expected FPR.

Pinned model revisions:

- laptop `Qwen/Qwen3-Embedding-0.6B@97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`, primary safetensors SHA-256 `0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd`;
- server использует тот же pinned `Qwen3-Embedding-0.6B` на CPU с output 1024; индекс, созданный моделью 4B, требует отдельного re-embed, смешивать поколения нельзя.

### 5.5. `RULE_ENGINE`

Profile ID: `typed-rules-matrix132-v1`; adapter: `typed-rules-adapter-v1`; license: `LicenseRef-Internal-Inspector` до отдельного project license decision.

```yaml
catalogVersion: matrix-132-v1
decimalPrecision: 28
roundingForDisplayOnly: true
unknownPropagation: strict
divisionByZero: abstain
zeroBaselineReasonCode: ZERO_BASELINE
allowedComparators:
  - decimal_absolute
  - decimal_relative
  - typed_constraint
  - ordered_category
  - presence
  - set_difference
  - geometry_topology
  - approved_change_context
arbitraryCode: false
```

Rule output не зависит от GPU/VLM. Raw value, normalized value, unit conversion, comparator version и operands сохраняются раздельно.

### 5.6. `EVIDENCE_VALIDATOR`

Profile ID: `evidence-jsonschema202012-geometry-v1`; adapter: `evidence-validator-adapter-v1`; Ajv `8.20.0`.

Validator работает в reject-only режиме:

- JSON Schema 2020-12, `additionalProperties=false`;
- JCS/RFC 8785 перед SHA-256;
- source file/member hash существует в immutable manifest и принадлежит тому же organization/object/run;
- `source_pdf_page_number` существует; rendered page не подменяет source page;
- координаты конечны, `0≤x0<x1≤1`, `0≤y0<y1≤1`; polygon не вырожден;
- transform version совпадает с renderer artifact; round-trip control points проходят geometry gate;
- extracted value связан с существующими token/span IDs и их text hash;
- присутствуют все required source roles; context evidence обязателен, если от него зависит comparator;
- модельный rationale не компенсирует отсутствующий источник или bbox.

Нарушение не «чинится» validator-ом: результат понижается до typed abstention либо stage завершается `FAILED` при повреждении контракта.

## 6. Inference runtimes

| Runtime | Сильные стороны | Ограничения | Решение |
|---|---|---|---|
| **PrismML fork llama.cpp `prism-b10685-7dffb15`** | MIT runtime; custom PTQ1_0/PQ2_0 kernels и Hadamard activation path, multimodal Q8 projector, OpenAI-compatible server ([source of truth](https://github.com/PrismML-Eng/Bonsai-demo), [fork release](https://github.com/PrismML-Eng/llama.cpp/releases/tag/prism-b10685-7dffb15)). | Stock llama.cpp Bonsai 2 не запускает; требуется fork supply-chain pin. Меньше scheduling возможностей, чем vLLM. | **Laptop default**, commit `7dffb158de30ebb8ef9d64f33c6b0b2d7c1e6313`; CUDA 12.4 и CPU images закреплены checksum-ами release assets. |
| **vLLM 0.29.0** | Apache-2.0; continuous batching, multimodal Qwen3-VL support и structured outputs/JSON Schema ([supported models](https://docs.vllm.ai/en/latest/models/supported_models.html), [structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/), [release](https://github.com/vllm-project/vllm/releases/tag/v0.29.0)). | Linux/CUDA stack тяжелее; memory knobs и kernels аппаратно-зависимы. | **H100 default**, commit `98dff2a81d747d1dba01a47f939f48c3526d4206`. |
| ONNX Runtime | MIT; cross-platform graph optimization и hardware execution providers ([official repository](https://github.com/microsoft/onnxruntime)). | Не является единым runtime для выбранных Qwen3-VL profiles; model conversion создаёт новый artifact и новый gate. | **Отложен** для embedding/OCR optimization. |
| TensorRT-LLM | Apache-2.0; NVIDIA-specific optimized LLM runtime ([official repository](https://github.com/NVIDIA/TensorRT-LLM)). | Engine build зависит от GPU/CUDA/profile; добавляет conversion/calibration artifacts и regression surface. | **Отложен** до benchmark против vLLM на H100. |

Runtime API слушает только loopback/Unix socket, не принимает remote image URLs и не включает tools/web search. `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`; Paddle получает только explicit local model dirs. Контейнеры стартуют с deny-all egress; временное скачивание при первом запросе считается release-blocking defect.

## 7. Vector storage

| Вариант | Возможности и лицензия | Решение |
|---|---|---|
| **PostgreSQL 17 + pgvector 0.8.6** | PostgreSQL license; exact/approximate search, HNSW/IVFFlat, SQL filters и iterative scans. Документация отдельно предупреждает, что approximate filtering выполняется после scan и требует настройки recall ([official README](https://github.com/pgvector/pgvector), [v0.8.6 tag](https://github.com/pgvector/pgvector/tree/v0.8.6)). | **Принят**: один transaction/security boundary с domain data; revision/object filters остаются SQL hard gates. |
| Qdrant | Apache-2.0; payload filtering, quantization и distributed mode ([filtering](https://qdrant.tech/documentation/concepts/filtering/), [distributed deployment](https://qdrant.tech/documentation/scaling/distributed_deployment/), [license](https://github.com/qdrant/qdrant/blob/master/LICENSE)). | **Отложен** до доказанного pgvector bottleneck или объёма, не помещающегося на одном DB node. |
| FAISS | MIT; CPU/GPU exact и approximate indexes ([official README](https://github.com/facebookresearch/faiss/blob/main/README.md)). | **Отклонён как system of record**: нет domain transactions, tenant filters и persistence semantics. Разрешён benchmark tool. |
| Milvus | Apache-2.0; distributed vector database with compute/storage components ([official repository](https://github.com/milvus-io/milvus)). | **Отложен/избыточен** для R1: существенно увеличивает on-prem operations surface. |

Общая schema использует `vector(1024)` и cosine distance. Laptop выполняет exact scan до `250000` active-scope rows. Server создаёт HNSW после golden recall comparison:

```sql
CREATE INDEX CONCURRENTLY document_chunk_embedding_hnsw
ON document_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);

SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.iterative_scan = strict_order;
```

Перед vector query обязательны organization/object/manifest/stage filters. HNSW допускается, только если `Recall@20 ≥ 0.98` относительно exact search на frozen linking set; иначе остаётся exact scan или повышается `ef_search`. Смена embedding model/revision требует отдельной column/index generation и полного re-embed; in-place mixing запрещён.

## 8. Точные рекомендуемые профили

### 8.1. Laptop: `laptop-rtx4060-8gb-v1`

Hardware: NVIDIA RTX 4060 Laptop 8 GiB VRAM, AMD Ryzen 9 7940H, 16 GiB nominal system RAM (`14 GiB` видит ОС), Linux x86_64, локальный NVMe. Повторный замер 19 сентября 2026 года перед provisioning: около `2,2 GiB` свободного диска и `2,5 GiB` доступной RAM. Поэтому реальный model pull/runtime сейчас `DRAFT_BLOCKED`: перед provisioning нужны минимум `20 GiB`, рекомендуется `40 GiB` свободного диска и минимум `6 GiB` доступной RAM.

```yaml
profileId: laptop-rtx4060-8gb-v1
externalNetworkAllowed: false
runtime:
  os: linux-x86_64
  gpu: NVIDIA-RTX-4060-Laptop-8GiB
  gpuStageConcurrency: 1
  renderWorkers: 8
  ocrWorkers: 1
  modelParallelSlots: 1
  workerRssLimitGiB: 10
  gpuMemoryGateGiB: 7.25
renderer: renderer-pdfium-5.12.1-linux-x86_64-v1
ocrLayout: ocr-paddle-3.7.0-ru-en-mobile-v1
metadataExtractor: metadata-hybrid-bonsai2-27b-ptq1-v1
entityExtractionModel: entity-bonsai2-27b-ptq1-v1
linkingPolicy: linking-policy-v1-qwen3-embed-06b-pgvector-v1
ruleEngine: typed-rules-matrix132-v1
evidenceValidator: evidence-jsonschema202012-geometry-v1
llmRuntime:
  name: PrismML-Eng/llama.cpp
  version: prism-b10685-7dffb15
  model: prism-ml/Ternary-Bonsai-2-27B-gguf@6ed5e12bf84b7a63069882c91dd9e9218647d17b
  quantization: PTQ1_0
  visionProjector: Q8_0
  visionProjectorDevice: cpu
  contextTokens: 8192
  parallel: 1
  batchTokens: 512
  microBatchTokens: 128
  imageMaxTokens: 4096
  gpuLayers: 99
  bind: 127.0.0.1:8081
embeddingRuntime:
  name: sentence-transformers
  version: 6.1.0
  device: cpu
  maxInputTokens: 4096
  batchSize: 8
  normalize: true
vectorStorage:
  engine: PostgreSQL-17+pgvector-0.8.6
  dimensions: 1024
  index: exact
```

GPU stages строго последовательны: Paddle OCR выгружается/освобождает tensors до VLM request; embedding остаётся CPU. При OOM adapter не уменьшает dpi/context скрытно: job получает `RESOURCE_LIMIT`, а изменение defaults требует нового profile/config hash.

Docker implementation: [`infra/docker-compose.laptop.yml`](../../infra/docker-compose.laptop.yml), [`services/bonsai`](../../services/bonsai), [`services/document-ai`](../../services/document-ai), [`services/text-inference`](../../services/text-inference) и общий [runbook](../operations/DOCKER_PROFILES.md). Model provisioners имеют download/import phase; runtimes подключены только к internal network и получают model volumes read-only. Это deployment plumbing, не подтверждение quality и не основание менять release slot status.

### 8.2. Server: `server-h100-80gb-v1`

На стенде установлены **2× NVIDIA H100 80 ГБ**, но команде выделяется **не более одного физического GPU**; совместное тестирование на выбранном GPU возможно. Доступно до 24 физических CPU-ядер/48 потоков, 640 ГБ RAM и не менее 300 ГБ рабочего диска. Compose передаёт в каждый GPU-контейнер только `SERVER_GPU_DEVICE`; внутри он виден как CUDA device `0`. Tensor parallelism остаётся `1`, вторая H100 не используется. Проектный resource gate проверяет как общий объём, так и занятую VRAM до старта; он не резервирует GPU от последующих внешних процессов.

```yaml
profileId: server-h100-80gb-v1
externalNetworkAllowed: false
runtime:
  os: linux-x86_64
  gpu: NVIDIA-H100-80GB
  physicalCpuCoresAvailableMax: 24
  systemRamGiBAvailableMax: 640
  workingDiskGiBMin: 300
  renderWorkers: 8
  ocrWorkers: 2
  gpuMemoryAdmissionFraction: 0.85
renderer: renderer-pdfium-5.12.1-linux-x86_64-v1
ocrLayout: ocr-paddle-3.7.0-ru-en-server-v1
metadataExtractor: metadata-hybrid-qwen3vl8b-fp8-v1
entityExtractionModel: entity-qwen3vl8b-fp8-v1
linkingPolicy: linking-policy-v1-qwen3-embed-06b-pgvector-v1
ruleEngine: typed-rules-matrix132-v1
evidenceValidator: evidence-jsonschema202012-geometry-v1
vlmRuntime:
  name: vLLM
  version: 0.29.0
  model: Qwen/Qwen3-VL-8B-Instruct-FP8
  tensorParallelSize: 1
  maxModelLen: 8192
  maxNumSeqs: 2
  maxImagesPerPrompt: 2
  gpuMemoryUtilization: 0.35
  enablePrefixCaching: true
  bind: 127.0.0.1:8101
embeddingRuntime:
  name: sentence-transformers
  version: 6.1.0
  model: Qwen/Qwen3-Embedding-0.6B
  device: cpu
  outputDimensions: 1024
  maxInputTokens: 4096
  batchSize: 8
  normalize: true
rerankerRuntime: disabled
vectorStorage:
  engine: PostgreSQL-17+pgvector-0.8.6
  dimensions: 1024
  index: hnsw
  hnswM: 16
  hnswEfConstruction: 128
  hnswEfSearch: 100
```

VLM и Paddle делят одну H100. Startup admission объявляет budgets `30,720 MiB` для VLM и `10,240 MiB` для document AI, всего `40,960 MiB`, и разрешает запуск только когда `used + requested ≤ 0.85 × total VRAM`. vLLM резервирует до `0.35` общей VRAM, Paddle запрашивает fraction `0.10`; фактические peak/fragmentation и влияние соседних процессов ещё не измерены. При OOM новый профиль требует снижения concurrency/отдельного расписания GPU stages и повторного quality gate, а не скрытого снижения DPI/context.

CPU embedding process закреплён на [`sentence-transformers 6.1.0`](https://github.com/huggingface/sentence-transformers/releases/tag/v6.1.0); container digest и transitive Python lock всё равно обязательны.

Server Docker implementation: [`infra/docker-compose.server.yml`](../../infra/docker-compose.server.yml), checksum-locked [`server.json`](../../services/model-store/locks/server.json), amd64 vLLM `0.29.0` image digest и общий [runbook](../operations/DOCKER_PROFILES.md). Embedding работает на CPU без доступа к GPU.

## 9. Artifact lock и offline deployment

Каждый release содержит `artifact-lock.json` со следующими полями для **каждого** файла: logical name, upstream URL, immutable revision/tag, byte size, SHA-256, SPDX/license reference, notice path и local registry URI. Для multi-file Hugging Face snapshot перечисляются все shards/config/tokenizer/mmproj; `main`, model name или Docker tag без digest запрещены.

Packaging выполняется в подключённой build zone, runtime — в изолированной zone:

1. Скачать только allowlisted primary artifacts; проверить upstream revision и file SHA-256.
2. Собрать SBOM и license notices; отклонить unknown/non-approved license.
3. Просканировать images/files; подписать artifact-lock и container digests.
4. Импортировать в локальный registry/model store.
5. Cold-start smoke с пустыми user caches и deny-all egress. Любая попытка download/telemetry — fail.
6. Runtime принимает только local paths/data URLs с size limits; `http://`/`https://` в provider payload запрещены schema-level.

`artifactHash = SHA-256(JCS(artifact-lock.json))`; `configHash = SHA-256(JCS(slot-config.json))`. Hash не следует выдумывать в этом документе: он вычисляется из реально импортированного полного lock. Именно эти два значения попадают в immutable release.

## 10. Qualification benchmark и gates

### 10.1. Frozen corpus

Минимум для допуска профиля:

- ≥200 страниц из ≥10 объектов, object-isolated split;
- digital/layered PDF, сканы, RU, EN, mixed RU/EN, rotated/cropped pages, большие чертежи с tiles, штампы, wired/wireless tables;
- ≥300 gold metadata/entity fields с token/bbox provenance;
- ≥100 linking decisions, включая stale revision, cycles/gaps, conflicting approval и hard negatives;
- для каждого реализованного comparator: positive, negative, boundary, missing, unknown, malformed-unit fixtures;
- corrupted/encrypted/resource-limit и prompt-injection документы.

Недостаточный slice получает `NOT_ESTIMABLE`, а не pass. Документы qualification не используются для prompt tuning после freeze.

### 10.2. Quality gates

Обязательные проектные пороги наследуются из [Evaluation](09_EVALUATION_AND_MODELS.md):

| Stage | Gate |
|---|---|
| OCR RU / EN / mixed | Character accuracy ≥`0.95` **в каждом** slice |
| OCR geometry | ≥`0.95` gold tokens имеют matched polygon IoU ≥`0.50`; out-of-bounds = `0` |
| Reading order/table | Kendall τ ≥`0.90`; table cell F1 ≥`0.90` на соответствующих slices |
| Metadata | Key-field exact match ≥`0.90`; schema-valid output `100%` |
| Linking | accuracy ≥`0.95`; cross-object/stage hard-gate violations = `0`; HNSW `Recall@20 ≥0.98` vs exact |
| Entity/rules end-to-end | Precision ≥`0.90`, Recall ≥`0.80`, F1 ≥`0.85`, FPR ≤`0.10` |
| Evidence | ≥`0.95` complete evidence groups; exact source pages; bbox IoU ≥`0.50`; invalid source/hash/page acceptance = `0` |
| Regression | Recall по обязательной категории не падает >2 п.п.; FPR не растёт >2 п.п. относительно approved baseline |

Vendor-reported mAP/accuracy в таблицах кандидатов не засчитывается вместо этих gates.

### 10.3. Reproducibility, security и resources

| Gate | Laptop | H100 server |
|---|---|---|
| Offline | 0 успешных egress connections; cold start из local mirror | то же |
| Deterministic stages | renderer/rules/evidence byte-identical в 3/3 runs | то же |
| Model repeatability | normalized values + evidence token IDs совпадают в 3/3 runs; иначе abstention/детерминизация | то же |
| Memory | peak VRAM ≤`7.25 GiB`, worker RSS ≤`10 GiB`, system available headroom ≥`1.5 GiB`, без swap/OOM | VLM+OCR startup budgets `40,960 MiB`, занятая память вместе с budgets ≤`85%` выбранной H100; пиковые значения замерить; без OOM |
| Soak | 32-page mixed bundle, 3 последовательных runs, 0 leaks/crashes | 60 минут при configured concurrency, error rate <`0.1%`, 0 OOM |
| Throughput | sustained end-to-end ≥`1 page/min` на qualifying mixed corpus | цель ≥`4 pages/min` на том же corpus; уточнить после H100 soak и адаптеров |
| Latency | render p95 ≤`2 s`; OCR p95 ≤`20 s`; VLM p95 ≤`60 s` на A4/one-region fixtures | измерить p50/p95 каждого stage при выделенном и совместно используемом GPU |
| Geometry | 4 corners + center round-trip error ≤`0.5` raster pixel | то же |
| Adversarial | prompt text не меняет schema/tools/network policy; malformed PDF не выходит из quota | то же |

Performance gates — qualification targets, не измеренные результаты. Отчёт обязан хранить exact corpus hash, warmup, batch/concurrency, power mode, GPU driver/CUDA, timings, peak memory и raw errors.

## 11. Release-manifest mapping

Точное соответствие существующим stage/slot:

| `stageJobType` | `providerKind` | Laptop `profileId` | Server `profileId` | `adapterVersion` | `licenseId` |
|---|---|---|---|---|---|
| `DOCUMENT_RENDER` | `RENDERER` | `renderer-pdfium-5.12.1-linux-x86_64-v1` | то же | `renderer-pdfium-adapter-v1` | `LicenseRef-pypdfium2-pdfium-bundle-5.12.1` |
| `DOCUMENT_OCR_LAYOUT` | `OCR_LAYOUT` | `ocr-paddle-3.7.0-ru-en-mobile-v1` | `ocr-paddle-3.7.0-ru-en-server-v1` | `ocr-layout-paddle-v1` | `Apache-2.0` |
| `DOCUMENT_METADATA` | `METADATA_EXTRACTOR` | `metadata-hybrid-bonsai2-27b-ptq1-v1` | `metadata-hybrid-qwen3vl8b-fp8-v1` | `metadata-hybrid-adapter-v1` | `Apache-2.0 AND LicenseRef-Internal-Inspector` |
| `DOCUMENT_LINKING` | `LINKING_POLICY` | `linking-policy-v1-qwen3-embed-06b-pgvector-v1` | то же | `linking-policy-adapter-v1` | `Apache-2.0 AND LicenseRef-Internal-Inspector` |
| `ENTITY_EXTRACTION` | `ENTITY_EXTRACTION_MODEL` | `entity-bonsai2-27b-ptq1-v1` | `entity-qwen3vl8b-fp8-v1` | `entity-extraction-adapter-v1` | `Apache-2.0 AND LicenseRef-Internal-Inspector` |
| `RULE_EVALUATION` | `RULE_ENGINE` | `typed-rules-matrix132-v1` | то же | `typed-rules-adapter-v1` | `LicenseRef-Internal-Inspector` |
| `EVIDENCE_VALIDATION` | `EVIDENCE_VALIDATOR` | `evidence-jsonschema202012-geometry-v1` | то же | `evidence-validator-adapter-v1` | `MIT AND LicenseRef-Internal-Inspector` |

Для каждой строки:

- `status` становится `CONFIGURED` только после всех gates;
- `artifactHash` и `configHash` — реальные SHA-256 полного JCS lock/config;
- `resourceProfile` равен строго `laptop-rtx4060-8gb-v1` или `server-h100-80gb-v1`;
- release-level `externalNetworkAllowed` остаётся `false`;
- `rules.executionStatus` становится configured только вместе с опубликованным `matrix-132-v1` mapping и fixtures;
- `releaseId` генерируется из canonical manifest, а не задаётся вручную.

Текущий TypeScript interface ограничен `lifecycle: "SCAFFOLD"`, slot `status: "UNCONFIGURED"` и null profile fields. Поэтому до реализации versioned configured-manifest validator, DB/API readback и compatibility tests эти profile IDs существуют только как DRAFT recommendation; подмена scaffold JSON вручную запрещена.

## 12. Итоговый статус решений и blockers

### Принято для qualification

- PDFium/pypdfium2 renderer;
- PaddleOCR/PP-StructureV3 с раздельными RU/Latin recognizers;
- Bonsai 2 27B PTQ1_0 на laptop и Qwen3-VL 8B FP8 на одном H100;
- deterministic hybrid extraction/evidence binding;
- deterministic linking policy + Qwen3 embeddings only for candidate order;
- typed internal rule engine;
- Ajv/JSON Schema + geometry/source evidence validator;
- PostgreSQL/pgvector; закреплённый PrismML llama.cpp fork для laptop, vLLM для server.

### Отложено

- PDFBox как renderer oracle; Tesseract как OCR oracle/fallback;
- Docling и PaddleOCR-VL как challengers;
- NuExtract3/GLiNER/Laya multilingual и Qwen3-VL 30B-A3B как challengers;
- CEL/OPA как возможные внутренние substrates;
- ONNX Runtime/TensorRT-LLM optimization;
- Qdrant/Milvus до доказанного scale bottleneck.

### Отклонено в текущем release

- любые cloud APIs;
- MuPDF без commercial license/AGPL decision, Poppler без copyleft decision;
- embedding-only или LLM-only final linking;
- arbitrary-code rules;
- VLM-as-evidence-validator;
- FAISS как system of record.

### Release blockers

1. Нет frozen representative corpus и подписанного qualification report; значит quality/throughput пока не доказаны.
2. Не реализованы семь adapters и configured lifecycle manifest; текущие slots должны остаться `UNCONFIGURED`.
3. Bonsai и Qwen snapshots имеют полные file locks; внешние base/runtime images закреплены digest. Ещё не собран единый подписанный release artifact lock/SBOM: Paddle первый download пока TOFU с exact local inventory, не upstream archive hash; нужны итоговые digests custom images, hash-lock transitive wheels и license notices.
4. Не откалиброван linking threshold; `autoLinkEnabled=false` обязателен.
5. Bonsai требует закреплённый PrismML fork llama.cpp; его image/schema/geometry path должен пройти отдельный soak и не может незаметно заменяться stock llama.cpp.
6. Для laptop до импорта artifacts нужно подтвердить минимум 20 GiB, рекомендуется ≥40 GiB свободного диска, и ≥6 GiB доступной RAM. Текущий замер около 2,2/2,5 GiB gate не проходит. Для server startup admission реализован, но нужны фактическая H100/CUDA/vLLM совместимость и peak/fragmentation soak при совместном GPU.
7. Нужны ручные license/security approvals и проверка, что cold start не пытается обращаться наружу.
