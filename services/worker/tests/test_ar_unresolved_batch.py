from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.ar_unresolved_batch import (
    AR_CODES, ArUnresolvedBatchError, _audit, _checked_page, _matched_patterns,
    _role, _valid_row,
)


class ArUnresolvedBatchTests(unittest.TestCase):
    def test_nine_ar_triggers_are_code_specific(self) -> None:
        self.assertEqual(len(AR_CODES), 9)
        self.assertTrue(_matched_patterns("AR-044", "Пароизоляция кровли предусмотрена"))
        self.assertFalse(_matched_patterns("AR-044", "Пароизоляция пола предусмотрена"))
        self.assertFalse(_matched_patterns("AR-044", "Ограждение кровли многослойным стеклом"))
        self.assertTrue(_matched_patterns("AR-045", "Уклон кровли 2 %"))
        self.assertFalse(_matched_patterns("AR-045", "Уклон дороги 2 %"))
        self.assertTrue(_matched_patterns("AR-048", "Высота подступенка 150 мм"))
        self.assertFalse(_matched_patterns("AR-048", "Высота здания 15 м"))
        self.assertFalse(_matched_patterns("AR-048", "Лестничные марши типовые"))
        self.assertTrue(_matched_patterns("AR-051", "Расчет КЕО"))
        self.assertFalse(_matched_patterns("AR-052", "Цвет стен указан"))

    def test_table_row_needs_exact_line_and_geometry(self) -> None:
        line = {"blockIndex": 2, "lineIndex": 1, "text": "Лестничный марш",
                "bboxMilliPoints": [100, 200, 500, 220]}
        row = {**line, "kind": "TABLE_ROW_CANDIDATE", "status": "CANDIDATE"}
        page = {"widthMilliPoints": 600, "heightMilliPoints": 800}
        self.assertTrue(_valid_row(row, page, {(2, 1): line}))
        self.assertFalse(_valid_row({**row, "text": "Другая строка"}, page, {(2, 1): line}))
        self.assertFalse(_valid_row({**row, "bboxMilliPoints": [100, 200, 601, 220]}, page, {(2, 1): line}))
        self.assertFalse(_valid_row(row, page, {}))

    def test_manifest_role_does_not_infer_ar_from_other(self) -> None:
        self.assertEqual(_role({"stage": "PD", "section": "AR"}), "PD_AR_EXACT_MANIFEST")
        self.assertEqual(_role({"stage": "RD", "section": "OTHER"}), "RD_SECTION_UNRESOLVED")
        self.assertEqual(_role({"stage": "RD_ID_MIXED", "section": "OTHER"}), "MIXED_STAGE_SECTION_UNRESOLVED")
        self.assertEqual(_role({"stage": "ID", "section": "OTHER"}), "INELIGIBLE_MANIFEST_ROLE")

    def test_page_artifact_sha_and_source_binding(self) -> None:
        source_sha = "a" * 64
        page = {
            "schemaVersion": "public-document-index-v1",
            "inputSha256": source_sha,
            "pageNumber": 1,
            "indexVersionHash": "5f599fc405acfbf9d858",
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "lines": [], "tableRowCandidates": [],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "pages" / "first.json.gz"
            path.parent.mkdir()
            data = gzip.compress(json.dumps(page).encode())
            path.write_bytes(data)
            record = {"artifact_path": "pages/first.json.gz", "artifact_sha256": hashlib.sha256(data).hexdigest(),
                      "page_number": 1, "disposition": "TEXT_LAYER_CANDIDATE"}
            self.assertEqual(_checked_page(root, record, {"sha256": source_sha}), page)
            with self.assertRaisesRegex(ArUnresolvedBatchError, "SHA mismatch"):
                _checked_page(root, {**record, "artifact_sha256": "0" * 64}, {"sha256": source_sha})
            with self.assertRaisesRegex(ArUnresolvedBatchError, "metadata"):
                _checked_page(root, record, {"sha256": "b" * 64})

    def test_incomplete_index_audit_rejected(self) -> None:
        audit = {"schemaVersion": "public-document-index-audit-v1", "status": "PASS",
                 "findings": [], "findingCount": 0, "fatalFindingCount": 0,
                 "manifestSha256": "a" * 64, "indexVersionHash": "5f599fc405acfbf9d858",
                 "actual": {"sourceCount": 203, "completePdfSources": 202,
                            "indexedPages": 10142, "ftsRows": 10142,
                            "verifiedPageArtifacts": 10141}}
        with self.assertRaisesRegex(ArUnresolvedBatchError, "incomplete"):
            _audit(audit, "a" * 64)


if __name__ == "__main__":
    unittest.main()
