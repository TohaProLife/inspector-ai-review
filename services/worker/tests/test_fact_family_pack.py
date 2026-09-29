"""Pinned policy tests for review-only fact families."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from inspector_worker.fact_family_pack import (
    CATALOG_PATH, PACK_PATH, SELECTED_CODES, load_fact_family_pack, rules_for_object,
)


class FactFamilyPackTests(unittest.TestCase):
    def test_pack_binds_five_codes_and_preserves_catalog_triggers(self) -> None:
        pack = load_fact_family_pack()
        rules = rules_for_object("OBJ-A", pack)
        self.assertEqual({rule["parameterCode"] for rule in rules}, SELECTED_CODES)
        self.assertTrue(all(rule["objectId"] == "OBJ-A" for rule in rules))
        self.assertEqual(len(pack["packSha256"]), 64)
        self.assertIn("Уменьшение", pack["catalogRows"]["KR-059"]["trigger"])
        self.assertEqual(pack["disposition"], "REVIEW_ONLY")
        self.assertTrue(all(rule["requiredContext"] for rule in rules))

    def test_changed_catalog_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "catalog.jsonl"
            path.write_bytes(CATALOG_PATH.read_bytes() + b"\n")
            with self.assertRaisesRegex(ValueError, "catalog SHA-256"):
                load_fact_family_pack(path)

    def test_missing_duplicate_or_promoted_rule_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "pack.json"
            base = json.loads(PACK_PATH.read_text(encoding="utf-8"))
            for mutation in (
                lambda value: value["rules"].pop(),
                lambda value: value["rules"].append(value["rules"][0].copy()),
                lambda value: value.update(disposition="FINDING_READY"),
            ):
                changed = json.loads(json.dumps(base))
                mutation(changed)
                path.write_text(json.dumps(changed), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_fact_family_pack(pack_path=path)

    def test_object_binding_requires_scope(self) -> None:
        pack = load_fact_family_pack()
        with self.assertRaisesRegex(ValueError, "objectId"):
            rules_for_object(" ", pack)
        self.assertEqual(load_fact_family_pack()["packSha256"], pack["packSha256"])


if __name__ == "__main__":
    unittest.main()
