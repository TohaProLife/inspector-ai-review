from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.public_document_index import build_public_index
from inspector_worker.pz_spzu_unresolved_batch import (
    COMPILED, EXPECTED_CODES, PzSpzuUnresolvedBatchError, _choose_pages, _fts_query,
    evaluate_pz_spzu_unresolved_batch,
)


ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"
CATALOG = DATA / "parameter_catalog_132.jsonl"
REGISTRY = ROOT / "services/worker/rules/parameter-family-registry-v1.json"
STRATEGY = ROOT / "docs/operations/unresolved-parameter-strategy-v1.json"
SOURCE_REPORT = ROOT / "output/unresolved-parameter-strategy-20260927/report.json"
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
SPEC = importlib.util.spec_from_file_location(
    "pz_spzu_unresolved_audit", ROOT / "scripts/audit-public-document-index.py")
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
EXPECTED = {"sourceCount": 3, "pdfSources": 2, "pdfPages": 3,
            "txtInventorySources": 1}


def _hash_report(report: dict) -> None:
    content = {key: value for key, value in report.items() if key != "reportSha256"}
    report["reportSha256"] = hashlib.sha256((json.dumps(
        content, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()).hexdigest()


class PzSpzuUnresolvedBatchTests(unittest.TestCase):
    def test_exact_code_inventory_and_safe_fts_terms(self) -> None:
        self.assertEqual(len(EXPECTED_CODES), 20)
        self.assertEqual(len([code for code in EXPECTED_CODES if code.startswith("PZ-")]), 9)
        self.assertEqual(len([code for code in EXPECTED_CODES if code.startswith("SPZU-")]), 11)
        self.assertEqual(_fts_query(("озеленени*", "газон*")), '"озеленени"* OR "газон"*')
        with self.assertRaises(PzSpzuUnresolvedBatchError):
            _fts_query(("x\" OR source_id:*",))

    def test_area_apartment_and_capacity_filters_reject_obvious_other_contexts(self) -> None:
        self.assertFalse(COMPILED["PZ-003"].search("расчетной площади тушения"))
        self.assertFalse(COMPILED["PZ-003"].search("расчётные площадки"))
        self.assertTrue(COMPILED["PZ-003"].search("Расчётная площадь здания"))
        self.assertFalse(COMPILED["PZ-011"].search("Наушники студийные"))
        self.assertTrue(COMPILED["PZ-011"].search("Количество квартир 92"))
        self.assertFalse(COMPILED["PZ-013"].search("Производительность насоса 10 м3/ч"))
        self.assertTrue(COMPILED["SPZU-026"].search("Площадь твердых покрытий"))

    def test_page_selection_balances_object_and_stage(self) -> None:
        public = {
            "F0001": {"object_id": "A", "stage": "PD", "section": "GP",
                      "relative_path": "ПЗУ.pdf"},
            "F0002": {"object_id": "A", "stage": "RD", "section": "OTHER",
                      "relative_path": "РД.pdf"},
            "F0003": {"object_id": "B", "stage": "PD", "section": "GP",
                      "relative_path": "ПЗУ.pdf"},
        }
        hits = [{"source_id": "F0001", "page_number": n, "rank": float(n)}
                for n in range(1, 5)]
        hits += [{"source_id": "F0002", "page_number": 1, "rank": 0.0},
                 {"source_id": "F0003", "page_number": 1, "rank": 0.0}]
        selected = _choose_pages("SPZU-027", hits, public, 3)
        self.assertEqual({item["source_id"] for item in selected},
                         {"F0001", "F0002", "F0003"})

    def test_filename_hint_prioritizes_pz_within_stage_only(self) -> None:
        public = {
            "F0001": {"object_id": "A", "stage": "PD", "section": "OTHER",
                      "relative_path": "ИОС.pdf"},
            "F0002": {"object_id": "A", "stage": "PD", "section": "OTHER",
                      "relative_path": "НВС-1.2-ПЗ.pdf"},
        }
        hits = [{"source_id": "F0001", "page_number": 1, "rank": -10.0},
                {"source_id": "F0002", "page_number": 1, "rank": -1.0}]
        selected = _choose_pages("PZ-003", hits, public, 1)
        self.assertEqual(selected[0]["source_id"], "F0002")

    @requires_posix_storage
    @unittest.skipUnless(FONT.is_file(), "Cyrillic PDF font unavailable")
    def test_synthetic_public_index_ocr_unknown_and_fail_closed(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        materials = root / "materials"
        materials.mkdir()
        manifest, index, audit_path = root / "manifest.jsonl", root / "index", root / "audit.json"
        report_path = root / "strategy-report.json"
        sources = (
            ("F0150", "PD", "GP", ["Коэффициент застройки 0,3\nПлощадь озеленения 500 м2"]),
            ("F0151", "RD", "OTHER", ["Коэффициент застройки 0,4\nПлощадь озеленения 450 м2", ""]),
        )
        rows = []
        for source_id, stage, section, pages in sources:
            path = materials / f"{source_id}.pdf"
            document = fitz.open()
            for value in pages:
                page = document.new_page()
                if value:
                    page.insert_font(fontname="DejaVu", fontfile=str(FONT))
                    page.insert_text((40, 90), value, fontname="DejaVu", fontsize=10)
            document.save(path)
            document.close()
            rows.append({"file_id": source_id, "object_id": "OBJ-NOVOSLOBODSKAYA",
                         "stage": stage, "section": section, "split": "TRAIN_PUBLIC",
                         "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                         "relative_path": path.name, "extension": ".pdf",
                         "size_bytes": path.stat().st_size,
                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "pdf_pages": len(pages), "annotation_status": "UNLABELED"})
        private = materials / "ground_truth.txt"
        private.write_text("Never read this content", encoding="utf-8")
        rows.append({"file_id": "F0194", "object_id": "OBJ-NOVOSLOBODSKAYA",
                     "stage": "OTHER", "section": "OTHER", "split": "TRAIN_PUBLIC",
                     "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                     "relative_path": private.name, "extension": ".txt",
                     "size_bytes": private.stat().st_size,
                     "sha256": hashlib.sha256(private.read_bytes()).hexdigest(),
                     "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX"})
        manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
                            encoding="utf-8")
        built = build_public_index(manifest, index, materials_root=materials)
        self.assertEqual(built["completeSources"], 2)
        audit = AUDIT.audit_public_document_index(manifest, index)
        self.assertEqual(audit["status"], "PASS")
        audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")
        strategy_report = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
        strategy_report["inputSha256"]["manifest"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
        _hash_report(strategy_report)
        report_path.write_text(json.dumps(strategy_report, ensure_ascii=False), encoding="utf-8")

        report = evaluate_pz_spzu_unresolved_batch(
            manifest, index, audit_path, report_path, CATALOG, REGISTRY, STRATEGY,
            max_pages_per_code=2, max_lines_per_page=1, max_ocr_queue=2,
            _expected_counts=EXPECTED)
        self.assertEqual(report["pdfSources"], 2)
        self.assertEqual(report["pdfPages"], 3)
        self.assertEqual(report["ocrRequiredPagesInCorpus"], 1)
        self.assertEqual(report["ocrQueue"][0]["sourceFileId"], "F0151")
        self.assertEqual(report["ocrQueue"][0]["status"], "OCR_REQUIRED_UNKNOWN")
        self.assertEqual(len(report["codeReports"]), 20)
        self.assertGreater(report["codeReports"]["PZ-019"]["lexicalMatchedTextPages"], 0)
        self.assertGreater(report["codeReports"]["SPZU-027"]["lexicalMatchedTextPages"], 0)
        self.assertEqual(report["overallStatus"], "ABSTAIN")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        lead = report["codeReports"]["SPZU-027"]["leads"][0]
        self.assertEqual(lead["catalogSourceRoleStatus"], "UNRESOLVED")
        self.assertEqual(len(lead["pageArtifactSha256"]), 64)
        strategy_report["reportSha256"] = "0" * 64
        report_path.write_text(json.dumps(strategy_report, ensure_ascii=False), encoding="utf-8")
        with self.assertRaisesRegex(PzSpzuUnresolvedBatchError, "content hash"):
            evaluate_pz_spzu_unresolved_batch(
                manifest, index, audit_path, report_path, CATALOG, REGISTRY, STRATEGY,
                _expected_counts=EXPECTED)


if __name__ == "__main__":
    unittest.main()
