from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from inspector_worker.candidate_source_matrix import (
    PUBLIC_MANIFEST_SHA256,
    _role_plan,
    build_candidate_source_matrix,
)


ROOT = Path(__file__).resolve().parents[3]
MANIFEST = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
            / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")


class CandidateSourceMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.matrix = build_candidate_source_matrix(MANIFEST)
        cls.by_code = {row["parameterCode"]: row for row in cls.matrix["codes"]}

    def test_pinned_inventory_and_all_candidates(self) -> None:
        report = self.matrix
        self.assertEqual(report["manifestSha256"], PUBLIC_MANIFEST_SHA256)
        self.assertEqual(report["inventory"]["publicSources"], 203)
        self.assertEqual(report["inventory"]["publicPdfSources"], 202)
        self.assertEqual(report["inventory"]["publicPdfPages"], 10142)
        self.assertEqual(report["inventory"]["metadataOnlySourceId"], "F0194")
        self.assertEqual(len(report["codes"]), 47)
        self.assertEqual(len(self.by_code), 47)
        self.assertEqual(sum(x["codeCount"] for x in report["families"]), 47)
        self.assertEqual(report["disposition"], "SOURCE_PLANNING_ONLY_ABSTAIN")
        for code in report["codes"]:
            self.assertEqual(code["disposition"], "SOURCE_PLANNING_ONLY_ABSTAIN")
            for obj in code["objects"]:
                for role in ("expected", "actual"):
                    plan = obj[role]
                    for stem in ("exact", "unresolvedSection", "mixedStage",
                                 "mixedStageUnclassified"):
                        self.assertEqual(plan[stem + "SourceCount"],
                                         len(plan[stem + "SourceIds"]))
                        self.assertNotIn("F0194", plan[stem + "SourceIds"])

    def test_kr_sources_are_same_object_and_stage_exact(self) -> None:
        code = self.by_code["KR-061"]
        novos = next(x for x in code["objects"]
                     if x["objectId"] == "OBJ-NOVOSLOBODSKAYA")
        self.assertEqual(novos["expected"]["exactSourceIds"],
                         ["F0105", "F0106", "F0107"])
        self.assertEqual(novos["actual"]["exactSourceIds"],
                         ["F0136", "F0139", "F0140", "F0141", "F0142", "F0143", "F0144"])
        self.assertTrue(novos["sameObjectExactSourcePairAvailable"])
        tyumen = next(x for x in code["objects"]
                      if x["objectId"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED")
        self.assertEqual(tyumen["expected"]["exactSourceIds"], ["F0158", "F0159"])
        self.assertEqual(tyumen["actual"]["exactSourceIds"], [])
        self.assertFalse(tyumen["sameObjectExactSourcePairAvailable"])
        self.assertIn("ACTUAL_MIXED_STAGE_SOURCES", tyumen["ambiguityFlags"])

    def test_unknown_section_and_mixed_stage_never_count_as_exact(self) -> None:
        pz = self.by_code["PZ-017"]
        for obj in pz["objects"]:
            self.assertEqual(obj["expected"]["exactSourceCount"], 0)
            self.assertIn("EXPECTED_MANIFEST_SECTION_UNRESOLVED", obj["ambiguityFlags"])
        tyumen = next(x for x in pz["objects"]
                      if x["objectId"] == "OBJ-TYUMENSKAYA-5-GOLD-SEED")
        self.assertEqual(tyumen["actual"]["exactSourceCount"], 0)
        self.assertEqual(tyumen["actual"]["mixedStageSourceIds"],
                         ["F0195", "F0196", "F0198", "F0201", "F0202"])
        ar = self.by_code["AR-040"]
        self.assertTrue(all(obj["actual"]["exactSourceCount"] == 0
                            for obj in ar["objects"]))

    def test_manifest_sha_and_unknown_category_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.jsonl"
            original = MANIFEST.read_bytes()
            path.write_bytes(original + b"\n")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                build_candidate_source_matrix(path)

            lines = original.decode("utf-8").splitlines()
            rows = [json.loads(line) for line in lines]
            index = next(i for i, row in enumerate(rows)
                         if row["file_id"] == "F0105")
            rows[index]["section"] = "MYSTERY"
            mutated = ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
                       + "\n").encode("utf-8")
            path.write_bytes(mutated)
            with self.assertRaisesRegex(ValueError, "object/stage/section"):
                build_candidate_source_matrix(
                    path, expected_manifest_sha256=hashlib.sha256(mutated).hexdigest())

    def test_rule_unknown_section_and_status_fail_closed(self) -> None:
        rule = {
            "manifestSectionStatus": {"expected": "EXACT_CATEGORY", "actual": "EXACT_CATEGORY"},
            "requiredExpectedSections": ["OTHER"], "requiredActualSections": ["KR"],
            "requiredExpectedDrawingSections": ["KJ"],
            "requiredActualDrawingSections": ["KJ"],
        }
        with self.assertRaisesRegex(ValueError, "unknown manifest section"):
            _role_plan([], rule, expected=True)
        changed = copy.deepcopy(rule)
        changed["requiredExpectedSections"] = []
        with self.assertRaisesRegex(ValueError, "status/sections disagree"):
            _role_plan([], changed, expected=True)

    def test_deterministic_report_and_cli(self) -> None:
        first = json.dumps(self.matrix, ensure_ascii=False, sort_keys=True)
        second = json.dumps(build_candidate_source_matrix(MANIFEST),
                            ensure_ascii=False, sort_keys=True)
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "matrix.json"
            completed = subprocess.run(
                [sys.executable, str(ROOT / "scripts/build-candidate-source-matrix.py"),
                 "--manifest", str(MANIFEST), "--output", str(output)],
                cwd=ROOT, capture_output=True, text=True, check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.matrix)
