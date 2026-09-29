from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.durable_ocr_layout import (
    BoundedOcrLayoutAdapter,
    PROFILE_HASH_V5,
    PROFILE_HASH_V6,
    PROFILE_ID_V6,
    PROFILE_V6,
    select_v6_pages,
)
from inspector_worker.ocr_pilot import canonical_hash


def _text(source_id: str, source_sha: str, count: int) -> dict:
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source_id,
        "inputSha256": source_sha, "pageCount": count,
        "pages": [{"pageNumber": number, "widthMilliPoints": 595_000,
                   "heightMilliPoints": 842_000,
                   "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []}
                  for number in range(1, count + 1)],
    }


def _decision(source_sha: str, *, section: str = "AR", status: str = "CURRENT",
              approval: str = "APPROVED", page_stages: dict | None = None) -> dict:
    return {"sourceSha256": source_sha, "revisionStatus": status,
            "approvalStatus": approval, "linkGroupId": None,
            "sectionCode": section, "pageStages": page_stages or {},
            "basis": {"reference": "synthetic-reviewed-fixture"}}


def _source(source_id: str, count: int, *, stages: list[str] | None = None,
            section: str | None = "AR", size: int = 100) -> tuple:
    source_sha = source_id.lower() * 64
    return (source_id, source_sha, size, "application/pdf",
            stages or ["PD"], section, _text(source_id, source_sha, count))


