"""Whole original PDF lines, including explicitly unlocated geometry.

Contract: packages/contracts/src/document-text-v3.schema.json.  This module
does not coerce v3 into v2, alter the legacy producer, or authenticate a release.
Historical profiles are integrity data; admission must compare the release tuple.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import re
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any

_MAX = 9007199254740991
_SHA = re.compile(r"[a-f0-9]{64}\Z", re.ASCII)
_DECIMAL = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?\Z", re.ASCII)
_CID = re.compile(r"\(cid:[0-9]+\)", re.ASCII)
_WS = frozenset((*range(9, 14), *range(28, 33), 0x85, 0xA0, 0x1680,
                 *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000))
_TOP_LEVEL = "pdfminer-top-level-whole-lines-v1"
_ANALYZED_FIGURES = "pdfminer-analyzed-figures-whole-lines-v1"
_STABLE_FIGURES = "pdfminer-analyzed-figures-boxes-flow-none-v1"
_VERTICAL_FIGURES = "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
_STANDARD_RESOURCE_POLICY = "document-text-v3-standard-bounds-v1"
_LARGE_RESOURCE_POLICY = "document-text-v3-large-source-bounds-v1"
_PROFILE_CONSTANTS = {
    "schemaVersion": "document-text-extractor-profile-v1",
    "pdfminerVersion": "20260107",
    "geometryPolicyVersion": "document-text-v3-decimal-half-even-v1",
    "cropPolicyVersion": "visible-crop-contained-epsilon-1e-6-v1",
    "traversalPolicyVersion": _TOP_LEVEL,
    "qualityPolicyVersion": "document-text-quality-v3",
}


class _Invalid(ValueError):
    pass


def _bad(code: str = "INVALID_TEXT_ARTIFACT") -> None:
    raise _Invalid(code)


def _traversal(value: Any) -> str:
    if type(value) is not str or value not in (_TOP_LEVEL, _ANALYZED_FIGURES, _STABLE_FIGURES, _VERTICAL_FIGURES):
        raise ValueError("EXTRACTOR_PROFILE_MISMATCH")
    return value


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _resource_bounds(policy: Any) -> tuple[int, int]:
    """Only explicit finite policies; validate selector before inspecting input."""
    if type(policy) is not str:
        _bad("INVALID_INPUT")
    if policy == _STANDARD_RESOURCE_POLICY:
        return 8000000, 200000
    if policy == _LARGE_RESOURCE_POLICY:
        return 32000000, 1400000
    _bad("INVALID_INPUT")


def _native(value: Any) -> None:
    """Historical standard guard; no implicit larger-source fallback."""
    _native_for_policy(value, _STANDARD_RESOURCE_POLICY)


def _native_for_policy(value: Any, policy: str) -> None:
    """Exact builtins only: no user iteration, getters, conversions or serializers."""
    max_bytes, max_nodes = _resource_bounds(policy)
    active: set[int] = set()
    nodes = 0

    def walk(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > max_nodes or depth > 64:
            _bad("INPUT_LIMIT")
        kind = type(item)
        if kind is str:
            if len(item) > 2000000:
                _bad("INPUT_LIMIT")
            if any(0xD800 <= ord(c) <= 0xDFFF for c in item):
                _bad("INVALID_INPUT")
        elif kind is int:
            if abs(item) > _MAX:
                _bad("INVALID_INPUT")
        elif kind is bool or item is None:
            return
        elif kind is list or kind is dict:
            if len(item) > 32768:
                _bad("INPUT_LIMIT")
            ident = id(item)
            if ident in active:
                _bad("INVALID_INPUT")
            active.add(ident)
            if kind is list:
                for child in item:
                    walk(child, depth + 1)
            else:
                for key, child in dict.items(item):
                    if type(key) is not str:
                        _bad("INVALID_INPUT")
                    walk(key, depth + 1)
                    walk(child, depth + 1)
            active.remove(ident)
        else:
            _bad("INVALID_INPUT")

    walk(value, 0)
    if len(_canonical(value).encode("utf-8")) > max_bytes:
        _bad("INPUT_LIMIT")


def _keys(value: Any, keys: str) -> None:
    if type(value) is not dict or set(value) != set(keys.split()):
        _bad()


def _integer(value: Any, low: int = 0, high: int = _MAX) -> None:
    if type(value) is not int or not low <= value <= high:
        _bad()


def _sha(value: Any) -> None:
    if type(value) is not str or not _SHA.fullmatch(value):
        _bad()


def _source_id(value: Any) -> None:
    if (type(value) is not str or not 1 <= len(value) <= 200
            or value.strip() != value
            or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value)):
        _bad()


def _number(value: Any) -> Fraction:
    if type(value) is not str or not 1 <= len(value) <= 64 or not _DECIMAL.fullmatch(value):
        _bad()
    if "e" in value and not -324 <= int(value.split("e")[1]) <= 308:
        _bad()
    result = Fraction(Decimal(value))
    if abs(result) > 1000000000:
        _bad()
    return result


def _box(value: Any) -> tuple[Fraction, ...]:
    if type(value) is not list or len(value) != 4:
        _bad()
    box = tuple(_number(n) for n in value)
    if box[0] > box[2] or box[1] > box[3]:
        _bad()
    return box


def _positive(box: tuple[Fraction, ...]) -> bool:
    return box[0] < box[2] and box[1] < box[3]


def _contained(box: tuple[Fraction, ...], frame: tuple[Fraction, ...]) -> bool:
    epsilon = Fraction(1, 1000000)
    return (box[0] >= frame[0] - epsilon and box[1] >= frame[1] - epsilon
            and box[2] <= frame[2] + epsilon and box[3] <= frame[3] + epsilon)


def _quantized(box: tuple[Fraction, ...], frame: tuple[Fraction, ...], width: int,
               height: int) -> list[int]:
    return [max(0, min(width if i % 2 == 0 else height,
                       round((n - frame[i % 2]) * 1000))) for i, n in enumerate(box)]


def _hash(domain: str, key: str, value: Any) -> str:
    return hashlib.sha256(_canonical({"hashDomain": domain, key: value}).encode("utf-8")).hexdigest()


def _quality(located: list[dict], unlocated: list[dict]) -> dict:
    located_raw = [line["rawText"] for line in located]
    unlocated_raw = [line["rawText"] for line in unlocated]
    all_raw = located_raw + unlocated_raw
    metrics = {
        "locatedLineCount": len(located), "unlocatedLineCount": len(unlocated),
        "locatedNonWhitespaceCharacters": sum(ord(c) not in _WS for s in located_raw for c in s),
        "unlocatedNonWhitespaceCharacters": sum(ord(c) not in _WS for s in unlocated_raw for c in s),
        "replacementCharacters": sum(s.count("\ufffd") for s in all_raw),
        "disallowedControlCharacters": sum((ord(c) < 32 and ord(c) not in (9, 10, 13))
                                            or 127 <= ord(c) <= 159 for s in all_raw for c in s),
        "cidPlaceholders": sum(len(_CID.findall(s)) for s in all_raw),
    }
    reasons = []
    if not metrics["locatedNonWhitespaceCharacters"]:
        reasons.append("NO_LOCATED_TEXT")
    if any(metrics[k] for k in ("replacementCharacters", "disallowedControlCharacters", "cidPlaceholders")):
        reasons.append("TEXT_DECODING_ANOMALY")
    if unlocated:
        reasons.append("UNLOCATED_TEXT_PRESENT")
    disposition = ("OCR_REQUIRED" if any(r in reasons for r in ("NO_LOCATED_TEXT", "TEXT_DECODING_ANOMALY"))
                   else "PARTIAL_TEXT_LAYER" if unlocated else "TEXT_LAYER_CANDIDATE")
    return {"disposition": disposition, "reasonCodes": reasons, "metrics": metrics}


def _validate(value: Any) -> None:
    _validate_for_policy(value, _STANDARD_RESOURCE_POLICY)


def _validate_for_policy(value: Any, policy: str) -> None:
    _native_for_policy(value, policy)
    # Actual retained pages are a whole-envelope budget, even when another
    # field is malformed. Do not defer this to the pageCount schema check.
    if type(value) is dict and type(value.get("pages")) is list and len(value["pages"]) > 512:
        _bad("INPUT_LIMIT")
    # Large-source admission counts retained record lists before semantic
    # structure. The historical standard precedence remains unchanged.
    if policy == _LARGE_RESOURCE_POLICY and type(value) is dict and type(value.get("pages")) is list:
        retained_records = 0
        for page in value["pages"]:
            if type(page) is dict:
                for key in ("locatedLines", "unlocatedLines"):
                    if type(page.get(key)) is list:
                        retained_records += len(page[key])
                        if retained_records > 100000:
                            _bad("INPUT_LIMIT")
    _keys(value, "schemaVersion sourceFileId inputSha256 coordinateSystem pageCount locatedTextPageCount "
                 "unlocatedTextPageCount extractorProfile extractorProfileHash qualitySummary pages")
    if value["schemaVersion"] != "document-text-v3" or value["coordinateSystem"] != "PDF_BOTTOM_LEFT_MILLI_POINTS":
        _bad()
    _source_id(value["sourceFileId"])
    _sha(value["inputSha256"])
    profile = value["extractorProfile"]
    _keys(profile, " ".join((*_PROFILE_CONSTANTS, "textLayerSourceSha256", "documentTextV3SourceSha256")))
    if any(profile[k] != v for k, v in _PROFILE_CONSTANTS.items() if k != "traversalPolicyVersion"):
        _bad()
    if profile["traversalPolicyVersion"] not in (_TOP_LEVEL, _ANALYZED_FIGURES, _STABLE_FIGURES, _VERTICAL_FIGURES):
        _bad()
    max_path = 2 if profile["traversalPolicyVersion"] == _TOP_LEVEL else 64
    _sha(profile["textLayerSourceSha256"])
    _sha(profile["documentTextV3SourceSha256"])
    if value["extractorProfileHash"] != _hash("document-text-extractor-profile-v1", "profile", profile):
        _bad()
    pages = value["pages"]
    _integer(value["pageCount"], 1, 512)
    if type(pages) is not list or len(pages) != value["pageCount"]:
        _bad()
    located_pages = unlocated_pages = records = 0
    summary = {"candidatePages": 0, "partialPages": 0, "ocrRequiredPages": 0}
    for number, page in enumerate(pages, 1):
        _keys(page, "pageNumber widthMilliPoints heightMilliPoints nativeFrame locatedLines unlocatedLines quality")
        _integer(page["pageNumber"], 1, 512)
        if page["pageNumber"] != number:
            _bad()
        _keys(page["nativeFrame"], "coordinateSystem visibleBoxPointStrings")
        if page["nativeFrame"]["coordinateSystem"] != "PDFMINER_LAYOUT_POINTS":
            _bad()
        frame = _box(page["nativeFrame"]["visibleBoxPointStrings"])
        if not _positive(frame):
            _bad()
        width, height = round((frame[2] - frame[0]) * 1000), round((frame[3] - frame[1]) * 1000)
        for key, expected in (("widthMilliPoints", width), ("heightMilliPoints", height)):
            _integer(page[key], 1)
            if page[key] != expected:
                _bad()
        paths = []
        for located, key in ((True, "locatedLines"), (False, "unlocatedLines")):
            lines = page[key]
            if type(lines) is not list:
                _bad()
            previous = None
            for line in lines:
                records += 1
                if records > 100000:
                    _bad("INPUT_LIMIT")
                _keys(line, "sourcePath rawText nativeBoxPointStrings "
                            + ("bboxMilliPoints" if located else "reasonCode"))
                path = line["sourcePath"]
                if type(path) is not list or not 1 <= len(path) <= max_path:
                    _bad()
                for index in path:
                    _integer(index, 0, 32767)
                path_tuple = tuple(path)
                if previous is not None and path_tuple <= previous:
                    _bad()
                previous = path_tuple
                paths.append(path_tuple)
                if type(line["rawText"]) is not str or not line["rawText"]:
                    _bad()
                box = _box(line["nativeBoxPointStrings"])
                if not _contained(box, frame):
                    _bad()
                quantized = _quantized(box, frame, width, height)
                area = quantized[0] < quantized[2] and quantized[1] < quantized[3]
                if located:
                    bbox = line["bboxMilliPoints"]
                    if type(bbox) is not list or len(bbox) != 4:
                        _bad()
                    for edge in bbox:
                        _integer(edge)
                    if not _positive(box) or not area or bbox != quantized:
                        _bad()
                elif line["reasonCode"] != ("MILLI_POINT_COLLAPSE" if _positive(box) else "NATIVE_ZERO_AREA"):
                    _bad()
                elif _positive(box) and area:
                    _bad()
        paths.sort()
        for before, after in zip(paths, paths[1:]):
            if after[:len(before)] == before:
                _bad()
        expected_quality = _quality(page["locatedLines"], page["unlocatedLines"])
        # Validate integer types separately: Python equality must not admit bool.
        _keys(page["quality"], "disposition reasonCodes metrics")
        _keys(page["quality"]["metrics"], " ".join(expected_quality["metrics"]))
        for metric in page["quality"]["metrics"].values():
            _integer(metric)
        if page["quality"] != expected_quality:
            _bad()
        located_pages += expected_quality["metrics"]["locatedNonWhitespaceCharacters"] > 0
        unlocated_pages += bool(page["unlocatedLines"])
        summary[{"TEXT_LAYER_CANDIDATE": "candidatePages", "PARTIAL_TEXT_LAYER": "partialPages",
                 "OCR_REQUIRED": "ocrRequiredPages"}[expected_quality["disposition"]]] += 1
    for key, expected in (("locatedTextPageCount", located_pages), ("unlocatedTextPageCount", unlocated_pages)):
        _integer(value[key], 0, 512)
        if value[key] != expected:
            _bad()
    _keys(value["qualitySummary"], "candidatePages partialPages ocrRequiredPages")
    for count in value["qualitySummary"].values():
        _integer(count, 0, 512)
    if value["qualitySummary"] != summary:
        _bad()


def read_document_text_v3_artifact(value: object) -> dict:
    try:
        _validate(value)
        return {"status": "VALID", "contentHash": _hash("document-text-v3-content-v1", "artifact", value)}
    except _Invalid as error:
        return {"status": "ABSTAIN", "reasonCode": str(error)}


def document_text_v3_content_hash(value: object) -> str:
    _validate(value)
    return _hash("document-text-v3-content-v1", "artifact", value)


def read_document_text_v3_large_artifact(value: object) -> dict:
    try:
        _validate_for_policy(value, _LARGE_RESOURCE_POLICY)
        return {"status": "VALID", "resourcePolicyVersion": _LARGE_RESOURCE_POLICY,
                "contentHash": _hash("document-text-v3-content-v1", "artifact", value)}
    except _Invalid as error:
        return {"status": "ABSTAIN", "resourcePolicyVersion": _LARGE_RESOURCE_POLICY,
                "reasonCode": str(error)}


def document_text_v3_large_content_hash(value: object) -> str:
    _validate_for_policy(value, _LARGE_RESOURCE_POLICY)
    return _hash("document-text-v3-content-v1", "artifact", value)


def get_document_text_v3_extractor_profile(*, traversal_policy_version: str = _TOP_LEVEL) -> dict:
    traversal = _traversal(traversal_policy_version)
    if importlib.metadata.version("pdfminer.six") != _PROFILE_CONSTANTS["pdfminerVersion"]:
        raise ValueError("EXTRACTOR_PROFILE_MISMATCH")
    profile = dict(_PROFILE_CONSTANTS)
    profile["traversalPolicyVersion"] = traversal
    profile["textLayerSourceSha256"] = hashlib.sha256(Path(__file__).with_name("text_layer.py").read_bytes()).hexdigest()
    profile["documentTextV3SourceSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return profile


def _stable_visible_pdf_layouts(path: Path, *, detect_vertical: bool = False) -> Any:
    """Explicit stable layout profile; historical visible-layout helper stays frozen.

    CropBox, interpreter CTM and vector elision mirror text_layer.py exactly.
    Only this policy selects pdfminer's boxes_flow=None native page order.
    """
    from pdfminer.converter import PDFPageAggregator
    from pdfminer.layout import LAParams
    from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
    from pdfminer.pdfpage import PDFPage
    from pdfminer.utils import apply_matrix_pt

    class VisiblePageAggregator(PDFPageAggregator):
        visible_bounds: tuple[float, float, float, float]

        def paint_path(self, gstate: Any, stroke: bool, fill: bool,
                       evenodd: bool, path: Any) -> None:
            # This artifact emits text containers only. Avoid allocating vector
            # marks while preserving the interpreter, figures and text CTM.
            return None

        def begin_page(self, page: Any, ctm: Any) -> None:
            super().begin_page(page, ctm)
            if page.rotate not in (0, 90, 180, 270):
                raise ValueError("unsupported PDF page rotation for visible text geometry")
            media = tuple(float(value) for value in page.mediabox)
            crop = tuple(float(value) for value in page.cropbox)
            if (not all(math.isfinite(value) for value in (*media, *crop))
                    or media[0] >= media[2] or media[1] >= media[3]
                    or crop[0] >= crop[2] or crop[1] >= crop[3]
                    or crop[0] < media[0] or crop[1] < media[1]
                    or crop[2] > media[2] or crop[3] > media[3]):
                raise ValueError("invalid PDF CropBox for visible text geometry")
            corners = [apply_matrix_pt(ctm, point) for point in (
                (crop[0], crop[1]), (crop[0], crop[3]),
                (crop[2], crop[1]), (crop[2], crop[3]),
            )]
            self.visible_bounds = (min(x for x, _ in corners), min(y for _, y in corners),
                                   max(x for x, _ in corners), max(y for _, y in corners))

    with path.open("rb") as source:
        manager = PDFResourceManager(caching=True)
        device = VisiblePageAggregator(manager, laparams=(
            LAParams(boxes_flow=None, detect_vertical=True) if detect_vertical
            else LAParams(boxes_flow=None)))
        interpreter = PDFPageInterpreter(manager, device)
        try:
            for page in PDFPage.get_pages(source, caching=True):
                interpreter.process_page(page)
                yield device.get_result(), device.visible_bounds
        finally:
            device.close()


def extract_pdf_text_artifact_v3(path: Path, source_file_id: str, input_sha256: str,
                                 *, traversal_policy_version: str = _TOP_LEVEL) -> dict:
    """Historical standard producer; no implicit larger-source fallback."""
    return _extract_pdf_text_artifact_v3_for_policy(
        path, source_file_id, input_sha256,
        traversal_policy_version=traversal_policy_version,
        resource_policy_version=_STANDARD_RESOURCE_POLICY)


def extract_pdf_text_artifact_v3_large(path: Path, source_file_id: str, input_sha256: str,
                                       *, traversal_policy_version: str = _TOP_LEVEL) -> dict:
    """Explicit larger whole-source admission; identical extraction semantics."""
    return _extract_pdf_text_artifact_v3_for_policy(
        path, source_file_id, input_sha256,
        traversal_policy_version=traversal_policy_version,
        resource_policy_version=_LARGE_RESOURCE_POLICY)


def _extract_pdf_text_artifact_v3_for_policy(
        path: Path, source_file_id: str, input_sha256: str, *,
        traversal_policy_version: str, resource_policy_version: str) -> dict:
    """Produce one record per original line; never repair or splice glyphs."""
    max_bytes, _ = _resource_bounds(resource_policy_version)
    from pdfminer.layout import LAParams, LTChar, LTContainer, LTFigure, LTTextContainer, LTTextLine
    from .text_layer import _visible_pdf_layouts

    traversal = _traversal(traversal_policy_version)
    _native_for_policy(source_file_id, resource_policy_version)
    _source_id(source_file_id)
    _sha(input_sha256)
    with Path(path).open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != input_sha256:
        raise ValueError("SOURCE_SHA256_MISMATCH")
    profile = get_document_text_v3_extractor_profile(traversal_policy_version=traversal)
    pages = []
    emitted_records = 0
    serialized_raw_bytes = 0

    def native_box(item: Any) -> tuple[list[str], tuple[Fraction, ...]]:
        try:
            numbers = (item.x0, item.y0, item.x1, item.y1)
            if not all(type(n) in (int, float) and math.isfinite(n) for n in numbers):
                raise ValueError()
            strings = [repr(float(n)) for n in numbers]
            return strings, _box(strings)
        except (ValueError, TypeError, OverflowError) as error:
            raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY") from error

    layouts = (_stable_visible_pdf_layouts(Path(path), detect_vertical=True)
               if traversal == _VERTICAL_FIGURES else
               _stable_visible_pdf_layouts(Path(path)) if traversal == _STABLE_FIGURES
               else _visible_pdf_layouts(Path(path)))
    for page_number, (layout, visible) in enumerate(layouts, 1):
        if page_number > 512:
            raise ValueError("INPUT_LIMIT")
        frame_strings = [repr(float(n)) for n in visible]
        frame = _box(frame_strings)
        width, height = round((frame[2] - frame[0]) * 1000), round((frame[3] - frame[1]) * 1000)
        if not _positive(frame) or not 0 < width <= _MAX or not 0 < height <= _MAX:
            raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY")
        page = {"pageNumber": page_number, "widthMilliPoints": width, "heightMilliPoints": height,
                "nativeFrame": {"coordinateSystem": "PDFMINER_LAYOUT_POINTS", "visibleBoxPointStrings": frame_strings},
                "locatedLines": [], "unlocatedLines": []}
        visited = 0

        if traversal in (_ANALYZED_FIGURES, _STABLE_FIGURES, _VERTICAL_FIGURES):
            # Library analysis recursively descends into nested figures. Bound
            # the original topology BEFORE invoking it, then analyze only the
            # outermost figures, once each. Native object budgets are separate
            # from the resulting JSON envelope's native-value budget.
            outermost = []
            figure_nodes = 0
            pending = [(layout, 0, False)]
            while pending:
                current, depth, in_figure = pending.pop()
                if depth > 64:
                    raise ValueError("INPUT_LIMIT")
                is_figure = isinstance(current, LTFigure)
                if is_figure and not in_figure:
                    outermost.append(current)
                in_figure = in_figure or is_figure
                if in_figure:
                    figure_nodes += 1
                    if figure_nodes > 200000:
                        raise ValueError("INPUT_LIMIT")
                if isinstance(current, LTContainer):
                    pending.extend((child, depth + 1, in_figure) for child in reversed(list(current)))
            for figure in outermost:
                figure.analyze(LAParams(all_texts=True, boxes_flow=None, detect_vertical=True)
                               if traversal == _VERTICAL_FIGURES else
                               LAParams(all_texts=True, boxes_flow=None)
                               if traversal == _STABLE_FIGURES else LAParams(all_texts=True))

        def unsupported(item: Any) -> None:
            nonlocal visited
            pending = [(item, 0)]
            while pending:
                current, depth = pending.pop()
                visited += 1
                if visited > 200000 or depth > 64:
                    raise ValueError("INPUT_LIMIT")
                if isinstance(current, (LTChar, LTTextContainer)):
                    _, box = native_box(current)
                    if box[2] >= frame[0] and box[0] <= frame[2] and box[3] >= frame[1] and box[1] <= frame[3]:
                        raise ValueError("UNSUPPORTED_TEXT_LAYOUT")
                if isinstance(current, LTContainer):
                    children = list(current)
                    if len(children) > 32768:
                        raise ValueError("INPUT_LIMIT")
                    pending.extend((child, depth + 1) for child in reversed(children))

        def emit(item: Any, source_path: list[int]) -> None:
            nonlocal emitted_records, serialized_raw_bytes
            if not 1 <= len(source_path) <= (2 if traversal == _TOP_LEVEL else 64) or any(i > 32767 for i in source_path):
                raise ValueError("INPUT_LIMIT")
            strings, box = native_box(item)
            positive = _positive(box)
            # LTAnno is a literal separator with no glyph bbox. Only LTChar
            # geometry participates; never apply the emitted millipoint gate to it.
            children = list(item) if isinstance(item, LTContainer) else []
            stack = [(child, 1) for child in children]
            while stack:
                child, depth = stack.pop()
                if depth > 64:
                    raise ValueError("INPUT_LIMIT")
                if isinstance(child, LTChar):
                    _, glyph_box = native_box(child)
                    if _positive(glyph_box) != positive:
                        raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY")
                elif isinstance(child, LTTextContainer):
                    raise ValueError("UNSUPPORTED_TEXT_LAYOUT")
                elif isinstance(child, LTContainer):
                    grandchildren = list(child)
                    stack.extend((grandchild, depth + 1) for grandchild in grandchildren)
            if not _contained(box, frame):
                return
            raw = item.get_text()
            if not raw:
                return
            if type(raw) is not str:
                raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY")
            if len(raw) > 2000000:
                raise ValueError("INPUT_LIMIT")
            # Bound allocations while building, then verify the complete JSON
            # envelope (including all keys/metadata/punctuation) at the end.
            emitted_records += 1
            serialized_raw_bytes += len(json.dumps(raw, ensure_ascii=False).encode("utf-8"))
            if emitted_records > 100000 or serialized_raw_bytes > max_bytes:
                raise ValueError("INPUT_LIMIT")
            record = {"sourcePath": source_path, "rawText": raw, "nativeBoxPointStrings": strings}
            bbox = _quantized(box, frame, width, height)
            if positive and bbox[0] < bbox[2] and bbox[1] < bbox[3]:
                record["bboxMilliPoints"] = bbox
                page["locatedLines"].append(record)
            else:
                record["reasonCode"] = "MILLI_POINT_COLLAPSE" if positive else "NATIVE_ZERO_AREA"
                page["unlocatedLines"].append(record)
            if len(page["locatedLines"]) > 32768 or len(page["unlocatedLines"]) > 32768:
                raise ValueError("INPUT_LIMIT")

        if traversal in (_ANALYZED_FIGURES, _STABLE_FIGURES, _VERTICAL_FIGURES):
            # Paths are exact analyzed native ancestry. Parent figure boxes
            # do not establish renderer clipping; only each whole line's
            # original geometry is tested against the page's visible CropBox.
            pending = [(element, [index]) for index, element in reversed(list(enumerate(layout)))]
            while pending:
                element, source_path = pending.pop()
                if len(source_path) > 64 or any(i > 32767 for i in source_path):
                    raise ValueError("INPUT_LIMIT")
                if isinstance(element, LTTextLine):
                    emit(element, source_path)
                elif isinstance(element, LTTextContainer):
                    _, parent_box = native_box(element)
                    children = list(element)
                    text_children = [child for child in children if isinstance(child, LTTextContainer)]
                    if text_children:
                        if not _positive(parent_box) and any(_positive(native_box(child)[1]) for child in text_children):
                            raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY")
                        pending.extend((child, source_path + [index])
                                       for index, child in reversed(list(enumerate(children))))
                    else:
                        emit(element, source_path)
                elif isinstance(element, LTContainer):
                    pending.extend((child, source_path + [index])
                                   for index, child in reversed(list(enumerate(element))))
                else:
                    unsupported(element)

        for top_index, element in enumerate(layout) if traversal == _TOP_LEVEL else ():
            if top_index > 32767:
                raise ValueError("INPUT_LIMIT")
            if isinstance(element, LTTextLine):
                emit(element, [top_index])
            elif isinstance(element, LTTextContainer):
                _, parent_box = native_box(element)
                children = list(element)
                lines = [(index, child) for index, child in enumerate(children) if isinstance(child, LTTextLine)]
                if lines:
                    for index, child in lines:
                        if index > 32767:
                            raise ValueError("INPUT_LIMIT")
                        if not _positive(parent_box) and _positive(native_box(child)[1]):
                            raise ValueError("INVALID_NATIVE_TEXT_GEOMETRY")
                        emit(child, [top_index, index])
                    for child in children:
                        if not isinstance(child, LTTextLine):
                            unsupported(child)
                else:
                    emit(element, [top_index])
            else:
                unsupported(element)
        page["quality"] = _quality(page["locatedLines"], page["unlocatedLines"])
        pages.append(page)
    summary = {"candidatePages": 0, "partialPages": 0, "ocrRequiredPages": 0}
    for page in pages:
        summary[{"TEXT_LAYER_CANDIDATE": "candidatePages", "PARTIAL_TEXT_LAYER": "partialPages",
                 "OCR_REQUIRED": "ocrRequiredPages"}[page["quality"]["disposition"]]] += 1
    artifact = {"schemaVersion": "document-text-v3", "sourceFileId": source_file_id, "inputSha256": input_sha256,
                "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS", "pageCount": len(pages),
                "locatedTextPageCount": sum(p["quality"]["metrics"]["locatedNonWhitespaceCharacters"] > 0 for p in pages),
                "unlocatedTextPageCount": sum(bool(p["unlocatedLines"]) for p in pages),
                "extractorProfile": profile,
                "extractorProfileHash": _hash("document-text-extractor-profile-v1", "profile", profile),
                "qualitySummary": summary, "pages": pages}
    _validate_for_policy(artifact, resource_policy_version)
    return artifact
