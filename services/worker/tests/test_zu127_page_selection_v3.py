from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
from inspector_worker.zu127_page_selection_v3 import (
    _lexical_cues, select_zu127_review_pages, selected_poppler_page_scope,
)


SHA = "a" * 64
MANIFEST_SHA = "b" * 64


def digest(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def page(number: int, text: str) -> dict:
    blocks = ([{"text": text, "bboxMilliPoints": [1, 1, 500, 500]}] if text else [])
    return {"pageNumber": number, "widthMilliPoints": 595_000,
            "heightMilliPoints": 842_000, "blocks": blocks,
            "quality": qualify_page_text([text] if text else [],
                                          policy_version=TEXT_QUALITY_POLICY_VERSION)}


def fixture() -> tuple[list[dict], dict, list[dict]]:
    pages = [page(1, "Приведенное сопротивление теплопередаче. Окна и витражи."),
             page(2, "Коэффициент теплопередачи окон."), page(3, ""),
             page(4, "Сопротивление теплопередаче. Окна."),
             page(5, "Сопротивление теплопередаче. Витражи."),
             page(6, "Сопротивление теплопередаче. Окна.")]
    artifact = {"schemaVersion": "document-text-v2", "sourceFileId": "S1",
                "inputSha256": SHA, "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
                "pageCount": len(pages), "textPageCount": sum(bool(p["blocks"]) for p in pages),
                "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
                "qualitySummary": {
                    "textLayerCandidatePageCount": sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for p in pages),
                    "ocrRequiredPageCount": sum(p["quality"]["disposition"] == "OCR_REQUIRED" for p in pages),
                }, "pages": pages}
    source = {"sourceFileId": "S1", "sha256": SHA, "pageCount": len(pages),
              "byteSize": 100,
              "mediaType": "application/pdf", "stages": ["PD"],
              "sectionCode": "OTHER"}
    decision = {"sourceSha256": SHA, "revisionStatus": "CURRENT",
                "approvalStatus": "APPROVED", "sectionCode": "ZU",
                "pageStages": {}, "basis": {"reference": "synthetic reviewer basis"}}
    return [source], {"S1": decision}, [{"sourceFileId": "S1",
                                         "contentSha256": digest(artifact), "artifact": artifact}]


def run(sources=None, decisions=None, artifacts=None):
    defaults = fixture()
    return select_zu127_review_pages("OBJECT-1", MANIFEST_SHA,
                                     defaults[0] if sources is None else sources,
                                     defaults[1] if decisions is None else decisions,
                                     defaults[2] if artifacts is None else artifacts)


