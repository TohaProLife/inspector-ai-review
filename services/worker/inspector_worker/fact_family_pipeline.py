"""Run the pinned fact-family pilot on committed, reviewed source inputs.

The output contains source-anchored observations and comparison proposals.
It does not contain findings or establish completed parameter coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .durable_pz002 import _reviewed_source
from .durable_text import download_text_artifact
from .fact_comparison import _valid_link, evaluate_fact_comparison
from .fact_family_pack import load_fact_family_pack, rules_for_object
from .kr_fact_family import extract_kr_facts
from .parameter_routing import _validate_artifact
from .pz_fact_family import extract_pz_facts


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_MAX_FACTS = 512
_MAX_REVIEWED_LINKS = 5


def _hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _verified_entity_links(
    raw_links: object, object_id: str, facts: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Admit only immutable review snapshots bound to extracted fact evidence.

    Missing or invalid snapshots yield no links. This keeps durable comparison
    in ABSTAIN until an API workflow persists and projects reviewed decisions.
    """
    if not isinstance(raw_links, list) or len(raw_links) > _MAX_REVIEWED_LINKS:
        return []
    fact_index = {fact["factId"]: fact for fact in facts}
    source_index = {source["sourceFileId"]: source for source in sources}
    links: list[dict[str, Any]] = []
    envelope_keys = {"schemaVersion", "link", "contentHash", "decisionHash", "actorId"}
    link_keys = {"schemaVersion", "pdFactId", "actualFactId", "objectId",
                 "linkGroupId", "basis", "evidence"}
    for envelope in raw_links:
        if not isinstance(envelope, dict) or set(envelope) != envelope_keys:
            return []
        if envelope.get("schemaVersion") != "reviewed-fact-entity-link-v1":
            return []
        actor = envelope.get("actorId")
        link = envelope.get("link")
        digest = envelope.get("contentHash")
        if (not isinstance(actor, str) or not actor.strip()
                or not isinstance(link, dict) or set(link) != link_keys
                or not isinstance(digest, str) or _SHA256.fullmatch(digest) is None
                or envelope.get("decisionHash") != digest):
            return []
        try:
            if _hash({"actorId": actor, "link": link}) != digest:
                return []
        except (TypeError, ValueError):
            return []
        if not isinstance(link.get("pdFactId"), str) or not isinstance(link.get("actualFactId"), str):
            return []
        expected = fact_index.get(link["pdFactId"])
        actual = fact_index.get(link["actualFactId"])
        if (expected is None or actual is None or link.get("objectId") != object_id
                or expected.get("stage") != "PD" or actual.get("stage") not in {"RD", "ID"}
                or expected.get("objectId") != actual.get("objectId")
                or expected.get("parameterCode") != actual.get("parameterCode")
                or expected.get("attribute") != actual.get("attribute")):
            return []
        if any(source_index[fact["sourceFileId"]].get("revisionStatus") != "CURRENT"
               or source_index[fact["sourceFileId"]].get("approvalStatus") != "APPROVED"
               for fact in (expected, actual)):
            return []
        if not _valid_link(link, expected, actual, source_index):
            return []
        links.append(link)
    return links


