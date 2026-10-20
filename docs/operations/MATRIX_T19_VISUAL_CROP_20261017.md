# T19: versioned displayed-coordinate visual crops

## Implemented boundary

`red-vector-proposals-v8-sample` and `red-vector-proposals-v8-full` use adapter
version `8`, analysis/profile schema `v8` and the explicit crop method
`normalized-display-square-v2`. They retain V7 models, prompts, page/proposal
budgets, SAMPLE/FULL selection and progress semantics. The scanner still receives
`profile_version="v7"`; proposal geometry and document-context extraction are
unchanged. Results remain unverified proposals and separate model hints.

Pinned canonical profile hashes:

- V8 SAMPLE: `9f9d6a4c9b67a89309b1163711507d11411bdeb29393dcdcb62f15747aac4bcd`.
- V8 FULL: `b6c559590a69e0e4ff2018fcfe7f9389c98ab0080bf32373ba24de6a9a441476`.
- V7 SAMPLE, unchanged: `5c8d419817da3e200afc18ff82e8feb0656fed6151d3bc0c7632b0c00babbcf3`.
- V7 FULL, unchanged: `84ea95857ca44def8f5c6a5fac74fbbee8d8ffd03b0367497262fe2c4a6e72fd`.

V1–V7 profile values/hashes remain unchanged. `observe_proposals` defaults to
`normalized-derotated-square-v1`, retaining the historical rendering path for old
releases. V8 explicitly passes the new method. `render_crop` defaults to the new
method and accepts the legacy method explicitly; unknown methods fail closed.
The new profile hash supplies a different existing cache namespace even when
unrotated crop bytes are identical. No old observation or snapshot is rewritten.

## Cause and coordinate contract

Proposal boxes already use normalized displayed page coordinates. The renderer
expands them to the same bounded square as before. In PyMuPDF `1.27.2.2`,
`Page.get_pixmap` clips its rotated display list in displayed coordinates relative
to `page.rect`. Applying `page.derotation_matrix` again moved rotated crops to
another location or outside the displayed page. Adding CropBox offsets would also
be incorrect for this call.

The new path passes that displayed square directly to `get_pixmap`. Existing
normalized-box, page, scale, pixel-dimension and PNG-byte guards remain active.
The nominal edge is unchanged: 768 pixels by default, 2048 for V7/V8, with the
existing four-pixel raster-rounding allowance and 2 MiB PNG limit.

This narrow contract is supported by the actual pinned runtime and independent
raster tests. The official [partial pixmap recipe](https://pymupdf.readthedocs.io/en/latest/recipes-images.html#how-to-create-partial-pixmaps-clips)
constructs the clip from `page.rect`; [`Page.get_pixmap`](https://pymupdf.readthedocs.io/en/latest/page.html#Page.get_pixmap)
documents page rotation behavior. The general page-coordinate guidance must not
be used to derotate this display-list clip a second time.

## Repeatable semantic tests

`services/worker/tests/test_visual_crop_v8.py` generates its own PDFs without
external data or additional dependencies. Each visible page contains a unique
10×30-point red marker, an adjacent blue marker and a distant green decoy.
The eight cases cover rotations 0/90/180/270 both with an ordinary page and with
MediaBox 600×500 / CropBox `[50,40,450,340]`.

Marker coordinates after rotation use explicit quarter-turn arithmetic, without
the production renderer's matrices. The expected crop is a fixed 120-point square
around the marker. At 768 pixels, all eight crops retain exactly 12,288 red and
2,244 blue pixels, exclude the green decoy, and match an independently cropped
full-page raster at every interior pixel. The one-pixel clip boundary is excluded
from byte comparison to avoid antialiasing at the clip boundary.

The initial RED run failed on all six rotated cases: their PNGs were valid and
bounded, but their content missed the target. Additional tests preserve legacy
render bytes, unrotated equality, default legacy observation behavior, strict
method selection, invalid input/PNG/pixel bounds, release pins, actual adapter
forwarding, FULL truncation rejection and cache isolation across profile hashes.

Focused command:

```sh
PYTHONPATH=services/worker:services/worker/tests services/worker/.venv/bin/python \
  -m unittest test_visual_crop_v8 test_visual_vlm test_visual_proposal_adapter test_feedback_modes
```

Result: **31 tests passed**. This includes eight independent raster cases inside
one parameterized unittest, not eight extra reported test methods.

## Real public-source replay

The replay used participant-public source F0126 only:

- Local original: `/tmp/matrix-sidewalk-F0126.pdf`, 7,676,220 bytes, 23 pages.
- SHA-256: `b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088`.
- Saved input: `/tmp/matrix-t19-visual-proposals.json`, 33 geometric proposals.
- Diagnostic direct-render oracle: `/tmp/matrix-t19-render-diagnosis/real-results.json`.
- Runtime replay: `/tmp/matrix-t19-v8-real-replay.json`.
- Replay SHA-256: `60376a8ada499558653404726aaa27a18dae5a8dffbe2fa69f9a7852123d42d0`.

All 33 V8 crops matched the prior independent direct-render oracle by PNG SHA-256
and contained their expected red/blue geometry. The legacy path reproduced all
33 frozen outcomes: 13 `CROP_RENDER_ERROR` and 20 rendered crops, including the
wrong-location strips on rotated pages. All 11 unrotated legacy/V8 PNGs were byte
identical. Largest new PNG: 1,500,052 bytes; largest edge: 2049 pixels, within the
existing 2048+4 allowance. The PDF and proposal input stayed unchanged.

No VLM inference was called. All 33 new observation records therefore remain
`ABSTAIN` / `ENDPOINT_NOT_CONFIGURED`; successful crop rendering supplies no
radiator identity, calibrated probability, verified finding or parameter coverage.
The colored geometry in F0126 belongs to a landscape drawing and is only a
coordinate-retention check. No hidden labels or organizer answers were accessed.

## Acceptance still owned by the parent integration packet

Verify V8 API/release validation, durable result retention and browser selection
on the ordinary homeserver. Verify an actual local model call separately if
model availability is part of that run. These Python/raster checks do not prove
provider availability, semantic classification accuracy or browser behavior.
