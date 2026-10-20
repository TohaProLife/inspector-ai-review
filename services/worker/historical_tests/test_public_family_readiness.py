from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from inspector_worker.public_family_readiness import (
    PublicFamilyReadinessError, build_public_family_readiness,
)


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
AUDIT = ROOT / "output/public-index-20260927/index-audit.json"
CLASS = ROOT / "output/public-index-20260927/class-label-probe-20260927-v2.json"
PRESENCE = ROOT / "output/public-index-20260927/presence-label-probe-v3-20260927.json"
NUMERIC = ROOT / "output/public-index-20260927/numeric-label-probe-20260927-v3.json"
NUMERIC_OLD = ROOT / "output/public-index-20260927/numeric-label-probe-v2.json"


class PublicFamilyReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        missing = [str(path) for path in (AUDIT, NUMERIC, CLASS, PRESENCE, NUMERIC_OLD)
                   if not path.is_file()]
        if missing:
            raise unittest.SkipTest("Recorded public index reports unavailable: " + ", ".join(missing))
        cls.report = build_public_family_readiness(
            MANIFEST, AUDIT, numeric_probe_path=NUMERIC, class_probe_path=CLASS,
            presence_probe_path=PRESENCE)

    def test_full_registry_and_all_three_probes_still_abstain(self) -> None:
        report = self.report
        self.assertEqual(report["summary"]["candidateCodes"], 47)
        self.assertEqual(report["summary"]["codesWithExactManifestPair"], 3)
        self.assertEqual(report["summary"]["codesWithValidatedLexicalProbe"], 47)
        self.assertEqual(report["inventory"]["ocrRequiredPages"], 1474)
        self.assertEqual(sum(item["codeCount"] for item in report["families"]), 47)
        self.assertEqual(report["summary"]["executableFactCount"], 0)
        self.assertIsNone(report["summary"]["findingCount"])
        self.assertIsNone(report["summary"]["parameterCoverage"])
        self.assertEqual(report["probeProvenance"]["numeric"]["status"], "VALIDATED")
        self.assertEqual(report["probeProvenance"]["class"]["status"], "VALIDATED")
        self.assertEqual(report["probeProvenance"]["presence"]["status"], "VALIDATED")
        by_code = {row["parameterCode"]: row for row in report["codes"]}
        self.assertEqual(by_code["PZ-022"]["evidence"]["exactLabelLines"], 1)
        self.assertEqual(by_code["PZ-022"]["disposition"], "NO_EXECUTABLE_FACT_ABSTAIN")
        self.assertEqual(by_code["PZ-002"]["evidence"]["exactLabelLines"], 2)
        self.assertEqual(by_code["PZ-002"]["evidence"]["exactLabelSourceGateCounts"],
                         {"STAGE_OUTSIDE_RULE": 2})
        self.assertEqual(by_code["PZ-002"]["sourceGates"]["expectedStage"], "PD")
        self.assertEqual(by_code["PZ-002"]["sourceGates"]["allowedActualStages"], ["RD"])
        self.assertEqual(by_code["PZ-002"]["potentialOcrMeaning"],
                         "SOURCE_SCOPE_ONLY_NOT_CODE_HITS")
        self.assertEqual(by_code["ODI-123"]["evidence"]["nearMissLines"], 11)
        self.assertEqual(by_code["ODI-123"]["evidence"]["presenceCandidateMentions"], 0)

    def test_omitted_probe_remains_unknown(self) -> None:
        report = build_public_family_readiness(
            MANIFEST, AUDIT, class_probe_path=CLASS, presence_probe_path=PRESENCE)
        self.assertEqual(report["summary"]["codesWithValidatedLexicalProbe"], 16)
        by_code = {row["parameterCode"]: row for row in report["codes"]}
        self.assertEqual(by_code["PZ-002"]["evidence"]["status"],
                         "NOT_PROBED_CURRENT_POLICY")
        self.assertIsNone(by_code["PZ-002"]["evidence"]["exactLabelLines"])

    def test_old_numeric_report_fails_on_label_policy_drift(self) -> None:
        with self.assertRaisesRegex(PublicFamilyReadinessError, "numeric probe schema, hash"):
            build_public_family_readiness(
                MANIFEST, AUDIT, numeric_probe_path=NUMERIC_OLD)

    def test_tampered_audit_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.json"
            audit = json.loads(AUDIT.read_text(encoding="utf-8"))
            audit["sources"][0]["dispositions"]["TEXT_LAYER_CANDIDATE"] -= 1
            path.write_text(json.dumps(audit), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyReadinessError, "source metadata or pages"):
                build_public_family_readiness(MANIFEST, path)

    def test_tampered_class_counts_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "class.json"
            report = json.loads(CLASS.read_text(encoding="utf-8"))
            report["codes"]["PZ-022"]["exactLineMatches"] += 1
            path.write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyReadinessError,
                                        "probe code/source counts differ"):
                build_public_family_readiness(MANIFEST, AUDIT, class_probe_path=path)

    def test_truncated_presence_queue_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "presence.json"
            report = json.loads(PRESENCE.read_text(encoding="utf-8"))
            report["ocrQueue"].pop()
            path.write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaisesRegex(PublicFamilyReadinessError, "OCR queue missing"):
                build_public_family_readiness(MANIFEST, AUDIT, presence_probe_path=path)

    def test_determinism_and_cli_no_overwrite(self) -> None:
        second = build_public_family_readiness(
            MANIFEST, AUDIT, numeric_probe_path=NUMERIC, class_probe_path=CLASS,
            presence_probe_path=PRESENCE)
        self.assertEqual(second, self.report)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "readiness.json"
            cmd = [sys.executable, str(ROOT / "scripts/build-public-family-readiness.py"),
                   "--manifest", str(MANIFEST), "--audit", str(AUDIT),
                   "--numeric-probe", str(NUMERIC),
                   "--class-probe", str(CLASS), "--presence-probe", str(PRESENCE),
                   "--output", str(output)]
            process = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.report)
            process = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("output path must be new", process.stderr)


if __name__ == "__main__":
    unittest.main()
