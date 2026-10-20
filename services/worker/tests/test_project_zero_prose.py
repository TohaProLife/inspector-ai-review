from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from inspector_worker.project_zero_prose import extract_project_zero_candidates

FIXTURE_PATH = Path(__file__).parent / "fixtures/project-zero-F0101-F0139.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text())


def page(stage):
    source = next(s for s in FIXTURE["sources"] if s["source"]["stage"] == stage)
    return copy.deepcopy(source["sourceArtifact"]["pages"][source["provenance"]["targetOriginalPdfPage"] - 1])


def change_line(p, bi, li, old, new):
    lines = p["blocks"][bi]["text"].split("\n")
    assert old in lines[li]
    lines[li] = lines[li].replace(old, new)
    p["blocks"][bi]["text"] = "\n".join(lines)


def union(block):
    boxes = block["lineBboxesMilliPoints"]
    block["bboxMilliPoints"] = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                               max(b[2] for b in boxes), max(b[3] for b in boxes)]


def shift_line(p, bi, li, dx=0, dy=0):
    box = p["blocks"][bi]["lineBboxesMilliPoints"][li]
    p["blocks"][bi]["lineBboxesMilliPoints"][li] = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]
    union(p["blocks"][bi])


def append_line(p, text, box=None):
    box = [1000, 1000, 15000, 13000] if box is None else box
    p["blocks"].append({"text": text, "bboxMilliPoints": box[:], "lineBboxesMilliPoints": [box[:]]})


