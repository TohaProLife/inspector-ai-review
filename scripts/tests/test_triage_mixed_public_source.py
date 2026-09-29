from __future__ import annotations

import hashlib
import json
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "triage-mixed-public-source.py"
TRIAGE = runpy.run_path(str(SCRIPT))
SMOKE_PDF = SCRIPT.parent / "fixtures/smoke.pdf"


class MixedPublicSourceTriageTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.pdf = self.root / "source.pdf"
        self.pdf.write_bytes(SMOKE_PDF.read_bytes())
        self.manifest = self.root / "document_manifest.jsonl"
        self.row = {
            "file_id": "PUBLIC-1", "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "stage": "RD_ID_MIXED", "pdf_pages": 1,
            "size_bytes": self.pdf.stat().st_size,
            "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
        }
        self.write_manifest()

    def write_manifest(self, *rows: dict) -> None:
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in (rows or (self.row,))),
                                 encoding="utf-8")

    @unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftotext"),
                         "Poppler pdfinfo and pdftotext are required for the real PDF CLI integration")
    def test_real_pdf_cli_produces_read_only_provenance_and_no_stage_assignment(self) -> None:
        output = self.root / "nested/triage.json"
        result = subprocess.run([
            sys.executable, str(SCRIPT), "--manifest", str(self.manifest),
            "--source-id", "PUBLIC-1", "--pdf", str(self.pdf), "--output", str(output),
        ], capture_output=True, text=True, check=True)
        report = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "REVIEW_QUEUE_ONLY")
        self.assertIsNone(report["stageAssignments"])
        self.assertEqual(report["source"]["pdfSha256"], self.row["sha256"])
        self.assertEqual(report["source"]["pageCount"], 1)
        self.assertEqual(report["reviewQueue"]["other_text"]["pageIds"], [1])
        self.assertEqual(report["unresolvedWithinThisReport"]["count"], 1)
        self.assertEqual(json.loads(result.stdout)["reviewQueueCounts"]["other_text"], 1)
        self.assertEqual(self.pdf.read_bytes(), SMOKE_PDF.read_bytes())

    def test_review_groups_are_disjoint_but_cues_may_overlap(self) -> None:
        pages = [
            "РАБОЧАЯ ДОКУМЕНТАЦИЯ\nИСПОЛНИТЕЛЬНАЯ СХЕМА",
            "ИСПОЛНИТЕЛЬНАЯ ДОКУМЕНТАЦИЯ",
            "Комплект РАБОЧИХ ЧЕРТЕЖЕЙ",
            "",
            "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ KORF для вентиляции",
            "Каталог KORF воздухообрабатывающих установок",
            "Другой нейтральный текст проектной документации",
        ]
        report = TRIAGE["build_triage"](
            pages, source_id="PUBLIC-1", source_sha256="a" * 64,
            source_size_bytes=123, manifest_sha256="b" * 64, list_limit=2,
        )
        queue = report["reviewQueue"]
        self.assertEqual({name: group["count"] for name, group in queue.items()}, {
            "conflicting_stage_markers": 1, "explicit_id_text": 1,
            "explicit_rd_text": 1, "near_empty_text": 1,
            "commercial_text": 1, "vendor_text": 1, "other_text": 1,
        })
        self.assertEqual(report["textCues"]["vendor_text"]["pageIds"], [5, 6])
        self.assertEqual(report["textCues"]["explicit_rd_text"]["pageIds"], [1, 3])
        self.assertEqual(report["unresolvedWithinThisReport"], {
            "count": 7, "pageIds": [1, 2], "omittedPageCount": 5,
        })
        self.assertIsNone(report["stageAssignments"])

    def test_hidden_or_excluded_source_rejected_before_pdf_read(self) -> None:
        for field, value in (("split", "TEST_HIDDEN"),
                             ("distribution_status", "EXCLUDE"),
                             ("label_visibility", "CLOSED"),
                             ("stage", "RD")):
            with self.subTest(field=field):
                row = {**self.row, field: value}
                self.write_manifest(row)
                with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
                    TRIAGE["public_manifest_row"](self.manifest, "PUBLIC-1")

    def test_duplicate_manifest_row_rejected(self) -> None:
        self.write_manifest(self.row, self.row)
        with self.assertRaisesRegex(ValueError, "one manifest row"):
            TRIAGE["public_manifest_row"](self.manifest, "PUBLIC-1")

    def test_size_hash_and_page_count_mismatch_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "size"):
            TRIAGE["verified_pdf"](self.pdf, {**self.row, "size_bytes": 1})
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            TRIAGE["verified_pdf"](self.pdf, {**self.row, "sha256": "0" * 64})
        with mock.patch("subprocess.run", return_value=subprocess.CompletedProcess(
                ["pdfinfo", str(self.pdf)], 0, stdout="Pages: 1\n")) as pdfinfo:
            with self.assertRaisesRegex(ValueError, "page count"):
                TRIAGE["extract_page_text"](self.pdf, 2)
            self.assertEqual(pdfinfo.call_count, 1)
            self.assertEqual(pdfinfo.call_args.args[0], ["pdfinfo", str(self.pdf)])
        with self.assertRaisesRegex(ValueError, "triage bound"):
            TRIAGE["extract_page_text"](self.pdf, 3001)

    def test_cli_refuses_to_overwrite_pdf_or_manifest(self) -> None:
        for protected in (self.pdf, self.manifest):
            with self.subTest(protected=protected):
                original = protected.read_bytes()
                result = subprocess.run([
                    sys.executable, str(SCRIPT), "--manifest", str(self.manifest),
                    "--source-id", "PUBLIC-1", "--pdf", str(self.pdf),
                    "--output", str(protected),
                ], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Output path must differ", result.stderr)
                self.assertEqual(protected.read_bytes(), original)

    def test_output_bound_and_determinism(self) -> None:
        kwargs = {"source_id": "PUBLIC-1", "source_sha256": "a" * 64,
                  "source_size_bytes": 123, "manifest_sha256": "b" * 64, "list_limit": 2}
        first = TRIAGE["build_triage"](["" for _ in range(12)], **kwargs)
        second = TRIAGE["build_triage"](["" for _ in range(12)], **kwargs)
        self.assertEqual(first, second)
        self.assertEqual(first["reviewQueue"]["near_empty_text"], {
            "count": 12, "pageIds": [1, 2], "omittedPageCount": 10,
        })
        with self.assertRaisesRegex(ValueError, "list_limit"):
            TRIAGE["build_triage"](["abc"], **{**kwargs, "list_limit": 201})


if __name__ == "__main__":
    unittest.main()
