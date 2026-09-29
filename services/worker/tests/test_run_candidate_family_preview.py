from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import patch

from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.presence_family_candidates import load_presence_family_labels
from inspector_worker.run_candidate_family_preview import (
    evaluate_run_candidate_family_preview,
    execute_durable_candidate_family_preview,
)
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBJECT-RUN-PREVIEW"
MANIFEST = "a" * 64


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str, section: str, *, stage: str = "PD") -> dict:
    return {
        "sourceFileId": source_id, "sha256": hashlib.sha256(source_id.encode()).hexdigest(),
        "objectId": OBJECT, "stages": [stage], "sectionCode": section,
        "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "pageStages": {},
    }


def artifact(src: dict, texts: list[str | list[str]]) -> dict:
    pages = []
    for page_number, text in enumerate(texts, 1):
        parts = [text] if isinstance(text, str) else text
        blocks = [{"text": part, "bboxMilliPoints": [1000, 1000, 300000, 3000]}
                  for part in parts]
        pages.append({
            "pageNumber": page_number, "widthMilliPoints": 600000,
            "heightMilliPoints": 800000, "blocks": blocks,
            "quality": qualify_page_text(parts),
        })
    candidate_count = sum(page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                          for page in pages)
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
        "inputSha256": src["sha256"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages),
        "textPageCount": sum(bool(page["blocks"]) for page in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {
            "textLayerCandidatePageCount": candidate_count,
            "ocrRequiredPageCount": len(pages) - candidate_count,
        },
        "pages": pages,
    }


def candidate_line(code: str) -> str:
    numeric = {item["parameterCode"]: item for item in load_numeric_family_labels()["entries"]}
    classes = {item["parameterCode"]: item for item in load_class_family_labels()["entries"]}
    presence = {item["parameterCode"]: item for item in load_presence_family_labels()["entries"]}
    if code in numeric:
        attr = numeric[code]["attributes"][0]
        return f'{attr["labels"][0]}: 42 {attr["unitAliases"][0]}'
    if code in classes:
        entry = classes[code]
        return f'{entry["labels"][0]}: {entry["values"][0]}'
    entry = presence[code]
    feature = entry["features"][0]
    scopes = [group["labels"][0] + (" 1" if group["requireId"] else "")
              for group in entry["scopeGroups"]]
    return " ".join([feature["labels"][0], *scopes])