class ProjectZeroProseTests(unittest.TestCase):
    def test_full35_original_pages_metadata_and_artifact_hashes(self):
        self.assertEqual(len(FIXTURE["sources"]), 2)
        self.assertEqual(sum(len(s["sourceArtifact"]["pages"]) for s in FIXTURE["sources"]), 35)
        for item in FIXTURE["sources"]:
            s, a = item["source"], item["sourceArtifact"]
            self.assertEqual(s["split"], "TRAIN_PUBLIC")
            self.assertEqual(s["distribution_status"], "INCLUDE")
            self.assertEqual(s["label_visibility"], "PUBLIC_TRAIN")
            self.assertEqual(a["sourceFileId"], s["file_id"])
            self.assertEqual(a["inputSha256"], s["sha256"])
            self.assertEqual(a["pageCount"], s["pdf_pages"])
            self.assertEqual([p["pageNumber"] for p in a["pages"]], list(range(1, s["pdf_pages"] + 1)))
            raw = json.dumps(a, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), item["provenance"]["fullTextArtifactSha256"])

    def test_actual_pd_complete_qualifier_and_trailing_space(self):
        p = page("PD"); facts = extract_project_zero_candidates(p, "PD")
        self.assertEqual(len(facts), 1)
        f = facts[0]
        self.assertEqual(set(f), {"value", "rawValue", "rawUnit", "canonicalUnit", "localZero", "referenceKind",
                                  "referenceText", "datumName", "primaryFragments", "unitAuthorityFragments"})
        self.assertEqual((f["value"], f["rawValue"], f["rawUnit"], f["canonicalUnit"]), ("159.95", "159,95", "м", "m"))
        self.assertEqual(f["localZero"], "0"); self.assertEqual(f["referenceKind"], "FINISHED_FLOOR")
        self.assertIsNone(f["datumName"])
        self.assertEqual(f["referenceText"], "отметке чистого пола входного вестибюля на 1-м этаже.")
        self.assertEqual([(x["blockIndex"], x["lineIndex"]) for x in f["primaryFragments"]], [(0, 8), (0, 9)])
        self.assertTrue(f["primaryFragments"][0]["rawText"].endswith("соответствует "))
        self.assertEqual(f["primaryFragments"][0]["bboxMilliPoints"], [85138, 677046, 515421, 687066])
        self.assertEqual(f["unitAuthorityFragments"], [])

    def test_actual_rd_separate_complete_global_unit_note(self):
        p = page("RD"); f = extract_project_zero_candidates(p, "RD")[0]
        self.assertEqual((f["value"], f["rawValue"], f["rawUnit"], f["localZero"]), ("159.95", "159.95", "метрах", "0"))
        self.assertEqual(f["referenceText"], "чистого пола первого этажа")
        self.assertEqual([(x["blockIndex"], x["lineIndex"]) for x in f["primaryFragments"]], [(40, 0)])
        self.assertEqual([(x["blockIndex"], x["lineIndex"]) for x in f["unitAuthorityFragments"]], [(32, 18), (32, 19)])
        self.assertTrue(f["unitAuthorityFragments"][0]["rawText"].startswith("Бетонирование вести непрерывно,"))
        self.assertTrue(f["unitAuthorityFragments"][0]["rawText"].endswith("Все размеры даны в миллиметрах,"))
        self.assertEqual(f["unitAuthorityFragments"][1]["rawText"], "отметки - в метрах.")
        self.assertIsNone(f["datumName"])
        self.assertNotIn("entityKey", f); self.assertNotIn("approved", f); self.assertNotIn("qualified", f)

    def test_changed_and_signed_exact_decimal(self):
        for stage, bi, li, old in [("PD", 0, 8, "159,95"), ("RD", 40, 0, "159.95")]:
            for raw, expected in [("159.96", "159.96"), ("-159,9600", "-159.96"), ("+159.9500", "159.95"),
                                  ("0.000", "0"), ("-0,00", "0"), ("159", "159")]:
                with self.subTest(stage=stage, raw=raw):
                    p = page(stage); change_line(p, bi, li, old, raw)
                    f = extract_project_zero_candidates(p, stage)[0]
                    self.assertEqual(f["value"], expected); self.assertEqual(f["rawValue"], raw)

    def test_local_zero_marker_is_not_absolute_uncertainty(self):
        for marker in ["±0.000", "0.000", "±0,000"]:
            p = page("RD"); change_line(p, 40, 0, "±0.000", marker)
            f = extract_project_zero_candidates(p, "RD")[0]
            self.assertEqual(f["localZero"], "0"); self.assertEqual(f["value"], "159.95")
        for marker in ["±0.001", "-0.000", "0", "0.000±0.1"]:
            p = page("RD"); change_line(p, 40, 0, "±0.000", marker)
            self.assertEqual(extract_project_zero_candidates(p, "RD"), [])

    def test_ranges_alternatives_thousands_uncertainty_abstain(self):
        for stage, bi, li, old in [("PD", 0, 8, "159,95"), ("RD", 40, 0, "159.95")]:
            for raw in ["159.95–160.0", "159.95-160.0", "159.95/160", "159.95 или 160", "1 159.95",
                        "0159.95", "±159.95", "159.95±0.1", "не менее 159.95", "1e3", "NaN", "9" * 65]:
                with self.subTest(stage=stage, raw=raw):
                    p = page(stage); change_line(p, bi, li, old, raw)
                    self.assertEqual(extract_project_zero_candidates(p, stage), [])

    def test_quotes_negation_wrong_floor_and_units_abstain(self):
        cases = [("PD", 0, 8, "За относительную", "«За относительную"),
                 ("PD", 0, 8, "принята", "не принята"), ("PD", 0, 8, " м.", " мм."),
                 ("PD", 0, 8, " м.", " М."), ("PD", 0, 9, "чистого пола", "перекрытия"),
                 ("PD", 0, 9, "1-м", "2-м"), ("PD", 0, 9, "этаже.", "этаже, кроме корпуса2."),
                 ("RD", 40, 0, "принята", "предположительно принята"),
                 ("RD", 40, 0, "первого", "второго"), ("RD", 40, 0, "За", "Не За"),
                 ("RD", 40, 0, "За", '"За'), ("RD", 32, 19, "метрах", "миллиметрах"),
                 ("RD", 32, 18, "Все размеры", "Не Все размеры"),
                 ("RD", 32, 18, "Все размеры", "«Все размеры")]
        for stage, bi, li, old, new in cases:
            with self.subTest(stage=stage, new=new):
                p = page(stage); change_line(p, bi, li, old, new)
                self.assertEqual(extract_project_zero_candidates(p, stage), [])

    def test_duplicate_even_malformed_project_zero_anchor_abstains(self):
        for stage in ["PD", "RD"]:
            for text in ["За относительную отметку ???", "«За относительную отметку 0,000...»,",
                         "За относительную\nотметку ???"]:
                with self.subTest(stage=stage, text=text):
                    p = page(stage)
                    if "\n" in text:
                        p["blocks"].append({"text": text, "bboxMilliPoints": [1000, 1000, 20000, 26000],
                                            "lineBboxesMilliPoints": [[1000, 14000, 20000, 26000], [1000, 1000, 20000, 13000]]})
                    else: append_line(p, text)
                    self.assertEqual(extract_project_zero_candidates(p, stage), [])

    def test_missing_competing_conflicting_or_scope_ambiguous_unit_abstains(self):
        for kind in ["missing", "duplicate", "conflict", "alternative-verb", "latin-unit", "malformed", "size-conflict", "quote", "prefix"]:
            with self.subTest(kind=kind):
                p = page("RD")
                if kind == "missing": change_line(p, 32, 19, "отметки - в метрах.", "Примечание отсутствует.")
                elif kind == "duplicate": append_line(p, "отметки - в метрах.")
                elif kind == "conflict": append_line(p, "Отметки указаны в миллиметрах.")
                elif kind == "alternative-verb": append_line(p, "Высотные отметки принимаются в сантиметрах.")
                elif kind == "latin-unit": append_line(p, "Отметки выражены в cm.")
                elif kind == "malformed": append_line(p, "отметки - ???")
                elif kind == "size-conflict": append_line(p, "Все размеры указаны в сантиметрах.")
                elif kind == "quote": change_line(p, 32, 19, "отметки - в метрах.", "«отметки - в метрах.»")
                else: change_line(p, 32, 19, "отметки - в метрах.", "Кроме корпуса2 отметки - в метрах.")
                self.assertEqual(extract_project_zero_candidates(p, "RD"), [])

    def test_shifted_nonadjacent_and_other_column_geometry_abstain(self):
        cases = [("PD", 0, 9, 1200, 0), ("PD", 0, 9, 0, -5000),
                 ("RD", 32, 19, 1200, 0), ("RD", 32, 19, 0, -3000),
                 ("RD", 40, 0, 850000, 0)]
        for stage, bi, li, dx, dy in cases:
            with self.subTest(stage=stage, bi=bi, dx=dx, dy=dy):
                p = page(stage); shift_line(p, bi, li, dx, dy)
                self.assertEqual(extract_project_zero_candidates(p, stage), [])
        p = page("RD")
        for li in [18, 19]: shift_line(p, 32, li, 850000)
        self.assertEqual(extract_project_zero_candidates(p, "RD"), [])

    def test_interleaved_or_overlapping_nonempty_original_line_abstains(self):
        for stage, box in [("PD", [90000, 675000, 100000, 677000]),
                           ("RD", [100000, 429000, 150000, 433000]),
                           ("RD", [100000, 610000, 150000, 615000])]:
            with self.subTest(stage=stage, box=box):
                p = page(stage); append_line(p, "Инородная строка", box)
                self.assertEqual(extract_project_zero_candidates(p, stage), [])

    def test_exact_line_geometry_required_and_all_page_boxes_valid(self):
        for stage, bi in [("PD", 0), ("RD", 40), ("RD", 32)]:
            for kind in ["absent", "coarse", "wrong-count", "out-of-page", "float", "bool", "reversed", "block-union"]:
                with self.subTest(stage=stage, bi=bi, kind=kind):
                    p = page(stage); b = p["blocks"][bi]
                    if kind == "absent": del b["lineBboxesMilliPoints"]
                    elif kind == "coarse": b["lineBboxesMilliPoints"] = [b["bboxMilliPoints"][:] for _ in b["text"].split("\n")]
                    elif kind == "wrong-count": b["lineBboxesMilliPoints"].pop()
                    elif kind == "out-of-page": b["lineBboxesMilliPoints"][0][2] = p["widthMilliPoints"] + 1
                    elif kind == "float": b["lineBboxesMilliPoints"][0][0] = 1.5
                    elif kind == "bool": b["lineBboxesMilliPoints"][0][0] = True
                    elif kind == "reversed": b["lineBboxesMilliPoints"][0][2] = 0
                    else: b["bboxMilliPoints"][0] += 1
                    self.assertEqual(extract_project_zero_candidates(p, stage), [])
        p = page("PD"); p["blocks"][-1]["bboxMilliPoints"][3] = p["heightMilliPoints"] + 1
        self.assertEqual(extract_project_zero_candidates(p, "PD"), [])

    def test_quality_wrong_stage_newline_and_extra_shape_reject(self):
        for stage in ["PD", "RD"]:
            for wrong in ["ID", "UNRESOLVED", "pd", None, [], 1, "RD" if stage == "PD" else "PD"]:
                with self.subTest(stage=stage, wrong=wrong): self.assertEqual(extract_project_zero_candidates(page(stage), wrong), [])
            for kind in ["quality", "page-number", "extra-page", "extra-block", "newline", "unicode-separator"]:
                with self.subTest(stage=stage, kind=kind):
                    p = page(stage); bi, li = (0, 8) if stage == "PD" else (40, 0)
                    if kind == "quality": p["quality"]["disposition"] = "OCR_REQUIRED"
                    elif kind == "page-number": p["pageNumber"] = True
                    elif kind == "extra-page": p["approved"] = True
                    elif kind == "extra-block": p["blocks"][bi]["approved"] = True
                    elif kind == "newline": change_line(p, bi, li, "принята", "при\nнята")
                    else: change_line(p, bi, li, "принята", "при\u2028нята")
                    self.assertEqual(extract_project_zero_candidates(p, stage), [])

    def test_no_source_id_or_page_number_allowlist_and_no_data_mutation(self):
        f = copy.deepcopy(FIXTURE); before = copy.deepcopy(f)
        for item in f["sources"]:
            stage = item["source"]["stage"]; p = item["sourceArtifact"]["pages"][item["provenance"]["targetOriginalPdfPage"] - 1]
            first, second = extract_project_zero_candidates(p, stage), extract_project_zero_candidates(p, stage)
            self.assertEqual(first, second); self.assertTrue(f == before, "Full source fixture mutated")
            first[0]["primaryFragments"][0]["bboxMilliPoints"][0] = 0
            self.assertEqual(extract_project_zero_candidates(p, stage), second)
            original_page = p["pageNumber"]
            p["pageNumber"] = 999
            self.assertEqual(extract_project_zero_candidates(p, stage), second)
            p["pageNumber"] = original_page
        self.assertTrue(FIXTURE == before, "Original full fixture changed")


if __name__ == "__main__":
    unittest.main()
