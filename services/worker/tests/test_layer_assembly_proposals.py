"""Layer navigation must keep source, geometry, and review limits explicit."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.layer_assembly_proposals import (
    MAX_PROPOSALS_PER_CODE,
    _page_proposals,
    evaluate_layer_assembly_proposals,
    execute_durable_layer_assembly_proposals,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-LAYER"
MANIFEST = "a" * 64
PUBLIC_PDFS = {
    "F0126": (Path("/tmp/inspector-site-gp-audit-20260928/F0126.pdf"),
              "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088"),
    "F0104": (Path("/tmp/pz010-public-YfFSB3Oz/F0104.pdf"),
              "bbfef68dad703d33c63d73549b0c4a1007f74213a236580346262491839d80f8"),
    "F0156": (Path("/tmp/inspector-presence-original-20260928/F0156.pdf"),
              "16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf"),
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def box(text: str, x0: int, y0: int, x1: int, y1: int) -> dict:
    return {"text": text, "bboxMilliPoints": [x0, y0, x1, y1]}


def source(source_id: str, section: str, *, stages: list[str] | None = None,
           approval: str = "APPROVED", revision: str = "CURRENT",
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
    candidate_count = sum(item["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                          for item in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": sum(bool(p["blocks"]) for p in pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidate_count,
                               "ocrRequiredPageCount": len(pages) - candidate_count},
            "pages": pages}


def road_blocks() -> list[dict]:
    return [box("КОНСТРУКЦИИ ДОРОЖНЫХ ОДЕЖД (ПРОЕЗДЫ)", 20000, 900000, 500000, 914000),
            box("Тип", 100000, 870000, 140000, 880000),
            box("Конструкция", 200000, 870000, 340000, 880000),
            box("Толщина\nслоя, м", 400000, 870000, 470000, 880000),
            box("Асфальтобетон", 205000, 850000, 350000, 855000),
            box("0,05", 410000, 850000, 450000, 855000),
            box("Устройство проезда из асфальтобетона", 10000, 430000, 80000, 435000),
            box("тип 1", 100000, 430000, 135000, 435000)]


def roof_blocks() -> list[dict]:
    return [box("Конструкция кровли:", 70000, 850000, 300000, 865000),
            box("Тип 1", 80000, 810000, 130000, 825000),
            box("Филизол ЭКП – 1 слой", 140000, 770000, 330000, 785000),
            box("4,5 мм", 470000, 770000, 515000, 785000),
            box("Пароизоляция", 140000, 730000, 330000, 745000),
            box("2 мм", 470000, 730000, 515000, 745000)]


def wall_blocks(*, ambiguous: bool = False) -> list[dict]:
    blocks = [box("Тип 2", 70000, 850000, 130000, 865000),
              box("Rockwool минераловатный утеплитель", 140000, 810000, 450000, 825000),
              box("70 мм", 470000, 810000, 515000, 825000)]
    if ambiguous:
        blocks.append(box("100 мм", 475000, 810000, 525000, 825000))
    blocks.extend([box("Тип 3 Цоколь", 70000, 650000, 200000, 665000),
                   box("Rockwool утеплитель", 140000, 610000, 380000, 625000),
                   box("100 мм", 470000, 610000, 515000, 625000),
                   box("Конструкция кровли:", 70000, 450000, 300000, 465000),
                   box("Тип 1", 80000, 410000, 130000, 425000),
                   box("Rockwool утеплитель", 140000, 370000, 380000, 385000),
                   box("150 мм", 470000, 370000, 515000, 385000)])
    return blocks


class LayerAssemblyProposalsTests(unittest.TestCase):
    def test_three_codes_remain_navigation_with_exact_sha_locators(self) -> None:
        sources = [source("F-ROAD", "GP"), source("F-ROOF", "AR")]
        arts = [artifact(sources[0], [page(1, road_blocks())]),
                artifact(sources[1], [page(1, roof_blocks()), page(2, wall_blocks())])]
        result = evaluate_layer_assembly_proposals(OBJECT, MANIFEST, sources, arts)
        self.assertEqual(result["contentHash"], digest({key: value for key, value in
                                                         result.items() if key != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        self.assertEqual(tuple(rows), ("SPZU-032", "AR-044", "ZU-125"))
        self.assertEqual([row["status"] for row in rows.values()], ["ABSTAIN"] * 3)
        self.assertEqual(rows["SPZU-032"]["proposalCount"], 0)
        self.assertIn("EXISTING_SITE_GP_TABLE_ROW_REVIEW",
                      rows["SPZU-032"]["reasonCodes"])
        self.assertEqual(rows["AR-044"]["proposalCount"], 4)
        self.assertEqual(rows["ZU-125"]["proposalCount"], 1)
        for row in rows.values():
            self.assertEqual(row["absenceConclusion"], "NOT_AVAILABLE")
            self.assertIn("ROW_ASSOCIATION_UNVERIFIED", row["reasonCodes"])
            for proposal in row["proposals"]:
                self.assertEqual(proposal["rowAssociationStatus"], "UNVERIFIED")
                self.assertEqual(proposal["typeAssociationStatus"], "UNVERIFIED")
                self.assertEqual(proposal["zoneAssociationStatus"], "UNVERIFIED")
                self.assertIsNone(proposal["rawThickness"])
                self.assertIsNone(proposal["rawQuantity"])
                self.assertNotIn("value", proposal)
                self.assertEqual(proposal["scopedSha256"], digest({
                    key: value for key, value in proposal.items() if key != "scopedSha256"}))
                for locator in proposal["roles"].values():
                    self.assertEqual(locator["lineTextSha256"], hashlib.sha256(
                        locator["lineText"].encode()).hexdigest())
                    self.assertEqual(len(locator["bboxMilliPoints"]), 4)
        self.assertTrue(all(item["sourceStage"] == "PD" for row in rows.values()
                            for item in row["proposals"]))

    def test_ambiguous_alignment_and_heading_boundaries_defer(self) -> None:
        roof = page(1, roof_blocks() + [box("5 мм", 475000, 770000, 515000, 785000)])
        proposals, abstentions, _ = _page_proposals(roof, "AR-044")
        self.assertEqual(len(proposals), 2)  # heading and one unambiguous layer
        self.assertTrue(any(item["reasonCode"] == "MATERIAL_THICKNESS_ROW_UNVERIFIED"
                            for item in abstentions))
        wall = page(1, wall_blocks(ambiguous=True))
        proposals, abstentions, _ = _page_proposals(wall, "ZU-125")
        self.assertEqual(proposals, [])
        self.assertTrue(any(item["reasonCode"] == "MATERIAL_THICKNESS_ROW_UNVERIFIED"
                            for item in abstentions))
        self.assertTrue(any(item["reasonCode"] in {
            "SECTION_BOUNDARY_BETWEEN_TYPE_AND_LAYER", "WALL_TYPE_CONTEXT_UNVERIFIED"}
                            for item in abstentions))
        self.assertTrue(any(item["reasonCode"] == "ROOF_TYPE_NOT_WALL_TYPE"
                            for item in abstentions))

    def test_review_stage_section_quality_and_provenance_gates(self) -> None:
        sources = [source("F-UNREVIEWED", "AR", approval="UNKNOWN"),
                   source("F-WRONG", "OV"), source("F-RD", "AR", stages=["RD"]),
                   source("F-MIXED", "AR", stages=["PD", "RD"], page_stages={"1": "PD"}),
                   source("F-OCR", "AR")]
        arts = [artifact(src, [page(1, roof_blocks())]) for src in sources[:-1]]
        arts.append(artifact(sources[-1], [page(1, [box("\ufffd", 1, 1, 5, 5)])]))
        rows = evaluate_layer_assembly_proposals(OBJECT, MANIFEST, sources, arts)["codeRows"]
        for row in rows:
            self.assertEqual(row["proposalCount"], 0)
            self.assertIn("SOURCE_REVIEW_REQUIRED", row["reasonCodes"])
            self.assertIn("SOURCE_STAGE_UNRESOLVED", row["reasonCodes"])
        roof = next(row for row in rows if row["parameterCode"] == "AR-044")
        self.assertEqual((roof["eligibleSourceCount"], roof["textCandidatePageCount"],
                          roof["ocrRequiredPageCount"]), (1, 0, 1))
        self.assertIn("OCR_REQUIRED_DEFERRED", roof["reasonCodes"])
        good = source("F-GOOD", "AR")
        art = artifact(good, [page(1, roof_blocks())])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_layer_assembly_proposals(OBJECT, MANIFEST, [good, good], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_layer_assembly_proposals(OBJECT, MANIFEST, [good], [art, art])
        bad_sha = copy.deepcopy(art)
        bad_sha["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_layer_assembly_proposals(OBJECT, MANIFEST, [good], [bad_sha])
        tampered = copy.deepcopy(art)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_layer_assembly_proposals(OBJECT, MANIFEST, [good], [tampered])

    def test_caps_and_no_false_zero(self) -> None:
        src = source("F-ROOF", "AR")
        oversized = box("Конструкция кровли: " + "a" * 200, 70000, 850000,
                        300000, 865000)
        blocks = [oversized]
        for index in range(MAX_PROPOSALS_PER_CODE + 5):
            top = 820000 - index * 20000
            blocks.append(box("Конструкция кровли:", 70000, top,
                              300000, top + 10000))
        art = artifact(src, [page(1, blocks)])
        roof = next(row for row in evaluate_layer_assembly_proposals(
            OBJECT, MANIFEST, [src], [art])["codeRows"] if row["parameterCode"] == "AR-044")
        self.assertGreater(roof["proposalCount"], MAX_PROPOSALS_PER_CODE)
        self.assertEqual(len(roof["proposals"]), MAX_PROPOSALS_PER_CODE)
        self.assertEqual(roof["truncatedProposalCount"], 5)
        self.assertIn("PROPOSAL_LIMIT_REACHED", roof["reasonCodes"])
        self.assertEqual(roof["absenceConclusion"], "NOT_AVAILABLE")
        empty = artifact(src, [page(1, [box("\ufffd", 0, 0, 10, 10)])])
        empty_roof = next(row for row in evaluate_layer_assembly_proposals(
            OBJECT, MANIFEST, [src], [empty])["codeRows"] if row["parameterCode"] == "AR-044")
        self.assertIn("NO_SCANNED_TEXT_IN_SCOPE", empty_roof["reasonCodes"])
        self.assertNotIn("NO_SAFE_PROPOSAL_IN_SCANNED_TEXT", empty_roof["reasonCodes"])

    def test_durable_loader_is_fenced(self) -> None:
        src = source("F-ROOF", "AR")
        art = artifact(src, [page(1, roof_blocks())])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.layer_assembly_proposals.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_layer_assembly_proposals(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][1]["status"], "ABSTAIN")

    @unittest.skipUnless(all(path.is_file() for path, _ in PUBLIC_PDFS.values()),
                         "original permitted PDFs unavailable")
    def test_original_public_pdf_sha(self) -> None:
        for source_id, (path, sha) in PUBLIC_PDFS.items():
            with self.subTest(source_id=source_id):
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), sha)


if __name__ == "__main__":
    unittest.main()
