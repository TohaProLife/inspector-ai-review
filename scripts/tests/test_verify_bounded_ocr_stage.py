from __future__ import annotations

import hashlib
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest

try:
    import fitz
except ImportError:  # document-ai runtime intentionally omits PyMuPDF.
    fitz = None


SCRIPT = Path(__file__).resolve().parents[1] / "verify-bounded-ocr-stage.py"
SPEC = importlib.util.spec_from_file_location("verify_bounded_ocr_stage", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


def canonical(value: dict) -> bytes:
    return verifier.canonical(value)


def write_json(path: Path, value: dict) -> str:
    payload = canonical(value)
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


class VerifyBoundedOcrSelectionV4Tests(unittest.TestCase):
    def test_title_recovery_requires_decoding_anomaly_on_opening_page(self) -> None:
        pages = [
            {"pageNumber": number, "widthMilliPoints": 595_000,
             "heightMilliPoints": 842_000, "blocks": [],
             "quality": {"disposition": "OCR_REQUIRED",
                         "reasonCodes": ["TEXT_DECODING_ANOMALY"] if number == 1 else []}}
            for number in (1, 2, 3)
        ]
        prepared = [{"sourceId": "FIL-TEST", "oversize": False, "text": {"pages": pages}}]
        self.assertEqual(verifier.select_v4_pages(prepared)["FIL-TEST"], ([1], 0, 0, 1))
        pages[0]["quality"]["reasonCodes"] = []
        self.assertEqual(verifier.select_v4_pages(prepared)["FIL-TEST"], ([], 0, 0, 0))

    def test_subject_window_takes_priority_over_title_recovery(self) -> None:
        pages = [
            {"pageNumber": 1, "widthMilliPoints": 595_000, "heightMilliPoints": 842_000,
             "blocks": [{"text": "Разрешение Обозначение АНО-РД-ОВ"}],
             "quality": {"disposition": "TEXT_LAYER_CANDIDATE", "reasonCodes": []}},
            {"pageNumber": 2, "widthMilliPoints": 595_000, "heightMilliPoints": 842_000,
             "blocks": [], "quality": {"disposition": "OCR_REQUIRED",
                                       "reasonCodes": ["TEXT_DECODING_ANOMALY"]}},
            {"pageNumber": 3, "widthMilliPoints": 595_000, "heightMilliPoints": 842_000,
             "blocks": [{"text": "Основные показатели по рабочим чертежам марки ОВ "
                                  "На отопление Тепловой поток"}],
             "quality": {"disposition": "TEXT_LAYER_CANDIDATE", "reasonCodes": []}},
        ]
        prepared = [{"sourceId": "FIL-TEST", "oversize": False, "text": {"pages": pages}}]
        self.assertEqual(verifier.select_v4_pages(prepared)["FIL-TEST"], ([2], 0, 1, 0))

    def test_v5_four_page_cap_preserves_v4_two_page_cap(self) -> None:
        pages = [
            {"pageNumber": number, "widthMilliPoints": 595_000,
             "heightMilliPoints": 842_000, "blocks": [],
             "quality": {"disposition": "OCR_REQUIRED", "reasonCodes": []}}
            for number in range(1, 7)
        ]
        pages[0]["blocks"] = [{"text": "Разрешение Обозначение АНО-РД-ОВ"}]
        pages[0]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        pages[5]["blocks"] = [{"text": "Основные показатели по рабочим чертежам марки ОВ. "
                                      "На отопление. Тепловой поток"}]
        pages[5]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        prepared = [{"sourceId": "FIL-TEST", "oversize": False, "text": {"pages": pages}}]
        self.assertEqual(verifier.select_v4_pages(prepared)["FIL-TEST"],
                         ([2, 3], 0, 4, 0))
        self.assertEqual(verifier.select_v4_pages(prepared, verifier.PROFILE_V5)["FIL-TEST"],
                         ([2, 3, 4, 5], 0, 4, 0))
        self.assertEqual(verifier.digest(canonical(verifier.PROFILE_V5)),
                         "d7e4e78dcea591d30587022f9d57360e0cc227607f577ab10f896c69d94b37a7")


class VerifyBoundedOcrStageTests(unittest.TestCase):
    def setUp(self) -> None:
        if fitz is None:
            self.skipTest("PyMuPDF==1.27.2.2 required for synthetic PDF fixtures")
        try:
            from importlib.metadata import version
            if version("pypdfium2") != "5.12.1":
                self.skipTest("pypdfium2==5.12.1 required")
            import pypdfium2  # noqa: F401
        except (ImportError, ModuleNotFoundError):
            self.skipTest("pypdfium2==5.12.1 required")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pdf = self.root / "public.pdf"
        document = fitz.open()
        for index in range(3):
            page = document.new_page(width=240, height=180)
            page.draw_rect(fitz.Rect(20 + index * 5, 30, 90, 80),
                           color=(1, 0, 0), fill=(1, 0, 0))
        document.save(self.pdf)
        document.close()
        self.source_sha = verifier.sha256_file(self.pdf)
        self.file_id = "F0001"
        self.source_id = "FIL-TEST"
        self.manifest = self.root / "document_manifest.jsonl"
        self.manifest_entry = {
            "file_id": self.file_id, "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "extension": ".pdf", "sha256": self.source_sha,
            "size_bytes": self.pdf.stat().st_size, "pdf_pages": 3,
        }
        self.write_manifest()
        self.text_path = self.root / "text.json"
        self.text = {
            "schemaVersion": "document-text-v2", "sourceFileId": self.source_id,
            "inputSha256": self.source_sha, "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": 3, "textPageCount": 0,
            "qualityPolicyVersion": "text-layer-quality-v1",
            "qualitySummary": {"ocrRequiredPageCount": 3,
                               "textLayerCandidatePageCount": 0},
            "pages": [{"pageNumber": number, "quality": {"disposition": "OCR_REQUIRED"}}
                      for number in (1, 2, 3)],
        }
        self.text_sha = write_json(self.text_path, self.text)
        self.artifact_path = self.root / "stage.json"
        import pypdfium2 as pdfium
        from PIL import Image  # noqa: F401
        source = pdfium.PdfDocument(self.pdf.read_bytes())
        pages = []
        try:
            for number in (1, 2):
                bitmap = source[number - 1].render(scale=120 / 72,
                                                   rev_byteorder=True)
                image = bitmap.to_pil().convert("RGB")
                output = BytesIO()
                image.save(output, format="PNG", optimize=False)
                page = {
                    "schemaVersion": "document-ocr-page-v1",
                    "sourceFileId": self.source_id, "inputSha256": self.source_sha,
                    "pageNumber": number,
                    "render": {"sha256": hashlib.sha256(output.getvalue()).hexdigest(),
                               "widthPx": image.width, "heightPx": image.height,
                               "dpi": 120, "rendererProfileId": verifier.RENDERER_PROFILE},
                    "provider": {"profileId": "synthetic-ocr-provider", "script": "eslav"},
                    "lines": [{"text": "TEST", "score": 0.9,
                               "bboxPx": [10, 12, 70, 30]}],
                }
                page["contentHash"] = verifier.digest(canonical(page))
                pages.append(page)
        finally:
            source.close()
        self.artifact = {
            "schemaVersion": "analysis-stage-result-v2", "jobType": "DOCUMENT_OCR_LAYOUT",
            "inputManifestHash": "a" * 64, "disposition": "OCR_LAYOUT_BOUNDED",
            "reasonCode": "BOUNDED_OCR_ONLY", "providerKind": "OCR_LAYOUT",
            "providerProfileId": "local-bounded-ocr-layout-v1",
            "providerConfigHash": verifier.digest(canonical(verifier.PROFILE)),
            "outputCount": 2,
            "analysis": {
                "schemaVersion": "bounded-ocr-layout-analysis-v1", "objectId": "OBJ-TEST",
                "inputManifestHash": "a" * 64, "profile": verifier.PROFILE,
                "sources": [{"sourceFileId": self.source_id,
                             "sourceSha256": self.source_sha, "mediaType": "application/pdf",
                             "pageCount": 3, "status": "PARTIALLY_SCANNED_PAGE_BUDGET",
                             "ocrRequiredPageCount": 3, "processedPageCount": 2,
                             "deferredPageCount": 1, "pages": pages}],
                "sourceCount": 1, "ocrRequiredPageCount": 3,
                "processedPageCount": 2, "deferredPageCount": 1,
                "skippedOversizePageCount": 0, "skippedUnsupportedSourceCount": 0,
            },
        }
        self.artifact_sha = write_json(self.artifact_path, self.artifact)

    def write_manifest(self) -> None:
        self.manifest.write_text(json.dumps(self.manifest_entry) + "\n", encoding="utf-8")

    def run_verify(self) -> dict:
        return verifier.verify(
            self.manifest, self.artifact_path, self.artifact_sha,
            {self.file_id: (self.source_id, self.pdf)},
            {self.file_id: (self.text_path, self.text_sha)},
            expected_object_id="OBJ-TEST", expected_input_manifest_hash="a" * 64,
        )

    def configure_v2_two_sources(self) -> tuple[dict, dict]:
        self.artifact["providerProfileId"] = "local-bounded-ocr-layout-v2"
        self.artifact["providerConfigHash"] = verifier.digest(canonical(verifier.PROFILE_V2))
        analysis = self.artifact["analysis"]
        analysis["schemaVersion"] = "bounded-ocr-layout-analysis-v2"
        analysis["profile"] = verifier.PROFILE_V2
        analysis["skippedRenderPixelPageCount"] = 0
        first = analysis["sources"][0]
        first["status"] = "PARTIALLY_SCANNED"
        first["processedPageCount"] = 1
        first["deferredPageCount"] = 2
        first["skippedRenderPixelPageCount"] = 0
        first["pages"] = [first["pages"][0]]
        first_page = first["pages"][0]
        first_page["provider"]["profileId"] = verifier.PROFILE_V2["ocrProviderProfileIds"][0]
        first_page["contentHash"] = verifier.digest(canonical({k: v for k, v in first_page.items()
                                                                if k != "contentHash"}))
        self.text["pages"] = [
            {**page, "widthMilliPoints": 240000, "heightMilliPoints": 180000,
             "blocks": []} for page in self.text["pages"]
        ]
        self.text_sha = write_json(self.text_path, self.text)

        second_file_id = "F0002"
        second_source_id = "FIL-TEST-B"
        second_pdf = self.root / "second.pdf"
        second_pdf.write_bytes(self.pdf.read_bytes())
        second_entry = {**self.manifest_entry, "file_id": second_file_id}
        self.manifest.write_text(json.dumps(self.manifest_entry) + "\n"
                                 + json.dumps(second_entry) + "\n", encoding="utf-8")
        second_text = self.root / "second-text.json"
        second_text_value = json.loads(json.dumps(self.text))
        second_text_value["sourceFileId"] = second_source_id
        second_text_sha = write_json(second_text, second_text_value)
        second_page = json.loads(json.dumps(first_page))
        second_page["sourceFileId"] = second_source_id
        second_page["contentHash"] = verifier.digest(canonical({k: v for k, v in second_page.items()
                                                                 if k != "contentHash"}))
        second = {**first, "sourceFileId": second_source_id, "pages": [second_page]}
        analysis["sources"].append(second)
        analysis["sourceCount"] = 2
        analysis["ocrRequiredPageCount"] = 6
        analysis["processedPageCount"] = 2
        analysis["deferredPageCount"] = 4
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        self.v2_sources = {self.file_id: (self.source_id, self.pdf),
                           second_file_id: (second_source_id, second_pdf)}
        self.v2_texts = {self.file_id: (self.text_path, self.text_sha),
                         second_file_id: (second_text, second_text_sha)}
        return self.run_v2_verify(), second

    def run_v2_verify(self) -> dict:
        return verifier.verify(
            self.manifest, self.artifact_path, self.artifact_sha,
            self.v2_sources, self.v2_texts,
            expected_object_id="OBJ-TEST", expected_input_manifest_hash="a" * 64,
        )

    def configure_v3_one_source(self) -> dict:
        self.artifact["providerProfileId"] = "local-bounded-ocr-layout-v3"
        self.artifact["providerConfigHash"] = verifier.digest(canonical(verifier.PROFILE_V3))
        analysis = self.artifact["analysis"]
        analysis["schemaVersion"] = "bounded-ocr-layout-analysis-v3"
        analysis["profile"] = verifier.PROFILE_V3
        analysis["skippedRenderPixelPageCount"] = 0
        analysis["subjectCandidatePageCount"] = 1
        analysis["ocrRequiredPageCount"] = 1
        analysis["processedPageCount"] = 1
        analysis["deferredPageCount"] = 0
        self.artifact["outputCount"] = 1
        source = analysis["sources"][0]
        source["status"] = "SCANNED"
        source["ocrRequiredPageCount"] = 1
        source["processedPageCount"] = 1
        source["deferredPageCount"] = 0
        source["skippedRenderPixelPageCount"] = 0
        source["subjectCandidatePageCount"] = 1
        source["pages"] = [source["pages"][1]]
        page = source["pages"][0]
        page["provider"]["profileId"] = verifier.PROFILE_V3["ocrProviderProfileIds"][0]
        page["contentHash"] = verifier.digest(canonical({k: v for k, v in page.items()
                                                       if k != "contentHash"}))
        self.text["pages"] = [
            {**item, "widthMilliPoints": 240000, "heightMilliPoints": 180000,
             "blocks": []} for item in self.text["pages"]
        ]
        self.text["pages"][0]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        self.text["pages"][0]["blocks"] = [{"text": "Разрешение. Обозначение ABC-РД-ОВ"}]
        self.text["pages"][2]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        self.text["pages"][2]["blocks"] = [{"text": (
            "Основные показатели по рабочим чертежам марки ОВ. "
            "На отопление. Тепловой поток.")}]
        self.text["qualitySummary"] = {"ocrRequiredPageCount": 1,
                                       "textLayerCandidatePageCount": 2}
        self.text_sha = write_json(self.text_path, self.text)
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        return self.run_verify()

    def test_original_pdf_and_two_rerendered_pages_pass(self) -> None:
        result = self.run_verify()
        self.assertEqual(result["status"], "SOURCE_RENDER_SCOPE_VERIFIED")
        self.assertEqual(result["verifiedRenderedPageCount"], 2)
        self.assertEqual(result["sources"][0]["verifiedRenderedPages"], [1, 2])
        self.assertFalse(result["ocrLineTextVerified"])

    def test_tampered_source_and_disallowed_split_fail(self) -> None:
        self.pdf.write_bytes(self.pdf.read_bytes() + b"\n")
        with self.assertRaisesRegex(verifier.VerificationError, "source size/SHA-256 mismatch"):
            self.run_verify()
        self.pdf.write_bytes(self.pdf.read_bytes()[:-1])
        self.manifest_entry["split"] = "TEST_HIDDEN"
        self.write_manifest()
        with self.assertRaisesRegex(verifier.VerificationError, "not included public"):
            self.run_verify()

    def test_stage_hash_and_text_artifact_hash_fail_closed(self) -> None:
        self.artifact_path.write_bytes(self.artifact_path.read_bytes() + b" ")
        with self.assertRaisesRegex(verifier.VerificationError, "artifact SHA-256 differs"):
            self.run_verify()
        self.artifact_sha = verifier.sha256_file(self.artifact_path)
        with self.assertRaisesRegex(verifier.VerificationError, "canonical hash differs"):
            self.run_verify()
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        self.text_path.write_bytes(self.text_path.read_bytes() + b" ")
        with self.assertRaisesRegex(verifier.VerificationError, "artifact SHA-256 differs"):
            self.run_verify()

    def test_page_selection_tamper_fails_even_with_new_hashes(self) -> None:
        page = self.artifact["analysis"]["sources"][0]["pages"][1]
        page["pageNumber"] = 3
        page["contentHash"] = verifier.digest(canonical({k: v for k, v in page.items()
                                                          if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "OCR page provenance invalid"):
            self.run_verify()

    def test_render_hash_and_geometry_tamper_fail_even_with_new_hashes(self) -> None:
        page = self.artifact["analysis"]["sources"][0]["pages"][0]
        page["render"]["sha256"] = "0" * 64
        page["contentHash"] = verifier.digest(canonical({k: v for k, v in page.items()
                                                          if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "rerendered PNG SHA-256 mismatch"):
            self.run_verify()
        page["render"]["sha256"] = "1" * 64
        page["render"]["widthPx"] += 1
        page["contentHash"] = verifier.digest(canonical({k: v for k, v in page.items()
                                                          if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "rerendered PNG geometry mismatch"):
            self.run_verify()

    def test_text_scope_and_stage_counters_tamper_fail(self) -> None:
        self.text["pages"][0]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        self.text["qualitySummary"] = {"ocrRequiredPageCount": 2,
                                       "textLayerCandidatePageCount": 1}
        self.text_sha = write_json(self.text_path, self.text)
        with self.assertRaisesRegex(verifier.VerificationError, "selection/counters invalid"):
            self.run_verify()
        self.text["pages"][0]["quality"]["disposition"] = "OCR_REQUIRED"
        self.text["qualitySummary"] = {"ocrRequiredPageCount": 3,
                                       "textLayerCandidatePageCount": 0}
        self.text_sha = write_json(self.text_path, self.text)
        self.artifact["analysis"]["deferredPageCount"] = 0
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "aggregate counters invalid"):
            self.run_verify()

    def test_line_text_is_structurally_checked_but_not_claimed_correct(self) -> None:
        page = self.artifact["analysis"]["sources"][0]["pages"][0]
        page["lines"][0]["text"] = "INVENTED OCR STRING"
        page["contentHash"] = verifier.digest(canonical({k: v for k, v in page.items()
                                                          if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        self.assertFalse(self.run_verify()["ocrLineTextVerified"])

    def test_v2_balances_first_page_across_two_sources(self) -> None:
        result, _second = self.configure_v2_two_sources()
        self.assertEqual(result["profileId"], "local-bounded-ocr-layout-v2")
        self.assertEqual(result["verifiedRenderedPageCount"], 2)
        self.assertEqual([source["verifiedRenderedPages"] for source in result["sources"]],
                         [[1], [1]])

    def test_v2_drawing_anchor_rank_and_raster_skip(self) -> None:
        pages = [
            {"pageNumber": 1, "widthMilliPoints": 240000, "heightMilliPoints": 180000,
             "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []},
            {"pageNumber": 2, "widthMilliPoints": 240000, "heightMilliPoints": 180000,
             "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
             "blocks": [{"text": "Общая площадь здания"}]},
            {"pageNumber": 3, "widthMilliPoints": 1200000, "heightMilliPoints": 180000,
             "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []},
            {"pageNumber": 4, "widthMilliPoints": 20000000, "heightMilliPoints": 180000,
             "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []},
        ]
        ranked, skipped = verifier.v2_candidates({"pages": pages})
        self.assertEqual(ranked, [3, 1])
        self.assertEqual(skipped, 1)

    def test_v2_provider_identity_geometry_and_selection_tampering_fail(self) -> None:
        _result, second = self.configure_v2_two_sources()
        first = self.artifact["analysis"]["sources"][0]
        first_page = first["pages"][0]
        original_profile = first_page["provider"]["profileId"]
        first_page["provider"]["profileId"] = "unknown-provider"
        first_page["contentHash"] = verifier.digest(canonical({k: v for k, v in first_page.items()
                                                                if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "provider/text geometry mismatch"):
            self.run_v2_verify()
        first_page["provider"]["profileId"] = original_profile
        first_page["contentHash"] = verifier.digest(canonical({k: v for k, v in first_page.items()
                                                                if k != "contentHash"}))
        self.text["pages"][0]["widthMilliPoints"] = 260000
        self.text_sha = write_json(self.text_path, self.text)
        self.v2_texts[self.file_id] = (self.text_path, self.text_sha)
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "provider/text geometry mismatch"):
            self.run_v2_verify()
        self.text["pages"][0]["widthMilliPoints"] = 240000
        self.text_sha = write_json(self.text_path, self.text)
        self.v2_texts[self.file_id] = (self.text_path, self.text_sha)
        second["pages"][0]["pageNumber"] = 2
        second["pages"][0]["contentHash"] = verifier.digest(canonical({
            k: v for k, v in second["pages"][0].items() if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "OCR page provenance invalid"):
            self.run_v2_verify()

    def test_v2_profile_and_raster_skip_counter_tampering_fail(self) -> None:
        self.configure_v2_two_sources()
        self.artifact["providerConfigHash"] = "0" * 64
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "stage provenance/profile invalid"):
            self.run_v2_verify()
        self.artifact["providerConfigHash"] = verifier.digest(canonical(verifier.PROFILE_V2))
        self.artifact["analysis"]["sources"][0]["skippedRenderPixelPageCount"] = 1
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "selection/counters invalid"):
            self.run_v2_verify()

    def test_v3_checks_subject_window_and_rerenders_only_enclosed_page(self) -> None:
        result = self.configure_v3_one_source()
        self.assertEqual(result["profileId"], "local-bounded-ocr-layout-v3")
        self.assertEqual(result["verifiedRenderedPageCount"], 1)
        self.assertEqual(result["sources"][0]["subjectCandidatePageCount"], 1)
        self.assertEqual(result["sources"][0]["verifiedRenderedPages"], [2])

    def test_v3_missing_summary_abstains_with_zero_subject_candidates(self) -> None:
        self.configure_v3_one_source()
        self.text["pages"][2]["blocks"] = [{"text": "Сводная таблица без требуемой марки"}]
        self.text_sha = write_json(self.text_path, self.text)
        source = self.artifact["analysis"]["sources"][0]
        source["status"] = "SKIPPED_NO_SUBJECT_CONTEXT"
        source["processedPageCount"] = 0
        source["deferredPageCount"] = 1
        source["subjectCandidatePageCount"] = 0
        source["pages"] = []
        self.artifact["outputCount"] = 0
        self.artifact["analysis"]["processedPageCount"] = 0
        self.artifact["analysis"]["deferredPageCount"] = 1
        self.artifact["analysis"]["subjectCandidatePageCount"] = 0
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        result = self.run_verify()
        self.assertEqual(result["verifiedRenderedPageCount"], 0)
        self.assertEqual(result["sources"][0]["subjectCandidatePageCount"], 0)

    def test_v3_rejects_forged_subject_counter_profile_and_page(self) -> None:
        self.configure_v3_one_source()
        source = self.artifact["analysis"]["sources"][0]
        source["subjectCandidatePageCount"] = 2
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "selection/counters invalid"):
            self.run_verify()
        source["subjectCandidatePageCount"] = 1
        source["skippedRenderPixelPageCount"] = 1
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "selection/counters invalid"):
            self.run_verify()
        source["skippedRenderPixelPageCount"] = 0
        self.artifact["analysis"]["subjectCandidatePageCount"] = 2
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "aggregate counters invalid"):
            self.run_verify()
        self.artifact["analysis"]["subjectCandidatePageCount"] = 1
        self.artifact["providerConfigHash"] = "0" * 64
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "stage provenance/profile invalid"):
            self.run_verify()
        self.artifact["providerConfigHash"] = verifier.digest(canonical(verifier.PROFILE_V3))
        source["pages"][0]["provider"]["profileId"] = "unapproved-provider"
        source["pages"][0]["contentHash"] = verifier.digest(canonical({
            k: v for k, v in source["pages"][0].items() if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "provider/text geometry mismatch"):
            self.run_verify()
        source["pages"][0]["provider"]["profileId"] = verifier.PROFILE_V3["ocrProviderProfileIds"][0]
        source["pages"][0]["pageNumber"] = 1
        source["pages"][0]["contentHash"] = verifier.digest(canonical({
            k: v for k, v in source["pages"][0].items() if k != "contentHash"}))
        self.artifact_sha = write_json(self.artifact_path, self.artifact)
        with self.assertRaisesRegex(verifier.VerificationError, "OCR page provenance invalid"):
            self.run_verify()

    def test_v3_candidate_window_limits_and_raster_skip(self) -> None:
        pages = [
            {"pageNumber": number, "widthMilliPoints": 240000,
             "heightMilliPoints": 180000, "blocks": [],
             "quality": {"disposition": "OCR_REQUIRED"}}
            for number in range(1, 13)
        ]
        pages[0]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        pages[0]["blocks"] = [{"text": "Разрешение. Обозначение ABC-РД-ОВ"}]
        pages[7]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        pages[7]["blocks"] = [{"text": (
            "Основные показатели по рабочим чертежам марки ОВ. "
            "На отопление. Тепловой поток")}]  # marker 1 to summary 8: gap 7
        pages[2]["widthMilliPoints"] = 20_000_000
        self.assertEqual(verifier.v3_candidates({"pages": pages}),
                         ([2, 4, 5, 6, 7], 1, 6))
        pages[7]["quality"]["disposition"] = "OCR_REQUIRED"
        pages[7]["blocks"] = []
        pages[9]["quality"]["disposition"] = "TEXT_LAYER_CANDIDATE"
        pages[9]["blocks"] = [{"text": (
            "Основные показатели по рабочим чертежам марки ОВ. "
            "На отопление. Тепловой поток")}]  # marker 1 to summary 10: gap 9
        self.assertEqual(verifier.v3_candidates({"pages": pages}), ([], 0, 0))


if __name__ == "__main__":
    unittest.main()
