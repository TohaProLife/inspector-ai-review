"""Independent, source-shaped OCR heat-row proposals; never rule verdicts."""

from __future__ import annotations

import unittest

from inspector_worker.ocr_heat_rows import extract_ocr_heat_rows
from inspector_worker.ocr_pilot import canonical_hash


SOURCE = "FIL-35450220"
SHA = "a" * 64
MANIFEST = "b" * 64


def line(text: str, box: list[int], score: float = .98) -> dict:
    return {"text": text, "bboxPx": box, "score": score}


def page(number: int, lines: list[dict]) -> dict:
    artifact = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": SOURCE,
        "inputSha256": SHA, "pageNumber": number,
        "render": {"sha256": "c" * 64, "widthPx": 993, "heightPx": 1403,
                   "dpi": 120, "rendererProfileId": "pdfium-test"},
        "provider": {"profileId": "paddle-test", "script": "eslav"},
        "lines": lines,
    }
    artifact["contentHash"] = canonical_hash(artifact)
    return artifact


def stage(pages: list[dict]) -> dict:
    return {
        "schemaVersion": "analysis-stage-result-v2", "providerProfileId": "local-bounded-ocr-layout-v3",
        "inputManifestHash": MANIFEST,
        "analysis": {"schemaVersion": "bounded-ocr-layout-analysis-v3",
                     "inputManifestHash": MANIFEST, "sources": [{
                         "sourceFileId": SOURCE, "sourceSha256": SHA,
                         "status": "PARTIALLY_SCANNED", "pages": pages,
                     }]},
    }


def review(*, page_stages: dict[str, str] | None = None) -> dict:
    return {SOURCE: {"sourceSha256": SHA, "pageStages": page_stages if page_stages is not None else {"7": "RD", "8": "RD"},
                     "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN"}}


def source_files(stages: list[str] | None = None, sha: str = SHA) -> list[dict]:
    return [{"sourceFileId": SOURCE, "sha256": sha, "stages": stages if stages is not None else ["RD"]}]


def actual_shaped_pages() -> list[dict]:
    return [
        page(7, [
            line("Система отопления", [205, 494, 360, 521]),
            line("Расчетный расход тепла на отопление при tн = -", [204, 691, 551, 715]),
            line("26°", [202, 712, 250, 739], .91),
            line("389,893 кВт (0,335 ГкАл/чАС)", [653, 703, 854, 729], .86),
        ]),
        page(8, [
            line("Теплоснабжение вентиляции", [276, 114, 499, 142]),
            line("Расчетный расход тепла", [296, 238, 477, 265]),
            line("107,687 кВт (0,926 Гкал/час)", [652, 237, 854, 267], .85),
            line("Система горячего водоснабжения", [215, 561, 476, 589]),
            line("Максимальный расчетный расход тепла с учетом", [213, 599, 567, 626]),
            line("722,64 кВт. (0,621 Гкал/час)", [595, 607, 799, 639], .83),
            line("циркуляции", [214, 623, 304, 648]),
            line("Средний расчетный расход тепла", [214, 666, 460, 696]),
            line("225,11 кВт. (0,194 Гкал/час)", [594, 665, 798, 696], .85),
        ]),
    ]


