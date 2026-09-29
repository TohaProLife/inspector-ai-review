from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.kr_decrease_family import (
    extract_kr_decrease_candidates, extract_kr_decrease_from_evidence,
)
from inspector_worker.public_document_index import build_public_index, get_indexed_page


def evidence_for(*texts: str, stage: str = "PD", section: str = "KR") -> dict:
    blocks = []
    lines = []
    for index, value in enumerate(texts):
        box = [1000, index * 20000 + 1000, 100000, index * 20000 + 11000]
        blocks.append({"blockIndex": index, "text": value, "bboxMilliPoints": box})
        lines.append({"blockIndex": index, "lineIndex": 0, "text": value,
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
        "selectedBlockIndices": list(range(len(texts))),
        "blocks": blocks, "lines": lines,
        "sectionCandidates": [], "tableRowCandidates": [],
    }
    result["evidenceSha256"] = hashlib.sha256(json.dumps(
        result, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False).encode()).hexdigest()
    return result


WALL = "Корпус 1, 3 этаж, несущая монолитная стена С1: толщина 200 мм"
REBAR = "Секция 2, этаж 5, колонна К1: продольная арматура Ø20 мм"


def _cyrillic_font_path() -> Path | None:
    preferred = [
        Path(os.environ.get("INSPECTOR_TEST_CYRILLIC_FONT", ""))
        if os.environ.get("INSPECTOR_TEST_CYRILLIC_FONT") else None,
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/freefont/FreeSans.ttf"),
    ]
    for directory in (Path("/usr/share/fonts"), Path("/usr/local/share/fonts")):
        if directory.is_dir():
            preferred.extend(sorted(directory.rglob("*.ttf")))
            preferred.extend(sorted(directory.rglob("*.otf")))
    required = {ord(char) for char in WALL + REBAR if ord(char) > 127}
    for candidate in preferred:
        if candidate is None or not candidate.is_file():
            continue
        try:
            font = fitz.Font(fontfile=str(candidate))
            if all(font.has_glyph(codepoint) for codepoint in required):
                return candidate
        except (RuntimeError, ValueError):
            continue
    return None


class KrDecreaseFamilyTests(unittest.TestCase):
    def result(self, *texts: str) -> dict:
        return extract_kr_decrease_from_evidence(evidence_for(*texts))

    def test_wall_candidate_has_exact_source_and_original_block_span(self) -> None:
        result = self.result(WALL)
        wall = result["results"]["KR-061"]
        self.assertEqual(wall["status"], "REVIEW_CANDIDATE")
        self.assertEqual(result["disposition"], "REVIEW_ONLY")
        self.assertFalse(result["selectionComplete"])
        self.assertEqual(result["drawingSectionStatus"], "UNVERIFIED")
        self.assertNotIn("findings", result)
        self.assertNotIn("coverage", result)
        fact, = wall["facts"]
        self.assertEqual(fact["attribute"], "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS")
        self.assertEqual((fact["elementId"], fact["rawValue"], fact["rawUnit"]),
                         ("С1", "200", "мм"))
        self.assertEqual(fact["rawText"][fact["locator"]["start"]:fact["locator"]["end"]], "200")
        self.assertEqual(fact["locator"]["blockIndex"], 0)
        self.assertEqual(fact["sourceFileId"], "F0105")
        self.assertEqual(fact["factId"], make_fact_id(fact))
        self.assertEqual(result["results"]["KR-062"]["status"], "ABSTAIN")

    def test_column_longitudinal_diameter_candidate_and_implicit_symbol_unit(self) -> None:
        explicit = self.result(REBAR)["results"]["KR-062"]["facts"]
        self.assertEqual(len(explicit), 1)
        self.assertEqual((explicit[0]["rawValue"], explicit[0]["elementId"]), ("20", "К1"))
        self.assertEqual(explicit[0]["measurementBasis"], "EXPLICIT_DIAMETER_MM")
        implicit = self.result(REBAR.replace("Ø20 мм", "Ø20"))["results"]["KR-062"]["facts"]
        self.assertEqual(len(implicit), 1)
        self.assertEqual(implicit[0]["measurementBasis"], "DIAMETER_SYMBOL_MM")

    def test_latin_unit_preserves_raw_notation(self) -> None:
        fact, = self.result(WALL.replace("200 мм", "200 mm"))["results"]["KR-061"]["facts"]
        self.assertEqual((fact["rawValue"], fact["rawUnit"]), ("200", "mm"))

    def test_two_values_or_two_claims_abstain_for_code(self) -> None:
        for texts in ((WALL.replace("200 мм", "200 мм или 250 мм"),),
                      (WALL, WALL.replace("С1", "С2").replace("200", "250"))):
            with self.subTest(texts=texts):
                result = self.result(*texts)["results"]["KR-061"]
                self.assertEqual(result["status"], "ABSTAIN")
                self.assertEqual(result["reasonCode"], "AMBIGUOUS_SELECTED_EVIDENCE")
                self.assertEqual(result["facts"], [])

    def test_complete_and_partial_competing_claims_abstain(self) -> None:
        other = "Несущая монолитная стена С1: толщина 250 мм"
        row = self.result(WALL, other)["results"]["KR-061"]
        self.assertEqual(row["status"], "ABSTAIN")
        self.assertEqual(row["facts"], [])

    def test_split_cells_are_not_silently_joined(self) -> None:
        result = self.result("Корпус 1, 3 этаж, несущая монолитная стена С1: толщина",
                             "200 мм")
        self.assertEqual(result["results"]["KR-061"]["status"], "ABSTAIN")

    def test_wall_without_identity_zone_floor_or_explicit_role_abstains(self) -> None:
        for text in (WALL.replace("С1", ""), WALL.replace("Корпус 1, ", ""),
                     WALL.replace("3 этаж, ", ""), WALL.replace("несущая ", ""),
                     WALL.replace("монолитная ", ""), WALL.replace("толщина ", "")):
            with self.subTest(text=text):
                self.assertEqual(self.result(text)["results"]["KR-061"]["status"], "ABSTAIN")

    def test_grouped_floors_elements_or_zones_do_not_become_one_identity(self) -> None:
        for text in (WALL.replace("3 этаж", "2-3 этаж"),
                     WALL.replace("3 этаж", "2 и 3-й этаж"),
                     WALL.replace("3 этаж", "2 и 3-го этаж"),
                     WALL.replace("3 этаж", "2/3-й этаж"),
                     WALL.replace("3 этаж", "2–3-го этаж"),
                     WALL.replace("3 этаж", "этажи 2 и 3"),
                     WALL.replace("стена С1", "стена С1/С2"),
                     WALL.replace("стена С1", "стена С1-С2"),
                     WALL.replace("Корпус 1", "Корпус 1-2"),
                     WALL.replace("Корпус 1", "Корпус 1/2"),
                     WALL.replace("Корпус 1", "Корпус 1, 2"),
                     WALL.replace("Корпус 1", "Зона 1 и 2")):
            with self.subTest(text=text):
                self.assertEqual(self.result(text)["results"]["KR-061"]["status"], "ABSTAIN")

    def test_spaced_negations_reject_wall_or_rebar_role(self) -> None:
        for text, code in ((WALL.replace("несущая", "не несущая"), "KR-061"),
                           (WALL.replace("монолитная", "не монолитная"), "KR-061"),
                           (WALL.replace("несущая", "не является несущей"), "KR-061"),
                           (REBAR.replace("продольная", "не продольная"), "KR-062")):
            with self.subTest(text=text):
                self.assertEqual(self.result(text)["results"][code]["status"], "ABSTAIN")

    def test_not_confused_by_partition_insulation_or_other_role(self) -> None:
        for text in ("Корпус 1, 3 этаж, ненесущая монолитная стена С1: толщина 200 мм",
                     WALL.replace("стена С1", "стена С1 и утеплитель"),
                     REBAR.replace("продольная", "поперечная"),
                     REBAR.replace("Ø20 мм", "Ø20 мм, шаг 200 мм")):
            with self.subTest(text=text):
                result = self.result(text)
                self.assertTrue(all(row["status"] == "ABSTAIN" for row in result["results"].values()))

    def test_negated_excluded_and_unrelated_number_abstain(self) -> None:
        for text in ("Корпус 1, 3 этаж, несущая монолитная стена С1: толщина 200 мм не предусмотрена",
                     "Корпус 1, 3 этаж, несущая монолитная стена С1: 200 мм; толщина отсутствует",
                     "Корпус 1, 3 этаж, монолитная стена С1, класс бетона B25"):
            with self.subTest(text=text):
                self.assertEqual(self.result(text)["results"]["KR-061"]["status"], "ABSTAIN")

    def test_competing_diameter_without_unit_abstains(self) -> None:
        text = REBAR.replace("Ø20 мм", "диаметр 20")
        self.assertEqual(self.result(text)["results"]["KR-062"]["status"], "ABSTAIN")

    def test_repeated_original_line_cannot_produce_unique_locator(self) -> None:
        evidence = evidence_for(WALL + "\n" + WALL)
        evidence["lines"] = [{"blockIndex": 0, "lineIndex": 0, "text": WALL,
                              "bboxMilliPoints": evidence["blocks"][0]["bboxMilliPoints"]}]
        evidence.pop("evidenceSha256")
        evidence["evidenceSha256"] = hashlib.sha256(json.dumps(
            evidence, ensure_ascii=False, sort_keys=True,
            separators=(",", ":")).encode()).hexdigest()
        row = extract_kr_decrease_from_evidence(evidence)["results"]["KR-061"]
        self.assertEqual(row["status"], "ABSTAIN")

    def test_tampered_evidence_or_wrong_section_rejected(self) -> None:
        evidence = evidence_for(WALL)
        evidence["lines"][0]["text"] = REBAR
        with self.assertRaisesRegex(ValueError, "SHA"):
            extract_kr_decrease_from_evidence(evidence)
        with self.assertRaisesRegex(ValueError, "scope"):
            extract_kr_decrease_from_evidence(evidence_for(WALL, section="AR"))

    def test_version_width_and_coordinate_contract_rejected_on_drift(self) -> None:
        for changes in ({"indexVersionHash": "b" * 64},
                        {"coordinateSystem": "PDF_POINTS_TOP_LEFT"}):
            evidence = evidence_for(WALL)
            evidence.update(changes)
            evidence.pop("evidenceSha256")
            evidence["evidenceSha256"] = hashlib.sha256(json.dumps(
                evidence, ensure_ascii=False, sort_keys=True,
                separators=(",", ":")).encode()).hexdigest()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                extract_kr_decrease_from_evidence(evidence)

    def _require_cyrillic_font(self) -> Path:
        font_path = _cyrillic_font_path()
        if font_path is None:
            self.skipTest("No installed Cyrillic font for PDF index integration test")
        return font_path

    @requires_posix_storage
    def test_actual_index_adapter_contract_and_pdf_coordinates(self) -> None:
        font_path = self._require_cyrillic_font()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pdf = root / "public.pdf"
            document = fitz.open()
            page = document.new_page()
            page.insert_font(fontname="TestCyrillic", fontfile=str(font_path))
            page.insert_text((40, 90), WALL, fontname="TestCyrillic", fontsize=10)
            page.insert_text((40, 120), REBAR, fontname="TestCyrillic", fontsize=10)
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
                        if "стена С1" in block["text"] or "колонна К1" in block["text"]]
            self.assertTrue(selected)
            from inspector_worker.indexed_page_evidence import load_indexed_page_evidence
            evidence = load_indexed_page_evidence(
                manifest, index, "F0105", 1,
                expected_object_id="OBJ-NOVOSLOBODSKAYA",
                expected_stage="PD", expected_section="KR", block_indices=selected,
            )
            self.assertEqual(len(evidence["indexVersionHash"]), 20)
            self.assertEqual(evidence["coordinateSystem"], "PDF_BOTTOM_LEFT_MILLI_POINTS")
            result = extract_kr_decrease_candidates(
                manifest, index, "F0105", 1,
                expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="PD",
                block_indices=selected,
            )
            for code in ("KR-061", "KR-062"):
                with self.subTest(code=code):
                    self.assertEqual(result["results"][code]["status"], "REVIEW_CANDIDATE")
                    fact, = result["results"][code]["facts"]
                    self.assertEqual(fact["indexProvenance"]["indexVersionHash"],
                                     evidence["indexVersionHash"])
                    self.assertEqual(fact["sourceSha256"], row["sha256"])

    def test_pdf_integration_has_explicit_no_font_skip(self) -> None:
        with patch(f"{__name__}._cyrillic_font_path",
                   return_value=None):
            with self.assertRaisesRegex(unittest.SkipTest, "No installed Cyrillic font"):
                self._require_cyrillic_font()

    def test_entrypoint_calls_checked_adapter_with_exact_selection(self) -> None:
        evidence = evidence_for(WALL, stage="RD")
        with patch("inspector_worker.kr_decrease_family.load_indexed_page_evidence",
                   return_value=evidence) as loader:
            result = extract_kr_decrease_candidates(
                Path("/tmp/public-manifest"), Path("/tmp/public-index"), "F0105", 7,
                expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="RD",
                block_indices=[0],
            )
        loader.assert_called_once_with(
            Path("/tmp/public-manifest"), Path("/tmp/public-index"), "F0105", 7,
            expected_object_id="OBJ-NOVOSLOBODSKAYA", expected_stage="RD",
            expected_section="KR", block_indices=[0],
        )
        self.assertEqual(result["results"]["KR-061"]["facts"][0]["stage"], "RD")

    def test_unselected_blocks_do_not_affect_selected_line(self) -> None:
        result = self.result(WALL)
        self.assertEqual(result["results"]["KR-061"]["status"], "REVIEW_CANDIDATE")
        self.assertFalse(result["selectionComplete"])


if __name__ == "__main__":
    unittest.main()
