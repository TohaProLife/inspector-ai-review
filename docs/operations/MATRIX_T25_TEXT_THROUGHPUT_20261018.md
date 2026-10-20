# T25: text-layer throughput investigation

Date: 2026-10-18 MSK. Runtime is read-only. Only this note and temporary benchmark files under `/tmp` are produced; no feedback worker, extraction code, cache profile or queue is changed.

## Cause and minimal candidate

The runtime owner's observation was one 37 MB/27-page F0154 `DOCUMENT_TEXT_LAYER` job occupying the document worker at approximately 100% CPU and 813 MiB RSS for roughly five minutes, with two small synthetic PDF jobs queued behind it. That observation is not a measured benchmark baseline and does not establish a timeout, retry or expired lease.

`services/worker/inspector_worker/text_layer.py:_visible_pdf_layouts` constructs a `VisiblePageAggregator(PDFPageAggregator)` and retains pdfminer's normal interpreter, layout parameters, resources and visible CropBox/rotation CTM. `extract_pdf_text_artifact` subsequently serializes only top-level `LTTextContainer` objects. Vector `LTLine`, `LTRect` and `LTCurve` objects are created and analyzed but are not emitted into document-text-v2.

Installed primary source inspected: pdfminer.six `20260107`, Python `3.12.13`, `services/worker/.venv/lib/python3.12/site-packages/pdfminer/converter.py` and `layout.py`. `PDFLayoutAnalyzer.paint_path` transforms path points and allocates those vector objects, including recursive splitting of multiple subpaths. It does not change the interpreter CTM or graphic state. `PDFPageInterpreter.do_S`/`do_f` call the device and reset the current path themselves. `LTLayoutContainer.analyze` splits text characters from other objects before text grouping.

The minimal production candidate, for separate implementation/review, is overriding **only `paint_path`** on the existing local `VisiblePageAggregator` subclass with a no-op. Keep `begin_page`, `begin_figure`, `end_figure`, `render_char`, text resource processing and CTM unchanged. The benchmark uses a temporary process-local monkeypatch of `PDFLayoutAnalyzer.paint_path` to test exactly that omission; no installed module or repository source is rewritten.

Exact proposed insertion inside `VisiblePageAggregator`, before its existing `begin_page`:

```python
def paint_path(self, gstate: Any, stroke: bool, fill: bool,
               evenodd: bool, path: Any) -> None:
    # document-text-v2 emits text containers, never vector marks.
    return None
```

`render_image` remains active in the measured candidate. Its 8121 calls are far fewer than paint-path calls in F0154, and removing it is unnecessary to establish the narrower candidate. Do not skip form interpretation or flatten figures: text/form transforms would be affected by those broader changes.

## Reproducible benchmark and exactness

Script: `/tmp/matrix-t25-text-benchmark.py`. Inputs: `/tmp/matrix-t22-F0154.pdf` and completed canonical `/tmp/matrix-t22-F0154.text.json`. PDF size: **37,325,888 bytes**. PDF SHA256: `336e9742450dd403c6e2dfd0ee4660d316725e95201f4cb41308d2b9296c085b`.

The script verifies the original PDF hash against the canonical reference, starts a fresh process per mode, instruments top-level/recursive paint-path calls, and measures `perf_counter`, `process_time` and Linux `RUSAGE_SELF.ru_maxrss`. Canonical input is read without editing fields. The full newly extracted Python object is compared to the full reference object; unmodified serialized output is compared byte-for-byte to the original reference file. No hash field, source ID, geometry, page, quality metric or ordering is replaced to obtain equality.

```sh
/home/freetok/Projects/Hackaton/services/worker/.venv/bin/python \
  /tmp/matrix-t25-text-benchmark.py --mode skip-paths \
  --output-prefix /tmp/matrix-t25-candidate --timeout 240

/home/freetok/Projects/Hackaton/services/worker/.venv/bin/python \
  /tmp/matrix-t25-text-benchmark.py --mode baseline \
  --output-prefix /tmp/matrix-t25-baseline --timeout 420
```

Both modes run on the local workstation, not in the constrained homeserver worker container. The baseline preserves the original `paint_path` through a counting wrapper. Counts add a small instrumentation overhead to both modes. `maxRSS` describes the entire fresh process, including input hashing/reference loading, not an isolated retained-layout allocation. Other application work can affect wall time; CPU time is reported alongside it. A single measured pair does not establish a general throughput distribution or a homeserver speed guarantee.

The candidate ran first, followed by a separate original-aggregator baseline process:

