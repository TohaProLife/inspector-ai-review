from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker import matrix_engine, matrix_fact_scope, project_constraints, project_zero_prose, rebar_prose, concrete_prose, source_declarations, steel_prose
from inspector_worker.durable_matrix import execute_durable_matrix


def release_lease() -> dict:
    definitions = {"registry": matrix_engine.load_matrix_registry(),
                   "engineSourceSha256": hashlib.sha256(Path(matrix_engine.__file__).read_bytes()).hexdigest(),
                   "factScopeSourceSha256": hashlib.sha256(Path(matrix_fact_scope.__file__).read_bytes()).hexdigest(),
                   "projectZeroProse": {"extractorVersion": project_zero_prose.EXTRACTOR_VERSION,
                       "sourceSha256": hashlib.sha256(Path(project_zero_prose.__file__).read_bytes()).hexdigest()},
                   "rebarProse": {"extractorVersion": rebar_prose.EXTRACTOR_VERSION,
                       "sourceSha256": hashlib.sha256(Path(rebar_prose.__file__).read_bytes()).hexdigest()},
                   "concreteProse": {"extractorVersion": concrete_prose.EXTRACTOR_VERSION,
                       "sourceSha256": hashlib.sha256(Path(concrete_prose.__file__).read_bytes()).hexdigest()}}
    lease = {"objectId": "source-pin-object", "inputManifestHash": "a" * 64,
             "inputs": {"sourceFiles": []},
             "release": {"lifecycle": "DRAFT", "externalNetworkAllowed": False,
                         "rules": {"matrixDefinitions": definitions},
                         "providerSlot": {"profileId": "matrix-text-facts-v1", "adapterVersion": "1",
                                          "providerKind": "RULE_ENGINE", "stageJobType": "RULE_EVALUATION",
                                          "status": "CONFIGURED"}}}
    refresh_config_hash(lease)
    return lease


