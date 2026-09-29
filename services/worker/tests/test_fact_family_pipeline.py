from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from inspector_worker.fact_family_pipeline import evaluate_fact_family_bundle, execute_durable_fact_family
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJECT-PILOT"
MANIFEST = "e" * 64


def source(file_id: str, stage: str, section: str) -> dict:
    return {
        "sourceFileId": file_id, "sha256": hashlib.sha256(file_id.encode()).hexdigest(),
        "objectId": OBJECT, "stages": [stage], "sectionCode": section,
        "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
        "linkGroupId": None, "pageStages": {},
    }


def artifact(src: dict, text: str) -> dict:
    blocks = [{"text": text, "bboxMilliPoints": [1000, 1000, 300000, 3000]}]
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
        "inputSha256": src["sha256"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS", "pageCount": 1,
        "textPageCount": 1, "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
        "pages": [{"pageNumber": 1, "widthMilliPoints": 600000,
                   "heightMilliPoints": 800000, "blocks": blocks,
                   "quality": qualify_page_text([text])}],
    }


def reviewed_link_envelope(facts: list[dict]) -> dict:
    pd = next(fact for fact in facts if fact["parameterCode"] == "PZ-004" and fact["stage"] == "PD")
    rd = next(fact for fact in facts if fact["parameterCode"] == "PZ-004" and fact["stage"] == "RD")
    link = {
        "schemaVersion": "fact-entity-link-v1", "pdFactId": pd["factId"],
        "actualFactId": rd["factId"], "objectId": OBJECT, "linkGroupId": "BUILDING-1",
        "basis": {"reference": "reviewed same building schedule"},
        "evidence": [{key: copy.deepcopy(fact[key]) for key in
                      ("factId", "sourceFileId", "sourceSha256", "pageNumber", "locator")}
                     for fact in (pd, rd)],
    }
    digest = hashlib.sha256(json.dumps({"actorId": "reviewer-1", "link": link},
                                       ensure_ascii=False, sort_keys=True,
                                       separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    return {"schemaVersion": "reviewed-fact-entity-link-v1", "link": link,
            "contentHash": digest, "decisionHash": digest, "actorId": "reviewer-1"}


class FactFamilyPipelineTests(unittest.TestCase):
    def fixtures(self) -> tuple[list[dict], list[dict]]:
        pd_pz, rd_pz = source("PZ-PD", "PD", "PZ"), source("PZ-RD", "RD", "AR")
        pd_kr, rd_kr = source("KR-PD", "PD", "KR"), source("KR-RD", "RD", "KR")
        sources = [pd_pz, rd_pz, pd_kr, rd_kr]
        artifacts = [
            artifact(pd_pz, "Строительный объем здания 60000 м3\nЭтажность 3+подвал"),
            artifact(rd_pz, "Строительный объем здания 61000 м3\nЭтажность 4+подвал"),
            artifact(pd_kr, "Фундаментная плита B40\nФундаментная плита толщиной 1200 мм\nПлита перекрытия -2 этажа — 250 мм"),
            artifact(rd_kr, "Фундаментная плита B30\nФундаментная плита толщиной 1000 мм\nПлита перекрытия -2 этажа — 200 мм"),
        ]
        return sources, artifacts

    def reviewed_fixtures(self) -> tuple[list[dict], list[dict], dict]:
        sources, artifacts = self.fixtures()
        for source in sources:
            source["revisionStatus"] = "CURRENT"
            source["approvalStatus"] = "APPROVED"
            source["linkGroupId"] = "BUILDING-1"
        facts = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)["facts"]
        return sources, artifacts, reviewed_link_envelope(facts)

    def test_two_groups_emit_five_rules_without_finding(self) -> None:
        sources, artifacts = self.fixtures()
        result = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)
        self.assertEqual(result["schemaVersion"], "fact-family-proposals-v1")
        self.assertEqual({item["parameterCode"] for item in result["comparisons"]},
                         {"PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"})
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(result["outputCount"], len(result["facts"]) + 5)
        self.assertTrue(all(item["status"] == "ABSTAIN" for item in result["comparisons"]))
        self.assertNotIn("findings", result)
        payload = {key: value for key, value in result.items() if key != "contentHash"}
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                           separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        self.assertEqual(result["contentHash"], digest)

    def test_input_order_does_not_change_result(self) -> None:
        sources, artifacts = self.fixtures()
        forward = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)
        reverse = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources[::-1], artifacts[::-1])
        self.assertEqual(forward, reverse)

    def test_tampered_artifact_and_cross_object_fail_closed(self) -> None:
        sources, artifacts = self.fixtures()
        altered = copy.deepcopy(artifacts)
        altered[0]["inputSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, altered)
        wrong_object = copy.deepcopy(sources)
        wrong_object[0]["objectId"] = "OTHER"
        with self.assertRaisesRegex(ValueError, "another objectId"):
            evaluate_fact_family_bundle(OBJECT, MANIFEST, wrong_object, artifacts)

    def test_rejects_duplicate_source_and_artifact(self) -> None:
        sources, artifacts = self.fixtures()
        with self.assertRaisesRegex(ValueError, "source is duplicated"):
            evaluate_fact_family_bundle(OBJECT, MANIFEST, sources + [sources[0]], artifacts)
        with self.assertRaisesRegex(ValueError, "artifact is duplicated"):
            evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts + [artifacts[0]])

    def test_mixed_stage_requires_complete_reviewed_page_map(self) -> None:
        sources, artifacts = self.fixtures()
        sources[0]["stages"] = ["PD", "RD"]
        sources[0]["pageStages"] = {"1": "UNRESOLVED"}
        result = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)
        self.assertFalse(any(fact["sourceFileId"] == "PZ-PD" for fact in result["facts"]))
        sources[0]["pageStages"] = {"1": "PD"}
        resolved = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)
        self.assertTrue(any(fact["sourceFileId"] == "PZ-PD" for fact in resolved["facts"]))

    def test_wrong_rd_section_is_observation_only(self) -> None:
        sources, artifacts = self.fixtures()
        sources[1]["sectionCode"] = "OV"
        result = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts)
        self.assertTrue(any(fact["sourceFileId"] == "PZ-RD" for fact in result["facts"]))
        for code in ("PZ-004", "PZ-007"):
            comparison = next(item for item in result["comparisons"]
                              if item["parameterCode"] == code)
            self.assertEqual(comparison["status"], "ABSTAIN")
            self.assertEqual(comparison["reasonCodes"], ["REQUIRED_FACT_MISSING"])

    def test_reviewed_pinned_link_reaches_review_only_comparison(self) -> None:
        sources, artifacts, envelope = self.reviewed_fixtures()
        result = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts,
                                             reviewed_entity_links=[envelope])
        volume = next(item for item in result["comparisons"] if item["parameterCode"] == "PZ-004")
        self.assertEqual(volume["status"], "REVIEW_REQUIRED")
        self.assertEqual(volume["reasonCodes"], ["COMPARISON_TRIGGERED_REVIEW"])
        self.assertEqual(volume["comparison"]["observed"], "1000")
        self.assertEqual(result["findingCount"], 0)

    def test_unreviewed_tampered_or_stale_link_abstains(self) -> None:
        sources, artifacts, envelope = self.reviewed_fixtures()
        cases = [
            None,
            [envelope["link"]],
            [{**envelope, "contentHash": "0" * 64}],
            [{**envelope, "decisionHash": "0" * 64}],
            [{**envelope, "actorId": ""}],
            [{**envelope, "actorId": "another-reviewer"}],
            [{**envelope, "link": {**envelope["link"], "pdFactId": "stale"}}],
        ]
        for raw in cases:
            result = evaluate_fact_family_bundle(OBJECT, MANIFEST, sources, artifacts,
                                                 reviewed_entity_links=raw)
            volume = next(item for item in result["comparisons"] if item["parameterCode"] == "PZ-004")
            self.assertEqual((volume["status"], volume["reasonCodes"]),
                             ("ABSTAIN", ["ENTITY_LINK_MISSING"]))

    def test_durable_lease_reads_reviewed_link_only_when_pinned(self) -> None:
        sources, artifacts, envelope = self.reviewed_fixtures()
        decisions = {source["sourceFileId"]: {
            "sourceSha256": source["sha256"], "revisionStatus": "CURRENT",
            "approvalStatus": "APPROVED", "linkGroupId": "BUILDING-1",
            "sectionCode": source["sectionCode"], "pageStages": {},
            "basis": {"reference": "reviewed source decision"},
        } for source in sources}
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST,
                 "inputs": {"sourceDecisions": decisions,
                            "sourceFiles": [{**source, "mediaType": "application/pdf"}
                                            for source in sources],
                            "reviewedEntityLinks": [envelope]}}
        artifacts_by_id = {item["sourceFileId"]: item for item in artifacts}
        with patch("inspector_worker.fact_family_pipeline.download_text_artifact",
                   side_effect=lambda _lease, raw, _attempt: artifacts_by_id[raw["sourceFileId"]]):
            result = execute_durable_fact_family(lease, {})
            volume = next(item for item in result["comparisons"] if item["parameterCode"] == "PZ-004")
            self.assertEqual(volume["status"], "REVIEW_REQUIRED")
            del lease["inputs"]["reviewedEntityLinks"]
            missing = execute_durable_fact_family(lease, {})
            volume = next(item for item in missing["comparisons"] if item["parameterCode"] == "PZ-004")
            self.assertEqual(volume["reasonCodes"], ["ENTITY_LINK_MISSING"])
            lease["inputs"]["sourceFiles"][1]["sectionCode"] = "KR"
            with self.assertRaisesRegex(ValueError, "sectionCode differs"):
                execute_durable_fact_family(lease, {})


if __name__ == "__main__":
    unittest.main()
