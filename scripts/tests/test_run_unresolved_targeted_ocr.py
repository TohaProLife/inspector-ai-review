"""Fail-closed tests for bounded unresolved public OCR planning."""

from __future__ import annotations

import gzip
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "run-unresolved-targeted-ocr.py"
SPEC = importlib.util.spec_from_file_location("unresolved_targeted_ocr", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TargetedOcrPlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = self.root / "manifest.jsonl"
        self.summary = self.root / "summary.json"
        self.policy = self.root / "pattern-policy.json"
        self.index = self.root / "index"
        self.index.mkdir()
        self.page_path = self.index / "page.json.gz"
        self.page_path.write_bytes(gzip.compress(json.dumps({
            "inputSha256": "a" * 64, "pageNumber": 2,
            "widthMilliPoints": 800000, "heightMilliPoints": 600000,
        }).encode()))
        self.source = {"file_id": "F0001", "sha256": "a" * 64,
                       "object_id": "PUBLIC-OBJECT", "stage": "PD", "section": "OTHER",
                       "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                       "label_visibility": "PUBLIC_TRAIN", "extension": ".pdf"}
        self.manifest.write_text(json.dumps(self.source) + "\n")
        self.summary.write_text("{}\n")
        self.policy.write_text("{}\n")
        db = sqlite3.connect(self.index / "index.sqlite3")
        db.execute("CREATE TABLE pages (source_id TEXT, page_number INTEGER, "
                   "source_sha256 TEXT, disposition TEXT, artifact_path TEXT, artifact_sha256 TEXT)")
        db.execute("INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                   ("F0001", 2, "a" * 64, "OCR_REQUIRED", "page.json.gz",
                    MODULE.file_sha(self.page_path)))
        db.commit()
        db.close()
        self.proposal = {"batch": "ar", "sourceFileId": "F0001", "pageNumber": 2,
                         "sourceSha256": "a" * 64,
                         "pageArtifactSha256": MODULE.file_sha(self.page_path),
                         "family": "AR", "reason": "synthetic exact address", "codes": [],
                         "nearbyTextAnchors": []}
        patches = [
            mock.patch.object(MODULE, "MANIFEST", self.manifest),
            mock.patch.object(MODULE, "SUMMARY", self.summary),
            mock.patch.object(MODULE, "PATTERN_POLICY", self.policy),
            mock.patch.object(MODULE, "_reports", return_value=(
                {"inputSha256": {"manifest": "m", "audit": "a"}}, {}, {})),
            mock.patch.object(MODULE, "_proposals", return_value=[self.proposal]),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_plan_pins_exact_source_page_and_role(self) -> None:
        queue = MODULE.build_plan(self.index)
        self.assertEqual(queue["selectedUniquePages"], 1)
        page = queue["pages"][0]
        self.assertEqual((page["sourceFileId"], page["pageNumber"]), ("F0001", 2))
        self.assertEqual(page["manifestRoleGate"], "SECTION_UNRESOLVED")
        self.assertEqual(page["pageArtifactSha256"], MODULE.file_sha(self.page_path))
        self.assertEqual(page["dpi"], 120)
        self.assertIsNone(queue["findingCount"])
        self.assertFalse(queue["absenceProof"])

    def test_hidden_source_rejected(self) -> None:
        self.source["split"] = "TEST_HIDDEN"
        self.manifest.write_text(json.dumps(self.source) + "\n")
        with self.assertRaisesRegex(ValueError, "outside public allowlist"):
            MODULE.build_plan(self.index)

    def test_page_digest_drift_rejected(self) -> None:
        self.page_path.write_bytes(self.page_path.read_bytes() + b"drift")
        with self.assertRaisesRegex(ValueError, "index page SHA changed"):
            MODULE.build_plan(self.index)

    def test_non_ocr_page_rejected(self) -> None:
        db = sqlite3.connect(self.index / "index.sqlite3")
        db.execute("UPDATE pages SET disposition='TEXT_LAYER_CANDIDATE'")
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, "not OCR_REQUIRED"):
            MODULE.build_plan(self.index)

    def test_double_proposal_deduplicated(self) -> None:
        MODULE._proposals.return_value = [self.proposal, {**self.proposal, "batch": "pos"}]
        queue = MODULE.build_plan(self.index)
        self.assertEqual(queue["proposalEntries"], 2)
        self.assertEqual(queue["selectedUniquePages"], 1)
        self.assertEqual(queue["pages"][0]["sourceBatches"], ["ar", "pos"])

    def test_lexical_scan_keeps_lead_bounded_and_does_not_emit_findings(self) -> None:
        result = MODULE._lexical_80(
            [{"text": "временная дорога шириной 6 м", "bboxPx": [1, 2, 3, 4],
              "score": 0.9}], {"POS-084": ("временн.*дорог.*ширин",)})
        self.assertEqual(result["lexicalLeadCount"], 1)
        self.assertEqual(result["sampleLeads"][0]["parameterCode"], "POS-084")
        self.assertNotIn("findingCount", result)


if __name__ == "__main__":
    unittest.main()
