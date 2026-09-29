"""The pinned unresolved configuration produces navigation, never findings."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from inspector_worker.unresolved_config_review import (
    AREA_CODES, CODES, CONFIG_SHA256, DIMENSION_CODES, _hash, _lines,
    evaluate_unresolved_config_review, execute_durable_unresolved_config_review,
    load_unresolved_review_config,
)
from services.worker.tests.test_site_tep_area_run_review import (
    FILL, MANIFEST, OBJECT, artifact, digest, source,
)


class UnresolvedConfigReviewTests(unittest.TestCase):
    def test_relocated_package_loads_docker_rules_dir(self) -> None:
        # The wheel contains inspector_worker, while Docker COPY places rules
        # separately under /worker/rules. Simulate that layout without relying
        # on the editable source-tree parent directory.
        worker_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "site-packages" / "inspector_worker"
            shutil.copytree(worker_root / "inspector_worker", package,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            rules = root / "worker" / "rules"
            rules.mkdir(parents=True)
            for name in ("unresolved-review-config-v1.json",
                         "parameter-family-registry-v1.json"):
                shutil.copy2(worker_root / "rules" / name, rules / name)
            env = {**os.environ, "INSPECTOR_RULES_DIR": str(rules),
                   "PYTHONPATH": str(package.parent)}
            done = subprocess.run(
                [str(Path(sys.executable).resolve()), "-c",
                 "from inspector_worker.unresolved_config_review import "
                 "CONFIG_PATH, REGISTRY_PATH, load_unresolved_review_config; "
                 "import inspector_worker.unresolved_config_review as m; "
                 "c=load_unresolved_review_config(); "
                 "print(m.__file__); print(CONFIG_PATH); print(REGISTRY_PATH); "
                 "print(len(c['entries']))"],
                cwd=root, env=env, capture_output=True, text=True, check=True)
            lines = done.stdout.splitlines()
            self.assertEqual(lines[0], str(package / "unresolved_config_review.py"))
            self.assertEqual(lines[1], str(rules / "unresolved-review-config-v1.json"))
            self.assertEqual(lines[2], str(rules / "parameter-family-registry-v1.json"))
            self.assertEqual(lines[3], "19")

    def test_config_is_pinned_to_exact_registry_and_code_set(self) -> None:
        config = load_unresolved_review_config()
        self.assertEqual(_hash(config), CONFIG_SHA256)
        self.assertEqual(len(CODES), 19)
        self.assertEqual(len(AREA_CODES), 7)
        self.assertEqual(len(DIMENSION_CODES), 12)
        self.assertEqual([row["parameterCode"] for row in config["entries"]], list(CODES))
        self.assertEqual(len(set(CODES)), 19)
        self.assertTrue(all(row["locatorType"] == "TEXT_LINE_BBOX_ONLY"
                            for row in config["entries"]))
        for field, value in (("anchors", ["foo"]), ("parameterCode", "X-999")):
            changed = copy.deepcopy(config)
            changed["entries"][0][field] = value
            with self.assertRaisesRegex(ValueError, "SHA pin mismatch"):
                evaluate_unresolved_config_review(OBJECT, MANIFEST, [], [], config=changed)
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "registry.json"
            registry.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "registry SHA drift"):
                load_unresolved_review_config(registry_path=registry)

    def test_reviewed_section_and_stage_gate_sha_locators(self) -> None:
        gp = source("F-GP")
        ar = source("F-AR", section="AR")
        gp_text = FILL + "\nПлощадь озеленения, в том числе:\nУклон проезда 12 промилле"
        ar_text = FILL + "\nВедомость оконных блоков\nВысота проема 2,1 м"
        gp_art = artifact(gp, [gp_text])
        ar_art = artifact(ar, [ar_text])
        result = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, [ar, gp], [ar_art, gp_art])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["schemaVersion"], "unresolved-config-run-review-v1")
        self.assertEqual(result["configSha256"], CONFIG_SHA256)
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]], list(CODES))
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        expected = {"SPZU-027": (gp, gp_art, 1), "SPZU-033": (gp, gp_art, 2),
                    "AR-046": (ar, ar_art, 1), "AR-042": (ar, ar_art, 2)}
        for code, (src, art, line_index) in expected.items():
            row = rows[code]
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["leadCount"]), (1, 1, 0, 1))
            self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
            self.assertIn("PD_RD_PAIR_UNVERIFIED", row["reasonCodes"])
            lead = row["leads"][0]
            self.assertEqual((lead["pageNumber"], lead["blockIndex"], lead["lineIndex"]),
                             (1, 0, line_index))
            self.assertEqual(lead["sourceSha256"], src["sha256"])
            self.assertEqual(lead["textArtifactSha256"], digest(art))
            self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                lead["lineText"].encode("utf-8")).hexdigest())
            self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                        if k != "leadSha256"}))
            self.assertEqual(lead["elementAssociationStatus"], "UNVERIFIED")
        empty = rows["PZ-011"]
        self.assertEqual(empty["leadCount"], 0)
        self.assertEqual(empty["absenceConclusion"], "NOT_AVAILABLE")
        self.assertIn("NO_ELIGIBLE_REVIEWED_SOURCE", empty["reasonCodes"])

    def test_unreviewed_mixed_wrong_section_and_ocr_are_not_promoted(self) -> None:
        unreviewed = source("F-A", approval="UNKNOWN")
        mixed = source("F-B", stages=["PD", "RD"], page_stages={"1": "PD"})
        wrong = source("F-C", section="AR")
        poor = source("F-D")
        sources = [unreviewed, mixed, wrong, poor]
        text = FILL + "\nПлощадь озеленения"
        artifacts = [artifact(src, [text]) for src in sources[:-1]]
        artifacts[1] = artifact(mixed, [text, text])
        artifacts.append(artifact(poor, [FILL + "\n� Площадь озеленения"]))
        row = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, sources, artifacts)["codeRows"][4]
        self.assertEqual(row["parameterCode"], "SPZU-027")
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (1, 0, 1, 0))
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "SOURCE_STAGE_UNRESOLVED",
                         "SOURCE_ROLE_NOT_ALLOWED", "OCR_REQUIRED_DEFERRED",
                         "NO_SCANNED_TEXT_IN_SCOPE"}.issubset(row["reasonCodes"]))

    def test_complete_mixed_page_map_selects_only_allowed_reviewed_pages(self) -> None:
        mixed = source("F-MIX", section="PZ", stages=["PD", "RD"],
                       page_stages={"1": "PD", "2": "RD", "3": "UNRESOLVED"})
        art = artifact(mixed, [FILL + "\nПолезная площадь 100 м2"] * 3)
        row = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, [mixed], [art])["codeRows"][0]
        self.assertEqual(row["parameterCode"], "PZ-003")
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (1, 1, 0, 1))
        self.assertEqual((row["leads"][0]["pageNumber"],
                          row["leads"][0]["sourceStage"],
                          row["leads"][0]["sourceSection"]), (1, "PD", "PZ"))
        self.assertTrue({"SOURCE_ROLE_NOT_ALLOWED", "PAGE_STAGE_UNRESOLVED_DEFERRED"}
                        .issubset(row["reasonCodes"]))
        incomplete = copy.deepcopy(mixed)
        incomplete["pageStages"].pop("3")
        row = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, [incomplete], [art])["codeRows"][0]
        self.assertEqual((row["eligibleSourceCount"], row["leadCount"]), (0, 0))
        self.assertTrue({"PAGE_STAGE_MAP_INCOMPLETE", "SOURCE_STAGE_UNRESOLVED",
                         "NO_SCANNED_TEXT_IN_SCOPE"}
                        .issubset(row["reasonCodes"]))
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")

    def test_unicode_line_boundaries_have_exact_line_indexes_and_sha(self) -> None:
        src = source("F-GP")
        labels = ["Площадь озеленения", "Площадь газонов", "Площадь озеленения"]
        self.assertEqual(list(_lines(FILL + "\u2028" + labels[0] + "\v" + labels[1] +
                                     "\f" + labels[2])),
                         [(0, FILL), (1, labels[0]), (2, labels[1]), (3, labels[2])])
        # VT/FF are OCR_REQUIRED by the text-quality policy, so only U+2028
        # enters a committed TEXT_LAYER_CANDIDATE line locator.
        art = artifact(src, [FILL + "\u2028" + labels[0]])
        row = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, [src], [art])["codeRows"][4]
        self.assertEqual(row["leadCount"], 1)
        self.assertEqual([lead["lineIndex"] for lead in row["leads"]], [1])
        self.assertEqual([lead["lineText"] for lead in row["leads"]], labels[:1])
        for lead in row["leads"]:
            self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                lead["lineText"].encode("utf-8")).hexdigest())

    def test_caps_and_oversize_are_explicit_and_do_not_claim_absence(self) -> None:
        src = source("F-GP")
        long_line = "Площадь озеленения " + ("x" * 500)
        art = artifact(src, [FILL + "\n" + long_line + "\n" +
                             "\n".join(["Площадь озеленения"] * 20)])
        row = evaluate_unresolved_config_review(
            OBJECT, MANIFEST, [src], [art])["codeRows"][4]
        self.assertEqual((row["leadCount"], len(row["leads"]),
                          row["truncatedLeadCount"], row["oversizeAnchorLineCount"]),
                         (20, 16, 4, 1))
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])
        self.assertIn("OVERSIZE_ANCHOR_LINE_DEFERRED", row["reasonCodes"])
        self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")

    def test_bad_provenance_duplicates_and_bound_fail_closed(self) -> None:
        src = source("F-GP")
        art = artifact(src, [FILL + "\nПлощадь озеленения"])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_unresolved_config_review(OBJECT, "bad", [src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_unresolved_config_review(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_unresolved_config_review(OBJECT, MANIFEST, [src], [art, art])
        bad = copy.deepcopy(art)
        bad["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_unresolved_config_review(OBJECT, MANIFEST, [src], [bad])
        huge = copy.deepcopy(art)
        huge["unused"] = "x" * (67108864 + 1)
        with self.assertRaisesRegex(ValueError, "exceeds scan bound"):
            evaluate_unresolved_config_review(OBJECT, MANIFEST, [src], [huge])

    def test_durable_uses_fenced_loader(self) -> None:
        src = source("F-GP")
        art = artifact(src, [FILL + "\nПлощадь озеленения"])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.unresolved_config_review.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_unresolved_config_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][4]["leadCount"], 1)


if __name__ == "__main__":
    unittest.main()
