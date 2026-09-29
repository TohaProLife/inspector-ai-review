"""The IOS4-077 probe must preserve uncertainty and public source identity."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import fitz

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.radiator_spec import (
    build_report,
    extract_pd_rows,
    extract_rd_rows,
    verify_public_sources,
)


def make_pdf(path: Path, *, table: bool = False) -> None:
    pdf = fitz.open()
    page = pdf.new_page(width=1200, height=800)
    if table:
        for x, text in ((240, "33-500-800"), (533, "PRADO Classic"),
                        (961, "6"), (1096, "2,501 kW")):
            page.insert_text((x, 200), text)
    pdf.save(path)


def manifest_row(source_id: str, path: Path) -> dict:
    return {
        "file_id": source_id, "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
        "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
        "extension": ".pdf", "stage": "PD" if source_id == "F0171" else "RD_ID_MIXED",
        "section": "OV", "relative_path": f"{source_id}.pdf", "pdf_pages": 1,
        "size_bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def ocr_line(text: str, box: list[int], score: float = .98) -> dict:
    return {"text": text, "score": score, "bboxPx": box}


def ocr_artifact(source_hash: str, *, unit: str = "1,469 kBm") -> dict:
    artifact = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": "F0202",
        "inputSha256": source_hash, "pageNumber": 1,
        "render": {"sha256": "a" * 64, "widthPx": 2500, "heightPx": 1800,
                   "dpi": 150, "rendererProfileId": "local"},
        "provider": {"profileId": "local", "script": "eslav"},
        "lines": [
            ocr_line("правого исполнения, 20-500-1000", [243, 409, 605, 446]),
            ocr_line("2", [1994, 413, 2023, 451]),
            ocr_line(unit, [2081, 409, 2197, 448]),
            ocr_line("2,938 kBm", [2272, 412, 2390, 447]),
        ],
    }
    artifact["contentHash"] = canonical_hash(artifact)
    return artifact


class RadiatorSpecTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pd = self.root / "F0171.pdf"
        self.rd = self.root / "F0202.pdf"
        make_pdf(self.pd, table=True)
        make_pdf(self.rd)
        self.rows = {"F0171": manifest_row("F0171", self.pd),
                     "F0202": manifest_row("F0202", self.rd)}
        self.manifest = self.root / "document_manifest.jsonl"
        self.write_manifest()

    def write_manifest(self) -> None:
        # Malformed unrelated row proves the probe decodes only selected IDs.
        self.manifest.write_text("{hidden source not decoded}\n" + "\n".join(
            json.dumps(self.rows[key]) for key in sorted(self.rows)) + "\n", encoding="utf-8")

    def test_manifest_hash_stage_and_public_gates(self) -> None:
        self.rows["F0171"]["annotation_status"] = "MUST_NOT_ENTER_PROBE"
        self.rows["F0171"]["verdict"] = "MUST_NOT_ENTER_PROBE"
        self.write_manifest()
        chosen = verify_public_sources(self.manifest, {"F0171": self.pd, "F0202": self.rd})
        self.assertEqual(set(chosen), {"F0171", "F0202"})
        self.assertNotIn("annotation_status", chosen["F0171"])
        self.assertNotIn("verdict", chosen["F0171"])
        self.rows["F0202"]["split"] = "TEST_HIDDEN"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "public OV PDF"):
            verify_public_sources(self.manifest, {"F0171": self.pd, "F0202": self.rd})
        self.rows["F0202"]["split"] = "TRAIN_PUBLIC"
        self.rows["F0202"]["sha256"] = "f" * 64
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            verify_public_sources(self.manifest, {"F0171": self.pd, "F0202": self.rd})

    def test_pd_text_row_has_same_page_cells_and_nominal_output(self) -> None:
        result = extract_pd_rows(self.pd, self.rows["F0171"]["sha256"], [1])
        self.assertEqual(len(result), 1)
        row = result[0]
        self.assertEqual((row["model"], row["family"], row["quantity"], row["unitHeatOutputKw"]),
                         ("33-500-800", "Classic", 6, "2.501"))
        self.assertEqual((row["sourceFileId"], row["sourcePage"], row["parseStatus"]),
                         ("F0171", 1, "COMPLETE"))
        with self.assertRaisesRegex(ValueError, "SHA-256 changed"):
            extract_pd_rows(self.pd, "f" * 64, [1])

    def test_rd_ocr_keeps_unreadable_unit_unknown(self) -> None:
        result = extract_rd_rows([ocr_artifact(self.rows["F0202"]["sha256"])],
                                 self.rows["F0202"]["sha256"])
        self.assertEqual(len(result), 1)
        row = result[0]
        self.assertEqual((row["model"], row["quantity"], row["unitHeatOutputKw"]),
                         ("20-500-1000", 2, None))
        self.assertEqual((row["sourcePage"], row["pageStage"], row["parseStatus"]),
                         (1, "UNKNOWN", "PARTIAL"))
        self.assertEqual(row["rawCells"]["unitHeatOutput"]["text"], "1,469 kBm")

    def test_rd_exact_power_unit_is_observation_not_finding(self) -> None:
        artifact = ocr_artifact(self.rows["F0202"]["sha256"], unit="1,469 kW")
        rd_rows = extract_rd_rows([artifact], self.rows["F0202"]["sha256"])
        self.assertEqual(rd_rows[0]["unitHeatOutputKw"], "1.469")
        pd_rows = extract_pd_rows(self.pd, self.rows["F0171"]["sha256"], [1])
        report = build_report(self.rows, pd_rows, rd_rows, pd_pages=[1], rd_pages=[1])
        self.assertEqual(report["comparisonDisposition"], "ABSTAIN")
        self.assertIsNone(report["finding"])
        self.assertEqual(set(report["gates"].values()), {"UNKNOWN"})
        self.assertEqual(report["contentHash"], canonical_hash({k: v for k, v in report.items()
                                                                 if k != "contentHash"}))

    def test_ocr_artifact_hash_gate(self) -> None:
        artifact = ocr_artifact(self.rows["F0202"]["sha256"])
        artifact["lines"][0]["text"] = "33-500-800"
        with self.assertRaisesRegex(ValueError, "contentHash mismatch"):
            extract_rd_rows([artifact], self.rows["F0202"]["sha256"])

    def test_rd_does_not_borrow_quantity_from_adjacent_row(self) -> None:
        artifact = ocr_artifact(self.rows["F0202"]["sha256"])
        artifact["lines"][1]["bboxPx"] = [1994, 460, 2023, 498]
        artifact["contentHash"] = canonical_hash({k: v for k, v in artifact.items()
                                                   if k != "contentHash"})
        rows = extract_rd_rows([artifact], self.rows["F0202"]["sha256"])
        self.assertIsNone(rows[0]["quantity"])
        self.assertIsNone(rows[0]["rawCells"]["quantity"])


if __name__ == "__main__":
    unittest.main()
