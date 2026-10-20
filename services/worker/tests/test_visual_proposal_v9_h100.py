"""Independent synthetic HTTP oracle for the new server feedback release."""
import base64
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

import fitz

from inspector_worker import visual_proposal_adapter as adapter


LEGACY_HASHES = {
    "red-vector-proposals-v1": "743ed8a34a0a740afa838277f6147d0f28a81e17fea1a856ac91b8d67ec4d01c",
    "red-vector-proposals-v2": "d957b90597b415b5ec894816f65304e8a679687099c83c43e09240fec914bb52",
    "red-vector-proposals-v3": "4e9bee5f3ffe6683ced20e9838e76a664ff159857d58f107b54fa501bab4e67a",
    "red-vector-proposals-v4": "9384e39c72eaf7cd2d1664a7b4855152240311b64ff3fd301625e7f3c57757be",
    "red-vector-proposals-v5": "d526877fc14eac48a61026f9e9c5394017e25b84d519bacc661af78e2fd89f78",
    "red-vector-proposals-v6": "0df298161c7ffc7b2b24e72b875db6a9c60805fac31216c04884ef11ac5fef04",
    "red-vector-proposals-v7-sample": "5c8d419817da3e200afc18ff82e8feb0656fed6151d3bc0c7632b0c00babbcf3",
    "red-vector-proposals-v7-full": "84ea95857ca44def8f5c6a5fac74fbbee8d8ffd03b0367497262fe2c4a6e72fd",
    "red-vector-proposals-v8-sample": "9f9d6a4c9b67a89309b1163711507d11411bdeb29393dcdcb62f15747aac4bcd",
    "red-vector-proposals-v8-full": "b6c559590a69e0e4ff2018fcfe7f9389c98ab0080bf32373ba24de6a9a441476",
}


