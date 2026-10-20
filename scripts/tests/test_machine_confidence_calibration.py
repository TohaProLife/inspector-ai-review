"""Synthetic, hand-calculated tests; these labels establish no real calibration."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-machine-confidence-calibration.py"
SPEC = importlib.util.spec_from_file_location("machine_confidence_calibration", SCRIPT)
assert SPEC and SPEC.loader
calibration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(calibration)


class CalibrationPreparationTest(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest_path = self.root / "manifest.json"
        self.fit = [self.row(f"fit-{i}", value, label) for i, (value, label) in enumerate(
            [(0.1, 0), (0.2, 1), (0.3, 0), (0.4, 1)])]
        self.heldout = [self.row(f"eval-{i}", value, label) for i, (value, label) in enumerate(
            [(0.1, 0), (0.2, 0), (0.3, 1), (0.4, 1), (0.05, 1), (0.45, 0)])]
        self.manifest = {
            "schema_version": 1, "calibration_version": "SYNTHETIC-v1",
            "label_target": "engineering_violation", "domain": "SYNTHETIC-only",
            "model": {"id": "SYNTHETIC-model", "version": "v1", "score_name": "raw_score"},
            "score_domain": [0, 1],
            "label_provenance": {"source_id": "SYNTHETIC-labels", "source_version": "v1",
                                 "annotation_protocol": "Hand-written unittest only",
                                 "annotator_authority": "Synthetic test author",
                                 "independent_of_model_predictions": True},
            "split_provenance": {"method": "Hand-separated synthetic objects/documents",
                                 "assignment_id": "SYNTHETIC-split-v1",
                                 "assigned_before_evaluation": True},
            "sources": {},
        }

    @staticmethod
    def row(identifier: str, score: object, label: object) -> dict:
        return {"candidate_id": identifier, "label_id": f"label-{identifier}",
                "object_id": f"object-{identifier}",
                "document_sha256s": [hashlib.sha256(identifier.encode()).hexdigest()],
                "score": score, "label": label, "label_target": "engineering_violation",
                "domain": "SYNTHETIC-only", "model_id": "SYNTHETIC-model",
                "model_version": "v1", "label_source_id": "SYNTHETIC-labels"}

    def write_inputs(self) -> None:
        for split, rows in (("fit", self.fit), ("evaluation", self.heldout)):
            data = b"".join(json.dumps(row, allow_nan=True).encode() + b"\n" for row in rows)
            (self.root / f"{split}.jsonl").write_bytes(data)
            self.manifest["sources"][split] = {
                "path": f"{split}.jsonl", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        self.write_manifest()

    def write_manifest(self) -> None:
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def prepare(self) -> dict:
        self.write_inputs()
        return calibration.prepare(self.manifest_path)

    def assert_refused(self, message: str) -> None:
        with self.assertRaisesRegex(calibration.CalibrationError, message):
            self.prepare()

    def cli(self, output: Path) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-I", "-B", "-S", str(SCRIPT),
                               "--manifest", str(self.manifest_path), "--output", str(output)],
                              capture_output=True, text=True, timeout=10, check=False)

    def test_hand_pav_pool_and_fit_metrics(self) -> None:
        artifact = self.prepare()
        self.assertEqual(artifact["parameters"]["score_knots"], [0.1, 0.2, 0.3, 0.4])
        self.assertEqual(artifact["parameters"]["probability_knots"], [0, 0.5, 0.5, 1])
        self.assertEqual(artifact["parameters"]["blocks"], [
            {"first": 0, "last": 0, "positives": 0, "count": 1},
            {"first": 1, "last": 2, "positives": 1, "count": 2},
            {"first": 3, "last": 3, "positives": 1, "count": 1}])
        metrics = artifact["metrics"]["fit"]
        self.assertEqual((metrics["rows"], metrics["scored"], metrics["positives"]), (4, 4, 2))
        self.assertEqual(metrics["brier"], 0.125)
        self.assertEqual(metrics["ece_10_equal_width_bins"], 0)

    def test_heldout_hand_metrics_and_ood_coverage(self) -> None:
        metrics = self.prepare()["metrics"]["heldout"]
        self.assertEqual((metrics["rows"], metrics["scored"], metrics["abstained"]), (6, 4, 2))
        self.assertEqual(metrics["coverage"], 2 / 3)
        self.assertEqual(metrics["brier"], 0.125)
        self.assertEqual(metrics["ece_10_equal_width_bins"], 0)
        self.assertEqual(metrics["probability_bins"][9]["mean_probability"], 1)

    def test_nonzero_hand_brier_and_ece(self) -> None:
        model = {"score_knots": [0, 1], "probability_knots": [0.25, 0.75]}
        metrics = calibration.evaluate([self.row("one", 0, 0), self.row("two", 1, 0)], model)
        self.assertEqual(metrics["brier"], 0.3125)
        self.assertEqual(metrics["ece_10_equal_width_bins"], 0.5)

    def test_equal_scores_weighted_pool_and_permutation(self) -> None:
        rows = [self.row("a", 0.2, 1), self.row("b", 0.2, 0), self.row("c", 0.3, 1)]
        expected = calibration.fit_pav(rows)
        self.assertEqual(expected["score_knots"], [0.2, 0.3])
        self.assertEqual(expected["probability_knots"], [0.5, 1])
        self.assertEqual(expected, calibration.fit_pav(list(reversed(rows))))
        pooled = calibration.fit_pav(rows + [self.row("d", 0.4, 0)])
        self.assertEqual(pooled["probability_knots"], [0.5, 0.5, 0.5])

    def test_interpolation_singleton_and_no_extrapolation(self) -> None:
        model = {"score_knots": [0.2, 0.4], "probability_knots": [0, 1]}
        self.assertAlmostEqual(calibration.predict(model, 0.25), 0.25)
        self.assertIsNone(calibration.predict(model, 0.1))
        self.assertIsNone(calibration.predict(model, 0.5))
        singleton = calibration.fit_pav([self.row("a", 0.2, 1)])
        self.assertEqual(calibration.predict(singleton, 0.2), 1)
        self.assertIsNone(calibration.predict(singleton, 0.20001))

    def test_all_heldout_abstain_has_null_metrics(self) -> None:
        self.heldout = [self.row("other", 0.9, 1)]
        metrics = self.prepare()["metrics"]["heldout"]
        self.assertEqual((metrics["scored"], metrics["abstained"], metrics["coverage"]), (0, 1, 0))
        self.assertIsNone(metrics["brier"])
        self.assertIsNone(metrics["ece_10_equal_width_bins"])

    def test_object_and_document_leakage_independently_refused(self) -> None:
        self.heldout[0]["object_id"] = self.fit[0]["object_id"]
        self.assert_refused("object leakage")
        self.heldout[0]["object_id"] = "renamed-object"
        self.heldout[0]["document_sha256s"] = ["0" * 64, self.fit[0]["document_sha256s"][0]]
        self.assert_refused("document leakage")

    def test_duplicate_candidate_and_label_ids_within_and_across_splits(self) -> None:
        for field in ("candidate_id", "label_id"):
            for same_split in (True, False):
                with self.subTest(field=field, same_split=same_split):
                    destination = self.fit[1] if same_split else self.heldout[0]
                    original = destination[field]
                    destination[field] = self.fit[0][field]
                    self.assert_refused(f"duplicate {field}")
                    destination[field] = original

    def test_number_types_range_and_nonfinite_refused(self) -> None:
        for invalid in (True, False, "0.5", None, -0.01, 1.01, 10 ** 400,
                        float("nan"), float("inf"), -float("inf")):
            with self.subTest(value=str(invalid)[:30]):
                self.fit[0]["score"] = invalid
                self.assert_refused("score|nonfinite")

    def test_labels_strict_bool_or_integer(self) -> None:
        for valid in (True, False, 0, 1):
            self.fit[0]["label"] = valid
            self.prepare()
        for invalid in (0.0, 1.0, "1", 2, None):
            with self.subTest(label=invalid):
                self.fit[0]["label"] = invalid
                self.assert_refused("label must")

    def test_binding_target_domain_model_and_label_source(self) -> None:
        for key in ("label_target", "domain", "model_id", "model_version", "label_source_id"):
            with self.subTest(key=key):
                original = self.fit[0][key]
                self.fit[0][key] = "wrong"
                self.assert_refused("mismatch")
                self.fit[0][key] = original
        self.manifest["label_target"] = "ocr_quality"
        self.assert_refused("engineering_violation")

    def test_provenance_assertions_required_but_never_verified(self) -> None:
        for assertion in (False, 1, "true"):
            self.manifest["label_provenance"]["independent_of_model_predictions"] = assertion
            self.assert_refused("independent label provenance")
        self.manifest["label_provenance"]["independent_of_model_predictions"] = True
        self.manifest["split_provenance"]["assigned_before_evaluation"] = False
        self.assert_refused("predeclared split")
        self.manifest["split_provenance"]["assigned_before_evaluation"] = True
        artifact = self.prepare()
        self.assertEqual(artifact["status"], "PREPARED_REQUIRES_INDEPENDENT_LABEL_REVIEW")
        self.assertFalse(artifact["runtime_activation_permitted"])
        self.assertEqual(artifact["independent_label_review"], "REQUIRED_NOT_PERFORMED")
        self.assertNotIn("expectedCalibrationVersion", artifact)

    def test_hash_and_byte_drift_refused(self) -> None:
        self.write_inputs()
        for field, value in (("sha256", "0" * 64), ("bytes", 1), ("bytes", True)):
            with self.subTest(field=field):
                original = self.manifest["sources"]["fit"][field]
                self.manifest["sources"]["fit"][field] = value
                self.write_manifest()
                with self.assertRaisesRegex(calibration.CalibrationError, "drift|byte count"):
                    calibration.prepare(self.manifest_path)
                self.manifest["sources"]["fit"][field] = original
        self.write_manifest()
        with (self.root / "fit.jsonl").open("ab") as stream:
            stream.write(b" ")
        with self.assertRaisesRegex(calibration.CalibrationError, "drift"):
            calibration.prepare(self.manifest_path)

    def test_duplicate_keys_overflow_depth_and_unknown_fields_refused(self) -> None:
        for encoded in (b'{"score":0.1,"score":0.2}', b'{"score":1e9999}',
                        b'[' * 17 + b'0' + b']' * 17):
            with self.subTest(encoded=encoded[:40]):
                with self.assertRaises(calibration.CalibrationError):
                    calibration.strict_json(encoded)
        self.manifest["expectedCalibrationVersion"] = "forbidden"
        self.assert_refused("manifest fields")

    def test_empty_and_malformed_document_set_refused(self) -> None:
        self.fit = []
        self.assert_refused("byte count|empty")
        self.fit = [self.row("fit-only", 0.2, 1)]
        for documents in ([], ["bad"], ["a" * 64, "a" * 64], [False], "a" * 64):
            self.fit[0]["document_sha256s"] = documents
            self.assert_refused("document_sha256s")

    def test_declared_domain_and_input_budgets(self) -> None:
        self.manifest["score_domain"] = [0.1, 0.4]
        self.assert_refused("declared score domain")  # Heldout rows may not leave declared domain.
        self.manifest["score_domain"] = [False, 1]
        self.assert_refused("score")
        self.manifest_path.write_bytes(b" " * (calibration.MAX_MANIFEST_BYTES + 1))
        with self.assertRaisesRegex(calibration.CalibrationError, "byte limit"):
            calibration.prepare(self.manifest_path)
        self.assertEqual(calibration.MAX_ROWS, 50_000)
        with self.assertRaisesRegex(calibration.CalibrationError, "depth"):
            calibration.strict_json(b"[" * 17 + b"0" + b"]" * 17)

    def test_documented_source_and_split_fingerprints(self) -> None:
        artifact = self.prepare()
        raw = self.manifest_path.read_bytes()
        self.assertEqual(artifact["manifest"], {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        expected_objects = sorted(row["object_id"] for row in self.fit)
        expected_hash = hashlib.sha256(json.dumps(expected_objects, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(artifact["splits"]["fit"]["object_ids_sha256"], expected_hash)
        self.assertEqual(artifact["sources"], self.manifest["sources"])
        self.assertEqual(artifact, calibration.prepare(self.manifest_path))

    def test_jsonl_duplicate_keys_and_real_line_budget_after_valid_hash(self) -> None:
        self.write_inputs()
        for raw, message in ((b'{"candidate_id":"a","candidate_id":"b"}\n', "duplicate JSON key"),
                             (b" " * (calibration.MAX_LINE_BYTES + 1) + b"\n", "line byte limit")):
            with self.subTest(message=message):
                (self.root / "fit.jsonl").write_bytes(raw)
                self.manifest["sources"]["fit"].update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
                self.write_manifest()
                with self.assertRaisesRegex(calibration.CalibrationError, message):
                    calibration.prepare(self.manifest_path)

    def test_one_class_is_prepared_without_self_qualification(self) -> None:
        for row in self.fit + self.heldout:
            row["label"] = 0
        artifact = self.prepare()
        self.assertEqual(artifact["metrics"]["heldout"]["brier"], 0)
        self.assertEqual(artifact["status"], "PREPARED_REQUIRES_INDEPENDENT_LABEL_REVIEW")
        self.assertFalse(artifact["runtime_activation_permitted"])

    def test_missing_provenance_and_path_escape_refused(self) -> None:
        self.manifest["label_provenance"]["annotation_protocol"] = ""
        self.assert_refused("annotation_protocol")
        self.manifest["label_provenance"]["annotation_protocol"] = "Synthetic protocol"
        self.write_inputs()
        for name in ("../fit.jsonl", "/tmp/fit.jsonl"):
            self.manifest["sources"]["fit"]["path"] = name
            self.write_manifest()
            with self.assertRaisesRegex(calibration.CalibrationError, "relative"):
                calibration.prepare(self.manifest_path)

    def test_cli_private_atomic_deterministic_and_exclusive(self) -> None:
        self.write_inputs()
        first, second = self.root / "prepared.json", self.root / "prepared-again.json"
        result = self.cli(first)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = first.read_bytes()
        self.assertEqual(stat.S_IMODE(first.stat().st_mode), 0o600)
        self.assertEqual(json.loads(result.stdout)["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(self.cli(second).returncode, 0)
        self.assertEqual(data, second.read_bytes())
        self.assertEqual(self.cli(first).returncode, 1)
        self.assertEqual(data, first.read_bytes())
        self.assertFalse(list(self.root.glob(".prepared*")))

    def test_publication_failure_cleans_temporary_and_does_not_overwrite(self) -> None:
        output = self.root / "prepared.json"
        with patch.object(calibration.os, "link", side_effect=OSError("test publication failure")):
            with self.assertRaises(OSError):
                calibration.write_exclusive(output, b"complete\n")
        self.assertFalse(output.exists())
        self.assertFalse(list(self.root.glob(".prepared*")))
        output.write_bytes(b"prior")
        with self.assertRaises(FileExistsError):
            calibration.write_exclusive(output, b"replacement")
        self.assertEqual(output.read_bytes(), b"prior")

    def test_refused_cli_never_publishes(self) -> None:
        self.fit[0]["label"] = "fabricated"
        self.write_inputs()
        output = self.root / "prepared.json"
        result = self.cli(output)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr)["status"], "REFUSED")
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
