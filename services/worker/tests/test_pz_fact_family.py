from __future__ import annotations

import copy
import unittest
from decimal import Decimal

from inspector_worker.pz_fact_family import extract_pz_facts, extract_pz010_observations
from inspector_worker.fact_comparison import _normalize, make_fact_id
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


SHA = "a" * 64
BOX = [1000, 1000, 300000, 3000]


def page(number: int, texts: list[str], boxes: list[list[int]] | None = None) -> dict:
    boxes = boxes or [BOX for _ in texts]
    return {
        "pageNumber": number, "widthMilliPoints": 600000,
        "heightMilliPoints": 800000,
        "blocks": [{"text": text, "bboxMilliPoints": box} for text, box in zip(texts, boxes)],
        "quality": qualify_page_text(texts),
    }


def artifact(pages: list[dict], source_id: str = "FILE-A", sha: str = SHA) -> dict:
    candidate_count = sum(item["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for item in pages)
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source_id,
        "inputSha256": sha, "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages), "textPageCount": sum(bool(item["blocks"]) for item in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {
            "textLayerCandidatePageCount": candidate_count,
            "ocrRequiredPageCount": len(pages) - candidate_count,
        },
        "pages": pages,
    }


def source(stages: list[str] | None = None, **other: object) -> dict:
    return {"sourceFileId": "FILE-A", "sha256": SHA, "objectId": "OBJECT-A",
            "stages": stages or ["PD"], **other}


def apartment_table_page() -> dict:
    """Blocks and bboxes from verified public F0101, PDF page 10."""
    texts = [
        "Количество квартир, в \nт.ч.:", "кв.", "Всего:   Примечание", "92",
        "Корпус 1  шт. \nКорпус 2  шт.", "62", "30",
        "16", "47", "21", "8",
    ]
    boxes = [
        [96600, 636966, 212606, 658506], [241980, 642726, 258687, 652746],
        [456300, 650466, 567025, 660486], [466740, 631026, 480622, 641046],
        [181740, 600066, 259407, 625566], [466740, 615546, 480622, 625566],
        [466740, 600066, 480622, 610086], [278880, 631026, 308967, 666246],
        [323880, 631026, 353967, 666246], [367620, 631026, 397707, 666246],
        [411240, 631026, 441327, 666246],
    ]
    return page(10, texts, boxes)


def apartment_artifact(table: dict | None = None) -> dict:
    pages = [page(number, []) for number in range(1, 10)]
    pages.append(table or apartment_table_page())
    return artifact(pages)