def refresh_config_hash(lease: dict) -> None:
    definitions = lease["release"]["rules"]["matrixDefinitions"]
    lease["release"]["providerSlot"]["configHash"] = hashlib.sha256(json.dumps(
        definitions, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def constraints_release_lease() -> dict:
    lease = release_lease()
    lease["release"]["providerSlot"].update(profileId="matrix-text-facts-constraints-v2", adapterVersion="2")
    lease["release"]["rules"]["matrixDefinitions"]["projectConstraints"] = {
        "schemaVersion": "matrix-project-constraints-v1", "extractorVersion": project_constraints.EXTRACTOR_VERSION,
        "sourceSha256": hashlib.sha256(Path(project_constraints.__file__).read_bytes()).hexdigest(),
        "purpose": "EVIDENCE_ONLY",
    }
    refresh_config_hash(lease)
    return lease


def evidence_release_lease() -> dict:
    lease = constraints_release_lease()
    lease["release"]["providerSlot"].update(profileId="matrix-text-facts-evidence-v3", adapterVersion="3")
    lease["release"]["rules"]["matrixDefinitions"]["sourceDeclarations"] = {
        "schemaVersion": source_declarations.SCHEMA_VERSION,
        "extractorVersion": source_declarations.EXTRACTOR_VERSION,
        "sourceSha256": hashlib.sha256(Path(source_declarations.__file__).read_bytes()).hexdigest(),
        "steelExtractorVersion": steel_prose.EXTRACTOR_VERSION,
        "steelSourceSha256": hashlib.sha256(Path(steel_prose.__file__).read_bytes()).hexdigest(),
        "hashPolicyVersion": source_declarations.HASH_POLICY_VERSION,
        "purpose": "EVIDENCE_ONLY",
    }
    refresh_config_hash(lease)
    return lease


class DurableMatrixSourcePinTests(unittest.TestCase):
    def test_concrete_helper_pin_is_required_before_any_source_download(self):
        for factory in (release_lease, constraints_release_lease, evidence_release_lease):
            for drift in (None, {}, {"extractorVersion": "other", "sourceSha256": "0" * 64}):
                with self.subTest(profile=factory.__name__, drift=drift):
                    lease = factory()
                    lease['inputs']['sourceFiles'] = [{'sourceFileId': 'must-not-download', 'sha256': 'f' * 64,
                        'stages': ['PD'], 'mediaType': 'application/pdf'}]
                    definitions = lease['release']['rules']['matrixDefinitions']
                    if drift is None:
                        definitions.pop('concreteProse')
                    else:
                        definitions['concreteProse'] = drift
                    refresh_config_hash(lease)
                    with patch('inspector_worker.durable_matrix.download_text_artifact') as download, patch(
                            'inspector_worker.durable_matrix.build_matrix_execution') as build:
                        with self.assertRaisesRegex(ValueError, 'matrix concrete prose differs from pinned release'):
                            execute_durable_matrix(lease, {})
                        download.assert_not_called(); build.assert_not_called()

    def test_rebar_helper_pin_is_required_before_any_source_download(self):
        for factory in (release_lease, constraints_release_lease, evidence_release_lease):
            for drift in (None, {}, {"extractorVersion": "other", "sourceSha256": "0" * 64}):
                with self.subTest(profile=factory.__name__, drift=drift):
                    lease = factory()
                    definitions = lease["release"]["rules"]["matrixDefinitions"]
                    if drift is None:
                        definitions.pop("rebarProse")
                    else:
                        definitions["rebarProse"] = drift
                    refresh_config_hash(lease)
                    with patch("inspector_worker.durable_matrix.download_text_artifact") as download, patch(
                            "inspector_worker.durable_matrix.build_matrix_execution") as build:
                        with self.assertRaisesRegex(ValueError, "matrix rebar prose differs from pinned release"):
                            execute_durable_matrix(lease, {})
                        download.assert_not_called()
                        build.assert_not_called()

    def test_project_zero_helper_pin_is_required_before_any_source_download(self):
        for factory in (release_lease, constraints_release_lease, evidence_release_lease):
            for drift in (None, {}, {"extractorVersion": "other", "sourceSha256": "0" * 64}):
                with self.subTest(profile=factory.__name__, drift=drift):
                    lease = factory()
                    definitions = lease["release"]["rules"]["matrixDefinitions"]
                    if drift is None:
                        definitions.pop("projectZeroProse")
                    else:
                        definitions["projectZeroProse"] = drift
                    refresh_config_hash(lease)
                    with patch("inspector_worker.durable_matrix.download_text_artifact") as download, patch(
                            "inspector_worker.durable_matrix.build_matrix_execution") as build:
                        with self.assertRaisesRegex(ValueError, "matrix project zero prose differs from pinned release"):
                            execute_durable_matrix(lease, {})
                        download.assert_not_called()
                        build.assert_not_called()

    def test_v2_emits_separate_source_bound_constraints_without_changing_scalar_output(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/pd-door-bound-F0151-p22.json").read_text())
        lease = constraints_release_lease()
        lease.update(objectId=fixture["objectId"], inputManifestHash=fixture["inputManifestHash"])
        lease["inputs"]["sourceFiles"] = [{**fixture["source"], "mediaType": "application/pdf"}]
        scalar = {"results": [], "observations": [{"id": "unchanged-scalar"}]}
        with patch("inspector_worker.durable_matrix.download_text_artifact", return_value=fixture["sourceArtifact"]), patch(
                "inspector_worker.durable_matrix.build_matrix_execution", return_value=scalar):
            result = execute_durable_matrix(lease, {})
        self.assertIs(result["execution"], scalar)
        self.assertEqual(result["outputCount"], 0)
        self.assertNotIn("projectConstraints", scalar)
        self.assertEqual(result["projectConstraints"], project_constraints.extract_project_constraints(
            fixture["objectId"], fixture["inputManifestHash"], [fixture["source"]], [fixture["sourceArtifact"]]))
        self.assertEqual(len(result["projectConstraints"]["constraints"]), 1)

    def test_v2_constraint_policy_and_source_pin_fail_before_source_download(self):
        for field, value in [("schemaVersion", "unknown"), ("extractorVersion", "other"),
                             ("sourceSha256", "0" * 64), ("purpose", "COMPARISON"), ("extra", True)]:
            with self.subTest(field=field):
                lease = constraints_release_lease()
                lease["release"]["rules"]["matrixDefinitions"]["projectConstraints"][field] = value
                refresh_config_hash(lease)
                with patch("inspector_worker.durable_matrix.download_text_artifact") as download, patch(
                        "inspector_worker.durable_matrix.build_matrix_execution") as build:
                    with self.assertRaisesRegex(ValueError, "matrix project constraints differ from pinned release"):
                        execute_durable_matrix(lease, {})
                download.assert_not_called()
                build.assert_not_called()

    def test_legacy_profile_does_not_receive_constraints_or_accept_v2_policy(self):
        with patch("inspector_worker.durable_matrix.build_matrix_execution", return_value={"results": []}):
            self.assertNotIn("projectConstraints", execute_durable_matrix(release_lease(), {}))
        lease = constraints_release_lease()
        lease["release"]["providerSlot"].update(profileId="matrix-text-facts-v1", adapterVersion="1")
        with self.assertRaisesRegex(ValueError, "legacy matrix profile cannot carry project constraints"):
            execute_durable_matrix(lease, {})
        lease = constraints_release_lease()
        lease["release"]["providerSlot"]["adapterVersion"] = "1"
        with self.assertRaisesRegex(ValueError, "invalid matrix execution release"):
            execute_durable_matrix(lease, {})

    def test_v2_dispatch_uses_the_new_durable_matrix_contract(self):
        from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
        lease = constraints_release_lease()
        with patch("inspector_worker.durable_matrix.execute_durable_matrix", return_value={"marker": "v2"}) as execute:
            self.assertEqual(PilotPz002RuleAdapter().execute(lease, {}), {"marker": "v2"})
        execute.assert_called_once_with(lease, {})

    def test_exact_installed_engine_and_registry_reach_execution(self):
        lease = release_lease()
        with patch("inspector_worker.durable_matrix.build_matrix_execution", return_value={"results": []}) as build:
            result = execute_durable_matrix(lease, {})
        self.assertEqual(result["providerConfigHash"], lease["release"]["providerSlot"]["configHash"])
        self.assertEqual(result["outputCount"], 0)
        build.assert_called_once_with(object_id=lease["objectId"], input_manifest_hash=lease["inputManifestHash"],
                                      sources=[], text_artifacts=[], registry=matrix_engine.load_matrix_registry())

    def test_missing_or_wrong_source_pin_fails_before_download_or_execution(self):
        for value in [None, "0" * 64, "not-a-sha"]:
            with self.subTest(value=value):
                lease = release_lease()
                lease["inputs"]["sourceFiles"] = [{"sourceFileId": "must-not-download", "sha256": "f" * 64,
                                                    "stages": ["PD"], "mediaType": "application/pdf"}]
                definitions = lease["release"]["rules"]["matrixDefinitions"]
                if value is None:
                    definitions.pop("engineSourceSha256")
                else:
                    definitions["engineSourceSha256"] = value
                refresh_config_hash(lease)
                with patch("inspector_worker.durable_matrix.download_text_artifact") as download, patch(
                        "inspector_worker.durable_matrix.build_matrix_execution") as build:
                    with self.assertRaisesRegex(ValueError, "matrix engine source differs from pinned release"):
                        execute_durable_matrix(lease, {})
                download.assert_not_called()
                build.assert_not_called()

    def test_changed_installed_bytes_reject_same_registry_and_release(self):
        lease = release_lease()
        with patch("inspector_worker.durable_matrix.Path") as path, patch(
                "inspector_worker.durable_matrix.build_matrix_execution") as build:
            path.return_value.read_bytes.return_value = b"changed algorithm with unchanged registry"
            with self.assertRaisesRegex(ValueError, "matrix engine source differs from pinned release"):
                execute_durable_matrix(lease, {})
        path.assert_called_once_with(matrix_engine.__file__)
        build.assert_not_called()

    def test_missing_or_wrong_fact_scope_pin_fails_before_download_or_execution(self):
        for value in [None, "0" * 64, "not-a-sha"]:
            with self.subTest(value=value):
                lease = release_lease()
                lease["inputs"]["sourceFiles"] = [{"sourceFileId": "must-not-download"}]
                definitions = lease["release"]["rules"]["matrixDefinitions"]
                if value is None:
                    definitions.pop("factScopeSourceSha256")
                else:
                    definitions["factScopeSourceSha256"] = value
                refresh_config_hash(lease)
                with patch("inspector_worker.durable_matrix.download_text_artifact") as download, patch(
                        "inspector_worker.durable_matrix.build_matrix_execution") as build:
                    with self.assertRaisesRegex(ValueError, "matrix fact scope source differs from pinned release"):
                        execute_durable_matrix(lease, {})
                download.assert_not_called()
                build.assert_not_called()

    def test_changed_fact_scope_bytes_reject_same_engine_and_registry(self):
        lease = release_lease()
        original_engine = Path(matrix_engine.__file__).read_bytes()
        with patch("inspector_worker.durable_matrix.Path") as path, patch(
                "inspector_worker.durable_matrix.build_matrix_execution") as build:
            path.return_value.read_bytes.side_effect = [original_engine, b"changed evidence selector"]
            with self.assertRaisesRegex(ValueError, "matrix fact scope source differs from pinned release"):
                execute_durable_matrix(lease, {})
        self.assertEqual([call.args[0] for call in path.call_args_list],
                         [matrix_engine.__file__, matrix_fact_scope.__file__])
        build.assert_not_called()

    def test_source_pin_does_not_replace_registry_or_config_verification(self):
        for field in ["registry", "config"]:
            with self.subTest(field=field):
                lease = release_lease()
                if field == "registry":
                    definitions = lease["release"]["rules"]["matrixDefinitions"]
                    definitions["registry"] = copy.deepcopy(definitions["registry"])
                    definitions["registry"]["version"] = "different"
                    refresh_config_hash(lease)
                else:
                    lease["release"]["providerSlot"]["configHash"] = "0" * 64
                with patch("inspector_worker.durable_matrix.build_matrix_execution") as build:
                    with self.assertRaisesRegex(ValueError, "matrix registry differs" if field == "registry"
                                                else "matrix definitions hash mismatch"):
                        execute_durable_matrix(lease, {})
                build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
