"""Pure, review-only affine calibration of one visible PDF page to a declared 2D frame.

This module checks arithmetic and caller-pinned bounds. It cannot authenticate a
control point, PDF, rendered image, local grid, CRS, datum, or object identity.
No result from this module is a positive geometry fact.
"""

from __future__ import annotations

import math
import re
from typing import Any


SCHEMA_VERSION = "geometry-registration-v1"
MAX_CONTROL_POINTS = 32
MAX_QUERY_POINTS = 128
_SHA = re.compile(r"^[0-9a-f]{64}$")


def _number(value: Any, label: str, *, positive: bool = False) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e12:
        raise ValueError(f"invalid {label}")
    number = float(value)
    if positive and number <= 0:
        raise ValueError(f"invalid {label}")
    return number


def _pair(value: Any, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"invalid {label}")
    return _number(value[0], label), _number(value[1], label)


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or value.strip() != value:
        raise ValueError(f"invalid {label}")
    return value


def _keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"invalid {label} fields")
    return value


def _cross(origin: tuple[float, float], first: tuple[float, float],
           second: tuple[float, float]) -> float:
    return ((first[0] - origin[0]) * (second[1] - origin[1])
            - (first[1] - origin[1]) * (second[0] - origin[0]))


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    ordered = sorted(points)
    lower: list[tuple[float, float]] = []
    upper: list[tuple[float, float]] = []
    for point in ordered:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= 1e-12:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= 1e-12:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _in_hull(point: tuple[float, float], hull: list[tuple[float, float]]) -> bool:
    return all(_cross(hull[index], hull[(index + 1) % len(hull)], point) >= -1e-10
               for index in range(len(hull)))


def _singular_values(a: float, b: float, d: float, e: float) -> tuple[float, float]:
    # Stable 2x2 singular values from column norms and determinant.
    trace = a * a + b * b + d * d + e * e
    discriminant = math.sqrt(max(0.0, trace * trace - 4 * (a * e - b * d) ** 2))
    maximum = math.sqrt(max(0.0, (trace + discriminant) / 2))
    minimum = abs(a * e - b * d) / maximum if maximum else 0.0
    return minimum, maximum