class PzFactFamilyTests(unittest.TestCase):
    def extract(self, pages: list[dict], src: dict | None = None) -> list[dict]:
        return extract_pz_facts("OBJECT-A", [src or source()], [artifact(pages)])

    def test_inline_building_volume_exact_value_and_provenance(self) -> None:
        text = "Строительный объем здания V = 60997.93 куб. м"
        facts = self.extract([page(1, [text])])
        self.assertEqual(len(facts), 1)
        fact = facts[0]
        self.assertEqual((fact["parameterCode"], fact["attribute"], fact["stage"]),
                         ("PZ-004", "BUILDING_VOLUME", "PD"))
        self.assertEqual((fact["rawValue"], fact["rawUnit"], fact["rawText"]),
                         ("60997.93", "куб. м", text))
        self.assertEqual((fact["sourceFileId"], fact["sourceSha256"], fact["objectId"]),
                         ("FILE-A", SHA, "OBJECT-A"))
        locator = fact["locator"]
        self.assertEqual(locator["kind"], "TEXT_BLOCK")
        self.assertEqual(locator["bboxMilliPoints"], BOX)
        self.assertEqual(text[locator["start"]:locator["end"]], fact["rawValue"])
        self.assertEqual(len(fact["factId"]), 64)

    def test_floor_count_from_etazhnost_with_basement_context(self) -> None:
        text = "Этажность 3+подвал"
        fact, = self.extract([page(1, [text])])
        self.assertEqual((fact["parameterCode"], fact["attribute"]),
                         ("PZ-007", "ABOVE_GROUND_FLOOR_COUNT"))
        self.assertEqual((fact["rawValue"], fact["rawUnit"], fact["rawText"]),
                         ("3", "Этажность", text))
        locator = fact["locator"]
        self.assertEqual(text[locator["start"]:locator["end"]], "3")
        self.assertEqual(_normalize(fact, "count"), Decimal("3"))

    def test_explicit_floor_unit_and_row_geometry(self) -> None:
        fact, = self.extract([page(1, ["Количество надземных этажей: 3 этажа"])])
        self.assertEqual((fact["rawValue"], fact["rawUnit"]), ("3", "этажа"))
        row = page(1, ["Этажность", "3+подвал"],
                   [[1000, 1000, 190000, 3000], [220000, 1000, 270000, 3000]])
        row_fact, = self.extract([row])
        self.assertEqual((row_fact["rawValue"], row_fact["rawUnit"]), ("3", "Этажность"))
        self.assertEqual(row_fact["labelLocator"]["text"], "Этажность")
        self.assertEqual(row_fact["unitLocator"]["text"], "Этажность")
        self.assertEqual(self.extract([page(1, ["Этажность здания\nПлощадь 12 м²"])]), [])

    def test_multi_building_scope_does_not_create_building_total(self) -> None:
        facts = self.extract([page(1, [
            "Корпус К1. Строительный объем здания 19000 м3",
            "Корпус К2. Строительный объем здания 16000 м3",
        ])])
        self.assertEqual(facts, [])
        self.assertEqual(self.extract([page(1, [
            "Строительный объем здания 19/16 м3",
        ])]), [])

    def test_wrong_sha_fails_before_extraction(self) -> None:
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            extract_pz_facts("OBJECT-A", [source()], [artifact([
                page(1, ["Строительный объем здания 60997.93 м³"])
            ], sha="b" * 64)])

    def test_ocr_required_page_not_mined_and_quality_forgery_rejected(self) -> None:
        damaged = page(1, ["Строительный объем здания 60997.93 м³ \ufffd"])
        self.assertEqual(damaged["quality"]["disposition"], "OCR_REQUIRED")
        self.assertEqual(self.extract([damaged]), [])
        forged = copy.deepcopy(damaged)
        forged["quality"] = qualify_page_text(["Строительный объем здания 60997.93 м³"])
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            self.extract([forged])

    def test_mixed_unresolved_skips_only_unreviewed_pages(self) -> None:
        pages = [page(1, ["Строительный объем здания 12 м3"]),
                 page(2, ["Строительный объем здания 13 м3"])]
        unresolved = source(["RD", "ID"], pageStages={"1": "UNRESOLVED", "2": "RD"})
        facts = self.extract(pages, unresolved)
        self.assertEqual([(fact["pageNumber"], fact["stage"], fact["rawValue"]) for fact in facts],
                         [(2, "RD", "13")])
        self.assertEqual(self.extract(pages, source(["RD", "ID"])), [])

    def test_duplicate_values_remain_distinct_proposals(self) -> None:
        text = "Строительный объем здания 60997.93 м³"
        facts = self.extract([page(1, [text, text])])
        self.assertEqual(len(facts), 2)
        self.assertEqual([fact["rawValue"] for fact in facts], ["60997.93", "60997.93"])
        self.assertNotEqual(facts[0]["factId"], facts[1]["factId"])

    def test_thousand_cubic_meters_unit_remains_raw_for_normalization(self) -> None:
        fact, = self.extract([page(1, ["Строительный объем здания 60,99793 тыс. м3"])])
        self.assertEqual((fact["rawValue"], fact["rawUnit"]), ("60,99793", "тыс. м3"))
        self.assertEqual(_normalize(fact, "m3"), Decimal("60997.93"))

    def test_geometry_row_requires_unique_aligned_label_unit_and_value(self) -> None:
        texts = ["Строительный объем здания", "м³", "60997.93"]
        boxes = [[1000, 1000, 190000, 3000], [220000, 1000, 250000, 3000],
                 [270000, 1000, 350000, 3000]]
        fact, = self.extract([page(1, texts, boxes)])
        self.assertEqual((fact["rawText"], fact["rawValue"], fact["rawUnit"]),
                         ("60997.93", "60997.93", "м³"))
        self.assertEqual(fact["labelLocator"]["text"], texts[0])
        self.assertEqual(fact["unitLocator"]["text"], texts[1])
        self.assertEqual(fact["locator"]["bboxMilliPoints"], boxes[2])
        self.assertEqual(self.extract([page(1, texts + ["60998.00"], boxes + [
            [360000, 1000, 440000, 3000]
        ])]), [])

    def test_fact_id_is_stable_across_input_order(self) -> None:
        first = page(1, ["Строительный объем здания 123 м3", "Этажность 3+подвал"])
        later = page(2, ["Строительный объем здания 456 м3"])
        left = self.extract([first, later])
        right = self.extract([copy.deepcopy(first), copy.deepcopy(later)])
        self.assertEqual(left, right)


