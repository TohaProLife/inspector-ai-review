from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.kr_decrease_batch import KrDecreaseBatchError, evaluate_kr_decrease_batch
from inspector_worker.public_document_index import build_public_index


ROOT = Path(__file__).resolve().parents[3]
AUDIT_SCRIPT = ROOT / "scripts" / "audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_document_index_audit_for_kr", AUDIT_SCRIPT)
assert SPEC and SPEC.loader
AUDIT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT_MODULE)

WALL = "Корпус 1, 3 этаж, несущая монолитная стена С1: толщина 200 мм"
REBAR = "Секция 2, этаж 5, колонна К1: продольная арматура Ø20 мм"
FALSE_POSITIVE = "Корпус 1, 3 этаж, ненесущая монолитная стена С1: толщина 180 мм"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


@requires_posix_storage
class KrDecreaseBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        materials = self.root / "materials"
        materials.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit_path = self.root / "audit.json"
        self.rows = [self._pdf(materials, "F0105", "PD", [WALL, FALSE_POSITIVE]),
                     self._pdf(materials, "F0140", "RD", [REBAR])]
        inventory = materials / "answers.txt"
        inventory.write_text("Never inspect private answer text", encoding="utf-8")
        self.rows.append({"file_id": "F0194", "object_id": "OBJ-1", "stage": "OTHER",
                          "section": "OTHER", "split": "TRAIN_PUBLIC",
                          "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                          "relative_path": inventory.name, "extension": ".txt",
                          "size_bytes": inventory.stat().st_size,
                          "sha256": hashlib.sha256(inventory.read_bytes()).hexdigest(),
                          "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX"})
        self._write_manifest()
        summary = build_public_index(self.manifest, self.index, materials_root=materials)
        self.assertEqual(summary["completeSources"], 2)
        audit = AUDIT_MODULE.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(audit["status"], "PASS")
        self.audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")

    def _pdf(self, materials: Path, source_id: str, stage: str, lines: list[str]) -> dict:
        path = materials / f"{source_id}.pdf"
        document = fitz.open()
        for value in lines:
            page = document.new_page()
            page.insert_font(fontname="DejaVu", fontfile=FONT)
            page.insert_text((40, 90), value, fontname="DejaVu", fontsize=10)
        document.save(path)
        document.close()
        return {"file_id": source_id, "object_id": "OBJ-1", "stage": stage,
                "section": "KR", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": path.name, "extension": ".pdf",
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pdf_pages": len(lines), "annotation_status": "UNLABELED"}

    def _write_manifest(self) -> None:
        self.manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n"
                                         for row in self.rows), encoding="utf-8")

    def _evaluate(self, **kwargs: object) -> dict:
        return evaluate_kr_decrease_batch(
            self.manifest, self.index, self.audit_path,
            source_ids=["F0105", "F0140"], terms=["стен*", "арматур*"],
            _expected_counts={"sourceCount": 3, "pdfSources": 2,
                              "pdfPages": 3, "txtInventorySources": 1}, **kwargs,
        )

    def test_real_synthetic_pdf_index_audit_candidates_and_false_positive(self) -> None:
        report = self._evaluate()
        self.assertEqual(report["purpose"], "REVIEW_ONLY")
        self.assertEqual(report["scope"], "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertEqual(report["codes"]["KR-061"], {"candidatePages": 1, "abstainPages": 2})
        self.assertEqual(report["codes"]["KR-062"], {"candidatePages": 1, "abstainPages": 2})
        sources = {row["sourceFileId"]: row for row in report["sourceReports"]}
        self.assertEqual(sources["F0105"]["stage"], "PD")
        self.assertEqual(sources["F0140"]["stage"], "RD")
        self.assertEqual(len(sources["F0105"]["pages"]), 2)
        false_page = next(page for page in sources["F0105"]["pages"] if page["pageNumber"] == 2)
        self.assertEqual(false_page["results"]["KR-061"]["status"], "ABSTAIN")
        self.assertFalse(false_page["selectionComplete"])
        wall_page = next(page for page in sources["F0105"]["pages"] if page["pageNumber"] == 1)
        fact, = wall_page["results"]["KR-061"]["facts"]
        self.assertEqual(fact["sourceSha256"], sources["F0105"]["sourceSha256"])
        self.assertEqual(fact["indexProvenance"]["evidenceSha256"], wall_page["evidenceSha256"])
        self.assertEqual(fact["rawValue"], "200")
        self.assertEqual(len(report["stageReports"]), 2)
        self.assertEqual(report["truncated"], {"textPages": False, "ocrPages": False,
                                                "blocks": False})

    def test_incomplete_or_fabricated_pass_audit_rejected(self) -> None:
        original = json.loads(self.audit_path.read_text(encoding="utf-8"))
        for mutation in (lambda row: row.update(status="INCOMPLETE"),
                         lambda row: row["actual"].update(indexedPages=2),
                         lambda row: row["expected"].update(sourceCount=203),
                         lambda row: row.update(indexVersionHash="0" * 20)):
            audit = json.loads(json.dumps(original))
            mutation(audit)
            self.audit_path.write_text(json.dumps(audit), encoding="utf-8")
            with self.subTest(audit=audit["status"]), self.assertRaises(KrDecreaseBatchError):
                self._evaluate()

    def test_tampered_manifest_rejected_even_if_file_remains_public(self) -> None:
        self.rows[0]["sha256"] = "0" * 64
        self._write_manifest()
        with self.assertRaisesRegex(KrDecreaseBatchError, "SHA"):
            self._evaluate()

    def test_default_production_counts_cannot_be_bypassed_by_tiny_index(self) -> None:
        with self.assertRaisesRegex(KrDecreaseBatchError, "inventory"):
            evaluate_kr_decrease_batch(
                self.manifest, self.index, self.audit_path,
                source_ids=["F0105", "F0140"], terms=["стен*", "арматур*"],
            )

    def test_page_limit_exposes_omitted_pages_without_negative_claim(self) -> None:
        report = self._evaluate(max_pages=1)
        self.assertTrue(report["truncated"]["textPages"])
        self.assertEqual(sum(source["selectedTextPages"] for source in report["sourceReports"]), 1)
        self.assertGreater(sum(source["omittedTextPages"] for source in report["sourceReports"]), 0)
        self.assertIsNone(report["findingCount"])


if __name__ == "__main__":
    unittest.main()
