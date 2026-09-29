from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from recorded_artifact_support import require_recorded_artifacts


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "public_family_ocr_batch", ROOT / "scripts/run-public-family-ocr-batch.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublicFamilyOcrBatchTests(unittest.TestCase):
    def test_overlapping_chunks_cover_all_lines_and_boundaries(self) -> None:
        for count in (0, 1, 127, 128, 129, 255, 257):
            chunks = MODULE._chunks(count)
            self.assertTrue(all(1 <= len(chunk) <= 128 for chunk in chunks))
            self.assertEqual(set().union(*(set(chunk) for chunk in chunks)), set(range(count)))
            for first, second in zip(chunks, chunks[1:]):
                self.assertEqual(first[-1], second[0])

    def test_real_selection_is_bounded_and_excludes_reviewed(self) -> None:
        folder = ROOT / "output/public-index-20260927"
        require_recorded_artifacts(
            folder / "public-family-ocr-queue-20260927.json",
            folder / "public-family-ocr-selection-20260927.json")
        queue = json.loads((folder / "public-family-ocr-queue-20260927.json").read_text())
        selection = json.loads((folder / "public-family-ocr-selection-20260927.json").read_text())
        selected, prior = MODULE._select(queue, selection)
        self.assertEqual(len(selected), 12)
        self.assertEqual(len(prior), 4)
        self.assertEqual(len({(row["sourceFileId"], row["pageNumber"])
                              for row in selected}), 12)
        self.assertFalse({(row["sourceFileId"], row["pageNumber"])
                          for row in selected} & prior)
        self.assertEqual(len({family for row in selected for family in row["families"]}), 8)

    def test_tampered_selection_is_rejected(self) -> None:
        folder = ROOT / "output/public-index-20260927"
        require_recorded_artifacts(
            folder / "public-family-ocr-queue-20260927.json",
            folder / "public-family-ocr-selection-20260927.json")
        queue = json.loads((folder / "public-family-ocr-queue-20260927.json").read_text())
        selection = json.loads((folder / "public-family-ocr-selection-20260927.json").read_text())
        selection["selectedPages"][0]["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash-drifted"):
            MODULE._select(queue, selection)

    def test_oversize_page_uses_bounded_dpi_override(self) -> None:
        folder = ROOT / "output/public-index-20260927"
        require_recorded_artifacts(
            folder / "public-family-ocr-queue-v2-20260927.json",
            folder / "public-family-ocr-v2-selection-c-20260927.json")
        queue = json.loads((folder / "public-family-ocr-queue-v2-20260927.json").read_text())
        selection = json.loads((folder / "public-family-ocr-v2-selection-c-20260927.json").read_text())
        selected, _ = MODULE._select(queue, selection)
        self.assertEqual({(item["sourceFileId"], item["pageNumber"], item["dpi"])
                          for item in selected}, {("F0193", 55, 115), ("F0193", 56, 115)})
        selected[0]["dpi"] = 121
        with self.assertRaisesRegex(ValueError, "fields invalid"):
            MODULE._select(queue, selection)


if __name__ == "__main__":
    unittest.main()
