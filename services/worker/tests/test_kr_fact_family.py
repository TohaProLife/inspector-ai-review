from __future__ import annotations

import copy
import unittest

from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.kr_fact_family import extract_kr_facts, extract_kr061_wall_list_observations
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


SHA = "a" * 64
SOURCE = "CUSTOM-KR-DOCUMENT"


def block(text: str, x0: int = 1000, y0: int = 1000,
          x1: int = 30_000, y1: int = 10_000) -> dict:
    return {"text": text, "bboxMilliPoints": [x0, y0, x1, y1]}


def page(number: int, blocks: list[dict]) -> dict:
    return {
        "pageNumber": number, "widthMilliPoints": 600_000,
        "heightMilliPoints": 800_000, "blocks": blocks,
        "quality": qualify_page_text([item["text"] for item in blocks]),
    }


def artifact(pages: list[dict], source_id: str = SOURCE, sha: str = SHA) -> dict:
    candidates = sum(item["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for item in pages)
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": source_id,
        "inputSha256": sha, "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages), "textPageCount": sum(bool(item["blocks"]) for item in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {"textLayerCandidatePageCount": candidates,
                           "ocrRequiredPageCount": len(pages) - candidates},
        "pages": pages,
    }


def source(source_id: str = SOURCE, sha: str = SHA, stages: list[str] | None = None) -> dict:
    return {"sourceFileId": source_id, "objectId": "OBJECT-KR", "sha256": sha,
            "stages": stages or ["PD"], "pageStages": {}}


