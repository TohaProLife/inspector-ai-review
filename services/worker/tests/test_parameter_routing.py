from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.parameter_routing import route_parameter
from inspector_worker.public_pilot import run_public_pilot
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


HASH_A = "a" * 64
HASH_B = "b" * 64


def page(number: int, text: str) -> dict[str, object]:
    return {
        "pageNumber": number,
        "widthMilliPoints": 100_000,
        "heightMilliPoints": 100_000,
        "blocks": [{"bboxMilliPoints": [100, 200, 500, 600], "text": text}] if text else [],
        "quality": qualify_page_text([text] if text else []),
    }


def artifact(source_id: str, source_hash: str, pages: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schemaVersion": "document-text-v2",
        "sourceFileId": source_id,
        "inputSha256": source_hash,
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages),
        "textPageCount": sum(bool(item["blocks"]) for item in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {
            "textLayerCandidatePageCount": sum(item["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for item in pages),
            "ocrRequiredPageCount": sum(item["quality"]["disposition"] == "OCR_REQUIRED" for item in pages),
        },
        "pages": pages,
    }


def request() -> dict[str, object]:
    return {
        "schemaVersion": "parameter-route-request-v1",
        "inputManifestHash": "f" * 64,
        "objectId": "OBJECT-1",
        "rule": {
            "ruleId": "pilot-room-radiator",
            "version": "1",
            "parameterCode": "IOS4-077",
            "requiredStages": ["PD", "RD"],
            "sectionCodes": ["OV"],
            "subjectTerms": ["радиатор"],
            "locationTerms": ["помещение 012"],
            "visualFactRequired": True,
        },
        "sources": [
            {
                "sourceFileId": "PD-1", "sha256": HASH_A, "objectId": "OBJECT-1", "stages": ["PD"],
                "sectionCode": "OV", "revisionStatus": "CURRENT", "approvalStatus": "APPROVED",
            },
            {
                "sourceFileId": "RD-1", "sha256": HASH_B, "objectId": "OBJECT-1", "stages": ["RD"],
                "sectionCode": "OV", "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
            },
        ],
        "textArtifacts": [
            artifact("PD-1", HASH_A, [page(1, "Радиатор, помещение 012"), page(2, "Радиатор, помещение 277")]),
            artifact("RD-1", HASH_B, [page(1, "План отопления. Помещение 012"), page(2, "")]),
        ],
    }


class ParameterRoutingTests(unittest.TestCase):
    def test_routes_room_page_but_does_not_claim_comparison_or_absence(self) -> None:
        result = route_parameter(request())
        pd, rd = result["stages"]

        self.assertEqual(result["disposition"], "NAVIGATION_ONLY")
        self.assertEqual(result["comparisonStatus"], "NOT_EVALUATED")
        self.assertFalse(result["absenceVerified"])
        self.assertEqual([candidate["pageNumber"] for candidate in pd["candidates"]], [1, 2])
        self.assertEqual(pd["candidates"][0]["reasonCodes"], [
            "SUBJECT_TEXT_MATCH", "LOCATION_TEXT_MATCH", "SECTION_HINT_MATCH",
        ])
        self.assertEqual(pd["candidates"][0]["sourceGate"], "REVISION_APPROVAL_CLEARED")
        self.assertEqual(pd["pageCountInScope"], 2)
        self.assertEqual(pd["textSearchedPageCount"], 2)
        self.assertEqual(rd["candidates"][0]["sourceGate"], "REVISION_APPROVAL_REVIEW_REQUIRED")
        self.assertEqual(rd["pageCountInScope"], 2)
        self.assertEqual(rd["textSearchedPageCount"], 1)
        self.assertEqual(rd["ocrPages"][0]["pageNumber"], 2)
        self.assertEqual(rd["sourceReview"][0]["reasonCodes"], ["REVISION_UNRESOLVED", "APPROVAL_UNRESOLVED"])

    def test_wrong_object_and_missing_required_stage_are_explicit(self) -> None:
        payload = request()
        payload["sources"][1]["objectId"] = "OBJECT-2"
        result = route_parameter(payload)
        self.assertEqual(result["stages"][1]["status"], "MISSING_SOURCE")
        self.assertEqual(result["stages"][1]["candidates"], [])

    def test_mixed_stage_source_requires_page_mapping(self) -> None:
        payload = request()
        payload["sources"][1]["stages"] = ["RD", "ID"]
        result = route_parameter(payload)
        self.assertEqual(result["stages"][1]["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["stages"][1]["candidates"], [])
        self.assertIn("STAGE_SEGMENTATION_REQUIRED", result["stages"][1]["sourceReview"][0]["reasonCodes"])

        payload["sources"][1]["pageStages"] = {"1": "RD", "2": "ID"}
        result = route_parameter(payload)
        self.assertEqual([candidate["pageNumber"] for candidate in result["stages"][1]["candidates"]], [1])
        self.assertEqual(result["stages"][1]["ocrPages"], [])

        payload["sources"][1]["pageStages"] = {"1": "RD"}
        result = route_parameter(payload)
        self.assertIn("STAGE_PAGES_UNASSIGNED", result["stages"][1]["sourceReview"][0]["reasonCodes"])

        payload["sources"][1]["pageStages"] = {"1": "RD", "2": "UNRESOLVED"}
        result = route_parameter(payload)
        self.assertEqual([candidate["pageNumber"] for candidate in result["stages"][1]["candidates"]], [1])
        self.assertEqual(result["stages"][1]["sourceReview"], [{
            "sourceFileId": payload["sources"][1]["sourceFileId"],
            "reasonCodes": ["STAGE_PAGES_UNRESOLVED", "REVISION_UNRESOLVED", "APPROVAL_UNRESOLVED"],
        }])

    def test_superseded_source_cannot_contribute_candidates(self) -> None:
        payload = request()
        payload["sources"][0]["revisionStatus"] = "SUPERSEDED"
        result = route_parameter(payload)
        self.assertEqual(result["stages"][0]["candidates"], [])
        self.assertEqual(result["stages"][0]["sourceReview"][0]["reasonCodes"], ["SUPERSEDED_REVISION"])

    def test_artifact_provenance_mismatch_fails_closed(self) -> None:
        payload = request()
        payload["textArtifacts"][0]["inputSha256"] = HASH_B
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            route_parameter(payload)

    def test_no_text_hit_is_not_verified_absence(self) -> None:
        payload = request()
        payload["textArtifacts"][0] = artifact("PD-1", HASH_A, [page(1, "Спецификация дверей")])
        result = route_parameter(payload)
        self.assertEqual(result["stages"][0]["status"], "NO_TEXT_CANDIDATE")
        self.assertFalse(result["absenceVerified"])

    def test_result_order_does_not_depend_on_source_input_order(self) -> None:
        payload = request()
        extra_source = copy.deepcopy(payload["sources"][0])
        extra_source["sourceFileId"] = "PD-0"
        payload["sources"].insert(0, extra_source)
        payload["textArtifacts"].insert(0, artifact("PD-0", HASH_A, [page(1, "Радиатор, помещение 012")]))
        before = route_parameter(payload)
        payload["sources"].reverse()
        payload["textArtifacts"].reverse()
        after = route_parameter(payload)
        self.assertEqual(before, after)

    def test_forged_text_quality_cannot_hide_ocr_requirement(self) -> None:
        payload = request()
        payload["textArtifacts"][1]["pages"][1]["quality"] = qualify_page_text(["Радиатор"])
        with self.assertRaisesRegex(ValueError, "quality does not match"):
            route_parameter(payload)

    def test_page_stage_mapping_must_refer_to_existing_page(self) -> None:
        payload = request()
        payload["sources"][1]["stages"] = ["RD", "ID"]
        payload["sources"][1]["pageStages"] = {"3": "RD"}
        with self.assertRaisesRegex(ValueError, "pageStages exceeds page count"):
            route_parameter(payload)

    def test_public_pilot_verifies_pdf_and_rejects_hidden_split(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "drawing.pdf"
            pdf.write_bytes(b"fake-pdf-content")
            digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
            row = {
                "file_id": "F0001", "object_id": "OBJECT-1", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": pdf.name, "extension": ".pdf", "stage": "PD", "section": "OV",
                "size_bytes": pdf.stat().st_size, "sha256": digest, "pdf_pages": 1,
            }
            manifest = root / "document_manifest.jsonl"
            manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
            rule = request()["rule"]
            with patch("inspector_worker.public_pilot.extract_pdf_text_artifact", return_value=artifact("F0001", digest, [page(1, "Радиатор")])):
                result = run_public_pilot(manifest, root, ["F0001"], rule)
            self.assertEqual(result["datasetSplit"], "TRAIN_PUBLIC")
            self.assertEqual(result["stages"][0]["candidates"][0]["sourceFileId"], "F0001")
            self.assertEqual(result["stages"][1]["status"], "MISSING_SOURCE")

            row["split"] = "TEST_HIDDEN"
            manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a distributed TRAIN_PUBLIC"):
                run_public_pilot(manifest, root, ["F0001"], rule)

            row["split"] = "TRAIN_PUBLIC"
            manifest.write_text(json.dumps(row) + "\n", encoding="utf-8")
            pdf.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "does not match manifest"):
                run_public_pilot(manifest, root, ["F0001"], rule)

    def test_extracted_source_override_keeps_manifest_hash_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            extracted = root / "extracted.pdf"
            extracted.write_bytes(b"verified-source")
            digest = hashlib.sha256(extracted.read_bytes()).hexdigest()
            row = {
                "file_id": "F0001", "object_id": "OBJECT-1", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "relative_path": "original/tree/source.pdf", "extension": ".pdf",
                "stage": "PD", "section": "OV", "size_bytes": extracted.stat().st_size,
                "sha256": digest, "pdf_pages": 1,
            }
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps(row) + "\n")
            with patch("inspector_worker.public_pilot.extract_pdf_text_artifact",
                       return_value=artifact("F0001", digest, [page(1, "Радиатор")])):
                result = run_public_pilot(manifest, root, ["F0001"], request()["rule"],
                                          source_overrides={"F0001": extracted})
            self.assertEqual(result["stages"][0]["candidates"][0]["sourceFileId"], "F0001")
            extracted.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "does not match manifest"):
                run_public_pilot(manifest, root, ["F0001"], request()["rule"],
                                 source_overrides={"F0001": extracted})


if __name__ == "__main__":
    unittest.main()