class Pz010ObservationTests(unittest.TestCase):
    def test_verified_public_table_geometry_yields_only_total_92(self) -> None:
        text = apartment_artifact()
        facts = extract_pz010_observations("OBJECT-A", source(), text)
        self.assertEqual(len(facts), 1)
        fact = facts[0]
        self.assertEqual((fact["parameterCode"], fact["attribute"], fact["stage"]),
                         ("PZ-010", "APARTMENT_COUNT", "PD"))
        self.assertEqual((fact["pageNumber"], fact["rawText"], fact["rawValue"], fact["rawUnit"]),
                         (10, "92", "92", "кв."))
        self.assertEqual(fact["locator"], {
            "kind": "TEXT_BLOCK", "blockIndex": 3, "start": 0, "end": 2,
            "bboxMilliPoints": [466740, 631026, 480622, 641046],
        })
        self.assertEqual(fact["labelLocator"]["text"], "Количество квартир, в \nт.ч.:")
        self.assertEqual(fact["labelLocator"]["text"][fact["labelLocator"]["start"]:
                                                       fact["labelLocator"]["end"]], "Количество квартир")
        self.assertEqual(fact["unitLocator"]["text"], "кв.")
        self.assertEqual(fact["contextLocator"]["text"], "Всего:   Примечание")
        self.assertEqual(fact["contextLocator"]["text"][fact["contextLocator"]["start"]:
                                                         fact["contextLocator"]["end"]], "Всего")
        self.assertEqual(fact["factId"], make_fact_id(fact))
        self.assertFalse(any(item["parameterCode"] == "PZ-010"
                             for item in extract_pz_facts("OBJECT-A", [source()], [text])))

    def test_competing_total_or_header_abstains(self) -> None:
        table = apartment_table_page()
        table["blocks"].append({"text": "93", "bboxMilliPoints": [485000, 631026, 500000, 641046]})
        table["quality"] = qualify_page_text([block["text"] for block in table["blocks"]])
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), apartment_artifact(table)), [])

        table = apartment_table_page()
        table["blocks"].append({"text": "Всего:", "bboxMilliPoints": [455000, 650466, 520000, 660486]})
        table["quality"] = qualify_page_text([block["text"] for block in table["blocks"]])
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), apartment_artifact(table)), [])

    def test_misalignment_or_unit_not_apartment_count_abstains(self) -> None:
        table = apartment_table_page()
        table["blocks"][3]["bboxMilliPoints"] = [466740, 615546, 480622, 625566]
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), apartment_artifact(table)), [])

        table = apartment_table_page()
        table["blocks"][1]["text"] = "кв. м"
        table["quality"] = qualify_page_text([block["text"] for block in table["blocks"]])
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), apartment_artifact(table)), [])

    def test_unresolved_stage_ocr_and_wrong_hash_fail_closed(self) -> None:
        self.assertEqual(extract_pz010_observations(
            "OBJECT-A", source(["PD", "RD"], pageStages={"10": "UNRESOLVED"}),
            apartment_artifact(),
        ), [])
        table = apartment_table_page()
        table["blocks"].append({"text": "\ufffd", "bboxMilliPoints": [1000, 1000, 2000, 2000]})
        table["quality"] = qualify_page_text([block["text"] for block in table["blocks"]])
        self.assertEqual(table["quality"]["disposition"], "OCR_REQUIRED")
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), apartment_artifact(table)), [])
        bad = apartment_artifact()
        bad["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            extract_pz010_observations("OBJECT-A", source(), bad)

    def test_apartment_labels_on_plans_are_not_a_printed_total(self) -> None:
        text = artifact([page(1, ["Квартира 1", "Квартира 2", "Корпус 2"] )])
        self.assertEqual(extract_pz010_observations("OBJECT-A", source(), text), [])


if __name__ == "__main__":
    unittest.main()
