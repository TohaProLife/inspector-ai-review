"""POS lexical batching must preserve every unresolved proof gate."""

from __future__ import annotations

import unittest

from inspector_worker.pos_unresolved_batch import (
    AMBIGUITY, OCR_BUDGET, POS_CODES, _ocr_proposals, _source_roles, _strategy_entries,
    classify_line,
)


class PosUnresolvedBatchTests(unittest.TestCase):
    def test_six_code_inventory(self) -> None:
        self.assertEqual(POS_CODES, ("POS-081", "POS-083", "POS-084",
                                     "POS-085", "POS-087", "POS-089"))
        self.assertEqual(set(AMBIGUITY), set(POS_CODES))
        self.assertTrue(all(set(row) == {"scope", "phase", "component", "quantity", "norm"}
                            for row in AMBIGUITY.values()))

    def test_explicit_crane_zone_line_is_lexical_only(self) -> None:
        self.assertEqual(classify_line("POS-081", "по границе опасной зоны на период работы крана"),
                         "EXACT_LEXICAL_ANCHOR")
        self.assertIsNone(classify_line("POS-081", "кран шаровый Ду=50 мм"))

    def test_road_width_and_bare_number(self) -> None:
        self.assertEqual(classify_line("POS-084", "устройство временных дорог шириной 6.0 м"),
                         "EXACT_LEXICAL_ANCHOR")
        self.assertIsNone(classify_line("POS-084", "3,50"))

    def test_other_pos_topics_and_negative_mention(self) -> None:
        lines = {
            "POS-083": "экспликация временных зданий и сооружений",
            "POS-085": "Складирование материалов на перекрытиях",
            "POS-087": "Технологическая последовательность работ",
            "POS-089": "Нет мойки колес на выезде",
        }
        for code, line in lines.items():
            with self.subTest(code=code):
                self.assertEqual(classify_line(code, line), "EXACT_LEXICAL_ANCHOR")

    def test_broad_protection_zone_is_near_not_temporary_building_proof(self) -> None:
        self.assertEqual(classify_line("POS-083", "в охранной зоне кабелей"),
                         "NEAR_TOPIC_MENTION")

    def test_unrecognized_code_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            classify_line("POS-082", "кран")

    def test_source_role_requires_exact_rd_pos_for_same_object(self) -> None:
        rows = [
            {"file_id": "F0112", "object_id": "O1", "stage": "PD", "section": "POS", "extension": ".pdf"},
            {"file_id": "F0137", "object_id": "O1", "stage": "RD", "section": "OTHER", "extension": ".pdf"},
            {"file_id": "F0187", "object_id": "O2", "stage": "PD", "section": "POS", "extension": ".pdf"},
            {"file_id": "F0197", "object_id": "O2", "stage": "RD_ID_MIXED", "section": "OTHER", "extension": ".pdf"},
        ]
        role = _source_roles(rows)
        self.assertEqual(role["exactPairObjectCount"], 0)
        self.assertEqual(role["objects"][0]["rdOtherSourceIds"], ["F0137"])
        self.assertEqual(role["objects"][1]["mixedStageSourceIds"], ["F0197"])

    def test_ocr_queue_is_bounded_and_unread_pages_remain_unknown(self) -> None:
        rows = [{"sourceId": "F0112", "pageNumber": n,
                 "disposition": "OCR_REQUIRED", "artifactSha256": "a" * 64}
                for n in range(78, 83)]
        rows.extend({"sourceId": "F0187", "pageNumber": n,
                     "disposition": "OCR_REQUIRED", "artifactSha256": "b" * 64}
                    for n in range(71, 75))
        sources = {"F0112": {"sha256": "c" * 64}, "F0187": {"sha256": "d" * 64}}
        selected, deferred = _ocr_proposals(rows, sources)
        self.assertEqual(len(selected), OCR_BUDGET)
        self.assertEqual([item["pageNumber"] for item in selected], [78, 79, 80, 81, 82])
        self.assertEqual(deferred, 4)
        self.assertTrue(all(item["status"] == "OCR_PROPOSAL_ONLY" for item in selected))

    def test_strategy_requires_all_six_catalog_rows_and_proof_dependencies(self) -> None:
        strategy = {"schemaVersion": "unresolved-parameter-strategy-v1", "executionPolicy": "DESIGN_ONLY",
                    "catalogSha256": "a" * 64,
                    "entries": [{"parameterCode": code, "specificProofDependency": "geometry"}
                                for code in POS_CODES]}
        catalog = [{"parameter_code": code} for code in POS_CODES]
        self.assertEqual(set(_strategy_entries(strategy, catalog)), set(POS_CODES))
        strategy["entries"][0]["specificProofDependency"] = ""
        with self.assertRaises(ValueError):
            _strategy_entries(strategy, catalog)


if __name__ == "__main__":
    unittest.main()
