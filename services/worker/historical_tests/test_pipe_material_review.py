"""A text match stays a review lead, even with a material and pressure token."""

import gzip
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from inspector_worker import pipe_material_review as review

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "output/pipe-material-review-20260928"
OCR_ARTIFACTS = tuple(OUTPUT / name for name in (
    "F0204-p6-ocr-cache.json", "F0204-p6-pdfium90.png", "report.json",
    "F0204-p6-cache-hit-receipt.json",
))


class PipeMaterialReviewTests(unittest.TestCase):
    def require_recorded_ocr(self):
        missing = [str(path) for path in OCR_ARTIFACTS if not path.is_file()]
        if missing:
            self.skipTest("Verified public OCR review artifacts unavailable: " + ", ".join(missing))

    def test_separate_literal_fields_without_cross_network_code(self):
        text = "Канализация К1 из труб напорных НПВХ PN 10 Ø 110 мм"
        result = review.line_observation(text)
        self.assertEqual([x["text"] for x in result["rawNetwork"]], ["Канализация", "К1"])
        self.assertEqual([x["text"] for x in result["rawMaterial"]], ["НПВХ"])
        self.assertEqual([x["text"] for x in result["rawPressureClass"]], ["PN 10"])
        self.assertEqual([x["text"] for x in result["rawPipeType"]], ["напорных"])
        self.assertEqual(result["sameLineCodeHints"], ["IOS3-075"])
        for group in ("rawNetwork", "rawMaterial", "rawPressureClass", "rawPipeType"):
            for span in result[group]:
                self.assertEqual(text[span["start"]:span["end"]], span["text"])
        self.assertEqual(result["reviewStatus"], "REVIEW_ONLY_ABSTAIN")

    def test_material_without_pipe_or_network_does_not_become_code(self):
        self.assertIsNone(review.line_observation("Полипропилен применяется в утеплении"))
        lead = review.line_observation("Трубопровод из полипропилена со стенкой 4 мм")
        self.assertEqual(lead["sameLineCodeHints"], [])
        self.assertEqual(lead["rawPressureClass"], [])

    def test_different_network_words_are_kept_ambiguous(self):
        lead = review.line_observation("Водоснабжение и канализация: трубы стальные")
        self.assertEqual(lead["sameLineCodeHints"], ["IOS2-072", "IOS3-075"])
        self.assertEqual(lead["elementIdentityStatus"], "UNVERIFIED")

    def test_original_member_sha_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            archive_path = Path(folder) / "public.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("root/a.pdf", b"different")
            selected = {"F0163": {"relative_path": "a.pdf", "size_bytes": 9,
                                  "sha256": hashlib.sha256(b"original!").hexdigest()}}
            with self.assertRaisesRegex(review.PipeMaterialReviewError, "PDF SHA mismatch"):
                review._verify_originals(archive_path, selected)

    def test_page_artifact_tamper_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "page.json.gz"
            page = {"indexVersionHash": review.INDEX_VERSION, "inputSha256": "source",
                    "pageNumber": 1, "quality": {"disposition": "TEXT_LAYER_CANDIDATE"}, "lines": []}
            encoded = gzip.compress(json.dumps(page).encode())
            path.write_bytes(encoded + b"tamper")
            row = {"artifact_path": "page.json.gz", "artifact_sha256": hashlib.sha256(encoded).hexdigest(),
                   "page_number": 1, "disposition": "TEXT_LAYER_CANDIDATE"}
            with self.assertRaisesRegex(review.PipeMaterialReviewError, "page artifact SHA mismatch"):
                review._load_page(root, row, "source")

    def test_exact_cached_ocr_keeps_four_uncoded_material_leads(self):
        self.require_recorded_ocr()
        result = review.evaluate_cached_pipe_ocr(
            OUTPUT / "F0204-p6-ocr-cache.json", OUTPUT / "F0204-p6-pdfium90.png",
            OUTPUT / "report.json", OUTPUT / "F0204-p6-cache-hit-receipt.json")
        self.assertEqual(result["ocrLineCount"], 287)
        self.assertEqual([line["lineIndex"] for line in result["leads"]], [44, 48, 124, 126])
        self.assertEqual(result["leads"][0]["rawMaterial"][0]["text"], "НПВХ0")
        self.assertEqual(result["leads"][0]["materialTokenStatus"], "OCR_CORRUPTED_SUFFIX_REVIEW")
        self.assertTrue(all(line["sameLineCodeHints"] == [] for line in result["leads"]))
        self.assertEqual(result["evaluation"]["status"], "ABSTAIN")
        self.assertEqual(result["evaluation"]["facts"], [])

    def test_cached_ocr_and_independent_render_tampering_rejected(self):
        self.require_recorded_ocr()
        cache = OUTPUT / "F0204-p6-ocr-cache.json"
        render = OUTPUT / "F0204-p6-pdfium90.png"
        base = OUTPUT / "report.json"
        replay = OUTPUT / "F0204-p6-cache-hit-receipt.json"
        with tempfile.TemporaryDirectory() as folder:
            forged = Path(folder) / "cache.json"
            forged.write_bytes(cache.read_bytes() + b" ")
            with self.assertRaisesRegex(review.PipeMaterialReviewError, "OCR cache or independent render SHA"):
                review.evaluate_cached_pipe_ocr(forged, render, base, replay)
            forged.write_bytes(render.read_bytes() + b" ")
            with self.assertRaisesRegex(review.PipeMaterialReviewError, "OCR cache or independent render SHA"):
                review.evaluate_cached_pipe_ocr(cache, forged, base, replay)
            forged.write_bytes(replay.read_bytes() + b" ")
            with self.assertRaisesRegex(review.PipeMaterialReviewError, "cache replay receipt SHA"):
                review.evaluate_cached_pipe_ocr(cache, render, base, forged)


if __name__ == "__main__":
    unittest.main()
