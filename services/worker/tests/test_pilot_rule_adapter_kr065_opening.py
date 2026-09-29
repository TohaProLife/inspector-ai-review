"""KR-065 opening navigation has a separate immutable one-code release."""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from inspector_worker.kr065_opening_proposals import evaluate_kr065_opening_proposals
from inspector_worker.pilot_rule_adapter import (
    KR065_OPENING_REVIEW_PROFILE, PilotPz002RuleAdapter,
)
from services.worker.tests.test_kr065_opening_proposals import (
    OBJECT as KR_OBJECT, artifact, box, page, source,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)


RULE = {"ruleId": "pilot-kr065-opening-review-v1", "version": "1",
        "extractionProfile": "kr065-opening-review-v1", "codeCount": 1,
        "disposition": "REVIEW_AID_ONLY"}


def lease_for(profile: str = KR065_OPENING_REVIEW_PROFILE) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["kr065OpeningReview"] = copy.deepcopy(RULE)
    lease = tep_lease_for(profile=profile, definitions=definitions)
    lease["release"]["providerSlot"]["adapterVersion"] = "21"
    return lease


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "kr065-opening-proposals-v1",
            "profileId": "kr065-opening-review-v1", "purpose": "REVIEW_ONLY",
            "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": "KR-065", "status": "ABSTAIN",
                          "absenceConclusion": "NOT_AVAILABLE", "proposals": []}],
            "findingCount": None, "parameterCoverage": None}


class Kr065OpeningAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_kr065_opening_proposals",
                   return_value=output() if review is None else review) as opening, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("KR-065 text profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, opening

    def test_opt_in_third_output_immutable_definition(self) -> None:
        lease = lease_for()
        result, opening = self.execute(lease)
        self.assertEqual(result["providerProfileId"], KR065_OPENING_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["kr065OpeningReview"], output())
        self.assertNotIn("layerAssemblyReview", result)
        opening.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_definition_adapter_hash_and_legacy_gate(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["kr065OpeningReview"]["codeCount"] = 3
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        bad = lease_for()
        bad["release"]["providerSlot"]["adapterVersion"] = "20"
        with self.assertRaisesRegex(ValueError, "adapter version"):
            self.execute(bad)
        bad = lease_for()
        bad["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad)
        definitions = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        definitions.pop("kr065OpeningReview")
        old = tep_lease_for(profile="typed-pz002-pz017-v1", definitions=definitions)
        result, opening = self.execute(old)
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("kr065OpeningReview", result)
        opening.assert_not_called()

    def test_contour_reinforcement_and_finding_claims_fail_closed(self) -> None:
        valid = output()
        proposal = {"drawingContourAssociation": "UNVERIFIED",
                    "detailAssociation": "UNVERIFIED",
                    "sameElementAssociation": "UNVERIFIED",
                    "reinforcementStatus": "NOT_ESTABLISHED",
                    "unauthorizedFillStatus": "NOT_ESTABLISHED",
                    "rawAxes": None, "rawLevel": None}
        valid["codeRows"][0]["proposals"] = [proposal]
        self.assertEqual(self.execute(lease_for(), valid)[0]["kr065OpeningReview"], valid)
        for change in ({"inputManifestHash": "a" * 64}, {"findingCount": 0},
                       {"purpose": "FACT"}, {"codeRows": []}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**valid, **change})
        for change in ({"drawingContourAssociation": "VERIFIED"},
                       {"detailAssociation": "VERIFIED"},
                       {"sameElementAssociation": "VERIFIED"},
                       {"reinforcementStatus": "CONFIRMED"},
                       {"unauthorizedFillStatus": "UNAUTHORIZED"},
                       {"rawAxes": "1-2"}, {"rawLevel": "+3.600"},
                       {"value": 750}, {"finding": {}}):
            with self.subTest(change=change):
                wrong = copy.deepcopy(valid)
                wrong["codeRows"][0]["proposals"] = [{**proposal, **change}]
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), wrong)
        wrong = copy.deepcopy(valid)
        wrong["codeRows"][0]["parameterCode"] = "KR-063"
        with self.assertRaisesRegex(ValueError, "review-only output"):
            self.execute(lease_for(), wrong)

    def test_installed_layout_evaluator_and_profile(self) -> None:
        src = source("F-INSTALLED")
        text = artifact(src, [page(1, [box('(обрамление отверстия "№7" 750х750мм - 1шт.)')])])
        expected = evaluate_kr065_opening_proposals(KR_OBJECT, MANIFEST, [src], [text])
        worker_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "site-packages" / "inspector_worker"
            shutil.copytree(worker_root / "inspector_worker", package,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            fixture = root / "fixture.json"
            fixture.write_text(json.dumps({"objectId": KR_OBJECT,
                                           "inputManifestHash": MANIFEST,
                                           "sources": [src], "textArtifacts": [text],
                                           "result": expected}, ensure_ascii=False),
                               encoding="utf-8")
            program = (
                "import json,sys; "
                "from inspector_worker.kr065_opening_proposals import "
                "evaluate_kr065_opening_proposals; "
                "from inspector_worker.pilot_rule_adapter import KR065_OPENING_REVIEW_PROFILE; "
                "f=json.load(open(sys.argv[1])); "
                "r=evaluate_kr065_opening_proposals(f['objectId'],f['inputManifestHash'],"
                "f['sources'],f['textArtifacts']); "
                "assert r==f['result']; print(KR065_OPENING_REVIEW_PROFILE)")
            done = subprocess.run(
                [str(Path(sys.executable).resolve()), "-c", program, str(fixture)],
                cwd=root, env={**os.environ, "PYTHONPATH": str(package.parent)},
                capture_output=True, text=True, check=True)
            self.assertEqual(done.stdout.strip(), KR065_OPENING_REVIEW_PROFILE)


if __name__ == "__main__":
    unittest.main()
