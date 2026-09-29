# Geometry registration v1: pure review-only calibration

28.09.2026. Scope: numerical precursor for the nine `BOUNDARY_OVERLAY` and four
`COORDINATE_ALIGNMENT` unresolved rules in
[geometry evidence plan](GEOMETRY_EVIDENCE_PIPELINE_PLAN_20260928.md). No rule
evaluation, persistence, API, Compose, release, save, seal, GET, or UI wiring.

`validate_geometry_registration_v1(packet, expected_source_sha256=...)` in
`services/worker/inspector_worker/geometry_registration_v1.py` accepts one PDF
page and one declared 2D target frame. Input must contain 4–32 control point
correspondences with unique IDs and evidence references. Three explicitly named
points fit the affine transform; every other point is an independent holdout.
There is no automatic search for a favorable training triple. Coordinates are
either canonical visible normalized page coordinates (`[0,1]`, top-left,
`x` right, `y` down) or pixels in a SHA-named raster render. The latter requires
exact integer dimensions. The source PDF SHA must match a separately supplied
expected SHA. Raster render SHA likewise must match an independently supplied
expected render SHA. Rotation is retained as page-frame metadata; caller supplies
coordinates *after* CropBox/Rotate, so registration never rotates them again.

Target frame must declare `LOCAL_2D` or `PROJECTED_CRS`, a frame ID, unit
(`m`, `mm`, `cm`, `ft`, `in`), `xAxis=RIGHT`, `yAxis=UP|DOWN`, and caller-pinned
minimum and maximum project units per page unit. The caller also supplies
`maxHoldoutResidualProjectUnits`. No universal engineering tolerance is
embedded. Validator rejects collinear or ill-conditioned training points,
duplicate coordinates, unexpected mirror orientation, scale outside supplied
bounds, failed holdouts, invalid inverse roundtrip, and query points outside
both page and convex hull of all control points. Output includes matrices,
holdout residuals, singular-value scale range, calibration hull, checked query
transforms, and always `status=REVIEW_ONLY`,
`reasonCode=AUTHENTICATED_REGISTRATION_PENDING`, `facts=[]`.

The source and raster SHA comparisons catch mismatched packets but do not hash
PDF or PNG bytes. Page dimensions are checked for shape and bounds, not
independently reproduced here. Evidence references and frame IDs are labels,
not authentication. A changed set of self-consistent control points, false
CRS, wrong ground points, wrong floor/phase/object, or a loose caller tolerance
can still yield a numerically valid transform. The caller must bind the PDF,
exact render/page-frame, control-point decisions, frame/CRS/datum, units,
orientation, scale bounds and tolerance to authenticated evidence before any
durable registration. A local 2D transform does not establish world CRS or
vertical datum. No contour class, boundary, distance, area, absence, coverage,
or subject finding follows from this numerical result. The 13 rules remain
`ABSTAIN` until those separate gates and approved comparable sources exist.

Focused verification: seven `unittest` cases cover five-point fit, two
independent holdouts, normalized and synthetic rotated raster frames,
roundtrip, source/point/render tamper, mirror, unit/scale ambiguity,
degeneracy, missing tolerance/training selection, and out-of-domain queries.
They exercise pure arithmetic only; no actual PDF image or authenticated point
set was supplied.
