"""PZ-013 utility and title leads stay excluded from typed evidence."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.pz013_functional_capacity_proposals import (
    _locator, _spans, evaluate_pz013_functional_capacity_exclusions,
)

MANIFEST = Path("datasets/reference_methodology/hackathon_gold_20260811/"
                "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
F0148 = Path("/tmp/inspector-network-v3/F0148.pdf")
EXPECTED_SHA = "e4b188ce7f815a95dc7be708135943b6f6bdbfeb61422305ff2a2d6f59ca36bd"
F0203 = Path("/tmp/inspector-pz013-F0203-public.pdf")
F0203_SHA = "425680d836e5512ea3222a3331bc80b2b5e2433c52a6f8bd625024bdf9f103d7"


def _record(file_id: str) -> dict:
    return next(json.loads(line) for line in MANIFEST.read_text().splitlines()
                if json.loads(line).get("file_id") == file_id)


def _words(text: str) -> list[dict]:
    return [_locator(i, (i * 10, 0, i * 10 + 9, 9, item))
            for i, item in enumerate(text.split())]


class Pz013FunctionalCapacityTests(unittest.TestCase):
    def test_utility_contract_name_and_water_load_are_exclusions(self) -> None:
        words = _words("АО «Мосводоканал» Объект «Школа на 600 мест,» "
                       "Размер нагрузки в точках подключения 107,5 м3/сут.")
        found = _spans(words)
        self.assertEqual([(item["exclusionKind"], item["rawText"]) for item in found],
                         [("CAPACITY_IN_OBJECT_NAME", "«Школа на 600 мест,»"),
                          ("UTILITY_CONNECTION_LOAD", "107,5 м3/сут.")])
        self.assertTrue(all(item["typedFact"] is None and item["wordLocators"]
                            and item["basis"] for item in found))

    def test_no_context_or_other_capacity_not_excluded(self) -> None:
        self.assertEqual(_spans(_words("Школа на 600 мест 4,49 кВт")), [])
        found = _spans(_words("ТЕХНИЧЕСКИЕ УСЛОВИЯ электрических сетей "
                            "проектная вместимость 800 мест"))
        self.assertEqual(found, [])

    @unittest.skipUnless(MANIFEST.is_file() and F0148.is_file(),
                         "original permitted F0148 PDF unavailable")
    def test_original_f0148_page_167_sha_and_exclusions(self) -> None:
        record = _record("F0148")
        data = F0148.read_bytes()
        self.assertEqual((record["split"], record["distribution_status"],
                          record["label_visibility"], record["stage"], record["section"]),
                         ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", "PD", "OTHER"))
        self.assertEqual(record["sha256"], EXPECTED_SHA)
        self.assertEqual(hashlib.sha256(data).hexdigest(), EXPECTED_SHA)
        result = evaluate_pz013_functional_capacity_exclusions(data, record, 167)
        self.assertEqual((result["status"], result["typedFact"],
                          result["findingCount"], result["parameterCoverage"]),
                         ("ABSTAIN", None, None, None))
        self.assertEqual(result["exclusionCount"], 6)
        self.assertEqual([item["exclusionKind"] for item in result["exclusions"]],
                         ["CAPACITY_IN_OBJECT_NAME"] * 2 + ["UTILITY_CONNECTION_LOAD"] * 4)
        self.assertTrue(all(item["wordLocators"] and item["basis"]
                            for item in result["exclusions"]))
        self.assertIn("CURRENT_TX_CAPACITY_NOT_ESTABLISHED", result["reasonCodes"])

    @unittest.skipUnless(MANIFEST.is_file() and F0203.is_file(),
                         "original permitted F0203 PDF unavailable")
    def test_original_f0203_page_23_water_load(self) -> None:
        record = _record("F0203")
        data = F0203.read_bytes()
        self.assertEqual((record["split"], record["distribution_status"],
                          record["label_visibility"], record["stage"], record["section"]),
                         ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN", "RD_ID_MIXED", "OTHER"))
        self.assertEqual(record["sha256"], F0203_SHA)
        self.assertEqual(hashlib.sha256(data).hexdigest(), F0203_SHA)
        result = evaluate_pz013_functional_capacity_exclusions(data, record, 23)
        self.assertEqual((result["status"], result["typedFact"],
                          result["findingCount"], result["parameterCoverage"]),
                         ("ABSTAIN", None, None, None))
        self.assertEqual(result["exclusionCount"], 2)
        self.assertEqual([(item["exclusionKind"], item["rawText"])
                          for item in result["exclusions"]],
                         [("CAPACITY_IN_OBJECT_NAME", "«Школа на 600 мест,"),
                          ("UTILITY_CONNECTION_LOAD", "107,5 м3/сут.")])
        self.assertTrue(all(item["wordLocators"] and item["basis"]
                            for item in result["exclusions"]))

    @unittest.skipUnless(MANIFEST.is_file() and F0148.is_file(),
                         "original permitted F0148 PDF unavailable")
    def test_original_bytes_tamper_and_hidden_source_rejected(self) -> None:
        record = _record("F0148")
        data = F0148.read_bytes()
        with self.assertRaisesRegex(ValueError, "SHA mismatch"):
            evaluate_pz013_functional_capacity_exclusions(data + b"x", record, 167)
        hidden = copy.deepcopy(record)
        hidden["split"] = "TEST_HIDDEN"
        with self.assertRaisesRegex(ValueError, "not permitted public"):
            evaluate_pz013_functional_capacity_exclusions(data, hidden, 167)
        with self.assertRaisesRegex(ValueError, "page count mismatch"):
            evaluate_pz013_functional_capacity_exclusions(data, record, 467)


if __name__ == "__main__":
    unittest.main()
