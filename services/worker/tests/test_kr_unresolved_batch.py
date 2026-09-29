from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path

import fitz

from inspector_worker.kr_unresolved_batch import (
    CODES, SOURCE_IDS, KrUnresolvedBatchError, _catalog_strategy, _review_sample,
    classify_text_line,
    evaluate_kr_unresolved_batch,
)
from inspector_worker.public_document_index import build_public_index


ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data"
CATALOG = DATA / "parameter_catalog_132.jsonl"
REGISTRY = ROOT / "services/worker/rules/parameter-family-registry-v1.json"
STRATEGY = ROOT / "docs/operations/unresolved-parameter-strategy-v1.json"
SPEC = importlib.util.spec_from_file_location(
    "kr_unresolved_audit", ROOT / "scripts/audit-public-document-index.py")
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
EXPECTED = {"sourceCount": 11, "pdfSources": 10, "pdfPages": 10,
            "txtInventorySources": 1}
TEXT = {
    "F0105": "Координационные оси колонн и привязка несущего каркаса",
    "F0106": "Сталь марки С345 для металлопроката несущей конструкции",
    "F0107": "Рабочая арматура класса А500С для несущей плиты",
    "F0136": "",
    "F0139": "Сечение колонны К1 400х400 мм по опалубочному чертежу",
    "F0140": "Деформационный шов и конструктивный узел перекрытия",
    "F0141": "Лифтовая шахта и закладные элементы",
    "F0142": "Технологический проем перекрытия с обрамляющим армированием",
    "F0143": "Огнезащита металла, предел REI 120 и состав покрытия",
    "F0144": "Общие указания по конструкциям корпуса и материалам здания",
}


class KrUnresolvedBatchTests(unittest.TestCase):
    def test_code_anchors_are_only_lexical_leads(self) -> None:
        examples = {
            "KR-054": "оси колонн: привязка 200 мм",
            "KR-056": "Сталь марки С345",
            "KR-057": "арматура класса А500С",
            "KR-060": "колонна сечением 400х400 мм",
            "KR-063": "деформационный шов, узел",
            "KR-064": "лифтовая шахта, закладные",
            "KR-065": "проем с обрамляющим армированием",
            "KR-066": "огнезащита REI 120",
        }
        for code, value in examples.items():
            with self.subTest(code=code):
                self.assertEqual(classify_text_line(value)[code], "CO_LOCATED_TERMS")
        self.assertEqual(classify_text_line("Обычное примечание"), {})
        self.assertEqual(classify_text_line("шов"), {"KR-063": "ANCHOR_ONLY"})
        self.assertEqual(classify_text_line("А500С"), {"KR-057": "ANCHOR_ONLY"})
        self.assertEqual(classify_text_line("лифтовая шахта"),
                         {"KR-064": "ANCHOR_ONLY"})

    def test_review_sample_prefers_strong_and_diverse_pages(self) -> None:
        leads = [
            {"leadClass": "ANCHOR_ONLY", "sourceFileId": "F0105", "pageNumber": 1},
            {"leadClass": "CO_LOCATED_TERMS", "sourceFileId": "F0105", "pageNumber": 2},
            {"leadClass": "CO_LOCATED_TERMS", "sourceFileId": "F0105", "pageNumber": 2},
            {"leadClass": "CO_LOCATED_TERMS", "sourceFileId": "F0140", "pageNumber": 3},
        ]
        sample = _review_sample(leads, 2)
        self.assertEqual([(item["sourceFileId"], item["pageNumber"]) for item in sample],
                         [("F0105", 2), ("F0140", 3)])

    def test_strategy_source_pin_rejects_drift(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "strategy.json"
        strategy = json.loads(STRATEGY.read_text(encoding="utf-8"))
        strategy["catalogSha256"] = "0" * 64
        path.write_text(json.dumps(strategy, ensure_ascii=False), encoding="utf-8")
        with self.assertRaisesRegex(KrUnresolvedBatchError, "SHA"):
            _catalog_strategy(CATALOG, REGISTRY, path)

    @requires_posix_storage
    @unittest.skipUnless(FONT.is_file(), "Cyrillic PDF font unavailable")
    def test_audit_gated_full_page_batch_and_ocr_unknown(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        materials = root / "materials"
        materials.mkdir()
        manifest, index, audit_path = root / "manifest.jsonl", root / "index", root / "audit.json"
        rows = []
        for source_id in SOURCE_IDS:
            stage = "PD" if source_id in SOURCE_IDS[:3] else "RD"
            path = materials / f"{source_id}.pdf"
            document = fitz.open()
            page = document.new_page()
            if TEXT[source_id]:
                page.insert_font(fontname="DejaVu", fontfile=str(FONT))
                page.insert_text((40, 90), TEXT[source_id], fontname="DejaVu", fontsize=10)
            document.save(path)
            document.close()
            rows.append({"file_id": source_id,
                         "object_id": "OBJ-NOVOSLOBODSKAYA", "stage": stage,
                         "section": "KR", "split": "TRAIN_PUBLIC",
                         "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                         "relative_path": path.name, "extension": ".pdf",
                         "size_bytes": path.stat().st_size,
                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "pdf_pages": 1, "annotation_status": "UNLABELED"})
        private = materials / "inventory.txt"
        private.write_text("must remain unread", encoding="utf-8")
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
        self.assertEqual(built["completeSources"], 10)
        audit = AUDIT.audit_public_document_index(manifest, index)
        self.assertEqual(audit["status"], "PASS")
        audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")

        report = evaluate_kr_unresolved_batch(
            manifest, index, audit_path, CATALOG, REGISTRY, STRATEGY,
            max_leads_per_code=1, _expected_counts=EXPECTED)
        self.assertEqual(report["scannedPages"], 10)
        self.assertEqual(report["ocrRequiredPages"], 1)
        self.assertEqual(report["ocrQueue"][0]["sourceFileId"], "F0136")
        self.assertEqual(report["ocrQueue"][0]["codeDisposition"], "UNKNOWN")
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertEqual(report["overallStatus"], "ABSTAIN")
        self.assertEqual(set(report["codeReports"]), set(CODES))
        for code in CODES:
            self.assertGreater(report["codeReports"][code]["matchingPages"], 0)
            lead = report["codeReports"][code]["leads"][0]
            self.assertEqual(lead["status"], "ABSTAIN")
            self.assertEqual(len(lead["sourceSha256"]), 64)
            self.assertEqual(len(lead["pageArtifactSha256"]), 64)
            self.assertIn("SAME_ELEMENT", lead["unproven"])
        audit["status"] = "INCOMPLETE"
        audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises((KrUnresolvedBatchError, ValueError)):
            evaluate_kr_unresolved_batch(
                manifest, index, audit_path, CATALOG, REGISTRY, STRATEGY,
                _expected_counts=EXPECTED)


if __name__ == "__main__":
    unittest.main()
