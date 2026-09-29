from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.parameter_family_registry import (
    CATALOG_PATH,
    REGISTRY_PATH,
    load_parameter_family_registry,
    registry_summary,
)


class ParameterFamilyRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

    def _load_mutation(self, registry: dict) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "registry.json"
            path.write_text(json.dumps(registry), encoding="utf-8")
            load_parameter_family_registry(registry_path=path)

    def test_exact_132_code_catalog_coverage_and_design_only_status(self) -> None:
        loaded = load_parameter_family_registry()
        catalog_codes = [json.loads(line)["parameter_code"] for line in
                         CATALOG_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
        entries = loaded["entries"]
        self.assertEqual([row["parameterCode"] for row in entries], catalog_codes)
        self.assertEqual(len(entries), 132)
        self.assertEqual(loaded["executionPolicy"], "DESIGN_ONLY")
        self.assertEqual(registry_summary(loaded)["classification"], {
            "GENERIC_CANDIDATE": 47, "PILOT_REVIEW_ONLY": 5, "UNRESOLVED": 80,
        })
        pilot_codes = {row["parameterCode"] for row in entries
                       if row["classification"] == "PILOT_REVIEW_ONLY"}
        self.assertEqual(pilot_codes, {"PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"})
        self.assertFalse(any("threshold" in row or "executable" in row or
                             "implementationStatus" in row for row in entries))

    def test_missing_duplicate_and_unknown_codes_fail(self) -> None:
        mutations = []
        missing = copy.deepcopy(self.registry)
        missing["entries"].pop()
        mutations.append(missing)
        duplicate = copy.deepcopy(self.registry)
        duplicate["entries"][1]["parameterCode"] = duplicate["entries"][0]["parameterCode"]
        mutations.append(duplicate)
        unknown = copy.deepcopy(self.registry)
        unknown["entries"][1]["parameterCode"] = "NOT-IN-CATALOG"
        mutations.append(unknown)
        for registry in mutations:
            with self.subTest(kind=registry["entries"][1]["parameterCode"]):
                with self.assertRaises(ValueError):
                    self._load_mutation(registry)

    def test_catalog_and_registry_sha_drift_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            changed_catalog = Path(temp) / "catalog.jsonl"
            changed_catalog.write_bytes(CATALOG_PATH.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "catalog SHA-256 drift"):
                load_parameter_family_registry(catalog_path=changed_catalog)
        changed_registry = copy.deepcopy(self.registry)
        changed_registry["catalogSha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self._load_mutation(changed_registry)

    def test_execution_or_pilot_overclaim_fails(self) -> None:
        candidate = next(row for row in self.registry["entries"]
                         if row["classification"] == "GENERIC_CANDIDATE")
        position = self.registry["entries"].index(candidate)
        overclaims = []
        executable = copy.deepcopy(self.registry)
        executable["executionPolicy"] = "EXECUTABLE"
        overclaims.append(executable)
        extra_field = copy.deepcopy(self.registry)
        extra_field["entries"][position]["executable"] = True
        overclaims.append(extra_field)
        fake_pilot = copy.deepcopy(self.registry)
        fake_pilot["entries"][position]["classification"] = "PILOT_REVIEW_ONLY"
        overclaims.append(fake_pilot)
        wrong_family = copy.deepcopy(self.registry)
        wrong_family["entries"][position]["family"] = "UNKNOWN_FAMILY"
        overclaims.append(wrong_family)
        false_resolution = copy.deepcopy(self.registry)
        unresolved = next(row for row in false_resolution["entries"]
                          if row["classification"] == "UNRESOLVED")
        unresolved["family"] = "DECREASE"
        overclaims.append(false_resolution)
        for registry in overclaims:
            with self.assertRaises(ValueError):
                self._load_mutation(registry)


if __name__ == "__main__":
    unittest.main()