| Measurement | Original baseline | Skip-paths candidate |
| --- | ---: | ---: |
| Wall seconds | 151.799072 | 96.535734 |
| CPU seconds | 151.726886 | 96.498703 |
| MaxRSS KiB | 1881164 | 787860 |
| Top-level paint calls | 2778981 | 2778981 |
| Additional recursive paint calls | 179227 | 0 |
| Top-level path segments | 9438765 | 9438765 |
| Image calls, unchanged | 8121 | 8121 |
| Pages / blocks | 27 / 4484 | 27 / 4484 |
| Full reference object equal | true | true |
| Exact original reference bytes equal | true | true |

All three files—original reference, baseline output and candidate output—are byte-for-byte identical, SHA256 `f1a7f8ab64f879a7ac3fcb714f14293b24961a559f8665f2d121da38b6d00907`. In this measured local pair the candidate reduced wall time by **36.406%** (1.572× baseline/candidate ratio), CPU by **36.400%**, and peak RSS by **58.118%**. These percentages use the measured paired baseline, never the earlier homeserver observation.

The smaller F0144 cProfile process below overlapped part of the baseline on another CPU. The near-identical CPU and wall durations show neither F0154 process spent material wall time waiting for CPU, but the runs are not an isolated repeated statistical benchmark. Cache warmth, CPU frequency and application load remain limits. A runtime rollout should reproduce the improvement in the actual constrained worker; these local numbers are not a claim that homeserver will finish in 96 seconds.

## Bounded profile: smaller public F0144

An independent baseline profile completed within its 60-second limit using the existing public 14-page F0144 original (2,091,857 bytes, SHA256 `9e4fc4e231af437be17c7c3a5380f2da567b258b8c9ab09baaf93bf038212537`). Files: `/tmp/matrix-t25-F0144-profile.pstats`, `/tmp/matrix-t25-F0144-baseline-profile.metrics.json`, `/tmp/matrix-t25-F0144-baseline-profile.artifact.json`.

This cProfile run is deliberately excluded from paired speed calculations because profiler overhead is substantial: 144,030,247 function calls, 52.684688 s extraction wall / 52.660789 s CPU. It produced 14 pages / 5911 blocks. The full object equals the existing reference; raw canonical bytes do not because that older reference has a different JSON serialization. The reference was not rewritten: its file SHA256 remains `2786f1cf084c378bc6e9e03fdd91e5c2a0ed8fb7f9e7c1c8e4fe9b33d144df4a`; new output SHA256 is `6d0c0a6a72d48edfb5f9d7b0b62bf4039af9bbe01f8a6d01060379640c0bc23c`.

Profile cumulative times overlap and must not be added:

| Function | Cumulative seconds |
| --- | ---: |
| `PDFPageInterpreter.render_contents` | 30.614 |
| `LTLayoutContainer.analyze` | 21.454 |
| `group_textboxes` | 20.309 |
| Original `PDFLayoutAnalyzer.paint_path` | 3.016431 |
| `render_image` | 0.000039 |

Paint paths: 103310 top-level plus 50082 recursive calls, 436374 top-level segments. Images: 3. This supports retaining image rendering and limiting the proposed change to unused vector objects. Even the candidate still parses all path operators and retains normal text grouping. It will not eliminate CPU cost or serial-queue head-of-line waiting. Changing `LAParams`/text grouping would be a separate semantic change requiring its own exactness evidence.

## Geometry and form equivalence probe

Temporary script: `/tmp/matrix-t25-geometry-equivalence.py`; receipt: `/tmp/matrix-t25-geometry-equivalence.json`. **36 cases passed full-object equality** between original aggregator and temporary skip-paths candidate:

- 0/90/180/270 degree rotations;
- CropBox present/absent, zero and nonzero MediaBox origins;
- visible text, hidden/straddling text;
- line, rectangle, Bezier and multiple-subpath vector painting;
- transformed Form XObject with text and vector drawing, plus an image XObject.

The comparison includes exact text, every block/line box, dimensions, quality metrics and summary. Current extraction omits text nested inside Form XObjects because it emits only top-level `LTTextContainer`; the synthetic mixed page yields `DIRECT TEXT` in both modes. Equality preserves that existing limit and does not establish that all PDF text is extracted.

Before a runtime change is accepted, convert these probes into repository regression tests for the existing subclass: paths mixed with direct text; vector-only/image-only pages remaining OCR_REQUIRED; nested/transformed text Form XObjects retaining baseline behavior; four rotations and shifted/cropped origins; partially visible text; repeated extraction; and byte-exact replay against F0154 plus the existing public 185-page package. Existing geometry tests must continue to reject invalid CropBox and unsupported rotation. Do not change the extraction/cache profile to bypass comparison; the normal source fingerprint already distinguishes an eventual implementation change.

