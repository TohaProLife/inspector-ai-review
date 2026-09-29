"""Equipment specification clues remain source-gated navigation, never facts."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from inspector_worker.equipment_spec_review import (
    MAX_LEADS_PER_CODE, _line_codes, _page_context, _lines,
    evaluate_equipment_spec_review, execute_durable_equipment_spec_review,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-EQUIPMENT"
MANIFEST = "a" * 64
F0171 = Path("/tmp/inspector-next-unresolved-audit-20260928/F0171.pdf")
F0202 = Path("/tmp/inspector-next-unresolved-audit-20260928/F0202.pdf")
PUBLIC_SHA = {
    "F0171": "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",
    "F0202": "632379a0e541f0c81e6b03e5528946730b4433939c796db4fdc1e5c3fc8b71ee",
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str = "F-EQUIPMENT", *, stages: list[str] | None = None,
           section: str = "OV", revision: str = "CURRENT", approval: str = "APPROVED",
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


SCHEDULE_HEADERS = ["Позиция", "Наименование и техническая характеристика",
                    "Количество"]


class EquipmentSpecReviewTests(unittest.TestCase):
    def test_schedule_calculation_and_register_prose_are_separate(self) -> None:
        src = source()
        art = artifact(src, [
            page(1, SCHEDULE_HEADERS + [
                "Стальной панельный радиатор PRADO Classic",
                "33-500-800", "2,501 кВт",
                "Осевой вытяжной вентилятор, L=20 м³/ч, P=10 Па",
                "Ballu Machine Eco 100"]),
            page(2, ["Расчет системы подпора ПД20",
                     "Объемный расход вентилятора Lv = 13057 м3/час",
                     "Давление вентилятора, приведённое к нормальным условиям"]),
            page(3, ["Содержание изменения", "Радиатор в помещении 270 заменен",
                     "Спецификация оборудования, изделий и материалов",
                     "Система общеобменной вентиляции. Пожарное дымоудаление"]),
        ])
        result = evaluate_equipment_spec_review(OBJECT, MANIFEST, [src], [art])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        rows = {row["parameterCode"]: row for row in result["codeRows"]}
        self.assertEqual(set(rows), {"IOS4-077", "IOS4-079", "PPM-112"})
        self.assertEqual((rows["IOS4-077"]["leadCount"],
                          rows["IOS4-079"]["leadCount"],
                          rows["PPM-112"]["leadCount"]), (2, 1, 4))
        self.assertEqual({lead["leadKind"] for lead in rows["IOS4-077"]["leads"]},
                         {"SCHEDULE_TOKEN", "REGISTER_PROSE"})
        self.assertEqual({lead["leadKind"] for lead in rows["IOS4-079"]["leads"]},
                         {"SCHEDULE_TOKEN"})
        self.assertEqual({lead["leadKind"] for lead in rows["PPM-112"]["leads"]},
                         {"CALCULATION_PROSE", "REGISTER_PROSE"})
        for row in rows.values():
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"]), (1, 3, 0))
            self.assertIn("ROW_ASSOCIATION_UNVERIFIED", row["reasonCodes"])
            for lead in row["leads"]:
                self.assertEqual(lead["sourceSha256"], src["sha256"])
                self.assertEqual(lead["textArtifactSha256"], digest(art))
                self.assertEqual(lead["sourceStage"], "PD")
                self.assertEqual(lead["sourceRole"], "OV_EQUIPMENT_NAVIGATION")
                self.assertEqual(lead["rowAssociationStatus"], "UNVERIFIED")
                self.assertEqual(lead["systemAssignmentStatus"], "UNVERIFIED")
                self.assertEqual(lead["lineTextSha256"], hashlib.sha256(
                    lead["lineText"].encode()).hexdigest())
                self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                             if k != "leadSha256"}))
                self.assertFalse({"rawValue", "value", "quantity", "model"} & set(lead))

    def test_review_stage_section_quality_and_artifact_gates(self) -> None:
        sources = [source("F-UNKNOWN", approval="UNKNOWN"),
                   source("F-WRONG", section="AR"),
                   source("F-MIXED", stages=["RD", "ID"]),
                   source("F-PAGE-STAGE", stages=["PD", "RD"],
                          page_stages={"1": "PD"}),
                   source("F-OCR")]
        arts = [artifact(item, [page(1, SCHEDULE_HEADERS + ["Радиатор PRADO Classic"])])
                for item in sources[:-1]]
        arts.append(artifact(sources[-1], [page(1, ["\ufffd радиатор"])]))
        rows = evaluate_equipment_spec_review(OBJECT, MANIFEST, sources, arts)["codeRows"]
        for row in rows:
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["leadCount"]),
                             (1, 0, 1, 0))
            self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                             "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                             "NO_EXACT_LINE_LEAD"}.issubset(row["reasonCodes"]))
        src = source()
        art = artifact(src, [page(1, SCHEDULE_HEADERS + ["Радиатор PRADO Classic"])])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_equipment_spec_review(OBJECT, "bad", [src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_equipment_spec_review(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_equipment_spec_review(OBJECT, MANIFEST, [src], [art, art])
        wrong_sha = copy.deepcopy(art)
        wrong_sha["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_equipment_spec_review(OBJECT, MANIFEST, [src], [wrong_sha])
        tampered = copy.deepcopy(art)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_equipment_spec_review(OBJECT, MANIFEST, [src], [tampered])

    def test_ambiguous_smoke_page_does_not_become_general_fan(self) -> None:
        # A nearby system heading is no proof that a generic fan belongs to it.
        context, smoke = _page_context(page(1, SCHEDULE_HEADERS + [
            "Дымоудаление", "Вентилятор осевой без номера системы"]))
        self.assertEqual(context, "SCHEDULE_TOKEN")
        self.assertTrue(smoke)
        self.assertEqual(_line_codes("Вентилятор осевой без номера системы",
                                     context=context, smoke_context=smoke), ())

    def test_lead_cap_preserves_true_count(self) -> None:
        src = source()
        art = artifact(src, [page(1, SCHEDULE_HEADERS + [
            f"Радиатор тип {index}" for index in range(MAX_LEADS_PER_CODE + 5)])])
        row = evaluate_equipment_spec_review(OBJECT, MANIFEST, [src], [art])["codeRows"][0]
        self.assertEqual(row["leadCount"], MAX_LEADS_PER_CODE + 5)
        self.assertEqual(len(row["leads"]), MAX_LEADS_PER_CODE)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])

    def test_durable_uses_fenced_loader(self) -> None:
        src = source()
        art = artifact(src, [page(1, SCHEDULE_HEADERS + ["Радиатор PRADO Classic"])])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.equipment_spec_review.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_equipment_spec_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["status"], "ABSTAIN")

    @unittest.skipUnless(F0171.is_file() and F0202.is_file(),
                         "public originals unavailable")
    def test_sha_checked_public_pages_route_only_navigation(self) -> None:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTTextContainer

        self.assertEqual(hashlib.sha256(F0171.read_bytes()).hexdigest(),
                         PUBLIC_SHA["F0171"])
        self.assertEqual(hashlib.sha256(F0202.read_bytes()).hexdigest(),
                         PUBLIC_SHA["F0202"])
        expected = {
            (F0171, 22): ("CALCULATION_PROSE", "PPM-112"),
            (F0171, 58): ("CALCULATION_PROSE", "PPM-112"),
            (F0171, 109): ("SCHEDULE_TOKEN", "IOS4-079"),
            (F0171, 133): ("SCHEDULE_TOKEN", "IOS4-077"),
            (F0202, 6): ("REGISTER_PROSE", "IOS4-077"),
            (F0202, 11): ("REGISTER_PROSE", "PPM-112"),
        }
        for (pdf, number), (kind, code) in expected.items():
            with self.subTest(pdf=pdf.name, page=number):
                layout = next(extract_pages(str(pdf), page_numbers={number - 1}))
                blocks = [{"text": item.get_text().strip()} for item in layout
                          if isinstance(item, LTTextContainer) and item.get_text().strip()]
                context, smoke = _page_context({"blocks": blocks})
                self.assertEqual(context, kind)
                hits = [line for block in blocks for _, line in _lines(block["text"])
                        if code in _line_codes(line, context=context, smoke_context=smoke)]
                self.assertTrue(hits)
                if number in (22, 58):
                    self.assertFalse(any("IOS4-079" in _line_codes(
                        line, context=context, smoke_context=smoke)
                        for block in blocks for _, line in _lines(block["text"])))


if __name__ == "__main__":
    unittest.main()
