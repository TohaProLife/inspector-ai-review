"""Bounded IOS4-077 observations must preserve source and OCR uncertainty."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.radiator_spec import build_public_observation_slice


def _pdf(path: Path, *, specification: bool) -> None:
    pdf = fitz.open()
    page = pdf.new_page(width=1200, height=800)
    if specification:
        for x, text in ((240, "33-500-800"), (533, "PRADO Classic"),
                        (961, "6"), (1096, "2,501 kW")):
            page.insert_text((x, 200), text)
    pdf.save(path)


def _source(source_id: str, path: Path) -> dict:
    return {
        "file_id": source_id, "object_id": "OBJ-1", "split": "TRAIN_PUBLIC",
        "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
        "extension": ".pdf", "stage": "PD" if source_id == "F0171" else "RD_ID_MIXED",
        "section": "OV", "relative_path": f"{source_id}.pdf", "pdf_pages": 1,
        "size_bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _artifact(source_hash: str, *, unit: str = "2,501 kBm",
              duplicate_quantity: bool = False) -> dict:
    lines = [
        {"text": "33-500-800", "score": .99, "bboxPx": [395, 300, 535, 340]},
        {"text": "6", "score": .98, "bboxPx": [1990, 300, 2020, 340]},
        {"text": unit, "score": .97, "bboxPx": [2080, 300, 2200, 340]},
    ]
    if duplicate_quantity:
        lines.append({"text": "8", "score": .99, "bboxPx": [1992, 302, 2022, 342]})
    artifact = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": "F0202",
        "inputSha256": source_hash, "pageNumber": 1,
        "render": {"sha256": "a" * 64, "widthPx": 2500, "heightPx": 1800,
                   "dpi": 150, "rendererProfileId": "local"},
        "provider": {"profileId": "local", "script": "eslav"}, "lines": lines,
    }
    artifact["contentHash"] = canonical_hash(artifact)
    return artifact


class RadiatorObservationSliceTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.pd = root / "F0171.pdf"
        self.mixed = root / "F0202.pdf"
        _pdf(self.pd, specification=True)
        _pdf(self.mixed, specification=False)
        self.pd_source = _source("F0171", self.pd)
        self.mixed_source = _source("F0202", self.mixed)
        self.manifest = root / "document_manifest.jsonl"
        self._write_manifest()

    def _write_manifest(self) -> None:
        self.manifest.write_text("\n".join(json.dumps(source) for source in
                                            (self.pd_source, self.mixed_source)) + "\n",
                                 encoding="utf-8")

    def _observe(self, artifact: dict) -> dict:
        return build_public_observation_slice(
            self.manifest, self.pd, self.mixed,
            pd_pages=[1], mixed_pages=[1], ocr_artifacts=[artifact],
        )

    def test_real_text_cells_and_unreadable_ocr_unit_remain_observations(self) -> None:
        report = self._observe(_artifact(self.mixed_source["sha256"]))
        pd_row = report["pdRows"][0]
        mixed_row = report["mixedRdIdRows"][0]
        self.assertEqual(pd_row["unitHeatOutputKw"], "2.501")
        self.assertEqual(pd_row["textLayerCells"]["quantity"][0]["text"], "6")
        self.assertEqual(pd_row["textLayerCells"]["unitHeatOutput"][1]["text"], "kW")
        self.assertEqual(mixed_row["rawCells"]["unitHeatOutput"]["text"], "2,501 kBm")
        self.assertIsNone(mixed_row["unitHeatOutputKw"])
        self.assertEqual(mixed_row["pageStage"], "UNKNOWN")
        self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertIn("OCR_UNIT_UNVERIFIED", report["evaluation"]["reasonCodes"])
        self.assertIn("MIXED_PAGE_STAGE_UNRESOLVED", report["evaluation"]["reasonCodes"])
        self.assertEqual(report["evaluation"]["comparableFacts"], [])
        self.assertIsNone(report["evaluation"]["finding"])
        self.assertEqual(report["comparisonDisposition"], "ABSTAIN")
        self.assertIsNone(report["finding"])
        self.assertEqual(report["contentHash"], canonical_hash({
            key: value for key, value in report.items() if key != "contentHash"
        }))

    def test_exact_ocr_unit_still_cannot_qualify_mixed_stage_or_entity(self) -> None:
        report = self._observe(_artifact(self.mixed_source["sha256"], unit="2,501 kW"))
        self.assertEqual(report["mixedRdIdRows"][0]["unitHeatOutputKw"], "2.501")
        self.assertEqual(report["mixedRdIdRows"][0]["pageStage"], "UNKNOWN")
        self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(report["evaluation"]["comparableFacts"], [])
        self.assertIsNone(report["finding"])

    def test_competing_ocr_quantity_cells_do_not_choose_nearest(self) -> None:
        report = self._observe(_artifact(self.mixed_source["sha256"],
                                         unit="2,501 kW", duplicate_quantity=True))
        row = report["mixedRdIdRows"][0]
        self.assertIsNone(row["quantity"])
        self.assertIsNone(row["rawCells"]["quantity"])
        self.assertEqual(row["parseStatus"], "PARTIAL")

    def test_source_and_artifact_tampering_fail_before_observation(self) -> None:
        self.mixed_source["sha256"] = "f" * 64
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self._observe(_artifact(self.mixed_source["sha256"]))
        self.mixed_source = _source("F0202", self.mixed)
        self._write_manifest()
        artifact = _artifact(self.mixed_source["sha256"])
        artifact["lines"][0]["text"] = "33-500-900"
        with self.assertRaisesRegex(ValueError, "contentHash mismatch"):
            self._observe(artifact)

    def test_page_scope_must_be_unique_and_match_ocr_artifacts(self) -> None:
        artifact = _artifact(self.mixed_source["sha256"])
        with self.assertRaisesRegex(ValueError, "unique and bounded"):
            build_public_observation_slice(self.manifest, self.pd, self.mixed,
                                           pd_pages=[1, 1], mixed_pages=[1],
                                           ocr_artifacts=[artifact])
        with self.assertRaisesRegex(ValueError, "cover exactly"):
            build_public_observation_slice(self.manifest, self.pd, self.mixed,
                                           pd_pages=[1], mixed_pages=[1], ocr_artifacts=[])

    def test_cli_flag_is_opt_in_and_default_schema_is_preserved(self) -> None:
        script = Path(__file__).resolve().parents[3] / "scripts" / "probe-radiator-spec.py"
        spec = importlib.util.spec_from_file_location("probe_radiator_spec_cli", script)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        artifact = _artifact(self.mixed_source["sha256"])
        base_args = ["probe-radiator-spec.py", "--manifest", str(self.manifest),
                     "--pd-source", str(self.pd), "--rd-source", str(self.mixed),
                     "--pd-page", "1", "--rd-page", "1"]
        for enabled, expected_schema in (
            (False, "ios4-077-public-spec-probe-v1"),
            (True, "ios4-077-public-observation-slice-v1"),
        ):
            with self.subTest(observation_slice=enabled):
                output = self.manifest.parent / ("slice.json" if enabled else "default.json")
                argv = base_args + (["--observation-slice"] if enabled else []) + ["--output", str(output)]
                stdout = io.StringIO()
                with (patch.object(sys, "argv", argv),
                      patch.object(module, "recognize_pdf_page", return_value=artifact),
                      redirect_stdout(stdout), redirect_stderr(io.StringIO())):
                    module.main()
                report = json.loads(output.read_text(encoding="utf-8"))
                summary = json.loads(stdout.getvalue())
                self.assertEqual(report["schemaVersion"], expected_schema)
                self.assertEqual(summary["fileSha256"], hashlib.sha256(output.read_bytes()).hexdigest())
                self.assertEqual(summary["contentHash"], report["contentHash"])
                self.assertEqual(summary["comparisonDisposition"], "ABSTAIN")
                self.assertIsNone(report["finding"])
                if enabled:
                    self.assertEqual(report["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
                else:
                    self.assertNotIn("evaluation", report)


if __name__ == "__main__":
    unittest.main()
