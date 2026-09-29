from __future__ import annotations

import hashlib
from pathlib import Path
import runpy
import tempfile
import unittest


MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "build-pz002-public-review.py"))


class Pz002PublicReviewTests(unittest.TestCase):
    def test_exact_building_area_forms_and_page_numbers(self) -> None:
        found = MODULE["area_matches"]([
            "Общая площадь участка 900 м²\nОбщая площадь здания, в т.ч.:   м ²  100,00",
            "Общая площадь здания S=102,00 кв.м;",
        ])
        self.assertEqual([(item["pageNumber"], item["rawValue"]) for item in found],
                         [(1, "100,00"), (2, "102,00")])

    def test_hidden_or_modified_pdf_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            row = {"file_id": "F1", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                   "label_visibility": "PUBLIC_TRAIN", "size_bytes": path.stat().st_size,
                   "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            source = {"F1": row}
            self.assertEqual(MODULE["verified_source"](source, f"F1={path}")[0], row)
            source["F1"] = {**row, "split": "TEST_HIDDEN"}
            with self.assertRaisesRegex(ValueError, "public training"):
                MODULE["verified_source"](source, f"F1={path}")
            source["F1"] = row
            path.write_bytes(path.read_bytes() + b"changed")
            with self.assertRaisesRegex(ValueError, "do not match"):
                MODULE["verified_source"](source, f"F1={path}")


if __name__ == "__main__":
    unittest.main()
