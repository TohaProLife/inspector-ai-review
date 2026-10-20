"""Offline, synthetic receipt packaging tests; never starts OCR or authenticates a raster."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "package-source-ocr-import.py"
SPEC = importlib.util.spec_from_file_location("package_source_ocr_import", SCRIPT)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pdf = self.root / "synthetic.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\n% Synthetic package-only byte identity fixture\n%%EOF\n")
        self.native = self.root / "native.json"
        self.native.write_bytes(MOD.encode({"schemaVersion": "document-text-v4", "sourceFileId": "SYNTHETIC",
            "inputSha256": MOD.digest(self.pdf.read_bytes()), "pageCount": 3,
            "pages": [{"pageNumber": n, "widthMilliPoints": 600000, "heightMilliPoints": 800000,
                "quality": {"disposition": "CANDIDATE" if n == 1 else "OCR_REQUIRED"}} for n in range(1, 4)]}))
        self.probe = self.root / "probe"
        self.probe.mkdir()
        entries = []
        self.raw = (json.dumps({"schemaVersion": "document-ai-ocr-response-v1", "profileId": MOD.PROFILE,
            "script": "eslav", "results": [{"width": 10, "height": 20, "overall_ocr_res": {
                "rec_texts": ["  Точная строка 😀\n", ""], "rec_scores": [0.9, 0.1], "rec_boxes": [[0, 0, 10, 20], [0, 0, 1, 1]]}}]},
            ensure_ascii=False, indent=2) + "\r\n").encode("utf-8")
        # Bytes are an externally claimed raster; this packager intentionally does not certify PNG derivation.
        raster = b"SYNTHETIC EXTERNAL RASTER BYTES"
        for n in (2, 3):
            folder = self.probe / f"p{n:03d}"
            folder.mkdir()
            (folder / "response.json").write_bytes(self.raw)
            (folder / "render.png").write_bytes(raster)
            entries.append({"pageNumber": n, "responseSha256": MOD.digest(self.raw), "renderSha256": MOD.digest(raster),
                "sourcePdfSha256": MOD.digest(self.pdf.read_bytes()), "nativeV4Sha256": MOD.digest(self.native.read_bytes()),
                "profileId": MOD.PROFILE, "widthMilliPoints": 600000, "heightMilliPoints": 800000,
                "rasterWidth": 10, "rasterHeight": 20})
        self.report = {"schemaVersion": "full-source-ocr-gap-probe-v1", "status": "ALL_SELECTED_PAGES_REPLAYED_REVIEW_ONLY",
            "failures": [], "selectionPolicy": "ALL_EXACT_OCR_REQUIRED_PAGES_NO_PREFIX_SAMPLING", "sourceFileId": "SYNTHETIC",
            "sourcePdfSha256": MOD.digest(self.pdf.read_bytes()), "nativeV4Sha256": MOD.digest(self.native.read_bytes()),
            "nativePageCount": 3, "selectedPageNumbers": [2, 3], "pages": entries}
        self.pin_report()

    def pin_report(self):
        raw = MOD.encode(self.report)
        (self.probe / "report.json").write_bytes(raw)
        self.report_pin = MOD.digest(raw)

    def package(self):
        return MOD.package(self.probe, self.native, self.pdf, self.report_pin)

    def test_exact_utf8_response_and_complete_gap_set_without_execution_claim(self):
        result = self.package()
        self.assertEqual([p["pageNumber"] for p in result["pages"]], [2, 3])
        self.assertEqual(result["pages"][0]["rawResponseJson"].encode("utf-8"), self.raw)
        self.assertEqual(result["pages"][0]["renderSha256"], self.report["pages"][0]["renderSha256"])
        self.assertEqual(MOD.encode(result), MOD.encode(self.package()))
        self.assertNotIn("providerExecutionVerified", result)
        self.assertNotIn("bboxMilliPoints", MOD.encode(result).decode())

    def test_report_and_original_byte_substitution(self):
        for filename in (self.pdf, self.native, self.probe / "report.json"):
            with self.subTest(filename=filename.name):
                original = filename.read_bytes()
                filename.write_bytes(original + b" ")
                with self.assertRaisesRegex(ValueError, "SHA256_MISMATCH"):
                    self.package()
                filename.write_bytes(original)

    def test_response_and_raster_byte_substitution(self):
        for name in ("response.json", "render.png"):
            filename = self.probe / "p002" / name
            original = filename.read_bytes()
            filename.write_bytes(original + b" ")
            with self.assertRaisesRegex(ValueError, "PAGE_RESPONSE_RASTER_OR_SOURCE_PIN_MISMATCH"):
                self.package()
            filename.write_bytes(original)

    def test_partial_duplicate_reordered_extra_pages_and_wrong_geometry_rejected(self):
        original = copy.deepcopy(self.report)
        for mutation in (lambda r: r["pages"].pop(), lambda r: r["pages"].reverse(),
                lambda r: r["pages"].append(copy.deepcopy(r["pages"][0])),
                lambda r: r["pages"][0].__setitem__("pageNumber", 1),
                lambda r: r["pages"][0].__setitem__("widthMilliPoints", 600001),
                lambda r: r["selectedPageNumbers"].pop()):
            self.report = copy.deepcopy(original)
            mutation(self.report)
            self.pin_report()
            with self.assertRaises(ValueError):
                self.package()

    def test_profile_and_response_frame_checked_even_with_fresh_response_pin(self):
        for field, value in (("profileId", "foreign-profile"), ("results", [{"width": 11, "height": 20}]),
                ("results", []), ("script", "other")):
            with self.subTest(field=field, value=value):
                response = MOD.load(self.raw)
                response[field] = value
                raw = MOD.encode(response)
                (self.probe / "p002" / "response.json").write_bytes(raw)
                self.report["pages"][0]["responseSha256"] = MOD.digest(raw)
                self.pin_report()
                with self.assertRaisesRegex(ValueError, "OCR_RESPONSE_PROFILE_OR_FRAME_MISMATCH"):
                    self.package()

    def test_report_must_be_complete_and_bounded(self):
        original = copy.deepcopy(self.report)
        for field, value in (("failures", ["unresolved execution"]), ("status", "PARTIAL"),
                ("selectionPolicy", "FIRST_PAGES_ONLY"), ("nativePageCount", 2)):
            self.report = copy.deepcopy(original)
            self.report[field] = value
            self.pin_report()
            with self.assertRaises(ValueError):
                self.package()
        with self.assertRaisesRegex(ValueError, "EXPECTED_REPORT_SHA256_REQUIRED"):
            MOD.package(self.probe, self.native, self.pdf, "missing")

    def test_json_duplicates_and_file_cap_rejected(self):
        with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
            MOD.load(b'{"a":1,"a":2}')
        with self.assertRaisesRegex(ValueError, "NONFINITE_JSON"):
            MOD.load(b'{"a":NaN}')
        with self.assertRaisesRegex(ValueError, "INPUT_FILE_LIMIT_OR_MISSING"):
            MOD.read_bounded(self.pdf, 4)

    def test_cli_does_not_overwrite_and_failed_attempt_never_creates_bundle(self):
        output = self.root / "bundle.json"
        command = [sys.executable, str(SCRIPT), "--probe-dir", str(self.probe), "--native-v4", str(self.native),
            "--pdf", str(self.pdf), "--expected-report-sha256", self.report_pin, "--output", str(output)]
        first = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(first.returncode, 0, first.stderr)
        receipt = json.loads(first.stdout)
        self.assertEqual(receipt["sha256"], MOD.digest(output.read_bytes()))
        self.assertFalse(receipt["providerExecutionVerified"])
        self.assertFalse(receipt["renderDerivationVerified"])
        original = output.read_bytes()
        again = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(again.returncode, 2)
        self.assertIn("OUTPUT_ALREADY_EXISTS", again.stderr)
        self.assertEqual(output.read_bytes(), original)
        output.unlink()
        (self.probe / "p002" / "response.json").write_bytes(b"tampered")
        failed = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(failed.returncode, 2)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
