"""KR material and fire rating terms are unlinked review navigation."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.material_class_review import (
    MAX_LEADS_PER_CODE, _classify_line, _lines, _page_has_rating_requirements,
    evaluate_material_class_review, execute_durable_material_class_review,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-MATERIAL"
MANIFEST = "a" * 64
PUBLIC = {
    "F0106": (Path("/tmp/inspector-fact-public-20260927/F0106.pdf"),
              "ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655"),
    "F0140": (Path("/tmp/inspector-fact-public-20260927/F0140.pdf"),
              "2c46f909396f33e4286637319fe4829d8d4cf6742c0e7337577dfdc4127ab085"),
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str, *, stages: list[str] | None = None, section: str = "KR",
           revision: str = "CURRENT", approval: str = "APPROVED",
           page_stages: dict[str, str] | None = None) -> dict:
    return {"sourceFileId": source_id, "sha256": digest(source_id),
            "objectId": OBJECT, "stages": ["PD"] if stages is None else stages,
            "sectionCode": section, "revisionStatus": revision,
            "approvalStatus": approval, "pageStages": page_stages or {}}


def page(number: int, texts: list[str]) -> dict:
    blocks = [{"text": text, "bboxMilliPoints": [1000 + index * 100,
               1000 + index * 100, 500000, 5000 + index * 100]}
              for index, text in enumerate(texts)]
    return {"pageNumber": number, "widthMilliPoints": 600000,
            "heightMilliPoints": 800000, "blocks": blocks,
            "quality": qualify_page_text(texts)}


def artifact(src: dict, pages: list[dict]) -> dict:
    candidates = sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                     for p in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": sum(bool(p["blocks"]) for p in pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidates,
                               "ocrRequiredPageCount": len(pages) - candidates},
            "pages": pages}


class MaterialClassReviewTests(unittest.TestCase):
    def test_general_grade_requirement_and_fire_protection_are_distinct(self) -> None:
        pd = source("F-PD")
        rd = source("F-RD", stages=["RD"])
        pd_art = artifact(pd, [page(1, [
            "Арматура для железобетонных конструкций предусмотрена класса А500С",
            "Предел огнестойкости конструкций указан в таблице",
            "Колонны REI 120", "Огнезащитный состав толщиной 2 мм",
            "Примечание: сталь марки С245 для профилей"]),
            page(2, ["\ufffd сталь марки С345"]),
        ])
        rd_art = artifact(rd, [page(1, ["С245", "А500С",
                                         "Состав огнезащиты указан в разделе",
                                         "REI 120"] )])
        result = evaluate_material_class_review(OBJECT, MANIFEST,
                                                [pd, rd], [pd_art, rd_art])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        self.assertEqual(set(rows), {"KR-056", "KR-057", "KR-066"})
        self.assertEqual((rows["KR-056"]["leadCount"],
                          rows["KR-057"]["leadCount"],
                          rows["KR-066"]["leadCount"]), (2, 2, 5))
        self.assertEqual({lead["leadKind"] for lead in rows["KR-056"]["leads"]},
                         {"SHEET_NOTE_UNLINKED", "TABLE_HEADING_UNLINKED"})
        self.assertEqual({lead["leadKind"] for lead in rows["KR-057"]["leads"]},
                         {"GENERAL_REQUIREMENT_UNLINKED", "TABLE_HEADING_UNLINKED"})
        self.assertEqual({lead["leadKind"] for lead in rows["KR-066"]["leads"]},
                         {"FIRE_RATING_REQUIREMENT", "PROTECTION_COMPOSITION_MENTION_UNVERIFIED",
                          "FIRE_RATING_CONTEXT_UNRESOLVED"})
        for row in rows.values():
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"]), (2, 2, 1))
            self.assertIn("ELEMENT_IDENTITY_UNVERIFIED", row["reasonCodes"])
            for lead in row["leads"]:
                self.assertEqual(lead["sourceRole"], "KR_MATERIAL_NAVIGATION")
                self.assertEqual(lead["elementAssociationStatus"], "UNVERIFIED")
                self.assertEqual(lead["crossFileMatchStatus"], "UNVERIFIED")
                self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                    lead["lineText"].encode()).hexdigest())
                self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                             if k != "leadSha256"}))
                self.assertFalse({"value", "rawValue", "elementId", "materialGrade"} & set(lead))
                if row["parameterCode"] == "KR-066":
                    self.assertEqual(lead["actualProtectionStatus"], "NOT_ESTABLISHED")
        self.assertFalse(any("С345" in lead["lineText"] for lead in rows["KR-056"]["leads"]))

    def test_review_section_stage_artifact_and_quality_gates(self) -> None:
        sources = [source("F-UNKNOWN", approval="UNKNOWN"),
                   source("F-AR", section="AR"),
                   source("F-MIXED", stages=["PD", "RD"]),
                   source("F-OCR")]
        art = [artifact(s, [page(1, ["С245", "А500С", "REI 120"])])
               for s in sources[:-1]]
        art.append(artifact(sources[-1], [page(1, ["\ufffd С245 А500С REI120"]) ]))
        rows = evaluate_material_class_review(OBJECT, MANIFEST, sources, art)["codeRows"]
        for row in rows:
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["leadCount"]),
                             (1, 0, 1, 0))
            self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                             "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                             "NO_EXACT_LINE_LEAD"}.issubset(row["reasonCodes"]))
        src = source("F-SHA")
        text = artifact(src, [page(1, ["С245", "А500С"])])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_material_class_review(OBJECT, "bad", [src], [text])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_material_class_review(OBJECT, MANIFEST, [src, src], [text])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_material_class_review(OBJECT, MANIFEST, [src], [text, text])
        wrong_sha = copy.deepcopy(text)
        wrong_sha["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_material_class_review(OBJECT, MANIFEST, [src], [wrong_sha])
        tampered = copy.deepcopy(text)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_material_class_review(OBJECT, MANIFEST, [src], [tampered])

    def test_rating_and_protection_on_same_line_remains_ambiguous(self) -> None:
        self.assertEqual(_classify_line("Состав огнезащитного покрытия REI 120",
                                        rating_requirement_page=True)["KR-066"],
                         "FIRE_CONTEXT_AMBIGUOUS")
        self.assertNotIn("KR-066", _classify_line("Защитный слой бетона 45 мм",
                                                  rating_requirement_page=True))

    def test_lead_cap_preserves_total_count(self) -> None:
        src = source("F-CAP")
        text = artifact(src, [page(1, [f"Сталь марки С245 позиция {n}"
                                       for n in range(MAX_LEADS_PER_CODE + 5)])])
        row = evaluate_material_class_review(OBJECT, MANIFEST, [src], [text])["codeRows"][0]
        self.assertEqual(row["leadCount"], MAX_LEADS_PER_CODE + 5)
        self.assertEqual(len(row["leads"]), MAX_LEADS_PER_CODE)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])

    def test_durable_uses_fenced_loader(self) -> None:
        src = source("F-DURABLE")
        text = artifact(src, [page(1, ["С245"])])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.material_class_review.load_durable_candidate_family_inputs",
                   return_value=([src], [text])) as loader:
            result = execute_durable_material_class_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")

    @unittest.skipUnless(all(path.is_file() for path, _ in PUBLIC.values()),
                         "public originals unavailable")
    def test_sha_checked_public_pages_keep_requirements_and_ocr_separate(self) -> None:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTTextContainer

        for path, sha in PUBLIC.values():
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), sha)
        expected = {("F0106", 50): ("KR-057", "GENERAL_REQUIREMENT_UNLINKED"),
                    ("F0106", 51): ("KR-066", "FIRE_RATING_REQUIREMENT"),
                    ("F0140", 3): ("KR-056", "TABLE_HEADING_UNLINKED")}
        for (source_id, number), (code, kind) in expected.items():
            with self.subTest(source=source_id, page=number):
                path, _ = PUBLIC[source_id]
                layout = next(extract_pages(str(path), page_numbers={number - 1}))
                texts = [item.get_text().strip() for item in layout
                         if isinstance(item, LTTextContainer) and item.get_text().strip()]
                p = page(number, texts)
                self.assertEqual(p["quality"]["disposition"], "TEXT_LAYER_CANDIDATE")
                requirement = _page_has_rating_requirements(p)
                kinds = [found[code] for text in texts for _, line in _lines(text)
                         if (found := _classify_line(
                             line, rating_requirement_page=requirement)) and code in found]
                self.assertIn(kind, kinds)
        layout = next(extract_pages(str(PUBLIC["F0106"][0]), page_numbers={99}))
        texts = [item.get_text().strip() for item in layout
                 if isinstance(item, LTTextContainer) and item.get_text().strip()]
        self.assertEqual(page(100, texts)["quality"]["disposition"], "OCR_REQUIRED")


if __name__ == "__main__":
    unittest.main()
