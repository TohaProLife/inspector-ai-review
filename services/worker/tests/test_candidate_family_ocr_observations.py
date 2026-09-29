from __future__ import annotations

import copy
import hashlib
import json
import unittest

from inspector_worker.candidate_family_ocr_observations import (
    evaluate_run_candidate_family_ocr_observations,
)
from inspector_worker.durable_ocr_layout import (PROFILE_HASH_V4, PROFILE_ID_V4, PROFILE_V4,
                                                 PROFILE_HASH_V5, PROFILE_ID_V5, PROFILE_V5)
from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OCR-REVIEW-OBJECT"
MANIFEST = "b" * 64


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def fixture(*, reviewed: bool = True, page_count: int = 1) -> tuple[list[dict], list[dict], dict]:
    source = {
        "sourceFileId": "source-A", "sha256": "a" * 64,
        "objectId": OBJECT, "stages": ["PD"], "sectionCode": "PZ",
        "revisionStatus": "CURRENT" if reviewed else "UNKNOWN",
        "approvalStatus": "APPROVED" if reviewed else "UNKNOWN", "pageStages": {},
    }
    pages = [
        {"pageNumber": number, "widthMilliPoints": 600000,
         "heightMilliPoints": 800000, "blocks": [], "quality": qualify_page_text([])}
        for number in range(1, page_count + 1)
    ]
    text = {
        "schemaVersion": "document-text-v2", "sourceFileId": source["sourceFileId"],
        "inputSha256": source["sha256"], "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": page_count, "textPageCount": 0,
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {"textLayerCandidatePageCount": 0,
                           "ocrRequiredPageCount": page_count}, "pages": pages,
    }
    entry = next(item for item in load_numeric_family_labels()["entries"]
                 if item["parameterCode"] == "PZ-002")
    attribute = entry["attributes"][0]
    line = f'{attribute["labels"][0]}: 42 {attribute["unitAliases"][0]}'
    ocr_page = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": source["sourceFileId"],
        "inputSha256": source["sha256"], "pageNumber": 1,
        "render": {"sha256": "c" * 64, "widthPx": 1000, "heightPx": 1334,
                   "dpi": 120, "rendererProfileId": PROFILE_V4["rendererProfileId"]},
        "provider": {"profileId": PROFILE_V4["ocrProviderProfileIds"][0],
                     "script": "eslav"},
        "lines": [{"text": line, "score": 0.95, "bboxPx": [10, 20, 300, 40]}],
    }
    ocr_page["contentHash"] = canonical_hash(ocr_page)
    analysis = {
        "schemaVersion": "bounded-ocr-layout-analysis-v4", "objectId": OBJECT,
        "inputManifestHash": MANIFEST, "profile": PROFILE_V4,
        "sources": [{"sourceFileId": source["sourceFileId"],
                     "sourceSha256": source["sha256"], "mediaType": "application/pdf",
                     "pageCount": page_count, "status": "SCANNED" if page_count == 1 else "PARTIALLY_SCANNED",
                     "ocrRequiredPageCount": page_count, "processedPageCount": 1,
                     "deferredPageCount": page_count - 1, "pages": [ocr_page]}],
        "sourceCount": 1, "ocrRequiredPageCount": page_count,
        "processedPageCount": 1, "deferredPageCount": page_count - 1,
        "skippedOversizePageCount": 0, "skippedUnsupportedSourceCount": 0,
        "skippedRenderPixelPageCount": 0, "subjectCandidatePageCount": 1,
        "titleRecoveryCandidatePageCount": 0,
    }
    stage = {
        "schemaVersion": "analysis-stage-result-v2", "jobType": "DOCUMENT_OCR_LAYOUT",
        "inputManifestHash": MANIFEST, "disposition": "OCR_LAYOUT_BOUNDED",
        "reasonCode": "BOUNDED_OCR_ONLY", "providerKind": "OCR_LAYOUT",
        "providerProfileId": PROFILE_ID_V4, "providerConfigHash": PROFILE_HASH_V4,
        "outputCount": 1, "analysis": analysis,
    }
    return [source], [text], stage


def run(sources: list[dict], text: list[dict], stage: dict) -> dict:
    return evaluate_run_candidate_family_ocr_observations(
        OBJECT, MANIFEST, sources, text, stage)


