"""POD-094 public original and adversarial table navigation checks."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import unittest

from inspector_worker.pod094_waste_chain_proposals import (
    _contract_proposals, _proposal, evaluate_pod094_waste_chain_proposals,
)


MANIFEST = (Path(__file__).parents[3] / "datasets/reference_methodology/"
            "hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl")
PDF_PATHS = {"F0189": os.environ.get("INSPECTOR_PUBLIC_F0189_PDF"),
             "F0071": os.environ.get("INSPECTOR_PUBLIC_F0071_PDF")}
SHAS = {"F0189": "eae7d1997b49d2302d20d66483f9490ca3fb5e2bb7b465329d9518563e95c7cd",
        "F0071": "a314d845fcb58fc6ac1502fc1fb1672562f419ed36cc8ead88327d374817d327"}


def _record(file_id: str) -> dict:
    return next(value for value in map(json.loads, MANIFEST.read_text().splitlines())
                if value["file_id"] == file_id)


def _word(index: int, text: str, x: int, y: int) -> dict:
    return {"pageNumber": 5, "wordIndex": index, "rawText": text,
            "wordTextSha256": hashlib.sha256(text.encode()).hexdigest(),
            "bboxMilliPointsTopLeft": [x, y, x + 10000, y + 10000]}


class Pod094WasteChainProposalTests(unittest.TestCase):
    def test_quantity_slots_keep_contract_and_actual_distinct(self) -> None:
        quantity = [_word(1, "350,00", 420000, 580000)]
        proposal = _proposal("CONTRACT_ORIENTATIVE_CANDIDATE", {"quantity": quantity},
                             reason_codes=[])
        self.assertEqual(proposal["quantitySlots"], {
            "estimate": None, "contractLimit": None,
            "contractOrientative": "350,00", "actualTransfer": None})
        self.assertIsNone(proposal["typedValues"])
        self.assertIsNone(proposal["batchIdentity"])

    def test_ambiguous_contract_row_and_unit_fail_closed(self) -> None:
        entries = [("Ориентировочный", 388000, 513000), ("(тонн)", 441000, 551000),
                   ("Лом", 97000, 567000), ("железобетонных", 120000, 567000),
                   ("изделий,", 97000, 579000), ("V", 250000, 580000),
                   ("8", 295000, 579000), ("22", 304000, 579000),
                   ("301", 318000, 579000), ("01", 337000, 579000),
                   ("21", 351000, 579000), ("5", 365000, 579000),
                   ("350,00", 420000, 579000), ("55,00", 511000, 585000)]
        words = [_word(index, *entry) for index, entry in enumerate(entries)]
        proposals, reasons = _contract_proposals(words)
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["quantityRaw"], "350,00")
        self.assertEqual(proposals[0]["roles"]["excludedPriceCell"][0]["rawText"], "55,00")
        duplicate = words + [_word(99, "351,00", 430000, 579000)]
        self.assertEqual(_contract_proposals(duplicate), ([], ["CONTRACT_ROW_OR_UNIT_AMBIGUOUS"]))
        self.assertEqual(_contract_proposals([w for w in words if w["rawText"] != "(тонн)"]),
                         ([], ["CONTRACT_ROW_OR_UNIT_AMBIGUOUS"]))

    @unittest.skipUnless(all(PDF_PATHS.values()), "audited original public PDFs unavailable")
    def test_originals_produce_three_source_local_review_proposals(self) -> None:
        outputs = {}
        for file_id, path in PDF_PATHS.items():
            record = _record(file_id)
            self.assertEqual((record["split"], record["distribution_status"],
                              record["label_visibility"]),
                             ("TRAIN_PUBLIC", "INCLUDE", "PUBLIC_TRAIN"))
            self.assertEqual(hashlib.sha256(Path(path).read_bytes()).hexdigest(), SHAS[file_id])
            output = evaluate_pod094_waste_chain_proposals(Path(path), record)
            outputs[file_id] = output
            self.assertEqual((output["status"], output["typedFact"], output["findingCount"],
                              output["parameterCoverage"], output["actualTransfer"],
                              output["contractLimit"]),
                             ("ABSTAIN", None, None, None, None, None))
            self.assertEqual(output["sourceSha256"], SHAS[file_id])
            self.assertTrue(all(p["typedValues"] is None and p["batchIdentity"] is None
                                and p["quantitySlots"]["actualTransfer"] is None
                                for p in output["proposals"]))
        pd = outputs["F0189"]
        contract = outputs["F0071"]
        self.assertNotEqual(pd["objectId"], contract["objectId"])
        self.assertEqual(pd["proposalCount"], 2)
        self.assertEqual([(p["quantityRaw"], p["hazardClassRaw"], p["fkkoRaw"])
                          for p in pd["proposals"]], [
            ("259,875", "(4 класс опасности)", "8 90 000 01 72 4"),
            ("28,875", "(5 класс опасности)", "4 61 010 01 20 5")])
        self.assertEqual(contract["proposalCount"], 1)
        row = contract["proposals"][0]
        self.assertEqual((row["quantityRaw"], row["hazardClassRaw"], row["fkkoRaw"]),
                         ("350,00", "V", "8 22 301 01 21 5"))
        self.assertIsNone(row["quantitySlots"]["contractLimit"])
        self.assertIn("ORIENTATIVE_QUANTITY_NOT_BINDING_LIMIT", row["reasonCodes"])
        self.assertIn("LOWER_TABLE_ROWS_DEFERRED_AMBIGUOUS_CLASS_AND_UNITS", pd["reasonCodes"])

    @unittest.skipUnless(PDF_PATHS["F0071"], "audited original public F0071 unavailable")
    def test_hidden_manifest_tamper_and_source_identity_rejected(self) -> None:
        path = Path(PDF_PATHS["F0071"])
        source = _record("F0071")
        with self.assertRaisesRegex(ValueError, "not permitted"):
            evaluate_pod094_waste_chain_proposals(path, {**source, "split": "TEST_HIDDEN"})
        with self.assertRaisesRegex(ValueError, "manifest identity"):
            evaluate_pod094_waste_chain_proposals(path, {**source, "sha256": "0" * 64})
        with self.assertRaisesRegex(ValueError, "manifest identity"):
            evaluate_pod094_waste_chain_proposals(path, {**source, "object_id": "OBJ-OTHER"})
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            evaluate_pod094_waste_chain_proposals(path, {**source, "size_bytes": 1})
        with self.assertRaisesRegex(ValueError, "not an audited"):
            evaluate_pod094_waste_chain_proposals(path, {**source, "file_id": "F0114"})


if __name__ == "__main__":
    unittest.main()
