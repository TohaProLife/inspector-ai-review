from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

import fitz

from inspector_worker.vector_proposals import _selected_page_numbers, scan_pdf


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def draw_candidate(page: fitz.Page, x: float = 20) -> None:
    panel = fitz.Rect(x, 10, x + 6, 60)
    page.draw_rect(panel, color=(1, 0, 0), width=0.4)
    page.draw_line(fitz.Point(x + 6, 30), fitz.Point(x + 45, 30), color=(0, 0, 1))


class VectorProposalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "source.pdf"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_pdf(
        self, *, pages: int = 1, draw: bool = True, rotation: int = 0,
        draw_at_pages: set[int] | None = None,
    ) -> None:
        with fitz.open() as document:
            for index in range(pages):
                page = document.new_page(width=200, height=100)
                if draw and (index == 0 if draw_at_pages is None else index + 1 in draw_at_pages):
                    draw_candidate(page)
                if rotation:
                    page.set_rotation(rotation)
            document.save(self.path)

    def test_locates_geometry_with_normalized_bounds_without_class_or_room(self) -> None:
        self.write_pdf()
        result = scan_pdf(self.path, "FIL-1", digest(self.path))

        self.assertEqual(result["status"], "SCANNED")
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual(result["scannedPageCount"], 1)
        self.assertEqual(result["sourceSha256"], digest(self.path))
        self.assertEqual(result["proposals"], [{
            "pageNumber": 1,
            "bboxNormalized": [0.1, 0.1, 0.13, 0.6],
            "status": "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED",
        }])
        self.assertNotIn("class", result["proposals"][0])
        self.assertNotIn("room", result["proposals"][0])
        self.assertFalse(result["proposalLimitReached"])
        self.assertEqual(result["unretainedProposalCount"], 0)

    def test_rotated_page_bbox_uses_displayed_coordinates(self) -> None:
        self.write_pdf(rotation=90)
        result = scan_pdf(self.path, "FIL-1", digest(self.path))
        self.assertEqual(result["proposals"][0]["bboxNormalized"], [0.4, 0.1, 0.9, 0.13])

    def test_no_vector_match_is_not_verified_absence(self) -> None:
        self.write_pdf(draw=False)
        result = scan_pdf(self.path, "FIL-1", digest(self.path))
        self.assertEqual(result["status"], "SCANNED")
        self.assertEqual(result["proposals"], [])
        self.assertNotIn("absenceVerified", result)

    def test_large_pdf_is_skipped_without_partial_scan(self) -> None:
        self.write_pdf(pages=65)
        result = scan_pdf(self.path, "FIL-1", digest(self.path), profile_version="v1")
        self.assertEqual(result["status"], "SKIPPED_PAGE_LIMIT")
        self.assertEqual(result["pageCount"], 65)
        self.assertEqual(result["scannedPageCount"], 0)
        self.assertEqual(result["proposals"], [])
        self.assertNotIn("scannedPageNumbers", result)
        self.assertNotIn("skippedPageCount", result)

    def test_v2_scans_exact_deterministic_page_sample(self) -> None:
        self.write_pdf(pages=65, draw_at_pages=set(range(1, 66)))
        source_hash = digest(self.path)
        result = scan_pdf(self.path, "FIL-1", source_hash, profile_version="v2")
        selected = _selected_page_numbers(65, 64)

        self.assertEqual(result["sourceSha256"], source_hash)
        self.assertEqual(result["status"], "PARTIALLY_SCANNED_PAGE_LIMIT")
        self.assertEqual(result["pageCount"], 65)
        self.assertEqual(result["scannedPageCount"], 64)
        self.assertEqual(result["scannedPageNumbers"], selected)
        self.assertEqual(result["skippedPageCount"], 1)
        self.assertEqual([item["pageNumber"] for item in result["proposals"]], selected)
        self.assertEqual(len(result["proposals"]), 64)
        self.assertFalse(result["proposalLimitReached"])
        self.assertNotIn("absenceVerified", result)
        self.assertEqual(scan_pdf(self.path, "FIL-1", source_hash, profile_version="v2"), result)

    def test_v2_full_scan_lists_all_pages(self) -> None:
        self.write_pdf(pages=3, draw_at_pages={1, 3})
        result = scan_pdf(self.path, "FIL-1", digest(self.path), profile_version="v2")
        self.assertEqual(result["status"], "SCANNED")
        self.assertEqual(result["scannedPageNumbers"], [1, 2, 3])
        self.assertEqual(result["scannedPageCount"], 3)
        self.assertEqual(result["skippedPageCount"], 0)
        self.assertEqual([item["pageNumber"] for item in result["proposals"]], [1, 3])

    def test_v3_scans_every_page_of_614_and_676_page_pdfs(self) -> None:
        for page_count in (614, 676):
            with self.subTest(page_count=page_count):
                self.write_pdf(pages=page_count, draw_at_pages={31, page_count})
                result = scan_pdf(self.path, "FIL-1", digest(self.path))
                self.assertEqual(result["status"], "SCANNED")
                self.assertEqual(result["scannedPageCount"], page_count)
                self.assertEqual(result["scannedPageNumbers"], list(range(1, page_count + 1)))
                self.assertEqual(result["skippedPageCount"], 0)
                self.assertEqual([item["pageNumber"] for item in result["proposals"]], [31, page_count])
                self.assertNotIn("absenceVerified", result)

    def test_v3_above_1024_scans_deterministic_first_middle_last(self) -> None:
        self.write_pdf(pages=1025, draw_at_pages={1, 1025})
        result = scan_pdf(self.path, "FIL-1", digest(self.path))
        pages = _selected_page_numbers(1025, 1024)
        self.assertEqual(len(pages), 1024)
        self.assertEqual(len(set(pages)), 1024)
        self.assertEqual(pages, sorted(pages))
        self.assertEqual(pages[:8], list(range(1, 9)))
        self.assertEqual(pages[-8:], list(range(1018, 1026)))
        self.assertEqual(result["status"], "PARTIALLY_SCANNED_PAGE_LIMIT")
        self.assertEqual(result["scannedPageNumbers"], pages)
        self.assertEqual(result["scannedPageCount"], 1024)
        self.assertEqual(result["skippedPageCount"], 1)
        self.assertEqual([item["pageNumber"] for item in result["proposals"]], [1, 1025])

    def test_large_page_selection_is_spread_and_bounded(self) -> None:
        selected = _selected_page_numbers(614, 64)
        expected_middle = [9 + ((2 * index + 1) * (614 - 16)) // 96 for index in range(48)]
        self.assertEqual(selected, list(range(1, 9)) + expected_middle + list(range(607, 615)))
        self.assertEqual(len(selected), len(set(selected)))
        self.assertEqual(selected, sorted(selected))
        self.assertEqual(_selected_page_numbers(64, 64), list(range(1, 65)))
        self.assertEqual(_selected_page_numbers(65, 64), sorted(set(_selected_page_numbers(65, 64))))

    def test_cap_reports_unretained_proposals_and_keeps_order(self) -> None:
        with fitz.open() as document:
            page = document.new_page(width=200, height=100)
            draw_candidate(page, x=20)
            draw_candidate(page, x=100)
            document.save(self.path)
        result = scan_pdf(self.path, "FIL-1", digest(self.path), max_proposals=1)
        self.assertEqual(len(result["proposals"]), 1)
        self.assertEqual(result["proposals"][0]["bboxNormalized"], [0.1, 0.1, 0.13, 0.6])
        self.assertTrue(result["proposalLimitReached"])
        self.assertEqual(result["unretainedProposalCount"], 1)
        self.assertEqual(result["scannedPageCount"], 1)

    def test_source_hash_and_caps_are_checked(self) -> None:
        self.write_pdf()
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            scan_pdf(self.path, "FIL-1", "0" * 64)
        with self.assertRaisesRegex(ValueError, "max_pages"):
            scan_pdf(self.path, "FIL-1", digest(self.path), max_pages=1025)
        with self.assertRaisesRegex(ValueError, "max_proposals"):
            scan_pdf(self.path, "FIL-1", digest(self.path), max_proposals=501)
        with self.assertRaisesRegex(ValueError, "profile_version"):
            scan_pdf(self.path, "FIL-1", digest(self.path), profile_version="v7")


if __name__ == "__main__":
    unittest.main()