class CandidateFamilyOcrObservationTests(unittest.TestCase):
    def test_v5_four_page_sidecar_stays_review_only_and_rejects_fifth(self) -> None:
        sources, text, stage = fixture(page_count=5)
        stage["providerProfileId"] = PROFILE_ID_V5
        stage["providerConfigHash"] = PROFILE_HASH_V5
        analysis = stage["analysis"]
        analysis["schemaVersion"] = "bounded-ocr-layout-analysis-v5"
        analysis["profile"] = PROFILE_V5
        source_row = analysis["sources"][0]
        for number in (2, 3, 4):
            page = copy.deepcopy(source_row["pages"][0])
            page["pageNumber"] = number
            page["lines"] = []
            page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                                  if key != "contentHash"})
            source_row["pages"].append(page)
        source_row["processedPageCount"] = analysis["processedPageCount"] = stage["outputCount"] = 4
        source_row["deferredPageCount"] = analysis["deferredPageCount"] = 1
        result = run(sources, text, stage)
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["ocrProcessedPageCount"], 4)
        self.assertEqual(row["ocrDeferredPageCount"], 1)
        self.assertEqual(row["leadCount"], 1)
        self.assertTrue(all(item["status"] == "ABSTAIN" for item in result["codeRows"]))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])

        fifth = copy.deepcopy(source_row["pages"][3])
        fifth["pageNumber"] = 5
        fifth["contentHash"] = canonical_hash({key: value for key, value in fifth.items()
                                               if key != "contentHash"})
        source_row["pages"].append(fifth)
        source_row["processedPageCount"] = analysis["processedPageCount"] = stage["outputCount"] = 5
        source_row["deferredPageCount"] = analysis["deferredPageCount"] = 0
        with self.assertRaisesRegex(ValueError, "counts invalid"):
            run(sources, text, stage)

    def test_exact_ocr_lead_47_abstentions_and_deferred_unknown(self) -> None:
        sources, text, stage = fixture(page_count=2)
        result = run(sources, text, stage)
        self.assertEqual(result["schemaVersion"], "candidate-family-ocr-observations-v1")
        self.assertEqual(result["outputCount"], 47)
        self.assertEqual(result["ocrArtifactSha256"], digest(stage))
        self.assertEqual(result["contentHash"], digest({key: value for key, value
                                                        in result.items() if key != "contentHash"}))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertNotIn("typedFact", json.dumps(result))
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in result["codeRows"]))
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["leadCount"], 1)
        self.assertEqual(row["ocrProcessedPageCount"], 1)
        self.assertEqual(row["ocrDeferredPageCount"], 1)
        self.assertIn("OCR_DEFERRED_IN_SCOPE", row["reasonCodes"])
        lead = row["candidateLeads"][0]
        self.assertEqual(lead["sourceSha256"], sources[0]["sha256"])
        self.assertEqual(lead["ocrPageSha256"], stage["analysis"]["sources"][0]["pages"][0]["contentHash"])
        self.assertEqual(lead["coordinateSystem"], "IMAGE_TOP_LEFT_PIXELS")
        self.assertEqual(lead["locator"]["bboxPx"], [10, 20, 300, 40])
        self.assertEqual(lead["locator"]["score"], 0.95)
        self.assertEqual(lead["lineText"][lead["locator"]["start"]:lead["locator"]["end"]],
                         lead["rawValue"])
        self.assertEqual(lead["leadSha256"], digest({key: value for key, value
                                                     in lead.items() if key != "leadSha256"}))

    def test_unreviewed_and_mixed_stage_do_not_lead(self) -> None:
        sources, text, stage = fixture(reviewed=False)
        result = run(sources, text, stage)
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("SOURCE_REVISION_UNRESOLVED", row["reasonCodes"])
        sources[0]["revisionStatus"] = "CURRENT"
        sources[0]["approvalStatus"] = "APPROVED"
        sources[0]["stages"] = ["PD", "RD"]
        result = run(sources, text, stage)
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("SOURCE_PAGE_STAGE_UNRESOLVED", row["reasonCodes"])
        sources[0]["pageStages"] = {"1": "PD"}
        result = run(sources, text, stage)
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["leadCount"], 1)

    def test_changed_manifest_source_page_line_geometry_profile_rejected(self) -> None:
        sources, text, stage = fixture()
        changed = copy.deepcopy(stage)
        changed["inputManifestHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "identity"):
            run(sources, text, changed)
        changed = copy.deepcopy(stage)
        changed["analysis"]["sources"][0]["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "provenance"):
            run(sources, text, changed)
        changed = copy.deepcopy(stage)
        changed["analysis"]["sources"][0]["pages"][0]["lines"][0]["text"] += " forged"
        with self.assertRaisesRegex(ValueError, "contentHash"):
            run(sources, text, changed)
        changed = copy.deepcopy(stage)
        page = changed["analysis"]["sources"][0]["pages"][0]
        page["render"]["widthPx"] = 5
        page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                              if key != "contentHash"})
        with self.assertRaisesRegex(ValueError, "geometry"):
            run(sources, text, changed)
        changed = copy.deepcopy(stage)
        changed["providerConfigHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "profile"):
            run(sources, text, changed)
        changed = copy.deepcopy(stage)
        changed["analysis"]["sources"][0]["pages"][0]["pageNumber"] = 2
        with self.assertRaisesRegex(ValueError, "page number"):
            run(sources, text, changed)

    def test_line_score_is_bound_to_ocr_page_and_locator(self) -> None:
        sources, text, stage = fixture()
        changed = copy.deepcopy(stage)
        page = changed["analysis"]["sources"][0]["pages"][0]
        page["lines"][0]["score"] = 0.8
        with self.assertRaisesRegex(ValueError, "contentHash"):
            run(sources, text, changed)
        page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                              if key != "contentHash"})
        row = next(row for row in run(sources, text, changed)["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"][0]["locator"]["score"], 0.8)
        self.assertEqual(row["candidateLeads"][0]["ocrPageSha256"], page["contentHash"])

    def test_duplicate_label_abstains_without_false_absence(self) -> None:
        sources, text, stage = fixture()
        page = stage["analysis"]["sources"][0]["pages"][0]
        page["lines"].append({"text": page["lines"][0]["text"], "score": 0.91,
                              "bboxPx": [10, 45, 300, 65]})
        page["contentHash"] = canonical_hash({key: value for key, value in page.items()
                                              if key != "contentHash"})
        row = next(row for row in run(sources, text, stage)["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("AMBIGUOUS_PAGE_LABEL", row["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
