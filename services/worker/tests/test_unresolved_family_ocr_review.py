"""Synthetic OCR v6 sidecar provenance and abstention tests."""

from __future__ import annotations

import copy
import unittest

from inspector_worker.durable_ocr_layout import PROFILE_HASH_V6, PROFILE_ID_V6, PROFILE_V6
from inspector_worker.run_candidate_family_preview import _hash
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
from inspector_worker.unresolved_family_ocr_review import evaluate_unresolved_family_ocr_review


OBJECT = "OBJECT-SYNTHETIC"
MANIFEST = "a" * 64
AR_LINE = "Высота дверного проема 2100 мм"
VK_LINE = "Водоснабжение труба полипропиленовая; канализация труба чугунная"


def source(source_id: str, section: str | None, *, approval: str = "APPROVED") -> tuple[dict, dict]:
    sha = _hash({"source": source_id})
    raw = {"sourceFileId": source_id, "objectId": OBJECT, "sha256": sha,
           "byteSize": 100, "mediaType": "application/pdf", "stages": ["PD"],
           "sectionCode": section}
    decision = ({"sourceSha256": sha, "revisionStatus": "CURRENT",
                 "approvalStatus": approval, "sectionCode": section,
                 "pageStages": {}, "basis": {"reference": "synthetic review"}}
                if section is not None else None)
    return raw, decision


def text_artifact(raw: dict) -> dict:
    quality = qualify_page_text([])
    assert quality["disposition"] == "OCR_REQUIRED"
    return {"schemaVersion": "document-text-v2", "sourceFileId": raw["sourceFileId"],
            "inputSha256": raw["sha256"],
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS", "pageCount": 1,
            "textPageCount": 0, "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": 0, "ocrRequiredPageCount": 1},
            "pages": [{"pageNumber": 1, "widthMilliPoints": 600_000,
                       "heightMilliPoints": 800_000, "blocks": [], "quality": quality}]}


def ocr_page(raw: dict, lines: list[str]) -> dict:
    page = {"schemaVersion": "document-ocr-page-v1", "sourceFileId": raw["sourceFileId"],
            "inputSha256": raw["sha256"], "pageNumber": 1,
            "render": {"sha256": _hash({"render": raw["sourceFileId"]}),
                       "widthPx": 1000, "heightPx": 1334, "dpi": PROFILE_V6["dpi"],
                       "rendererProfileId": PROFILE_V6["rendererProfileId"]},
            "provider": {"profileId": PROFILE_V6["ocrProviderProfileIds"][0],
                         "script": PROFILE_V6["script"]},
            "lines": [{"text": line, "score": 0.9,
                       "bboxPx": [10, index * 20 + 10, 900, index * 20 + 25]}
                      for index, line in enumerate(lines)]}
    page["contentHash"] = _hash(page)
    return page


def fixture(*, unreviewed: bool = False) -> tuple[list[dict], dict, list[dict], dict]:
    ar, ar_decision = source("AR", None if unreviewed else "AR")
    vk, vk_decision = source("VK", "VK")
    sources = [ar, vk]
    decisions = {"VK": vk_decision}
    if ar_decision is not None:
        decisions["AR"] = ar_decision
    texts = [text_artifact(ar), text_artifact(vk)]
    rows = []
    for raw, lines in ((ar, [AR_LINE] if not unreviewed else []), (vk, [VK_LINE])):
        selected = raw["sourceFileId"] != "AR" or not unreviewed
        pages = [ocr_page(raw, lines)] if selected else []
        rows.append({"sourceFileId": raw["sourceFileId"], "sourceSha256": raw["sha256"],
                     "mediaType": "application/pdf", "pageCount": 1,
                     "status": "SCANNED" if selected else "SKIPPED_SOURCE_REVIEW_REQUIRED",
                     "ocrRequiredPageCount": 1, "processedPageCount": len(pages),
                     "deferredPageCount": 1 - len(pages), "pages": pages,
                     "skippedRenderPixelPageCount": 0,
                     "reviewEligiblePageCount": 1 if selected else 0,
                     "stageUnresolvedPageCount": 0,
                     "selectionReasonCodes": [] if selected else ["SOURCE_REVIEW_REQUIRED"]})
    processed = sum(row["processedPageCount"] for row in rows)
    stage = {"schemaVersion": "analysis-stage-result-v2",
             "jobType": "DOCUMENT_OCR_LAYOUT", "inputManifestHash": MANIFEST,
             "disposition": "OCR_LAYOUT_BOUNDED", "reasonCode": "BOUNDED_OCR_ONLY",
             "providerKind": "OCR_LAYOUT", "providerProfileId": PROFILE_ID_V6,
             "providerConfigHash": PROFILE_HASH_V6, "outputCount": processed,
             "analysis": {"schemaVersion": "bounded-ocr-layout-analysis-v6",
                          "objectId": OBJECT, "inputManifestHash": MANIFEST,
                          "profile": PROFILE_V6, "sources": rows, "sourceCount": 2,
                          "ocrRequiredPageCount": 2, "processedPageCount": processed,
                          "deferredPageCount": 2 - processed,
                          "skippedOversizePageCount": 0,
                          "skippedUnsupportedSourceCount": 0,
                          "skippedRenderPixelPageCount": 0,
                          "reviewEligiblePageCount": processed,
                          "stageUnresolvedPageCount": 0}}
    return sources, decisions, texts, stage


