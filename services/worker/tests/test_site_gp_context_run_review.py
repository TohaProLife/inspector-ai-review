"""Five PD/GP topic leads stay review-only with source and SHA gates."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from inspector_worker.site_gp_context_run_review import (
    _LABELS, evaluate_site_gp_context_run_review,
    execute_durable_site_gp_context_run_review,
)
from services.worker.tests.test_site_tep_area_run_review import (
    FILL, MANIFEST, OBJECT, artifact, digest, source,
)


LABELS = (
    "ВЕДОМОСТЬ МАЛЫХ АРХИТЕКТУРНЫХ ФОРМ",
    "КОНСТРУКЦИИ  ДОРОЖНЫХ  ОДЕЖД (по грунту)",
    "План организации рельефа проектируемого участка запроектирован на копии",
    "границы охранных зон объектов",
    "ограждения высотой 2,5 м, протяженностью 480,0 м с учетом длины ворот и",
)
CODES = ("SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036")


class SiteGpContextRunReviewTests(unittest.TestCase):
    def test_exact_public_spellings_have_sha_bound_abstain_leads(self) -> None:
        src = source("F-GP")
        art = artifact(src, [FILL + "\n" + "\n".join(LABELS)])
        result = evaluate_site_gp_context_run_review(OBJECT, MANIFEST, [src], [art])
        self.assertEqual(result["schemaVersion"], "site-gp-context-run-review-v1")
        self.assertEqual(result["contentHash"], digest({k: v for k, v in result.items()
                                                         if k != "contentHash"}))
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]], list(CODES))
        for index, row in enumerate(result["codeRows"]):
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                              row["ocrRequiredPageCount"], row["leadCount"]), (1, 1, 0, 1))
            lead = row["leads"][0]
            self.assertEqual(lead["sourceRole"], "PD_GP_CONTEXT")
            self.assertEqual((lead["pageNumber"], lead["blockIndex"], lead["lineIndex"]),
                             (1, 0, index + 1))
            self.assertEqual(lead["sourceSha256"], src["sha256"])
            self.assertEqual(lead["textArtifactSha256"], digest(art))
            self.assertEqual(lead["leadSha256"], digest({k: v for k, v in lead.items()
                                                         if k != "leadSha256"}))
            self.assertIsNotNone(_LABELS[CODES[index]].fullmatch(LABELS[index]))

    def test_unreviewed_wrong_context_and_ocr_suppress_leads(self) -> None:
        unreviewed = source("F-A", approval="UNKNOWN")
        wrong_section = source("F-B", section="AR")
        wrong_stage = source("F-C", stages=["RD"])
        mixed = source("F-D", stages=["PD", "RD"], page_stages={"1": "PD"})
        poor = source("F-E")
        sources = [unreviewed, wrong_section, wrong_stage, mixed, poor]
        artifacts = [artifact(item, [FILL + "\n" + LABELS[0]]) for item in sources[:-1]]
        artifacts.append(artifact(poor, [FILL + "\n\ufffd " + LABELS[0]]))
        row = evaluate_site_gp_context_run_review(
            OBJECT, MANIFEST, sources, artifacts)["codeRows"][0]
        self.assertEqual(row["leads"], [])
        self.assertEqual((row["eligibleSourceCount"], row["textCandidatePageCount"],
                          row["ocrRequiredPageCount"], row["leadCount"]), (1, 0, 1, 0))
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
                         "SOURCE_STAGE_UNRESOLVED", "OCR_REQUIRED_IN_SCOPE",
                         "NO_EXACT_LINE_LEAD", "MAF_ITEM_IDENTITY_UNVERIFIED"}
                        .issubset(row["reasonCodes"]))
        for text in ("Малые архитектурные формы на территории школы",
                     "дорожная одежда 100 мм", "водоотводные лотки",
                     "границы водоохранных зон", "ограждение спортивных площадок"):
            self.assertTrue(all(pattern.fullmatch(text) is None
                                for pattern in _LABELS.values()), text)

    def test_hash_provenance_duplicates_and_bound_fail_closed(self) -> None:
        src = source("F-GP")
        art = artifact(src, [FILL + "\n" + LABELS[0]])
        with self.assertRaisesRegex(ValueError, "inputManifestHash"):
            evaluate_site_gp_context_run_review(OBJECT, "bad", [src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_site_gp_context_run_review(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "duplicate text artifact"):
            evaluate_site_gp_context_run_review(OBJECT, MANIFEST, [src], [art, art])
        bad = copy.deepcopy(art)
        bad["inputSha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_site_gp_context_run_review(OBJECT, MANIFEST, [src], [bad])
        tampered = copy.deepcopy(art)
        tampered["pages"][0]["blocks"][0]["text"] = "tampered"
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            evaluate_site_gp_context_run_review(OBJECT, MANIFEST, [src], [tampered])
        many = artifact(src, [FILL + "\n" + "\n".join([LABELS[0]] * 20)])
        row = evaluate_site_gp_context_run_review(
            OBJECT, MANIFEST, [src], [many])["codeRows"][0]
        self.assertEqual(row["leadCount"], 20)
        self.assertEqual(len(row["leads"]), 16)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])

    def test_durable_uses_fenced_loader(self) -> None:
        src = source("F-GP")
        art = artifact(src, [FILL + "\n" + LABELS[0]])
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST}
        attempt = {"attemptId": "ATT-1"}
        with patch("inspector_worker.site_gp_context_run_review.load_durable_candidate_family_inputs",
                   return_value=([src], [art])) as loader:
            result = execute_durable_site_gp_context_run_review(lease, attempt)
        loader.assert_called_once_with(lease, attempt)
        self.assertEqual(result["codeRows"][0]["leadCount"], 1)


if __name__ == "__main__":
    unittest.main()