class RunCandidateFamilyPreviewTests(unittest.TestCase):
    def test_every_pinned_code_has_abstaining_exact_lead_and_valid_provenance(self) -> None:
        pack = load_candidate_family_pack()
        sources, artifacts = [], []
        for rule in pack["rules"]:
            code = rule["parameterCode"]
            src = source(code, rule["requiredExpectedDrawingSections"][0])
            sources.append(src)
            artifacts.append(artifact(src, [candidate_line(code)]))
        result = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
        self.assertEqual(result["outputCount"], 47)
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertEqual(result["scope"], "RUN_COMMITTED_SOURCES")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual(result["contentHash"], digest({key: value for key, value
                                                         in result.items() if key != "contentHash"}))
        self.assertEqual([row["parameterCode"] for row in result["codeRows"]],
                         sorted(rule["parameterCode"] for rule in pack["rules"]))
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in result["codeRows"]))
        self.assertTrue(all(row["leadCount"] >= 1 for row in result["codeRows"]),
                        [(row["parameterCode"], row["reasonCodes"]) for row in result["codeRows"]
                         if row["leadCount"] == 0])
        src_index = {src["sourceFileId"]: src for src in sources}
        art_index = {art["sourceFileId"]: art for art in artifacts}
        for row in result["codeRows"]:
            self.assertIn("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED", row["reasonCodes"])
            for lead in row["candidateLeads"]:
                src = src_index[lead["sourceFileId"]]
                art = art_index[lead["sourceFileId"]]
                self.assertEqual(lead["sourceSha256"], src["sha256"])
                self.assertEqual(lead["artifactSha256"], digest(art))
                loc = lead["locator"]
                block = art["pages"][lead["pageNumber"] - 1]["blocks"][loc["blockIndex"]]
                self.assertEqual(block["text"][loc["start"]:loc["end"]], lead["rawValue"])
                self.assertEqual(lead["blockTextSha256"], hashlib.sha256(
                    block["text"].encode()).hexdigest())
                self.assertEqual(lead["leadSha256"], digest({key: value for key, value
                                                              in lead.items() if key != "leadSha256"}))
        reversed_result = evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, sources[::-1], artifacts[::-1])
        self.assertEqual(reversed_result, result)

    def test_invalid_provenance_and_source_metadata_fail_closed(self) -> None:
        src = source("PD-1", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²"])
        altered = copy.deepcopy(art)
        altered["inputSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [altered])
        with self.assertRaisesRegex(ValueError, "duplicate source"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src, src], [art])
        with self.assertRaisesRegex(ValueError, "unknown or duplicate artifact"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [art, art])
        wrong = {**src, "objectId": "OTHER"}
        with self.assertRaisesRegex(ValueError, "identity or stage invalid"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [wrong], [art])
        wrong = {**src, "sectionCode": "PZ;DROP"}
        with self.assertRaisesRegex(ValueError, "sectionCode invalid"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [wrong], [art])

    def test_unreviewed_gates_mixed_stage_and_split_blocks_abstain(self) -> None:
        src = source("PD-2", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²"])
        unknown = {**src, "approvalStatus": "UNKNOWN"}
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [unknown], [art])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("SOURCE_APPROVAL_UNRESOLVED", row["reasonCodes"])
        self.assertNotIn("NO_EXACT_LABEL_LEAD", row["reasonCodes"])
        wrong_section = {**src, "sectionCode": None}
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [wrong_section], [art])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertIn("DRAWING_SECTION_UNRESOLVED", row["reasonCodes"])
        mixed = {**src, "stages": ["PD", "RD"], "pageStages": {"1": "UNRESOLVED"}}
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [mixed], [art])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertIn("SOURCE_PAGE_STAGE_UNRESOLVED", row["reasonCodes"])
        partial = {**src, "stages": ["PD", "RD"],
                   "pageStages": {"1": "PD", "2": "UNRESOLVED"}}
        partial_artifact = artifact(partial, ["Общая площадь здания: 42 м²",
                                              "Общая площадь здания: 99 м²"])
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [partial], [partial_artifact])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertIn("SOURCE_PAGE_STAGE_UNRESOLVED", row["reasonCodes"])
        self.assertEqual(row["eligibleSourceCount"], 1)
        self.assertEqual(row["textScannedPageCount"], 1)
        self.assertEqual(row["leadCount"], 1)
        self.assertEqual(row["candidateLeads"][0]["pageNumber"], 1)
        split = artifact(src, [["Общая площадь здания:", "42 м²"]])
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [src], [split])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("NO_EXACT_LABEL_LEAD", row["reasonCodes"])

    def test_ocr_and_lead_limit_are_explicit_no_absence_claim(self) -> None:
        src = source("PD-3", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²"] * 18 + [""])
        result = evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [src], [art], max_leads_per_code=16)
        row = next(row for row in result["codeRows"] if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["leadCount"], 16)
        self.assertIn("LEAD_LIMIT_REACHED", row["reasonCodes"])
        self.assertIn("OCR_REQUIRED_IN_SCOPE", row["reasonCodes"])
        self.assertEqual(row["ocrRequiredPageCount"], 1)
        self.assertEqual(row["status"], "ABSTAIN")
        self.assertNotIn("findings", result)
        with self.assertRaisesRegex(ValueError, "max_leads_per_code"):
            evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [art],
                                                  max_leads_per_code=17)

    def test_saturated_preview_trims_deterministically_below_api_byte_limit(self) -> None:
        sources, artifacts = [], []
        for rule in load_candidate_family_pack()["rules"]:
            code = rule["parameterCode"]
            src = source(code, rule["requiredExpectedDrawingSections"][0])
            line = candidate_line(code).ljust(480)
            sources.append(src)
            artifacts.append(artifact(src, [line] * 16))
        first = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
        second = evaluate_run_candidate_family_preview(OBJECT, MANIFEST,
                                                        sources[::-1], artifacts[::-1])
        self.assertEqual(first, second)
        self.assertLessEqual(len(json.dumps(first, ensure_ascii=False, sort_keys=True,
                                             separators=(",", ":")).encode()), 1024 * 1024)
        self.assertLess(sum(row["leadCount"] for row in first["codeRows"]), 47 * 16)
        self.assertTrue(any("PREVIEW_BYTE_BUDGET_REACHED" in row["reasonCodes"]
                            for row in first["codeRows"]))
        self.assertTrue(all(row["status"] == "ABSTAIN" for row in first["codeRows"]))
        self.assertIsNone(first["findingCount"])

    def test_duplicate_label_on_one_page_is_ambiguous(self) -> None:
        src = source("PD-4", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²\nОбщая площадь здания: 43 м²"])
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [src], [art])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["candidateLeads"], [])
        self.assertIn("AMBIGUOUS_PAGE_LABEL", row["reasonCodes"])

    def test_second_class_alias_keeps_actual_label_and_source_value_span(self) -> None:
        src = source("CLASS-ALIAS", "AR", stage="RD")
        alias = "Энергетический класс здания"
        line = f"{alias}: B"
        art = artifact(src, [line])
        policy = copy.deepcopy(load_class_family_labels())
        entry = next(item for item in policy["entries"]
                     if item["parameterCode"] == "PZ-021")
        entry["labels"].append(alias)
        with patch("inspector_worker.run_candidate_family_preview.load_class_family_labels",
                   return_value=policy):
            output = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [art])
        row = next(row for row in output["codeRows"] if row["parameterCode"] == "PZ-021")
        self.assertEqual(row["leadCount"], 1)
        lead = row["candidateLeads"][0]
        self.assertEqual(lead["matchedLabel"], alias)
        self.assertEqual(lead["rawValue"], "B")
        locator = lead["locator"]
        self.assertEqual(art["pages"][0]["blocks"][0]["text"][locator["start"]:locator["end"]],
                         "B")
        self.assertEqual(lead["leadSha256"], digest({key: value for key, value
                                                      in lead.items() if key != "leadSha256"}))

    def test_reviewed_rd_page_stage_can_produce_only_review_lead(self) -> None:
        src = source("MIXED-1", "AR")
        src["stages"] = ["PD", "RD"]
        src["pageStages"] = {"1": "PD", "2": "RD"}
        art = artifact(src, ["Общая площадь здания: 41 м²",
                             "Общая площадь здания: 42 м²"])
        row = next(row for row in evaluate_run_candidate_family_preview(
            OBJECT, MANIFEST, [src], [art])["codeRows"]
                   if row["parameterCode"] == "PZ-002")
        self.assertEqual(row["status"], "ABSTAIN")
        self.assertEqual(row["leadCount"], 1)
        self.assertEqual(row["candidateLeads"][0]["stage"], "RD")
        self.assertEqual(row["candidateLeads"][0]["pageNumber"], 2)
        self.assertEqual(row["candidateLeads"][0]["rawValue"], "42")

    @patch("inspector_worker.run_candidate_family_preview.download_text_artifact")
    def test_durable_wrapper_requires_reviewed_section(self, download) -> None:
        src = source("PD-5", "PZ")
        raw = {**src, "mediaType": "application/pdf"}
        download.return_value = artifact(src, ["Общая площадь здания: 42 м²"])
        decision = {"sourceSha256": src["sha256"], "sectionCode": "PZ",
                    "revisionStatus": "CURRENT", "approvalStatus": "APPROVED",
                    "basis": {"reference": "reviewed-source-1"}}
        lease = {"objectId": OBJECT, "inputManifestHash": MANIFEST,
                 "inputs": {"sourceFiles": [raw], "sourceDecisions": {"PD-5": decision}}}
        output = execute_durable_candidate_family_preview(lease, {"attemptId": "A"})
        self.assertEqual(output["outputCount"], 47)
        self.assertEqual(download.call_count, 1)
        lease["inputs"]["sourceDecisions"]["PD-5"]["sectionCode"] = "AR"
        with self.assertRaisesRegex(ValueError, "sectionCode differs"):
            execute_durable_candidate_family_preview(lease, {"attemptId": "A"})
        lease["inputs"]["sourceDecisions"]["PD-5"]["sectionCode"] = "PZ"
        lease["inputs"]["sourceDecisions"]["PD-5"]["basis"] = {}
        with self.assertRaisesRegex(ValueError, "section requires a reference"):
            execute_durable_candidate_family_preview(lease, {"attemptId": "A"})


if __name__ == "__main__":
    unittest.main()
