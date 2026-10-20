from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import ANY, patch

import fitz

from inspector_worker.visual_proposal_adapter import (
    PROFILE_HASH_V1, PROFILE_HASH_V2, PROFILE_HASH_V3, PROFILE_HASH_V4,
    PROFILE_HASH_V5, PROFILE_HASH_V6, PROFILE_V6, VisualProposalAdapter,
    PROFILE_HASH_V7_SAMPLE, PROFILE_HASH_V7_FULL, PROFILE_V7_SAMPLE, PROFILE_V7_FULL,
    PROFILE_HASH_V8_SAMPLE, PROFILE_HASH_V8_FULL, PROFILE_V8_SAMPLE, PROFILE_V8_FULL,
)
from inspector_worker.vector_proposals import _document_context


class VisualProposalAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary.name) / "source.pdf"
        with fitz.open() as document:
            page = document.new_page(width=200, height=100)
            page.draw_rect(fitz.Rect(20, 10, 26, 60), color=(1, 0, 0), width=0.4)
            page.draw_line(fitz.Point(26, 30), fitz.Point(65, 30), color=(0, 0, 1))
            document.save(self.path)
        self.sha256 = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def lease(self, *, profile_version: str = "v3") -> dict:
        profile_id = f"red-vector-proposals-{profile_version}"
        profile_hash = {"v1": PROFILE_HASH_V1, "v2": PROFILE_HASH_V2,
                        "v3": PROFILE_HASH_V3, "v4": PROFILE_HASH_V4,
                        "v5": PROFILE_HASH_V5, "v6": PROFILE_HASH_V6,
                        "v7-sample": PROFILE_HASH_V7_SAMPLE, "v7-full": PROFILE_HASH_V7_FULL,
                        "v8-sample": PROFILE_HASH_V8_SAMPLE, "v8-full": PROFILE_HASH_V8_FULL}[profile_version]
        return {
            "objectId": "OBJ-1",
            "inputManifestHash": "a" * 64,
            "release": {
                "lifecycle": "DRAFT",
                "providerSlot": {
                    "stageJobType": "ENTITY_EXTRACTION",
                    "providerKind": "ENTITY_EXTRACTION_MODEL",
                    "status": "CONFIGURED",
                    "profileId": profile_id,
                    "adapterVersion": profile_version[1],
                    "configHash": profile_hash,
                },
            },
            "inputs": {"sourceFiles": [{
                "sourceFileId": "FIL-1", "sha256": self.sha256,
                "byteSize": self.path.stat().st_size, "mediaType": "application/pdf",
                "downloadPath": "/api/internal/v1/jobs/job-1/inputs/FIL-1",
            }]},
        }

    def test_scans_original_pdf_and_returns_proposals_without_findings(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source):
            result = VisualProposalAdapter().execute(self.lease(), {})
        self.assertEqual(result["outputCount"], 1)
        self.assertEqual(result["analysis"]["sources"][0]["sourceSha256"], self.sha256)
        self.assertEqual(result["analysis"]["sources"][0]["proposals"][0]["pageNumber"], 1)
        self.assertEqual(result["providerProfileId"], "red-vector-proposals-v3")
        self.assertEqual(result["providerConfigHash"], PROFILE_HASH_V3)
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v3")
        self.assertEqual(result["analysis"]["profile"]["maxPagesPerSource"], 1024)
        self.assertEqual(result["analysis"]["sources"][0]["scannedPageNumbers"], [1])
        self.assertEqual(result["analysis"]["sources"][0]["skippedPageCount"], 0)
        self.assertNotIn("findings", result)
        self.assertNotIn("coverage", result)

    def test_accepts_unfinished_v1_release_without_changing_artifact_shape(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source):
            result = VisualProposalAdapter().execute(self.lease(profile_version="v1"), {})
        self.assertEqual(result["providerProfileId"], "red-vector-proposals-v1")
        self.assertEqual(result["providerConfigHash"], PROFILE_HASH_V1)
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v1")
        self.assertEqual(result["analysis"]["profile"]["schemaVersion"], "visual-proposal-profile-v1")
        self.assertNotIn("scannedPageNumbers", result["analysis"]["sources"][0])
        self.assertNotIn("skippedPageCount", result["analysis"]["sources"][0])

    def test_accepts_unfinished_v2_release_without_changing_artifact_shape(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source):
            result = VisualProposalAdapter().execute(self.lease(profile_version="v2"), {})
        self.assertEqual(result["providerProfileId"], "red-vector-proposals-v2")
        self.assertEqual(result["providerConfigHash"], PROFILE_HASH_V2)
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v2")
        self.assertEqual(result["analysis"]["profile"]["maxPagesPerSource"], 64)
        self.assertEqual(result["analysis"]["sources"][0]["scannedPageNumbers"], [1])

    def test_v4_adds_unknown_cover_context_without_classifying_proposal(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source):
            result = VisualProposalAdapter().execute(self.lease(profile_version="v4"), {})
        source = result["analysis"]["sources"][0]
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v4")
        self.assertEqual(result["providerConfigHash"], PROFILE_HASH_V4)
        self.assertEqual(source["documentContext"]["status"], "UNKNOWN")
        self.assertEqual(source["documentContext"]["inspectedPages"][0]["pageNumber"], 1)
        self.assertEqual(source["proposals"][0]["status"], "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED")
        self.assertEqual(result["outputCount"], 1)

    def test_cover_context_is_bounded_and_conflicts_abstain(self) -> None:
        class Page:
            def __init__(self, text: str):
                self.text = text

            def get_text(self, _kind: str) -> str:
                return self.text

        class Document:
            def __init__(self, *texts: str):
                self.pages = [Page(text) for text in texts]

            def __len__(self) -> int:
                return len(self.pages)

            def load_page(self, index: int) -> Page:
                return self.pages[index]

        ventilation = _document_context(Document(
            "Заказчик\nРАБОЧАЯ ДОКУМЕНТАЦИЯ\nСистема общеобменной вентиляции и\nкондиционирования воздуха",
            "", "РАБОЧАЯ ДОКУМЕНТАЦИЯ\nОтопление",
        ))
        self.assertEqual(ventilation["status"], "VENTILATION")
        self.assertEqual(len(ventilation["inspectedPages"]), 2)
        self.assertEqual(ventilation["inspectedPages"][0]["pageNumber"], 1)
        self.assertEqual(len(ventilation["inspectedPages"][0]["textSha256"]), 64)
        self.assertEqual(_document_context(Document(
            "РАБОЧАЯ ДОКУМЕНТАЦИЯ\nОтопление и вентиляция"
        ))["status"], "UNKNOWN")
        self.assertEqual(_document_context(Document(
            "ɉ$ɈȿɄ&ɇȺ/ ȾɈɄ'Ɇȿɇ&Ⱥ&ɂ/\nОтопление"
        ))["status"], "UNKNOWN")

    def test_v5_records_separate_model_hint_and_preserves_proposal(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with (patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source),
              patch("inspector_worker.visual_vlm._post_vlm", return_value=("RADIATOR", "e" * 64)),
              patch.dict(os.environ, {"VISUAL_VLM_BASE_URL": "http://127.0.0.1:18086/v1"})):
            result = VisualProposalAdapter().execute(self.lease(profile_version="v5"), {})
        source = result["analysis"]["sources"][0]
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v5")
        self.assertEqual(result["outputCount"], 1)
        self.assertEqual(source["proposals"][0]["status"], "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED")
        observation = source["vlm"]["observations"][0]
        self.assertEqual(observation["decision"], "RADIATOR_HINT")
        self.assertEqual(observation["reasonCode"], "MODEL_RESPONSE")
        self.assertEqual(observation["bboxNormalized"], source["proposals"][0]["bboxNormalized"])
        self.assertEqual(len(observation["cropSha256"]), 64)
        self.assertNotIn("findings", result)
        self.assertNotIn("coverage", result)

    def test_release_profile_hashes_are_immutable(self) -> None:
        self.assertEqual(PROFILE_HASH_V1, "743ed8a34a0a740afa838277f6147d0f28a81e17fea1a856ac91b8d67ec4d01c")
        self.assertEqual(PROFILE_HASH_V2, "d957b90597b415b5ec894816f65304e8a679687099c83c43e09240fec914bb52")
        self.assertEqual(PROFILE_HASH_V3, "4e9bee5f3ffe6683ced20e9838e76a664ff159857d58f107b54fa501bab4e67a")
        self.assertEqual(PROFILE_HASH_V4, "9384e39c72eaf7cd2d1664a7b4855152240311b64ff3fd301625e7f3c57757be")
        self.assertEqual(PROFILE_HASH_V5, "d526877fc14eac48a61026f9e9c5394017e25b84d519bacc661af78e2fd89f78")
        self.assertEqual(PROFILE_HASH_V6, "0df298161c7ffc7b2b24e72b875db6a9c60805fac31216c04884ef11ac5fef04")

    def test_v6_uses_server_lock_without_gguf_projector(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        with (patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source),
              patch("inspector_worker.visual_vlm._post_vlm", return_value=("RADIATOR", "e" * 64)) as post,
              patch.dict(os.environ, {"VISUAL_VLM_BASE_URL": "http://vlm:8000/v1"})):
            result = VisualProposalAdapter().execute(self.lease(profile_version="v6"), {})
        source = result["analysis"]["sources"][0]
        self.assertEqual(result["providerProfileId"], "red-vector-proposals-v6")
        self.assertEqual(result["providerConfigHash"], PROFILE_HASH_V6)
        self.assertEqual(result["analysis"]["schemaVersion"], "visual-proposal-analysis-v6")
        self.assertEqual(result["outputCount"], 1)
        self.assertEqual(source["proposals"][0]["status"], "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED")
        observation = source["vlm"]["observations"][0]
        self.assertEqual(observation["modelId"], "inspector-qwen3-vl-8b-fp8")
        self.assertEqual(observation["modelRevision"], "9cdc6310a8cb770ce18efaf4e9935334512aee45")
        self.assertNotIn("modelProjectorSha256", observation)
        self.assertEqual(observation["decision"], "RADIATOR_HINT")
        post.assert_called_once_with("http://vlm:8000/v1", ANY,
                                     model_id="inspector-qwen3-vl-8b-fp8", require_response_model=True)
        self.assertNotIn("findings", result)
        self.assertNotIn("coverage", result)

    def test_v6_profile_pins_current_server_model_store_lock(self) -> None:
        lock_path = Path(__file__).resolve().parents[3] / "services/model-store/locks/server.json"
        raw = lock_path.read_bytes()
        lock = json.loads(raw)
        model = next(item for item in lock["models"] if item["modelId"] == "Qwen/Qwen3-VL-8B-Instruct-FP8")
        self.assertEqual(hashlib.sha256(raw).hexdigest(), PROFILE_V6["vlmModelLockSha256"])
        self.assertEqual(model["revision"], PROFILE_V6["vlmModelRevision"])
        self.assertEqual([{"filename": item["filename"], "sha256": item["sha256"]}
                          for item in model["artifacts"] if item["filename"].endswith(".safetensors")],
                         PROFILE_V6["vlmModelShards"])

    def test_rejects_modified_immutable_provider_config(self) -> None:
        lease = self.lease()
        lease["release"]["providerSlot"]["configHash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "immutable release"):
            VisualProposalAdapter().execute(lease, {})

    def test_v8_pins_new_crop_method_and_preserves_v7_model_and_budgets(self) -> None:
        self.assertEqual(PROFILE_HASH_V7_SAMPLE, "5c8d419817da3e200afc18ff82e8feb0656fed6151d3bc0c7632b0c00babbcf3")
        self.assertEqual(PROFILE_HASH_V7_FULL, "84ea95857ca44def8f5c6a5fac74fbbee8d8ffd03b0367497262fe2c4a6e72fd")
        self.assertEqual(PROFILE_HASH_V8_SAMPLE, "9f9d6a4c9b67a89309b1163711507d11411bdeb29393dcdcb62f15747aac4bcd")
        self.assertEqual(PROFILE_HASH_V8_FULL, "b6c559590a69e0e4ff2018fcfe7f9389c98ab0080bf32373ba24de6a9a441476")
        for old, new, digest in [(PROFILE_V7_SAMPLE, PROFILE_V8_SAMPLE, PROFILE_HASH_V8_SAMPLE),
                                 (PROFILE_V7_FULL, PROFILE_V8_FULL, PROFILE_HASH_V8_FULL)]:
            self.assertEqual(new, {**old, "schemaVersion": "visual-proposal-profile-v8",
                                  "vlmCropMethodId": "normalized-display-square-v2"})
            self.assertNotIn("vlmCropMethodId", old)
            self.assertEqual(digest, hashlib.sha256(json.dumps(new, ensure_ascii=False,
                sort_keys=True, separators=(",", ":")).encode()).hexdigest())
            self.assertNotIn(digest, [PROFILE_HASH_V7_SAMPLE, PROFILE_HASH_V7_FULL])

    def test_v8_adapter_forwards_displayed_method_and_keeps_v7_scanner_and_legacy_crop(self) -> None:
        from inspector_worker.visual_vlm import render_crop
        from inspector_worker.vector_proposals import scan_pdf

        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        for version in ["v7-sample", "v7-full", "v8-sample", "v8-full"]:
            with self.subTest(version=version), \
                 patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source), \
                 patch("inspector_worker.visual_proposal_adapter.scan_pdf", wraps=scan_pdf) as scanner, \
                 patch("inspector_worker.visual_vlm.render_crop", wraps=render_crop) as crop, \
                 patch.dict(os.environ, {"VISUAL_VLM_BASE_URL": "", "INSPECTOR_VISUAL_CACHE_ROOT": ""}):
                attempt = {}
                result = VisualProposalAdapter().execute(self.lease(profile_version=version), attempt)
                self.assertEqual(scanner.call_args.kwargs["profile_version"], "v7")
                self.assertEqual(crop.call_count, 1)
                self.assertEqual(crop.call_args.args[3], 2048)
                self.assertEqual(crop.call_args.kwargs["crop_method_id"],
                    "normalized-display-square-v2" if version.startswith("v8") else "normalized-derotated-square-v1")
                self.assertEqual(result["analysis"]["schemaVersion"], f"visual-proposal-analysis-{version[:2]}")
                self.assertEqual(result["analysis"]["sources"][0]["vlm"]["observations"][0]["reasonCode"],
                                 "ENDPOINT_NOT_CONFIGURED")
                self.assertEqual(attempt["visualProgress"]["processed"], 1)
                self.assertEqual(attempt["visualProgress"]["completedDocuments"], 1)
                self.assertNotIn("findings", result)
                self.assertNotIn("coverage", result)

    def test_v8_full_rejects_page_or_proposal_truncation_and_profile_mismatch(self) -> None:
        def copy_source(_path, destination, _sha, _size, _attempt):
            destination.write_bytes(self.path.read_bytes())

        for gap in [{"skippedPageCount": 1, "unretainedProposalCount": 0},
                    {"skippedPageCount": 0, "unretainedProposalCount": 1}]:
            with self.subTest(gap=gap), \
                 patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=copy_source), \
                 patch("inspector_worker.visual_proposal_adapter.scan_pdf", return_value=gap):
                with self.assertRaisesRegex(ValueError, "FULL_ANALYSIS_LIMIT_EXCEEDED"):
                    VisualProposalAdapter().execute(self.lease(profile_version="v8-full"), {})
        for field, value in [("configHash", PROFILE_HASH_V7_FULL), ("adapterVersion", "7")]:
            lease = self.lease(profile_version="v8-full")
            lease["release"]["providerSlot"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "immutable release"):
                VisualProposalAdapter().execute(lease, {})

    def test_rejects_profile_version_mismatch_and_malformed_id(self) -> None:
        for invalid_id, invalid_adapter in (
            ("red-vector-proposals-v2", "1"),
            ("red-vector-proposals-v1", "2"),
            ("red-vector-proposals-v3", "2"),
            (["red-vector-proposals-v3"], "3"),
        ):
            with self.subTest(profile_id=invalid_id, adapter_version=invalid_adapter):
                lease = self.lease()
                lease["release"]["providerSlot"]["profileId"] = invalid_id
                lease["release"]["providerSlot"]["adapterVersion"] = invalid_adapter
                with self.assertRaisesRegex(ValueError, "immutable release"):
                    VisualProposalAdapter().execute(lease, {})


if __name__ == "__main__":
    unittest.main()