## Evidence paths and source identity

- Runtime text-layer source SHA256: `5b0bcf3dfe1720b329987a91ec26af873cf54b69d0e7944c7b27274d44f42b90`.
- Benchmark script SHA256: `4d7c85f50fa5d7826348793130d915887e868b55dc6a29e95e93035a83659214`.
- Geometry probe script SHA256: `03f6a27358d3fa58fdb5b2ad7fa947caccad2c1300313a6dc5f19ed74f7f4312`.
- Geometry receipt SHA256: `83176cd2d7de6c4dbea8b3b3faf6958b8db2094f2cebe9e83ea9a1a0074fec14`.
- Candidate: `/tmp/matrix-t25-candidate.metrics.json`, `/tmp/matrix-t25-candidate.artifact.json`.
- Baseline: `/tmp/matrix-t25-baseline.metrics.json`, `/tmp/matrix-t25-baseline.artifact.json`.
- Candidate metrics SHA256: `52ac400bd37b3e8577b71c990afbd911489cfec605f466bbfb19f77104d3f9da`.
- Baseline metrics SHA256: `50cc05eee207f6306baec0ca8a97c3acad3156bd479ee11a09a39d74d1cd2c12`.
- F0144 profile SHA256: `04b1d5051e1f1c70556b3996c467e42bf141ec670a06fbbd336c3a6d29c2a859`.
- F0144 profile metrics SHA256: `da4404d8cd00e10fc1dcf179637732b184ce95bcee548408bea9d888c88b708a`.

The existing public package is locally available as `/tmp/matrix-pair-F0106.pdf` (139 pages), `/tmp/matrix-pair-F0141.pdf` (32 pages), `/tmp/matrix-pair-F0144.pdf` (14 pages), with adjacent `.text.json` canonical references. Provenance is documented in `MATRIX_REAL_PAIR_EVIDENCE_20261017.md`. This note does not infer a new real PD/RD pair or alter prior qualification decisions.

Recommendation: implement the narrow aggregator override after the runtime owner's active acceptance checks, preserve normal cache fingerprinting, then accept only after focused geometry regressions and canonical public replay. Leave `render_image`, figures, interpreter, layout parameters and concurrency unchanged in that patch. Keep the known nested-Form text omission explicit. These experiments establish a useful bounded optimization and exact preservation on the tested PDFs; they do not prove universal equality for every malformed or unsupported PDF.


## Runtime implementation and acceptance, 2026-10-18

The research above is historical. The narrow local `VisiblePageAggregator.paint_path` override is now implemented and accepted, source SHA `9f37be960de31044d71f57e29a3680168d71e82920fe055723e733f31a9269d9`. RED/GREEN regressions cover the actual subclass and allocations, all four rotations, shifted/cropped pages, vector/image-only OCR disposition, forms and repeated extraction: 11 focused methods PASS. Full check: 1973 PASS / 99 skipped; PostgreSQL: 46 PASS. Full original objects across 212 public pages equal; F0154 additionally remains byte-identical.

Actual homeserver pair used one pinned new document-worker image and separately mounted exact prepatch source for the baseline, one CPU, 2304 MiB, no network/GPU, 420-second limit. Old/new wall 343.445/261.990 seconds, CPU 343.101/261.778, max RSS 1903792/295688 KiB. In this single pair wall reduced23.717%, CPU23.702%, max RSS84.468%. Both outputs fully and byte-identically match the original F0154 reference. This is a source-pair comparison, not an old-image/new-image comparison or a statistical guarantee. Bytecode isolation and loaded-source guards are recorded in the receipt.

Four Python roles now use the new source. Actual new public F0154 check `CHK-4D0465FE` completed PARTIAL/100 in415.085seconds including downstream OCR/model stages. Its new-source cache key was absent before extraction, valid afterward. All27original page text/geometry/quality objects match the unchanged reference. Adapter does not emit cache-hit status; no runtime MISS log is claimed. Read-only browser1440/768/375 passed six screenshots and both original-line frames, zero project writes/errors. Seven roles restarted after zero-active-run preflight;30machine/submission/history snapshots and one saved local registration unchanged. Registry remains53parameters/61atoms/79unsupported; unknown approvals and uncalibrated probability remain unchanged.

Authoritative acceptance: `output/matrix-t25-20261018/acceptance.json`. T28 proceeds with a separate versioned project-constraint artifact.
