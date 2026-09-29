from __future__ import annotations

import unittest
from platform_test_support import requires_posix_storage
import hashlib
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from inspector_worker.durable_ocr_layout import (
    BoundedOcrLayoutAdapter, PROFILE, PROFILE_HASH, PROFILE_ID,
    PROFILE_V2, PROFILE_HASH_V2, PROFILE_ID_V2, select_v2_pages,
    PROFILE_V3, PROFILE_HASH_V3, PROFILE_ID_V3, select_v3_pages,
    PROFILE_V4, PROFILE_HASH_V4, PROFILE_ID_V4, select_v4_pages,
    PROFILE_V5, PROFILE_HASH_V5, PROFILE_ID_V5, select_v5_pages,
)
from inspector_worker.main import DEFAULT_STAGE_PROVIDER_REGISTRY
from inspector_worker.ocr_pilot import canonical_hash


def _text(source_id: str, digest: str, required: int) -> dict:
    pages = []
    for number in range(1, required + 1):
        pages.append({"pageNumber": number, "quality": {"disposition": "OCR_REQUIRED"}})
    return {"schemaVersion": "document-text-v2", "sourceFileId": source_id,
            "inputSha256": digest, "pageCount": len(pages), "pages": pages}


def _lease(*, size: int = 100, second: bool = False) -> dict:
    sources = [{"sourceFileId": "A", "sha256": "a" * 64,
                "byteSize": size, "mediaType": "application/pdf",
                "downloadPath": "/api/internal/v1/jobs/job/inputs/A"}]
    if second:
        sources.append({"sourceFileId": "B", "sha256": "b" * 64,
                        "byteSize": 100, "mediaType": "application/pdf",
                        "downloadPath": "/api/internal/v1/jobs/job/inputs/B"})
    return {"inputManifestHash": "c" * 64, "objectId": "OBJECT-1",
            "release": {"lifecycle": "DRAFT", "externalNetworkAllowed": False,
                        "providerSlot": {"stageJobType": "DOCUMENT_OCR_LAYOUT",
                                         "providerKind": "OCR_LAYOUT", "status": "CONFIGURED",
                                         "profileId": PROFILE_ID, "adapterVersion": "1",
                                         "configHash": PROFILE_HASH}},
            "inputs": {"sourceFiles": sources}}


