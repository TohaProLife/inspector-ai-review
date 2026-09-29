from __future__ import annotations

import copy
import hashlib
import json
import unittest

from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.numeric_family_candidates import NUMERIC_FAMILIES, load_numeric_family_labels
from inspector_worker.presence_family_candidates import load_presence_family_labels
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


OBJECT = "OBSERVATION-TEST-OBJECT"
MANIFEST = "b" * 64


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def source(source_id: str, section: str, stage: str = "PD") -> dict:
    return {
        "sourceFileId": source_id, "sha256": hashlib.sha256(source_id.encode()).hexdigest(),
        "objectId": OBJECT, "stages": [stage], "sectionCode": section,
        "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "pageStages": {},
    }


def artifact(src: dict, texts: list[str]) -> dict:
    pages = []
    for number, text in enumerate(texts, 1):
        blocks = [{"text": text, "bboxMilliPoints": [1000, 1000, 300000, 3000]}] if text else []
        pages.append({"pageNumber": number, "widthMilliPoints": 600000,
                      "heightMilliPoints": 800000, "blocks": blocks,
                      "quality": qualify_page_text([block["text"] for block in blocks])})
    text_candidates = sum(page["quality"]["disposition"] == "TEXT_LAYER_CANDIDATE"
                          for page in pages)
    return {
        "schemaVersion": "document-text-v2", "sourceFileId": src["sourceFileId"],
        "inputSha256": src["sha256"],
        "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": len(pages), "textPageCount": sum(bool(page["blocks"]) for page in pages),
        "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {"textLayerCandidatePageCount": text_candidates,
                           "ocrRequiredPageCount": len(pages) - text_candidates},
        "pages": pages,
    }


def candidate_line(code: str) -> str:
    numeric = {item["parameterCode"]: item for item in load_numeric_family_labels()["entries"]}
    classes = {item["parameterCode"]: item for item in load_class_family_labels()["entries"]}
    presence = {item["parameterCode"]: item for item in load_presence_family_labels()["entries"]}
    if code in numeric:
        entry = numeric[code]["attributes"][0]
        return f'{entry["labels"][0]}: 42 {entry["unitAliases"][0]}'
    if code in classes:
        entry = classes[code]
        return f'{entry["labels"][0]}: {entry["values"][0]}'
    entry = presence[code]
    scopes = [group["labels"][0] + (" 1" if group["requireId"] else "")
              for group in entry["scopeGroups"]]
    return " ".join([entry["features"][0]["labels"][0], *scopes])


def all_code_inputs() -> tuple[list[dict], list[dict]]:
    sources, artifacts = [], []
    for rule in load_candidate_family_pack()["rules"]:
        code = rule["parameterCode"]
        src = source(code, rule["requiredExpectedDrawingSections"][0])
        sources.append(src)
        artifacts.append(artifact(src, [candidate_line(code)]))
    return sources, artifacts


def rehash_preview(preview: dict) -> None:
    preview["contentHash"] = digest({key: value for key, value in preview.items()
                                     if key != "contentHash"})


def rehash_lead(preview: dict, code: str) -> dict:
    row = next(row for row in preview["codeRows"] if row["parameterCode"] == code)
    lead = row["candidateLeads"][0]
    lead["leadSha256"] = digest({key: value for key, value in lead.items()
                                 if key != "leadSha256"})
    rehash_preview(preview)
    return lead


