from __future__ import annotations

import copy
import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.analysis_pilot import analyze_pz002_bundle, prioritize_ocr_pages, run_pz002_pilot
from inspector_worker.ocr_pilot import (
    canonical_hash, extract_pz_002_ocr_facts, recognize_pdf_page, validate_ocr_artifact,
)
from inspector_worker.typed_rules import evaluate_numeric_rule
from test_parameter_routing import HASH_B, artifact, page
from test_typed_rules import case


def ocr_page(source_hash: str = HASH_B, source_id: str = "RD-1") -> dict:
    value = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": source_id,
        "inputSha256": source_hash, "pageNumber": 1,
        "render": {"sha256": "a" * 64, "widthPx": 1000, "heightPx": 1000,
                   "dpi": 120, "rendererProfileId": "pdfium-test"},
        "provider": {"profileId": "paddle-test", "script": "eslav"},
        "lines": [
            {"text": "Общая площадь здания", "score": 0.98, "bboxPx": [10, 10, 400, 40]},
            {"text": "102,00 м²", "score": 0.95, "bboxPx": [410, 10, 600, 40]},
        ],
    }
    value["contentHash"] = canonical_hash(value)
    return value


class OcrPilotTests(unittest.TestCase):
    def test_small_ocr_budget_prefers_pages_near_subject_matches(self) -> None:
        route = {"stages": [{
            "candidates": [{"sourceFileId": "PD-1", "pageNumber": 26,
                            "reasonCodes": ["SUBJECT_TEXT_MATCH"]}],
            "ocrPages": [{"sourceFileId": "PD-1", "pageNumber": number}
                         for number in (1, 2, 25, 27, 80)],
        }, {
            "candidates": [], "ocrPages": [{"sourceFileId": "RD-1", "pageNumber": 1}],
        }]}
        self.assertEqual(prioritize_ocr_pages(route)[:2], [("PD-1", 25), ("PD-1", 27)])
        self.assertEqual(set(prioritize_ocr_pages(route)),
                         {("PD-1", number) for number in (1, 2, 25, 27, 80)} | {("RD-1", 1)})
        route["stages"][1]["candidates"] = [{
            "sourceFileId": "RD-1", "pageNumber": 10,
            "reasonCodes": ["SUBJECT_TEXT_MATCH"],
        }]
        self.assertEqual(prioritize_ocr_pages(route)[:2], [("PD-1", 25), ("RD-1", 1)])

    def test_ocr_fact_is_candidate_with_pixel_evidence(self) -> None:
        rule, sources, text, facts = case()
        text[1] = artifact("RD-1", HASH_B, [page(1, "")])
        ocr = ocr_page()
        extracted = extract_pz_002_ocr_facts(ocr, entity_key="building-total")
        self.assertEqual(len(extracted), 1)
        result = evaluate_numeric_rule(rule, sources, text, [facts[0], *extracted], ocr_artifacts=[ocr])
        self.assertEqual(result["machineStatus"], "CANDIDATE")
        self.assertEqual(result["reasonCode"], "THRESHOLD_EXCEEDED_OCR_REVIEW_REQUIRED")
        self.assertEqual(result["evidence"][1]["coordinateSystem"], "RENDER_TOP_LEFT_PX")
        self.assertEqual(result["evidence"][1]["bboxPx"], [10, 10, 600, 40])

    def test_modified_ocr_value_or_geometry_is_rejected(self) -> None:
        rule, sources, text, facts = case()
        text[1] = artifact("RD-1", HASH_B, [page(1, "")])
        ocr = ocr_page()
        extracted = extract_pz_002_ocr_facts(ocr, entity_key="building-total")
        forged = copy.deepcopy(extracted)
        forged[0]["rawValue"] = "999"
        self.assertEqual(evaluate_numeric_rule(rule, sources, text, [facts[0], *forged],
                                               ocr_artifacts=[ocr])["reasonCode"], "VALUE_UNIT_NOT_IN_OCR_LINES")
        altered = copy.deepcopy(ocr)
        altered["lines"][1]["bboxPx"][2] = 2000
        with self.assertRaisesRegex(ValueError, "geometry"):
            validate_ocr_artifact(altered, source_id="RD-1", source_hash=HASH_B, page_number=1)
        altered = copy.deepcopy(ocr)
        altered["lines"][1]["text"] = "999 м²"
        with self.assertRaisesRegex(ValueError, "contentHash"):
            validate_ocr_artifact(altered, source_id="RD-1", source_hash=HASH_B, page_number=1)

    def test_incomplete_ocr_scope_cannot_create_candidate(self) -> None:
        rule, sources, text, facts = case()
        text[1] = artifact("RD-1", HASH_B, [page(1, "")])
        ocr = ocr_page()
        extracted = extract_pz_002_ocr_facts(ocr, entity_key="building-total")
        result = evaluate_numeric_rule(rule, sources, text, [facts[0], *extracted],
                                       ocr_artifacts=[ocr], search_complete=False)
        self.assertEqual(result["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["reasonCode"], "SEARCH_SCOPE_INCOMPLETE")

    def test_local_provider_response_and_pdf_hash_are_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pdf_path = Path(directory) / "source.pdf"
            pdf_path.write_bytes(b"synthetic pdf bytes")
            digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
            png = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 1000, 1000)
            headers = {"x-render-width": "1000", "x-render-height": "1000",
                       "x-source-page-count": "1", "x-render-dpi": "120", "x-renderer-profile": "pdfium-test"}
            result = {"schemaVersion": "document-ai-ocr-response-v1", "script": "eslav",
                      "profileId": "paddle-test", "results": [{"overall_ocr_res": {
                          "rec_texts": ["Общая площадь здания 102,00 м²"], "rec_scores": [1.0],
                          "rec_boxes": [[10.0, 10.0, 500.0, 40.0]],
                      }}]}
            with patch("inspector_worker.ocr_pilot._post_file", side_effect=[
                (png, headers), (json.dumps(result).encode(), {}),
            ]) as post:
                extracted = recognize_pdf_page(pdf_path, "RD-1", digest, 1, 1,
                                                base_url="http://127.0.0.1:8080")
            self.assertEqual(post.call_count, 2)
            self.assertEqual(extracted["render"]["sha256"], hashlib.sha256(png).hexdigest())
            self.assertEqual(extracted["lines"][0]["score"], 1)
            self.assertEqual(extracted["lines"][0]["bboxPx"], [10, 10, 500, 40])
            self.assertEqual(len(extract_pz_002_ocr_facts(extracted, entity_key="building-total")), 1)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                recognize_pdf_page(pdf_path, "RD-1", "f" * 64, 1, 1,
                                   base_url="http://127.0.0.1:8080")
            with self.assertRaisesRegex(ValueError, "local HTTP"):
                recognize_pdf_page(pdf_path, "RD-1", digest, 1, 1,
                                   base_url="https://public.example.com")

    def test_public_pilot_uses_only_ocr_required_pages(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for source_id, stage in (("PD-1", "PD"), ("RD-1", "RD")):
                path = root / f"{source_id}.pdf"
                path.write_bytes(source_id.encode())
                rows.append({"file_id": source_id, "object_id": "OBJECT-1", "split": "TRAIN_PUBLIC",
                             "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                             "relative_path": path.name, "extension": ".pdf", "stage": stage,
                             "section": "PZ", "size_bytes": path.stat().st_size,
                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "pdf_pages": 1})
            manifest = root / "manifest.jsonl"
            manifest.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
            rule = case()[0]
            del rule["objectId"]
            navigation = {"ruleId": "pz-002-navigation", "version": "1", "parameterCode": "PZ-002",
                          "requiredStages": ["PD", "RD"], "subjectTerms": ["общая площадь здания"],
                          "locationTerms": [], "visualFactRequired": False}
            decisions = {row["file_id"]: {"sourceSha256": row["sha256"],
                          "revisionStatus": "CURRENT", "approvalStatus": "APPROVED",
                          "linkGroupId": "BUILDING-1", "basis": {"reference": "reviewed test"}}
                         for row in rows}

            def text_artifact(_path, source_id, digest):
                content = "Общая площадь здания 100,00 м²" if source_id == "PD-1" else ""
                return artifact(source_id, digest, [page(1, content)])

            with (patch("inspector_worker.public_pilot.extract_pdf_text_artifact", side_effect=text_artifact),
                  patch("inspector_worker.analysis_pilot.recognize_pdf_page",
                        return_value=ocr_page(rows[1]["sha256"])) as recognize):
                output = run_pz002_pilot(manifest, root, ["PD-1", "RD-1"], navigation, rule,
                                         decisions, document_ai_url="http://127.0.0.1:8080")
            self.assertEqual(recognize.call_count, 1)
            self.assertEqual(output["ocrRequiredPageCount"], 1)
            self.assertEqual(output["ocrDeferredPageCount"], 0)
            self.assertEqual(output["evaluation"]["machineStatus"], "CANDIDATE")

    def test_bundle_can_route_selected_ocr_through_durable_callback(self) -> None:
        rule, sources, texts, _facts = case()
        texts[1] = artifact("RD-1", HASH_B, [page(1, "")])
        navigation = {"ruleId": "pz-002-navigation", "version": "1",
                      "parameterCode": "PZ-002", "requiredStages": ["PD", "RD"],
                      "subjectTerms": ["общая площадь здания"],
                      "locationTerms": [], "visualFactRequired": False}
        bundle = {"objectId": "OBJECT-1", "selectedManifestHash": "f" * 64,
                  "sources": sources, "textArtifacts": texts}
        calls: list[tuple[str, int, int, str]] = []

        def read(source_id: str, number: int, count: int, base_url: str) -> dict:
            calls.append((source_id, number, count, base_url))
            return ocr_page()

        with patch("inspector_worker.analysis_pilot.recognize_pdf_page",
                   side_effect=AssertionError("direct OCR should not run")):
            result = analyze_pz002_bundle(
                bundle, navigation, rule, document_ai_url="http://127.0.0.1:8080",
                max_ocr_pages=1, max_table_pages=0, max_table_ocr_pages=0,
                source_path_for_ocr=lambda _source_id: Path("/unused.pdf"),
                recognize_page=read,
            )
        self.assertEqual(calls, [("RD-1", 1, 1, "http://127.0.0.1:8080")])
        self.assertEqual(result["ocrProcessedPageCount"], 1)


if __name__ == "__main__":
    unittest.main()
