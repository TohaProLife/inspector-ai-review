"""Focused checks for review-only source thumbnails."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import fitz


MODULE_PATH = Path(__file__).resolve().parents[1] / "build-source-review-atlas.py"
SPEC = importlib.util.spec_from_file_location("source_review_atlas", MODULE_PATH)
assert SPEC and SPEC.loader
atlas = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(atlas)


class SourceReviewAtlasTests(unittest.TestCase):
    def test_selected_pages_include_first_and_cue_pages_without_duplicates(self) -> None:
        source = {"titleLocators": [{"pageNumber": 3}, {"pageNumber": 3},
                                    {"pageNumber": 2}, {"pageNumber": 4}]}
        self.assertEqual(atlas._pages(source, 4), [1, 3, 2])
        self.assertEqual(atlas._pages({"titleLocators": []}, 2), [1, 2])
        unresolved_section = {"manifestSection": "OTHER",
                              "titleLabels": {"drawingSections": []},
                              "titleLocators": [{"pageNumber": 1}]}
        self.assertEqual(atlas._pages(unresolved_section, 5), [1, 2, 3])

    def test_render_bound_and_existing_image_tamper_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pdf"
            with fitz.open() as document:
                page = document.new_page(width=840, height=1188)
                page.insert_text((30, 40), "PUBLIC SAMPLE")
                document.save(path)
            with fitz.open(path) as document:
                full = atlas._render_page(document[0], stamp=False)
                stamp = atlas._render_page(document[0], stamp=True)
            self.assertTrue(full.startswith(b"\x89PNG"))
            self.assertTrue(stamp.startswith(b"\x89PNG"))
            self.assertLessEqual(len(full), atlas.MAX_IMAGE_BYTES)
            self.assertLessEqual(len(stamp), atlas.MAX_IMAGE_BYTES)
            target = Path(directory) / "sample.png"
            atlas._save_image(target, full)
            atlas._save_image(target, full)
            target.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "existing atlas image differs"):
                atlas._save_image(target, full)

    def test_html_escapes_source_titles_and_leaves_decisions_unset(self) -> None:
        source = {"reviewRank": 1, "sourceFileId": "F0001", "manifestStage": "PD",
                  "manifestSection": "OTHER", "priorityTier": "REVIEW",
                  "sourceRelativePath": '<img src="remote">.pdf',
                  "sourceSha256": "a" * 64,
                  "titleLabels": {"stages": ["PD"], "drawingSections": [],
                                  "literalCiphers": []},
                  "images": [{"path": "images/F0001-p1-full.png", "pageNumber": 1,
                              "kind": "FULL_PAGE", "sha256": "b" * 64}]}
        page = atlas._html({"sources": [source]})
        self.assertIn("&lt;img src=&quot;remote&quot;&gt;.pdf", page)
        self.assertNotIn('<img src="remote">', page)
        self.assertIn("Решения в атласе не сохраняются", page)


if __name__ == "__main__":
    unittest.main()
