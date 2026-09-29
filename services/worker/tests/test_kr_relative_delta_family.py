from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.family_rule_evaluator import _canonical_numeric
from inspector_worker.kr_relative_delta_family import (
    InvalidTableGeometry,
    extract_kr_relative_delta_candidates, extract_kr_relative_delta_from_evidence,
    extract_kr_relative_delta_table_observations,
    select_kr_relative_delta_table_blocks,
)
from inspector_worker.public_document_index import build_public_index, get_indexed_page


CONCRETE = "Корпус 1, общий объем бетона: 1 250,5 м³"
STEEL = "Корпус 1, общая масса стали: 20,2 т"


def evidence_for(*texts: str, stage: str = "PD", section: str = "KR") -> dict:
    blocks = []
    lines = []
    for index, text in enumerate(texts):
        box = [1000, index * 20000 + 1000, 120000, index * 20000 + 11000]
        blocks.append({"blockIndex": index, "text": text, "bboxMilliPoints": box})
        lines.append({"blockIndex": index, "lineIndex": 0, "text": text,
                      "bboxMilliPoints": box})
    result = {
        "schemaVersion": "indexed-page-evidence-v1", "candidateStatus": "CANDIDATE",
        "manifestSha256": "a" * 64, "indexVersionHash": "b" * 20,
        "qualityPolicyVersion": "quality-v1", "sourceFileId": "F0105",
        "objectId": "OBJ-NOVOSLOBODSKAYA", "stage": stage, "section": section,
        "sourceSha256": "c" * 64, "sourceRelativePath": "public.pdf",
        "pageNumber": 7, "pageArtifactSha256": "d" * 64,
        "parserProvenance": "PDFMINER", "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "widthMilliPoints": 595000, "heightMilliPoints": 842000,
        "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
        "selectedBlockIndices": list(range(len(texts))), "blocks": blocks, "lines": lines,
        "sectionCandidates": [], "tableRowCandidates": [],
    }
    result["evidenceSha256"] = hashlib.sha256(json.dumps(
        result, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode()).hexdigest()
    return result


def _rehash(evidence: dict) -> dict:
    evidence.pop("evidenceSha256", None)
    evidence["evidenceSha256"] = hashlib.sha256(json.dumps(
        evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode()).hexdigest()
    return evidence


def _table_evidence(*, duplicate_heading: bool = False, extra_value: bool = False,
                    moved_value: bool = False, steel_between: bool = False) -> tuple[dict, dict]:
    content = [
        ("Сводная ведомость расхода бетона, м3.", [159690, 589078, 355063, 604945]),
        ("ИТОГО:", [285870, 432321, 314510, 444221]),
        ("432", [351600, 410000 if moved_value else 432321,
                 364490, 422000 if moved_value else 444221]),
    ]
    if duplicate_heading:
        content.append(("Сводная ведомость расхода бетона, м3.", [159690, 620000, 355063, 636000]))
    if extra_value:
        content.append(("433", [390000, 432321, 405000, 444221]))
    if steel_between:
        content.append(("Сводная ведомость расхода стали, кг.", [159690, 500000, 355063, 516000]))
    evidence = evidence_for(*(text for text, _ in content))
    for index, (_, box) in enumerate(content):
        evidence["blocks"][index]["bboxMilliPoints"] = box
        evidence["lines"][index]["bboxMilliPoints"] = box
    _rehash(evidence)
    full_page = {
        "pageNumber": evidence["pageNumber"], "inputSha256": evidence["sourceSha256"],
        "indexVersionHash": evidence["indexVersionHash"],
        "coordinateSystem": evidence["coordinateSystem"],
        "blocks": [{"text": text, "bboxMilliPoints": box} for text, box in content],
        "lines": [dict(line) for line in evidence["lines"]],
    }
    return evidence, full_page


def _cyrillic_font_path() -> Path | None:
    preferred = [Path(os.environ["INSPECTOR_TEST_CYRILLIC_FONT"])] if os.environ.get("INSPECTOR_TEST_CYRILLIC_FONT") else []
    preferred += [Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
                  Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf")]
    for directory in (Path("/usr/share/fonts"), Path("/usr/local/share/fonts")):
        if directory.is_dir():
            preferred.extend(sorted(directory.rglob("*.ttf")))
            preferred.extend(sorted(directory.rglob("*.otf")))
    required = {ord(char) for char in CONCRETE + STEEL if ord(char) > 127}
    for candidate in preferred:
        if candidate.is_file():
            try:
                font = fitz.Font(fontfile=str(candidate))
                if all(font.has_glyph(codepoint) for codepoint in required):
                    return candidate
            except (RuntimeError, ValueError):
                continue
    return None


class KrRelativeDeltaFamilyTests(unittest.TestCase):
    def result(self, *texts: str) -> dict:
        return extract_kr_relative_delta_from_evidence(evidence_for(*texts))

    def test_two_atomic_material_totals_and_provenance(self) -> None:
        result = self.result(CONCRETE, STEEL)
        self.assertEqual(result["disposition"], "REVIEW_ONLY")
        self.assertFalse(result["selectionComplete"])
        self.assertEqual(result["relativeDenominatorStatus"], "UNVERIFIED")
        self.assertNotIn("findings", result)
        self.assertNotIn("coverage", result)
        volume, = result["results"]["CONCRETE_VOLUME"]["facts"]
        mass, = result["results"]["STEEL_MASS"]["facts"]
        self.assertEqual((volume["rawValue"], volume["rawUnit"], volume["canonicalUnit"]),
                         ("1 250,5", "м³", "m3"))
        self.assertEqual((mass["rawValue"], mass["rawUnit"], mass["canonicalUnit"]),
                         ("20,2", "т", "t"))
        self.assertEqual(volume["scope"], mass["scope"])
        self.assertEqual(volume["scope"], "КОРПУС:1")
        self.assertEqual((volume["elementType"], volume["elementId"]),
                         ("STRUCTURE_SCOPE", "КОРПУС:1"))
        self.assertNotEqual(volume["attribute"], mass["attribute"])
        for fact in (volume, mass):
            locator = fact["locator"]
            self.assertEqual(fact["rawText"][locator["start"]:locator["end"]], fact["rawValue"])
            self.assertEqual(fact["factId"], make_fact_id(fact))
            self.assertEqual(fact["sourceFileId"], "F0105")
            self.assertEqual(fact["indexProvenance"]["evidenceSha256"], result["evidenceSha256"])

    def test_independent_attribute_observations(self) -> None:
        result = self.result(CONCRETE)
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["status"], "REVIEW_CANDIDATE")
        self.assertEqual(result["results"]["STEEL_MASS"]["status"], "ABSTAIN")
        self.assertEqual(result["results"]["STEEL_MASS"]["reasonCode"], "NO_QUALIFIED_SELECTED_LINE")

    def test_no_total_scope_or_unit_abstains(self) -> None:
        for text in ("Общий объем бетона: 100 м³",
                     "Корпус 1, объем бетона: 100 м³",
                     "Корпус 1, общий объем бетона: 100",
                     "Корпус 1, общий объем бетона: 100 м²",
                     "Корпус 1, общая масса стали: 100 м³",
                     "Корпус 1, масса стали: 20 т"):
            with self.subTest(text=text):
                result = self.result(text)
                target = "STEEL_MASS" if "масса стали" in text else "CONCRETE_VOLUME"
                self.assertEqual(result["results"][target]["status"], "ABSTAIN")

    def test_groups_components_and_extra_quantities_abstain(self) -> None:
        for text in (CONCRETE.replace("Корпус 1", "Корпус 1-2"),
                     CONCRETE.replace("Корпус 1", "Корпус 1 и 2"),
                     CONCRETE.replace("бетона", "бетонной подготовки"),
                     CONCRETE + ", в том числе 100 м³ класса B25",
                     CONCRETE + "; масса стали: 20 т",
                     STEEL + " и 100 кг арматуры"):
            with self.subTest(text=text):
                result = self.result(text)
                self.assertTrue(all(row["status"] == "ABSTAIN" for row in result["results"].values()))

    def test_competing_material_totals_abstain_without_summing(self) -> None:
        second = CONCRETE.replace("1 250,5", "1 400")
        result = self.result(CONCRETE, second, STEEL)
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["status"], "ABSTAIN")
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["facts"], [])
        self.assertEqual(result["results"]["STEEL_MASS"]["status"], "REVIEW_CANDIDATE")

    def test_split_pdf_cells_are_not_joined(self) -> None:
        result = self.result("Корпус 1, общий объем бетона", "1 250,5 м³")
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["status"], "ABSTAIN")

    def test_repeated_line_in_source_block_abstains(self) -> None:
        evidence = evidence_for(CONCRETE + "\n" + CONCRETE)
        evidence["lines"][0]["text"] = CONCRETE
        result = extract_kr_relative_delta_from_evidence(_rehash(evidence))
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["status"], "ABSTAIN")

    def test_value_offset_is_in_original_multiline_block(self) -> None:
        evidence = evidence_for("Заголовок\n" + CONCRETE + "\nПодпись")
        evidence["lines"][0]["text"] = CONCRETE
        result = extract_kr_relative_delta_from_evidence(_rehash(evidence))
        fact, = result["results"]["CONCRETE_VOLUME"]["facts"]
        self.assertEqual(fact["rawText"].index("1 250,5"), fact["locator"]["start"])

    def test_ground_truth_source_and_duplicate_line_address_rejected(self) -> None:
        evidence = evidence_for(CONCRETE)
        evidence["sourceFileId"] = "F0194"
        with self.assertRaisesRegex(ValueError, "PDF scope"):
            extract_kr_relative_delta_from_evidence(_rehash(evidence))
        evidence = evidence_for(CONCRETE)
        evidence["lines"].append(dict(evidence["lines"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            extract_kr_relative_delta_from_evidence(_rehash(evidence))

    def test_table_total_is_page_local_observation_not_typed_fact(self) -> None:
        evidence, page = _table_evidence()
        self.assertEqual(select_kr_relative_delta_table_blocks(page), [0, 1, 2])
        observation, = extract_kr_relative_delta_table_observations(evidence, page)
        self.assertEqual((observation["attribute"], observation["rawValue"], observation["rawUnit"]),
                         ("CONCRETE_VOLUME", "432", "м3"))
        self.assertEqual(observation["scopeStatus"], "TABLE_OR_COMPONENT_ONLY")
        self.assertEqual(observation["structureScopeStatus"], "UNVERIFIED")
        self.assertNotEqual(observation["schemaVersion"], "typed-fact-v1")
        self.assertNotIn("factId", observation)
        self.assertNotIn("findings", observation)
        self.assertEqual(observation["locators"]["value"]["bboxMilliPoints"],
                         [351600, 432321, 364490, 444221])
        self.assertEqual(observation["observationSha256"], hashlib.sha256(json.dumps(
            {key: value for key, value in observation.items() if key != "observationSha256"},
            ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest())

    def test_competing_table_geometry_abstains(self) -> None:
        for change in ({"duplicate_heading": True}, {"extra_value": True},
                       {"moved_value": True}, {"steel_between": True}):
            with self.subTest(change=change):
                evidence, page = _table_evidence(**change)
                self.assertEqual(select_kr_relative_delta_table_blocks(page), [])
                self.assertEqual(extract_kr_relative_delta_table_observations(evidence, page), [])

    def test_zero_area_unrelated_line_invalidates_complete_page_table_scan(self) -> None:
        evidence, page = _table_evidence()
        page["lines"].append({
            "blockIndex": 0, "lineIndex": 1, "text": "2800",
            "bboxMilliPoints": [734521, 1514401, 734521, 1514401],
        })
        with self.assertRaisesRegex(InvalidTableGeometry, "geometry invalid"):
            select_kr_relative_delta_table_blocks(page)
        with self.assertRaisesRegex(InvalidTableGeometry, "geometry invalid"):
            extract_kr_relative_delta_table_observations(evidence, page)

    def test_missing_selected_value_or_changed_complete_page_rejected(self) -> None:
        evidence, page = _table_evidence()
        evidence["selectedBlockIndices"] = [0, 1]
        evidence["blocks"] = evidence["blocks"][:2]
        evidence["lines"] = evidence["lines"][:2]
        self.assertEqual(extract_kr_relative_delta_table_observations(_rehash(evidence), page), [])
        evidence, page = _table_evidence()
        page["blocks"][2]["text"] = "999"
        with self.assertRaisesRegex(ValueError, "differs"):
            extract_kr_relative_delta_table_observations(evidence, page)

    def test_exact_units_and_stage_scope(self) -> None:
        result = extract_kr_relative_delta_from_evidence(evidence_for(
            "Секция 2, итого объем бетона = 12,25 куб. м",
            "Секция 2, всего масса стали = 750 кг", stage="RD"))
        volume, = result["results"]["CONCRETE_VOLUME"]["facts"]
        mass, = result["results"]["STEEL_MASS"]["facts"]
        self.assertEqual((volume["stage"], volume["scope"], volume["rawUnit"]),
                         ("RD", "СЕКЦИЯ:2", "куб. м"))
        self.assertEqual((mass["rawUnit"], mass["canonicalUnit"]), ("кг", "t"))
        self.assertEqual(_canonical_numeric(volume, "m3"), Decimal("12.25"))
        self.assertEqual(_canonical_numeric(mass, "t"), Decimal("0.750"))

    def test_tampering_wrong_section_or_ocr_rejected(self) -> None:
        evidence = evidence_for(CONCRETE)
        evidence["lines"][0]["text"] = STEEL
        with self.assertRaisesRegex(ValueError, "SHA"):
            extract_kr_relative_delta_from_evidence(evidence)
        for change in ({"section": "AR"}, {"coordinateSystem": "PDF_TOP_LEFT"},
                       {"indexVersionHash": "b" * 64},
                       {"quality": {"disposition": "OCR_REQUIRED"}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                extract_kr_relative_delta_from_evidence(_rehash(evidence_for(CONCRETE) | change))

    def test_entrypoint_calls_checked_public_adapter(self) -> None:
        evidence = evidence_for(CONCRETE, stage="RD")
        with patch("inspector_worker.kr_relative_delta_family.load_indexed_page_evidence",
                   return_value=evidence) as loader:
            result = extract_kr_relative_delta_candidates(
                Path("/tmp/manifest"), Path("/tmp/index"), "F0105", 7,
                expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="RD",
                block_indices=[0],
            )
        loader.assert_called_once_with(
            Path("/tmp/manifest"), Path("/tmp/index"), "F0105", 7,
            expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="RD",
            expected_section="KR", block_indices=[0],
        )
        self.assertEqual(result["results"]["CONCRETE_VOLUME"]["status"], "REVIEW_CANDIDATE")

    @requires_posix_storage
    def test_generated_public_pdf_through_real_index_adapter(self) -> None:
        font_path = _cyrillic_font_path()
        if font_path is None:
            self.skipTest("No installed Cyrillic font for PDF index integration test")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "public.pdf"
            document = fitz.open()
            page = document.new_page()
            page.insert_font(fontname="TestCyrillic", fontfile=str(font_path))
            page.insert_text((40, 90), CONCRETE, fontname="TestCyrillic", fontsize=10)
            page.insert_text((40, 120), STEEL, fontname="TestCyrillic", fontsize=10)
            document.save(pdf)
            document.close()
            row = {
                "file_id": "F0105", "object_id": "OBJ-NOVOSLOBODSKAYA",
                "stage": "PD", "section": "KR", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": "public.pdf", "extension": ".pdf",
                "size_bytes": pdf.stat().st_size,
                "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                "pdf_pages": 1, "annotation_status": "UNLABELED",
            }
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            index = root / "index"
            summary = build_public_index(manifest, index, materials_root=root)
            self.assertEqual(summary["completeSources"], 1)
            indexed = get_indexed_page(index, "F0105", 1)["page"]
            selected = [number for number, block in enumerate(indexed["blocks"])
                        if "объем бетона" in block["text"] or "масса стали" in block["text"]]
            self.assertTrue(selected)
            result = extract_kr_relative_delta_candidates(
                manifest, index, "F0105", 1,
                expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="PD",
                block_indices=selected,
            )
            for attribute in ("CONCRETE_VOLUME", "STEEL_MASS"):
                with self.subTest(attribute=attribute):
                    self.assertEqual(result["results"][attribute]["status"], "REVIEW_CANDIDATE")
                    fact, = result["results"][attribute]["facts"]
                    self.assertEqual(fact["sourceSha256"], row["sha256"])


if __name__ == "__main__":
    unittest.main()
