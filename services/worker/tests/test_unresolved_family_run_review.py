"""Run-scoped unresolved leads stay review-only and SHA bound."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
from inspector_worker.unresolved_family_run_review import (
    evaluate_unresolved_family_run_review,
    execute_durable_unresolved_family_run_review,
)
from inspector_worker.pilot_rule_adapter import UNRESOLVED_REVIEW_PROFILE
from inspector_worker.ocr_table_rows import PROFILE_ID_V3, SCHEMA_VERSION_V3
from inspector_worker.durable_ocr_layout import PROFILE_HASH_V5, PROFILE_ID_V5
from services.worker.tests.test_pilot_rule_adapter_ocr_table import (
    MANIFEST_SHA as RELEASE_MANIFEST, definitions, lease_for,
)
from services.worker.tests import test_pilot_rule_adapter_ocr_table_v2 as ocr_table_v2


OBJECT = "OBJ-1"
MANIFEST = "a" * 64


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str, section: str, *, stages: list[str] | None = None,
           revision: str = "CURRENT", approval: str = "APPROVED",
           page_stages: dict[str, str] | None = None) -> dict:
    return {"sourceFileId": source_id, "sha256": digest(source_id),
            "objectId": OBJECT, "stages": stages or ["PD"], "sectionCode": section,
            "revisionStatus": revision, "approvalStatus": approval,
            "pageStages": page_stages or {}}


def artifact(src: dict, page_texts: list[str]) -> dict:
    pages = []
    for number, text in enumerate(page_texts, 1):
        blocks = [{"text": text, "bboxMilliPoints": [1000, 1000, 500000, 8000]}]
        pages.append({"pageNumber": number, "widthMilliPoints": 600000,
                      "heightMilliPoints": 800000, "blocks": blocks,
                      "quality": qualify_page_text([text])})
    candidate_count = sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                          for p in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"], "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": len(pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidate_count,
                               "ocrRequiredPageCount": len(pages) - candidate_count},
            "pages": pages}


FILL = "Раздел проекта содержит пояснения по размещению оборудования и инженерных сетей. " * 3
AR_LINE = "Высота дверного проема 2100 мм"
VK_LINE = "Водоснабжение труба полипропиленовая; канализация труба чугунная"


class UnresolvedFamilyRunReviewTests(unittest.TestCase):
    def test_exact_approved_leads_are_still_abstain_and_deterministic(self) -> None:
        ar = source("F-AR", "AR")
        vk = source("F-VK", "VK", stages=["RD"])
        ar_art = artifact(ar, [FILL + "\n" + AR_LINE])
        vk_art = artifact(vk, [FILL + "\n" + VK_LINE])
        self.assertEqual(ar_art["pages"][0]["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
        result = evaluate_unresolved_family_run_review(
            OBJECT, MANIFEST, [vk, ar], [vk_art, ar_art])
        self.assertEqual(result, evaluate_unresolved_family_run_review(
            OBJECT, MANIFEST, [ar, vk], [ar_art, vk_art]))
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["findingCount"], None)
        self.assertEqual(result["parameterCoverage"], None)
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]],
                         ["AR-042", "IOS2-072", "IOS3-075"])
        self.assertEqual([len(row["leads"]) for row in result["codeRows"]], [1, 1, 1])
        for row in result["codeRows"]:
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertIn("LEAD_NOT_VERIFIED_FACT", row["reasonCodes"])
            lead = row["leads"][0]
            self.assertEqual(lead["pageNumber"], 1)
            self.assertEqual(lead["blockIndex"], 0)
            self.assertEqual(lead["lineIndex"], 1)
            self.assertEqual(lead["bboxMilliPoints"], [1000, 1000, 500000, 8000])
            self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                         if k != "leadSha256"}))
        self.assertEqual(result["sourceStageArtifacts"], [
            {"sourceFileId": "F-AR", "sourceSha256": ar["sha256"],
             "textArtifactSha256": digest(ar_art)},
            {"sourceFileId": "F-VK", "sourceSha256": vk["sha256"],
             "textArtifactSha256": digest(vk_art)},
        ])

    def test_review_section_page_and_quality_gates_suppress_leads(self) -> None:
        unreviewed = source("F-A", "AR", approval="UNKNOWN")
        wrong_section = source("F-B", "OV")
        mixed = source("F-C", "AR", stages=["PD", "RD"],
                       page_stages={"1": "UNRESOLVED"})
        poor = source("F-D", "AR")
        sources = [unreviewed, wrong_section, mixed, poor]
        artifacts = [artifact(unreviewed, [FILL + "\n" + AR_LINE]),
                     artifact(wrong_section, [FILL + "\n" + AR_LINE]),
                     artifact(mixed, [FILL + "\n" + AR_LINE]),
                     artifact(poor, [FILL + "\n\ufffd " + AR_LINE])]
        result = evaluate_unresolved_family_run_review(OBJECT, MANIFEST, sources, artifacts)
        row = result["codeRows"][0]
        self.assertEqual(row["leads"], [])
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                         "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                         "NO_EXACT_LINE_LEAD"}.issubset(row["reasonCodes"]))

    def test_bad_artifact_and_duplicate_fail_closed(self) -> None:
        src = source("F-AR", "AR")
        art = artifact(src, [FILL + "\n" + AR_LINE])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_unresolved_family_run_review(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_unresolved_family_run_review(OBJECT, MANIFEST, [src], [art, art])
        bad = copy.deepcopy(art)
        bad["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_unresolved_family_run_review(OBJECT, MANIFEST, [src], [bad])
        wrong = copy.deepcopy(art)
        wrong["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_unresolved_family_run_review(OBJECT, MANIFEST, [src], [wrong])

    def test_bounded_leads_report_truncation(self) -> None:
        src = source("F-AR", "AR")
        text = FILL + "\n" + "\n".join(f"Высота двери {n} мм" for n in range(20))
        row = evaluate_unresolved_family_run_review(
            OBJECT, MANIFEST, [src], [artifact(src, [text])])["codeRows"][0]
        self.assertEqual(len(row["leads"]), 16)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])
        self.assertEqual([lead["lineIndex"] for lead in row["leads"]], list(range(1, 17)))

    def test_durable_uses_fenced_run_loader(self) -> None:
        src = source("F-AR", "AR")
        art = artifact(src, [FILL + "\n" + AR_LINE])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.unresolved_family_run_review.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_unresolved_family_run_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["inputManifestHash"], MANIFEST)
        self.assertEqual(len(result["codeRows"][0]["leads"]), 1)


class UnresolvedFamilyReleaseTests(unittest.TestCase):
    @staticmethod
    def lease() -> dict:
        defs = definitions()
        defs["ocrTableRows"].update(version="3", extractionProfile=PROFILE_ID_V3)
        defs["unresolvedFamilyReview"] = {
            "ruleId": "pilot-unresolved-family-text-review", "version": "1",
            "extractionProfile": "unresolved-family-text-review-v1", "codeCount": 3,
            "disposition": "REVIEW_AID_ONLY"}
        return lease_for(defs, profile=UNRESOLVED_REVIEW_PROFILE,
                         ocr_profile=PROFILE_ID_V5, ocr_hash=PROFILE_HASH_V5)

    def test_opt_in_adds_ninth_review_aid(self) -> None:
        output = {"inputManifestHash": RELEASE_MANIFEST, "schemaVersion":
                  "unresolved-family-run-review-v1", "codeRows": [1, 2, 3]}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_family_run_review",
                   return_value=output) as review:
            result, extractor, stage = ocr_table_v2.OcrTableV2ReleaseTests()._execute(
                self.lease(), row_profile=PROFILE_ID_V3, row_schema=SCHEMA_VERSION_V3)
        self.assertEqual(result["outputCount"], 9)
        self.assertEqual(result["unresolvedFamilyReview"], output)
        review.assert_called_once()
        extractor.assert_called_once_with(stage, stage_sha256="a" * 64,
                                          profile_id=PROFILE_ID_V3)

    def test_wrong_definition_and_manifest_fail_closed(self) -> None:
        old = self.lease()
        old["release"]["rules"]["definitions"]["unresolvedFamilyReview"]["codeCount"] = 4
        with self.assertRaisesRegex(ValueError, "unresolved family release rule definition"):
            ocr_table_v2.OcrTableV2ReleaseTests()._execute(old, row_profile=PROFILE_ID_V3,
                                               row_schema=SCHEMA_VERSION_V3)
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_unresolved_family_run_review",
                   return_value={"inputManifestHash": "b" * 64}):
            with self.assertRaisesRegex(ValueError, "unresolved family review manifest hash mismatch"):
                ocr_table_v2.OcrTableV2ReleaseTests()._execute(self.lease(), row_profile=PROFILE_ID_V3,
                                                   row_schema=SCHEMA_VERSION_V3)


if __name__ == "__main__":
    unittest.main()
