"""Fail-closed tests for bounded KR slab public observations."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import fitz
from pdf_test_font import cyrillic_font

from inspector_worker.kr_slab_observations import (
    _unique_locators,
    build_public_observation_slice,
)
from inspector_worker.ocr_pilot import canonical_hash


class KrSlabObservationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "document_manifest.jsonl"
        self.paths = {source_id: self.root / f"{source_id}.pdf"
                      for source_id in ("F0106", "F0140", "F0144")}
        font_path = cyrillic_font()
        def insert(page: fitz.Page, xy: tuple[int, int], value: str) -> None:
            page.insert_font(fontname="ru", fontfile=font_path)
            page.insert_text(xy, value, fontname="ru")
        for source_id, count in (("F0106", 53), ("F0140", 7), ("F0144", 4)):
            pdf = fitz.open()
            for _ in range(count):
                pdf.new_page(width=2400, height=1700)
            if source_id == "F0106":
                page = pdf[52]
                insert(page, (100, 80), "Отметка верха фундаментной плиты равна -13,750.")
                insert(page, (100, 120), "Толщина фундаментной плиты определена по расчету, составляет 1000мм и 1200мм.")
                insert(page, (100, 200), "Перекрытия -2 и -1 этажей")
                insert(page, (500, 200), "- 250мм")
            elif source_id == "F0140":
                insert(pdf[2], (100, 200), "Фундамент жилого дома предусмотрен в виде монолитной железобетонной плиты толщиной 1200 и 1500 мм")
                insert(pdf[5], (100, 50), "Ж/б монолитная фундаментная плита на отм. -13.750. Опалубка.")
                insert(pdf[5], (100, 300), "H плиты 1200 мм")
                insert(pdf[5], (100, 330), "H плиты 1500 мм")
                insert(pdf[5], (100, 360), "H плиты 400мм")
                insert(pdf[6], (100, 300), "Железобетонная фундаментная плита h=1200 мм")
                insert(pdf[6], (100, 330), "Железобетонная фундаментная плита h=1500 мм")
            else:
                insert(pdf[2], (100, 160), "Плита перекрытия - 2 этажа")
                insert(pdf[2], (100, 200), "Толщина ж/б плиты перекрытия подземного этажа - 250мм, ж/б капители толщиной - 500мм.")
            pdf.save(self.paths[source_id])
        self.rows = {}
        for source_id, path in self.paths.items():
            with fitz.open(path) as pdf:
                pages = len(pdf)
            self.rows[source_id] = {
                "file_id": source_id, "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "extension": ".pdf", "stage": "PD" if source_id == "F0106" else "RD",
                "section": "KR", "relative_path": f"{source_id}.pdf", "pdf_pages": pages,
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        self._write_manifest()

    def _write_manifest(self) -> None:
        self.manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in self.rows.values()) + "\n",
                                 encoding="utf-8")

    def test_typed_observations_preserve_source_and_abstain(self) -> None:
        report = build_public_observation_slice(self.manifest, self.paths)
        self.assertEqual(report["schemaVersion"], "kr-slab-public-observation-slice-v1")
        self.assertEqual(report["evaluation"]["comparisonDisposition"], "ABSTAIN")
        self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(report["evaluation"]["comparableFacts"], [])
        self.assertIsNone(report["finding"])
        rows = report["observations"]
        self.assertEqual(len(rows), 12)
        self.assertEqual([row["values"] for row in rows if row["kind"] == "GENERAL_THICKNESS"],
                         [[1000, 1200], [1200, 1500]])
        self.assertEqual([row["values"] for row in rows if row["kind"] == "SLAB_THICKNESS"],
                         [[250], [250]])
        self.assertEqual(next(row for row in rows if row["kind"] == "DOCUMENT_SCOPE_LABEL")["rawText"],
                         "Плита перекрытия - 2 этажа")
        self.assertIn([400], [row["values"] for row in rows if row["kind"] == "DRAWING_LOCAL_THICKNESS"])
        pd_slab = next(row for row in rows if row["parameterCode"] == "KR-059" and row["manifestStage"] == "PD")
        self.assertEqual(pd_slab["rowLabel"]["rawText"], "Перекрытия -2 и -1 этажей")
        for row in rows:
            self.assertEqual(row["sourceSha256"], self.rows[row["sourceFileId"]]["sha256"])
            self.assertEqual(len(row["bboxPt"]), 4)
            self.assertEqual(row["reviewStatus"], "UNREVIEWED")
        self.assertEqual(report["contentHash"], canonical_hash({
            key: value for key, value in report.items() if key != "contentHash"
        }))

    def test_manifest_tamper_hidden_and_duplicate_fail_closed(self) -> None:
        self.rows["F0106"]["split"] = "TEST_HIDDEN"
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "public KR PDF"):
            build_public_observation_slice(self.manifest, self.paths)
        self.rows["F0106"]["split"] = "TRAIN_PUBLIC"
        self.rows["F0140"]["sha256"] = "f" * 64
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            build_public_observation_slice(self.manifest, self.paths)
        self.rows["F0140"]["sha256"] = hashlib.sha256(self.paths["F0140"].read_bytes()).hexdigest()
        self._write_manifest()
        with self.manifest.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(self.rows["F0140"]) + "\n")
        with self.assertRaisesRegex(ValueError, "duplicate manifest entry"):
            build_public_observation_slice(self.manifest, self.paths)

    def test_missing_or_ambiguous_table_value_refuses_observation(self) -> None:
        pdf = fitz.open(self.paths["F0106"])
        pdf[52].insert_font(fontname="ru", fontfile=cyrillic_font())
        pdf[52].insert_text((700, 200), "- 300мм", fontname="ru")
        pdf.save(self.root / "changed.pdf")
        pdf.close()
        self.paths["F0106"] = self.root / "changed.pdf"
        self.rows["F0106"]["size_bytes"] = self.paths["F0106"].stat().st_size
        self.rows["F0106"]["sha256"] = hashlib.sha256(self.paths["F0106"].read_bytes()).hexdigest()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "competing thickness cells"):
            build_public_observation_slice(self.manifest, self.paths)

    def test_duplicate_observation_locator_rejected(self) -> None:
        report = build_public_observation_slice(self.manifest, self.paths)
        duplicate = dict(report["observations"][0])
        with self.assertRaisesRegex(ValueError, "duplicate source observation locator"):
            _unique_locators([duplicate, duplicate])

    def test_page_count_fails_closed_even_when_hash_matches(self) -> None:
        self.rows["F0144"]["pdf_pages"] += 1
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "page count"):
            build_public_observation_slice(self.manifest, self.paths)


if __name__ == "__main__":
    unittest.main()
