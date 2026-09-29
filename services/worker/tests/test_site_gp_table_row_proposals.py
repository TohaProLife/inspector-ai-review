"""SITE_GP block adjacency remains source gated and review only."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.site_gp_table_row_proposals import (
    MAX_PROPOSALS_PER_CODE, _page_proposals,
    evaluate_site_gp_table_row_proposals,
    execute_durable_site_gp_table_row_proposals,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-SITE-GP"
MANIFEST = "a" * 64
PUBLIC_F0126_SHA = "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088"
PUBLIC_F0126 = Path("/tmp/inspector-site-gp-audit-20260928/F0126.pdf")


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def box(text: str, x0: int, y0: int, x1: int, y1: int) -> dict:
    return {"text": text, "bboxMilliPoints": [x0, y0, x1, y1]}


def source(source_id: str = "F-SITE", *, stages: list[str] | None = None,
           section: str = "GP", revision: str = "CURRENT", approval: str = "APPROVED",
           page_stages: dict[str, str] | None = None) -> dict:
    return {"sourceFileId": source_id, "sha256": digest(source_id),
            "objectId": OBJECT, "stages": ["PD"] if stages is None else stages,
            "sectionCode": section, "revisionStatus": revision,
            "approvalStatus": approval, "pageStages": page_stages or {}}


def page(number: int, blocks: list[dict]) -> dict:
    return {"pageNumber": number, "widthMilliPoints": 800000,
            "heightMilliPoints": 1000000, "blocks": blocks,
            "quality": qualify_page_text([block["text"] for block in blocks])}


def artifact(src: dict, pages: list[dict]) -> dict:
    candidates = sum(item["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                     for item in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": sum(bool(p["blocks"]) for p in pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidates,
                               "ocrRequiredPageCount": len(pages) - candidates},
            "pages": pages}


def road_blocks(*, ambiguous: bool = False, count: int = 1) -> list[dict]:
    blocks = [box("КОНСТРУКЦИИ ДОРОЖНЫХ ОДЕЖД (ПРОЕЗДЫ)", 20000, 900000, 500000, 914000),
              box("Тип", 100000, 870000, 140000, 880000),
              box("Конструкция", 200000, 870000, 340000, 880000),
              box("Толщина\nслоя, м", 400000, 870000, 470000, 880000)]
    for index in range(count):
        y = 850000 - index * 10000
        blocks.append(box(f"Асфальтобетон слой {index}", 205000, y, 350000, y + 5000))
        if ambiguous and index == 0:
            blocks.append(box("Бетон дополнительный", 210000, y, 355000, y + 5000))
        blocks.append(box("0,05", 410000, y, 450000, y + 5000))
    blocks.extend([box("Устройство проезда из асфальтобетона", 10000, 430000, 80000, 435000),
                   box("тип 1", 100000, 430000, 135000, 435000)])
    return blocks


def maf_blocks(*, ambiguous: bool = False) -> list[dict]:
    blocks = [box("ВЕДОМОСТЬ МАЛЫХ АРХИТЕКТУРНЫХ ФОРМ", 100000, 900000,
                  400000, 914000),
              box("Поз.", 110000, 870000, 145000, 880000),
              box("Наименование", 200000, 870000, 320000, 880000),
              box("Кол. Примечание", 360000, 870000, 460000, 880000),
              box("1", 110000, 830000, 130000, 835000),
              box("Кашпо тип 1 инд. изг.", 205000, 830000, 315000, 835000),
              # A separate schedule on the same sheet must not be pulled in.
              box("Наименование", 600000, 870000, 700000, 880000),
              box("2", 600000, 830000, 620000, 835000)]
    if ambiguous:
        blocks.append(box("Скамья", 210000, 830000, 280000, 835000))
    return blocks


class SiteGpTableRowProposalsTests(unittest.TestCase):
    def test_road_and_maf_are_only_sha_bound_adjacencies(self) -> None:
        src = source()
        art = artifact(src, [page(1, road_blocks()), page(2, maf_blocks())])
        result = evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src], [art])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        self.assertEqual(set(rows), {"SPZU-029", "SPZU-032"})
        self.assertEqual([row["status"] for row in rows.values()], ["ABSTAIN", "ABSTAIN"])
        self.assertEqual((rows["SPZU-029"]["proposalCount"],
                          rows["SPZU-032"]["proposalCount"]), (1, 2))
        self.assertEqual({p["proposalKind"] for p in rows["SPZU-032"]["proposals"]},
                         {"ROAD_LAYER_THICKNESS_ADJACENCY",
                          "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY"})
        for row in rows.values():
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"]), (1, 2, 0))
            self.assertIn("ROW_ASSOCIATION_UNVERIFIED", row["reasonCodes"])
            for proposal in row["proposals"]:
                self.assertEqual(proposal["sourceSha256"], src["sha256"])
                self.assertEqual(proposal["textArtifactSha256"], digest(art))
                self.assertEqual(proposal["sourceRole"], "PD_GP_TABLE")
                self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
                self.assertEqual(proposal["reasonCodes"], ["ROW_ASSOCIATION_UNVERIFIED"])
                self.assertNotIn("value", proposal)
                self.assertNotIn("rawValue", proposal)
                self.assertEqual(proposal["scopedSha256"], digest({
                    k: v for k, v in proposal.items() if k != "scopedSha256"}))
                for locator in proposal["roles"].values():
                    self.assertIsInstance(locator["blockIndex"], int)
                    self.assertEqual(locator["blockTextSha256"], hashlib.sha256(
                        locator["blockText"].encode()).hexdigest())
                    self.assertEqual(len(locator["bboxMilliPoints"]), 4)
        maf = rows["SPZU-029"]["proposals"][0]
        self.assertIsNone(maf["rawQuantity"])
        self.assertEqual(maf["quantityStatus"], "UNKNOWN")
        self.assertEqual(maf["roles"]["position"]["blockText"], "1")
        self.assertEqual(maf["roles"]["name"]["blockText"], "Кашпо тип 1 инд. изг.")
        layer = next(p for p in rows["SPZU-032"]["proposals"]
                     if p["proposalKind"] == "ROAD_LAYER_THICKNESS_ADJACENCY")
        self.assertEqual(layer["unitInterpretationStatus"], "UNVERIFIED")
        self.assertEqual(layer["assemblyTypeStatus"], "UNRESOLVED")

    def test_ambiguous_alignment_abstains_without_claiming_row(self) -> None:
        src = source()
        art = artifact(src, [page(1, road_blocks(ambiguous=True)),
                             page(2, maf_blocks(ambiguous=True))])
        rows = {row["parameterCode"]: row for row in
                evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src], [art])["codeRows"]}
        self.assertTrue(any(item["reasonCode"] == "ROAD_LAYER_ALIGNMENT_AMBIGUOUS"
                            for item in rows["SPZU-032"]["abstentions"]))
        self.assertFalse(any(item["proposalKind"] == "ROAD_LAYER_THICKNESS_ADJACENCY"
                             for item in rows["SPZU-032"]["proposals"]))
        self.assertTrue(any(item["reasonCode"] == "MAF_POSITION_NAME_ALIGNMENT_AMBIGUOUS"
                            for item in rows["SPZU-029"]["abstentions"]))
        self.assertEqual(rows["SPZU-029"]["proposals"], [])

    def test_review_stage_section_quality_and_sha_gates(self) -> None:
        sources = [source("F-UNREVIEWED", approval="UNKNOWN"),
                   source("F-AR", section="AR"), source("F-RD", stages=["RD"]),
                   source("F-MIXED", stages=["PD", "RD"], page_stages={"1": "PD"}),
                   source("F-OCR")]
        arts = [artifact(src, [page(1, maf_blocks())]) for src in sources[:-1]]
        arts.append(artifact(sources[-1], [page(1, [box("\ufffd", 1, 1, 5, 5)])]))
        rows = evaluate_site_gp_table_row_proposals(
            OBJECT, MANIFEST, sources, arts)["codeRows"]
        for row in rows:
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["proposalCount"]),
                             (1, 0, 1, 0))
            self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                             "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                             "NO_UNAMBIGUOUS_ROW_PROPOSAL"}.issubset(row["reasonCodes"]))
        src = source()
        art = artifact(src, [page(1, maf_blocks())])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_site_gp_table_row_proposals(OBJECT, "bad", [src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src], [art, art])
        wrong_sha = copy.deepcopy(art)
        wrong_sha["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src], [wrong_sha])
        tampered = copy.deepcopy(art)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_site_gp_table_row_proposals(OBJECT, MANIFEST, [src], [tampered])

    def test_proposal_cap_counts_before_truncation(self) -> None:
        src = source()
        art = artifact(src, [page(1, road_blocks(count=40))])
        row = next(row for row in evaluate_site_gp_table_row_proposals(
            OBJECT, MANIFEST, [src], [art])["codeRows"]
                   if row["parameterCode"] == "SPZU-032")
        self.assertGreater(row["proposalCount"], MAX_PROPOSALS_PER_CODE)
        self.assertEqual(len(row["proposals"]), MAX_PROPOSALS_PER_CODE)
        self.assertIn("PROPOSAL_LIMIT_REACHED", row["reasonCodes"])

    def test_durable_uses_fenced_loader(self) -> None:
        src = source()
        art = artifact(src, [page(1, maf_blocks())])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.site_gp_table_row_proposals.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_site_gp_table_row_proposals(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["proposalCount"], 1)

    @unittest.skipUnless(PUBLIC_F0126.is_file(), "public F0126 original PDF unavailable")
    def test_public_original_sha_and_geometry_stays_unverified(self) -> None:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTTextContainer
        from inspector_worker.text_layer import _milli_points

        self.assertEqual(hashlib.sha256(PUBLIC_F0126.read_bytes()).hexdigest(),
                         PUBLIC_F0126_SHA)
        observed = {}
        for number, layout in enumerate(extract_pages(str(PUBLIC_F0126)), 1):
            if number not in (20, 21):
                continue
            width = max(1, round(float(layout.width) * 1000))
            height = max(1, round(float(layout.height) * 1000))
            blocks = []
            for element in layout:
                if not isinstance(element, LTTextContainer):
                    continue
                text = element.get_text().replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()
                if not text:
                    continue
                x0 = _milli_points(float(element.x0), float(layout.x0), width)
                y0 = _milli_points(float(element.y0), float(layout.y0), height)
                x1 = _milli_points(float(element.x1), float(layout.x0), width)
                y1 = _milli_points(float(element.y1), float(layout.y0), height)
                blocks.append(box(text, min(x0, x1), min(y0, y1),
                                  max(x0, x1), max(y0, y1)))
            blocks.sort(key=lambda block: (-block["bboxMilliPoints"][3],
                                           block["bboxMilliPoints"][0],
                                           block["bboxMilliPoints"][1], block["text"]))
            observed[number] = _page_proposals(page(number, blocks))
        self.assertEqual(set(observed), {20, 21})
        self.assertEqual(len(observed[20]["SPZU-032"][0]), 21)
        self.assertEqual(len(observed[20]["SPZU-032"][1]), 3)
        self.assertEqual(len(observed[21]["SPZU-029"][0]), 11)
        for number, code in ((20, "SPZU-032"), (21, "SPZU-029")):
            for proposal in observed[number][code][0]:
                self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
                self.assertEqual(proposal["reasonCodes"], ["ROW_ASSOCIATION_UNVERIFIED"])
                if code == "SPZU-029":
                    self.assertIsNone(proposal["rawQuantity"])


if __name__ == "__main__":
    unittest.main()
