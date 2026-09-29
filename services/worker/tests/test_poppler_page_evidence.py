"""Source-independent Poppler page receipts; public original opt-in smoke."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.poppler_page_evidence import (
    POPPLER_VERSION, _parse_words, _run, _version, extract_poppler_page_evidence,
)


PUBLIC_F0152_SHA = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af"
PUBLIC_F0152_SIZE = 6_359_136
_XML = (b'<html><body><page width="595.320000" height="841.920000">'
        b'<word xMin="450.220000" yMin="147.297320" '
        b'xMax="467.800000" yMax="156.261320">0,65</word>'
        b'<word xMin="467.860000" yMin="146.194160" '
        b'xMax="471.100000" yMax="152.026160">*</word>'
        b'</page></body></html>')
_PLAIN = "Тест страницы\n".encode()


def _hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _fake_run(program: str, arguments: list[str], _limit: int) -> tuple[bytes, bytes]:
    if arguments == ["-v"]:
        return b"", f"{program} version {POPPLER_VERSION}\nCopyright Poppler\n".encode()
    if program == "pdfinfo":
        return b"Pages: 2\nEncrypted: no\n", b""
    if "-bbox-layout" in arguments:
        return _XML, b""
    if "-raw" in arguments:
        return _PLAIN, b""
    raise AssertionError(f"unexpected invocation: {program} {arguments}")


class PopplerPageEvidenceTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "Poppler bounded pipe reads require POSIX selectors; Windows selects sockets only")
    def test_subprocess_output_is_bounded_while_reading(self) -> None:
        self.assertEqual(_run(sys.executable, ["-c", "import sys; sys.stdout.write('ok')"], 16), (b"ok", b""))
        with self.assertRaisesRegex(ValueError, "output outside bounds"):
            _run(sys.executable, ["-c", "import sys; sys.stdout.buffer.write(bytes(2048))"], 100)

    def test_complete_page_receipt_and_canonical_hash(self) -> None:
        data = b"%PDF-synthetic page receipt"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pdf"
            path.write_bytes(data)
            with patch("inspector_worker.poppler_page_evidence._run", side_effect=_fake_run) as run:
                result = extract_poppler_page_evidence(
                    path, expected_sha256=hashlib.sha256(data).hexdigest(),
                    expected_byte_size=len(data), expected_page_count=2, page_numbers=[2],
                )
            self.assertEqual(run.call_count, 5)
        self.assertEqual((result["schemaVersion"], result["purpose"]),
                         ("poppler-page-evidence-v1", "REVIEW_ONLY"))
        self.assertEqual(result["selectedPageNumbers"], [2])
        self.assertEqual(result["absenceConclusion"], "NOT_AVAILABLE")
        for field in ("findings", "typedFacts", "parameterCoverage"):
            self.assertIsNone(result[field])
        page = result["pageEvidence"][0]
        self.assertEqual(page["pdfPageCount"], 2)
        self.assertEqual(page["pageNumber"], 2)
        self.assertEqual(page["pageWidthMilliPoints"], 595320)
        self.assertEqual(page["pageHeightMilliPoints"], 841920)
        self.assertEqual(page["pageText"], "Тест страницы\n")
        self.assertEqual(page["xmlSha256"], hashlib.sha256(_XML).hexdigest())
        self.assertEqual(page["plainTextSha256"], hashlib.sha256(_PLAIN).hexdigest())
        self.assertEqual(page["words"], [
            {"wordIndex": 0, "rawText": "0,65",
             "bboxMilliPointsTopLeft": [450220, 147297, 467800, 156261]},
            {"wordIndex": 1, "rawText": "*",
             "bboxMilliPointsTopLeft": [467860, 146194, 471100, 152026]},
        ])
        self.assertEqual(page["wordArtifactSha256"], _hash(page["words"]))
        self.assertEqual(page["inspectionSha256"],
                         _hash({key: value for key, value in page.items()
                                if key != "inspectionSha256"}))
        self.assertEqual(result["contentHash"],
                         _hash({key: value for key, value in result.items()
                                if key != "contentHash"}))

    def test_source_scope_and_modified_bytes_rejected_before_poppler(self) -> None:
        data = b"%PDF-synthetic page receipt"
        expected = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pdf"
            path.write_bytes(data)
            invalid = [
                ("0" * 64, len(data), 2, [1]),
                (expected, len(data) + 1, 2, [1]),
                (expected, len(data), 2, [2, 1]),
                (expected, len(data), 2, [1, 1]),
                (expected, len(data), 2, [0]),
                (expected, len(data), 2, [3]),
                (expected, len(data), 2, [1, 2, 3, 4, 5]),
                (expected, True, 2, [1]),
            ]
            with patch("inspector_worker.poppler_page_evidence._run") as run:
                for sha, size, count, pages in invalid:
                    with self.subTest(size=size, pages=pages), self.assertRaises(ValueError):
                        extract_poppler_page_evidence(
                            path, expected_sha256=sha, expected_byte_size=size,
                            expected_page_count=count, page_numbers=pages,
                        )
                path.write_bytes(data + b"modified")
                with self.assertRaises(ValueError):
                    extract_poppler_page_evidence(
                        path, expected_sha256=expected, expected_byte_size=len(data),
                        expected_page_count=2, page_numbers=[1],
                    )
                run.assert_not_called()

    def test_exact_both_binary_versions_and_pdf_warnings(self) -> None:
        data = b"%PDF-synthetic page receipt"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pdf"
            path.write_bytes(data)
            args = dict(expected_sha256=hashlib.sha256(data).hexdigest(),
                        expected_byte_size=len(data), expected_page_count=2,
                        page_numbers=[1])

            def wrong_version(program: str, arguments: list[str], limit: int):
                if program == "pdfinfo" and arguments == ["-v"]:
                    return b"", b"pdfinfo version 25.03.0\n"
                return _fake_run(program, arguments, limit)

            with patch("inspector_worker.poppler_page_evidence._run",
                       side_effect=wrong_version) as run:
                with self.assertRaisesRegex(ValueError, "requires pdfinfo 25.12.0"):
                    extract_poppler_page_evidence(path, **args)
                self.assertEqual(run.call_count, 2)

            def warning(program: str, arguments: list[str], limit: int):
                if program == "pdfinfo" and arguments != ["-v"]:
                    return b"Pages: 2\nEncrypted: no\n", b"Syntax Warning"
                return _fake_run(program, arguments, limit)

            with patch("inspector_worker.poppler_page_evidence._run",
                       side_effect=warning):
                with self.assertRaisesRegex(ValueError, "PDF warning"):
                    extract_poppler_page_evidence(path, **args)

    def test_parser_rejects_missing_ambiguous_and_out_of_bounds_words(self) -> None:
        for xml in (
            b'<page width="100" height="100"/>',
            b'<root><page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="1" yMax="1">A</word></page><page width="100" height="100"/></root>',
            b'<page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="101" yMax="1">A</word></page>',
            b'<page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="1" yMax="1"></word></page>',
            b'<!DOCTYPE html [<!ENTITY a "expanded">]><page width="100" height="100">'
            b'<word xMin="0" yMin="0" xMax="1" yMax="1">&a;</word></page>',
            b'<root><word xMin="0" yMin="0" xMax="1" yMax="1">outside</word>'
            b'<page width="100" height="100"><word xMin="0" yMin="0" '
            b'xMax="1" yMax="1">inside</word></page></root>',
        ):
            with self.subTest(xml=xml), self.assertRaises(ValueError):
                _parse_words(xml)

    def test_local_nonpinned_poppler_fails_closed(self) -> None:
        from subprocess import run
        try:
            observed = run(["pdftotext", "-v"], capture_output=True, check=True,
                           text=True).stderr.splitlines()[0]
        except OSError as error:  # environment may omit Poppler entirely
            self.skipTest(str(error))
        if observed == f"pdftotext version {POPPLER_VERSION}":
            self.assertEqual(_version("pdftotext"), POPPLER_VERSION)
        else:
            with self.assertRaisesRegex(ValueError, "requires pdftotext 25.12.0"):
                _version("pdftotext")

    @unittest.skipUnless(os.environ.get("INSPECTOR_PUBLIC_F0152_PDF"),
                         "original permitted F0152 PDF path not supplied")
    def test_original_permitted_f0152_pages(self) -> None:
        path = Path(os.environ["INSPECTOR_PUBLIC_F0152_PDF"])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), PUBLIC_F0152_SHA)
        first = extract_poppler_page_evidence(
            path, expected_sha256=PUBLIC_F0152_SHA,
            expected_byte_size=PUBLIC_F0152_SIZE, expected_page_count=77,
            page_numbers=[49, 51],
        )
        second = extract_poppler_page_evidence(
            path, expected_sha256=PUBLIC_F0152_SHA,
            expected_byte_size=PUBLIC_F0152_SIZE, expected_page_count=77,
            page_numbers=[49, 51],
        )
        self.assertEqual(first, second)
        self.assertEqual(first["contentHash"],
                         "074041a83a3a52c724cd8c4bf47f65cdf1ae3f0e6b66988d615496bc0a83eb26")
        self.assertEqual([len(page["words"]) for page in first["pageEvidence"]], [135, 173])
        self.assertEqual(first["purpose"], "REVIEW_ONLY")
        self.assertIsNone(first["typedFacts"])
        self.assertIsNone(first["findings"])
        self.assertIsNone(first["parameterCoverage"])


if __name__ == "__main__":
    unittest.main()
