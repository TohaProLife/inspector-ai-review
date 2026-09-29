"""Tests for the pinned seven-batch summary of 80 unresolved codes."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from recorded_artifact_support import require_recorded_artifacts


SCRIPT = Path(__file__).resolve().parents[1] / "aggregate-unresolved-public.py"
SPEC = importlib.util.spec_from_file_location("aggregate_unresolved_public", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class AggregateUnresolvedPublicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        require_recorded_artifacts(
            module.STRATEGY_REPORT, module.AUDIT,
            *(module.ROOT / path for path, _ in module.INPUTS.values()),
        )
        cls.summary = module.build_summary()

    def test_exact_80_unique_codes_and_only_known_three_overlaps(self) -> None:
        result = self.summary
        self.assertEqual(result["summary"]["unresolvedCodeCount"], 80)
        self.assertEqual(result["summary"]["batchCodeOccurrences"], 83)
        self.assertEqual(result["summary"]["overlapCodes"], ["PPM-111", "PPM-112", "PPM-113"])
        self.assertEqual(len(result["parameters"]), 80)
        self.assertEqual(len({x["parameterCode"] for x in result["parameters"]}), 80)
        for row in result["parameters"]:
            self.assertFalse(row["verifiedComparablePair"])
            self.assertFalse(row["findingOrCoveragePromoted"])
            self.assertTrue(all(item["status"] == "ABSTAIN" for item in row["batchObservations"].values()))
        self.assertFalse(result["summary"]["fullPdfContentVerified"])

    def test_caps_and_ocr_unknown_remain_explicit_per_batch(self) -> None:
        details = {name: row["scanEvidence"] for name, row in self.summary["batchReports"].items()}
        self.assertEqual(details["kr"]["selectedSourcePagesIndexedAndShaChecked"], 521)
        self.assertEqual(details["kr"]["ocrRequiredUnknownPages"], 44)
        self.assertEqual(details["pos"]["selectedSourcePagesIndexedAndShaChecked"], 245)
        self.assertEqual(details["pos"]["ocrRequiredUnknownPages"], 19)
        self.assertEqual(details["engineering"]["thematicTextPageAddressesWithCodeDuplicates"], 569)
        self.assertEqual(details["engineering"]["shaCheckedSelectedThematicPageAddressesWithCodeDuplicates"], 256)
        self.assertEqual(details["engineering"]["thematicPageAddressesOmittedByCap"], 313)
        self.assertEqual(details["pz_spzu"]["lexicalPageAddressesWithCodeDuplicates"], 1198)
        self.assertEqual(details["pz_spzu"]["lexicalPageAddressesOmittedByCap"], 945)
        self.assertEqual(details["pod_oos"]["thematicPageAddressesOmittedByCap"], 760)
        self.assertEqual(details["utility"]["ocrRequiredUnknownPages"], 1474)
        self.assertTrue(all(not detail["fullPdfContentVerified"] for detail in details.values()))

    def test_every_input_report_is_pinned_by_real_file_sha(self) -> None:
        for name, (relative_path, expected_sha) in module.INPUTS.items():
            path = module.ROOT / relative_path
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected_sha, name)
            self.assertEqual(self.summary["batchReports"][name]["fileSha256"], expected_sha)

    def test_tampered_report_sha_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            altered = Path(temporary) / "kr.json"
            original = module.ROOT / module.INPUTS["kr"][0]
            altered.write_bytes(original.read_bytes() + b" ")
            inputs = dict(module.INPUTS)
            inputs["kr"] = (str(altered), module.INPUTS["kr"][1])
            with self.assertRaisesRegex(ValueError, "kr report SHA-256 drift"):
                module.build_summary(inputs=inputs)

    def test_forged_comparable_pair_is_rejected_even_with_matching_file_sha(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            altered = Path(temporary) / "engineering.json"
            report = json.loads((module.ROOT / module.INPUTS["engineering"][0]).read_text())
            report["codes"][0]["comparison"]["comparablePairCount"] = 1
            altered.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
            inputs = dict(module.INPUTS)
            inputs["engineering"] = (str(altered), hashlib.sha256(altered.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "claims a comparable pair"):
                module.build_summary(inputs=inputs)

    def test_catalog_trigger_drift_is_rejected_even_with_matching_file_sha(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            altered = Path(temporary) / "ar.json"
            report = json.loads((module.ROOT / module.INPUTS["ar"][0]).read_text())
            report["codes"][0]["catalogTrigger"] = "changed trigger"
            altered.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
            inputs = dict(module.INPUTS)
            inputs["ar"] = (str(altered), hashlib.sha256(altered.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "catalog trigger drift"):
                module.build_summary(inputs=inputs)

    def test_missing_code_is_rejected_even_with_matching_file_sha(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            altered = Path(temporary) / "utility.json"
            report = json.loads((module.ROOT / module.INPUTS["utility"][0]).read_text())
            report["codes"].pop()
            altered.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
            inputs = dict(module.INPUTS)
            inputs["utility"] = (str(altered), hashlib.sha256(altered.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "utility code count drift"):
                module.build_summary(inputs=inputs)


if __name__ == "__main__":
    unittest.main()
