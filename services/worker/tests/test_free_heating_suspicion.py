from __future__ import annotations

import unittest

from inspector_worker.free_heating_suspicion import analyze_free_heating_suspicion
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


def page(number: int, texts: list[str]) -> dict:
    blocks = [{"text": text, "bboxMilliPoints": [1000 + i * 1000, 1000, 9000 + i * 1000, 3000]}
              for i, text in enumerate(texts)]
    return {"pageNumber": number, "widthMilliPoints": 2000000, "heightMilliPoints": 1500000,
            "blocks": blocks, "quality": qualify_page_text(texts)}


def artifact(source_id: str, sha: str, pages: list[dict]) -> dict:
    return {"schemaVersion": "document-text-v2", "sourceFileId": source_id, "inputSha256": sha,
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS", "pageCount": len(pages),
            "textPageCount": sum(bool(p["blocks"]) for p in pages),
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {
                "textLayerCandidatePageCount": sum(p["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE" for p in pages),
                "ocrRequiredPageCount": sum(p["quality"]["disposition"] == "OCR_REQUIRED" for p in pages),
            }, "pages": pages}


class FreeHeatingSuspicionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bundle = {
            "objectId": "OBJ-1", "selectedManifestHash": "f" * 64,
            "selectedFileIds": ["F-PD", "F-MIXED"],
            "sources": [
                {"sourceFileId": "F-PD", "sha256": "a" * 64, "objectId": "OBJ-1",
                 "stages": ["PD"], "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
                 "linkGroupId": None},
                {"sourceFileId": "F-MIXED", "sha256": "b" * 64, "objectId": "OBJ-1",
                 "stages": ["RD", "ID"], "revisionStatus": "UNKNOWN", "approvalStatus": "UNKNOWN",
                 "linkGroupId": None},
            ],
            "textArtifacts": [
                artifact("F-PD", "a" * 64, [page(1, ["Регулятор для системы «теплый пол» Multibox C/RTL",
                                                      "267, 270 Раздевальная", "277 ПУИ"])]),
                artifact("F-MIXED", "b" * 64, [page(1, ["267 Раздевальная", "270 Санузел"])]),
            ],
        }

    def test_sheet_level_suspicion_has_provenance_and_no_room_or_finding(self) -> None:
        result = analyze_free_heating_suspicion(self.bundle)
        self.assertEqual(result["status"], "SUSPICION")
        self.assertEqual(result["matrixScope"], "FREE")
        self.assertEqual(result["parameterCode"], "FREE-HEATING-001")
        self.assertEqual(result["selectedManifestHash"], "f" * 64)
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(len(result["suspicions"]), 1)
        suspicion = result["suspicions"][0]
        self.assertEqual(suspicion["pdReferences"][0]["sourceFileId"], "F-PD")
        self.assertEqual(suspicion["pdReferences"][0]["inputSha256"], "a" * 64)
        self.assertEqual(suspicion["rdCandidateSources"][0]["sourceFileId"], "F-MIXED")
        self.assertEqual(suspicion["rdCandidateSources"][0]["stageStatus"], "MIXED_RD_ID_UNRESOLVED")
        self.assertEqual(suspicion["rdCandidateSources"][0]["textSearchState"],
                         "NO_MATCH_IN_EXTRACTED_TEXT_ONLY")
        self.assertEqual(suspicion["comparisonStatus"], "NOT_COMPARABLE")
        self.assertNotIn("roomId", str(result))
        self.assertNotIn("267", str(suspicion["pdReferences"][0]))
        self.assertNotIn("finding", suspicion)

    def test_rd_text_match_suppresses_this_specific_discovery_without_negative_verdict(self) -> None:
        self.bundle["textArtifacts"][1] = artifact("F-MIXED", "b" * 64, [
            page(1, ["Узел регулирования системы теплый пол"]),
        ])
        result = analyze_free_heating_suspicion(self.bundle)
        self.assertEqual(result["status"], "NO_DISCOVERY")
        self.assertEqual(result["suspicions"], [])
        self.assertEqual(result["findingCount"], 0)

    def test_multiple_pd_references_are_one_document_pair_suspicion(self) -> None:
        self.bundle["textArtifacts"][0] = artifact("F-PD", "a" * 64, [
            page(1, ["Для помещений предусмотрены теплые полы; регуляторы Multibox"]),
            page(2, ["Регулятор для системы теплый пол"]),
        ])
        result = analyze_free_heating_suspicion(self.bundle)
        self.assertEqual(len(result["suspicions"]), 1)
        self.assertEqual([item["sourcePage"] for item in result["suspicions"][0]["pdReferences"]], [1, 2])

    def test_text_gap_is_explicit_and_does_not_claim_absence(self) -> None:
        self.bundle["textArtifacts"][1] = artifact("F-MIXED", "b" * 64, [page(1, [])])
        result = analyze_free_heating_suspicion(self.bundle)
        self.assertEqual(result["status"], "SUSPICION")
        rd = result["suspicions"][0]["rdCandidateSources"][0]
        self.assertEqual(rd["ocrRequiredPageCount"], 1)
        self.assertEqual(rd["textSearchState"], "NO_MATCH_IN_EXTRACTED_TEXT_ONLY")
        self.assertIn("VISUAL_OR_OCR_RD_REVIEW", result["suspicions"][0]["verificationConditions"])

    def test_tampered_artifact_or_object_is_rejected(self) -> None:
        self.bundle["textArtifacts"][1]["inputSha256"] = "c" * 64
        with self.assertRaisesRegex(ValueError, "provenance"):
            analyze_free_heating_suspicion(self.bundle)
        self.bundle["textArtifacts"][1]["inputSha256"] = "b" * 64
        self.bundle["sources"][1]["objectId"] = "OBJ-2"
        with self.assertRaisesRegex(ValueError, "object"):
            analyze_free_heating_suspicion(self.bundle)

    def test_missing_rd_source_is_no_discovery(self) -> None:
        self.bundle["selectedFileIds"] = ["F-PD"]
        self.bundle["sources"] = self.bundle["sources"][:1]
        self.bundle["textArtifacts"] = self.bundle["textArtifacts"][:1]
        result = analyze_free_heating_suspicion(self.bundle)
        self.assertEqual(result["status"], "NO_DISCOVERY")
        self.assertEqual(result["reasonCode"], "NO_RD_CANDIDATE_SOURCE")


if __name__ == "__main__":
    unittest.main()
