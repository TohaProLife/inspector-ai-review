import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "run_public_family_ocr_v4", ROOT / "scripts" / "run-public-family-ocr-v4.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class PageDpiSelectionTests(unittest.TestCase):
    def test_ordinary_page_keeps_exact_cache_profile(self):
        self.assertEqual(MODULE.select_page_dpi(595, 842), 120)

    def test_large_page_uses_bounded_dpi(self):
        dpi = MODULE.select_page_dpi(3274.2, 2778)
        self.assertLess(dpi, 120)
        self.assertGreaterEqual(dpi, 72)
        self.assertLessEqual(
            (MODULE.math.ceil(3274.2 * dpi / 72) + 2)
            * (MODULE.math.ceil(2778 * dpi / 72) + 2),
            MODULE.SAFE_RENDER_PIXEL_BUDGET,
        )

    def test_invalid_and_unrenderable_pages_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "geometry"):
            MODULE.select_page_dpi(float("nan"), 100)
        with self.assertRaisesRegex(ValueError, "minimum DPI"):
            MODULE.select_page_dpi(100_000, 100_000)


class QueueVerificationTests(unittest.TestCase):
    def test_rebuild_uses_queue_bounds_and_accepts_expanded_selection(self):
        queue = {"parameters": {"maxPerFamily": 200, "neighborRadius": 2},
                 "totals": {"candidateCodeCount": 47, "candidateFamilyCount": 9,
                            "selectedUniqueOcrPages": 1},
                 "uniqueSelectedPages": [{"sourceFileId": "F0001", "pageNumber": 1}]}
        paths = (Path("manifest"), Path("index"), Path("audit"), Path("matrix"))
        with patch.object(MODULE, "build_public_family_ocr_queue", return_value=queue) as build:
            self.assertEqual(MODULE.verify_queue(queue, *paths), 1)
        build.assert_called_once_with(*paths, max_per_family=200,
                                      neighbor_radius=2, planning_version=2)

    def test_duplicate_page_is_rejected(self):
        page = {"sourceFileId": "F0001", "pageNumber": 1}
        queue = {"parameters": {"maxPerFamily": 200, "neighborRadius": 2},
                 "totals": {"candidateCodeCount": 47, "candidateFamilyCount": 9,
                            "selectedUniqueOcrPages": 2},
                 "uniqueSelectedPages": [page, dict(page)]}
        with patch.object(MODULE, "build_public_family_ocr_queue", return_value=queue):
            with self.assertRaisesRegex(ValueError, "duplicated"):
                MODULE.verify_queue(queue, Path("m"), Path("i"), Path("a"), Path("x"))


if __name__ == "__main__":
    unittest.main()
