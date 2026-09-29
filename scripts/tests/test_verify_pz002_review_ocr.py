from __future__ import annotations

import json
from pathlib import Path
import runpy
import tempfile
import unittest


MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "verify-pz002-review-ocr.py"))


class Pz002OcrCrosscheckTests(unittest.TestCase):
    def test_same_row_value_is_review_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ocr.json"
            path.write_text(json.dumps({
                "schemaVersion": "document-public-smoke-v1",
                "source": {"sha256": "a" * 64, "page": 2},
                "render": {"sha256": "b" * 64, "sourcePageCount": 4},
                "ocr": {"schemaVersion": "document-ai-ocr-response-v1", "profileId": "local",
                        "results": [{"overall_ocr_res": {
                            "rec_texts": ["Общая площадь здания", "100,2"],
                            "rec_boxes": [[1, 1, 20, 10], [30, 2, 50, 10]],
                            "rec_scores": [0.9, 0.8],
                        }}]},
            }), encoding="utf-8")
            source = {"sourceFileId": "F1", "sourceSha256": "a" * 64,
                      "pdfPageNumber": 2, "rawValue": "100,2"}
            result = MODULE["crosscheck"](source, path)
            self.assertEqual((result["label"]["index"], result["value"]["index"]), (0, 1))
            self.assertEqual(result["sourceFileId"], "F1")

            source["sourceSha256"] = "c" * 64
            with self.assertRaisesRegex(ValueError, "does not match"):
                MODULE["crosscheck"](source, path)

    def test_unrelated_row_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ocr.json"
            path.write_text(json.dumps({
                "schemaVersion": "document-public-smoke-v1",
                "source": {"sha256": "a" * 64, "page": 2},
                "render": {"sha256": "b" * 64, "sourcePageCount": 4},
                "ocr": {"schemaVersion": "document-ai-ocr-response-v1", "profileId": "local",
                        "results": [{"overall_ocr_res": {
                            "rec_texts": ["Общая площадь здания", "100,2"],
                            "rec_boxes": [[1, 1, 20, 10], [30, 50, 50, 60]],
                            "rec_scores": [0.9, 0.8],
                        }}]},
            }), encoding="utf-8")
            source = {"sourceFileId": "F1", "sourceSha256": "a" * 64,
                      "pdfPageNumber": 2, "rawValue": "100,2"}
            with self.assertRaisesRegex(ValueError, "0 same-row"):
                MODULE["crosscheck"](source, path)


if __name__ == "__main__":
    unittest.main()
