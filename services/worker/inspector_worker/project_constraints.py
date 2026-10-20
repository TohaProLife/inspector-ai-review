"""Source-bound author-project constraints; evidence only, never exact measures.

First grammar is the complete adopted door-width sentence observed on public
F0151 PDF22. Source IDs/hashes are deliberately not grammar conditions. All four
original single-line blocks and the unused tail of the fourth are retained.
No approval, entity, normative applicability, comparisons or coverage is inferred.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any

EXTRACTOR_VERSION = "matrix-project-bound-prose-v1"
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_NUMBER = r"(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?"
_VALUE_LINE = re.compile(
    r"лестничные клетки и в лифтовые холлы принята не менее "
    r"(?P<value>" + _NUMBER + r") м в свету при\Z")
_FIRST = "ширина дверных проемов в стенах и перегородках, через которые"
_SECOND = "может передвигаться инвалид на кресле-коляске, а также выходов на"
_END = re.compile(r"\Aоткрытом[ \t\u00a0\u202f]+дверном[ \t\u00a0\u202f]+полотне\.")
_TAIL = "Дверные проемы либо не имеют порогов, либо"
_MAX_SAFE_INTEGER = 2**53 - 1


def _json_tree(value: Any, depth: int = 0, ancestors: frozenset[int] = frozenset()) -> None:
    """Portable hash inputs: ASCII object keys, Unicode scalar strings, safe ints.

    No float coordinates or float serialization enters these hash domains.
    This is intentionally separate from existing locale-sorted API canonical JSON.
    """
    if depth > 64:
        raise ValueError("project constraint JSON exceeds depth limit")
    if value is None or type(value) is bool:
        return
    if type(value) is int and abs(value) <= _MAX_SAFE_INTEGER:
        return
    if type(value) is str and not any(0xD800 <= ord(c) <= 0xDFFF for c in value):
        return
    if type(value) not in (dict, list) or id(value) in ancestors:
        raise ValueError("project constraint JSON is not portable")
    next_ancestors = ancestors | {id(value)}
    if type(value) is dict:
        if any(type(k) is not str or not k.isascii() for k in value):
            raise ValueError("project constraint JSON keys must be ASCII")
        children = value.values()
    else:
        children = value
    for child in children:
        _json_tree(child, depth + 1, next_ancestors)


def canonical_project_constraint_json(value: Any) -> str:
    """New hash policy only; existing observation/typed-fact hashes stay unchanged."""
    _json_tree(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash(value: Any) -> str:
    return hashlib.sha256(canonical_project_constraint_json(value).encode("utf-8")).hexdigest()


def project_constraint_id(fact: dict[str, Any]) -> str:
    return _hash({"hashDomain": "matrix-project-constraint-id-v1",
                  "fact": {key: value for key, value in fact.items() if key != "id"}})


def _string(value: Any) -> bool:
    return type(value) is str and bool(value.strip()) and len(value) <= 200


def _positive_integer(value: Any) -> bool:
    return type(value) is int and 0 < value <= _MAX_SAFE_INTEGER


def _box(value: Any, width: int, height: int) -> bool:
    return (type(value) is list and len(value) == 4
            and all(type(n) is int and 0 <= n <= _MAX_SAFE_INTEGER for n in value)
            and value[0] < value[2] <= width and value[1] < value[3] <= height)


def _clean(text: str) -> str:
    return " ".join(text.split())


def _valid_artifact(artifact: dict[str, Any]) -> bool:
    """Full document-text-v2 envelope only; no page renumbering/subset shortcut."""
    if (set(artifact) != {"schemaVersion", "sourceFileId", "inputSha256", "coordinateSystem", "pageCount",
                         "textPageCount", "qualityPolicyVersion", "qualitySummary", "pages"}
            or artifact.get("schemaVersion") != "document-text-v2"
            or artifact.get("coordinateSystem") != "PDF_BOTTOM_LEFT_MILLI_POINTS"
            or type(artifact.get("qualityPolicyVersion")) is not str
            or artifact["qualityPolicyVersion"] not in {"text-layer-quality-v1", "text-layer-quality-v2"}
            or not _positive_integer(artifact.get("pageCount")) or type(artifact.get("pages")) is not list
            or len(artifact["pages"]) != artifact["pageCount"]):
        return False
    pages = artifact["pages"]
    metrics = {"alphanumericCharacterCount", "blockCount", "disallowedControlCharacterCount",
               "nonWhitespaceCharacterCount", "replacementCharacterCount"}
    for number, page in enumerate(pages, 1):
        if (type(page) is not dict or set(page) != {"pageNumber", "widthMilliPoints", "heightMilliPoints", "blocks", "quality"}
                or type(page.get("pageNumber")) is not int or page["pageNumber"] != number
                or not _positive_integer(page.get("widthMilliPoints")) or not _positive_integer(page.get("heightMilliPoints"))
                or type(page.get("blocks")) is not list or type(page.get("quality")) is not dict):
            return False
        quality = page["quality"]
        if (set(quality) != {"disposition", "metrics", "reasonCodes"}
                or type(quality.get("disposition")) is not str
                or quality["disposition"] not in {"TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"}
                or type(quality.get("metrics")) is not dict or set(quality["metrics"]) != metrics
                or any(type(n) is not int or not 0 <= n <= _MAX_SAFE_INTEGER for n in quality["metrics"].values())
                or type(quality.get("reasonCodes")) is not list
                or any(type(code) is not str for code in quality["reasonCodes"])):
            return False
        width, height = page["widthMilliPoints"], page["heightMilliPoints"]
        for block in page["blocks"]:
            if (type(block) is not dict or set(block) not in ({"text", "bboxMilliPoints"}, {"text", "bboxMilliPoints", "lineBboxesMilliPoints"})
                    or type(block.get("text")) is not str or not _box(block.get("bboxMilliPoints"), width, height)):
                return False
            if "lineBboxesMilliPoints" in block:
                line_boxes = block["lineBboxesMilliPoints"]
                if (type(line_boxes) is not list or len(line_boxes) != len(block["text"].split("\n"))
                        or any(not _box(box, width, height) for box in line_boxes)):
                    return False
    summary = artifact.get("qualitySummary")
    expected_summary = {"textLayerCandidatePageCount": sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for p in pages),
                        "ocrRequiredPageCount": sum(p["quality"]["disposition"] == "OCR_REQUIRED" for p in pages)}
    return (type(artifact.get("textPageCount")) is int
            and artifact["textPageCount"] == sum(bool(p["blocks"]) for p in pages)
            and type(summary) is dict and set(summary) == set(expected_summary)
            and all(type(n) is int for n in summary.values()) and summary == expected_summary)


def _page_constraint(page: dict[str, Any]) -> dict[str, Any] | None:
    width, height, number = (page.get(k) for k in ("widthMilliPoints", "heightMilliPoints", "pageNumber"))
    if (not all(_positive_integer(n) for n in (width, height, number))
            or type(page.get("quality")) is not dict
            or page["quality"].get("disposition") != "TEXT_LAYER_CANDIDATE"
            or type(page.get("blocks")) is not list):
        return None
    blocks = page["blocks"]
    # Invalid original geometry anywhere on this page cannot hide an interleaver.
    if any(type(b) is not dict or type(b.get("text")) is not str
           or not _box(b.get("bboxMilliPoints"), width, height) for b in blocks):
        return None
    anchors = [i for i, b in enumerate(blocks)
               if "ширина дверных проемов" in _clean(b["text"]).casefold()]
    if len(anchors) != 1 or anchors[0] + 4 > len(blocks):
        return None
    start = anchors[0]
    chosen = blocks[start:start + 4]
    for block in chosen:
        if any(c in block["text"] for c in ("\n", "\r", "\u2028", "\u2029")):
            return None
        if "lineBboxesMilliPoints" in block and block["lineBboxesMilliPoints"] != [block["bboxMilliPoints"]]:
            return None
    texts = [_clean(b["text"]) for b in chosen]
    match = _VALUE_LINE.fullmatch(texts[2])
    ending = _END.match(chosen[3]["text"])
    if (texts[0].casefold() != _FIRST or texts[1] != _SECOND or match is None or ending is None
            or _clean(chosen[3]["text"][ending.end():]) not in ("", _TAIL)):
        return None
    boxes = [b["bboxMilliPoints"] for b in chosen]
    # Public F0151 original four boxes: heights all 14040 mpt, top-to-bottom
    # gaps 10193/10081/10081, initial indent 35395, right-edge span 22.
    # Tolerances bound that 14pt text/24pt line profile, permitting a first-line
    # indent up to 40pt, 1pt height/continuation-left drift, 2pt right drift and
    # <=18pt empty vertical gaps. They express source layout, not building norms.
    heights = [b[3] - b[1] for b in boxes]
    gaps = [boxes[i][1] - boxes[i + 1][3] for i in range(3)]
    if (any(not 10000 <= h <= 18000 for h in heights) or max(heights) - min(heights) > 1000
            or any(not 0 <= gap <= 18000 for gap in gaps)
            or not 0 <= boxes[0][0] - boxes[1][0] <= 40000
            or max(b[0] for b in boxes[1:]) - min(b[0] for b in boxes[1:]) > 1000
            or max(b[2] for b in boxes) - min(b[2] for b in boxes) > 2000):
        return None
    bottom, top = boxes[3][1], boxes[0][3]
    if any(b["text"].strip() and b["bboxMilliPoints"][1] < top and b["bboxMilliPoints"][3] > bottom
           for i, b in enumerate(blocks) if i not in range(start, start + 4)):
        return None
    raw_number = match.group("value").replace(",", ".")
    if len(raw_number) > 60:
        return None
    # String decimal canonicalization avoids binary float and Decimal context.
    value = raw_number.rstrip("0").rstrip(".") if "." in raw_number else raw_number
    if value == "0":
        return None
    return {"pageNumber": number, "widthMilliPoints": width, "heightMilliPoints": height,
            "limitValue": value,
            "fragments": [{"blockIndex": start + i, "lineIndex": 0, "rawText": b["text"],
                           "bboxMilliPoints": list(b["bboxMilliPoints"]),
                           "usedTextRange": {"start": 0, "end": ending.end() if i == 3 else len(b["text"])}}
                          for i, b in enumerate(chosen)]}


def extract_project_constraints(object_id: str, input_manifest_hash: str,
                                sources: list[dict[str, Any]], text_artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """Pure extraction over committed text artifacts; no scope/review side effects.

    Invalid API-level input raises ValueError; unusable/ambiguous source evidence
    yields no candidate. Entire original text artifact is hashed, never a selected
    or normalized subset. The caller remains responsible for committed-byte origin.
    """
    if (not _string(object_id) or type(input_manifest_hash) is not str
            or not _SHA.fullmatch(input_manifest_hash) or type(sources) is not list or type(text_artifacts) is not list):
        raise ValueError("invalid project constraint input")
    result = {"schemaVersion": "matrix-project-constraints-v1", "objectId": object_id,
              "inputManifestHash": input_manifest_hash, "extractorVersion": EXTRACTOR_VERSION,
              "purpose": "EVIDENCE_ONLY", "constraints": []}
    source_counts = Counter(s.get("sourceFileId") for s in sources if type(s) is dict and _string(s.get("sourceFileId")))
    artifact_counts = Counter(a.get("sourceFileId") for a in text_artifacts if type(a) is dict and _string(a.get("sourceFileId")))
    artifacts = {a["sourceFileId"]: a for a in text_artifacts if type(a) is dict and _string(a.get("sourceFileId"))}
    for source in sources:
        if type(source) is not dict:
            continue
        sid, sha = source.get("sourceFileId"), source.get("sha256")
        if (not _string(sid) or source_counts[sid] != 1 or artifact_counts[sid] != 1
                or type(sha) is not str or not _SHA.fullmatch(sha) or source.get("stages") != ["PD"]
                or source.get("objectId", object_id) != object_id):
            continue
        artifact = artifacts[sid]
        if (artifact.get("sourceFileId") != sid or artifact.get("inputSha256") != sha or not _valid_artifact(artifact)):
            continue
        pages = artifact["pages"]
        try:
            text_hash = _hash({"hashDomain": "matrix-project-constraint-text-artifact-v1", "textArtifact": artifact})
        except (TypeError, ValueError, UnicodeError, RecursionError):
            continue
        for page in pages:
            extracted = _page_constraint(page)
            if extracted is None:
                continue
            fact = {"schemaVersion": "matrix-project-constraint-v1", "kind": "PROJECT_AUTHORED_CONSTRAINT",
                    "relation": "GE", "attribute": "DOOR_CLEAR_OPENING_WIDTH", "canonicalUnit": "m",
                    "sourceFileId": sid, "sourceSha256": sha, "textArtifactHash": text_hash, "stage": "PD",
                    "extractorVersion": EXTRACTOR_VERSION, "entityKey": None, "applicabilityStatus": "UNREVIEWED",
                    "componentClass": "ACCESSIBLE_ROUTE_DOOR_OPENING",
                    "measurementBasis": "CLEAR_OPENING_WITH_LEAF_OPEN", **extracted}
            result["constraints"].append({"id": project_constraint_id(fact), **fact})
    result["constraints"].sort(key=lambda f: (f["sourceFileId"], f["pageNumber"], f["id"]))
    return result
