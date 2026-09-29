"""Fail-closed tests for bounded POD/OOS public PDF research leads."""

from __future__ import annotations

import sqlite3
import unittest

from inspector_worker.pod_oos_unresolved_batch import (
    CODES, OCR_PROPOSAL_CAP, PAGE_CAP_PER_CODE, _ocr_inventory, _source_role,
    classify_line, select_addresses,
)


class PodOosUnresolvedBatchTests(unittest.TestCase):
    def test_exact_nine_code_inventory(self) -> None:
        self.assertEqual(CODES, ("POD-090", "POD-091", "POD-094", "POD-096",
                                 "POD-097", "OOS-098", "OOS-099", "OOS-100", "OOS-101"))

    def test_word_boundary_prevents_snos_in_safety_and_lom_in_other_word(self) -> None:
        self.assertIsNone(classify_line("POD-090", "мероприятия по пожарной безопасности"))
        self.assertIsNone(classify_line("POD-097", "принадлежность жилому дому"))
        self.assertEqual(classify_line("POD-090", "Снос существующих зданий"),
                         "NEAR_TOPIC_MENTION")

    def test_demolition_and_waste_are_only_lexical_anchors(self) -> None:
        self.assertEqual(classify_line("POD-091", "метод демонтажа конструкций"),
                         "EXACT_LEXICAL_ANCHOR")
        self.assertEqual(classify_line("POD-094", "отходов V класса опасности"),
                         "EXACT_LEXICAL_ANCHOR")
        self.assertEqual(classify_line("POD-096", "временные подпорки"),
                         "EXACT_LEXICAL_ANCHOR")
        self.assertEqual(classify_line("POD-097", "строительный мусор"),
                         "NEAR_TOPIC_MENTION")

    def test_external_system_names_never_mean_event_proof(self) -> None:
        for code, line in (("OOS-098", "разрешение в АИС ОСИГ"),
                           ("OOS-099", "передача ГЛОНАСС"),
                           ("OOS-100", "Мобильный КПТС"),
                           ("OOS-101", "ГРОО")):
            with self.subTest(code=code):
                self.assertEqual(classify_line(code, line), "EXACT_LEXICAL_ANCHOR")

    def test_unknown_code_fails(self) -> None:
        with self.assertRaises(ValueError):
            classify_line("POD-092", "снос")

    def test_source_role_requires_manifest_category(self) -> None:
        self.assertEqual(_source_role({"file_id": "F0114", "section": "OTHER"}),
                         "OOS_FILENAME_HINT_ONLY")
        self.assertEqual(_source_role({"file_id": "F0105", "section": "KR"}),
                         "MANIFEST_SECTION_UNRESOLVED_OR_OTHER")
        self.assertEqual(_source_role({"file_id": "F0114", "section": "OOS"}),
                         "EXACT_MANIFEST_SECTION")

    def test_source_diverse_cap_and_truncation_basis(self) -> None:
        hits = {(sid, page): {'"отходы"'} for sid in ("F0114", "F0189")
                for page in range(1, 12)}
        rows = {sid: {"stage": "PD"} for sid in ("F0114", "F0189")}
        selected = select_addresses(hits, rows, "OOS-101", cap=6)
        self.assertEqual(len(selected), 6)
        self.assertEqual(len(set(selected)), 6)
        self.assertIn("F0114", {sid for sid, _ in selected})
        self.assertIn("F0189", {sid for sid, _ in selected})
        self.assertGreater(len(hits) - len(selected), 0)
        self.assertEqual(PAGE_CAP_PER_CODE, 16)

    def test_ocr_requires_adjacent_specific_target_anchor(self) -> None:
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE pages (source_id TEXT,page_number INTEGER,"
                           "source_sha256 TEXT,artifact_sha256 TEXT,disposition TEXT)")
        for page in (5, 6, 20):
            connection.execute("INSERT INTO pages VALUES (?,?,?,?,?)",
                               ("F0114", page, "a" * 64, "b" * 64, "OCR_REQUIRED"))
        rows = {sid: {"sha256": "a" * 64} for sid in
                ("F0114", "F0115", "F0189", "F0190", "F0191", "F0192")}
        no_anchor = _ocr_inventory(connection, rows, set())
        self.assertEqual(no_anchor["proposals"], [])
        self.assertEqual(no_anchor["deferredPages"], 3)
        near_anchor = _ocr_inventory(connection, rows, {("F0114", 4)})
        self.assertEqual([x["pageNumber"] for x in near_anchor["proposals"]], [5, 6])
        self.assertEqual(near_anchor["deferredPages"], 1)
        self.assertEqual(OCR_PROPOSAL_CAP, 8)
        connection.close()


if __name__ == "__main__":
    unittest.main()
