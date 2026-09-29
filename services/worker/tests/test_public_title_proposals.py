from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.public_document_index import build_public_index
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.public_ocr_cache import _cache_request
from inspector_worker.public_title_proposals import (
    PublicTitleProposalError, build_public_title_proposals, explicit_title_cues,
)


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "public_index_audit_for_titles", ROOT / "scripts/audit-public-document-index.py")
assert SPEC and SPEC.loader
AUDIT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT_MODULE)


@requires_posix_storage
class PublicTitleProposalTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit = self.root / "audit.json"
        self.rows = [
            self._pdf("F0105", "PD", "OV", ["PROJECT TITLE 0001-PD-OV", "EXTRA PAGE"]),
            self._pdf("F0201", "RD_ID_MIXED", "OV", ["0002-RD-OV1"]),
            self._pdf("F0202", "RD_ID_MIXED", "OTHER", ["0003-RD-VV"]),
            self._pdf("F0203", "RD_ID_MIXED", "VK", ["0004-RD-VK"]),
            self._pdf("F0150", "PD", "OTHER", [""]),
        ]
        answers = self.materials / "answers.txt"
        answers.write_text("private-answer-sentinel", encoding="utf-8")
        self.rows.append({
            "file_id": "F0194", "object_id": "OBJ-1", "stage": "UNKNOWN",
            "section": "OTHER", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "relative_path": answers.name, "extension": ".txt",
            "size_bytes": answers.stat().st_size,
            "sha256": hashlib.sha256(answers.read_bytes()).hexdigest(),
            "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX",
        })
        self.manifest.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in self.rows),
            encoding="utf-8",
        )
        result = build_public_index(self.manifest, self.index,
                                    materials_root=self.materials)
        self.assertEqual(result["completeSources"], 5)
        audit = AUDIT_MODULE.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(audit["status"], "PASS", audit["findings"])
        self.audit.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")

    def _pdf(self, source_id: str, stage: str, section: str,
             pages: list[str]) -> dict:
        path = self.materials / f"{source_id}.pdf"
        document = fitz.open()
        for text in pages:
            page = document.new_page()
            page.insert_text((40, 90), text, fontsize=10)
        document.save(path)
        document.close()
        return {"file_id": source_id, "object_id": "OBJ-1", "stage": stage,
                "section": section, "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": path.name, "extension": ".pdf",
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pdf_pages": len(pages), "annotation_status": "UNLABELED"}

    def _report(self, **options: object) -> dict:
        return build_public_title_proposals(
            self.manifest, self.index, self.audit,
            _expected_counts={"sourceCount": 6, "pdfSources": 5,
                              "pdfPages": 6, "txtInventorySources": 1},
            _expected_manifest_sha256=hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
            **options,
        )

    def test_literal_stage_phrase_and_cipher_boundaries(self) -> None:
        cues = explicit_title_cues("РАБОЧАЯ\nДОКУМЕНТАЦИЯ. Шифр 02543-РД-ОВ")
        self.assertEqual(cues["stagePhraseHints"], ["RD"])
        self.assertEqual(cues["cipherHints"],
                         [{"stage": "RD", "drawingSection": "OV", "literal": "РД-ОВ"}])
        self.assertEqual(explicit_title_cues("abcРД-ОВ"),
                         {"stagePhraseHints": [], "cipherHints": []})
        self.assertEqual(explicit_title_cues("Кр-10"),
                         {"stagePhraseHints": [], "cipherHints": []})
        self.assertEqual(explicit_title_cues("-РД-ВВ")["cipherHints"][0]["drawingSection"],
                         "VV")
        self.assertEqual(explicit_title_cues("-РД-ВК")["cipherHints"][0]["drawingSection"],
                         "VK")
        self.assertEqual(explicit_title_cues("АНО/150321/1-РД-ОВ2.1")["cipherHints"],
                         [{"stage": "RD", "drawingSection": "OV", "literal": "РД-ОВ2.1"}])
        self.assertEqual(explicit_title_cues("-РД-ОВ1А")["cipherHints"], [])
        self.assertEqual(explicit_title_cues("ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ")["stagePhraseHints"],
                         ["PD"])

    def test_title_pages_include_mixed_stage_without_promotion(self) -> None:
        report = self._report()
        self.assertEqual(report["disposition"], "REVIEW_ONLY_ABSTAIN")
        self.assertEqual(report["totals"]["publicPdfSources"], 5)
        self.assertEqual(report["totals"]["titlePagesScanned"], 6)
        self.assertEqual(report["totals"]["proposalsReturned"], 4)
        self.assertFalse(report["truncated"])
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertNotIn("private-answer-sentinel", json.dumps(report))
        self.assertNotIn("F0194", {item["sourceFileId"] for item in report["proposals"]})
        by_id = {item["sourceFileId"]: item for item in report["proposals"]}
        self.assertEqual(by_id["F0201"]["manifestStage"], "RD_ID_MIXED")
        self.assertEqual(by_id["F0201"]["cipherHints"][0]["stage"], "RD")
        self.assertEqual(by_id["F0201"]["rawText"], "0002-RD-OV1")
        self.assertIn("MANIFEST_STAGE_MIXED_REVIEW_REQUIRED",
                      by_id["F0201"]["ambiguityFlags"])
        self.assertEqual(by_id["F0202"]["cipherHints"][0]["drawingSection"], "VV")
        self.assertIn("SECTION_MARK_WITHOUT_EXACT_MANIFEST_CATEGORY",
                      by_id["F0202"]["ambiguityFlags"])
        self.assertEqual(by_id["F0203"]["possibleManifestSections"], ["VK"])
        self.assertEqual(len(by_id["F0203"]["pageArtifactSha256"]), 64)
        self.assertEqual(len(by_id["F0203"]["bboxMilliPoints"]), 4)

    def test_pages_and_proposals_are_bounded_with_visible_truncation(self) -> None:
        first = self._report(pages_per_source=1)
        self.assertEqual(first["totals"]["titlePagesScanned"], 5)
        capped = self._report(max_proposals=1)
        self.assertEqual(capped["totals"]["proposalsReturned"], 1)
        self.assertEqual(capped["totals"]["proposalsOmitted"], 3)
        self.assertTrue(capped["truncated"])
        for options in ({"pages_per_source": 0}, {"pages_per_source": 4},
                        {"max_proposals": 0}, {"max_proposals": 1201}):
            with self.subTest(options=options), self.assertRaises(PublicTitleProposalError):
                self._report(**options)
        with patch("inspector_worker.public_title_proposals.MAX_TEXT_CHARACTERS", 3):
            skipped = self._report()
        self.assertGreater(skipped["totals"]["overlongTextUnitsOmitted"], 0)
        self.assertTrue(skipped["truncated"])

    def test_audit_and_manifest_tampering_fail_closed(self) -> None:
        original = json.loads(self.audit.read_text(encoding="utf-8"))
        for mutate in (lambda x: x.update(status="INCOMPLETE"),
                       lambda x: x.update(indexVersionHash="0" * 20),
                       lambda x: x["actual"].update(indexedPages=4),
                       lambda x: x["sources"][0].update(issueCount=1)):
            changed = json.loads(json.dumps(original))
            mutate(changed)
            self.audit.write_text(json.dumps(changed), encoding="utf-8")
            with self.subTest(mutate=mutate), self.assertRaises(PublicTitleProposalError):
                self._report()
        self.audit.write_text(json.dumps(original), encoding="utf-8")
        self.manifest.write_bytes(self.manifest.read_bytes() + b"\n")
        with self.assertRaisesRegex(PublicTitleProposalError, "SHA"):
            self._report()

    def test_tampered_page_artifact_fails(self) -> None:
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0201' AND page_number=1"
            ).fetchone()
        path = self.index / relative
        path.write_bytes(path.read_bytes() + b"tampered")
        with self.assertRaisesRegex(PublicTitleProposalError, "artifact"):
            self._report()

    def _ocr_fixture(self) -> tuple[Path, dict, Path]:
        row = next(row for row in self.rows if row["file_id"] == "F0150")
        cache_root = self.root / "ocr-cache"
        selection = {
            "sourceFileId": "F0150", "pageNumber": 1,
            "lineIndices": [2, 0, 1], "dpi": 120, "script": "eslav",
            "rendererProfileId": "renderer-test-v1",
            "providerProfileId": "ocr-test-v1",
        }
        request = _cache_request(row, 1, 120, "eslav",
                                 "renderer-test-v1", "ocr-test-v1")
        key = canonical_hash(request)
        path = cache_root / key[:2] / key[2:4] / f"{key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        artifact = {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": "F0150",
            "inputSha256": row["sha256"], "pageNumber": 1,
            "render": {"sha256": "a" * 64, "widthPx": 1000, "heightPx": 1000,
                       "dpi": 120, "rendererProfileId": "renderer-test-v1"},
            "provider": {"profileId": "ocr-test-v1", "script": "eslav"},
            "lines": [
                {"text": "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ", "score": 0.99,
                 "bboxPx": [100, 300, 600, 330]},
                {"text": "Раздел 1. Пояснительная записка", "score": 0.96,
                 "bboxPx": [110, 380, 610, 410]},
                {"text": "КОРРЕКТИРОВКА 1", "score": 0.91,
                 "bboxPx": [200, 200, 500, 230]},
            ],
        }
        artifact["contentHash"] = canonical_hash(artifact)
        payload = {"schemaVersion": "public-ocr-page-cache-v1",
                   "request": request, "artifact": artifact}
        payload["contentHash"] = canonical_hash(payload)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return cache_root, selection, path

    def test_selected_ocr_title_remains_review_only_with_pixel_geometry(self) -> None:
        cache, selection, path = self._ocr_fixture()
        before = path.read_bytes()
        report = self._report(ocr_selections=[selection], ocr_cache_root=cache)
        self.assertEqual(report, self._report(ocr_selections=[selection], ocr_cache_root=cache))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(report["schemaVersion"], "public-title-proposals-v2")
        self.assertEqual(report["totals"]["ocrSelectedPages"], 1)
        self.assertEqual(report["totals"]["ocrProposalsReturned"], 1)
        self.assertEqual(len(report["ocrProposals"]), 1)
        proposal = report["ocrProposals"][0]
        self.assertEqual(proposal["proposalKind"], "OCR_PROPOSAL")
        self.assertEqual(proposal["manifestStage"], "PD")
        self.assertEqual(proposal["manifestSection"], "OTHER")
        self.assertEqual(proposal["stagePhraseHints"], ["PD"])
        self.assertEqual(proposal["sectionTitleHints"], ["PZ"])
        self.assertEqual(proposal["possibleManifestSections"], ["PZ"])
        self.assertEqual(proposal["coordinateSystem"], "IMAGE_TOP_LEFT_PIXELS")
        self.assertEqual(proposal["selectedLineIndices"], [0, 1, 2])
        self.assertEqual(proposal["selectedLines"][1]["bboxPx"], [110, 380, 610, 410])
        self.assertIn("MANIFEST_SECTION_UNCLASSIFIED", proposal["ambiguityFlags"])
        self.assertEqual(len(proposal["ocrArtifactContentHash"]), 64)
        self.assertEqual(len(proposal["indexedPageArtifactSha256"]), 64)
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertNotIn("ocrProposals", self._report())

    def test_ocr_title_selection_and_cache_integrity_fail_closed(self) -> None:
        cache, selection, path = self._ocr_fixture()
        for changed in (
            {**selection, "sourceFileId": "F0194"},
            {**selection, "sourceFileId": "F0201"},
            {**selection, "pageNumber": 2},
            {**selection, "lineIndices": [0, 0]},
            {**selection, "lineIndices": list(range(33))},
            {**selection, "providerProfileId": "wrong-profile"},
        ):
            with self.subTest(changed=changed), self.assertRaises(PublicTitleProposalError):
                self._report(ocr_selections=[changed], ocr_cache_root=cache)
        with self.assertRaises(PublicTitleProposalError):
            self._report(ocr_selections=[selection, selection], ocr_cache_root=cache)
        with self.assertRaises(PublicTitleProposalError):
            self._report(ocr_cache_root=cache)
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["artifact"]["lines"][1]["text"] = "forged title"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(PublicTitleProposalError):
            self._report(ocr_selections=[selection], ocr_cache_root=cache)

        for mutate in (
            lambda artifact: artifact["lines"][1].update(bboxPx=[110, 380, 1001, 410]),
            lambda artifact: artifact["provider"].update(profileId="wrong-profile"),
            lambda artifact: artifact.update(inputSha256="0" * 64),
        ):
            _, _, path = self._ocr_fixture()
            payload = json.loads(path.read_text(encoding="utf-8"))
            mutate(payload["artifact"])
            payload["artifact"]["contentHash"] = canonical_hash({
                key: value for key, value in payload["artifact"].items()
                if key != "contentHash"})
            payload["contentHash"] = canonical_hash({
                key: value for key, value in payload.items() if key != "contentHash"})
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with self.subTest(mutate=mutate), self.assertRaises(PublicTitleProposalError):
                self._report(ocr_selections=[selection], ocr_cache_root=cache)

    def test_ocr_selection_without_literal_title_cue_is_not_negative_proof(self) -> None:
        cache, selection, path = self._ocr_fixture()
        payload = json.loads(path.read_text(encoding="utf-8"))
        for line in payload["artifact"]["lines"]:
            line["text"] = "neutral line"
        payload["artifact"]["contentHash"] = canonical_hash({
            key: value for key, value in payload["artifact"].items()
            if key != "contentHash"})
        payload["contentHash"] = canonical_hash({
            key: value for key, value in payload.items() if key != "contentHash"})
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        report = self._report(ocr_selections=[selection], ocr_cache_root=cache)
        self.assertEqual(report["totals"]["ocrSelectedPagesWithoutCue"], 1)
        self.assertEqual(report["ocrProposals"], [])
        self.assertIsNone(report["parameterCoverage"])

    def test_default_production_allowlist_gate(self) -> None:
        with self.assertRaisesRegex(PublicTitleProposalError, "allowlist"):
            build_public_title_proposals(self.manifest, self.index, self.audit)


if __name__ == "__main__":
    unittest.main()
