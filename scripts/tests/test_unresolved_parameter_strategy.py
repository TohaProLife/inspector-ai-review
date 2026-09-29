"""Tests for the design-only inventory of unresolved public catalog parameters."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "unresolved-parameter-strategy.py"
SPEC = importlib.util.spec_from_file_location("unresolved_parameter_strategy", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class UnresolvedParameterStrategyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.report = module.build_report()

    def test_all_80_codes_in_exact_catalog_order_with_exact_catalog_text(self) -> None:
        catalog = module._jsonl(module.CATALOG)
        registry = module.load_parameter_family_registry()
        expected = [row["parameterCode"] for row in registry["entries"]
                    if row["classification"] == "UNRESOLVED"]
        entries = self.report["parameters"]
        self.assertEqual(len(entries), 80)
        self.assertEqual([row["parameterCode"] for row in entries], expected)
        by_code = {row["parameter_code"]: row for row in catalog}
        for row in entries:
            source = by_code[row["parameterCode"]]
            self.assertEqual(row["catalogTrigger"], source["trigger"])
            self.assertEqual(row["catalogSection"], source["pd_section"])
            self.assertEqual(row["catalogSourceRequirements"],
                             {stage: source[f"source_{stage.lower()}"] for stage in module.STAGES})
            self.assertTrue(row["requiredEvidenceKinds"])
            self.assertTrue(row["whyGenericComparisonInsufficient"])
            self.assertTrue(row["nextProofGate"])
            self.assertEqual(row["executionStatus"], "DESIGN_ONLY")
            self.assertFalse(row["findingOrCoveragePromoted"])
            self.assertFalse(row["sourceAvailability"]["verifiedComparablePair"])

    def test_manifest_scope_and_metadata_does_not_promote_mixed_stage(self) -> None:
        report = self.report
        self.assertEqual(report["summary"]["eligiblePublicDocuments"], 203)
        self.assertEqual(report["summary"]["verifiedComparablePairs"], 0)
        self.assertEqual(report["summary"]["findingsOrCoveragePromoted"], 0)
        kr = next(row for row in report["parameters"] if row["parameterCode"] == "KR-054")
        self.assertEqual(kr["sourceAvailability"]["byStage"]["PD"]["byObject"]
                         ["OBJ-NOVOSLOBODSKAYA"]["exactSectionTagCandidates"], 3)
        self.assertEqual(kr["sourceAvailability"]["byStage"]["RD"]["byObject"]
                         ["OBJ-NOVOSLOBODSKAYA"]["byManifestSection"]["KR"], 7)
        ios = next(row for row in report["parameters"] if row["parameterCode"] == "IOS4-078")
        self.assertEqual(ios["sourceAvailability"]["mixedStageByObject"]
                         ["OBJ-TYUMENSKAYA-5-GOLD-SEED"]["byManifestSection"]["OV"], 5)
        self.assertEqual(ios["sourceAvailability"]["byStage"]["RD"]["byObject"]
                         ["OBJ-TYUMENSKAYA-5-GOLD-SEED"]["allSections"], 0)
        self.assertEqual(ios["sourceAvailability"]["unknownStageByObject"]
                         ["OBJ-TYUMENSKAYA-5-GOLD-SEED"]["documentCount"], 1)

    def test_hidden_manifest_row_never_becomes_source_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "manifest.jsonl"
            path.write_bytes(module.MANIFEST.read_bytes())
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"file_id": "HIDDEN-INJECTED", "split": "TEST_HIDDEN",
                                         "distribution_status": "INCLUDE", "label_visibility": "HIDDEN",
                                         "object_id": "OBJ-SECRET", "stage": "RD", "section": "AR",
                                         "sha256": "deadbeef"}) + "\n")
            altered = module.build_report(manifest_path=path, expected_manifest_hash=None)
        self.assertEqual(altered["summary"]["eligiblePublicDocuments"], 203)
        self.assertEqual(altered["parameters"], self.report["parameters"])

    def test_design_duplicate_or_execution_drift_is_rejected(self) -> None:
        design = json.loads(module.STRATEGY.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "design.json"
            design["entries"][1]["parameterCode"] = design["entries"][0]["parameterCode"]
            path.write_text(json.dumps(design, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exactly once"):
                module.build_report(strategy_path=path)
            design["entries"][1]["parameterCode"] = "PZ-003"
            design["executionPolicy"] = "EXECUTE"
            path.write_text(json.dumps(design, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "execution policy"):
                module.build_report(strategy_path=path)

    def test_catalog_and_manifest_sha_are_pinned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "manifest.jsonl"
            path.write_bytes(module.MANIFEST.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "manifest SHA-256 drift"):
                module.build_report(manifest_path=path)


if __name__ == "__main__":
    unittest.main()
