"""Review-only bridge from candidate observations to the pinned family evaluator.

An observation is a navigation result, not a comparison. Only a pair of exact
typed facts and independently reviewed source/entity/context evidence may reach
the existing nine-family evaluator. Source bytes and text artifact locators must
still be checked by the caller before a review proposal is displayed.

The public 203-document index does not supply CURRENT/APPROVED source review
decisions or reviewed same-entity links. Its metadata alone cannot satisfy this
adapter's gates.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .candidate_family_rules import load_candidate_family_pack
from .class_family_candidates import load_class_family_labels
from .fact_comparison import make_fact_id
from .family_rule_evaluator import _result, evaluate_candidate_family_rule
from .numeric_family_candidates import load_numeric_family_labels
from .presence_family_candidates import load_presence_family_labels


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()


def _text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _valid_bundle(bundle: object, pack: dict[str, Any]) -> bool:
    if not isinstance(bundle, dict):
        return False
    if (bundle.get("schemaVersion") != "candidate-family-observations-v1"
            or bundle.get("purpose") != "REVIEW_ONLY"
            or bundle.get("candidateRulePackSha256") != pack["packSha256"]
            or not _text(bundle.get("objectId"))
            or not isinstance(bundle.get("inputManifestHash"), str)
            or _SHA256.fullmatch(bundle["inputManifestHash"]) is None
            or not isinstance(bundle.get("codeRows"), list)
            or len(bundle["codeRows"]) != 47
            or "findingCount" not in bundle or bundle["findingCount"] is not None
            or "parameterCoverage" not in bundle or bundle["parameterCoverage"] is not None
            or not isinstance(bundle.get("observations"), list)
            or type(bundle.get("outputCount")) is not int
            or bundle["outputCount"] != len(bundle["observations"])):
        return False
    digest = bundle.get("contentHash")
    if not isinstance(digest, str) or _SHA256.fullmatch(digest) is None:
        return False
    rules = sorted(pack["rules"], key=lambda item: item["parameterCode"])
    by_code = {item["parameterCode"]: item for item in rules}
    try:
        if digest != _hash({key: value for key, value in bundle.items()
                            if key != "contentHash"}):
            return False
        labels = (load_numeric_family_labels(), load_class_family_labels(),
                  load_presence_family_labels())
        if any(bundle.get(key) != policy["labelPackSha256"] for key, policy in zip(
            ("numericLabelPackSha256", "classLabelPackSha256",
             "presenceLabelPackSha256"), labels, strict=True
        )):
            return False
    except (OSError, KeyError, TypeError, ValueError):
        return False
    for row, rule in zip(bundle["codeRows"], rules, strict=True):
        if (not isinstance(row, dict)
                or row.get("parameterCode") != rule["parameterCode"]
                or row.get("family") != rule["family"]
                or row.get("status") != "REVIEW_ONLY"
                or type(row.get("observationCount")) is not int
                or row["observationCount"] < 0):
            return False
    ids: set[str] = set()
    for observation in bundle["observations"]:
        if not isinstance(observation, dict):
            return False
        identity = observation.get("observationId")
        if (observation.get("schemaVersion") != "candidate-family-observation-v1"
                or observation.get("status") != "REVIEW_ONLY"
                or observation.get("objectId") != bundle["objectId"]
                or observation.get("inputManifestHash") != bundle["inputManifestHash"]
                or observation.get("parameterCode") not in by_code
                or observation.get("family") != by_code[observation["parameterCode"]]["family"]
                or not isinstance(identity, str) or _SHA256.fullmatch(identity) is None
                or identity in ids):
            return False
        if any(observation.get(key) != bundle[key] for key in (
            "candidateRulePackSha256", "numericLabelPackSha256",
            "classLabelPackSha256", "presenceLabelPackSha256",
        )):
            return False
        try:
            if identity != _hash({key: value for key, value in observation.items()
                                  if key != "observationId"}):
                return False
        except (TypeError, ValueError):
            return False
        ids.add(identity)
    for row in bundle["codeRows"]:
        if row["observationCount"] != sum(
            observation.get("parameterCode") == row["parameterCode"]
            for observation in bundle["observations"]
        ):
            return False
    return True


def _reviewed_source(source: object, observation: dict[str, Any],
                     manifest_sha: str) -> bool:
    if not isinstance(source, dict):
        return False
    review = source.get("sourceReview")
    if (not isinstance(review, dict) or review.get("status") != "VERIFIED"
            or not _text(review.get("reference"))):
        return False
    if (source.get("sourceFileId") != observation.get("sourceFileId")
            or source.get("sha256") != observation.get("sourceSha256")
            or source.get("manifestSha256") != manifest_sha
            or source.get("objectId") != observation.get("objectId")
            or source.get("revisionStatus") != observation.get("revisionStatus")
            or source.get("approvalStatus") != observation.get("approvalStatus")
            or source.get("revisionStatus") != "CURRENT"
            or source.get("approvalStatus") != "APPROVED"
            or not _text(source.get("section"))
            or source.get("section") == "OTHER"
            or not _text(source.get("drawingSection"))
            or (observation.get("sectionCode") is not None
                and source.get("section") != observation["sectionCode"])):
        return False
    return all(review.get(key) == expected for key, expected in {
        "sourceFileId": source["sourceFileId"],
        "sourceSha256": source["sha256"],
        "manifestSha256": manifest_sha,
        "revisionStatus": "CURRENT",
        "approvalStatus": "APPROVED",
        "section": source["section"],
        "drawingSection": source["drawingSection"],
    }.items())


def _typed_fact(observation: dict[str, Any], rule: dict[str, Any]) -> dict[str, Any] | None:
    fact = observation.get("typedFact")
    if not isinstance(fact, dict) or fact.get("schemaVersion") != "typed-fact-v1":
        return None
    try:
        valid_id = fact.get("factId") == make_fact_id(fact)
    except (TypeError, ValueError):
        valid_id = False
    if not valid_id:
        return None
    if (observation.get("parameterCode") != rule["parameterCode"]
            or observation.get("family") != rule["family"]
            or observation.get("attribute") not in {
                item["key"] for item in rule["attributes"]}
            or observation.get("canonicalUnit") != next(
                item["canonicalUnit"] for item in rule["attributes"]
                if item["key"] == observation["attribute"])
            or observation.get("stage") not in {"PD", "RD"}
            or observation.get("status") != "REVIEW_ONLY"):
        return None
    for key in ("parameterCode", "attribute", "canonicalUnit", "objectId",
                "inputManifestHash", "stage", "sourceFileId", "sourceSha256", "artifactSha256",
                "leadSha256", "pageNumber", "rawValue"):
        if fact.get(key) != observation.get(key):
            return None
    expected_unit = (observation["canonicalUnit"] if rule["family"] == "CLASS_DECREASE"
                     else observation.get("rawUnit"))
    if fact.get("rawUnit") != expected_unit:
        return None
    locator = observation.get("locator")
    if not isinstance(locator, dict):
        return None
    fact_locator = {key: value for key, value in locator.items()
                    if key != "lineIndex"}
    fact_locator["kind"] = "TEXT_BLOCK"
    if (locator.get("kind") != "DOCUMENT_TEXT_BLOCK_LINE"
            or fact.get("locator") != fact_locator):
        return None
    if (not isinstance(fact.get("rawText"), str)
            or observation.get("blockTextSha256") != hashlib.sha256(
                fact["rawText"].encode("utf-8")).hexdigest()):
        return None
    return fact


def _reviewed_set_fact(observation: dict[str, Any], rule: dict[str, Any],
                       supplied: object, manifest_sha: str) -> dict[str, Any] | None:
    """Bind a separately reviewed enumeration anchor to one immutable mention.

    The anchor is not proof that the list is complete. The family evaluator
    still requires a fact-bound complete-set and same-scope review.
    """
    if (not isinstance(supplied, dict) or set(supplied) != {"fact", "review"}
            or not isinstance(supplied["fact"], dict)
            or not isinstance(supplied["review"], dict)):
        return None
    fact, review = supplied["fact"], supplied["review"]
    if set(fact) != {"factId", "schemaVersion", "parameterCode", "objectId",
                      "inputManifestHash", "attribute", "stage", "sourceFileId",
                      "sourceSha256", "artifactSha256", "leadSha256", "pageNumber",
                      "rawText", "rawValue", "rawUnit", "canonicalUnit", "locator"}:
        return None
    if set(review) != {"status", "reference", "observationId", "factId",
                       "inputManifestHash", "parameterCode", "attribute", "objectId",
                       "sourceFileId", "sourceSha256", "artifactSha256",
                       "pageNumber", "locator"}:
        return None
    if (review.get("status") != "VERIFIED" or not _text(review.get("reference"))
            or review.get("observationId") != observation.get("observationId")
            or review.get("factId") != fact.get("factId")
            or review.get("inputManifestHash") != manifest_sha):
        return None
    for key in ("parameterCode", "attribute", "objectId", "sourceFileId",
                "sourceSha256", "artifactSha256", "pageNumber"):
        if review.get(key) != observation.get(key):
            return None
    if (rule["family"] != "PRESENCE_SET" or observation.get("typedFact") is not None
            or observation.get("canonicalUnit") != "set"
            or fact.get("schemaVersion") != "typed-fact-v1"
            or fact.get("inputManifestHash") != manifest_sha
            or fact.get("rawUnit") != "set" or fact.get("canonicalUnit") != "set"):
        return None
    for key in ("parameterCode", "attribute", "objectId", "stage",
                "sourceFileId", "sourceSha256", "artifactSha256", "leadSha256",
                "pageNumber", "rawValue"):
        if fact.get(key) != observation.get(key):
            return None
    locator = observation.get("locator")
    if not isinstance(locator, dict) or locator.get("kind") != "DOCUMENT_TEXT_BLOCK_LINE":
        return None
    fact_locator = {key: value for key, value in locator.items() if key != "lineIndex"}
    fact_locator["kind"] = "TEXT_BLOCK"
    if (fact.get("locator") != fact_locator or review.get("locator") != fact_locator
            or not isinstance(fact.get("rawText"), str)
            or observation.get("blockTextSha256") != hashlib.sha256(
                fact["rawText"].encode("utf-8")).hexdigest()):
        return None
    try:
        return fact if fact.get("factId") == make_fact_id(fact) else None
    except (TypeError, ValueError):
        return None


def evaluate_candidate_observations(
    rule: dict[str, Any], observation_bundle: dict[str, Any],
    reviewed_sources: list[dict[str, Any]], entity_links: list[dict[str, Any]], *,
    context_evidence: dict[str, Any], section_resolutions: dict[str, Any] | None = None,
    relative_basis: dict[str, Any] | None = None,
    norm_basis: dict[str, Any] | None = None,
    class_scale: dict[str, Any] | None = None,
    set_scope: dict[str, Any] | None = None,
    reviewed_sets: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compare exact observations only after reviewer-supplied evidence gates.

    Class tokens have typed fact proposals, but require a separately verified
    ordered scale. Presence observations require both reviewed enumeration
    anchors and independently reviewed complete-set/same-scope evidence.
    """
    try:
        pack = load_candidate_family_pack()
    except (OSError, KeyError, TypeError, ValueError):
        return _result(rule, None, "ABSTAIN", "RULE_PACK_INVALID")
    pack_sha = pack["packSha256"]
    pinned = next((item for item in pack["rules"] if isinstance(rule, dict)
                   and item["parameterCode"] == rule.get("parameterCode")), None)
    if pinned is None or rule != pinned:
        return _result(rule, pack_sha, "ABSTAIN", "RULE_NOT_CATALOG_PINNED")
    if not _valid_bundle(observation_bundle, pack):
        return _result(rule, pack_sha, "ABSTAIN", "OBSERVATION_PACK_INVALID")
    object_id = observation_bundle["objectId"]
    if (not isinstance(reviewed_sources, list) or not isinstance(entity_links, list)
            or not isinstance(context_evidence, dict)):
        return _result(rule, pack_sha, "ABSTAIN", "INPUT_INVALID", object_id=object_id)
    if reviewed_sets is not None and rule["family"] != "PRESENCE_SET":
        return _result(rule, pack_sha, "ABSTAIN", "INPUT_INVALID", object_id=object_id)
    source_index: dict[str, dict[str, Any]] = {}
    for source in reviewed_sources:
        if (not isinstance(source, dict) or not _text(source.get("sourceFileId"))
                or source["sourceFileId"] in source_index):
            return _result(rule, pack_sha, "ABSTAIN", "SOURCE_REVIEW_INVALID",
                           object_id=object_id)
        source_index[source["sourceFileId"]] = source
    observations = [item for item in observation_bundle["observations"]
                    if item.get("parameterCode") == rule["parameterCode"]]
    if not observations:
        return _result(rule, pack_sha, "ABSTAIN", "REQUIRED_OBSERVATION_MISSING",
                       object_id=object_id)
    if rule["family"] == "PRESENCE_SET" and reviewed_sets is not None and (
        not isinstance(reviewed_sets, dict)
        or set(reviewed_sets) != {item["observationId"] for item in observations}
    ):
        return _result(rule, pack_sha, "ABSTAIN", "SET_ENUMERATION_REVIEW_INVALID",
                       object_id=object_id)
    facts: list[dict[str, Any]] = []
    for observation in observations:
        source = source_index.get(observation.get("sourceFileId"))
        if not _reviewed_source(source, observation,
                                observation_bundle["inputManifestHash"]):
            return _result(rule, pack_sha, "ABSTAIN", "SOURCE_REVIEW_INVALID",
                           object_id=object_id)
        fact = (_reviewed_set_fact(
            observation, rule, reviewed_sets.get(observation["observationId"]),
            observation_bundle["inputManifestHash"])
            if rule["family"] == "PRESENCE_SET" and reviewed_sets is not None else
            _typed_fact(observation, rule))
        if fact is None:
            reason = ("SET_ENUMERATION_REVIEW_INVALID"
                      if rule["family"] == "PRESENCE_SET" and reviewed_sets is not None
                      else "TYPED_OBSERVATION_UNAVAILABLE")
            return _result(rule, pack_sha, "ABSTAIN", reason,
                           object_id=object_id)
        facts.append(fact)
    return evaluate_candidate_family_rule(
        rule, reviewed_sources, facts, entity_links,
        context_evidence=context_evidence,
        section_resolutions=section_resolutions,
        relative_basis=relative_basis, norm_basis=norm_basis,
        class_scale=class_scale, set_scope=set_scope,
    )
