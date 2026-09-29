"""The second pinned unresolved batch stays source gated and review only."""

from __future__ import annotations

import copy
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from inspector_worker.unresolved_config_review import _hash
from inspector_worker.unresolved_config_review_v2 import (
    APPROVAL_CODES, SAFETY_CODES, V2_CODES, V2_CONFIG_PATH, V2_CONFIG_SHA256,
    evaluate_unresolved_config_review_v2, execute_durable_unresolved_config_review_v2,
    load_unresolved_review_config_v2,
)
from services.worker.tests.test_site_tep_area_run_review import (
    FILL, MANIFEST, OBJECT, artifact, digest, source,
)


class UnresolvedConfigReviewV2Tests(unittest.TestCase):
    def test_installed_layout_loads_v2_rules_from_docker_env(self) -> None:
        worker_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "site-packages" / "inspector_worker"
            shutil.copytree(worker_root / "inspector_worker", package,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            rules = root / "worker" / "rules"
            rules.mkdir(parents=True)
            for name in ("unresolved-review-config-v2.json",
                         "parameter-family-registry-v1.json"):
                shutil.copy2(worker_root / "rules" / name, rules / name)
            done = subprocess.run(
                [str(Path(sys.executable).resolve()), "-c",
                 "from inspector_worker.unresolved_config_review_v2 import "
                 "V2_CONFIG_PATH, load_unresolved_review_config_v2; "
                 "print(V2_CONFIG_PATH); print(len(load_unresolved_review_config_v2()['entries']))"],
                cwd=root,
                env={**os.environ, "INSPECTOR_RULES_DIR": str(rules),
                     "PYTHONPATH": str(package.parent)},
                capture_output=True, text=True, check=True)
            self.assertEqual(done.stdout.splitlines(),
                             [str(rules / "unresolved-review-config-v2.json"), "10"])

    def test_pinned_exact_public_anchors_roles_and_proof_dependencies(self) -> None:
        config = load_unresolved_review_config_v2()
        self.assertTrue(V2_CONFIG_PATH.is_file())
        self.assertEqual(_hash(config), V2_CONFIG_SHA256)
        self.assertEqual(len(APPROVAL_CODES), 5)
        self.assertEqual(len(SAFETY_CODES), 5)
        self.assertEqual([row["parameterCode"] for row in config["entries"]], list(V2_CODES))
        self.assertEqual(len(set(V2_CODES)), 10)
        for row in config["entries"]:
            self.assertEqual(row["locatorType"], "TEXT_LINE_BBOX_ONLY")
            self.assertEqual(len(row["anchors"]), len(row["anchorEvidence"]))
            self.assertIn("APPROVED_SOURCE_REVISIONS", row["requiredProofGates"])
            self.assertIn("PD_RD_PAIR", row["requiredProofGates"])
            if row["parameterCode"] in APPROVAL_CODES:
                self.assertEqual(row["candidateExtractorFamily"], "DOCUMENT_APPROVAL")
                self.assertIn("APPROVAL_DOCUMENT", row["requiredProofGates"])
            else:
                self.assertEqual(row["candidateExtractorFamily"], "SAFETY_COVERAGE")
                self.assertIn("APPLICABLE_NORM", row["requiredProofGates"])
            for anchor, evidence in zip(row["anchors"], row["anchorEvidence"]):
                self.assertIn(anchor, " ".join(evidence["lineText"].lower().split()))
                self.assertEqual(len(evidence["sourceSha256"]), 64)
                self.assertEqual(len(evidence["renderSha256"]), 64)
        mutated = copy.deepcopy(config)
        mutated["entries"][0]["anchors"][0] = "несуществующий якорь"
        with self.assertRaisesRegex(ValueError, "canonical SHA pin mismatch"):
            evaluate_unresolved_config_review_v2(OBJECT, MANIFEST, [], [], config=mutated)

    def test_ten_code_navigation_has_exact_locators_and_no_positive_claims(self) -> None:
        cases = [
            ("F-GP", "GP", "ВЕДОМОСТЬ ТИПОВ ПОКРЫТИЙ"),
            ("F-AR", "AR", "стемалитом в гармонирующим с цветовым решением фасадов.\n"
             "ПЛАН ПЕРВОГО ЭТАЖА на отм. 0.000"),
            ("F-IOS2", "IOS2", "Магистральные трубопроводы выполнены из стальных"),
            ("F-IOS3", "IOS3", "трубопроводы из чугунных безраструбных труб SML."),
            ("F-IOS1", "IOS1", "Светотехническое оборудование"),
            ("F-PPM", "PPM", "12.1 Система пожарной сигнализации\n"
             "дистанционное открывание запоров дверей эвакуационных выходов.\n"
             "12.1.6 Размещение пожарных извещателей производится с учетом\n"
             "12.2 Система оповещения и управления эвакуацией людей при пожаре"),
        ]
        sources = [source(source_id, section=section) for source_id, section, _ in cases]
        artifacts = [artifact(src, [FILL + "\n" + lines])
                     for src, (_, _, lines) in zip(sources, cases)]
        result = evaluate_unresolved_config_review_v2(OBJECT, MANIFEST, sources, artifacts)
        self.assertEqual(result["schemaVersion"], "unresolved-config-run-review-v2")
        self.assertEqual(result["profileId"], "unresolved-review-config-v2")
        self.assertEqual(result["configSha256"], V2_CONFIG_SHA256)
        self.assertEqual(result["contentHash"], digest({key: value for key, value in result.items()
                                                        if key != "contentHash"}))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        self.assertEqual(list(rows), list(V2_CODES))
        for code in V2_CODES:
            row = rows[code]
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertGreaterEqual(row["leadCount"], 1, code)
            self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
            self.assertIn("PD_RD_PAIR_UNVERIFIED", row["reasonCodes"])
            for lead in row["leads"]:
                self.assertEqual(lead["locatorType"], "TEXT_LINE_BBOX_ONLY")
                self.assertEqual(lead["elementAssociationStatus"], "UNVERIFIED")
                self.assertNotIn("rawValue", lead)
                self.assertEqual(lead["leadSha256"], digest({key: value for key, value
                                                            in lead.items() if key != "leadSha256"}))
                self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                    lead["lineText"].encode("utf-8")).hexdigest())

    def test_unreviewed_wrong_section_mixed_pages_and_ocr_defer(self) -> None:
        unreviewed = source("F-U", approval="UNKNOWN")
        wrong = source("F-W", section="AR")
        mixed = source("F-M", stages=["PD", "RD"],
                       page_stages={"1": "PD", "2": "UNRESOLVED"})
        poor = source("F-P")
        line = FILL + "\nВЕДОМОСТЬ ТИПОВ ПОКРЫТИЙ"
        sources = [unreviewed, wrong, mixed, poor]
        artifacts = [artifact(unreviewed, [line]), artifact(wrong, [line]),
                     artifact(mixed, [line, line]),
                     artifact(poor, [FILL + "\n\ufffd ВЕДОМОСТЬ ТИПОВ ПОКРЫТИЙ"])]
        row = evaluate_unresolved_config_review_v2(
            OBJECT, MANIFEST, sources, artifacts)["codeRows"][0]
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (2, 1, 1, 1))
        self.assertEqual(row["leads"][0]["sourceFileId"], "F-M")
        self.assertEqual(row["leads"][0]["sourceStage"], "PD")
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "SOURCE_ROLE_NOT_ALLOWED",
                         "PAGE_STAGE_UNRESOLVED_DEFERRED",
                         "OCR_REQUIRED_DEFERRED"}.issubset(row["reasonCodes"]))
        # No eligible source or scanned text is never interpreted as absence.
        only_unreviewed = evaluate_unresolved_config_review_v2(
            OBJECT, MANIFEST, [unreviewed], [artifacts[0]])["codeRows"][0]
        self.assertEqual(only_unreviewed["leadCount"], 0)
        self.assertEqual(only_unreviewed["absenceConclusion"], "NOT_AVAILABLE")
        self.assertIn("NO_SCANNED_TEXT_IN_SCOPE", only_unreviewed["reasonCodes"])

    def test_durable_path_uses_fenced_text_and_review_loader(self) -> None:
        src = source("F-GP", section="GP")
        art = artifact(src, [FILL + "\nВЕДОМОСТЬ ТИПОВ ПОКРЫТИЙ"])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.unresolved_config_review_v2."
                   "load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_unresolved_config_review_v2(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["leadCount"], 1)
        self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")


if __name__ == "__main__":
    unittest.main()
