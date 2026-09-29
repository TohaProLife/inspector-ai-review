from __future__ import annotations

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import fitz

from inspector_worker.visual_vlm import (
    _post_vlm, observe_proposals, render_crop, selected_ordinals, validate_local_url,
)


class VisualVlmTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pdf = Path(self.temp.name) / "source.pdf"
        with fitz.open() as document:
            page = document.new_page(width=200, height=100)
            page.draw_rect(fitz.Rect(20, 10, 26, 60), color=(1, 0, 0), width=.4)
            page.draw_line(fitz.Point(26, 30), fitz.Point(65, 30), color=(0, 0, 1))
            page.set_rotation(90)
            document.save(self.pdf)
        self.sha = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.source = {
            "sourceSha256": self.sha,
            "proposals": [{"pageNumber": 1, "bboxNormalized": [.1, .1, .6, .13]} for _ in range(5)],
        }

    def test_selection_and_local_url_allowlist(self) -> None:
        self.assertEqual(selected_ordinals(0), [])
        self.assertEqual(selected_ordinals(2), [0, 1])
        self.assertEqual(selected_ordinals(5), [1, 3])
        self.assertEqual(validate_local_url("http://visual-vlm:8080/v1"), "http://visual-vlm:8080/v1")
        self.assertEqual(validate_local_url("http://vlm:8000/v1", "v6"), "http://vlm:8000/v1")
        with self.assertRaises(ValueError):
            validate_local_url("http://vlm:8000/v1", "v5")
        with self.assertRaises(ValueError):
            validate_local_url("http://visual-vlm:8080/v1", "v6")
        for value in ("https://visual-vlm:8080/v1", "http://example.com/v1",
                      "http://visual-vlm:9000/v1", "http://127.0.0.1:18086/v1/other",
                      "http://user:pass@visual-vlm:8080/v1"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_local_url(value)

    def test_rotated_crop_is_bounded_and_has_stable_hash(self) -> None:
        png = render_crop(self.pdf, 1, [.1, .1, .6, .13])
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(png, render_crop(self.pdf, 1, [.1, .1, .6, .13]))
        pixmap = fitz.Pixmap(png)
        self.assertLessEqual(max(pixmap.width, pixmap.height), 772)

    def test_errors_and_truncation_stay_separate_from_proposals(self) -> None:
        before = json.loads(json.dumps(self.source))
        observed = observe_proposals(self.pdf, self.source, None)
        self.assertEqual(observed["selectedOrdinals"], [1, 3])
        self.assertEqual(observed["eligibleProposalCount"], 5)
        self.assertEqual(observed["omittedProposalCount"], 3)
        self.assertTrue(all(item["reasonCode"] == "ENDPOINT_NOT_CONFIGURED" for item in observed["observations"]))
        self.assertTrue(all(item["decision"] == "ABSTAIN" for item in observed["observations"]))
        self.assertEqual(self.source, before)
        with patch("inspector_worker.visual_vlm._post_vlm", side_effect=TimeoutError):
            failed = observe_proposals(self.pdf, self.source, "http://visual-vlm:8080/v1")
        self.assertTrue(all(item["reasonCode"] == "MODEL_TIMEOUT" for item in failed["observations"]))

    def test_v6_other_is_abstention_and_preserves_response_hash(self) -> None:
        with patch("inspector_worker.visual_vlm._post_vlm", return_value=("OTHER", "f" * 64)):
            observed = observe_proposals(self.pdf, self.source, "http://vlm:8000/v1", "v6")
        self.assertEqual(observed["methodId"], "spread-two-saved-proposals-server-nonnegative-v1")
        for item in observed["observations"]:
            self.assertEqual(item["decision"], "ABSTAIN")
            self.assertEqual(item["reasonCode"], "MODEL_OTHER_UNTRUSTED")
            self.assertEqual(item["responseSha256"], "f" * 64)
            self.assertEqual(item["modelId"], "inspector-qwen3-vl-8b-fp8")
            self.assertNotIn("modelProjectorSha256", item)

    def test_v6_rejects_wrong_response_model(self) -> None:
        class Handler(BaseHTTPRequestHandler):
            model = "inspector-qwen3-vl-8b-fp8"
            requested_model = None

            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                type(self).requested_model = request["model"]
                raw = json.dumps({"model": type(self).model, "choices": [
                    {"finish_reason": "stop", "message": {"content": "ABSTAIN"}},
                ]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/v1"
        answer, _ = _post_vlm(url, b"\x89PNG\r\n\x1a\n", model_id=Handler.model,
                              require_response_model=True)
        self.assertEqual(answer, "ABSTAIN")
        self.assertEqual(Handler.requested_model, Handler.model)
        Handler.model = "inspector-qwen3vl4b-eval"
        with self.assertRaisesRegex(ValueError, "MODEL_OUTPUT_INVALID"):
            _post_vlm(url, b"\x89PNG\r\n\x1a\n", model_id="inspector-qwen3-vl-8b-fp8",
                      require_response_model=True)

    def test_http_uses_no_proxy_and_rejects_redirect(self) -> None:
        class Handler(BaseHTTPRequestHandler):
            redirect = False
            requests = 0

            def do_POST(self):
                type(self).requests += 1
                _ = self.rfile.read(int(self.headers["Content-Length"]))
                if type(self).redirect:
                    self.send_response(302)
                    self.send_header("Location", "http://example.com/")
                    self.end_headers()
                    return
                raw = json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": "ABSTAIN"}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9"}):
            answer, response_hash = _post_vlm(f"http://127.0.0.1:{server.server_port}/v1", b"\x89PNG\r\n\x1a\n")
            self.assertEqual(answer, "ABSTAIN")
            self.assertEqual(len(response_hash), 64)
            Handler.redirect = True
            with self.assertRaisesRegex(ValueError, "MODEL_REDIRECT_REJECTED"):
                _post_vlm(f"http://127.0.0.1:{server.server_port}/v1", b"\x89PNG\r\n\x1a\n")
        self.assertEqual(Handler.requests, 2)


if __name__ == "__main__":
    unittest.main()