class KrFactFamilyTests(unittest.TestCase):
    def test_concrete_and_slab_proposals_keep_exact_text_provenance(self) -> None:
        blocks = [
            block("Корпус К1: фундаментная плита B40", y0=700_000, y1=710_000),
            block("Стены подземного этажа В60", y0=680_000, y1=690_000),
            block("Лестничные марши B30", y0=660_000, y1=670_000),
            block("Плита перекрытия -2 этажа — 250 мм", y0=640_000, y1=650_000),
            block("Фундаментная плита толщиной 1200 мм", y0=620_000, y1=630_000),
        ]
        facts = extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])])
        self.assertEqual([(item["parameterCode"], item["rawValue"]) for item in facts], [
            ("KR-055", "B40"), ("KR-055", "В60"), ("KR-055", "B30"),
            ("KR-059", "250"), ("KR-058", "1200"),
        ])
        self.assertEqual([item["elementType"] for item in facts], [
            "FOUNDATION", "WALL", "STAIR", "SLAB", "FOUNDATION",
        ])
        self.assertEqual(facts[0]["zone"], "Корпус К1")
        self.assertEqual(facts[1]["floor"], "подземного этажа")
        self.assertEqual(facts[3]["floor"], "-2 этажа")
        for item in facts:
            self.assertEqual(item["schemaVersion"], "typed-fact-v1")
            self.assertEqual(item["sourceFileId"], SOURCE)
            self.assertEqual(item["sourceSha256"], SHA)
            self.assertEqual(item["factId"], make_fact_id(item))
            locator = item["locator"]
            self.assertEqual(item["rawText"], blocks[locator["blockIndex"]]["text"])
            self.assertEqual(item["rawText"][locator["start"]:locator["end"]], item["rawValue"])
            self.assertEqual(locator["bboxMilliPoints"], blocks[locator["blockIndex"]]["bboxMilliPoints"])
        self.assertEqual(facts[3]["rawUnit"], "мм")
        self.assertEqual(facts[1]["rawUnit"], "В")

    def test_strict_same_row_cells_keep_label_locator(self) -> None:
        blocks = [block("Толщина фундаментной плиты", 1_000, 100_000, 120_000, 110_000),
                  block("250 мм", 180_000, 100_000, 210_000, 110_000),
                  block("Стены", 1_000, 80_000, 120_000, 90_000),
                  block("В40", 180_000, 80_000, 210_000, 90_000)]
        facts = extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])])
        self.assertEqual([(item["rawValue"], item["attribute"]) for item in facts], [
            ("250", "FOUNDATION_THICKNESS"), ("В40", "CONCRETE_CLASS"),
        ])
        self.assertEqual([item["contextLocator"]["blockIndex"] for item in facts], [0, 2])
        self.assertEqual(facts[0]["contextLocator"]["text"], blocks[0]["text"])

    def test_concrete_class_with_material_suffix(self) -> None:
        blocks = [block("Фундаментная плита: бетон B40,F150,W6")]
        facts = extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])])
        self.assertEqual([(item["rawValue"], item["rawUnit"]) for item in facts], [("B40", "B")])

    def test_grouped_thickness_keeps_complete_number(self) -> None:
        blocks = [block("Толщина фундаментной плиты 1 200 мм")]
        facts = extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])])
        self.assertEqual([(item["rawValue"], item["rawUnit"]) for item in facts], [("1 200", "мм")])

    def test_ambiguous_multiple_zones_and_values_abstain(self) -> None:
        blocks = [block("Корпус К1: фундаментная плита 1000 мм; корпус К2: фундаментная плита 1200 мм"),
                  block("Плита перекрытия 250 мм и 300 мм", y0=20_000, y1=30_000),
                  block("Стены B40 и B60", y0=40_000, y1=50_000),
                  block("Толщина фундаментной плиты 1000 и 1200 мм", y0=60_000, y1=70_000)]
        self.assertEqual(extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])]), [])

    def test_wrong_sha_and_forged_quality_fail_closed(self) -> None:
        text_artifact = artifact([page(1, [block("Плита перекрытия 250 мм")])])
        wrong_hash = copy.deepcopy(text_artifact)
        wrong_hash["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            extract_kr_facts("OBJECT-KR", [source()], [wrong_hash])
        forged = copy.deepcopy(text_artifact)
        forged["pages"][0]["quality"] = qualify_page_text([])
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            extract_kr_facts("OBJECT-KR", [source()], [forged])

    def test_ocr_required_and_unrelated_text_produce_no_fact(self) -> None:
        pages = [page(1, [block("Плита перекрытия 250 мм �")]),
                 page(2, [block("Класс бетона B40. Шкафы и двери 250 мм")])]
        self.assertEqual(pages[0]["quality"]["disposition"], "OCR_REQUIRED")
        self.assertEqual(extract_kr_facts("OBJECT-KR", [source()], [artifact(pages)]), [])

    def test_similar_label_does_not_link_a_different_row_or_intervening_cell(self) -> None:
        blocks = [block("Фундаментная плита", 1_000, 100_000, 120_000, 110_000),
                  block("B40", 180_000, 70_000, 210_000, 80_000),
                  block("Фундаментная плита", 1_000, 50_000, 120_000, 60_000),
                  block("Бетонная подготовка", 125_000, 50_000, 170_000, 60_000),
                  block("B30", 180_000, 50_000, 210_000, 60_000)]
        self.assertEqual(extract_kr_facts("OBJECT-KR", [source()], [artifact([page(1, blocks)])]), [])

    def test_merged_table_has_no_intra_block_row_geometry(self) -> None:
        # Exact document-text-v2 rawText from public F0106 PDF p49. The block
        # has one bbox for all lines, so even adjacent labels/classes abstain.
        first = (
            "Корпус К1 (предварительно)\n"
            "· фундаментная плита\n"
            "B40;\n"
            "· пилоны, колонны, стены -3 по +1\n"
            "В60;\n"
            "В60;\n"
            "· пилоны, колонны, стены +2 до +5\n"
            "· пилоны, колонны, стены +6 до +16                                                 В50;\n"
            "· пилоны, колонны, стены +17 до +кровля                                       В40;\n"
            "В40;\n"
            "· плита -2го до кровли (кроме 1го этажа)\n"
            "В60;\n"
            "· плита 1го этажа и переходные элементы"
        )
        second = (
            "B40;\n"
            "· фундаментная плита\n"
            "В60;\n"
            "· пилоны, колонны, стены -3 по +2\n"
            "· пилоны, колонны, стены +3 до +10\n"
            "В50;\n"
            "· пилоны, колонны, стены +11 до кровли                                         В40;\n"
            "В40;\n"
            "· плита -2го до кровли (кроме 1го этажа)\n"
            "В60;\n"
            "· плита 1го этажа и переходные элементы"
        )
        pages = [page(number, []) for number in range(1, 49)]
        pages.append(page(49, [block(first), block(second, 31_000, 1000, 60_000, 10_000)]))
        self.assertEqual(extract_kr_facts("OBJECT-KR", [source("F0106")],
                                          [artifact(pages, "F0106")]), [])
        self.assertEqual(extract_kr_facts("OBJECT-KR", [source()],
                                          [artifact([page(1, [block("Фундаментная плита\nB40")])])]), [])

    def test_public_f0140_preparation_and_rebar_spacing_are_not_slab_facts(self) -> None:
        # Exact rawText from public F0140 PDF pp3/7.
        p3 = [
            block("и  -15.250  соответственно.  Под  телом  фундаментной  плиты  выполнена  бетонная  подготовка  из  бетона  В10  толщиной  100  мм.  По"),
            block("Все  несущие  железобетонные  конструкции  нулевого  цикла  кроме  фундаментной  плиты  выполнены  из  бетона  класса  В60  по", y0=20_000, y1=30_000),
        ]
        p7 = [
            block("1. Фундаментная  плита  выполнена  из  бетона  класса  В40,  марка  по  водонепроницаемости  W6,  марка  по"),
            block("бетонная подготовка толщиной 100 мм из тощего бетона В10. Гидроизоляция под фундаментной плитой  разработана в", y0=20_000, y1=30_000),
            block("шагом  1400  мм.  Допускается  фиксация  проектного  положения  арматуры  у  верхней  грани  фундаментных  плит  иными", y0=40_000, y1=50_000),
            block("Железобетонная фундаментная плита h=1200 мм\nДетали гидроизоляции см. альбом 2451.Р.ДР.ГИ \nБетонная подготовка из бетона В10 - 100 мм\nУтрамбованный грунт- см.п.14 Прим.", y0=60_000, y1=70_000),
            block("Железобетонная фундаментная плита h=1500 мм\nДетали гидроизоляции см. альбом 2451.Р.ДР.ГИ \nБетонная подготовка из бетона В10 - 100 мм\nУтрамбованный грунт- см.п.14 Прим.", y0=80_000, y1=90_000),
        ]
        pages = [page(number, p3 if number == 3 else p7 if number == 7 else [])
                 for number in range(1, 8)]
        facts = extract_kr_facts("OBJECT-KR", [source("F0140")], [artifact(pages, "F0140")])
        self.assertEqual([(fact["pageNumber"], fact["parameterCode"], fact["rawValue"])
                          for fact in facts], [(7, "KR-055", "В40"),
                                               (7, "KR-058", "1200"),
                                               (7, "KR-058", "1500")])

    def test_mixed_stage_requires_frozen_page_mapping_and_skips_unresolved(self) -> None:
        pages = [page(1, [block("Стены B40")]), page(2, [block("Стены B60")])]
        mixed = source(stages=["RD", "ID"])
        self.assertEqual(extract_kr_facts("OBJECT-KR", [mixed], [artifact(pages)]), [])
        mixed["pageStages"] = {"1": "RD", "2": "UNRESOLVED"}
        facts = extract_kr_facts("OBJECT-KR", [mixed], [artifact(pages)])
        self.assertEqual([(item["pageNumber"], item["stage"], item["rawValue"]) for item in facts],
                         [(1, "RD", "B40")])
        mixed["pageStages"] = {"1": "RD", "2": "ID"}
        self.assertEqual([item["stage"] for item in extract_kr_facts(
            "OBJECT-KR", [mixed], [artifact(pages)])], ["RD", "ID"])

    def test_fact_ids_and_order_do_not_depend_on_artifact_order(self) -> None:
        first = source("S-1", "a" * 64)
        second = source("S-2", "b" * 64)
        a = artifact([page(1, [block("Стены B40")])], "S-1", "a" * 64)
        b = artifact([page(1, [block("Лестницы B30")])], "S-2", "b" * 64)
        self.assertEqual(extract_kr_facts("OBJECT-KR", [first, second], [a, b]),
                         extract_kr_facts("OBJECT-KR", [second, first], [b, a]))

    def test_kr061_public_wall_list_is_only_unlinked_observation(self) -> None:
        # Exact pdfminer text block from SHA-pinned public F0141 p4.
        text = ("Толщина  ж/б  монолитных  стен  250мм,  300мм,  400мм,  500мм,  "
                "550мм,  600мм,  700мм,  пилоны  сечением")
        actual_box = [1_183_410, 1_101_141, 1_652_135, 1_113_041]
        pages = [page(number, [block(text, *actual_box)] if number == 4 else [])
                 for number in range(1, 5)]
        pages[3]["widthMilliPoints"] = 1_684_000
        pages[3]["heightMilliPoints"] = 1_191_000
        actual_sha = "421a34429325f424d3e29086810b1283e805d9bb3c75646508e5434b248e5d5f"
        item = artifact(pages, "F0141", actual_sha)
        src = source("F0141", actual_sha, ["RD"])
        self.assertEqual(extract_kr_facts("OBJECT-KR", [src], [item]), [])
        rows = extract_kr061_wall_list_observations("OBJECT-KR", [src], [item])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["schemaVersion"], "kr061-wall-thickness-list-observation-v1")
        self.assertEqual(rows[0]["elementScope"], "MONOLITHIC_WALLS_UNLINKED")
        self.assertEqual(rows[0]["disposition"], "OBSERVATION_ONLY")
        self.assertEqual(rows[0]["stage"], "RD")
        self.assertEqual(rows[0]["pageNumber"], 4)
        self.assertEqual([value["rawValue"] for value in rows[0]["values"]],
                         ["250", "300", "400", "500", "550", "600", "700"])
        for value in rows[0]["values"]:
            locator = value["locator"]
            self.assertEqual(rows[0]["rawText"][locator["start"]:locator["end"]], value["rawValue"])
            self.assertEqual(locator["bboxMilliPoints"], actual_box)
        self.assertEqual(rows[0]["observationId"], make_fact_id({
            key: value for key, value in rows[0].items() if key != "observationId"
        }))

    def test_kr061_exterior_wall_and_incomplete_list_are_not_observations(self) -> None:
        texts = [
            "Все наружные стены, предусмотрены толщиной 300мм. Толщина стен в подземной части",
            "Толщина стен в надземной части корпусов составляет 200, 250, 300, 350мм.",
            "Толщина ж/б монолитных стен 250, 300, 400мм",
        ]
        item = artifact([page(1, [block(text, y0=index * 20_000 + 1,
                                       y1=index * 20_000 + 10_000)
                                  for index, text in enumerate(texts)])])
        self.assertEqual(extract_kr061_wall_list_observations(
            "OBJECT-KR", [source()], [item]), [])


if __name__ == "__main__":
    unittest.main()
