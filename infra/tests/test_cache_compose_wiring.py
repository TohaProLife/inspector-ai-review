"""Catch OCR/text cache volumes mounted on the wrong job queue worker."""

import unittest
from pathlib import Path

import yaml


COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


class CacheComposeWiringTests(unittest.TestCase):
    def test_text_and_ocr_volumes_follow_their_job_queues(self) -> None:
        services = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]
        render = services["document-worker"]
        extract = services["extract-worker"]
        rules = services["worker"]
        self.assertEqual(render["command"][-1], "documents.render")
        self.assertEqual(extract["command"][-1], "documents.extract")
        self.assertEqual(render["environment"]["INSPECTOR_DURABLE_TEXT_CACHE_ROOT"],
                         "/text-layer-cache")
        self.assertIn("text-layer-cache:/text-layer-cache", render["volumes"])
        for service in (extract, rules):
            self.assertEqual(service["environment"]["INSPECTOR_DURABLE_OCR_CACHE_ROOT"],
                             "/ocr-page-cache")
            self.assertIn("ocr-page-cache:/ocr-page-cache", service["volumes"])
        self.assertNotIn("INSPECTOR_DURABLE_TEXT_CACHE_ROOT", extract["environment"])


if __name__ == "__main__":
    unittest.main()
