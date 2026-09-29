from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.numeric_table_row_candidates import (
    TABLE_POLICY_PATH, NumericTableRowError, load_numeric_table_policy,
    observe_indexed_numeric_table_row,
)


class NumericTableRowCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "manifest.jsonl"
        self.source_sha = "a" * 64
        self.source = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "PD",
            "section": "OTHER", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "relative_path": "plan.pdf", "extension": ".pdf", "size_bytes": 100,
            "sha256": self.source_sha, "pdf_pages": 1,
        }
        self.manifest.write_text(json.dumps(self.source) + "\n")
        self.policy = load_numeric_table_policy()
        self.policy["publicManifestSha256"] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.lines = [
            self._line(19, 2, "Общая площадь здания, в т.ч.:",
                       [111740, 567388, 270050, 579388]),
            self._line(21, 0, "м ²", [343030, 568948, 360190, 580948]),
            self._line(20, 2, "11618,27", [406510, 567388, 454510, 579388]),
        ]
        self.page = {
            "indexVersionHash": "1" * 20,
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "lines": self.lines,
        }
        self.meta = {
            "source_id": "F0001", "object_id": "OBJ-1", "stage": "PD",
            "section": "OTHER", "source_sha256": self.source_sha,
            "relative_path": "plan.pdf", "status": "COMPLETE",
        }
        self.evidence = {
            "sourceSha256": self.source_sha,
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "indexVersionHash": "1" * 20,
            "pageArtifactSha256": "b" * 64,
            "evidenceSha256": "c" * 64,
            "coordinateSystem": "PDF_POINTS_BOTTOM_LEFT",
            "lines": self.lines,
        }

    @staticmethod
    def _line(block: int, index: int, text: str, bbox: list[int]) -> dict:
        return {"blockIndex": block, "lineIndex": index,
                "bboxMilliPoints": bbox, "text": text}

    def _observe(self) -> dict:
        with (patch("inspector_worker.numeric_table_row_candidates.load_numeric_table_policy",
                    return_value=self.policy),
              patch("inspector_worker.numeric_table_row_candidates.get_indexed_page",
                    return_value={"source": self.meta, "page": self.page}),
              patch("inspector_worker.numeric_table_row_candidates.load_indexed_page_evidence",
                    return_value=self.evidence) as selected):
            report = observe_indexed_numeric_table_row(
                self.manifest, self.root, "F0001", 1)
            if report["row"] is not None:
                selected.assert_called_once()
                self.assertEqual(selected.call_args.kwargs["block_indices"], [19, 20, 21])
            else:
                selected.assert_not_called()
        return report

    def test_real_policy_has_exact_sha_and_three_geometric_roles(self) -> None:
        policy = load_numeric_table_policy()
        sample = policy["verifiedSample"]
        self.assertEqual(sample["sourceFileId"], "F0150")
        self.assertEqual(sample["pageNumber"], 26)
        self.assertEqual(sample["sourceGate"], "SECTION_UNRESOLVED")
        self.assertEqual(sample["roles"]["value"]["text"], "11618,27")
        raw = json.loads(TABLE_POLICY_PATH.read_text())
        raw["verifiedSample"]["roles"]["value"]["lineTextSha256"] = "0" * 64
        path = self.root / "bad-policy.json"
        path.write_text(json.dumps(raw))
        with self.assertRaises(NumericTableRowError):
            load_numeric_table_policy(path)

    def test_exact_geometric_row_stays_review_only(self) -> None:
        report = self._observe()
        self.assertEqual(report["status"], "REVIEW_ONLY_ABSTAIN")
        self.assertEqual(report["reason"], "SOURCE_CONTEXT_UNRESOLVED")
        self.assertEqual(report["row"]["rawValue"], "11618,27")
        self.assertEqual(report["row"]["rawUnit"], "м ²")
        self.assertEqual(report["row"]["sourceGate"], "SECTION_UNRESOLVED")
        self.assertIn("DEFINITION_EQUIVALENCE_UNRESOLVED", report["row"]["reviewGates"])
        self.assertEqual(report["row"]["roles"]["label"]["bboxMilliPoints"],
                         [111740, 567388, 270050, 579388])
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertNotIn("comparison", report)
        self.assertNotIn("entityKey", report["row"])

    def test_missing_label_unsupported_unit_and_ambiguous_values_abstain(self) -> None:
        self.lines[0]["text"] = "Площадь квартиры"
        self.assertEqual(self._observe()["reason"], "NO_LITERAL_LABEL")
        self.lines[0]["text"] = self.policy["label"]
        self.lines[1]["text"] = "мм"
        self.assertEqual(self._observe()["reason"], "MISSING_OR_AMBIGUOUS_ROW_CELLS")
        self.lines[1]["text"] = self.policy["unit"]
        self.lines.append(self._line(22, 0, "12000,00", [470000, 567388, 520000, 579388]))
        self.assertEqual(self._observe()["reason"], "MISSING_OR_AMBIGUOUS_ROW_CELLS")
        self.lines.pop()
        self.lines.append(self._line(23, 0, self.policy["label"],
                                     [111740, 520000, 270050, 532000]))
        self.assertEqual(self._observe()["reason"], "MULTIPLE_LABEL_ROWS")

    def test_geometric_mismatch_abstains(self) -> None:
        self.lines[1]["bboxMilliPoints"] = [343030, 450000, 360190, 462000]
        self.assertEqual(self._observe()["reason"], "MISSING_OR_AMBIGUOUS_ROW_CELLS")

    def test_mixed_stage_never_becomes_a_usable_source(self) -> None:
        self.source["stage"] = "RD_ID_MIXED"
        self.manifest.write_text(json.dumps(self.source) + "\n")
        self.policy["publicManifestSha256"] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.meta["stage"] = "RD_ID_MIXED"
        report = self._observe()
        self.assertEqual(report["row"]["sourceGate"], "INELIGIBLE_STAGE")
        self.assertEqual(report["status"], "REVIEW_ONLY_ABSTAIN")

    def test_public_manifest_and_selected_page_sha_fail_closed(self) -> None:
        self.policy["publicManifestSha256"] = "0" * 64
        with self.assertRaisesRegex(NumericTableRowError, "manifest"):
            self._observe()
        self.policy["publicManifestSha256"] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.evidence["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(NumericTableRowError, "evidence changed"):
            self._observe()

    def test_ocr_page_and_non_public_source_do_not_yield_row(self) -> None:
        self.page["quality"]["disposition"] = "OCR_REQUIRED"
        self.assertEqual(self._observe()["reason"], "OCR_REQUIRED")
        self.source["split"] = "TEST_HIDDEN"
        self.manifest.write_text(json.dumps(self.source) + "\n")
        self.policy["publicManifestSha256"] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        with self.assertRaisesRegex(NumericTableRowError, "allowlist"):
            self._observe()


if __name__ == "__main__":
    unittest.main()
