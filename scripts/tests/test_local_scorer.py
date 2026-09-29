"""LOCAL scorer contract checks on permitted public PDFs and synthetic predictions."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/local_scorer.py"
SPEC = importlib.util.spec_from_file_location("local_scorer", SCRIPT)
assert SPEC and SPEC.loader
scorer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scorer)


class LocalScorerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.originals = self.root / "originals"
        self.originals.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.gold = self.root / "gold.jsonl"
        self.predictions = self.root / "predictions.json"
        sources = []
        for file_id, stage in (("F1001", "PD"), ("F1002", "RD")):
            contents = f"%PDF-1.4\n{file_id}\n%%EOF".encode()
            (self.originals / f"{file_id}.pdf").write_bytes(contents)
            sources.append({"file_id": file_id, "object_id": "OBJ-1", "stage": stage,
                            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
                            "label_visibility": "PUBLIC_TRAIN", "pdf_pages": 2,
                            "size_bytes": len(contents),
                            "sha256": hashlib.sha256(contents).hexdigest()})
        self.sources = {source["file_id"]: source for source in sources}
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in sources))
        evidence = [{"stage": stage, "file_id": file_id, "pdf_page_number": 1}
                    for file_id, stage in (("F1001", "PD"), ("F1002", "RD"))]
        self.gold.write_text("".join(json.dumps({
            "check_id": f"TRAIN-{index}", "finding_group_id": "G-1", "object_id": "OBJ-1",
            "split": "TRAIN_PUBLIC", "visibility": "PUBLIC_TRAIN_LABEL", "score_eligible": True,
            "violation_label": "VIOLATION_PRESENT", "parameter_code": "KR-055",
            "location": location, "evidence": evidence,
        }) + "\n" for index, location in ((1, "001"), (2, "002"))))
        self.payload = {"schemaVersion": "local-evaluation-envelope-v1", "mode": "NORMAL",
                        "sealed": True, "runId": "CHK-1",
                        "sourceManifestSha256": hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
                        "submission": {"object_id": "OBJ-1", "checks": []}}

    def prediction(self, identity: str, location: str = "001",
                   label: str = "VIOLATION_PRESENT") -> dict:
        return {"parameter_code": "KR-055", "location": location,
                "violation_label": label, "evidence": [
                    {"stage": stage, "file_id": file_id, "pdf_page_number": 1}
                    for file_id, stage in (("F1001", "PD"), ("F1002", "RD"))]}

    def score(self) -> dict:
        self.predictions.write_text(json.dumps(self.payload))
        return scorer.score(self.predictions, self.manifest, self.gold, self.originals)

    def test_exact_pair_matches_once_and_duplicate_does_not_inflate_tp(self) -> None:
        self.payload["submission"]["checks"] = [self.prediction("P-1"), self.prediction("P-2")]
        result = self.score()
        self.assertEqual(result["counts"]["tp"], 1)
        self.assertEqual(result["counts"]["fn"], 1)
        self.assertEqual(result["counts"]["fpKnownKeys"], 1)
        self.assertEqual(result["metrics"]["recall"], 0.5)
        self.assertIsNone(result["metrics"]["precision"])
        self.assertIsNone(result["metrics"]["f1"])
        self.assertEqual(result["metrics"]["matchedPositiveGroups"], 0)

    def test_complete_group_requires_every_atomic_location(self) -> None:
        self.payload["submission"]["checks"] = [self.prediction("P-1"), self.prediction("P-2", "002")]
        result = self.score()
        self.assertEqual(result["counts"]["tp"], 2)
        self.assertEqual(result["metrics"]["matchedPositiveGroups"], 1)

    def test_location_normalizes_case_and_spaces_but_keeps_leading_zeroes(self) -> None:
        self.payload["submission"]["checks"] = [self.prediction("P-1", " 001 "),
                                                 self.prediction("P-2", "2")]
        result = self.score()
        self.assertEqual(result["counts"]["tp"], 1)
        self.assertEqual(result["counts"]["unlabeledPredictions"], 1)

    def test_wrong_page_abstention_and_unlabeled_key_not_tp(self) -> None:
        bad_page = self.prediction("P-1")
        bad_page["evidence"][1]["pdf_page_number"] = 2
        self.payload["submission"]["checks"] = [bad_page, self.prediction("P-2", "002", "COMPARISON_IMPOSSIBLE"),
                                                  self.prediction("P-3", "unknown")]
        result = self.score()
        self.assertEqual(result["counts"]["tp"], 0)
        self.assertEqual(result["counts"]["fn"], 2)
        self.assertEqual(result["counts"]["unlabeledPredictions"], 1)
        self.assertEqual(result["counts"]["abstentions"], 1)

    def test_rejects_review_candidate_fake_sha_and_demo_seed(self) -> None:
        self.payload["submission"]["checks"] = [self.prediction("P-1")]
        self.payload["submission"]["checks"][0]["violation_label"] = "REVIEW_CANDIDATE"
        with self.assertRaisesRegex(scorer.ScorerInputError, "official submission schema invalid"):
            self.score()
        self.payload["submission"]["checks"][0]["violation_label"] = "VIOLATION_PRESENT"
        self.payload["mode"] = "DEMO_SEED"
        with self.assertRaisesRegex(scorer.ScorerInputError, "evaluation envelope invalid"):
            self.score()
        self.payload["mode"] = "NORMAL"
        self.payload["submission"]["checks"][0]["resultType"] = "REVIEW_CANDIDATE"
        with self.assertRaisesRegex(scorer.ScorerInputError, "review candidates"):
            self.score()

    def test_rejects_modified_original_and_nonpublic_gold(self) -> None:
        self.payload["submission"]["checks"] = [self.prediction("P-1")]
        (self.originals / "F1001.pdf").write_bytes(b"changed")
        with self.assertRaisesRegex(scorer.ScorerInputError, "original PDF SHA/size"):
            self.score()
        (self.originals / "F1001.pdf").write_bytes(b"%PDF-1.4\nF1001\n%%EOF")
        hidden = json.loads(self.gold.read_text().splitlines()[0])
        hidden["split"] = "TEST_HIDDEN"
        self.gold.write_text(json.dumps(hidden) + "\n")
        with self.assertRaisesRegex(scorer.ScorerInputError, "non-public label"):
            self.score()

    def test_negative_uses_one_to_one_match(self) -> None:
        negative = json.loads(self.gold.read_text().splitlines()[0])
        negative["check_id"] = "NEG-1"
        negative["finding_group_id"] = "G-NEG"
        negative["violation_label"] = "NO_VIOLATION"
        negative["location"] = "003"
        self.gold.write_text(self.gold.read_text() + json.dumps(negative) + "\n")
        self.payload["submission"]["checks"] = [self.prediction("P-1", "003", "NO_VIOLATION"),
                                                 self.prediction("P-2", "003", "NO_VIOLATION")]
        result = self.score()
        self.assertEqual(result["counts"]["tn"], 1)
        self.assertEqual(len(result["matchedNegative"]), 1)


if __name__ == "__main__":
    unittest.main()