def validate_geometry_registration_v1(
    packet: dict[str, Any], *, expected_source_sha256: str,
    expected_render_sha256: str | None = None,
) -> dict[str, Any]:
    """Validate a pinned 3-point affine fit against every independent holdout.

    Caller must independently authenticate original PDF SHA, control-point
    identities/locations, source page frame, target frame, units, orientation,
    scale bounds, and residual tolerance. Arithmetic alone cannot do that.
    """
    data = _keys(packet, {"schemaVersion", "source", "pageFrame", "targetFrame",
                          "controlPoints", "trainingPointIds",
                          "maxHoldoutResidualProjectUnits", "queryPoints"}, "packet")
    if data["schemaVersion"] != SCHEMA_VERSION:
        raise ValueError("unsupported registration schema")
    source = _keys(data["source"], {"sourceSha256", "pdfPageNumber"}, "source")
    if not isinstance(expected_source_sha256, str) or not _SHA.fullmatch(expected_source_sha256) \
            or source["sourceSha256"] != expected_source_sha256:
        raise ValueError("source SHA mismatch")
    if type(source["pdfPageNumber"]) is not int or not 1 <= source["pdfPageNumber"] <= 10_000:
        raise ValueError("invalid PDF page number")

    page = _keys(data["pageFrame"], {"coordinateSpace", "width", "height", "rotate",
                                     "renderSha256"}, "page frame")
    space = page["coordinateSpace"]
    if space not in ("CANONICAL_VISIBLE_NORMALIZED", "RASTER_PIXEL"):
        raise ValueError("unsupported page coordinate space")
    width = _number(page["width"], "page width", positive=True)
    height = _number(page["height"], "page height", positive=True)
    if space == "CANONICAL_VISIBLE_NORMALIZED" and (width != 1 or height != 1):
        raise ValueError("normalized page frame must be unit square")
    if space == "RASTER_PIXEL" and (not width.is_integer() or not height.is_integer()
                                    or width * height > 100_000_000):
        raise ValueError("invalid raster dimensions")
    if type(page["rotate"]) is not int or page["rotate"] not in (0, 90, 180, 270):
        raise ValueError("invalid page rotation")
    render_sha = page["renderSha256"]
    if space == "RASTER_PIXEL" and (not isinstance(expected_render_sha256, str)
                                    or not _SHA.fullmatch(expected_render_sha256)
                                    or render_sha != expected_render_sha256):
        raise ValueError("render SHA mismatch or missing independent expected SHA")
    if space != "RASTER_PIXEL" and (render_sha is not None or expected_render_sha256 is not None):
        raise ValueError("render SHA inconsistent with normalized frame")

    target = _keys(data["targetFrame"], {"kind", "frameId", "unit", "xAxis", "yAxis",
                                         "minScale", "maxScale"}, "target frame")
    if target["kind"] not in ("LOCAL_2D", "PROJECTED_CRS"):
        raise ValueError("invalid target frame kind")
    frame_id = _string(target["frameId"], "target frame ID")
    unit = _string(target["unit"], "target unit")
    if unit not in ("m", "mm", "cm", "ft", "in"):
        raise ValueError("unsupported target unit")
    if target["xAxis"] != "RIGHT":
        raise ValueError("invalid target x axis")
    if target["yAxis"] not in ("UP", "DOWN"):
        raise ValueError("invalid target y axis")
    min_scale = _number(target["minScale"], "minimum scale", positive=True)
    max_scale = _number(target["maxScale"], "maximum scale", positive=True)
    if min_scale >= max_scale:
        raise ValueError("ambiguous scale bounds")
    tolerance = _number(data["maxHoldoutResidualProjectUnits"],
                        "holdout tolerance", positive=True)

    raw_controls = data["controlPoints"]
    if not isinstance(raw_controls, list) or not 4 <= len(raw_controls) <= MAX_CONTROL_POINTS:
        raise ValueError("at least four bounded control points required")
    controls: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {}
    refs: dict[str, str] = {}
    for raw in raw_controls:
        control = _keys(raw, {"id", "evidenceRef", "page", "project"}, "control point")
        point_id = _string(control["id"], "control point ID")
        if point_id in controls:
            raise ValueError("duplicate control point ID")
        evidence_ref = _string(control["evidenceRef"], "control evidence ref")
        page_point = _pair(control["page"], "control page coordinate")
        project_point = _pair(control["project"], "control project coordinate")
        if not 0 <= page_point[0] <= width or not 0 <= page_point[1] <= height:
            raise ValueError("control point outside page frame")
        if any(page_point == existing[0] or project_point == existing[1]
               for existing in controls.values()):
            raise ValueError("duplicate control point coordinates")
        controls[point_id] = (page_point, project_point)
        refs[point_id] = evidence_ref

    training_ids = data["trainingPointIds"]
    if not isinstance(training_ids, list) or len(training_ids) != 3 \
            or any(not isinstance(item, str) for item in training_ids) \
            or len(set(training_ids)) != 3 or any(item not in controls for item in training_ids):
        raise ValueError("invalid pinned training point IDs")
    holdout_ids = [point_id for point_id in controls if point_id not in training_ids]
    first, second, third = (controls[item] for item in training_ids)
    p0, p1, p2 = (tuple((point[0][0] / width, point[0][1] / height))
                  for point in (first, second, third))
    denominator = _cross(p0, p1, p2)
    if abs(denominator) <= 1e-10:
        raise ValueError("degenerate training triangle")
    q0, q1, q2 = (point[1] for point in (first, second, third))
    # Solve in normalized page coordinates, with project origin subtracted.
    u1, v1 = p1[0] - p0[0], p1[1] - p0[1]
    u2, v2 = p2[0] - p0[0], p2[1] - p0[1]
    a_normal = ((q1[0] - q0[0]) * v2 - (q2[0] - q0[0]) * v1) / denominator
    b_normal = (u1 * (q2[0] - q0[0]) - u2 * (q1[0] - q0[0])) / denominator
    d_normal = ((q1[1] - q0[1]) * v2 - (q2[1] - q0[1]) * v1) / denominator
    e_normal = (u1 * (q2[1] - q0[1]) - u2 * (q1[1] - q0[1])) / denominator
    a, b, d, e = a_normal / width, b_normal / height, d_normal / width, e_normal / height
    c = q0[0] - a * first[0][0] - b * first[0][1]
    f = q0[1] - d * first[0][0] - e * first[0][1]
    determinant = a * e - b * d
    if not all(math.isfinite(value) for value in (a, b, c, d, e, f, determinant)):
        raise ValueError("non-finite affine transform")
    if (determinant < 0) != (target["yAxis"] == "UP"):
        raise ValueError("mirror relative to declared target orientation")
    smallest, largest = _singular_values(a, b, d, e)
    if not min_scale <= smallest <= largest <= max_scale:
        raise ValueError("affine scale outside caller-pinned bounds")
    inverse = [e / determinant, -b / determinant, (b * f - e * c) / determinant,
               -d / determinant, a / determinant, (d * c - a * f) / determinant]
    if not all(math.isfinite(value) for value in inverse):
        raise ValueError("non-finite inverse transform")

    def forward(point: tuple[float, float]) -> tuple[float, float]:
        return a * point[0] + b * point[1] + c, d * point[0] + e * point[1] + f

    def backward(point: tuple[float, float]) -> tuple[float, float]:
        return (inverse[0] * point[0] + inverse[1] * point[1] + inverse[2],
                inverse[3] * point[0] + inverse[4] * point[1] + inverse[5])

    holdouts = []
    for point_id in holdout_ids:
        page_point, project_point = controls[point_id]
        residual = math.dist(forward(page_point), project_point)
        if not math.isfinite(residual) or residual > tolerance:
            raise ValueError("holdout residual exceeds caller-pinned tolerance")
        holdouts.append({"id": point_id, "evidenceRef": refs[point_id],
                         "residualProjectUnits": residual})

    hull = _hull([(point[0][0] / width, point[0][1] / height)
                  for point in controls.values()])
    queries = data["queryPoints"]
    if not isinstance(queries, list) or len(queries) > MAX_QUERY_POINTS:
        raise ValueError("invalid query points")
    query_results = []
    for raw in queries:
        point = _pair(raw, "query point")
        if not 0 <= point[0] <= width or not 0 <= point[1] <= height \
                or not _in_hull((point[0] / width, point[1] / height), hull):
            raise ValueError("query point outside calibration domain")
        query_results.append({"page": list(point), "project": list(forward(point))})
    roundtrip_points = [item[0] for item in controls.values()] + [tuple(item["page"])
                                                               for item in query_results]
    max_roundtrip = max(math.dist(backward(forward(point)), point)
                        for point in roundtrip_points)
    if not math.isfinite(max_roundtrip) or max_roundtrip > 1e-8 * max(width, height):
        raise ValueError("numeric roundtrip failed")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "REVIEW_ONLY",
        "reasonCode": "AUTHENTICATED_REGISTRATION_PENDING",
        "source": dict(source),
        "pageFrame": dict(page),
        "targetFrame": {"kind": target["kind"], "frameId": frame_id, "unit": unit,
                        "xAxis": target["xAxis"], "yAxis": target["yAxis"], "minScale": min_scale,
                        "maxScale": max_scale},
        "trainingPointIds": list(training_ids),
        "holdouts": holdouts,
        "maxHoldoutResidualProjectUnits": max(item["residualProjectUnits"] for item in holdouts),
        "holdoutToleranceProjectUnits": tolerance,
        "maxRoundtripPageUnits": max_roundtrip,
        "forwardMatrix": [a, b, c, d, e, f],
        "inverseMatrix": inverse,
        "determinant": determinant,
        "scaleRangeProjectUnitsPerPageUnit": [smallest, largest],
        "calibrationDomainPage": [[x * width, y * height] for x, y in hull],
        "queryPoints": query_results,
        "facts": [],
    }
