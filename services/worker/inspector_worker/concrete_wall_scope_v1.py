"""Draft: one reviewed KR-055 wall/storey pair over full immutable originals.

Only the protected adapter authenticates PDFs, actors, complete parent reviews
and saved run snapshots. Internal consistency is not authenticity or approval.
No matrix_engine import: the old scalar/stair behavior remains untouched.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import hashlib
import json
import re
from typing import Any

from .concrete_wall_prose_v1 import EXTRACTOR_VERSION, _NativeError, _native, extract_concrete_wall_candidates_v1
from .matrix_fact_scope import derive_matrix_fact_selector, portable_evidence_hash
from .source_declarations import _valid_artifact

_RULE = "matrix-kr-055-concrete_class"
_POLICY = "matrix-concrete-wall-reviewed-pair-v1"
_SAFE = 9007199254740991
_HASH = re.compile(r"[a-f0-9]{64}\Z", re.ASCII)
_UUID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z", re.ASCII)
_PAGE = re.compile(r"[1-9][0-9]*\Z", re.ASCII)
_BLOCK = re.compile(r"[0-9]{1,18}:[0-9]{1,18}\Z", re.ASCII)
_CONTEXT_KEY = re.compile(r"[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_-]+)?\Z", re.ASCII)
_CLASS = re.compile(r"[BВ](?P<rank>[1-9][0-9]{0,2}(?:[.,][0-9])?)\Z")
_STAGES = {"PD", "RD", "ID", "UNRESOLVED"}
_FACT_KEYS = set("sourceFileId sourceSha256 stage pageNumber blockId bbox rawText rawValue rawUnit attribute value unit entityKey method extractorVersion parameterCodes sourceFlags evidenceFragments contextFragments id".split())
_TARGET_KEYS = set("checkId executionContentHash observationId evidenceHash textArtifactHash".split())
_CONTEXT_FIELDS = set("reference drawingSection applicable parameterCode attribute threshold canonicalUnit limitValue approvedChangePresent reductionConfirmed componentRole componentKey zoneKey operatingModeKey measurementBasisKey projectZeroAuthority".split())
_IDENTITY_KEYS = set("reference componentRole componentKey zoneKey operatingModeKey measurementBasisKey".split())
_MATERIAL_KEYS = set("reference attribute canonicalUnit measurementBasisKey".split())
_FLOOR_KEYS = set("reference componentRole componentKey zoneKey measurementBasisKey".split())
_FLOOR = "CONCRETE_WALL_FLOOR_SCOPE_V1"
_BASIS = "CONCRETE_COMPRESSIVE_STRENGTH_CLASS"
_TABLE_HEADER = re.compile(
    r"Для железобетонных конструкций предусматривается использование тяжелого бетона "
    r"по ГОСТ [0-9]{1,5}-[0-9]{4} и ГОСТ [0-9]{1,5}-[0-9]{4} "
    r"и приняты следующие классы по прочности на сжатие:\Z", re.I)
_TABLE_LABEL = re.compile(
    r"(?:·\s*)?(?:фундаментная плита|пилоны, колонны [+-]?[0-9]{1,3} по [+-]?[0-9]{1,3}|"
    r"стены [+-]?[0-9]{1,3}(?:го)? по [+-]?[0-9]{1,3}|плита [+-]?[0-9]{1,3}(?:го)? этажа|плита покрытия)\Z", re.I)
_TABLE_VALUE = re.compile(r"(?P<value>[BВ][0-9]+(?:[.,][0-9]+)?)\s*[.;]?\Z")


class ConcreteWallScopeValidationError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str = "INVALID_INPUT") -> None:
    raise ConcreteWallScopeValidationError(code)


def _exact(value: Any, fields: set[str]) -> bool:
    return type(value) is dict and set(value) == fields


def _text(value: Any, maximum: int, minimum: int = 1, *, clean: bool = False) -> bool:
    return (type(value) is str and minimum <= len(value.encode("utf-16-le")) // 2 <= maximum
            and (not clean or (value.strip() == value
                 and not any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value))))


def _hash(value: Any) -> bool:
    return type(value) is str and _HASH.fullmatch(value) is not None


def _target(value: Any) -> bool:
    return (_exact(value, _TARGET_KEYS) and _text(value["checkId"], 120, clean=True)
            and all(_hash(value[key]) for key in _TARGET_KEYS - {"checkId"}))


def _stages(value: Any) -> bool:
    return (type(value) is list and 1 <= len(value) <= 4
            and all(type(stage) is str and stage in _STAGES for stage in value)
            and len(set(value)) == len(value))


def _page_stages(value: Any) -> bool:
    return (type(value) is dict and all(_PAGE.fullmatch(key) is not None
            and type(stage) is str and stage in _STAGES for key, stage in value.items()))


def _page_ranges(value: dict[str, str], count: int) -> bool:
    # Compare bounded decimal strings; int(5000-digit hostile page key) is never called.
    end = str(count)
    return all(len(key) < len(end) or (len(key) == len(end) and key <= end) for key in value)


def _stage_at(stages: list[str], pages: dict[str, str], number: int) -> str:
    return stages[0] if len(stages) == 1 else pages.get(str(number), "UNRESOLVED")


def _binding_shape(value: Any) -> bool:
    if value is None:
        return True
    required = set("ruleId ruleVersion parameterCode entityKey reference target contexts".split())
    if (type(value) is not dict or not required <= set(value) <= required | {"tableContextReview"}
            or not _text(value["ruleId"], 180, clean=True) or not _text(value["ruleVersion"], 40, clean=True)
            or not _text(value["parameterCode"], 40, clean=True) or not _text(value["entityKey"], 200, clean=True)
            or not _text(value["reference"], 1000, 8, clean=True) or not _target(value["target"])
            or type(value["contexts"]) is not dict or len(value["contexts"]) > 100):
        return False
    for key, details in value["contexts"].items():
        if (len(key) > 180 or not _CONTEXT_KEY.fullmatch(key)
                or re.match(r"(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|\Z)", key)
                or type(details) is not dict or not {"reference"} <= set(details) <= _CONTEXT_FIELDS
                or not _text(details["reference"], 1000, 8, clean=True)):
            return False
        for field, item in details.items():
            if field == "reference":
                continue
            if field in {"applicable", "approvedChangePresent", "reductionConfirmed"}:
                if type(item) is not bool:
                    return False
            elif field == "projectZeroAuthority":
                # Geodetic authority belongs to a separate frozen rule, never this wall policy.
                return False
            elif not _text(item, 200, minimum=0):
                return False
    if "tableContextReview" in value:
        review = value["tableContextReview"]
        if (not _exact(review, {"fragmentsHash", "reference"}) or not _hash(review["fragmentsHash"])
                or not _text(review["reference"], 1000, 8, clean=True)):
            return False
    return True


def _shape(value: Any) -> None:
    if (not _exact(value, set("schemaVersion objectId inputManifestHash expected actual".split()))
            or value["schemaVersion"] != "matrix-concrete-wall-pair-input-v1"
            or not _text(value["objectId"], 200, clean=True) or not _hash(value["inputManifestHash"])):
        _fail()
    for name in ("expected", "actual"):
        side = value[name]
        if not _exact(side, {"fact", "origin", "source", "binding"}):
            _fail()
        origin, source, fact = side["origin"], side["source"], side["fact"]
        if (not _exact(origin, set("target objectId inputManifestHash originalStages originalPageStages artifact".split()))
                or not _target(origin["target"]) or not _text(origin["objectId"], 200, clean=True)
                or not _hash(origin["inputManifestHash"]) or not _stages(origin["originalStages"])
                or not _page_stages(origin["originalPageStages"])):
            _fail()
        if (not _exact(source, set("objectId sourceFileId sourceSha256 stages revisionStatus approvalStatus sectionCode linkGroupId pageStages reviewRef".split()))
                or not all(_text(source[key], 200, clean=True) for key in ("objectId", "sourceFileId"))
                or not _hash(source["sourceSha256"]) or not _stages(source["stages"])
                or source["revisionStatus"] not in ("UNKNOWN", "CURRENT", "SUPERSEDED")
                or source["approvalStatus"] not in ("UNKNOWN", "APPROVED", "UNAPPROVED")
                or not _page_stages(source["pageStages"])
                or not all(source[key] is None or _text(source[key], 200, clean=True)
                           for key in ("sectionCode", "linkGroupId"))):
            _fail()
        review = source["reviewRef"]
        if (not _exact(review, {"decisionId", "contentHash"}) or type(review["decisionId"]) is not str
                or _UUID.fullmatch(review["decisionId"]) is None or not _hash(review["contentHash"])):
            _fail()
        if fact is not None and not _exact(fact, _FACT_KEYS):
            _fail()
        if not _binding_shape(side["binding"]):
            _fail()


def _integrity(value: dict[str, Any], side: dict[str, Any]) -> None:
    origin, source, artifact = side["origin"], side["source"], side["origin"]["artifact"]
    if (origin["objectId"] != value["objectId"] or source["objectId"] != value["objectId"]
            or origin["inputManifestHash"] != value["inputManifestHash"] or not _valid_artifact(artifact)
            or artifact["pageCount"] > 512 or source["sourceFileId"] != artifact["sourceFileId"]
            or source["sourceSha256"] != artifact["inputSha256"]
            or not _page_ranges(source["pageStages"], artifact["pageCount"])
            or not _page_ranges(origin["originalPageStages"], artifact["pageCount"])):
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    for page in artifact["pages"]:
        if len(page["blocks"]) > 32768 or any(len(line) > 100000
                for block in page["blocks"] for line in block["text"].split("\n")):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
    if portable_evidence_hash(artifact) != origin["target"]["textArtifactHash"]:
        _fail("SOURCE_PROVENANCE_UNVERIFIED")


def _box(box: list[int], page: dict[str, Any]) -> dict[str, float]:
    width, height = page["widthMilliPoints"], page["heightMilliPoints"]
    return {"x": box[0] / width, "y": 1 - box[3] / height,
            "width": (box[2] - box[0]) / width, "height": (box[3] - box[1]) / height}


def _fragment(part: dict[str, Any], page: dict[str, Any], context: bool = False) -> dict[str, Any]:
    result = {"blockId": f"{part['blockIndex']}:{part['lineIndex']}", "rawText": part["rawText"],
              "bbox": _box(part["bboxMilliPoints"], page)}
    return {"pageNumber": part["pageNumber"], **result, "role": part["role"]} if context else result


def _table_clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _page_lines(page: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for bi, block in enumerate(page["blocks"]):
        texts = block["text"].split("\n")
        for li, text in enumerate(texts):
            if not text.strip():
                continue
            boxes = block.get("lineBboxesMilliPoints")
            result.append({"pageNumber": page["pageNumber"], "blockIndex": bi, "lineIndex": li,
                           "rawText": text, "bboxMilliPoints": boxes[li] if boxes is not None else block["bboxMilliPoints"],
                           "exact": boxes is not None or len(texts) == 1})
    return result


def _pd_table_candidates(page: dict[str, Any], pages: dict[int, dict[str, Any]],
                         origin: dict[str, Any]) -> list[dict[str, Any]]:
    """Independently reconstruct the preserved wall row, not arbitrary B text.

    Layout gates mirror the existing frozen table grammar without importing the
    engine or changing its ID policy. Only the explicit -3..+1 wall row enters
    this new finite wall/storey comparison policy.
    """
    lines = _page_lines(page)
    scopes = [line for line in lines if _table_clean(line["rawText"]).casefold() == "подземная часть"]
    if len(scopes) != 1 or not scopes[0]["exact"]:
        return []
    scope = scopes[0]
    headers = []
    for number in (page["pageNumber"] - 1, page["pageNumber"]):
        hp = pages.get(number)
        if hp is None:
            continue
        for bi, block in enumerate(hp["blocks"]):
            if _TABLE_HEADER.fullmatch(_table_clean(block["text"])):
                headers.append((hp, [line for line in _page_lines(hp) if line["blockIndex"] == bi]))
    if len(headers) != 1:
        return []
    hp, header = headers[0]
    if (not 1 <= len(header) <= 3 or any(not line["exact"] for line in header)
            or _stage_at(origin["originalStages"], origin["originalPageStages"], hp["pageNumber"]) != "PD"
            or hp["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"
            or page["quality"]["disposition"] != "TEXT_LAYER_CANDIDATE"
            or (hp["pageNumber"] == page["pageNumber"]
                and min(line["bboxMilliPoints"][1] for line in header) <= scope["bboxMilliPoints"][3])):
        return []
    contexts = [_fragment({**line, "role": "ATTRIBUTE_HEADER"}, hp, True) for line in header]
    contexts.append(_fragment({**scope, "role": "TABLE_SCOPE"}, page, True))
    below = [line for line in lines if line is not scope and line["bboxMilliPoints"][3] <= scope["bboxMilliPoints"][1]]
    stop = max([0, *[line["bboxMilliPoints"][3] for line in below
                    if not _TABLE_LABEL.fullmatch(_table_clean(line["rawText"]))
                    and not _TABLE_VALUE.fullmatch(_table_clean(line["rawText"]))
                    and _table_clean(line["rawText"]) != "·"]])
    labels = [line for line in below if line["exact"] and _TABLE_LABEL.fullmatch(_table_clean(line["rawText"]))]
    result = []
    for label in labels:
        if _table_clean(label["rawText"]).casefold() != "стены -3го по +1":
            continue
        box = label["bboxMilliPoints"]
        height, center = max(1, box[3] - box[1]), (box[1] + box[3]) / 2
        aligned = [line for line in lines if line is not label
                   and abs((line["bboxMilliPoints"][1] + line["bboxMilliPoints"][3]) / 2 - center) <= height / 4]
        cells = [line for line in aligned if line["exact"] and line["bboxMilliPoints"][0] >= box[2]
                 and line["bboxMilliPoints"][0] - box[2] <= height * 32]
        if len(cells) != 1:
            continue
        cell = cells[0]
        match = _TABLE_VALUE.fullmatch(_table_clean(cell["rawText"]))
        extras = [line for line in aligned if line is not cell]
        if (match is None or _CLASS.fullmatch(match.group("value")) is None or len(extras) > 1
                or any(not line["exact"] or _table_clean(line["rawText"]) != "·"
                       or line["bboxMilliPoints"][2] > box[0]
                       or box[0] - line["bboxMilliPoints"][2] > 2 * height for line in extras)):
            continue
        b = cell["bboxMilliPoints"]
        bottom, top = min(box[1], b[1]), max(box[3], b[3])
        if bottom < stop or any(other is not label and min(top, other["bboxMilliPoints"][3]) >
                                max(bottom, other["bboxMilliPoints"][1]) for other in labels):
            continue
        result.append({"value": match.group("value"), "evidenceFragments": [_fragment(part, page) for part in (label, cell)],
                       "contextFragments": contexts,
                       "bbox": _box([min(box[0], b[0]), bottom, max(box[2], b[2]), top], page)})
    return result


def _reconstruct(side: dict[str, Any], stage: str) -> dict[str, Any] | None:
    fact, origin, source = side["fact"], side["origin"], side["source"]
    if fact is None:
        if side["binding"] is not None:
            _fail("TARGET_UNVERIFIED")
        return None
    artifact = origin["artifact"]
    pages = {page["pageNumber"]: page for page in artifact["pages"]}
    number = fact["pageNumber"]
    if (type(number) is not int or number not in pages or fact["stage"] != stage
            or _stage_at(origin["originalStages"], origin["originalPageStages"], number) != stage
            or fact["sourceFileId"] != source["sourceFileId"] or fact["sourceSha256"] != source["sourceSha256"]
            or fact["attribute"] != "CONCRETE_CLASS" or fact["unit"] != "B_CLASS"
            or fact["rawUnit"] != "B_CLASS" or fact["method"] != "TEXT_LAYER"
            or fact["parameterCodes"] != ["KR-055"] or not _hash(fact["id"])
            or type(fact["value"]) is not str or _CLASS.fullmatch(fact["value"]) is None
            or fact["rawValue"] != fact["value"] or type(fact["sourceFlags"]) is not list
            or any(not _text(flag, 200, clean=True) for flag in fact["sourceFlags"])
            or len(set(fact["sourceFlags"])) != len(fact["sourceFlags"])
            or not (fact["entityKey"] is None or _text(fact["entityKey"], 200, clean=True))):
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    page = pages[number]
    if stage == "PD":
        candidates = _pd_table_candidates(page, pages, origin)
        if (fact["extractorVersion"] != "matrix-text-facts-v1" or "TABLE_CONTEXT_UNVERIFIED" not in fact["sourceFlags"]
                or len(candidates) != 1):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        candidate = candidates[0]
        if (fact["value"] != candidate["value"] or fact["evidenceFragments"] != candidate["evidenceFragments"]
                or fact["contextFragments"] != candidate["contextFragments"] or fact["bbox"] != candidate["bbox"]):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        selector = derive_matrix_fact_selector(fact, artifact)
        if selector is None:
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
    else:
        candidates = extract_concrete_wall_candidates_v1(page, "RD")
        if (fact["extractorVersion"] != EXTRACTOR_VERSION or "CONCRETE_WALL_SCOPE_UNVERIFIED" not in fact["sourceFlags"]
                or len(candidates) != 1):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        candidate = candidates[0]
        primary = [_fragment(part, page) for part in candidate["primaryFragments"]]
        contexts = [_fragment(part, page, True) for part in candidate["contextFragments"]]
        if (fact["value"] != candidate["value"] or fact["evidenceFragments"] != primary
                or fact["contextFragments"] != contexts or fact["bbox"] != primary[0]["bbox"]):
            _fail("SOURCE_PROVENANCE_UNVERIFIED")
        fields = "sourceFileId sourceSha256 stage pageNumber blockId attribute value unit rawValue rawUnit rawText method extractorVersion bbox evidenceFragments contextFragments".split()
        selector = {"schemaVersion": "matrix-fact-selector-v1", **{key: fact[key] for key in fields},
                    "textArtifactHash": origin["target"]["textArtifactHash"]}
    if (not fact["evidenceFragments"] or fact["blockId"] != fact["evidenceFragments"][0]["blockId"]
            or fact["rawText"] != " ".join(part["rawText"] for part in fact["evidenceFragments"])):
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    identity = {key: fact[key] for key in ("sourceFileId", "sourceSha256", "stage", "pageNumber", "attribute", "value", "unit")}
    identity["blockIds"] = [part["blockId"] for part in fact["evidenceFragments"]]
    identity["contextFragments"] = fact["contextFragments"]
    if stage == "RD":
        identity = {"schemaVersion": "matrix-concrete-wall-observation-v1", **identity,
                    "extractorVersion": EXTRACTOR_VERSION}
        observation_id = portable_evidence_hash(identity)
    else:
        observation_id = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True,
                                                   separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    if observation_id != fact["id"]:
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    computed = {**origin["target"], "observationId": fact["id"], "evidenceHash": portable_evidence_hash(selector)}
    if computed != origin["target"]:
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    return computed


def _result(value: dict[str, Any], reason: str, *, status: str = "CLARIFICATION_REQUIRED",
            qualified: bool = False, delta: str | None = None, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    expected, actual = value["expected"], value["actual"]
    ef, af = expected["fact"], actual["fact"]
    bindings = [side["binding"] for side in (expected, actual) if side["binding"] is not None]
    entity = bindings[0]["entityKey"] if ef is not None and af is not None and bindings else None
    return {"ruleId": _RULE, "ruleVersion": "1", "parameterCode": "KR-055", "entityKey": entity,
            "comparisonVariant": "PD_RD", "executionStatus": "SUCCEEDED", "machineStatus": status,
            "reasonCode": reason, "qualified": qualified,
            "expectedObservationId": ef["id"] if ef is not None else None,
            "actualObservationId": af["id"] if af is not None else None,
            "expectedValue": ef["value"] if ef is not None else None, "actualValue": af["value"] if af is not None else None,
            "delta": delta, "wallScope": deepcopy(scope),
            "confidence": {"calibratedProbability": None, "calibrationVersion": None, "humanDecision": None},
            "coverage": {"parameterCode": "KR-055", "executionStatus": "PARTIAL", "successfulComparisons": int(qualified),
                         "globalNoViolation": False, "scopeCompleteUpgrade": False}}


def _same_context(bindings: list[dict[str, Any]], key: str, required: set[str],
                  expected: dict[str, str], equal_fields: tuple[str, ...]) -> bool:
    details = [binding["contexts"].get(key) for binding in bindings]
    if any(type(item) is not dict or set(item) != required
           or any(item.get(field) != literal for field, literal in expected.items()) for item in details):
        return False
    return all(details[0][field] == details[1][field] and _text(details[0][field], 200, clean=True)
               for field in equal_fields)


def evaluate_concrete_wall_pair_v1(raw: Any) -> dict[str, Any]:
    """Closed, detached result; full retained integrity precedes all eligibility."""
    try:
        _native(raw)
    except _NativeError as error:
        _fail(error.code)
    _shape(raw)
    for name in ("expected", "actual"):
        _integrity(raw, raw[name])
    expected, actual = raw["expected"], raw["actual"]
    if (expected["source"]["sourceFileId"] == actual["source"]["sourceFileId"]
            or expected["source"]["sourceSha256"] == actual["source"]["sourceSha256"]):
        _fail("SOURCE_PROVENANCE_UNVERIFIED")
    targets = [_reconstruct(side, stage) for side, stage in ((expected, "PD"), (actual, "RD"))]
    for side, target in zip((expected, actual), targets):
        binding = side["binding"]
        if binding is not None and (binding["target"] != target
                or binding["ruleId"] != _RULE or binding["ruleVersion"] != "1" or binding["parameterCode"] != "KR-055"):
            _fail("TARGET_UNVERIFIED")
    if expected["fact"] is None or actual["fact"] is None:
        return _result(raw, "REQUIRED_FACT_MISSING", status="MISSING_EVIDENCE")
    for side, stage, sections in ((expected, "PD", {"KR"}), (actual, "RD", {"KJ", "KR"})):
        source, fact = side["source"], side["fact"]
        if _stage_at(source["stages"], source["pageStages"], fact["pageNumber"]) != stage:
            return _result(raw, "SOURCE_STAGE_UNVERIFIED")
        if source["revisionStatus"] != "CURRENT":
            return _result(raw, "SOURCE_REVISION_UNRESOLVED" if source["revisionStatus"] == "UNKNOWN" else "SOURCE_REVISION_SUPERSEDED")
        if source["approvalStatus"] != "APPROVED":
            return _result(raw, "SOURCE_APPROVAL_UNRESOLVED" if source["approvalStatus"] == "UNKNOWN" else "SOURCE_UNAPPROVED")
        if source["sectionCode"] not in sections:
            return _result(raw, "SOURCE_SECTION_UNVERIFIED")
    if not expected["source"]["linkGroupId"] or expected["source"]["linkGroupId"] != actual["source"]["linkGroupId"]:
        return _result(raw, "LINK_GROUP_MISMATCH")
    bindings = [expected["binding"], actual["binding"]]
    if (any(binding is None for binding in bindings) or bindings[0]["entityKey"] != bindings[1]["entityKey"]
            or not _same_context(bindings, "ELEMENT_IDENTITY", _IDENTITY_KEYS,
                {"componentRole": "MONOLITHIC_LOAD_BEARING_WALL", "operatingModeKey": "CAST_IN_PLACE_LOAD_BEARING_WALL",
                 "measurementBasisKey": _BASIS}, ("componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"))):
        return _result(raw, "CONTEXT_UNVERIFIED:ELEMENT_IDENTITY")
    if not _same_context(bindings, "MATERIAL_CLASS_BASIS", _MATERIAL_KEYS,
                         {"attribute": "CONCRETE_CLASS", "canonicalUnit": "B_CLASS", "measurementBasisKey": _BASIS},
                         ("attribute", "canonicalUnit", "measurementBasisKey")):
        return _result(raw, "CONTEXT_UNVERIFIED:MATERIAL_CLASS_BASIS")
    if (not _same_context(bindings, _FLOOR, _FLOOR_KEYS,
                          {"componentRole": "EXACT_STOREY", "measurementBasisKey": "EXACT_COMMON_STOREY"},
                          ("componentKey", "zoneKey", "measurementBasisKey"))
            or any(binding["contexts"][_FLOOR]["zoneKey"] != binding["contexts"]["ELEMENT_IDENTITY"]["zoneKey"] for binding in bindings)
            or bindings[0]["contexts"][_FLOOR]["componentKey"] not in {"-3", "-2", "-1", "0", "1"}):
        return _result(raw, "CONTEXT_UNVERIFIED:" + _FLOOR)
    for side in (expected, actual):
        review = side["binding"].get("tableContextReview")
        if review is None or review["fragmentsHash"] != portable_evidence_hash(side["fact"]["contextFragments"]):
            return _result(raw, "TEXT_OR_STAGE_QUALITY_UNVERIFIED")
    ei = bindings[0]["contexts"]["ELEMENT_IDENTITY"]
    scope = {"policyVersion": _POLICY, "entityKey": bindings[0]["entityKey"], "componentKey": ei["componentKey"],
             "zoneKey": ei["zoneKey"], "floorKey": bindings[0]["contexts"][_FLOOR]["componentKey"],
             "expectedTarget": targets[0], "actualTarget": targets[1],
             "expectedReview": expected["source"]["reviewRef"], "actualReview": actual["source"]["reviewRef"]}
    evalue = Decimal(_CLASS.fullmatch(expected["fact"]["value"]).group("rank").replace(",", "."))
    avalue = Decimal(_CLASS.fullmatch(actual["fact"]["value"]).group("rank").replace(",", "."))
    difference = avalue - evalue
    delta = "0" if difference == 0 else format(difference, "f").rstrip("0").rstrip(".") if "." in format(difference, "f") else format(difference, "f")
    return _result(raw, "CONCRETE_WALL_SCOPED_DECREASE_V1" if difference < 0 else "CONCRETE_WALL_SCOPED_NO_DECREASE_V1",
                   status="CANDIDATE" if difference < 0 else "NEGATIVE_VERIFIED", qualified=True, delta=delta, scope=scope)