class V9ServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.pdf = self.directory / "five-proposals.pdf"
        with fitz.open() as document:
            for _ in range(5):
                page = document.new_page(width=200, height=100)
                page.draw_rect(fitz.Rect(20, 10, 26, 60), color=(1, 0, 0), width=.4)
                page.draw_line(fitz.Point(26, 30), fitz.Point(65, 30), color=(0, 0, 1))
            document.set_metadata({"title": "Система отопления"})
            document.set_toc([[1, "Система вентиляции", 3]])
            document.save(self.pdf)

    def lease(self, mode):
        return {"objectId": "OBJ-V9-ORACLE", "inputManifestHash": "a"*64,
            "release": {"lifecycle": "DRAFT", "providerSlot": {
                "stageJobType": "ENTITY_EXTRACTION", "providerKind": "ENTITY_EXTRACTION_MODEL", "status": "CONFIGURED",
                "profileId": getattr(adapter, "PROFILE_ID_V9_" + mode), "adapterVersion": "9",
                "configHash": getattr(adapter, "PROFILE_HASH_V9_" + mode)}},
            "inputs": {"sourceFiles": [{"sourceFileId": "FIL-V9", "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
                "byteSize": self.pdf.stat().st_size, "mediaType": "application/pdf", "downloadPath": "/api/internal/v1/jobs/oracle/inputs/FIL-V9"}]}}

    def execute_http(self, mode, *, response_model="inspector-qwen3-vl-8b-fp8", answer="OTHER", cache_root=None):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                png = base64.b64decode(body["messages"][0]["content"][1]["image_url"]["url"].split(",", 1)[1])
                image = fitz.Pixmap(png)
                requests.append({"path": self.path, "host": self.headers["Host"], "model": body["model"],
                    "maxTokens": body["max_tokens"], "imageMaxEdge": max(image.width, image.height)})
                raw = json.dumps({"model": response_model, "choices": [{"finish_reason": "stop", "message": {"content": answer}}]}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
            def log_message(self, *_): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.shutdown)
        original = socket.getaddrinfo
        def resolve(host, port, *args, **kwargs):
            self.assertEqual((host, port), ("vlm", 8000))
            return original("127.0.0.1", server.server_port, *args, **kwargs)
        def download(_url, destination, *_): destination.write_bytes(self.pdf.read_bytes())
        attempt = {}
        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=download), \
             patch("socket.getaddrinfo", side_effect=resolve), patch.dict(os.environ, {"VISUAL_VLM_BASE_URL": "http://vlm:8000/v1",
                 "INSPECTOR_VISUAL_CACHE_ROOT": str(cache_root or self.directory / (mode + response_model + answer))}):
            result = adapter.VisualProposalAdapter().execute(self.lease(mode), attempt)
        return result, attempt, requests

    def test_full_five_real_local_http_calls_and_sample_two_independent_oracle(self):
        for mode, ordinals, omitted in (("FULL", [0, 1, 2, 3, 4], 0), ("SAMPLE", [1, 3], 3)):
            with self.subTest(mode=mode):
                result, attempt, requests = self.execute_http(mode)
                source = result["analysis"]["sources"][0]; vlm = source["vlm"]
                self.assertEqual(len(requests), len(ordinals)); self.assertEqual(vlm["selectedOrdinals"], ordinals)
                self.assertEqual(vlm["omittedProposalCount"], omitted)
                self.assertEqual(vlm["methodId"], "all-saved-proposals-server-nonnegative-v1" if mode == "FULL" else "spread-two-saved-proposals-server-nonnegative-v1")
                self.assertTrue(all(q["path"] == "/v1/chat/completions" and q["host"] == "vlm:8000" and
                    q["model"] == "inspector-qwen3-vl-8b-fp8" and q["maxTokens"] == 8 and 768 < q["imageMaxEdge"] <= 2052 for q in requests))
                self.assertEqual(source["documentContext"]["schemaVersion"], "document-context-v2")
                self.assertEqual(source["documentContext"]["domains"], ["HEATING", "VENTILATION"])
                self.assertEqual(len(source["documentContext"]["inspectedPages"]), 5)
                self.assertEqual(attempt["visualProgress"]["processed"], len(ordinals))
                self.assertEqual(attempt["visualProgress"]["failed"], 0)
                self.assertEqual(result["reasonCode"], "PROPOSAL_ONLY_UNVERIFIED")
                self.assertNotIn("findings", result); self.assertNotIn("coverage", result)
                for observation in vlm["observations"]:
                    self.assertEqual(observation["decision"], "ABSTAIN")
                    self.assertEqual(observation["reasonCode"], "MODEL_OTHER_UNTRUSTED")
                    self.assertIsNone(observation.get("p")); self.assertNotIn("absenceProven", observation)
                    self.assertEqual(observation["modelLockSha256"], "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879")

    def test_wrong_response_model_abstains_and_counts_failure(self):
        result, attempt, requests = self.execute_http("SAMPLE", response_model="wrong-model", answer="RADIATOR")
        self.assertEqual(len(requests), 2)
        observations = result["analysis"]["sources"][0]["vlm"]["observations"]
        self.assertTrue(all(o["reasonCode"] == "MODEL_OUTPUT_INVALID" and o["decision"] == "ABSTAIN" and o["responseSha256"] is None for o in observations))
        self.assertEqual(attempt["visualProgress"]["failed"], 2)

    def test_positive_and_abstain_answers_remain_hints_without_findings_or_probability(self):
        for answer, decision, reason in (("RADIATOR", "RADIATOR_HINT", "MODEL_RESPONSE"), ("ABSTAIN", "ABSTAIN", "MODEL_ABSTAIN")):
            with self.subTest(answer=answer):
                result, _, requests = self.execute_http("SAMPLE", answer=answer)
                self.assertEqual(len(requests), 2)
                self.assertNotIn("findings", result)
                for observation in result["analysis"]["sources"][0]["vlm"]["observations"]:
                    self.assertEqual((observation["decision"], observation["reasonCode"]), (decision, reason))
                    self.assertIsNone(observation.get("p")); self.assertNotIn("absenceProven", observation)

    def test_full_limits_fail_before_model_and_cannot_be_successful_partial(self):
        def download(_url, destination, *_): destination.write_bytes(self.pdf.read_bytes())
        source = {"skippedPageCount": 1, "unretainedProposalCount": 0}
        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=download), \
             patch("inspector_worker.visual_proposal_adapter.scan_pdf", return_value=source), \
             patch("inspector_worker.visual_proposal_adapter.observe_proposals") as model:
            with self.assertRaisesRegex(ValueError, "FULL_ANALYSIS_LIMIT_EXCEEDED"):
                adapter.VisualProposalAdapter().execute(self.lease("FULL"), {})
            model.assert_not_called()

    def test_v9_resume_uses_profile_namespace_and_never_caches_response_failures(self):
        shared = self.directory / "shared-profile-cache"
        full, _, first = self.execute_http("FULL", answer="RADIATOR", cache_root=shared)
        replay, _, second = self.execute_http("FULL", answer="RADIATOR", cache_root=shared)
        sample, _, third = self.execute_http("SAMPLE", answer="RADIATOR", cache_root=shared)
        self.assertEqual((len(first), len(second), len(third)), (5, 0, 2))
        self.assertEqual(full, replay)
        self.assertEqual(sample["analysis"]["sources"][0]["vlm"]["selectedOrdinals"], [1, 3])
        self.assertEqual(len(list(shared.glob("*.json"))), 7)
        failure_cache = self.directory / "response-failure-cache"
        for _ in range(2):
            _, attempt, requests = self.execute_http("SAMPLE", response_model="wrong-model", answer="RADIATOR", cache_root=failure_cache)
            self.assertEqual(len(requests), 2)
            self.assertEqual(attempt["visualProgress"]["failed"], 2)
            self.assertEqual(list(failure_cache.glob("*.json")), [])
        _, attempt, recovered = self.execute_http("SAMPLE", answer="RADIATOR", cache_root=failure_cache)
        self.assertEqual(len(recovered), 2)
        self.assertEqual(attempt["visualProgress"]["failed"], 0)

    def test_legacy_hashes_identical_and_v9_model_scope_hashes_independent(self):
        for key, expected in LEGACY_HASHES.items():
            self.assertEqual(adapter._PROFILES[key][1], expected)
        for mode, expected in (("SAMPLE", "6ca99692c980c76e5eab5fef31a199fd80f02f7dc308142ed9eb3273807d3930"),
                               ("FULL", "316488e0793d23652d62dd3d531f11282abe587645a06fcdb2a84609039147af")):
            profile = getattr(adapter, "PROFILE_V9_" + mode)
            self.assertEqual(hashlib.sha256(json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), expected)
            self.assertNotIn("vlmModelWeightsSha256", profile)
            self.assertEqual(profile["vlmCropMethodId"], "normalized-display-square-v2")

    def test_wrong_slot_hash_and_external_provider_are_rejected(self):
        lease = self.lease("FULL"); lease["release"]["providerSlot"]["configHash"] = "f"*64
        with self.assertRaisesRegex(ValueError, "immutable release"):
            adapter.VisualProposalAdapter().execute(lease, {})
        def download(_url, destination, *_): destination.write_bytes(self.pdf.read_bytes())
        with patch("inspector_worker.visual_proposal_adapter._download_source", side_effect=download), \
             patch.dict(os.environ, {"VISUAL_VLM_BASE_URL": "https://external.example/v1"}):
            with self.assertRaisesRegex(ValueError, "allowlisted local HTTP"):
                adapter.VisualProposalAdapter().execute(self.lease("SAMPLE"), {})


if __name__ == "__main__": unittest.main()