class CandidateFamilyObservationTests(unittest.TestCase):
    def test_all_47_codes_preserve_exact_evidence_without_coverage(self) -> None:
        sources, artifacts = all_code_inputs()
        preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
        result = extract_candidate_family_observations(preview, sources, artifacts)
        self.assertEqual(result["outputCount"], 47)
        self.assertEqual(len(result["codeRows"]), 47)
        self.assertEqual(result["purpose"], "REVIEW_ONLY")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])
        self.assertEqual(result["contentHash"], digest({key: value for key, value
                                                         in result.items() if key != "contentHash"}))
        self.assertEqual({item["parameterCode"] for item in result["observations"]},
                         {rule["parameterCode"] for rule in load_candidate_family_pack()["rules"]})
        self.assertEqual(sum(item["typedFact"] is not None for item in result["observations"]), 39)
        self.assertEqual(extract_candidate_family_observations(preview, sources[::-1],
                                                                 artifacts[::-1]), result)
        by_source = {row["sourceFileId"]: row for row in sources}
        by_artifact = {row["sourceFileId"]: row for row in artifacts}
        for item in result["observations"]:
            self.assertEqual(item["status"], "REVIEW_ONLY")
            self.assertEqual(item["observationId"], digest({key: value for key, value
                                                              in item.items() if key != "observationId"}))
            src, art = by_source[item["sourceFileId"]], by_artifact[item["sourceFileId"]]
            self.assertEqual(item["sourceSha256"], src["sha256"])
            self.assertEqual(item["artifactSha256"], digest(art))
            loc = item["locator"]
            block = art["pages"][item["pageNumber"] - 1]["blocks"][loc["blockIndex"]]
            self.assertEqual(block["text"][loc["start"]:loc["end"]], item["rawValue"])
            fact = item["typedFact"]
            if item["family"] in NUMERIC_FAMILIES | {"CLASS_DECREASE"}:
                self.assertIsNotNone(fact)
                self.assertEqual(fact["schemaVersion"], "typed-fact-v1")
                self.assertEqual(fact["factId"], make_fact_id(fact))
                self.assertEqual(fact["rawText"], block["text"])
                self.assertEqual(fact["locator"]["kind"], "TEXT_BLOCK")
                self.assertEqual(fact["rawUnit"], item["canonicalUnit"]
                                 if item["family"] == "CLASS_DECREASE" else item["rawUnit"])
            else:
                self.assertIsNone(fact)

    def test_forged_preview_and_lead_hashes_fail_even_when_rehashed(self) -> None:
        sources, artifacts = all_code_inputs()
        original = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
        forged = copy.deepcopy(original)
        forged["candidateRulePackSha256"] = "0" * 64
        rehash_preview(forged)
        with self.assertRaisesRegex(ValueError, "policy or content hash"):
            extract_candidate_family_observations(forged, sources, artifacts)
        forged = copy.deepcopy(original)
        lead = next(row for row in forged["codeRows"] if row["parameterCode"] == "PZ-002")["candidateLeads"][0]
        lead["rawValue"] = "99"
        rehash_lead(forged, "PZ-002")
        with self.assertRaisesRegex(ValueError, "pinned label or value"):
            extract_candidate_family_observations(forged, sources, artifacts)
        forged = copy.deepcopy(original)
        lead = next(row for row in forged["codeRows"] if row["parameterCode"] == "PZ-002")["candidateLeads"][0]
        lead["rawUnit"] = "кВт"
        rehash_lead(forged, "PZ-002")
        with self.assertRaisesRegex(ValueError, "pinned label or value"):
            extract_candidate_family_observations(forged, sources, artifacts)
        forged = copy.deepcopy(original)
        forged["codeRows"] = forged["codeRows"][:-1]
        forged["outputCount"] = 46
        rehash_preview(forged)
        with self.assertRaisesRegex(ValueError, "all 47"):
            extract_candidate_family_observations(forged, sources, artifacts)

    def test_duplicate_lead_and_changed_artifact_or_source_fail(self) -> None:
        sources, artifacts = all_code_inputs()
        original = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
        forged = copy.deepcopy(original)
        row = next(row for row in forged["codeRows"] if row["parameterCode"] == "PZ-002")
        row["candidateLeads"].append(copy.deepcopy(row["candidateLeads"][0]))
        row["leadCount"] = 2
        rehash_preview(forged)
        with self.assertRaisesRegex(ValueError, "duplicate lead"):
            extract_candidate_family_observations(forged, sources, artifacts)
        changed = copy.deepcopy(artifacts)
        target = next(item for item in changed if item["sourceFileId"] == "PZ-002")
        target["pages"][0]["blocks"][0]["text"] = "Общая площадь здания: 43 м²"
        target["pages"][0]["quality"] = qualify_page_text([target["pages"][0]["blocks"][0]["text"]])
        with self.assertRaisesRegex(ValueError, "provenance or review gate"):
            extract_candidate_family_observations(original, sources, changed)
        changed_sources = copy.deepcopy(sources)
        next(item for item in changed_sources if item["sourceFileId"] == "PZ-002")["approvalStatus"] = "UNKNOWN"
        with self.assertRaisesRegex(ValueError, "provenance or review gate"):
            extract_candidate_family_observations(original, changed_sources, artifacts)

    def test_page_ambiguity_and_ocr_required_rejected(self) -> None:
        src = source("PZ-002", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²"])
        original = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [art])
        changed = artifact(src, ["Общая площадь здания: 42 м²\nОбщая площадь здания: 43 м²"])
        forged = copy.deepcopy(original)
        lead = next(row for row in forged["codeRows"] if row["parameterCode"] == "PZ-002")["candidateLeads"][0]
        lead["artifactSha256"] = digest(changed)
        lead["blockTextSha256"] = hashlib.sha256(changed["pages"][0]["blocks"][0]["text"].encode()).hexdigest()
        rehash_lead(forged, "PZ-002")
        with self.assertRaisesRegex(ValueError, "ambiguous page label"):
            extract_candidate_family_observations(forged, [src], [changed])
        ocr = artifact(src, [""])
        forged = copy.deepcopy(original)
        lead = next(row for row in forged["codeRows"] if row["parameterCode"] == "PZ-002")["candidateLeads"][0]
        lead["artifactSha256"] = digest(ocr)
        rehash_lead(forged, "PZ-002")
        with self.assertRaisesRegex(ValueError, "OCR_REQUIRED"):
            extract_candidate_family_observations(forged, [src], [ocr])

    def test_unknown_mixed_page_stage_cannot_be_promoted(self) -> None:
        src = source("PZ-002", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²", "Другая страница без метки."])
        preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [src], [art])
        mixed = {**src, "stages": ["PD", "RD"],
                 "pageStages": {"1": "UNRESOLVED", "2": "RD"}}
        with self.assertRaisesRegex(ValueError, "lead stage or drawing section"):
            extract_candidate_family_observations(preview, [mixed], [art])
        selected = {**src, "stages": ["PD", "RD"],
                    "pageStages": {"1": "PD", "2": "UNRESOLVED"}}
        result = extract_candidate_family_observations(preview, [selected], [art])
        self.assertEqual(result["outputCount"], 1)
        self.assertEqual(result["observations"][0]["stage"], "PD")

    def test_unscanned_pages_do_not_claim_exact_label_absence(self) -> None:
        src = source("PZ-002", "PZ")
        art = artifact(src, ["Общая площадь здания: 42 м²"])
        unknown = {**src, "revisionStatus": "UNKNOWN"}
        preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, [unknown], [art])
        result = extract_candidate_family_observations(preview, [unknown], [art])
        row = next(item for item in result["codeRows"] if item["parameterCode"] == "PZ-002")
        self.assertEqual(row["observationCount"], 0)
        self.assertIn("SOURCE_REVISION_UNRESOLVED", row["reasonCodes"])
        self.assertNotIn("NO_EXACT_LABEL_LEAD", row["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