def evaluate(sources: list[dict], decisions: dict, texts: list[dict], stage: dict,
             *, stage_hash: str | None = None) -> dict:
    return evaluate_unresolved_family_ocr_review(
        OBJECT, MANIFEST, sources, decisions, texts, stage,
        stage_sha256=stage_hash or _hash(stage))


class UnresolvedFamilyOcrReviewTests(unittest.TestCase):
    def test_exact_lines_are_review_only_sha_bound_and_deterministic(self) -> None:
        sources, decisions, texts, stage = fixture()
        output = evaluate(sources, decisions, texts, stage)
        self.assertEqual(output, evaluate(sources[::-1], decisions, texts[::-1], stage))
        self.assertEqual(output["contentHash"], _hash({key: value for key, value in output.items()
                                                       if key != "contentHash"}))
        self.assertEqual(output["schemaVersion"], "unresolved-family-ocr-review-v1")
        self.assertEqual(output["ocrStageSha256"], _hash(stage))
        self.assertIsNone(output["findingCount"])
        self.assertIsNone(output["parameterCoverage"])
        self.assertEqual([len(row["leads"]) for row in output["codeRows"]], [1, 1, 1])
        for row in output["codeRows"]:
            self.assertEqual(row["status"], "ABSTAIN")
            self.assertIn("OCR_TEXT_REQUIRES_VISUAL_REVIEW", row["reasonCodes"])
            lead = row["leads"][0]
            self.assertEqual(lead["ocrStageSha256"], _hash(stage))
            self.assertEqual(lead["coordinateSystem"], "IMAGE_TOP_LEFT_PIXELS")
            self.assertEqual(lead["lineIndex"], 0)
            self.assertEqual(lead["bboxPx"], [10, 10, 900, 25])
            self.assertEqual(lead["leadSha256"], _hash({key: value for key, value in lead.items()
                                                        if key != "leadSha256"}))
        self.assertEqual(len(output["sourceStageArtifacts"]), 2)

    def test_unreviewed_source_defers_and_abstains(self) -> None:
        sources, decisions, texts, stage = fixture(unreviewed=True)
        output = evaluate(sources, decisions, texts, stage)
        ar = output["codeRows"][0]
        self.assertEqual(ar["leads"], [])
        self.assertTrue({"SOURCE_REVIEW_REQUIRED", "OCR_PAGES_DEFERRED",
                         "NO_ELIGIBLE_REVIEWED_SOURCE", "NO_EXACT_LINE_LEAD"}
                        .issubset(ar["reasonCodes"]))
        self.assertEqual([len(row["leads"]) for row in output["codeRows"]], [0, 1, 1])

    def test_same_line_only_and_limit(self) -> None:
        sources, decisions, texts, stage = fixture()
        page = stage["analysis"]["sources"][0]["pages"][0]
        page["lines"] = [{"text": f"Высота двери {index} мм", "score": 0.9,
                          "bboxPx": [10, 10 + index * 20, 900, 25 + index * 20]}
                         for index in range(20)]
        page["lines"].append({"text": "Высота 2100 мм", "score": 0.9,
                              "bboxPx": [10, 410, 900, 425]})
        page["lines"].append({"text": "двери", "score": 0.9,
                              "bboxPx": [10, 430, 900, 445]})
        page["contentHash"] = _hash({key: value for key, value in page.items()
                                     if key != "contentHash"})
        row = evaluate(sources, decisions, texts, stage)["codeRows"][0]
        self.assertEqual(len(row["leads"]), 16)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])
        self.assertEqual([lead["lineIndex"] for lead in row["leads"]], list(range(16)))

    def test_stale_stage_and_text_sha_rejected(self) -> None:
        sources, decisions, texts, stage = fixture()
        old_hash = _hash(stage)
        bad = copy.deepcopy(stage)
        bad["analysis"]["sources"][0]["pages"][0]["lines"][0]["text"] = "changed"
        with self.assertRaisesRegex(ValueError, "stage SHA mismatch"):
            evaluate(sources, decisions, texts, bad, stage_hash=old_hash)
        bad_texts = copy.deepcopy(texts)
        bad_texts[0]["inputSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate(sources, decisions, bad_texts, stage)

    def test_forged_page_line_geometry_and_v5_rejected(self) -> None:
        sources, decisions, texts, stage = fixture()
        for mutate, message in (
            (lambda bad: bad["analysis"]["sources"][0]["pages"][0].update(pageNumber=2),
             "v6 selection"),
            (lambda bad: bad["analysis"]["sources"][0]["pages"][0]["lines"][0]
             .update(bboxPx=[10, 10, 2000, 25]), "geometry"),
            (lambda bad: bad["analysis"]["sources"][0]["pages"][0]["lines"][0]
             .update(text="Высота двери 2000 мм"), "contentHash"),
            (lambda bad: bad.update(providerProfileId="local-bounded-ocr-layout-v5"),
             "v6 profile"),
        ):
            bad = copy.deepcopy(stage)
            mutate(bad)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                evaluate(sources, decisions, texts, bad)
        bad = copy.deepcopy(stage)
        bad["analysis"]["sources"][0]["pages"][0]["render"]["widthPx"] = 1300
        page = bad["analysis"]["sources"][0]["pages"][0]
        page["contentHash"] = _hash({key: value for key, value in page.items()
                                     if key != "contentHash"})
        with self.assertRaisesRegex(ValueError, "geometry differs"):
            evaluate(sources, decisions, texts, bad)


if __name__ == "__main__":
    unittest.main()
