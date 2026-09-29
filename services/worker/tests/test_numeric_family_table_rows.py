from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.numeric_family_table_rows import (
    _definitions, _matched_labels, _row_pairs, _source_gate,
    observe_indexed_numeric_family_table_rows,
)
from inspector_worker.numeric_table_row_candidates import load_numeric_table_policy


def line(block: int, text: str, x0: int, x1: int, y0: int = 1000) -> dict:
    return {"blockIndex": block, "lineIndex": 0, "text": text,
            "bboxMilliPoints": [x0, y0, x1, y0 + 10000]}


class NumericFamilyTableRowsTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.manifest = self.root / "manifest.jsonl"
        self.source = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
            "extension": ".pdf", "size_bytes": 100, "sha256": "a" * 64,
            "pdf_pages": 1,
        }
        self.manifest.write_text(json.dumps(self.source) + "\n")
        manifest_sha = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.policy = load_numeric_family_labels()
        self.special = load_numeric_table_policy()
        self.policy["publicManifestSha256"] = manifest_sha
        self.special["publicManifestSha256"] = manifest_sha
        self.lines = [
            line(0, "Толщина несущей монолитной стены", 1000, 35000),
            line(1, "мм", 45000, 55000),
            line(2, "220", 65000, 75000),
        ]
        self.page = {"quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
                     "indexVersionHash": "1" * 20, "lines": self.lines}
        self.meta = {"source_id": "F0001", "object_id": "OBJ-1", "stage": "PD",
                     "section": "KR", "source_sha256": "a" * 64,
                     "relative_path": "plan.pdf", "status": "COMPLETE"}
        self.evidence = {"sourceSha256": "a" * 64, "indexVersionHash": "1" * 20,
                         "pageArtifactSha256": "b" * 64,
                         "evidenceSha256": "c" * 64,
                         "coordinateSystem": "PDF_POINTS_BOTTOM_LEFT",
                         "lines": self.lines}

    def _observe(self) -> dict:
        with (patch("inspector_worker.numeric_family_table_rows.load_numeric_family_labels",
                    return_value=self.policy),
              patch("inspector_worker.numeric_family_table_rows.load_numeric_table_policy",
                    return_value=self.special),
              patch("inspector_worker.numeric_family_table_rows.get_indexed_page",
                    return_value={"source": self.meta, "page": self.page}),
              patch("inspector_worker.numeric_family_table_rows.load_indexed_page_evidence",
                    return_value=self.evidence)):
            return observe_indexed_numeric_family_table_rows(
                self.manifest, self.root, "F0001", 1)

    def test_every_numeric_attribute_has_exact_same_row_syntax(self) -> None:
        definitions = _definitions(load_numeric_family_labels(), load_numeric_table_policy())
        seen = set()
        for definition in definitions:
            if definition["policyKind"] != "NUMERIC_FAMILY_LITERAL":
                continue
            identity = (definition["parameterCode"], definition["attribute"])
            if identity in seen:
                continue
            seen.add(identity)
            sample = [line(0, definition["label"], 1000, 35000),
                      line(1, definition["unitAliases"][0], 45000, 55000),
                      line(2, "220", 65000, 75000)]
            with self.subTest(identity=identity):
                self.assertEqual(len(_matched_labels(sample, definition["label"])), 1)
                self.assertEqual(len(_row_pairs(sample, sample[0],
                                               definition["unitAliases"])), 1)
        self.assertEqual(len(seen), 35)

    def test_exact_row_is_review_only_with_source_gate_and_sha_roles(self) -> None:
        report = self._observe()
        self.assertEqual(report["status"], "REVIEW_ONLY_ABSTAIN")
        self.assertEqual(report["labelRowsSeen"], 1)
        self.assertEqual(len(report["observations"]), 1)
        observed = report["observations"][0]
        self.assertEqual((observed["parameterCode"], observed["attribute"]),
                         ("KR-061", "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS"))
        self.assertEqual(observed["sourceGate"], "DRAWING_SECTION_UNVERIFIED")
        self.assertEqual(observed["row"]["rawValue"], "220")
        self.assertEqual(observed["row"]["rawUnit"], "мм")
        self.assertEqual(observed["row"]["pageArtifactSha256"], "b" * 64)
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertNotIn("comparison", report)

    def test_ambiguous_or_shifted_cells_fail_closed(self) -> None:
        self.lines.append(line(3, "240", 80000, 90000))
        observed = self._observe()["observations"][0]
        self.assertEqual(observed["status"], "ABSTAIN_MISSING_OR_AMBIGUOUS_CELLS")
        self.assertEqual(observed["pairCount"], 2)
        self.lines.pop()
        self.lines[1]["bboxMilliPoints"] = [45000, 25000, 55000, 35000]
        self.assertEqual(self._observe()["observations"][0]["pairCount"], 0)
        self.lines[1]["bboxMilliPoints"] = [45000, 1000, 55000, 11000]
        self.lines.append(line(3, self.lines[0]["text"], 1000, 35000, 25000))
        self.assertEqual(self._observe()["observations"][0]["status"],
                         "ABSTAIN_MULTIPLE_LABEL_ROWS")

    def test_source_gate_never_infers_mixed_stage_or_unknown_section(self) -> None:
        rule = self.policy["rules"]["KR-061"]
        self.assertEqual(_source_gate(rule, "RD_ID_MIXED", "KR"), "INELIGIBLE_STAGE")
        self.assertEqual(_source_gate(rule, "RD", "OTHER"), "INELIGIBLE_MANIFEST_SECTION")
        self.assertEqual(_source_gate(rule, "RD", "KR"), "DRAWING_SECTION_UNVERIFIED")
        pz = self.policy["rules"]["PZ-002"]
        self.assertEqual(_source_gate(pz, "PD", "OTHER"), "SECTION_UNRESOLVED")

    def test_tampered_selected_line_fails_closed(self) -> None:
        self.evidence["lines"] = self.lines[:-1]
        with self.assertRaisesRegex(ValueError, "role differs"):
            self._observe()


if __name__ == "__main__":
    unittest.main()
