from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.numeric_family_candidates import (
    LABEL_PACK_PATH, NUMERIC_FAMILIES, NumericFamilyCandidateError,
    _hash, extract_indexed_numeric_family_candidates, load_numeric_family_labels,
)
from inspector_worker.public_document_index import build_public_index


class NumericFamilyCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.evidence = {
            "schemaVersion": "indexed-page-evidence-v1", "candidateStatus": "CANDIDATE",
            "manifestSha256": "a" * 64, "indexVersionHash": "1" * 20,
            "qualityPolicyVersion": "test", "sourceFileId": "F0001",
            "objectId": "OBJ-1", "stage": "PD", "section": "KR",
            "sourceSha256": "b" * 64, "sourceRelativePath": "plan.pdf",
            "pageNumber": 1, "pageArtifactSha256": "c" * 64,
            "parserProvenance": "pdfminer", "coordinateSystem": "PDF_POINTS_TOP_LEFT",
            "widthMilliPoints": 100000, "heightMilliPoints": 100000,
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "selectedBlockIndices": [0], "blocks": [], "lines": [],
            "sectionCandidates": [], "tableRowCandidates": [],
        }
        self._lines("Толщина несущей монолитной стены: 220 мм")

    def _lines(self, *texts: str) -> None:
        self.evidence["lines"] = [
            {"blockIndex": 0, "lineIndex": number, "text": text,
             "bboxMilliPoints": [1000, 1000 + number * 5000, 90000, 4000 + number * 5000]}
            for number, text in enumerate(texts)
        ]
        unsigned = {key: value for key, value in self.evidence.items()
                    if key != "evidenceSha256"}
        self.evidence["evidenceSha256"] = _hash(unsigned)

    def _extract(self, code: str = "KR-061", *, drawing: str = "KR",
                 resolution: dict | None = None,
                 drawing_proof: dict | None = None) -> list[dict]:
        with patch("inspector_worker.numeric_family_candidates.load_indexed_page_evidence",
                   return_value=self.evidence) as load:
            result = extract_indexed_numeric_family_candidates(
                self.manifest, self.index, "F0001", 1, expected_object_id="OBJ-1",
                expected_stage=self.evidence["stage"],
                expected_section=self.evidence["section"], block_indices=[0],
                parameter_code=code, drawing_section=drawing,
                section_resolution=resolution, drawing_section_proof=drawing_proof)
        load.assert_called_once()
        return result

    def test_label_policy_covers_every_numeric_code_and_attribute(self) -> None:
        labels = load_numeric_family_labels()
        rules = [rule for rule in load_candidate_family_pack()["rules"]
                 if rule["family"] in NUMERIC_FAMILIES]
        self.assertEqual(len(rules), 31)
        self.assertEqual(sum(len(rule["attributes"]) for rule in rules), 35)
        self.assertEqual({item["parameterCode"] for item in labels["entries"]},
                         {rule["parameterCode"] for rule in rules})
        for entry in labels["entries"]:
            rule = next(rule for rule in rules if rule["parameterCode"] == entry["parameterCode"])
            self.assertEqual({(item["key"], item["canonicalUnit"])
                              for item in entry["attributes"]},
                             {(item["key"], item["canonicalUnit"])
                              for item in rule["attributes"]})
            for item in entry["attributes"]:
                self.assertTrue(item["labels"])
                self.assertTrue(item["unitAliases"])

    def test_every_numeric_attribute_has_exact_literal_extraction_path(self) -> None:
        policy = load_numeric_family_labels()
        for entry in policy["entries"]:
            rule = policy["rules"][entry["parameterCode"]]
            drawing = rule["requiredExpectedDrawingSections"][0]
            section = (rule["requiredExpectedSections"][0]
                       if rule["manifestSectionStatus"]["expected"] == "EXACT_CATEGORY"
                       else "OTHER")
            for attribute in entry["attributes"]:
                with self.subTest(code=entry["parameterCode"], attribute=attribute["key"]):
                    self.evidence["stage"] = "PD"
                    self.evidence["section"] = section
                    self._lines(f'{attribute["labels"][0]}: 220 {attribute["unitAliases"][0]}')
                    resolution = (None if section != "OTHER" else {
                        "status": "VERIFIED", "reference": "review:source-section",
                        "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                        "manifestSha256": "a" * 64, "stage": "PD",
                        "manifestSection": section, "drawingSection": drawing})
                    drawing_proof = (None if section == "OTHER" or drawing == section else {
                        "status": "VERIFIED", "reference": "review:drawing-mark",
                        "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                        "manifestSha256": "a" * 64, "stage": "PD",
                        "manifestSection": section, "drawingSection": drawing})
                    found = self._extract(entry["parameterCode"], drawing=drawing,
                                          resolution=resolution, drawing_proof=drawing_proof)
                    self.assertEqual(len(found), 1)
                    self.assertEqual(found[0]["attribute"], attribute["key"])
                    self.assertEqual(found[0]["rawUnit"], attribute["unitAliases"][0])

    def test_exact_candidate_is_bound_to_public_page_line_and_rule(self) -> None:
        result = self._extract()
        self.assertEqual(len(result), 1)
        candidate = result[0]
        self.assertEqual((candidate["parameterCode"], candidate["attribute"],
                          candidate["rawValue"], candidate["rawUnit"]),
                         ("KR-061", "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS", "220", "мм"))
        self.assertEqual(candidate["pageEvidenceSha256"], self.evidence["evidenceSha256"])
        self.assertEqual(candidate["sourceSha256"], self.evidence["sourceSha256"])
        self.assertEqual(candidate["pageArtifactSha256"], self.evidence["pageArtifactSha256"])
        self.assertEqual(candidate["candidateSha256"], _hash({key: value for key, value in
                           candidate.items() if key != "candidateSha256"}))
        self.assertEqual(candidate["executionPolicy"], "NON_EXECUTING_ABSTAIN")
        self.assertNotIn("finding", candidate)
        self.assertNotIn("coverage", candidate)
        self.assertNotIn("entityId", candidate)

    def test_multiple_values_for_same_attribute_abstain(self) -> None:
        self._lines("Толщина несущей монолитной стены: 220 мм",
                    "Толщина несущей монолитной стены: 240 мм")
        self.assertEqual(self._extract(), [])

    def test_multicolumn_and_wrong_unit_abstain(self) -> None:
        self._lines("Толщина несущей монолитной стены: 220 мм, 240 мм",
                    "Толщина несущей монолитной стены: 22 см",
                    "Толщина несущей монолитной стены: -220 мм")
        self.assertEqual(self._extract(), [])

    def test_wrong_drawing_section_or_manifest_section_abstains(self) -> None:
        with self.assertRaisesRegex(NumericFamilyCandidateError, "drawing section"):
            self._extract(drawing="AR")
        self.evidence["section"] = "AR"
        self._lines("Толщина несущей монолитной стены: 220 мм")
        with self.assertRaisesRegex(NumericFamilyCandidateError, "manifest section"):
            self._extract()

    def test_unmapped_manifest_section_requires_source_bound_resolution(self) -> None:
        self.evidence["section"] = "OTHER"
        self._lines("Общая площадь здания: 1200 м²")
        with self.assertRaisesRegex(NumericFamilyCandidateError, "resolution required"):
            self._extract("PZ-002", drawing="PZ")
        proof = {"status": "VERIFIED", "reference": "review:sheet-1",
                 "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                 "manifestSha256": "a" * 64, "stage": "PD",
                 "manifestSection": "OTHER", "drawingSection": "PZ"}
        self.assertEqual(len(self._extract("PZ-002", drawing="PZ", resolution=proof)), 1)
        proof["sourceSha256"] = "d" * 64
        with self.assertRaisesRegex(NumericFamilyCandidateError, "resolution required"):
            self._extract("PZ-002", drawing="PZ", resolution=proof)

    def test_rule_stage_and_actual_drawing_mark_are_checked(self) -> None:
        self.evidence["stage"] = "RD"
        self._lines("Толщина несущей монолитной стены: 220 мм")
        with self.assertRaisesRegex(NumericFamilyCandidateError, "drawing section"):
            self._extract(drawing="KR")
        with self.assertRaisesRegex(NumericFamilyCandidateError, "drawing mark proof"):
            self._extract(drawing="KJ")
        proof = {"status": "VERIFIED", "reference": "review:kj-title",
                 "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                 "manifestSha256": "a" * 64, "stage": "RD",
                 "manifestSection": "KR", "drawingSection": "KJ"}
        self.assertEqual(len(self._extract(drawing="KJ", drawing_proof=proof)), 1)
        proof["sourceFileId"] = "F0002"
        with self.assertRaisesRegex(NumericFamilyCandidateError, "drawing mark proof"):
            self._extract(drawing="KJ", drawing_proof=proof)
        self.evidence["stage"] = "ID"
        self._lines("Толщина несущей монолитной стены: 220 мм")
        with self.assertRaisesRegex(NumericFamilyCandidateError, "stage"):
            self._extract(drawing="KJ")

    def test_tampered_page_evidence_hash_abstains(self) -> None:
        self.evidence["evidenceSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "page evidence hash mismatch"):
            self._extract()

    def test_missing_or_drifted_label_policy_fails_closed(self) -> None:
        source = json.loads(LABEL_PACK_PATH.read_text())
        for edit in (lambda value: value["entries"].pop(),
                     lambda value: value["entries"][0]["attributes"][0]["unitAliases"].append("cm"),
                     lambda value: value.update(catalogSha256="0" * 64)):
            modified = json.loads(json.dumps(source))
            edit(modified)
            path = self.root / "labels.json"
            path.write_text(json.dumps(modified))
            with self.assertRaises(NumericFamilyCandidateError):
                load_numeric_family_labels(path)
        with self.assertRaises(NumericFamilyCandidateError):
            load_numeric_family_labels(self.root / "missing.json")

    def test_public_verified_aliases_are_syntactic_and_sha_bound(self) -> None:
        policy = load_numeric_family_labels()
        self.assertEqual(len(policy["verifiedAliasEvidence"]), 3)
        self.assertEqual(sum(len(item["samples"]) for item in policy["verifiedAliasEvidence"]), 4)
        self.assertEqual(policy["publicManifestSha256"],
                         "853225daec1888fbed19bbeb45e958154135f069799cea883dcd3c754c6c4ee7")
        raw = json.loads(LABEL_PACK_PATH.read_text())
        for mutation in (lambda value: value["verifiedAliasEvidence"][0]["samples"][0]
                         .update(lineTextSha256="0" * 64),
                         lambda value: value["verifiedAliasEvidence"][0]["samples"][0]
                         .update(sourceGate="SECTION_UNRESOLVED"),
                         lambda value: value["verifiedAliasEvidence"][1]
                         .update(label="Высота несуществующего объекта")):
            changed = json.loads(json.dumps(raw))
            mutation(changed)
            path = self.root / "aliases.json"
            path.write_text(json.dumps(changed))
            with self.assertRaises(NumericFamilyCandidateError):
                load_numeric_family_labels(path)

    def test_public_alias_grammar_requires_explicit_source_resolution(self) -> None:
        self.evidence["section"] = "OTHER"
        cases = (
            ("PZ-002", "PZ", "Общая площадь здания S=11030,3 кв.м;", "11030,3", "кв.м"),
            ("PZ-008", "PZ", "Высота здания h=73.6м", "73.6", "м"),
            ("SPZU-024", "SPZU", "Объем выемки грунта (геометрический): 19060 м3.",
             "19060", "м3"),
        )
        for code, drawing, line, value, unit in cases:
            with self.subTest(code=code):
                self._lines(line)
                with self.assertRaisesRegex(NumericFamilyCandidateError, "resolution required"):
                    self._extract(code, drawing=drawing)
                proof = {"status": "VERIFIED", "reference": "review:source-section",
                         "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                         "manifestSha256": "a" * 64, "stage": "PD",
                         "manifestSection": "OTHER", "drawingSection": drawing}
                found = self._extract(code, drawing=drawing, resolution=proof)
                self.assertEqual(len(found), 1)
                self.assertEqual((found[0]["rawValue"], found[0]["rawUnit"]), (value, unit))

    @requires_posix_storage
    def test_real_public_index_adapter_and_source_sha(self) -> None:
        materials = self.root / "materials"
        materials.mkdir()
        pdf = materials / "plan.pdf"
        document = fitz.open()
        page = document.new_page()
        for line_number, line in enumerate((
                "Wall thickness: 220 mm", "Wall thickness: 220 cm",
                "Other material: 310 mm", "Drawing specification text")):
            page.insert_text((60, 70 + line_number * 28), line)
        document.save(pdf)
        document.close()
        row = {"file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
               "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
               "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
               "extension": ".pdf", "size_bytes": pdf.stat().st_size,
               "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pdf_pages": 1}
        self.manifest.write_text(json.dumps(row) + "\n")
        build_public_index(self.manifest, self.index, materials_root=materials)
        labels = json.loads(LABEL_PACK_PATH.read_text())
        kr = next(entry for entry in labels["entries"] if entry["parameterCode"] == "KR-061")
        kr["attributes"][0]["labels"] = ["Wall thickness"]
        kr["attributes"][0]["unitAliases"] = ["mm"]
        policy = self.root / "labels.json"
        policy.write_text(json.dumps(labels))
        results = extract_indexed_numeric_family_candidates(
            self.manifest, self.index, "F0001", 1, expected_object_id="OBJ-1",
            expected_stage="PD", expected_section="KR", block_indices=[0, 1, 2, 3],
            parameter_code="KR-061", drawing_section="KR", label_pack_path=policy)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["rawValue"], "220")
        self.assertEqual(results[0]["sourceSha256"], row["sha256"])
        self.assertEqual(results[0]["locator"]["kind"], "INDEXED_LINE")


if __name__ == "__main__":
    unittest.main()
