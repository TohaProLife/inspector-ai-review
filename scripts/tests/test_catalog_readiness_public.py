"""Contract tests for the fail-closed public catalog inventory."""

from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "catalog-readiness-public.py"
SPEC = importlib.util.spec_from_file_location("catalog_readiness_public", SCRIPT)
assert SPEC and SPEC.loader
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


class CatalogReadinessTest(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.catalog = self.root / "catalog.jsonl"
        self.manifest = self.root / "manifest.jsonl"
        self.labels = self.root / "labels.jsonl"
        self.catalog_rows = readiness.read_jsonl(readiness.CATALOG)
        self.manifest_rows = readiness.read_jsonl(readiness.MANIFEST)
        self.label_rows = readiness.read_jsonl(readiness.LABELS)
        write_jsonl(self.catalog, self.catalog_rows)
        write_jsonl(self.manifest, self.manifest_rows)
        write_jsonl(self.labels, self.label_rows)

    def build(self) -> dict:
        return readiness.build_report(self.catalog, self.manifest, self.labels,
                                      expected_catalog_hash=None, expected_manifest_hash=None,
                                      expected_labels_hash=None)

    def test_every_catalog_code_once_with_pinned_statuses(self) -> None:
        report = readiness.build_report()
        rows = report["parameters"]
        self.assertEqual(len(rows), 132)
        self.assertEqual(len({row["parameterCode"] for row in rows}), 132)
        self.assertEqual(report["summary"]["implementationStatusCounts"], {"PARTIAL": 2, "UNSUPPORTED": 130})
        self.assertEqual({row["parameterCode"] for row in rows if row["implementationStatus"] == "PARTIAL"},
                         {"PZ-002", "PZ-017"})
        self.assertEqual(report["summary"]["eligiblePublicSourceDocumentCount"], 203)
        self.assertEqual(report["summary"]["publicCheckLabelCountInCatalog"], 6)
        self.assertEqual(report["summary"]["publicCheckLabelCountOutsideCatalog"], {"FREE-HEATING-001": 4})

    def test_duplicate_and_missing_catalog_code_fail_closed(self) -> None:
        duplicate = [dict(row) for row in self.catalog_rows]
        duplicate[-1]["parameter_code"] = duplicate[0]["parameter_code"]
        write_jsonl(self.catalog, duplicate)
        with self.assertRaisesRegex(ValueError, "duplicate catalog parameter_code"):
            self.build()
        write_jsonl(self.catalog, self.catalog_rows[:-1])
        with self.assertRaisesRegex(ValueError, "expected 132"):
            self.build()
        wrong = [dict(row) for row in self.catalog_rows]
        wrong[-1]["parameter_code"] = "FAKE-132"
        write_jsonl(self.catalog, wrong)
        with self.assertRaisesRegex(ValueError, "code mismatch"):
            self.build()

    def test_hidden_manifest_row_never_enters_report(self) -> None:
        baseline = self.build()
        hidden = {"file_id": "SECRET-DO-NOT-EMIT", "split": "TEST_HIDDEN", "stage": "PD",
                  "section": "AR", "object_id": "SECRET-OBJECT-DO-NOT-EMIT",
                  "distribution_status": "INCLUDE", "label_visibility": "ORGANIZER_ONLY"}
        write_jsonl(self.manifest, self.manifest_rows + [hidden])
        report = self.build()
        self.assertEqual(report["summary"]["eligiblePublicSourceDocumentCount"], baseline["summary"]["eligiblePublicSourceDocumentCount"])
        self.assertEqual(report["sourceInventoryByObjectStageSection"], baseline["sourceInventoryByObjectStageSection"])
        self.assertNotIn("SECRET-DO-NOT-EMIT", json.dumps(report))
        self.assertNotIn("SECRET-OBJECT-DO-NOT-EMIT", json.dumps(report))

    def test_hidden_label_does_not_count_and_public_label_must_reference_public_source(self) -> None:
        baseline = self.build()
        hidden = {"check_id": "HIDDEN-1", "split": "TEST_HIDDEN", "visibility": "ORGANIZER_ONLY",
                  "parameter_code": "PZ-002", "evidence": [{"file_id": "SECRET"}]}
        write_jsonl(self.labels, self.label_rows + [hidden])
        report = self.build()
        self.assertEqual(report["summary"]["publicCheckLabelCountInCatalog"], baseline["summary"]["publicCheckLabelCountInCatalog"])
        self.assertNotIn("HIDDEN-1", json.dumps(report))
        bad = {**self.label_rows[0], "check_id": "PUBLIC-BAD", "evidence": [{"file_id": "SECRET"}]}
        write_jsonl(self.labels, self.label_rows + [bad])
        with self.assertRaisesRegex(ValueError, "non-public source"):
            self.build()

    def test_report_hash_is_deterministic_and_input_hashes_pinned(self) -> None:
        first = readiness.build_report()
        second = readiness.build_report()
        self.assertEqual(readiness.canonical_bytes(first), readiness.canonical_bytes(second))
        unsigned = {key: value for key, value in first.items() if key != "reportSha256"}
        self.assertEqual(first["reportSha256"], hashlib.sha256(readiness.canonical_bytes(unsigned)).hexdigest())
        self.assertEqual(first["inputSha256"]["catalog"], readiness.CATALOG_SHA256)
        self.assertEqual(first["inputSha256"]["manifest"], readiness.MANIFEST_SHA256)
        self.assertEqual(first["inputSha256"]["publicLabels"], readiness.LABELS_SHA256)
        changed = [dict(row) for row in self.catalog_rows]
        changed[0]["parameter_name"] += " altered"
        write_jsonl(self.catalog, changed)
        with self.assertRaisesRegex(ValueError, "immutable public catalog SHA-256 mismatch"):
            readiness.build_report(self.catalog, self.manifest, self.labels,
                                   expected_catalog_hash=readiness.CATALOG_SHA256,
                                   expected_manifest_hash=None, expected_labels_hash=None)
        write_jsonl(self.catalog, self.catalog_rows)
        changed_labels = [dict(row) for row in self.label_rows]
        changed_labels[0]["parameter_code"] = "PZ-002"
        write_jsonl(self.labels, changed_labels)
        with self.assertRaisesRegex(ValueError, "public check labels SHA-256 mismatch"):
            readiness.build_report(self.catalog, self.manifest, self.labels,
                                   expected_catalog_hash=None, expected_manifest_hash=None,
                                   expected_labels_hash=readiness.LABELS_SHA256)

    def test_sources_and_labels_never_promote_unsupported_code(self) -> None:
        report = self.build()
        by_code = {row["parameterCode"]: row for row in report["parameters"]}
        self.assertEqual(by_code["IOS4-078"]["publicCheckLabelCount"], 5)
        self.assertEqual(by_code["IOS4-078"]["implementationStatus"], "UNSUPPORTED")
        self.assertFalse(by_code["IOS4-078"]["comparablePairVerified"])
        self.assertEqual(by_code["IOS4-078"]["findingReadiness"], "NOT_ESTABLISHED")
        self.assertEqual(by_code["PZ-002"]["implementationStatus"], "PARTIAL")
        self.assertFalse(by_code["PZ-002"]["comparablePairVerified"])
        self.assertIsNone(by_code["PZ-002"]["candidateDocuments"]["PD"]["byObject"]["OBJ-NOVOSLOBODSKAYA"]["exactSectionTagCandidateCount"])


if __name__ == "__main__":
    unittest.main()
