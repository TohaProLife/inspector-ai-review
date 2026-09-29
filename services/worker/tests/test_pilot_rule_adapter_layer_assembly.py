"""Distinct immutable release gate for layer navigation proposals."""

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

from inspector_worker.pilot_rule_adapter import (
    LAYER_ASSEMBLY_REVIEW_PROFILE, PilotPz002RuleAdapter,
)
from services.worker.tests.test_pilot_rule_adapter_site_tep_area import (
    MANIFEST, lease_for as tep_lease_for,
)
from services.worker.tests.test_layer_assembly_proposals import (
    OBJECT as LAYER_OBJECT, artifact, page, roof_blocks, source,
)
from inspector_worker.layer_assembly_proposals import evaluate_layer_assembly_proposals


RULE = {"ruleId": "pilot-layer-assembly-review-v1", "version": "1",
        "extractionProfile": "layer-assembly-review-v1", "codeCount": 3,
        "disposition": "REVIEW_AID_ONLY"}
CODES = ("SPZU-032", "AR-044", "ZU-125")


def lease_for(profile: str = LAYER_ASSEMBLY_REVIEW_PROFILE) -> dict:
    definitions = copy.deepcopy(tep_lease_for()["release"]["rules"]["definitions"])
    definitions.pop("siteTepAreaReview")
    definitions["layerAssemblyReview"] = copy.deepcopy(RULE)
    lease = tep_lease_for(profile=profile, definitions=definitions)
    lease["release"]["providerSlot"]["adapterVersion"] = "20"
    return lease


def output(manifest: str = MANIFEST) -> dict:
    return {"schemaVersion": "layer-assembly-proposals-v1",
            "profileId": "layer-assembly-review-v1", "purpose": "REVIEW_ONLY",
            "inputManifestHash": manifest,
            "codeRows": [{"parameterCode": code, "status": "ABSTAIN",
                          "absenceConclusion": "NOT_AVAILABLE", "proposals": [],
                          "reasonCodes": ["EXISTING_SITE_GP_TABLE_ROW_REVIEW"] if index == 0 else []}
                         for index, code in enumerate(CODES)],
            "findingCount": None, "parameterCoverage": None}


class LayerAssemblyAdapterTests(unittest.TestCase):
    def execute(self, lease: dict, review: dict | None = None) -> tuple[dict, object]:
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                   return_value={"selectedManifestHash": MANIFEST}), \
             patch("inspector_worker.pilot_rule_adapter.execute_durable_layer_assembly_proposals",
                   return_value=output() if review is None else review) as layer, \
             patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                   side_effect=AssertionError("layer profile must not depend on OCR")):
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        return result, layer

    def test_opt_in_third_output_immutable_release_hash(self) -> None:
        lease = lease_for()
        result, layer = self.execute(lease)
        self.assertEqual(result["providerProfileId"], LAYER_ASSEMBLY_REVIEW_PROFILE)
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["providerConfigHash"],
                         lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["layerAssemblyReview"], output())
        layer.assert_called_once_with(lease, {"attemptId": "ATT-1"})

    def test_invalid_definition_adapter_and_old_release_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot run under an older release"):
            self.execute(lease_for(profile="typed-pz002-pz017-v1"))
        bad = lease_for()
        bad["release"]["rules"]["definitions"]["layerAssemblyReview"]["codeCount"] = 2
        with self.assertRaisesRegex(ValueError, "release rule definition"):
            self.execute(bad)
        bad = lease_for()
        bad["release"]["providerSlot"]["adapterVersion"] = "19"
        with self.assertRaisesRegex(ValueError, "adapter version"):
            self.execute(bad)
        bad = lease_for()
        bad["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            self.execute(bad)
        definitions = copy.deepcopy(lease_for()["release"]["rules"]["definitions"])
        definitions.pop("layerAssemblyReview")
        old = tep_lease_for(profile="typed-pz002-pz017-v1", definitions=definitions)
        result, layer = self.execute(old)
        self.assertEqual(result["outputCount"], 2)
        self.assertNotIn("layerAssemblyReview", result)
        layer.assert_not_called()

    def test_positive_claims_or_duplicate_road_proposals_rejected(self) -> None:
        valid = output()
        proposal = {"rowAssociationStatus": "UNVERIFIED",
                    "typeAssociationStatus": "UNVERIFIED",
                    "zoneAssociationStatus": "UNVERIFIED",
                    "rawThickness": None, "rawQuantity": None}
        valid["codeRows"][1]["proposals"] = [proposal]
        self.assertEqual(self.execute(lease_for(), valid)[0]["layerAssemblyReview"], valid)
        for change in ({"inputManifestHash": "a" * 64}, {"findingCount": 0},
                       {"purpose": "FACT"}, {"codeRows": []}):
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), {**valid, **change})
        for change in ({"rowAssociationStatus": "VERIFIED"},
                       {"typeAssociationStatus": "VERIFIED"},
                       {"zoneAssociationStatus": "VERIFIED"},
                       {"rawThickness": "70 мм"}, {"rawQuantity": 1},
                       {"rawValue": "70 мм"}, {"value": 70}):
            with self.subTest(change=change):
                wrong = copy.deepcopy(valid)
                wrong["codeRows"][1]["proposals"] = [{**proposal, **change}]
                with self.assertRaisesRegex(ValueError, "review-only output"):
                    self.execute(lease_for(), wrong)
        wrong = copy.deepcopy(valid)
        wrong["codeRows"][0]["proposals"] = [proposal]
        with self.assertRaisesRegex(ValueError, "review-only output"):
            self.execute(lease_for(), wrong)

    def test_installed_layout_import_and_evaluation(self) -> None:
        src = source("F-INSTALLED", "AR")
        text = artifact(src, [page(1, roof_blocks())])
        expected = evaluate_layer_assembly_proposals(LAYER_OBJECT, MANIFEST, [src], [text])
        worker_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "site-packages" / "inspector_worker"
            shutil.copytree(worker_root / "inspector_worker", package,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            fixture = root / "fixture.json"
            fixture.write_text(json.dumps({"objectId": LAYER_OBJECT,
                                           "inputManifestHash": MANIFEST,
                                           "sources": [src], "textArtifacts": [text],
                                           "result": expected}, ensure_ascii=False),
                               encoding="utf-8")
            program = (
                "import json,sys; "
                "from inspector_worker.layer_assembly_proposals import "
                "evaluate_layer_assembly_proposals; "
                "from inspector_worker.pilot_rule_adapter import LAYER_ASSEMBLY_REVIEW_PROFILE; "
                "f=json.load(open(sys.argv[1])); "
                "r=evaluate_layer_assembly_proposals(f['objectId'],f['inputManifestHash'],"
                "f['sources'],f['textArtifacts']); "
                "assert r==f['result']; print(LAYER_ASSEMBLY_REVIEW_PROFILE)")
            done = subprocess.run(
                [str(Path(sys.executable).resolve()), "-c", program, str(fixture)],
                cwd=root, env={**os.environ, "PYTHONPATH": str(package.parent)},
                capture_output=True, text=True, check=True)
            self.assertEqual(done.stdout.strip(), LAYER_ASSEMBLY_REVIEW_PROFILE)


if __name__ == "__main__":
    unittest.main()