def evaluate_fact_family_bundle(
    object_id: str, input_manifest_hash: str, sources: list[dict[str, Any]],
    text_artifacts: list[dict[str, Any]], *,
    entity_links: list[dict[str, Any]] | None = None,
    reviewed_entity_links: object = None,
) -> dict[str, Any]:
    """Evaluate two extraction groups and five review-only rules.

    Each extractor validates its own text artifact before emitting a fact.
    Durable leases accept only hash-pinned, reviewed link envelopes; absent
    review snapshots leave live comparisons in ABSTAIN.
    """
    if not isinstance(object_id, str) or not object_id.strip():
        raise ValueError("fact family bundle requires objectId")
    if not isinstance(input_manifest_hash, str) or _SHA256.fullmatch(input_manifest_hash) is None:
        raise ValueError("fact family bundle requires inputManifestHash")
    if not isinstance(sources, list) or not isinstance(text_artifacts, list):
        raise ValueError("fact family bundle requires source and artifact arrays")
    if entity_links is None:
        entity_links = []
    if not isinstance(entity_links, list):
        raise ValueError("fact family entity links must be an array")
    if entity_links and reviewed_entity_links is not None:
        raise ValueError("fact family link inputs cannot be mixed")
    artifacts_by_source: dict[str, dict[str, Any]] = {}
    for artifact in text_artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("sourceFileId"), str):
            raise ValueError("fact family text artifact identity is invalid")
        source_id = artifact["sourceFileId"]
        if source_id in artifacts_by_source:
            raise ValueError("fact family text artifact is duplicated")
        artifacts_by_source[source_id] = artifact
    comparison_sources: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("sourceFileId"), str):
            raise ValueError("fact family source identity is invalid")
        source_id = source["sourceFileId"]
        if source_id in seen_sources:
            raise ValueError("fact family source is duplicated")
        seen_sources.add(source_id)
        if source.get("objectId") != object_id:
            raise ValueError("fact family source has another objectId")
        enriched = source.copy()
        if source_id in artifacts_by_source:
            enriched["pageCount"] = artifacts_by_source[source_id].get("pageCount")
        comparison_sources.append(enriched)
    if set(artifacts_by_source) - seen_sources:
        raise ValueError("fact family text artifact is not in the source manifest")

    extractable_artifacts: list[dict[str, Any]] = []
    source_index = {source["sourceFileId"]: source for source in comparison_sources}
    for artifact in text_artifacts:
        source = source_index[artifact["sourceFileId"]]
        _validate_artifact(artifact, source)
        stages, mapping, page_count = (source.get(key) for key in
                                       ("stages", "pageStages", "pageCount"))
        if isinstance(stages, list) and len(stages) > 1:
            expected_pages = {str(page) for page in range(1, page_count + 1)}
            if (not isinstance(mapping, dict) or set(mapping) != expected_pages
                    or any(stage not in stages for stage in mapping.values())):
                continue
        extractable_artifacts.append(artifact)
    facts = extract_pz_facts(object_id, comparison_sources, extractable_artifacts)
    facts += extract_kr_facts(object_id, comparison_sources, extractable_artifacts)
    if len(facts) > _MAX_FACTS:
        raise ValueError("fact family fact count exceeds safe bound")
    facts.sort(key=lambda item: (item["parameterCode"], item["sourceFileId"],
                                 item["pageNumber"], item["locator"]["blockIndex"],
                                 item["locator"]["start"], item["factId"]))
    if len({item["factId"] for item in facts}) != len(facts):
        raise ValueError("fact family contains duplicated facts")
    if reviewed_entity_links is not None:
        entity_links = _verified_entity_links(reviewed_entity_links, object_id, facts,
                                               comparison_sources)
    pack = load_fact_family_pack()
    comparisons = []
    for rule in rules_for_object(object_id, pack):
        eligible_facts = [fact for fact in facts if
                          fact["stage"] == "PD" or
                          source_index[fact["sourceFileId"]].get("sectionCode")
                          in rule["requiredActualSection"]]
        comparisons.append(evaluate_fact_comparison(rule, comparison_sources,
                                                    eligible_facts, entity_links))
    result: dict[str, Any] = {
        "schemaVersion": "fact-family-proposals-v1",
        "inputManifestHash": input_manifest_hash,
        "objectId": object_id,
        "facts": facts,
        "comparisons": comparisons,
        "outputCount": len(facts) + len(comparisons),
        "findingCount": 0,
    }
    result["contentHash"] = _hash(result)
    return result


def execute_durable_fact_family(lease: dict[str, Any], attempt: dict[str, Any]) -> dict[str, Any]:
    """Read only immutable, fenced document-text-v2 artifacts from this run."""
    object_id, manifest_hash, inputs = (lease.get(key) for key in
                                        ("objectId", "inputManifestHash", "inputs"))
    if not isinstance(inputs, dict) or not isinstance(inputs.get("sourceFiles"), list):
        raise ValueError("fact family lease has no sourceFiles")
    decisions = inputs.get("sourceDecisions", {})
    if not isinstance(decisions, dict):
        raise ValueError("fact family sourceDecisions must be an object")
    raw_sources = inputs["sourceFiles"]
    source_ids = {source.get("sourceFileId") for source in raw_sources if isinstance(source, dict)}
    if set(decisions) - source_ids:
        raise ValueError("fact family sourceDecisions contain an unknown source")
    sources: list[dict[str, Any]] = []
    text_artifacts: list[dict[str, Any]] = []
    for raw in raw_sources:
        if not isinstance(raw, dict) or not isinstance(raw.get("sourceFileId"), str):
            raise ValueError("fact family source metadata is invalid")
        decision = decisions.get(raw["sourceFileId"])
        reviewed_section = decision.get("sectionCode") if isinstance(decision, dict) else None
        if raw.get("sectionCode") != reviewed_section:
            raise ValueError("fact family sectionCode differs from reviewed source decision")
        source = {
            "sourceFileId": raw["sourceFileId"], "objectId": object_id,
            "sha256": raw.get("sha256"), "stages": raw.get("stages"),
            "sectionCode": reviewed_section,
            **_reviewed_source(raw, decision),
        }
        sources.append(source)
        if raw.get("mediaType") == "application/pdf":
            text_artifacts.append(download_text_artifact(lease, raw, attempt))
    return evaluate_fact_family_bundle(object_id, manifest_hash, sources, text_artifacts,
                                       reviewed_entity_links=inputs.get("reviewedEntityLinks"))
