from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.main import DEFAULT_STAGE_PROVIDER_REGISTRY
from inspector_worker.durable_ocr_layout import PROFILE_HASH_V5, PROFILE_ID_V5
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
from inspector_worker.fact_family_pack import load_fact_family_pack
from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.presence_family_candidates import load_presence_family_labels


RULES = Path(__file__).resolve().parents[1] / "rules"
DEFINITIONS = {
    "navigation": json.loads((RULES / "pilot-pz-002-navigation-v1.json").read_text(encoding="utf-8")),
    "numeric": json.loads((RULES / "pilot-pz-002-numeric-v1.json").read_text(encoding="utf-8")),
}
CONFIG_HASH = "db205bd05e41ea5df2d10c1f90a5206b588403384ff14052b81cb2f436a94a16"


class PilotRuleAdapterTests(unittest.TestCase):
    def test_candidate_ocr_observations_are_release_gated_and_reuse_ocr_stage(self) -> None:
        fact = load_fact_family_pack()
        candidate = load_candidate_family_pack()
        numeric = load_numeric_family_labels()
        classes = load_class_family_labels()
        presence = load_presence_family_labels()
        policy = {"version": "1", "candidateRulePackSha256": candidate["packSha256"],
                  "numericLabelPackSha256": numeric["labelPackSha256"],
                  "classLabelPackSha256": classes["labelPackSha256"],
                  "presenceLabelPackSha256": presence["labelPackSha256"],
                  "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}
        definitions = {**DEFINITIONS,
            "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                     "parameterCode": "PZ-017", "extractionProfile": "pz-017-heat-components-v1"},
            "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                            "parameterCode": "PZ-017",
                            "extractionProfile": "conservative-ocr-heat-rows-v1",
                            "disposition": "REVIEW_AID_ONLY"},
            "factFamily": {"ruleId": "pilot-fact-family-review", "version": "1",
                           "extractionProfile": "fact-family-pilot-v1",
                           "packSha256": fact["packSha256"],
                           "disposition": "REVIEW_AID_ONLY", "rules": fact["rules"]},
            "candidateFamilyPreview": {**policy,
                "ruleId": "pilot-candidate-family-preview",
                "extractionProfile": "candidate-family-preview-v1"},
            "candidateFamilyObservations": {**policy,
                "ruleId": "pilot-candidate-family-observations",
                "extractionProfile": "candidate-family-observations-v1"},
            "candidateFamilyOcrObservations": {**policy,
                "ruleId": "pilot-candidate-family-ocr-observations",
                "extractionProfile": "candidate-family-ocr-observations-v1"}}
        manifest = "f" * 64
        config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        profile = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
        lease = {"inputManifestHash": manifest,
                 "inputs": {"sourceDecisions": {}, "sourceFiles": []},
                 "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                 "definitions": definitions}, "providerSlot": {"stageJobType": "RULE_EVALUATION",
                 "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                 "profileId": profile, "configHash": config_hash}}}
        stage = {"schemaVersion": "analysis-stage-result-v2"}
        review_aids = {key: {"inputManifestHash": manifest}
                       for key in ("candidateFamilyPreview", "candidateFamilyObservations",
                                   "candidateFamilyOcrObservations", "reviewCandidates")}
        review_aids["candidateFamilyOcrObservations"].update(
            {"findingCount": None, "parameterCoverage": None,
             "codeRows": [{"status": "ABSTAIN"}]})
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": manifest}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                      return_value={"selectedManifestHash": manifest}), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value={"content_json": stage}) as download, \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      return_value={"inputManifestHash": manifest}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                      return_value={"inputManifestHash": manifest}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_candidate_family_observations",
                      side_effect=AssertionError("legacy wrapper must not run")), \
                patch("inspector_worker.pilot_rule_adapter."
                      "execute_durable_candidate_family_ocr_observations",
                      return_value=review_aids) as execute:
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
            stage["providerProfileId"] = PROFILE_ID_V5
            with self.assertRaisesRegex(ValueError, "outside immutable release selection"):
                PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-2"})
            lease["release"]["ocrLayoutSlot"] = {
                "profileId": PROFILE_ID_V5, "configHash": "0" * 64}
            with self.assertRaisesRegex(ValueError, "outside immutable release selection"):
                PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-3"})
            lease["release"]["ocrLayoutSlot"]["configHash"] = PROFILE_HASH_V5
            result_v5 = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-4"})
            self.assertEqual(result_v5["outputCount"], 7)
        self.assertEqual(result["outputCount"], 7)
        self.assertEqual(result["providerProfileId"], profile)
        self.assertIs(result["candidateFamilyOcrObservations"],
                      review_aids["candidateFamilyOcrObservations"])
        self.assertEqual(download.call_count, 4)
        self.assertEqual(execute.call_count, 2)

        definitions["candidateFamilyOcrObservations"]["codeCount"] = 46
        with self.assertRaisesRegex(ValueError, "candidate OCR observations release definition"):
            PilotPz002RuleAdapter().execute(lease, {})
        definitions["candidateFamilyOcrObservations"]["codeCount"] = 47
        lease["release"]["providerSlot"]["profileId"] = (
            "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1")
        with self.assertRaisesRegex(ValueError, "candidate OCR observations cannot run under an older release"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_candidate_observations_profile_is_separate_and_pinned(self) -> None:
        fact = load_fact_family_pack()
        candidate = load_candidate_family_pack()
        numeric = load_numeric_family_labels()
        classes = load_class_family_labels()
        presence = load_presence_family_labels()
        preview_policy = {
            "ruleId": "pilot-candidate-family-preview", "version": "1",
            "extractionProfile": "candidate-family-preview-v1",
            "candidateRulePackSha256": candidate["packSha256"],
            "numericLabelPackSha256": numeric["labelPackSha256"],
            "classLabelPackSha256": classes["labelPackSha256"],
            "presenceLabelPackSha256": presence["labelPackSha256"],
            "codeCount": 47, "disposition": "REVIEW_AID_ONLY",
        }
        definitions = {**DEFINITIONS,
                       "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                                "parameterCode": "PZ-017",
                                "extractionProfile": "pz-017-heat-components-v1"},
                       "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                                       "parameterCode": "PZ-017",
                                       "extractionProfile": "conservative-ocr-heat-rows-v1",
                                       "disposition": "REVIEW_AID_ONLY"},
                       "factFamily": {"ruleId": "pilot-fact-family-review", "version": "1",
                                      "extractionProfile": "fact-family-pilot-v1",
                                      "packSha256": fact["packSha256"],
                                      "disposition": "REVIEW_AID_ONLY", "rules": fact["rules"]},
                       "candidateFamilyPreview": preview_policy,
                       "candidateFamilyObservations": {
                           **preview_policy,
                           "ruleId": "pilot-candidate-family-observations",
                           "extractionProfile": "candidate-family-observations-v1"}}
        config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        profile = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
        lease = {"inputManifestHash": "f" * 64,
                 "inputs": {"sourceDecisions": {}, "sourceFiles": []},
                 "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                 "definitions": definitions}, "providerSlot": {"stageJobType": "RULE_EVALUATION",
                 "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                 "profileId": profile, "configHash": config_hash}}}
        preview = {"inputManifestHash": "f" * 64, "purpose": "REVIEW_ONLY",
                   "findingCount": None, "parameterCoverage": None, "codeRows": []}
        observations = {"inputManifestHash": "f" * 64, "purpose": "REVIEW_ONLY",
                        "findingCount": None, "parameterCoverage": None,
                        "codeRows": [], "observations": []}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                      return_value={"selectedManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value={"content_json": {}}), \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_candidate_family_preview",
                      side_effect=AssertionError("v1 preview wrapper must not run")), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_candidate_family_observations",
                      return_value={"candidateFamilyPreview": preview,
                                    "candidateFamilyObservations": observations,
                                    "reviewCandidates": {"inputManifestHash": "f" * 64,
                                                         "candidates": []}}) as execute:
            result = PilotPz002RuleAdapter().execute(lease, {})
        execute.assert_called_once_with(lease, {})
        self.assertEqual(result["providerProfileId"], profile)
        self.assertEqual(result["outputCount"], 6)
        self.assertIs(result["candidateFamilyPreview"], preview)
        self.assertIs(result["candidateFamilyObservations"], observations)
        self.assertIsNone(result["candidateFamilyObservations"]["findingCount"])
        self.assertIsNone(result["candidateFamilyObservations"]["parameterCoverage"])

        definitions["candidateFamilyObservations"]["numericLabelPackSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "candidate observations release definition"):
            PilotPz002RuleAdapter().execute(lease, {})
        definitions["candidateFamilyObservations"]["numericLabelPackSha256"] = numeric["labelPackSha256"]
        lease["release"]["providerSlot"]["profileId"] = (
            "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1")
        with self.assertRaisesRegex(ValueError, "candidate observations cannot run under an older release"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_candidate_family_preview_is_separate_pinned_review_profile(self) -> None:
        fact = load_fact_family_pack()
        candidate = load_candidate_family_pack()
        definitions = {**DEFINITIONS,
                       "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                                "parameterCode": "PZ-017", "extractionProfile": "pz-017-heat-components-v1"},
                       "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                                       "parameterCode": "PZ-017",
                                       "extractionProfile": "conservative-ocr-heat-rows-v1",
                                       "disposition": "REVIEW_AID_ONLY"},
                       "factFamily": {"ruleId": "pilot-fact-family-review", "version": "1",
                                      "extractionProfile": "fact-family-pilot-v1",
                                      "packSha256": fact["packSha256"], "disposition": "REVIEW_AID_ONLY",
                                      "rules": fact["rules"]},
                       "candidateFamilyPreview": {
                           "ruleId": "pilot-candidate-family-preview", "version": "1",
                           "extractionProfile": "candidate-family-preview-v1",
                           "candidateRulePackSha256": candidate["packSha256"],
                           "numericLabelPackSha256": load_numeric_family_labels()["labelPackSha256"],
                           "classLabelPackSha256": load_class_family_labels()["labelPackSha256"],
                           "presenceLabelPackSha256": load_presence_family_labels()["labelPackSha256"],
                           "codeCount": 47, "disposition": "REVIEW_AID_ONLY"}}
        config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        lease = {"inputManifestHash": "f" * 64,
                 "inputs": {"sourceDecisions": {}, "sourceFiles": []},
                 "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                 "definitions": definitions}, "providerSlot": {"stageJobType": "RULE_EVALUATION",
                 "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                 "profileId": "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
                 "configHash": config_hash}}}
        preview = {"inputManifestHash": "f" * 64, "purpose": "REVIEW_ONLY",
                   "outputCount": 47}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002",
                   return_value={"selectedManifestHash": "f" * 64}) as execute_pz002, \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017",
                      return_value={"selectedManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value={"content_json": {}}), \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_candidate_family_preview",
                      return_value=preview) as execute:
            result = PilotPz002RuleAdapter().execute(lease, {})
        self.assertEqual(result["outputCount"], 5)
        self.assertIs(result["candidateFamilyPreview"], preview)
        execute_pz002.assert_called_once_with(lease, {}, definitions["navigation"], definitions["numeric"])
        execute.assert_called_once_with(lease, {})
        definitions["candidateFamilyPreview"]["candidateRulePackSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "candidate preview release definition"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_fact_family_profile_pins_pack_and_emits_review_only_result(self) -> None:
        pack = load_fact_family_pack()
        definitions = {**DEFINITIONS,
                       "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                                "parameterCode": "PZ-017",
                                "extractionProfile": "pz-017-heat-components-v1"},
                       "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                                       "parameterCode": "PZ-017",
                                       "extractionProfile": "conservative-ocr-heat-rows-v1",
                                       "disposition": "REVIEW_AID_ONLY"},
                       "factFamily": {"ruleId": "pilot-fact-family-review", "version": "1",
                                      "extractionProfile": "fact-family-pilot-v1",
                                      "packSha256": pack["packSha256"],
                                      "disposition": "REVIEW_AID_ONLY", "rules": pack["rules"]}}
        config_hash = hashlib.sha256(json.dumps(definitions, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        lease = {"inputManifestHash": "f" * 64,
                 "inputs": {"sourceDecisions": {}, "sourceFiles": []},
                 "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                 "definitions": definitions}, "providerSlot": {"stageJobType": "RULE_EVALUATION",
                 "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                 "profileId": "typed-pz002-pz017-ocr-heat-fact-family-v1", "configHash": config_hash}}}
        analysis = {"selectedManifestHash": "f" * 64,
                    "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        heat = {"selectedManifestHash": "f" * 64,
                "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        fact_family = {"schemaVersion": "fact-family-proposals-v1", "inputManifestHash": "f" * 64,
                       "facts": [], "comparisons": [], "findingCount": 0}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002", return_value=analysis), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017", return_value=heat), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value={"content_json": {}}), \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      return_value={"inputManifestHash": "f" * 64}), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_fact_family",
                      return_value=fact_family) as execute:
            result = PilotPz002RuleAdapter().execute(lease, {})
        self.assertEqual(result["outputCount"], 4)
        self.assertIs(result["factFamily"], fact_family)
        execute.assert_called_once_with(lease, {})
        definitions["factFamily"]["packSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "fact family release rule definition"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_ocr_heat_review_release_is_opt_in_and_does_not_promote_facts(self) -> None:
        definitions = {**DEFINITIONS,
                       "heat": {"ruleId": "pilot-pz-017-heat", "version": "1",
                                "parameterCode": "PZ-017",
                                "extractionProfile": "pz-017-heat-components-v1"},
                       "ocrHeatRows": {"ruleId": "pilot-pz-017-ocr-heat-review", "version": "1",
                                       "parameterCode": "PZ-017",
                                       "extractionProfile": "conservative-ocr-heat-rows-v1",
                                       "disposition": "REVIEW_AID_ONLY"}}
        config_hash = hashlib.sha256(json.dumps(
            definitions, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()
        decisions = {"FIL-1": {"sourceSha256": "a" * 64, "pageStages": {"2": "RD"}}}
        sources = [{"sourceFileId": "FIL-1", "sha256": "a" * 64, "stages": ["RD"]}]
        lease = {"inputManifestHash": "f" * 64,
                 "inputs": {"sourceDecisions": decisions, "sourceFiles": sources},
                 "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT",
                 "definitions": definitions}, "providerSlot": {"stageJobType": "RULE_EVALUATION",
                 "providerKind": "RULE_ENGINE", "status": "CONFIGURED",
                 "profileId": "typed-pz002-pz017-ocr-heat-v1", "configHash": config_hash}}}
        analysis = {"selectedManifestHash": "f" * 64,
                    "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        heat = {"selectedManifestHash": "f" * 64, "pdFacts": [], "rdFacts": [],
                "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        review = {"schemaVersion": "ocr-heat-row-proposals-v1",
                  "profileId": "conservative-ocr-heat-rows-v1",
                  "inputManifestHash": "f" * 64,
                  "proposals": [{"component": "HEATING"}], "abstentions": [],
                  "findingCount": 0}
        stage = {"content_json": {"schemaVersion": "analysis-stage-result-v2"}}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002", return_value=analysis), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017", return_value=heat), \
                patch("inspector_worker.pilot_rule_adapter.download_ocr_layout_artifact",
                      return_value=stage) as download, \
                patch("inspector_worker.pilot_rule_adapter.extract_ocr_heat_rows",
                      return_value=review) as extract:
            result = PilotPz002RuleAdapter().execute(lease, {"attemptId": "ATT-1"})
        self.assertEqual(result["outputCount"], 3)
        self.assertEqual(result["heatLoad"], heat)
        self.assertEqual(result["ocrHeatRows"], review)
        self.assertEqual(result["heatLoad"]["rdFacts"], [])
        download.assert_called_once_with(lease, {"attemptId": "ATT-1"})
        extract.assert_called_once_with(stage["content_json"], decisions, sources)
        lease["release"]["rules"]["definitions"]["ocrHeatRows"]["version"] = "2"
        with self.assertRaisesRegex(ValueError, "OCR heat review release rule definition"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_v2_release_pins_heat_rule_and_preserves_v1_shape(self) -> None:
        definitions = {
            "navigation": {"ruleId": "pz-002-navigation"},
            "numeric": {"ruleId": "pilot-pz-002-area"},
            "heat": {"ruleId": "pilot-pz-017-heat", "version": "1", "parameterCode": "PZ-017",
                     "extractionProfile": "pz-017-heat-components-v1"},
        }
        canonical = json.dumps(definitions, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        lease = {
            "inputManifestHash": "f" * 64,
            "release": {"lifecycle": "DRAFT", "rules": {"executionStatus": "PILOT", "definitions": definitions},
                        "providerSlot": {"stageJobType": "RULE_EVALUATION", "providerKind": "RULE_ENGINE",
                                         "status": "CONFIGURED", "profileId": "typed-pz002-pz017-v1",
                                         "configHash": hashlib.sha256(canonical.encode()).hexdigest()}},
        }
        analysis = {"selectedManifestHash": "f" * 64, "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        heat = {"selectedManifestHash": "f" * 64, "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002", return_value=analysis), \
                patch("inspector_worker.pilot_rule_adapter.execute_durable_pz017", return_value=heat):
            result = PilotPz002RuleAdapter().execute(lease, {})
        self.assertEqual(result["schemaVersion"], "analysis-stage-result-v2")
        self.assertEqual(result["outputCount"], 2)
        self.assertEqual(result["heatLoad"], heat)
        lease["release"]["rules"]["definitions"]["heat"]["version"] = "2"
        with self.assertRaisesRegex(ValueError, "PZ-017 release rule definition"):
            PilotPz002RuleAdapter().execute(lease, {})

    def test_scaffold_release_still_abstains_when_adapter_is_registered(self) -> None:
        lease = {
            "inputManifestHash": "f" * 64,
            "release": {
                "externalNetworkAllowed": False,
                "lifecycle": "SCAFFOLD",
                "providerSlot": {"providerKind": "RULE_ENGINE", "status": "UNCONFIGURED"},
            },
        }
        result = DEFAULT_STAGE_PROVIDER_REGISTRY.execute("RULE_EVALUATION", lease, {})
        self.assertEqual(result["schemaVersion"], "analysis-stage-result-v1")
        self.assertEqual(result["disposition"], "UNSUPPORTED_RULESET")

    def test_pilot_release_executes_frozen_rule_definitions(self) -> None:
        lease = {
            "inputManifestHash": "f" * 64,
            "release": {
                "externalNetworkAllowed": False,
                "lifecycle": "DRAFT",
                "rules": {"executionStatus": "PILOT", "definitions": DEFINITIONS},
                "providerSlot": {
                    "stageJobType": "RULE_EVALUATION", "providerKind": "RULE_ENGINE",
                    "status": "CONFIGURED", "profileId": "typed-pz002-v1", "configHash": CONFIG_HASH,
                },
            },
        }
        analysis = {"selectedManifestHash": "f" * 64, "evaluation": {"machineStatus": "MISSING_EVIDENCE"}}
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002", return_value=analysis) as execute:
            result = DEFAULT_STAGE_PROVIDER_REGISTRY.execute("RULE_EVALUATION", lease, {})
        execute.assert_called_once_with(lease, {}, DEFINITIONS["navigation"], DEFINITIONS["numeric"])
        self.assertEqual(result["schemaVersion"], "analysis-stage-result-v2")
        self.assertEqual(result["providerConfigHash"], CONFIG_HASH)
        self.assertEqual(result["analysis"], analysis)

    def test_pilot_release_rejects_changed_rule_hash(self) -> None:
        lease = {
            "inputManifestHash": "f" * 64,
            "release": {
                "externalNetworkAllowed": False,
                "lifecycle": "DRAFT",
                "rules": {"executionStatus": "PILOT", "definitions": DEFINITIONS},
                "providerSlot": {
                    "stageJobType": "RULE_EVALUATION", "providerKind": "RULE_ENGINE",
                    "status": "CONFIGURED", "profileId": "typed-pz002-v1", "configHash": "0" * 64,
                },
            },
        }
        with self.assertRaisesRegex(ValueError, "immutable release hash"):
            DEFAULT_STAGE_PROVIDER_REGISTRY.execute("RULE_EVALUATION", lease, {})

    def test_ocr_candidate_becomes_clarification_before_server_commit(self) -> None:
        lease = {
            "inputManifestHash": "f" * 64,
            "release": {
                "externalNetworkAllowed": False, "lifecycle": "DRAFT",
                "rules": {"executionStatus": "PILOT", "definitions": DEFINITIONS},
                "providerSlot": {
                    "stageJobType": "RULE_EVALUATION", "providerKind": "RULE_ENGINE",
                    "status": "CONFIGURED", "profileId": "typed-pz002-v1", "configHash": CONFIG_HASH,
                },
            },
        }
        analysis = {
            "selectedManifestHash": "f" * 64,
            "evaluation": {
                "machineStatus": "CANDIDATE", "reasonCode": "THRESHOLD_EXCEEDED_OCR_REVIEW_REQUIRED",
                "evidence": [{"evidenceKind": "OCR", "lineIndexes": [0]}],
                "evidenceFingerprint": "a" * 64,
            },
        }
        with patch("inspector_worker.pilot_rule_adapter.execute_durable_pz002", return_value=analysis):
            result = DEFAULT_STAGE_PROVIDER_REGISTRY.execute("RULE_EVALUATION", lease, {})
        self.assertEqual(result["analysis"]["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["analysis"]["evaluation"]["reasonCode"],
                         "OCR_CANDIDATE_REQUIRES_INDEPENDENT_REVIEW")
        self.assertIsNone(result["analysis"]["evaluation"]["evidenceFingerprint"])
        self.assertEqual(result["analysis"]["evaluation"]["evidence"][0]["lineIndexes"], [0])


if __name__ == "__main__":
    unittest.main()