class Zu127PageSelectionV3Tests(unittest.TestCase):
    def test_selects_bounded_review_navigation_and_reports_deferred(self) -> None:
        result = run()
        self.assertEqual(result["schemaVersion"], "zu127-page-selection-v3")
        self.assertEqual(result["status"], "ABSTAIN")
        self.assertEqual(result["sourceRows"][0]["candidatePageCount"], 4)
        self.assertEqual(result["sourceRows"][0]["selectedPageNumbers"], [1, 4, 5, 6])
        self.assertEqual(result["sourceRows"][0]["ocrRequiredDeferredPageNumbers"], [3])
        self.assertEqual(result["sourceRows"][0]["truncatedCandidatePageCount"], 0)
        self.assertEqual(result["deferredOcrRequiredPageCount"], 1)
        self.assertEqual(result["selectedPageCount"], 4)
        self.assertIsNone(result["findings"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertIsNone(result["typedFacts"])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))

    def test_budget_does_not_hide_unselected_candidates(self) -> None:
        sources, decisions, artifacts = fixture()
        entry = artifacts[0]
        artifact = entry["artifact"]
        artifact["pages"].append(page(7, "Сопротивление теплопередаче. Окна."))
        artifact["pageCount"] = 7
        artifact["textPageCount"] += 1
        artifact["qualitySummary"]["textLayerCandidatePageCount"] += 1
        sources[0]["pageCount"] = 7
        entry["contentSha256"] = digest(artifact)
        row = run(sources, decisions, artifacts)["sourceRows"][0]
        self.assertEqual(row["candidatePageCount"], 5)
        self.assertEqual(row["selectedPageNumbers"], [1, 4, 5, 6])
        self.assertEqual(row["truncatedCandidatePageCount"], 1)
        self.assertIn("PAGE_SELECTION_TRUNCATED", row["reasonCodes"])

    def test_missing_or_ambiguous_review_never_scans_pages(self) -> None:
        sources, decisions, artifacts = fixture()
        for bad in (None,
                    {**decisions["S1"], "approvalStatus": "UNKNOWN"},
                    {**decisions["S1"], "sectionCode": "OTHER"},
                    {**decisions["S1"], "basis": {"reference": ""}}):
            with self.subTest(bad=bad):
                these = {} if bad is None else {"S1": bad}
                row = run(sources, these, artifacts)["sourceRows"][0]
                self.assertEqual(row["selectedPageNumbers"], [])
                self.assertIsNone(row["candidatePageCount"])
                self.assertIsNone(row["ocrRequiredDeferredPageNumbers"])
                self.assertIn(row["reasonCodes"][0], {
                    "SOURCE_REVIEW_REQUIRED", "SOURCE_REVIEW_NOT_CURRENT_APPROVED",
                    "SOURCE_SECTION_REVIEW_REQUIRED"})

    def test_mixed_stage_requires_complete_pd_page_review(self) -> None:
        sources, decisions, artifacts = fixture()
        sources[0]["stages"] = ["PD", "RD"]
        row = run(sources, decisions, artifacts)["sourceRows"][0]
        self.assertEqual(row["selectedPageNumbers"], [])
        self.assertIsNone(row["candidatePageCount"])
        decisions["S1"]["pageStages"] = {str(n): "PD" for n in range(1, 7)}
        self.assertEqual(run(sources, decisions, artifacts)["sourceRows"][0]["selectedPageNumbers"],
                         [1, 4, 5, 6])

    def test_provenance_and_page_tamper_rejected(self) -> None:
        sources, decisions, artifacts = fixture()
        for mutation in ("source_hash", "artifact_hash", "receipt", "duplicate_page",
                         "page_count", "duplicate_source", "unknown_decision"):
            with self.subTest(mutation=mutation):
                s, d, a = copy.deepcopy((sources, decisions, artifacts))
                if mutation == "source_hash":
                    s[0]["sha256"] = "c" * 64
                elif mutation == "artifact_hash":
                    a[0]["artifact"]["inputSha256"] = "c" * 64
                elif mutation == "receipt":
                    a[0]["contentSha256"] = "c" * 64
                elif mutation == "duplicate_page":
                    a[0]["artifact"]["pages"][1]["pageNumber"] = 1
                    a[0]["contentSha256"] = digest(a[0]["artifact"])
                elif mutation == "page_count":
                    s[0]["pageCount"] = 7
                elif mutation == "duplicate_source":
                    s.append(copy.deepcopy(s[0]))
                elif mutation == "unknown_decision":
                    d["OTHER"] = copy.deepcopy(d["S1"])
                with self.assertRaises(ValueError):
                    run(s, d, a)

    def test_original_public_f0152_text_leads_are_only_lexical(self) -> None:
        root = Path(__file__).resolve().parents[3]
        directory = root / "output/singleton-unresolved-audit-20260928"
        if not directory.exists():
            self.skipTest("local audited public F0152 text excerpt unavailable")
        for number in (49, 51):
            text = (directory / f"F0152-p{number}.txt").read_text(encoding="utf-8")
            self.assertEqual(_lexical_cues({"blocks": [{"text": text}]}), (True, True))

    def test_selection_hands_only_selected_pages_to_bounded_poppler_provider(self) -> None:
        result = run()
        scope = selected_poppler_page_scope(result, "S1")
        self.assertEqual(scope, {"expected_sha256": SHA, "expected_byte_size": 100,
                                 "expected_page_count": 6, "page_numbers": [1, 4, 5, 6]})
        # The selector and handoff are pure; only the separately gated provider
        # can read a PDF. This mock checks the exact source/page boundary.
        with patch("inspector_worker.poppler_page_evidence.extract_poppler_page_evidence") as extract:
            extract(Path("/unopened/immutable.pdf"), **scope)
            self.assertEqual(extract.call_args.kwargs, scope)
        tampered = copy.deepcopy(result)
        tampered["sourceRows"][0]["selectedPageNumbers"] = [1, 4, 5]
        with self.assertRaisesRegex(ValueError, "handoff invalid"):
            selected_poppler_page_scope(tampered, "S1")
        sources, decisions, artifacts = fixture()
        with self.assertRaisesRegex(ValueError, "not eligible"):
            selected_poppler_page_scope(run(sources, {}, artifacts), "S1")

    def test_multiple_sources_share_one_budget_without_losing_counts(self) -> None:
        sources, decisions, artifacts = fixture()
        second_source = copy.deepcopy(sources[0])
        second_source.update(sourceFileId="S2", sha256="c" * 64)
        second_decision = copy.deepcopy(decisions["S1"])
        second_decision["sourceSha256"] = "c" * 64
        second_artifact = copy.deepcopy(artifacts[0])
        second_artifact["sourceFileId"] = "S2"
        second_artifact["artifact"]["sourceFileId"] = "S2"
        second_artifact["artifact"]["inputSha256"] = "c" * 64
        second_artifact["contentSha256"] = digest(second_artifact["artifact"])
        result = run([second_source, sources[0]], {"S2": second_decision,
                                                  "S1": decisions["S1"]},
                     [second_artifact, artifacts[0]])
        self.assertEqual([row["sourceFileId"] for row in result["sourceRows"]], ["S1", "S2"])
        self.assertEqual(result["scannedCandidatePageCount"], 8)
        self.assertEqual(result["selectedPageCount"], 4)
        self.assertEqual(result["deferredOcrRequiredPageCount"], 2)
        self.assertEqual(result["truncatedCandidatePageCount"], 4)
        self.assertEqual(result["sourceRows"][1]["selectedPageNumbers"], [])

    def test_source_page_limit_rejects_overflow_before_artifact_scan(self) -> None:
        sources, decisions, artifacts = fixture()
        sources[0]["pageCount"] = 2_001
        with self.assertRaisesRegex(ValueError, "source metadata invalid"):
            run(sources, decisions, artifacts)


if __name__ == "__main__":
    unittest.main()
