"""FTS selection must cover literal labels before SHA-checked row inspection."""

from __future__ import annotations

import importlib.util
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path

from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.numeric_family_table_rows import _definitions
from inspector_worker.numeric_table_row_candidates import load_numeric_table_policy


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "probe-public-numeric-family-tables-fts.py"
SPEC = importlib.util.spec_from_file_location("numeric_family_table_fts", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NumericFamilyTableFtsTests(unittest.TestCase):
    def test_every_pinned_label_has_bounded_fts_phrase(self) -> None:
        definitions = _definitions(load_numeric_family_labels(), load_numeric_table_policy())
        self.assertEqual(len(definitions), 54)
        for definition in definitions:
            with self.subTest(label=definition["label"]):
                phrase = MODULE.fts_literal_phrase(definition["label"])
                self.assertTrue(phrase.startswith('"') and phrase.endswith('"'))
                self.assertGreater(len(phrase), 2)

    def test_fts_is_a_superset_of_literal_table_labels(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("CREATE VIRTUAL TABLE page_fts USING fts5(text)")
            connection.executemany("INSERT INTO page_fts(text) VALUES (?)", [
                ("Общая площадь здания, в т.ч.:",),
                ("Высота здания",),
                ("Совсем другая величина",),
            ])
            area = list(connection.execute(
                "SELECT rowid FROM page_fts WHERE page_fts MATCH ?",
                (MODULE.fts_literal_phrase("Общая площадь здания, в т.ч.:"),),
            ))
            height = list(connection.execute(
                "SELECT rowid FROM page_fts WHERE page_fts MATCH ?",
                (MODULE.fts_literal_phrase("Высота здания"),),
            ))
        self.assertEqual(area, [(1,)])
        self.assertEqual(height, [(2,)])

    def test_unbounded_or_empty_phrase_fails_closed(self) -> None:
        for bad in ("___", " ", "слово " * 25):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                MODULE.fts_literal_phrase(bad)


if __name__ == "__main__":
    unittest.main()