class OcrHeatRowTests(unittest.TestCase):
    def test_v4_stage_keeps_same_review_only_extraction(self) -> None:
        committed = stage(actual_shaped_pages())
        committed["providerProfileId"] = "local-bounded-ocr-layout-v4"
        committed["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v4"
        result = extract_ocr_heat_rows(committed, review(), source_files())
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(len(result["proposals"]), 2)

    def test_v5_stage_keeps_review_only_extraction(self) -> None:
        committed = stage(actual_shaped_pages())
        committed["providerProfileId"] = "local-bounded-ocr-layout-v5"
        committed["analysis"]["schemaVersion"] = "bounded-ocr-layout-analysis-v5"
        result = extract_ocr_heat_rows(committed, review(), source_files())
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(len(result["proposals"]), 2)

    def test_real_shaped_rows_only_propose_distinct_dhw_bases(self) -> None:
        result = extract_ocr_heat_rows(stage(actual_shaped_pages()), review(), source_files())
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual([(item["component"], item["basis"]) for item in result["proposals"]], [
            ("DHW", "MAX_INCLUDING_CIRCULATION"), ("DHW", "MEAN"),
        ])
        self.assertEqual(result["proposals"][0]["values"], {"kW": "722.64", "Gcal/h": "0.621"})
        self.assertEqual(result["proposals"][0]["sourceFileId"], SOURCE)
        self.assertEqual(result["proposals"][0]["pageNumber"], 8)
        self.assertEqual(result["proposals"][0]["ocrPageContentHash"], actual_shaped_pages()[1]["contentHash"])
        evidence = result["proposals"][0]["evidence"]
        self.assertEqual([entry["role"] for entry in evidence],
                         ["section", "rowLabel", "basisContinuation", "value"])
        self.assertEqual(evidence[-1]["bboxPx"], [595, 607, 799, 639])
        self.assertEqual({item["reasonCode"] for item in result["abstentions"]},
                         {"OCR_UNIT_UNREADABLE", "PAIRED_UNITS_CONTRADICT"})

    def test_clean_heating_and_ventilation_pairs_are_separate(self) -> None:
        pages = actual_shaped_pages()
        pages[0]["lines"][3]["text"] = "389,893 кВт (0,335 Гкал/час)"
        pages[1]["lines"][2]["text"] = "1076,87 кВт (0,926 Гкал/час)"
        for artifact in pages:
            artifact["contentHash"] = canonical_hash({k: v for k, v in artifact.items() if k != "contentHash"})
        result = extract_ocr_heat_rows(stage(pages), review(), source_files())
        self.assertEqual([(item["component"], item["basis"]) for item in result["proposals"][:2]], [
            ("HEATING", "DESIGN_HEAT_RATE"), ("VENTILATION", "DESIGN_HEAT_RATE"),
        ])
        self.assertEqual(result["abstentions"], [])

    def test_unresolved_stage_blocks_every_row(self) -> None:
        result = extract_ocr_heat_rows(stage(actual_shaped_pages()), review(page_stages={"7": "RD", "8": "UNRESOLVED"}), source_files())
        self.assertEqual(result["proposals"], [])
        self.assertIn("PAGE_STAGE_UNRESOLVED", {item["reasonCode"] for item in result["abstentions"]})

    def test_missing_circulation_qualifier_blocks_maximum(self) -> None:
        lines = [line("Система горячего водоснабжения", [215, 561, 476, 589]),
                 line("Максимальный расчетный расход тепла с учетом", [213, 599, 567, 626]),
                 line("722,64 кВт. (0,621 Гкал/час)", [595, 607, 799, 639])]
        result = extract_ocr_heat_rows(stage([page(8, lines)]), review(), source_files())
        self.assertEqual(result["proposals"], [])
        self.assertEqual(result["abstentions"][0]["reasonCode"], "BASIS_AMBIGUOUS")

    def test_corrupted_kw_unit_abstains_when_gcal_remains_readable(self) -> None:
        lines = [line("Система горячего водоснабжения", [215, 561, 476, 589]),
                 line("Средний расчетный расход тепла", [214, 666, 460, 696]),
                 line("225,11 kBm. (0,194 Гкал/час)", [594, 665, 798, 696])]
        result = extract_ocr_heat_rows(stage([page(8, lines)]), review(), source_files())
        self.assertEqual(result["proposals"], [])
        self.assertEqual(result["abstentions"][0]["reasonCode"], "OCR_UNIT_UNREADABLE")

    def test_leading_zeroes_match_server_decimal_spelling(self) -> None:
        lines = [line("Система горячего водоснабжения", [215, 561, 476, 589]),
                 line("Средний расчетный расход тепла", [214, 666, 460, 696]),
                 line("000225,11 кВт. (00,194 Гкал/час)", [594, 665, 798, 696])]
        result = extract_ocr_heat_rows(stage([page(8, lines)]), review(), source_files())
        self.assertEqual(result["proposals"][0]["values"],
                         {"kW": "000225.11", "Gcal/h": "00.194"})
        self.assertEqual(result["abstentions"], [])

    def test_more_than_six_fractional_digits_abstains(self) -> None:
        for raw in ("225,1100001 кВт. (0,194 Гкал/час)",
                    "225,11 кВт. (0,1940001 Гкал/час)"):
            with self.subTest(raw=raw):
                lines = [line("Система горячего водоснабжения", [215, 561, 476, 589]),
                         line("Средний расчетный расход тепла", [214, 666, 460, 696]),
                         line(raw, [594, 665, 798, 696])]
                result = extract_ocr_heat_rows(stage([page(8, lines)]), review(), source_files())
                self.assertEqual(result["proposals"], [])
                self.assertEqual(result["abstentions"][0]["reasonCode"], "OCR_UNIT_UNREADABLE")

    def test_more_than_twelve_whole_digits_abstains(self) -> None:
        lines = [line("Система горячего водоснабжения", [215, 561, 476, 589]),
                 line("Средний расчетный расход тепла", [214, 666, 460, 696]),
                 line("0000000000225,11 кВт. (0,194 Гкал/час)", [594, 665, 798, 696])]
        result = extract_ocr_heat_rows(stage([page(8, lines)]), review(), source_files())
        self.assertEqual(result["proposals"], [])
        self.assertEqual(result["abstentions"][0]["reasonCode"], "OCR_UNIT_UNREADABLE")

    def test_duplicate_maximum_rows_do_not_pick_one(self) -> None:
        original = actual_shaped_pages()[1]["lines"]
        duplicate = [line("Максимальный расчетный расход тепла с учетом", [213, 735, 567, 762]),
                     line("722,64 кВт. (0,621 Гкал/час)", [595, 743, 799, 775]),
                     line("циркуляции", [214, 759, 304, 784])]
        result = extract_ocr_heat_rows(stage([page(8, original + duplicate)]), review(), source_files())
        self.assertEqual([(p["component"], p["basis"]) for p in result["proposals"]], [("DHW", "MEAN")])
        self.assertIn("DUPLICATE_COMPONENT_BASIS", {a["reasonCode"] for a in result["abstentions"]})

    def test_rejects_stale_source_review_hash(self) -> None:
        decisions = review()
        decisions[SOURCE]["sourceSha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "source review SHA"):
            extract_ocr_heat_rows(stage(actual_shaped_pages()), decisions, source_files())

    def test_rejects_tampered_ocr_line(self) -> None:
        pages = actual_shaped_pages()
        pages[1]["lines"][5]["text"] = "999 кВт"
        with self.assertRaisesRegex(ValueError, "contentHash"):
            extract_ocr_heat_rows(stage(pages), review(), source_files())

    def test_source_without_processed_pages_needs_no_stage_map(self) -> None:
        result = extract_ocr_heat_rows(stage([]), {}, source_files())
        self.assertEqual(result["proposals"], [])
        self.assertEqual(result["abstentions"], [])

    def test_single_stage_rd_from_manifest_needs_no_page_review(self) -> None:
        result = extract_ocr_heat_rows(stage(actual_shaped_pages()), {}, source_files())
        self.assertEqual([(item["component"], item["basis"]) for item in result["proposals"]],
                         [("DHW", "MAX_INCLUDING_CIRCULATION"), ("DHW", "MEAN")])
        self.assertEqual(len(result["abstentions"]), 2)
        self.assertEqual({item["reasonCode"] for item in result["abstentions"]},
                         {"OCR_UNIT_UNREADABLE", "PAIRED_UNITS_CONTRADICT"})

    def test_mixed_stage_requires_reviewed_page_assignment(self) -> None:
        mixed = source_files(["PD", "RD"])
        result = extract_ocr_heat_rows(stage(actual_shaped_pages()), {}, mixed)
        self.assertEqual(result["proposals"], [])
        self.assertEqual({item["reasonCode"] for item in result["abstentions"]},
                         {"PAGE_STAGE_UNRESOLVED"})
        reviewed = extract_ocr_heat_rows(stage(actual_shaped_pages()),
                                         review(page_stages={"8": "RD"}), mixed)
        self.assertEqual(len(reviewed["proposals"]), 2)

    def test_pd_and_id_single_stage_never_propose_rd(self) -> None:
        for stage_name in ("PD", "ID"):
            with self.subTest(stage_name=stage_name):
                result = extract_ocr_heat_rows(stage(actual_shaped_pages()), {},
                                               source_files([stage_name]))
                self.assertEqual(result["proposals"], [])
                self.assertEqual({item["reasonCode"] for item in result["abstentions"]},
                                 {"PAGE_STAGE_NOT_RD"})

    def test_rejects_forged_page_stage_and_stale_manifest_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "differs from source stages"):
            extract_ocr_heat_rows(stage(actual_shaped_pages()),
                                  review(page_stages={"8": "RD"}), source_files(["PD"]))
        with self.assertRaisesRegex(ValueError, "immutable manifest"):
            extract_ocr_heat_rows(stage(actual_shaped_pages()), {}, source_files(sha="c" * 64))
        with self.assertRaisesRegex(ValueError, "immutable manifest"):
            extract_ocr_heat_rows(stage(actual_shaped_pages()), {}, [])


if __name__ == "__main__":
    unittest.main()
