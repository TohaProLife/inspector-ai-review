from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.source_review_packet import (
    SourceReviewPacketError, build_source_review_packet,
)


class SourceReviewPacketTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "manifest.jsonl"
        self.matrix_path = self.root / "matrix.json"
        self.title_path = self.root / "titles.json"
        self.rows = []
        for number in range(1, 21):
            source_id = f"F{number:04d}"
            stage = "RD_ID_MIXED" if number in {2, 3} else "RD" if number == 5 else "PD"
            section = "OV" if number == 2 else "AR" if number == 4 else "OTHER"
            self.rows.append({
                "file_id": source_id, "object_id": "OBJ-SYNTHETIC",
                "stage": stage, "section": section,
                "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                "label_visibility": "PUBLIC_TRAIN", "extension": ".pdf",
                "relative_path": f"{source_id}.pdf", "size_bytes": 100,
                "sha256": f"{number:064x}", "pdf_pages": 1,
            })
        self.rows.append({
            "file_id": "F0194", "object_id": "OBJ-SYNTHETIC",
            "stage": "UNKNOWN", "section": "OTHER",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "extension": ".txt",
            "relative_path": "answers.txt", "size_bytes": 100,
            "sha256": "f" * 64, "pdf_pages": None,
            "annotation_status": "GROUND_TRUTH_INDEX",
        })
        self.manifest.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in self.rows),
            encoding="utf-8")
        self.manifest_sha = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        pdfs = self.rows[:-1]
        pd_ids = [row["file_id"] for row in pdfs if row["stage"] == "PD"]
        self.matrix = {
            "schemaVersion": "candidate-source-matrix-v1",
            "disposition": "SOURCE_PLANNING_ONLY_ABSTAIN",
            "manifestSha256": self.manifest_sha,
            "candidatePackSha256": "d" * 64,
            "inventory": {"publicSources": 21, "publicPdfSources": 20,
                          "publicPdfPages": 20, "metadataOnlySourceId": "F0194"},
            "codes": [],
        }
        for code, expected_mark, actual_mark in (
                ("PZ-002", "PZ", "AR"),
                ("PZ-017", "PZ", "OV"),
                ("ZU-124", "ZU", "OV")):
            self.matrix["codes"].append({
                "parameterCode": code, "disposition": "SOURCE_PLANNING_ONLY_ABSTAIN",
                "objects": [{
                    "objectId": "OBJ-SYNTHETIC",
                    "expected": {"stage": "PD", "requiredDrawingSections": [expected_mark],
                                 "requiredManifestSections": [],
                                 "unresolvedSectionSourceIds": pd_ids,
                                 "mixedStageSourceIds": [],
                                 "mixedStageUnclassifiedSourceIds": []},
                    "actual": {"stage": "RD", "requiredDrawingSections": [actual_mark],
                               "requiredManifestSections": [],
                               "unresolvedSectionSourceIds": ["F0005"],
                               "mixedStageSourceIds": ["F0002"],
                               "mixedStageUnclassifiedSourceIds": ["F0003"]},
                }],
            })
        source_reports = [{
            "sourceFileId": row["file_id"], "sourceSha256": row["sha256"],
            "objectId": row["object_id"], "manifestStage": row["stage"],
            "manifestSection": row["section"], "titlePagesScanned": 1,
        } for row in pdfs]
        proposals = []
        for row in pdfs[1:]:
            source_id = row["file_id"]
            if source_id == "F0002":
                raw, stage_hints, ciphers = ("РД-ОВ", [], [{
                    "stage": "RD", "drawingSection": "OV", "literal": "РД-ОВ"}])
            elif source_id == "F0003":
                raw, stage_hints, ciphers = ("РД-ВВ", [], [{
                    "stage": "RD", "drawingSection": "VV", "literal": "РД-ВВ"}])
            else:
                raw = "РАБОЧАЯ ДОКУМЕНТАЦИЯ" if row["stage"] == "RD" else "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ"
                stage_hints = ["RD"] if row["stage"] == "RD" else ["PD"]
                ciphers = []
            proposals.append({
                "sourceFileId": source_id, "sourceSha256": row["sha256"],
                "objectId": row["object_id"], "manifestStage": row["stage"],
                "manifestSection": row["section"], "pageNumber": 1,
                "pageArtifactSha256": "a" * 64,
                "locatorKind": "LINE", "blockIndex": 0, "lineIndex": 0,
                "bboxMilliPoints": [100, 100, 300, 130],
                "rawText": raw, "stagePhraseHints": stage_hints,
                "cipherHints": ciphers, "reviewStatus": "UNVERIFIED_PROPOSAL",
            })
        first = pdfs[0]
        ocr = [{
            "proposalKind": "OCR_PROPOSAL", "sourceFileId": "F0001",
            "sourceSha256": first["sha256"], "objectId": first["object_id"],
            "manifestStage": "PD", "manifestSection": "OTHER",
            "pageNumber": 1, "pageDisposition": "OCR_REQUIRED",
            "coordinateSystem": "IMAGE_TOP_LEFT_PIXELS",
            "indexedPageArtifactSha256": "a" * 64,
            "ocrArtifactContentHash": "b" * 64,
            "cacheKey": "f" * 64, "cacheContentHash": "c" * 64,
            "ocrEvidenceSha256": "d" * 64,
            "render": {"sha256": "a" * 64, "widthPx": 1000, "heightPx": 1000,
                       "dpi": 120, "rendererProfileId": "renderer-test-v1"},
            "provider": {"profileId": "ocr-test-v1", "script": "eslav"},
            "selectedLineIndices": [0, 1], "selectedLines": [
                {"lineIndex": 0, "text": "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ", "score": 0.99,
                 "bboxPx": [100, 100, 400, 130], "stagePhraseHints": ["PD"],
                 "sectionTitleHints": [], "cipherHints": []},
                {"lineIndex": 1, "text": "Раздел 1. Пояснительная записка", "score": 0.96,
                 "bboxPx": [100, 180, 550, 210], "stagePhraseHints": [],
                 "sectionTitleHints": ["PZ"], "cipherHints": []},
            ],
            "reviewStatus": "UNVERIFIED_PROPOSAL",
        }]
        self.title = {
            "schemaVersion": "public-title-proposals-v2",
            "disposition": "REVIEW_ONLY_ABSTAIN",
            "manifestSha256": self.manifest_sha,
            "auditSha256": "e" * 64, "indexVersionHash": "index-test-v1",
            "truncated": False, "findingCount": None, "parameterCoverage": None,
            "sourceReports": source_reports, "proposals": proposals,
            "ocrProposals": ocr,
            "totals": {"publicPdfSources": 20, "proposalsReturned": len(proposals),
                       "ocrProposalsReturned": len(ocr)},
        }
        self.write_reports()

    def write_reports(self) -> None:
        self.matrix_path.write_text(json.dumps(self.matrix, ensure_ascii=False, sort_keys=True),
                                    encoding="utf-8")
        self.title_path.write_text(json.dumps(self.title, ensure_ascii=False, sort_keys=True),
                                   encoding="utf-8")
        self.matrix_sha = hashlib.sha256(self.matrix_path.read_bytes()).hexdigest()
        self.title_sha = hashlib.sha256(self.title_path.read_bytes()).hexdigest()

    def build(self, **overrides: object) -> dict:
        options = {
            "target_sources": 20,
            "_expected_manifest_sha256": self.manifest_sha,
            "_expected_matrix_sha256": self.matrix_sha,
            "_expected_title_sha256": self.title_sha,
            "_expected_pack_sha256": "d" * 64,
            "_expected_counts": {"sourceCount": 21, "pdfSources": 20,
                                 "pdfPages": 20, "txtInventorySources": 1},
            "_expected_code_count": 3,
        }
        options.update(overrides)
        return build_source_review_packet(
            self.manifest, self.matrix_path, self.title_path, **options)

    def test_packet_ranks_explicit_cues_and_preserves_review_only_status(self) -> None:
        report = self.build()
        self.assertEqual(report, self.build())
        self.assertEqual(report["totals"]["selectedSources"], 20)
        self.assertEqual(report["totals"]["sourcesWithExplicitTitleSectionAlignment"], 2)
        self.assertEqual(report["disposition"], "HUMAN_REVIEW_ONLY_ABSTAIN")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertNotIn("F0194", {item["sourceFileId"] for item in report["sources"]})
        first_two = {item["sourceFileId"] for item in report["sources"][:2]}
        self.assertEqual(first_two, {"F0001", "F0002"})
        ocr = next(item for item in report["sources"] if item["sourceFileId"] == "F0001")
        self.assertEqual(ocr["titleAlignedCodeList"], ["PZ-002", "PZ-017"])
        self.assertEqual(ocr["manifestSection"], "OTHER")
        self.assertEqual(ocr["titleLocators"][1]["bboxPx"], [100, 180, 550, 210])
        self.assertEqual(ocr["titleLocators"][1]["ocrArtifactContentHash"], "b" * 64)
        vv = next(item for item in report["sources"] if item["sourceFileId"] == "F0003")
        self.assertEqual(vv["titleAlignedCodeRoleCount"], 0)
        self.assertIn("TITLE_SECTION_WITHOUT_MANIFEST_MAPPING",
                      {x["kind"] for x in vv["conflictingTitleLabels"]})

    def test_all_sources_retains_every_title_backed_candidate(self) -> None:
        report = self.build(target_sources=None)
        self.assertEqual(report["totals"]["selectedSources"],
                         report["totals"]["titleBackedAmbiguousSources"])
        self.assertEqual(report["totals"]["targetSources"],
                         report["totals"]["selectedSources"])
        self.assertEqual(len({item["sourceFileId"] for item in report["sources"]}),
                         report["totals"]["selectedSources"])
        self.assertTrue(all(item["sourceGateStatus"] == "UNVERIFIED_REVIEW_ONLY"
                            for item in report["sources"]))

    def test_all_sources_includes_ambiguous_source_without_title_cue(self) -> None:
        self.title["proposals"] = [proposal for proposal in self.title["proposals"]
                                    if proposal["sourceFileId"] != "F0020"]
        self.title["totals"]["proposalsReturned"] = len(self.title["proposals"])
        self.write_reports()
        report = self.build(target_sources=None)
        self.assertEqual(report["totals"]["ambiguousSources"], 20)
        self.assertEqual(report["totals"]["titleBackedAmbiguousSources"], 19)
        self.assertEqual(report["totals"]["sourcesWithoutTitleCue"], 1)
        uncued = next(item for item in report["sources"]
                       if item["sourceFileId"] == "F0020")
        self.assertEqual(uncued["priorityTier"], "NO_TITLE_CUE_REVIEW")
        self.assertEqual(uncued["titleLocators"], [])
        self.assertEqual(uncued["sourceGateStatus"], "UNVERIFIED_REVIEW_ONLY")

    def test_report_sha_and_public_scope_fail_closed(self) -> None:
        original = self.title_path.read_bytes()
        self.title_path.write_bytes(original + b" ")
        with self.assertRaisesRegex(SourceReviewPacketError, "SHA-256"):
            self.build()
        self.title_path.write_bytes(original)
        self.manifest.write_bytes(self.manifest.read_bytes() + b"\n")
        with self.assertRaisesRegex(SourceReviewPacketError, "manifest SHA-256"):
            self.build()

    def test_rehashed_wrong_ocr_geometry_and_source_identity_fail_closed(self) -> None:
        self.title["ocrProposals"][0]["selectedLines"][1]["bboxPx"] = [100, 180, 1001, 210]
        self.write_reports()
        with self.assertRaisesRegex(SourceReviewPacketError, "pixel locator"):
            self.build()
        self.title["ocrProposals"][0]["selectedLines"][1]["bboxPx"] = [100, 180, 550, 210]
        self.title["proposals"][0]["sourceSha256"] = "0" * 64
        self.write_reports()
        with self.assertRaisesRegex(SourceReviewPacketError, "differs from manifest"):
            self.build()

    def test_title_and_matrix_cannot_promote_status_or_add_hidden_source(self) -> None:
        self.title["findingCount"] = 1
        self.write_reports()
        with self.assertRaisesRegex(SourceReviewPacketError, "title report identity"):
            self.build()
        self.title["findingCount"] = None
        self.matrix["codes"][0]["objects"][0]["expected"]["unresolvedSectionSourceIds"].append("F0194")
        self.write_reports()
        with self.assertRaisesRegex(SourceReviewPacketError, "outside manifest scope"):
            self.build()


if __name__ == "__main__":
    unittest.main()
