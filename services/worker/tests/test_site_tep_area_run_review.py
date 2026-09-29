"""SITE_TEP_AREA remains bounded, source gated and review only."""

from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from inspector_worker.site_tep_area_run_review import (
    _LABELS, evaluate_site_tep_area_run_review,
    execute_durable_site_tep_area_run_review,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJ-TEST"
MANIFEST = "a" * 64
FILL = "Технические показатели генерального плана и благоустройства территории. " * 3


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str, *, section: str = "GP", stages: list[str] | None = None,
           revision: str = "CURRENT", approval: str = "APPROVED",
           page_stages: dict[str, str] | None = None) -> dict:
    return {"sourceFileId": source_id, "sha256": digest(source_id),
            "objectId": OBJECT, "stages": stages or ["PD"], "sectionCode": section,
            "revisionStatus": revision, "approvalStatus": approval,
            "pageStages": page_stages or {}}


def artifact(src: dict, page_texts: list[str]) -> dict:
    pages = []
    for number, value in enumerate(page_texts, 1):
        blocks = [{"text": value, "bboxMilliPoints": [1000, 1000, 500000, 8000]}]
        pages.append({"pageNumber": number, "widthMilliPoints": 600000,
                      "heightMilliPoints": 800000, "blocks": blocks,
                      "quality": qualify_page_text([value])})
    candidates = sum(page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                     for page in pages)
    return {"schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
            "inputSha256": src["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": len(pages), "textPageCount": len(pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": candidates,
                               "ocrRequiredPageCount": len(pages) - candidates},
            "pages": pages}


class SiteTepAreaRunReviewTests(unittest.TestCase):
    def test_exact_labels_are_only_navigation_and_sha_bound(self) -> None:
        src = source("F-TEP")
        art = artifact(src, [FILL + "\nПлощадь застройки*, в т.ч.:\n"
                        "3.1  Площадь твердых покрытий, в т.ч.:\n"
                        "3.2  Площадь озеленения, в т.ч.:"])
        result = evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src], [art])
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]],
                         ["PZ-001", "SPZU-026", "SPZU-027"])
        for index, row in enumerate(result["codeRows"]):
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["leadCount"]), (1, 1, 0, 1))
            lead = row["leads"][0]
            self.assertEqual(lead["sourceRole"], "PD_GP_TEP")
            self.assertEqual((lead["pageNumber"], lead["blockIndex"], lead["lineIndex"]),
                             (1, 0, index + 1))
            self.assertEqual(lead["sourceSha256"], src["sha256"])
            self.assertEqual(lead["textArtifactSha256"], digest(art))
            self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                         if k != "leadSha256"}))
        self.assertIn("PAVING_MATERIAL_UNRESOLVED", result["codeRows"][1]["reasonCodes"])

    def test_source_role_review_stage_quality_and_exact_context_gate(self) -> None:
        unreviewed = source("F-A", approval="UNKNOWN")
        wrong_section = source("F-B", section="AR")
        wrong_stage = source("F-C", stages=["RD"])
        mixed = source("F-D", stages=["PD", "RD"], page_stages={"1": "PD"})
        poor = source("F-E")
        sources = [unreviewed, wrong_section, wrong_stage, mixed, poor]
        line = FILL + "\nПлощадь застройки"
        artifacts = [artifact(item, [line]) for item in sources[:-1]]
        artifacts.append(artifact(poor, [FILL + "\n\ufffd Площадь застройки"]))
        row = evaluate_site_tep_area_run_review(
            OBJECT, MANIFEST, sources, artifacts)["codeRows"][0]
        self.assertEqual(row["leads"], [])
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (1, 0, 1, 0))
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                         "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                         "NO_EXACT_LINE_LEAD"}.issubset(row["reasonCodes"]))
        for text in ("Площадь объекта застройки", "Застройка 500 м2",
                     "Площадь озеленения 450 м2", "Площадь покрытий TerraWay"):
            self.assertTrue(all(pattern.fullmatch(text) is None
                                for pattern in _LABELS.values()), text)

    def test_exact_sha_checked_public_index_label_spellings(self) -> None:
        # Literal spellings/locators checked against original public ZIP and
        # v4 page artifacts: F0126 p10, F0154/F0155 p13. This test does not
        # assert that those real documents have reviewed source decisions.
        public = {
            "PZ-001": ("Площадь застройки*, в т.ч.:",
                       "2  Площадь застройки, в том числе:"),
            "SPZU-026": ("3.1  Площадь твердых покрытий, в т.ч.:",
                         "3.  Площадь покрытий, в том числе:",
                         "Площадь покрытия из бетонной плитки с"),
            "SPZU-027": ("3.2  Площадь озеленения, в т.ч.:",
                         "4  Площадь озеленения, в том числе:"),
        }
        for code, labels in public.items():
            for label in labels:
                self.assertIsNotNone(_LABELS[code].fullmatch(label), (code, label))

    def test_bad_manifest_source_and_artifact_fail_closed(self) -> None:
        src = source("F-TEP")
        art = artifact(src, [FILL + "\nПлощадь застройки"])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_site_tep_area_run_review(OBJECT, "bad", [src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src], [art, art])
        bad = copy.deepcopy(art)
        bad["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src], [bad])
        tampered = copy.deepcopy(art)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src], [tampered])

    def test_lead_limit_is_explicit_and_deterministic(self) -> None:
        src = source("F-TEP")
        art = artifact(src, [FILL + "\n" + "\n".join(
            f"{number} Площадь застройки" for number in range(20))])
        result = evaluate_site_tep_area_run_review(OBJECT, MANIFEST, [src], [art])
        row = result["codeRows"][0]
        self.assertEqual(row["leadCount"], 20)
        self.assertEqual(len(row["leads"]), 16)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])
        self.assertEqual(result, evaluate_site_tep_area_run_review(
            OBJECT, MANIFEST, [src], [art]))

    def test_durable_uses_fenced_loader(self) -> None:
        src = source("F-TEP")
        art = artifact(src, [FILL + "\nПлощадь озеленения"])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.site_tep_area_run_review.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_site_tep_area_run_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][2]["leadCount"], 1)


if __name__ == "__main__":
    unittest.main()
