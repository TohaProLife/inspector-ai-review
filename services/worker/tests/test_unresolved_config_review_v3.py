"""The network topology profile emits only bounded text navigation."""

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
from inspector_worker.unresolved_config_review_v3 import (
    NETWORK_CODES, V3_CONFIG_PATH, V3_CONFIG_SHA256,
    evaluate_unresolved_config_review_v3, load_unresolved_review_config_v3,
    execute_durable_unresolved_config_review_v3,
)
from services.worker.tests.test_site_tep_area_run_review import (
    FILL, MANIFEST, OBJECT, artifact, digest, source,
)


class UnresolvedConfigReviewV3Tests(unittest.TestCase):
    def test_durable_uses_committed_text_and_fenced_source_loader(self) -> None:
        reviewed = source("F-EOM-DURABLE", section="EOM")
        committed = artifact(reviewed, [FILL + "\nНоминальный ток защитных автоматов"])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.unresolved_config_review_v3."
                   "load_durable_candidate_family_inputs",
                   return_value=([reviewed], [committed])) as loader:
            result = execute_durable_unresolved_config_review_v3(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["leadCount"], 1)
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in result["codeRows"]))

    def test_exact_pinned_public_anchor_receipts_and_proof_gates(self) -> None:
        config = load_unresolved_review_config_v3()
        self.assertEqual(_hash(config), V3_CONFIG_SHA256)
        self.assertEqual(config["auditedRenderProfile"], "pdftoppm-100dpi-png-singlefile")
        self.assertEqual([entry["parameterCode"] for entry in config["entries"]],
                         list(NETWORK_CODES))
        self.assertEqual(len(set(NETWORK_CODES)), 7)
        expected_pages = {"IOS1-068": ("F0148", 249), "IOS1-069": ("F0128", 21),
                          "IOS1-070": ("F0162", 20), "IOS4-076": ("F0171", 11),
                          "IOS4-078": ("F0171", 144), "PPM-111": ("F0171", 19),
                          "PPM-113": ("F0163", 8)}
        for entry in config["entries"]:
            code = entry["parameterCode"]
            self.assertEqual(entry["candidateExtractorFamily"], "NETWORK_TOPOLOGY")
            self.assertEqual(entry["locatorType"], "TEXT_LINE_BBOX_ONLY")
            self.assertTrue({"APPROVED_SOURCE_REVISIONS", "VERIFIED_SECTION_STAGE",
                             "SAME_ELEMENT_OR_SPACE", "PD_RD_PAIR", "DRAWING_GEOMETRY",
                             "GRAPH_CONNECTIVITY"}.issubset(entry["requiredProofGates"]))
            self.assertEqual(len(entry["anchors"]), 1)
            evidence = entry["anchorEvidence"][0]
            self.assertEqual((evidence["sourceFileId"], evidence["pageNumber"]),
                             expected_pages[code])
            self.assertEqual(len(evidence["sourceSha256"]), 64)
            self.assertEqual(len(evidence["renderSha256"]), 64)
            self.assertIn(entry["anchors"][0],
                          " ".join(evidence["lineText"].lower().split()))
        tampered = copy.deepcopy(config)
        tampered["entries"][0]["anchors"] = ["ложный якорь"]
        with self.assertRaisesRegex(ValueError, "canonical SHA pin mismatch"):
            evaluate_unresolved_config_review_v3(OBJECT, MANIFEST, [], [], config=tampered)

    def test_seven_codes_return_sha_located_abstentions_without_graph_claims(self) -> None:
        cases = [
            ("S-EOM", "EOM", "Номинальный ток защитных автоматов необходимо определить\n"
             "кабели марки ВВГнг(А)-FRLS. для противопожарной защиты\n"
             "Полоса металлическая, 40х4 (для контура заземления"),
            ("S-OV", "OV", "двухтрубная, стояковая система отопления\n"
             "Воздуховод из оцинкованной стали, класс гермет. В\n"
             "дымовые и огнезадерживающие клапаны"),
            ("S-VK", "VK", "внутреннего пожаротушения 20.2 л/сек."),
        ]
        sources = [source(source_id, section=section) for source_id, section, _ in cases]
        artifacts = [artifact(src, [FILL + "\n" + text])
                     for src, (_, _, text) in zip(sources, cases)]
        result = evaluate_unresolved_config_review_v3(OBJECT, MANIFEST, sources, artifacts)
        self.assertEqual(result["schemaVersion"], "unresolved-config-run-review-v3")
        self.assertEqual(result["profileId"], "unresolved-review-config-v3")
        self.assertEqual(result["configSha256"], V3_CONFIG_SHA256)
        self.assertEqual(result["contentHash"], digest({key: value for key, value in result.items()
                                                        if key != "contentHash"}))
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]],
                         list(NETWORK_CODES))
        for row in result["codeRows"]:
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual(row["leadCount"], 1)
            self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
            self.assertIn("NETWORK_TOPOLOGY_UNVERIFIED", row["reasonCodes"])
            lead = row["leads"][0]
            self.assertEqual(lead["locatorType"], "TEXT_LINE_BBOX_ONLY")
            self.assertEqual(lead["elementAssociationStatus"], "UNVERIFIED")
            self.assertNotIn("rawValue", lead)
            self.assertNotIn("branchId", lead)
            self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                lead["lineText"].encode("utf-8")).hexdigest())
            self.assertEqual(lead["leadSha256"], digest({key: value for key, value
                                                        in lead.items() if key != "leadSha256"}))

    def test_complete_mixed_rd_id_map_scans_rd_only_and_defers_ocr(self) -> None:
        mixed = source("S-OV-MIXED", section="OV", stages=["RD", "ID"],
                       page_stages={"1": "RD", "2": "ID", "3": "UNRESOLVED", "4": "RD"})
        line = FILL + "\nВоздуховод из оцинкованной стали, класс гермет. В"
        art = artifact(mixed, [line, line, line, FILL + "\n\ufffd " + line])
        row = evaluate_unresolved_config_review_v3(
            OBJECT, MANIFEST, [mixed], [art])["codeRows"][4]
        self.assertEqual(row["parameterCode"], "IOS4-078")
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (1, 1, 1, 1))
        self.assertEqual((row["leads"][0]["pageNumber"], row["leads"][0]["sourceStage"]),
                         (1, "RD"))
        self.assertTrue({"SOURCE_ROLE_NOT_ALLOWED", "PAGE_STAGE_UNRESOLVED_DEFERRED",
                         "OCR_REQUIRED_DEFERRED"}.issubset(row["reasonCodes"]))
        incomplete = copy.deepcopy(mixed)
        incomplete["pageStages"].pop("3")
        row = evaluate_unresolved_config_review_v3(
            OBJECT, MANIFEST, [incomplete], [art])["codeRows"][4]
        self.assertEqual((row["eligibleSourceCount"], row["leadCount"]), (0, 0))
        self.assertTrue({"PAGE_STAGE_MAP_INCOMPLETE", "SOURCE_STAGE_UNRESOLVED",
                         "NO_SCANNED_TEXT_IN_SCOPE"}.issubset(row["reasonCodes"]))
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")

    def test_unreviewed_other_section_and_truncation_never_prove_absence(self) -> None:
        other = source("S-OTHER", section="OTHER")
        unknown = source("S-UNKNOWN", section="EOM", approval="UNKNOWN")
        line = FILL + "\nНоминальный ток защитных автоматов"
        row = evaluate_unresolved_config_review_v3(
            OBJECT, MANIFEST, [other, unknown],
            [artifact(other, [line]), artifact(unknown, [line])])["codeRows"][0]
        self.assertEqual((row["eligibleSourceCount"], row["leadCount"]), (0, 0))
        self.assertTrue({"SOURCE_ROLE_NOT_ALLOWED", "SOURCE_REVIEW_REQUIRED",
                         "NO_SCANNED_TEXT_IN_SCOPE"}.issubset(row["reasonCodes"]))
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
        reviewed = source("S-EOM", section="EOM")
        text = (FILL + "\n" + "Номинальный ток защитных автоматов " + "x" * 500
                + "\n" + "\n".join(["Номинальный ток защитных автоматов"] * 20))
        row = evaluate_unresolved_config_review_v3(
            OBJECT, MANIFEST, [reviewed], [artifact(reviewed, [text])])["codeRows"][0]
        self.assertEqual((row["oversizeAnchorLineCount"], row["leadCount"],
                          row["truncatedLeadCount"], len(row["leads"])), (1, 20, 4, 16))
        self.assertTrue({"OVERSIZE_ANCHOR_LINE_DEFERRED", "LEAD_LIMIT_REACHED"}
                        .issubset(row["reasonCodes"]))
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")

    def test_installed_layout_resolves_v3_rules_from_env(self) -> None:
        worker_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "site-packages" / "inspector_worker"
            shutil.copytree(worker_root / "inspector_worker", package,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            rules = root / "worker" / "rules"
            rules.mkdir(parents=True)
            for name in ("unresolved-review-config-v3.json",
                         "parameter-family-registry-v1.json"):
                shutil.copy2(worker_root / "rules" / name, rules / name)
            done = subprocess.run(
                [str(Path(sys.executable).resolve()), "-c",
                 "from inspector_worker.unresolved_config_review_v3 import "
                 "V3_CONFIG_PATH,load_unresolved_review_config_v3; "
                 "print(V3_CONFIG_PATH); print(len(load_unresolved_review_config_v3()['entries']))"],
                cwd=root, env={**os.environ, "INSPECTOR_RULES_DIR": str(rules),
                               "PYTHONPATH": str(package.parent)},
                capture_output=True, text=True, check=True)
            self.assertEqual(done.stdout.splitlines(),
                             [str(rules / "unresolved-review-config-v3.json"), "7"])


if __name__ == "__main__":
    unittest.main()
