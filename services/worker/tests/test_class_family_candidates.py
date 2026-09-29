from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.class_family_candidates import (
    LABEL_PACK_PATH, ClassFamilyCandidateError, _sha,
    class_line_pattern, extract_indexed_class_family_candidates,
    load_class_family_labels, matched_class_label,
)


class ClassFamilyCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.labels = load_class_family_labels()
        self.evidence = {
            "schemaVersion": "indexed-page-evidence-v1", "candidateStatus": "CANDIDATE",
            "manifestSha256": "a" * 64, "indexVersionHash": "1" * 20,
            "qualityPolicyVersion": "test", "sourceFileId": "F0001",
            "objectId": "OBJ-1", "stage": "RD", "section": "AR",
            "sourceSha256": "b" * 64, "sourceRelativePath": "plan.pdf",
            "pageNumber": 1, "pageArtifactSha256": "c" * 64,
            "parserProvenance": "pdfminer", "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "widthMilliPoints": 100000, "heightMilliPoints": 100000,
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "selectedBlockIndices": [0], "blocks": [], "lines": [],
            "sectionCandidates": [], "tableRowCandidates": [],
        }
        self._lines("Класс энергетической эффективности: A")

    def _entry(self, code: str) -> dict:
        return next(row for row in self.labels["entries"] if row["parameterCode"] == code)

    def _rule(self, code: str) -> dict:
        return self.labels["rules"][code]

    def _lines(self, *texts: str) -> None:
        self.evidence["blocks"] = [{"blockIndex": 0, "text": "\n".join(texts),
                                   "bboxMilliPoints": [1000, 1000, 90000, 90000]}]
        self.evidence["lines"] = [
            {"blockIndex": 0, "lineIndex": number, "text": value,
             "bboxMilliPoints": [1000, 1000 + number * 5000, 90000, 4000 + number * 5000]}
            for number, value in enumerate(texts)
        ]
        self.evidence["evidenceSha256"] = _sha({key: value for key, value in
                                                self.evidence.items() if key != "evidenceSha256"})

    def _extract(self, code: str, *, drawing: str | None = None,
                 resolution: dict | None = None, drawing_proof: dict | None = None) -> list[dict]:
        with patch("inspector_worker.class_family_candidates.load_indexed_page_evidence",
                   return_value=self.evidence) as load:
            rows = extract_indexed_class_family_candidates(
                self.root / "manifest.jsonl", self.root / "index", "F0001", 1,
                expected_object_id="OBJ-1", expected_stage=self.evidence["stage"],
                expected_section=self.evidence["section"], block_indices=[0],
                parameter_code=code, drawing_section=drawing or self.evidence["section"],
                section_resolution=resolution, drawing_section_proof=drawing_proof)
        load.assert_called_once()
        return rows

    def _proof(self, drawing: str) -> dict:
        return {"status": "VERIFIED", "reference": "review:sheet-1",
                "sourceFileId": "F0001", "sourceSha256": "b" * 64,
                "manifestSha256": "a" * 64, "stage": self.evidence["stage"],
                "manifestSection": self.evidence["section"], "drawingSection": drawing}

    def test_all_eight_catalog_pinned_codes_extract_literal_review_candidates(self) -> None:
        rules = [rule for rule in load_candidate_family_pack()["rules"]
                 if rule["family"] == "CLASS_DECREASE"]
        self.assertEqual(len(rules), 8)
        self.assertEqual({entry["parameterCode"] for entry in self.labels["entries"]},
                         {rule["parameterCode"] for rule in rules})
        for code in sorted(self.labels["rules"]):
            with self.subTest(code=code):
                entry, rule = self._entry(code), self._rule(code)
                self.evidence["stage"] = "RD"
                self.evidence["section"] = rule["requiredActualSections"][0]
                raw_value = ("EI-60" if code == "PPM-103" else
                             "КМ3" if code in {"AR-050", "PPM-107"} else
                             "С1" if code == "PZ-023" else
                             "II" if code == "PZ-022" else
                             "2" if code == "PZ-015" else "A")
                self._lines(f"{entry['catalogName']}: {raw_value}")
                rows = self._extract(code)
                self.assertEqual(len(rows), 1)
                row = rows[0]
                self.assertEqual((row["parameterCode"], row["attribute"], row["rawValue"]),
                                 (code, entry["attribute"], raw_value))
                self.assertEqual(row["lineText"], self.evidence["lines"][0]["text"])
                self.assertEqual(row["locator"]["bboxMilliPoints"], [1000, 1000, 90000, 4000])
                self.assertEqual(row["pageEvidenceSha256"], self.evidence["evidenceSha256"])
                self.assertEqual(row["candidateSha256"], _sha({k: v for k, v in row.items()
                                                                if k != "candidateSha256"}))
                self.assertEqual(row["executionPolicy"], "NON_EXECUTING_ABSTAIN")
                for forbidden in ("finding", "coverage", "rank", "entityId", "comparison"):
                    self.assertNotIn(forbidden, row)

    def test_domain_specific_false_positives_and_negations_abstain(self) -> None:
        examples = [
            ("PZ-015", "Категория дороги: 2"),
            ("PZ-021", "Класс энергетической эффективности: A++"),
            ("PZ-022", "Степень огнестойкости здания: VI"),
            ("PZ-023", "Класс функциональной пожарной опасности: Ф1.3"),
            ("AR-050", "Спецификация и типы внутренней отделки помещений: не КМ3"),
            ("PPM-103", "Пределы огнестойкости противопожарных дверей и ворот (EI): REI-60"),
            ("PPM-107", "Класс пожарной опасности отделочных материалов: КМ0/КМ3"),
            ("ZU-124", "Класс энергетической эффективности здания: B либо C"),
        ]
        for code, text in examples:
            with self.subTest(code=code):
                self.evidence["stage"] = "RD"
                self.evidence["section"] = self._rule(code)["requiredActualSections"][0]
                self._lines(text)
                self.assertEqual(self._extract(code), [])

    def test_multiple_class_rows_on_page_abstain(self) -> None:
        self._lines("Класс энергетической эффективности: A",
                    "Класс энергетической эффективности: B")
        self.assertEqual(self._extract("PZ-021"), [])

    def test_second_class_label_alias_is_reported_with_original_value_span(self) -> None:
        alias = "Энергетический класс здания"
        policy = copy.deepcopy(self.labels)
        entry = next(row for row in policy["entries"] if row["parameterCode"] == "PZ-021")
        entry["labels"].append(alias)
        line = f"{alias}: B"
        self._lines(line)
        with patch("inspector_worker.class_family_candidates.load_class_family_labels",
                   return_value=policy):
            rows = self._extract("PZ-021")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["matchedLabel"], alias)
        locator = rows[0]["locator"]
        self.assertEqual(line[locator["valueStart"]:locator["valueEnd"]], "B")
        self.assertEqual(rows[0]["candidateSha256"], _sha({k: v for k, v in rows[0].items()
                                                            if k != "candidateSha256"}))

    def test_casefold_collision_between_aliases_abstains(self) -> None:
        entry = {"labels": ["Alias", "ALIAS"], "values": ["A"]}
        match = class_line_pattern(entry).fullmatch("Alias: A")
        self.assertIsNotNone(match)
        self.assertIsNone(matched_class_label(entry, match))

    def test_pd_unresolved_manifest_section_requires_sha_bound_proof(self) -> None:
        self.evidence["stage"] = "PD"
        self.evidence["section"] = "OTHER"
        self._lines("Класс энергетической эффективности: A")
        with self.assertRaisesRegex(ClassFamilyCandidateError, "resolution required"):
            self._extract("PZ-021", drawing="PZ")
        proof = self._proof("PZ")
        self.assertEqual(len(self._extract("PZ-021", drawing="PZ", resolution=proof)), 1)
        proof["sourceSha256"] = "0" * 64
        with self.assertRaisesRegex(ClassFamilyCandidateError, "resolution required"):
            self._extract("PZ-021", drawing="PZ", resolution=proof)

    def test_real_public_lines_outside_pz_do_not_become_candidates(self) -> None:
        # These literals occur in F0118 p12 (IOS2.1) and F0193 p18 (PB).
        # Source title pages prove those sections, not the PZ source required
        # by the candidate pack. Text alone must never supply section proof.
        for code, section, text in (
            ("PZ-015", "OTHER", "Категория надежности электроснабжения насосных станций принята II."),
            ("PZ-022", "PB", "степень огнестойкости здания – I;"),
            ("PZ-023", "PB", "класс конструктивной пожарной опасности здания – С0;"),
        ):
            with self.subTest(code=code):
                self.evidence["stage"] = "PD"
                self.evidence["section"] = section
                self._lines(text)
                with self.assertRaisesRegex(ClassFamilyCandidateError, "resolution required"):
                    self._extract(code, drawing="PZ")

    def test_actual_stage_and_drawing_section_are_checked(self) -> None:
        self._lines("Класс энергетической эффективности: A")
        with self.assertRaisesRegex(ClassFamilyCandidateError, "drawing section"):
            self._extract("PZ-021", drawing="KR")
        self.evidence["stage"] = "ID"
        self._lines("Класс энергетической эффективности: A")
        with self.assertRaisesRegex(ClassFamilyCandidateError, "stage"):
            self._extract("PZ-021", drawing="AR")

    def test_altered_page_hash_and_line_address_fail_closed(self) -> None:
        self.evidence["evidenceSha256"] = "0" * 64
        with self.assertRaisesRegex(ClassFamilyCandidateError, "hash"):
            self._extract("PZ-021")
        self._lines("Класс энергетической эффективности: A")
        self.evidence["lines"][0]["blockIndex"] = 3
        self.evidence["evidenceSha256"] = _sha({k: v for k, v in self.evidence.items()
                                                if k != "evidenceSha256"})
        with self.assertRaisesRegex(ClassFamilyCandidateError, "line provenance"):
            self._extract("PZ-021")

    def test_altered_catalog_label_value_or_pack_hash_fails_closed(self) -> None:
        policy = json.loads(LABEL_PACK_PATH.read_text())
        for edit in (
                lambda value: value["entries"].pop(),
                lambda value: value["entries"][0]["labels"].append("Категория"),
                lambda value: value["entries"][0]["values"].append("4"),
                lambda value: value.update(candidatePackSha256="0" * 64),
                lambda value: value.update(catalogSha256="0" * 64)):
            changed = json.loads(json.dumps(policy))
            edit(changed)
            path = self.root / "labels.json"
            path.write_text(json.dumps(changed))
            with self.assertRaises(ClassFamilyCandidateError):
                load_class_family_labels(path)

    def test_no_ordering_claim_from_literal_token(self) -> None:
        self._lines("Класс энергетической эффективности: A")
        result = self._extract("PZ-021")[0]
        self.assertEqual(result["canonicalUnit"], "energy_class")
        self.assertEqual(result["rawValue"], "A")
        self.assertNotIn("orderedValue", result)
        self.assertNotIn("finding", result)

    @requires_posix_storage
    def test_real_indexed_pdf_and_altered_page_artifact(self) -> None:
        font = next((path for path in (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        ) if path.is_file()), None)
        if font is None:
            self.skipTest("Cyrillic PDF fixture font unavailable")
        import fitz
        from inspector_worker.indexed_page_evidence import IndexedPageEvidenceError
        from inspector_worker.public_document_index import build_public_index

        materials = self.root / "materials"
        materials.mkdir()
        pdf = materials / "plan.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_font(fontname="ClassTest", fontfile=str(font))
        for number, text in enumerate((
                "Класс энергетической эффективности: A",
                "Техническое описание проекта и инженерных систем",
                "Для проверки взят буквальный класс одного здания")):
            page.insert_text((45, 70 + number * 25), text,
                             fontname="ClassTest", fontsize=9)
        document.save(pdf)
        document.close()
        source = {
            "file_id": "F0001", "object_id": "OBJ-1", "stage": "RD", "section": "AR",
            "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
            "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
            "extension": ".pdf", "size_bytes": pdf.stat().st_size,
            "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pdf_pages": 1,
        }
        manifest = self.root / "manifest.jsonl"
        manifest.write_text(json.dumps(source) + "\n")
        index = self.root / "index"
        build_public_index(manifest, index, materials_root=materials)
        with closing(sqlite3.connect(index / "index.sqlite3")) as connection:
            artifact, count = connection.execute(
                "SELECT artifact_path, block_count FROM pages WHERE source_id='F0001'"
            ).fetchone()
        rows = extract_indexed_class_family_candidates(
            manifest, index, "F0001", 1, expected_object_id="OBJ-1",
            expected_stage="RD", expected_section="AR", block_indices=list(range(count)),
            parameter_code="PZ-021", drawing_section="AR")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["rawValue"], "A")
        self.assertEqual(rows[0]["sourceSha256"], source["sha256"])
        (index / artifact).write_bytes((index / artifact).read_bytes() + b"tampered")
        with self.assertRaises(IndexedPageEvidenceError):
            extract_indexed_class_family_candidates(
                manifest, index, "F0001", 1, expected_object_id="OBJ-1",
                expected_stage="RD", expected_section="AR", block_indices=list(range(count)),
                parameter_code="PZ-021", drawing_section="AR")


if __name__ == "__main__":
    unittest.main()