def _v2_text(source_id: str, digest: str, *, second: bool = False) -> dict:
    anchor = {"pageNumber": 1, "widthMilliPoints": 595_000,
              "heightMilliPoints": 842_000,
              "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
              "blocks": [{"text": "Тепловая нагрузка"}]}
    standard = {"pageNumber": 2, "widthMilliPoints": 595_000,
                "heightMilliPoints": 842_000,
                "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []}
    drawing = {"pageNumber": 2 if second else 3, "widthMilliPoints": 1_200_000,
               "heightMilliPoints": 800_000,
               "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []}
    huge = {"pageNumber": 4, "widthMilliPoints": 10_000_000,
            "heightMilliPoints": 10_000_000,
            "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []}
    pages = [anchor, drawing] if second else [anchor, standard, drawing, huge]
    return {"schemaVersion": "document-text-v2", "sourceFileId": source_id,
            "inputSha256": digest, "pageCount": len(pages), "pages": pages}


def _v3_text(source_id: str, digest: str, *, context: bool) -> dict:
    marker = {"pageNumber": 1, "widthMilliPoints": 595_000,
              "heightMilliPoints": 842_000,
              "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
              "blocks": [{"text": "Разрешение Обозначение АНО/1-РД-ОВ1"
                          if context else "Иной документ"}]}
    scan = [{"pageNumber": number, "widthMilliPoints": 595_000,
             "heightMilliPoints": 842_000,
             "quality": {"disposition": "OCR_REQUIRED"}, "blocks": []}
            for number in (2, 3, 4)]
    summary = {"pageNumber": 5, "widthMilliPoints": 595_000,
               "heightMilliPoints": 842_000,
               "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
               "blocks": [{"text": "Основные показатели по рабочим чертежам марки ОВ. "
                           "Тепловой поток на отопление"}]}
    pages = [marker, *scan, summary]
    return {"schemaVersion": "document-text-v2", "sourceFileId": source_id,
            "inputSha256": digest, "pageCount": len(pages), "pages": pages}


class DurableOcrLayoutTests(unittest.TestCase):
    def test_profile_matches_immutable_hash_and_registry(self) -> None:
        self.assertEqual(PROFILE_HASH, canonical_hash(PROFILE))
        self.assertEqual(PROFILE_HASH_V2, canonical_hash(PROFILE_V2))
        self.assertEqual(PROFILE_HASH_V3, canonical_hash(PROFILE_V3))
        self.assertEqual(PROFILE_HASH_V4, canonical_hash(PROFILE_V4))
        self.assertEqual(PROFILE_HASH_V5, canonical_hash(PROFILE_V5))
        self.assertEqual(PROFILE_HASH_V5,
                         "d7e4e78dcea591d30587022f9d57360e0cc227607f577ab10f896c69d94b37a7")
        self.assertIn("DOCUMENT_OCR_LAYOUT", DEFAULT_STAGE_PROVIDER_REGISTRY._adapters)

    def test_v4_recovers_only_cid_damaged_opening_page(self) -> None:
        text = _v3_text("A", "a" * 64, context=False)
        text["pages"][0]["quality"] = {"disposition": "OCR_REQUIRED",
                                          "reasonCodes": ["TEXT_DECODING_ANOMALY"]}
        text["pages"][0]["blocks"] = []
        text["pages"][1]["quality"]["reasonCodes"] = ["LOW_TEXT_COVERAGE"]
        self.assertEqual(select_v4_pages([("A", 100, "application/pdf", text)]), {
            "A": {"selected": [1], "rasterSkipped": 0,
                  "subjectCandidateCount": 0, "titleRecoveryCandidateCount": 1}})
        text["pages"][0]["quality"]["reasonCodes"] = ["LOW_TEXT_COVERAGE"]
        self.assertEqual(select_v4_pages([("A", 100, "application/pdf", text)])["A"]["selected"], [])

    def test_v4_preserves_subject_window_over_title_fallback(self) -> None:
        text = _v3_text("A", "a" * 64, context=True)
        text["pages"][1]["quality"]["reasonCodes"] = ["TEXT_DECODING_ANOMALY"]
        self.assertEqual(select_v4_pages([("A", 100, "application/pdf", text)]), {
            "A": {"selected": [2, 3], "rasterSkipped": 0,
                  "subjectCandidateCount": 3, "titleRecoveryCandidateCount": 0}})

    def test_v5_round_robin_four_pages_and_v4_stays_two(self) -> None:
        sources = [(source_id, 100, "application/pdf",
                    _v3_text(source_id, digest * 64, context=True))
                   for source_id, digest in (("A", "a"), ("B", "b"))]
        self.assertEqual([selection["selected"] for selection in
                          select_v4_pages(sources).values()], [[2], [2]])
        self.assertEqual([selection["selected"] for selection in
                          select_v5_pages(sources).values()], [[2, 3], [2, 3]])
        self.assertEqual(PROFILE_V4["maxPagesPerRun"], 2)
        self.assertEqual(PROFILE_V5["maxPagesPerRun"], 4)

    @requires_posix_storage
    def test_v5_reuses_v4_cache_across_retry_with_pinned_provenance(self) -> None:
        pdfs = {"A": b"v5 source A", "B": b"v5 source B"}
        hashes = {source_id: hashlib.sha256(payload).hexdigest()
                  for source_id, payload in pdfs.items()}
        lease = _lease(second=True)
        for source in lease["inputs"]["sourceFiles"]:
            source["sha256"] = hashes[source["sourceFileId"]]
            source["byteSize"] = len(pdfs[source["sourceFileId"]])
        texts = [_v3_text(source_id, hashes[source_id], context=True)
                 for source_id in ("A", "B")]
        provider = PROFILE_V5["ocrProviderProfileIds"][0]

        def download_stub(_url, path: Path, digest: str, *_args) -> None:
            source_id = next(source_id for source_id, expected in hashes.items()
                             if expected == digest)
            path.write_bytes(pdfs[source_id])

        def artifact(_path, source_id, digest, page_number, _count, **_kwargs):
            value = {
                "schemaVersion": "document-ocr-page-v1", "sourceFileId": source_id,
                "inputSha256": digest, "pageNumber": page_number,
                "render": {"sha256": "f" * 64, "widthPx": 992, "heightPx": 1404,
                           "dpi": 120, "rendererProfileId": PROFILE_V5["rendererProfileId"]},
                "provider": {"profileId": provider, "script": "eslav"},
                "lines": [],
            }
            value["contentHash"] = canonical_hash(value)
            return value

        with tempfile.TemporaryDirectory() as root, \
             patch.dict("os.environ", {
                 "DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080",
                 "INSPECTOR_DURABLE_OCR_CACHE_ROOT": root,
                 "OCR_LAYOUT_PROFILE_ID": provider,
             }), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   side_effect=texts * 3), \
             patch("inspector_worker.durable_ocr_layout._download_source",
                   side_effect=download_stub), \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page",
                   side_effect=artifact) as ocr:
            lease["release"]["providerSlot"].update({
                "profileId": PROFILE_ID_V4, "adapterVersion": "4",
                "configHash": PROFILE_HASH_V4})
            previous = BoundedOcrLayoutAdapter().execute(
                lease, {"attemptId": "v4", "fencingToken": 1})
            lease["release"]["providerSlot"].update({
                "profileId": PROFILE_ID_V5, "adapterVersion": "5",
                "configHash": PROFILE_HASH_V5})
            first = BoundedOcrLayoutAdapter().execute(
                lease, {"attemptId": "v5-first", "fencingToken": 2})
            retry = BoundedOcrLayoutAdapter().execute(
                lease, {"attemptId": "v5-retry", "fencingToken": 3})
            self.assertEqual(ocr.call_count, 4)
            self.assertEqual(len(list(Path(root).rglob("*.json"))), 4)
        self.assertEqual(previous["outputCount"], 2)
        self.assertEqual(first["outputCount"], 4)
        self.assertEqual(first, retry)
        self.assertEqual(first["providerProfileId"], PROFILE_ID_V5)
        self.assertEqual(first["providerConfigHash"], PROFILE_HASH_V5)
        self.assertEqual(first["analysis"]["schemaVersion"], "bounded-ocr-layout-analysis-v5")
        self.assertEqual(first["analysis"]["deferredPageCount"], 2)
        self.assertNotIn("finding", first)

    def test_v3_subject_window_abstains_elsewhere_and_processes_two_pages(self) -> None:
        lease = _lease(second=True)
        lease["release"]["providerSlot"].update({
            "profileId": PROFILE_ID_V3, "adapterVersion": "3", "configHash": PROFILE_HASH_V3})
        text_a = _v3_text("A", "a" * 64, context=False)
        text_b = _v3_text("B", "b" * 64, context=True)
        self.assertEqual(select_v3_pages([
            ("A", 100, "application/pdf", text_a),
            ("B", 100, "application/pdf", text_b),
        ]), {"A": {"selected": [], "rasterSkipped": 0, "subjectCandidateCount": 0},
              "B": {"selected": [2, 3], "rasterSkipped": 0, "subjectCandidateCount": 3}})
        def artifact(_path, sid, digest, page, _count, **_kwargs):
            return {"schemaVersion": "document-ocr-page-v1", "sourceFileId": sid,
                    "inputSha256": digest, "pageNumber": page, "contentHash": "d" * 64,
                    "render": {"widthPx": 992, "heightPx": 1404,
                               "rendererProfileId": PROFILE_V3["rendererProfileId"]},
                    "provider": {"profileId": PROFILE_V3["ocrProviderProfileIds"][0]}}
        def download_stub(_url, path: Path, *_args) -> None:
            path.write_bytes(b"test pdf bytes")
        with patch.dict("os.environ", {"DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080"}), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   side_effect=[text_a, text_b]), \
             patch("inspector_worker.durable_ocr_layout._download_source", side_effect=download_stub) as download, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page", side_effect=artifact) as ocr:
            result = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
        self.assertEqual([(call.args[1], call.args[3]) for call in ocr.call_args_list],
                         [("B", 2), ("B", 3)])
        self.assertEqual(download.call_count, 1)
        self.assertEqual(result["analysis"]["subjectCandidatePageCount"], 3)
        self.assertEqual(result["analysis"]["sources"][0]["status"], "SKIPPED_NO_SUBJECT_CONTEXT")
        self.assertEqual(result["analysis"]["sources"][1]["status"], "PARTIALLY_SCANNED")
        self.assertNotIn("finding", result)

    @requires_posix_storage
    def test_v3_durable_page_cache_reuses_same_source_and_profile(self) -> None:
        payload = b"same committed PDF bytes on both immutable runs"
        digest = hashlib.sha256(payload).hexdigest()
        lease = _lease(size=len(payload))
        lease["inputs"]["sourceFiles"][0]["sha256"] = digest
        lease["release"]["providerSlot"].update({
            "profileId": PROFILE_ID_V3, "adapterVersion": "3", "configHash": PROFILE_HASH_V3})
        text = _v3_text("A", digest, context=True)
        provider = PROFILE_V3["ocrProviderProfileIds"][0]

        def artifact(_path, sid, source_hash, page, _count, **_kwargs):
            value = {
                "schemaVersion": "document-ocr-page-v1", "sourceFileId": sid,
                "inputSha256": source_hash, "pageNumber": page,
                "render": {"sha256": "f" * 64, "widthPx": 992, "heightPx": 1404,
                           "dpi": 120, "rendererProfileId": PROFILE_V3["rendererProfileId"]},
                "provider": {"profileId": provider, "script": "eslav"},
                "lines": [{"text": "Общая площадь 250 м²", "score": 1.0,
                           "bboxPx": [10.0, 12, 240, 30]}],
            }
            value["contentHash"] = canonical_hash(value)
            return value

        def download_stub(_url, path: Path, *_args) -> None:
            path.write_bytes(payload)

        with tempfile.TemporaryDirectory() as root, \
             patch.dict("os.environ", {
                 "DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080",
                 "INSPECTOR_DURABLE_OCR_CACHE_ROOT": root,
                 "OCR_LAYOUT_PROFILE_ID": provider,
             }), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   return_value=text), \
             patch("inspector_worker.durable_ocr_layout._download_source",
                   side_effect=download_stub) as download, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page",
                   side_effect=artifact) as ocr:
            first = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
            second = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "y", "fencingToken": 2})
            self.assertEqual(ocr.call_count, 2)
            self.assertEqual(download.call_count, 2)
            self.assertEqual(first["analysis"], second["analysis"])
            self.assertEqual(len(list(Path(root).rglob("*.json"))), 2)
            page = first["analysis"]["sources"][0]["pages"][0]
            self.assertEqual(type(page["lines"][0]["score"]), int)
            self.assertEqual(type(page["lines"][0]["bboxPx"][0]), int)
            self.assertEqual(page["contentHash"], canonical_hash({
                key: value for key, value in page.items() if key != "contentHash"}))
            receipt = json.loads(next(Path(root).rglob("*.json")).read_text())
            self.assertEqual(type(receipt["artifact"]["lines"][0]["score"]), float)
            self.assertEqual(type(receipt["artifact"]["lines"][0]["bboxPx"][0]), float)
            self.assertNotEqual(receipt["artifact"]["contentHash"], page["contentHash"])

    def test_v3_missing_summary_abstains_and_side_limit_skips_candidate(self) -> None:
        text = _v3_text("B", "b" * 64, context=True)
        text["pages"][4]["blocks"] = [{"text": "Общие данные"}]
        self.assertEqual(select_v3_pages([("B", 100, "application/pdf", text)]),
                         {"B": {"selected": [], "rasterSkipped": 0, "subjectCandidateCount": 0}})
        text = _v3_text("B", "b" * 64, context=True)
        text["pages"][1]["widthMilliPoints"] = 13_000_000
        text["pages"][1]["heightMilliPoints"] = 20_000
        self.assertEqual(select_v3_pages([("B", 100, "application/pdf", text)]),
                         {"B": {"selected": [3, 4], "rasterSkipped": 1,
                                "subjectCandidateCount": 3}})

    def test_v2_round_robin_drawing_priority_and_raster_skip(self) -> None:
        lease = _lease(second=True)
        lease["release"]["providerSlot"].update({
            "profileId": PROFILE_ID_V2, "adapterVersion": "2", "configHash": PROFILE_HASH_V2})
        text_a = _v2_text("A", "a" * 64)
        text_b = _v2_text("B", "b" * 64, second=True)
        self.assertEqual(select_v2_pages([
            ("A", 100, "application/pdf", text_a),
            ("B", 100, "application/pdf", text_b),
        ]), {"A": {"selected": [3], "rasterSkipped": 1},
              "B": {"selected": [2], "rasterSkipped": 0}})
        def artifact(_path, sid, digest, page, _count, **_kwargs):
            return {"schemaVersion": "document-ocr-page-v1", "sourceFileId": sid,
                    "inputSha256": digest, "pageNumber": page, "contentHash": "d" * 64,
                    "render": {"widthPx": 2000, "heightPx": 1334,
                               "rendererProfileId": PROFILE_V2["rendererProfileId"]},
                    "provider": {"profileId": PROFILE_V2["ocrProviderProfileIds"][0]}}
        def download_stub(_url, path: Path, *_args) -> None:
            path.write_bytes(b"test pdf bytes")
        with patch.dict("os.environ", {"DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080"}), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   side_effect=[text_a, text_b]), \
             patch("inspector_worker.durable_ocr_layout._download_source", side_effect=download_stub) as download, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page", side_effect=artifact) as ocr:
            result = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
        self.assertEqual([(call.args[1], call.args[3]) for call in ocr.call_args_list],
                         [("A", 3), ("B", 2)])
        self.assertEqual(download.call_count, 2)
        self.assertEqual(result["analysis"]["skippedRenderPixelPageCount"], 1)
        self.assertEqual(result["analysis"]["deferredPageCount"], 2)
        self.assertEqual(result["analysis"]["sources"][0]["status"], "PARTIALLY_SCANNED")
        self.assertNotIn("finding", result)

    def test_v2_skips_long_narrow_page_and_rejects_changed_provider(self) -> None:
        text = _v2_text("A", "a" * 64)
        text["pages"][2]["widthMilliPoints"] = 13_000_000
        text["pages"][2]["heightMilliPoints"] = 20_000
        self.assertEqual(select_v2_pages([("A", 100, "application/pdf", text)]),
                         {"A": {"selected": [2], "rasterSkipped": 2}})
        lease = _lease()
        lease["release"]["providerSlot"].update({
            "profileId": PROFILE_ID_V2, "adapterVersion": "2", "configHash": PROFILE_HASH_V2})
        def download_stub(_url, path: Path, *_args) -> None:
            path.write_bytes(b"test pdf bytes")
        with patch.dict("os.environ", {"DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080"}), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact", return_value=text), \
             patch("inspector_worker.durable_ocr_layout._download_source", side_effect=download_stub), \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page", return_value={
                 "render": {"widthPx": 992, "heightPx": 1404,
                            "rendererProfileId": PROFILE_V2["rendererProfileId"]},
                 "provider": {"profileId": "unknown-provider"},
             }):
            with self.assertRaisesRegex(ValueError, "profile changed"):
                BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})

    def test_only_first_two_required_pages_are_processed(self) -> None:
        lease = _lease(second=True)
        artifact = lambda path, sid, digest, page, count, **kwargs: {
            "schemaVersion": "document-ocr-page-v1", "sourceFileId": sid,
            "inputSha256": digest, "pageNumber": page, "contentHash": "d" * 64}
        def download_stub(_url, path: Path, *_args) -> None:
            path.write_bytes(b"test pdf bytes")

        with patch.dict("os.environ", {"DOCUMENT_PROVIDER_BASE_URL": "http://document-ai:8080"}), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   side_effect=[_text("A", "a" * 64, 3), _text("B", "b" * 64, 1)]), \
             patch("inspector_worker.durable_ocr_layout._download_source", side_effect=download_stub) as download, \
             patch("inspector_worker.durable_ocr_layout.recognize_pdf_page", side_effect=artifact) as ocr:
            result = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
        self.assertEqual(result["outputCount"], 2)
        self.assertEqual(result["analysis"]["ocrRequiredPageCount"], 4)
        self.assertEqual(result["analysis"]["deferredPageCount"], 2)
        self.assertEqual(result["analysis"]["sources"][0]["status"], "PARTIALLY_SCANNED_PAGE_BUDGET")
        self.assertEqual(result["analysis"]["sources"][1]["processedPageCount"], 0)
        self.assertEqual([call.args[3] for call in ocr.call_args_list], [1, 2])
        self.assertEqual(download.call_count, 1)
        self.assertNotIn("finding", result)

    def test_oversize_is_explicitly_skipped_without_source_download(self) -> None:
        lease = _lease(size=PROFILE["maxSourceBytes"] + 1)
        with patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   return_value=_text("A", "a" * 64, 2)), \
             patch("inspector_worker.durable_ocr_layout._download_source") as download:
            result = BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
        self.assertEqual(result["analysis"]["skippedOversizePageCount"], 2)
        self.assertEqual(result["analysis"]["deferredPageCount"], 2)
        self.assertEqual(result["analysis"]["sources"][0]["status"], "SKIPPED_SOURCE_TOO_LARGE")
        download.assert_not_called()

    def test_missing_local_provider_fails_closed_for_selected_page(self) -> None:
        lease = _lease()
        with patch.dict("os.environ", {}, clear=True), \
             patch("inspector_worker.durable_ocr_layout.download_text_artifact",
                   return_value=_text("A", "a" * 64, 1)):
            with self.assertRaisesRegex(ValueError, "DOCUMENT_PROVIDER_BASE_URL"):
                BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})

    def test_wrong_release_profile_and_duplicate_source_fail_closed(self) -> None:
        lease = _lease()
        lease["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release"):
            BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})
        lease = _lease()
        lease["inputs"]["sourceFiles"].append(lease["inputs"]["sourceFiles"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            BoundedOcrLayoutAdapter().execute(lease, {"attemptId": "x", "fencingToken": 1})


if __name__ == "__main__":
    unittest.main()