class DurableOcrLayoutV6Tests(unittest.TestCase):
    def test_profile_pinned_and_v5_unchanged(self) -> None:
        self.assertEqual(PROFILE_HASH_V6, canonical_hash(PROFILE_V6))
        self.assertEqual(PROFILE_HASH_V6,
                         "ea7be21c64146e379183f7e01b047bb2fcbeb8882ee688158f5662ad0979ce21")
        self.assertEqual(PROFILE_HASH_V5,
                         "d7e4e78dcea591d30587022f9d57360e0cc227607f577ab10f896c69d94b37a7")

    def test_reviewed_round_robin_four_and_budget_reasons(self) -> None:
        sources = [_source("A", 4), _source("B", 4, section="VK", stages=["RD"])]
        decisions = {"A": _decision("a" * 64),
                     "B": _decision("b" * 64, section="VK")}
        result = select_v6_pages(sources[::-1], decisions)
        self.assertEqual(list(result), ["A", "B"])
        self.assertEqual(result["A"]["selected"], [1, 2])
        self.assertEqual(result["B"]["selected"], [1, 2])
        self.assertEqual(result["A"]["reviewEligiblePageCount"], 4)
        self.assertEqual(result["B"]["selectionReasonCodes"], ["PAGE_BUDGET_EXHAUSTED"])

    def test_missing_unknown_and_non_ar_vk_reviews_abstain(self) -> None:
        sources = [_source("A", 2, section=None), _source("B", 2),
                   _source("C", 2, section="KR")]
        decisions = {"B": _decision("b" * 64, status="UNKNOWN"),
                     "C": _decision("c" * 64, section="KR")}
        result = select_v6_pages(sources, decisions)
        self.assertEqual([value["selected"] for value in result.values()], [[], [], []])
        self.assertEqual(result["A"]["selectionReasonCodes"], ["SOURCE_REVIEW_REQUIRED"])
        self.assertEqual(result["B"]["selectionReasonCodes"],
                         ["SOURCE_REVIEW_NOT_CURRENT_APPROVED"])
        self.assertEqual(result["C"]["selectionReasonCodes"], ["SECTION_NOT_AR_VK"])

    def test_mixed_stage_needs_resolved_page_and_render_limit(self) -> None:
        source = _source("A", 4, stages=["PD", "RD"])
        source[6]["pages"][3]["widthMilliPoints"] = 10_000_000
        source[6]["pages"][3]["heightMilliPoints"] = 10_000_000
        decision = _decision("a" * 64, page_stages={
            "1": "PD", "2": "UNRESOLVED", "3": "RD", "4": "PD"})
        result = select_v6_pages([source], {"A": decision})["A"]
        self.assertEqual(result["selected"], [1, 3])
        self.assertEqual(result["reviewEligiblePageCount"], 3)
        self.assertEqual(result["stageUnresolvedPageCount"], 1)
        self.assertEqual(result["rasterSkipped"], 1)
        self.assertEqual(result["selectionReasonCodes"],
                         ["PAGE_STAGE_UNRESOLVED", "RENDER_PIXEL_LIMIT"])

    def test_bad_decision_metadata_fails_closed(self) -> None:
        source = _source("A", 2)
        decision = _decision("b" * 64)
        with self.assertRaisesRegex(ValueError, "decision is invalid"):
            select_v6_pages([source], {"A": decision})
        decision = _decision("a" * 64)
        decision["basis"] = {"reference": ""}
        with self.assertRaisesRegex(ValueError, "decision is invalid"):
            select_v6_pages([source], {"A": decision})
        decision = _decision("a" * 64, section="VK")
        with self.assertRaisesRegex(ValueError, "decision is invalid"):
            select_v6_pages([source], {"A": decision})
        decision = _decision("a" * 64, page_stages={"3": "PD"})
        with self.assertRaisesRegex(ValueError, "pageStages exceed"):
            select_v6_pages([source], {"A": decision})
        for page_key in ("01", "٠١", "0"):
            decision = _decision("a" * 64, page_stages={page_key: "PD"})
            with self.assertRaisesRegex(ValueError, "decision is invalid"):
                select_v6_pages([source], {"A": decision})
        decision = _decision("a" * 64, page_stages={"1": "RD"})
        with self.assertRaisesRegex(ValueError, "decision is invalid"):
            select_v6_pages([source], {"A": decision})
        with self.assertRaisesRegex(ValueError, "section requires a matching decision"):
            select_v6_pages([source], {})
        with self.assertRaisesRegex(ValueError, "unknown source"):
            select_v6_pages([source], {"X": _decision("a" * 64)})

    def test_v6_execution_uses_same_cache_and_emits_only_abstention_context(self) -> None:
        raw_source = {"sourceFileId": "A", "sha256": "a" * 64,
                      "byteSize": 100, "mediaType": "application/pdf", "stages": ["PD"],
                      "sectionCode": "AR", "downloadPath": "/api/internal/v1/jobs/job/inputs/A"}
        lease = {"inputManifestHash": "c" * 64, "objectId": "OBJECT-1",
                 "release": {"lifecycle": "DRAFT", "externalNetworkAllowed": False,
                             "providerSlot": {"stageJobType": "DOCUMENT_OCR_LAYOUT",
                                              "providerKind": "OCR_LAYOUT", "status": "CONFIGURED",
                                              "profileId": PROFILE_ID_V6, "adapterVersion": "6",
                                              "configHash": PROFILE_HASH_V6}},
                 "inputs": {"sourceFiles": [raw_source],
                            "sourceDecisions": {"A": _decision("a" * 64)}}}
        artifact = {"schemaVersion": "document-ocr-page-v1", "sourceFileId": "A",
                    "inputSha256": "a" * 64, "pageNumber": 1,
                    "render": {"sha256": "e" * 64, "widthPx": 992, "heightPx": 1404,
                               "dpi": PROFILE_V6["dpi"],
                               "rendererProfileId": PROFILE_V6["rendererProfileId"]},
                    "provider": {"profileId": PROFILE_V6["ocrProviderProfileIds"][0],
                                 "script": PROFILE_V6["script"]},
                    "lines": []}
        artifact["contentHash"] = canonical_hash(artifact)

        def download_stub(_url: str, path: Path, *_args: object) -> None:
            path.write_bytes(b"test pdf bytes")

        def cache_stub(**kwargs: object) -> tuple[dict, str]:
            page = {key: value for key, value in artifact.items() if key != "contentHash"}
            page["pageNumber"] = kwargs["page_number"]
            page["contentHash"] = canonical_hash(page)
            return page, "HIT"

        with patch.dict("os.environ", {"DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080",
                                    "OCR_LAYOUT_PROFILE_ID": PROFILE_V6["ocrProviderProfileIds"][0],
                                    "INSPECTOR_DURABLE_OCR_CACHE_ROOT": "/tmp/test-v6-cache"}), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   return_value=_text("A", "a" * 64, 2)), \
             patch("inspector_worker.durable_ocr_layout._download_source",
                   side_effect=download_stub), \
             patch("inspector_worker.durable_ocr_layout.cached_durable_ocr_page",
                   side_effect=cache_stub) as cache, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page") as recognize:
            result = BoundedOcrLayoutAdapter().execute(
                lease, {"attemptId": "v6", "fencingToken": 1})
        self.assertEqual(result["analysis"]["schemaVersion"], "bounded-ocr-layout-analysis-v6")
        self.assertEqual(result["analysis"]["reviewEligiblePageCount"], 2)
        self.assertEqual(result["analysis"]["deferredPageCount"], 0)
        self.assertEqual(result["analysis"]["sources"][0]["status"], "SCANNED")
        self.assertEqual([page["pageNumber"] for page in result["analysis"]["sources"][0]["pages"]],
                         [1, 2])
        self.assertEqual(cache.call_count, 2)
        recognize.assert_not_called()
        self.assertNotIn("findings", result)
        self.assertNotIn("parameterCoverage", result)

    def test_v6_missing_snapshot_defers_all_pages_without_pdf_download(self) -> None:
        raw_source = {"sourceFileId": "A", "sha256": "a" * 64,
                      "byteSize": 100, "mediaType": "application/pdf", "stages": ["PD"],
                      "sectionCode": None,
                      "downloadPath": "/api/internal/v1/jobs/job/inputs/A"}
        lease = {"inputManifestHash": "c" * 64, "objectId": "OBJECT-1",
                 "release": {"lifecycle": "DRAFT", "externalNetworkAllowed": False,
                             "providerSlot": {"stageJobType": "DOCUMENT_OCR_LAYOUT",
                                              "providerKind": "OCR_LAYOUT", "status": "CONFIGURED",
                                              "profileId": PROFILE_ID_V6, "adapterVersion": "6",
                                              "configHash": PROFILE_HASH_V6}},
                 "inputs": {"sourceFiles": [raw_source], "sourceDecisions": {}}}
        with patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   return_value=_text("A", "a" * 64, 2)), \
             patch("inspector_worker.durable_ocr_layout._download_source") as download, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page") as recognize:
            result = BoundedOcrLayoutAdapter().execute(
                lease, {"attemptId": "v6", "fencingToken": 1})
        self.assertEqual(result["analysis"]["ocrRequiredPageCount"], 2)
        self.assertEqual(result["analysis"]["deferredPageCount"], 2)
        self.assertEqual(result["analysis"]["processedPageCount"], 0)
        self.assertEqual(result["analysis"]["sources"][0]["status"],
                         "SKIPPED_SOURCE_REVIEW_REQUIRED")
        self.assertEqual(result["analysis"]["sources"][0]["selectionReasonCodes"],
                         ["SOURCE_REVIEW_REQUIRED"])
        download.assert_not_called()
        recognize.assert_not_called()


if __name__ == "__main__":
    unittest.main()
