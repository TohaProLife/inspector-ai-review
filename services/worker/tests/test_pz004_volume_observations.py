"""Real PDF text-layer and manifest gates for bounded PZ-004 observations."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import fitz
from pdf_test_font import cyrillic_font

from inspector_worker.pz004_volume_observations import (
    _canonical_hash,
    build_public_observation_slice,
    verify_public_sources,
)


def _pdf(path: Path, *, pages: int, pd: bool, value: str = "60997,93",
         unit: str = "м³", different_scope: bool = False,
         duplicate_rd: bool = False) -> None:
    pdf = fitz.open()
    for index in range(pages):
        page = pdf.new_page(width=800, height=600)
        if pd and index == 25:
            page.insert_font(fontname="ru", fontfile=cyrillic_font())
            page.insert_text((40, 100),
                             "Строительный объём здания, в т.ч.:" if not different_scope
                             else "Строительный объём подземной части:", fontsize=10, fontname="ru")
            page.insert_text((340, 100), unit, fontsize=10, fontname="ru")
            if value:
                page.insert_text((410, 100), value, fontsize=10, fontname="ru")
        if not pd and index == 13:
            page.insert_font(fontname="ru", fontfile=cyrillic_font())
            label = (f"Строительный объем здания V={value} куб.м;" if not different_scope
                     else f"Объем вентиляции V={value} куб.м;")
            if value:
                page.insert_text((40, 100), label, fontsize=10, fontname="ru")
                if duplicate_rd:
                    page.insert_text((40, 125), label, fontsize=10, fontname="ru")
    pdf.save(path)
    pdf.close()


class Pz004VolumeObservationTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.pd = self.root / "F0150.pdf"
        self.rd = self.root / "F0201.pdf"
        self.manifest = self.root / "document_manifest.jsonl"
        _pdf(self.pd, pages=26, pd=True)
        _pdf(self.rd, pages=14, pd=False)
        self.rows = {}
        self._write_manifest()

    def _write_manifest(self) -> None:
        self.rows = {}
        for source_id, path, stage, section, pages in (
            ("F0150", self.pd, "PD", "OTHER", 26),
            ("F0201", self.rd, "RD_ID_MIXED", "OV", 14),
        ):
            self.rows[source_id] = {
                "file_id": source_id, "object_id": "OBJ-TEST", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "extension": ".pdf", "stage": stage, "section": section,
                "relative_path": f"public/{source_id}.pdf", "pdf_pages": pages,
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        self.manifest.write_text("\n".join(json.dumps(row) for row in self.rows.values()) + "\n",
                                 encoding="utf-8")
        self.manifest_hash = hashlib.sha256(self.manifest.read_bytes()).hexdigest()

    def _report(self) -> dict:
        return build_public_observation_slice(
            self.manifest, self.pd, self.rd,
            expected_manifest_sha256=self.manifest_hash,
        )

    def test_two_verified_values_are_still_lexical_only(self) -> None:
        report = self._report()
        self.assertEqual([fact["valueM3"] for fact in report["observations"]],
                         ["60997.93", "60997.93"])
        self.assertTrue(report["literalValueOverlap"])
        self.assertEqual(report["overlapSemantics"], "LEXICAL_ONLY")
        self.assertEqual(report["observations"][0]["sourcePage"], 26)
        self.assertEqual(report["observations"][1]["sourcePage"], 14)
        self.assertEqual(report["observations"][1]["pageStage"], "UNRESOLVED")
        self.assertEqual(report["observations"][0]["rawUnit"], "м³")
        self.assertEqual(len(report["observations"][0]["textLayerBoxesPt"]), 3)
        self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertIn("RD_AR_KR_SOURCE_MISSING", report["evaluation"]["reasonCodes"])
        self.assertEqual(report["evaluation"]["comparableFacts"], [])
        self.assertEqual(report["comparisonDisposition"], "ABSTAIN")
        self.assertIsNone(report["finding"])
        self.assertEqual(report["contentHash"], _canonical_hash({
            key: value for key, value in report.items() if key != "contentHash"
        }))

    def test_different_volume_is_not_a_finding(self) -> None:
        _pdf(self.rd, pages=14, pd=False, value="60998,93")
        self._write_manifest()
        report = self._report()
        self.assertEqual(report["observations"][1]["valueM3"], "60998.93")
        self.assertFalse(report["literalValueOverlap"])
        self.assertIsNone(report["finding"])
        self.assertEqual(report["comparisonDisposition"], "ABSTAIN")

    def test_missing_value_is_not_zero_or_negative(self) -> None:
        _pdf(self.pd, pages=26, pd=True, value="")
        self._write_manifest()
        report = self._report()
        self.assertEqual(len(report["observations"]), 1)
        self.assertIn("F0150_TOTAL_VOLUME_NOT_UNIQUE", report["evaluation"]["reasonCodes"])
        self.assertFalse(report["literalValueOverlap"])
        self.assertIsNone(report["finding"])

    def test_wrong_unit_or_different_scope_is_not_a_total_building_volume(self) -> None:
        _pdf(self.pd, pages=26, pd=True, unit="м²")
        _pdf(self.rd, pages=14, pd=False, different_scope=True)
        self._write_manifest()
        report = self._report()
        self.assertEqual(report["observations"], [])
        self.assertIn("F0150_TOTAL_VOLUME_NOT_UNIQUE", report["evaluation"]["reasonCodes"])
        self.assertIn("F0201_TOTAL_VOLUME_NOT_UNIQUE", report["evaluation"]["reasonCodes"])

    def test_duplicate_total_lines_are_ambiguous_not_accepted(self) -> None:
        _pdf(self.rd, pages=14, pd=False, duplicate_rd=True)
        self._write_manifest()
        report = self._report()
        self.assertEqual(len(report["observations"]), 1)
        self.assertIn("F0201_TOTAL_VOLUME_NOT_UNIQUE", report["evaluation"]["reasonCodes"])
        self.assertIsNone(report["finding"])

    def test_original_bytes_and_manifest_anchor_are_required(self) -> None:
        with self.assertRaisesRegex(ValueError, "manifest.jsonl SHA-256 mismatch"):
            verify_public_sources(self.manifest, {"F0150": self.pd, "F0201": self.rd},
                                  expected_manifest_sha256="0" * 64)
        self.pd.write_bytes(self.pd.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "PDF size or SHA-256 mismatch"):
            self._report()

    def test_wrong_stage_or_split_rejected_even_with_reanchored_manifest(self) -> None:
        for field, value in (("stage", "RD"), ("split", "TEST_HIDDEN"),
                             ("section", "AR")):
            with self.subTest(field=field):
                self._write_manifest()
                rows = [dict(self.rows[source_id]) for source_id in ("F0150", "F0201")]
                rows[1][field] = value
                self.manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n",
                                         encoding="utf-8")
                self.manifest_hash = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
                with self.assertRaisesRegex(ValueError, "wrong public split, stage, or section"):
                    self._report()

    def test_wrong_object_and_page_count_rejected(self) -> None:
        self.rows["F0201"]["object_id"] = "OTHER"
        self.manifest.write_text("\n".join(json.dumps(row) for row in self.rows.values()) + "\n",
                                 encoding="utf-8")
        self.manifest_hash = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "share a nonempty object_id"):
            self._report()
        self._write_manifest()
        self.rows["F0201"]["pdf_pages"] = 15
        self.manifest.write_text("\n".join(json.dumps(row) for row in self.rows.values()) + "\n",
                                 encoding="utf-8")
        self.manifest_hash = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "page count differs"):
            self._report()


if __name__ == "__main__":
    unittest.main()
