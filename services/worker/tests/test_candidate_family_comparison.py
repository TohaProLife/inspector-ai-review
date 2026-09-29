from __future__ import annotations

import copy
import hashlib
import unittest

from inspector_worker.candidate_family_comparison import (
    _hash, evaluate_candidate_observations,
)
from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.class_family_candidates import load_class_family_labels
from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.numeric_family_candidates import load_numeric_family_labels
from inspector_worker.presence_family_candidates import load_presence_family_labels
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text


PACK = load_candidate_family_pack()
RULES = {item["parameterCode"]: item for item in PACK["rules"]}
MANIFEST_SHA = "c" * 64


def _seal(bundle: dict) -> dict:
    bundle["contentHash"] = _hash({key: value for key, value in bundle.items()
                                    if key != "contentHash"})
    return bundle


def _bundle(observations: list[dict] | None = None) -> dict:
    observations = observations or []
    code_rows = [{
        "parameterCode": rule["parameterCode"], "family": rule["family"],
        "status": "REVIEW_ONLY",
        "observationCount": sum(item["parameterCode"] == rule["parameterCode"]
                                for item in observations), "reasonCodes": [],
    } for rule in sorted(PACK["rules"], key=lambda item: item["parameterCode"])]
    return _seal({
        "schemaVersion": "candidate-family-observations-v1",
        "purpose": "REVIEW_ONLY", "inputManifestHash": MANIFEST_SHA,
        "objectId": "OBJECT-1", "candidateRulePackSha256": PACK["packSha256"],
        "numericLabelPackSha256": load_numeric_family_labels()["labelPackSha256"],
        "classLabelPackSha256": load_class_family_labels()["labelPackSha256"],
        "presenceLabelPackSha256": load_presence_family_labels()["labelPackSha256"],
        "codeRows": code_rows, "observations": observations,
        "outputCount": len(observations), "findingCount": None,
        "parameterCoverage": None,
    })


def _source(rule: dict, stage: str) -> dict:
    side = "Expected" if stage == "PD" else "Actual"
    source_id, digest = ("PD-1", "a" * 64) if stage == "PD" else ("RD-1", "b" * 64)
    drawing = rule[f"required{side}DrawingSections"][0]
    required = rule[f"required{side}Sections"]
    section = required[0] if required else drawing
    source = {
        "sourceFileId": source_id, "sha256": digest,
        "manifestSha256": MANIFEST_SHA, "objectId": "OBJECT-1",
        "stages": [stage], "pageCount": 1, "pageStages": {},
        "section": section, "drawingSection": drawing,
        "revisionStatus": "CURRENT", "approvalStatus": "APPROVED",
        "linkGroupId": "BUILDING-1",
    }
    source["sourceReview"] = {
        "status": "VERIFIED", "reference": "synthetic reviewer decision",
        "sourceFileId": source_id, "sourceSha256": digest,
        "manifestSha256": MANIFEST_SHA, "revisionStatus": "CURRENT",
        "approvalStatus": "APPROVED", "section": section,
        "drawingSection": drawing,
    }
    return source


def _observation(rule: dict, source: dict, attribute: dict,
                 value: str, *, typed: bool = True) -> dict:
    raw_unit = attribute["canonicalUnit"]
    raw_text = f'{attribute["key"]}: {value} {raw_unit}'
    start = raw_text.index(value)
    locator = {"kind": "TEXT_BLOCK", "blockIndex": 0, "start": start,
               "end": start + len(value), "bboxMilliPoints": [1, 2, 100, 20]}
    line_locator = {**locator, "kind": "DOCUMENT_TEXT_BLOCK_LINE", "lineIndex": 0}
    fact = {
        "schemaVersion": "typed-fact-v1", "parameterCode": rule["parameterCode"],
        "objectId": "OBJECT-1", "inputManifestHash": MANIFEST_SHA,
        "attribute": attribute["key"],
        "stage": source["stages"][0], "sourceFileId": source["sourceFileId"],
        "sourceSha256": source["sha256"], "pageNumber": 1,
        "rawText": raw_text, "rawValue": value, "rawUnit": raw_unit,
        "canonicalUnit": raw_unit, "locator": locator,
        "artifactSha256": "d" * 64, "leadSha256": "e" * 64,
    }
    if rule["parameterCode"].startswith("KR-"):
        fact.update(elementType="FOUNDATION", zone="A", floor="1", scope="BLOCK-1")
    elif rule["parameterCode"] == "SPZU-024":
        fact["scope"] = "BLOCK-1"
    fact["factId"] = make_fact_id(fact)
    observation = {
        "schemaVersion": "candidate-family-observation-v1", "status": "REVIEW_ONLY",
        "parameterCode": rule["parameterCode"], "family": rule["family"],
        "attribute": attribute["key"], "canonicalUnit": raw_unit,
        "objectId": "OBJECT-1", "inputManifestHash": MANIFEST_SHA,
        "stage": source["stages"][0],
        "sourceFileId": source["sourceFileId"], "sourceSha256": source["sha256"],
        "artifactSha256": "d" * 64, "pageNumber": 1,
        "sectionCode": source["section"], "revisionStatus": "CURRENT",
        "approvalStatus": "APPROVED", "lineText": raw_text,
        "blockTextSha256": hashlib.sha256(raw_text.encode()).hexdigest(),
        "rawValue": value, "rawUnit": raw_unit, "locator": line_locator,
        "leadSha256": "e" * 64, "typedFact": fact if typed else None,
        "candidateRulePackSha256": PACK["packSha256"],
        "numericLabelPackSha256": load_numeric_family_labels()["labelPackSha256"],
        "classLabelPackSha256": load_class_family_labels()["labelPackSha256"],
        "presenceLabelPackSha256": load_presence_family_labels()["labelPackSha256"],
    }
    observation["observationId"] = _hash(observation)
    return observation


def _link(expected: dict, actual: dict) -> dict:
    left, right = expected["typedFact"], actual["typedFact"]
    return {
        "schemaVersion": "fact-entity-link-v1", "pdFactId": left["factId"],
        "actualFactId": right["factId"], "objectId": "OBJECT-1",
        "linkGroupId": "BUILDING-1", "basis": {"reference": "synthetic reviewed link"},
        "evidence": [{key: fact[key] for key in
                      ("factId", "sourceFileId", "sourceSha256", "pageNumber", "locator")}
                     for fact in (left, right)],
    }


def _fixture(code: str, *, actual: str = "101") -> tuple:
    rule = RULES[code]
    sources = [_source(rule, "PD"), _source(rule, "RD")]
    observations, links = [], []
    for attribute in rule["attributes"]:
        typed = rule["family"] not in {"CLASS_DECREASE", "PRESENCE_SET"}
        left = _observation(rule, sources[0], attribute, "100", typed=typed)
        right = _observation(rule, sources[1], attribute, actual, typed=typed)
        observations.extend((left, right))
        if typed:
            links.append(_link(left, right))
    context = {gate: {"status": "VERIFIED", "reference": "synthetic review"}
               for gate in rule["requiredContext"]
               if not gate.endswith("_MANIFEST_SECTION_UNRESOLVED")}
    resolutions = {}
    for side, source in zip(("expected", "actual"), sources, strict=True):
        if (rule["manifestSectionStatus"][side] == "UNKNOWN_ABSTAIN"
                or source["drawingSection"] != source["section"]):
            resolutions[side] = {
                "status": "VERIFIED", "reference": "synthetic section review",
                "sourceFileId": source["sourceFileId"],
                "sourceSha256": source["sha256"],
                "manifestSha256": MANIFEST_SHA,
                "stage": source["stages"][0], "manifestSection": source["section"],
                "drawingSection": source["drawingSection"],
            }
    relative, norms = {}, {}
    for attribute in rule["attributes"]:
        key = attribute["key"]
        left, right = (item["typedFact"] for item in observations
                       if item["attribute"] == key)
        relative[key] = {
            "status": "VERIFIED", "reference": "synthetic denominator",
            "denominator": "EXPECTED", "parameterCode": code,
            "objectId": "OBJECT-1", "attribute": key,
            "expectedFactId": left["factId"], "actualFactId": right["factId"],
            "manifestSha256": MANIFEST_SHA,
        } if left and right else None
        threshold = rule["comparison"]["threshold"]
        norms[key] = {
            "status": "VERIFIED", "reference": "synthetic applicable norm",
            "applicable": True, "parameterCode": code, "objectId": "OBJECT-1",
            "attribute": key, "canonicalUnit": attribute["canonicalUnit"],
            "expectedFactId": left["factId"], "actualFactId": right["factId"],
            "manifestSha256": MANIFEST_SHA,
            "threshold": threshold["value"],
        } if left and right and threshold else None
    options = {"context_evidence": context, "section_resolutions": resolutions,
               "relative_basis": relative, "norm_basis": norms}
    return rule, _bundle(observations), sources, links, options


def _run(case: tuple, **overrides: object) -> dict:
    rule, bundle, sources, links, options = case
    return evaluate_candidate_observations(rule, bundle, sources, links,
                                           **{**options, **overrides})


def _reviewed_presence_case(code: str = "SPZU-039") -> tuple:
    rule, _, sources, _, options = _fixture(code)
    attribute = rule["attributes"][0]
    observations = [_observation(rule, source, attribute, value, typed=False)
                    for source, value in zip(sources, ("лотки", "дренаж"), strict=True)]
    reviewed: dict[str, dict] = {}
    facts = []
    for observation in observations:
        locator = {key: value for key, value in observation["locator"].items()
                   if key != "lineIndex"}
        locator["kind"] = "TEXT_BLOCK"
        fact = {
            "schemaVersion": "typed-fact-v1", "parameterCode": code,
            "objectId": observation["objectId"], "inputManifestHash": MANIFEST_SHA,
            "attribute": observation["attribute"], "stage": observation["stage"],
            "sourceFileId": observation["sourceFileId"],
            "sourceSha256": observation["sourceSha256"],
            "artifactSha256": observation["artifactSha256"],
            "leadSha256": observation["leadSha256"],
            "pageNumber": observation["pageNumber"],
            "rawText": observation["lineText"], "rawValue": observation["rawValue"],
            "rawUnit": "set", "canonicalUnit": "set", "locator": locator,
        }
        fact["factId"] = make_fact_id(fact)
        review = {
            "status": "VERIFIED", "reference": "synthetic enumeration review",
            "observationId": observation["observationId"], "factId": fact["factId"],
            "inputManifestHash": MANIFEST_SHA, "parameterCode": code,
            "attribute": observation["attribute"], "objectId": observation["objectId"],
            "sourceFileId": observation["sourceFileId"],
            "sourceSha256": observation["sourceSha256"],
            "artifactSha256": observation["artifactSha256"],
            "pageNumber": observation["pageNumber"], "locator": locator,
        }
        reviewed[observation["observationId"]] = {"fact": fact, "review": review}
        facts.append(fact)
    links = [{
        "schemaVersion": "fact-entity-link-v1", "pdFactId": facts[0]["factId"],
        "actualFactId": facts[1]["factId"], "objectId": "OBJECT-1",
        "linkGroupId": "BUILDING-1", "basis": {"reference": "synthetic same-scope link"},
        "evidence": [{key: fact[key] for key in
                      ("factId", "sourceFileId", "sourceSha256", "pageNumber", "locator")}
                     for fact in facts],
    }]
    set_scope = {attribute["key"]: {
        "status": "VERIFIED", "reference": "synthetic complete survey",
        "parameterCode": code, "manifestSha256": MANIFEST_SHA,
        "completeExpected": True, "completeActual": True, "sameSearchScope": True,
        "expectedFactId": facts[0]["factId"], "actualFactId": facts[1]["factId"],
        "expectedMembers": ["лотки"], "actualMembers": ["дренаж"],
    }}
    return (rule, _bundle(observations), sources, links,
            {**options, "reviewed_sets": reviewed, "set_scope": set_scope})


class CandidateFamilyComparisonTests(unittest.TestCase):
    def test_all_47_catalog_rules_are_review_only(self) -> None:
        self.assertEqual(len(RULES), 47)
        self.assertEqual(len({rule["family"] for rule in RULES.values()}), 9)
        for rule in PACK["rules"]:
            with self.subTest(code=rule["parameterCode"]):
                result = evaluate_candidate_observations(
                    rule, _bundle(), [], [], context_evidence={})
                self.assertEqual(result["status"], "ABSTAIN")
                self.assertEqual(result["reasonCodes"], ["REQUIRED_OBSERVATION_MISSING"])
                self.assertEqual(result["disposition"], "REVIEW_ONLY")
                self.assertFalse({"findings", "coverage", "negativeVerified"} & result.keys())

    def test_47_code_synthetic_pair_gate(self) -> None:
        for rule in PACK["rules"]:
            with self.subTest(code=rule["parameterCode"]):
                case = _fixture(rule["parameterCode"])
                result = _run(case)
                self.assertEqual(result["disposition"], "REVIEW_ONLY")
                self.assertFalse({"findings", "coverage"} & result.keys())
                if rule["family"] in {"CLASS_DECREASE", "PRESENCE_SET"}:
                    self.assertEqual(result["reasonCodes"], ["TYPED_OBSERVATION_UNAVAILABLE"])
                elif rule["parameterCode"] == "POS-086":
                    self.assertEqual(result["reasonCodes"], ["RULE_COMPARISON_UNRESOLVED"])
                else:
                    self.assertEqual(result["status"], "REVIEW_REQUIRED")

    def test_strict_numeric_boundary_and_review_gates(self) -> None:
        below = _fixture("AR-040", actual="1.19")
        # PD/RD values are both below normal, so the observed RD value alone
        # decides the lower-bound trigger after reviewed applicability.
        self.assertTrue(_run(below)["comparison"]["triggered"])
        at = _fixture("AR-040", actual="1.2")
        self.assertFalse(_run(at)["comparison"]["triggered"])
        case = _fixture("AR-040", actual="1.19")
        case[2][1]["approvalStatus"] = "UNAPPROVED"
        self.assertEqual(_run(case)["reasonCodes"], ["SOURCE_REVIEW_INVALID"])

    def test_missing_link_context_and_norm_abstain(self) -> None:
        case = _fixture("AR-040", actual="1.19")
        self.assertEqual(_run((case[0], case[1], case[2], [], case[4]))["reasonCodes"],
                         ["ENTITY_LINK_MISSING"])
        case = _fixture("AR-040", actual="1.19")
        case[4]["context_evidence"].pop("FLOOR_IDENTITY")
        self.assertEqual(_run(case)["reasonCodes"], ["CONTEXT_NOT_VERIFIED"])
        case = _fixture("AR-040", actual="1.19")
        case[4]["norm_basis"] = {}
        self.assertEqual(_run(case)["reasonCodes"], ["NORM_APPLICABILITY_UNVERIFIED"])

    def test_public_index_metadata_does_not_equal_reviewed_source(self) -> None:
        # Public index records source/stage/section, but has no authenticated
        # CURRENT/APPROVED reviewer decision or reviewed same-entity pair.
        case = _fixture("AR-040", actual="1.19")
        for missing in ("sourceReview", "drawingSection", "manifestSha256"):
            with self.subTest(missing=missing):
                changed = copy.deepcopy(case)
                changed[2][0].pop(missing)
                self.assertEqual(_run(changed)["reasonCodes"], ["SOURCE_REVIEW_INVALID"])
        case = _fixture("AR-040", actual="1.19")
        case[2][0]["revisionStatus"] = "UNKNOWN"
        self.assertEqual(_run(case)["reasonCodes"], ["SOURCE_REVIEW_INVALID"])

    def test_actual_extractor_contract_stays_review_only(self) -> None:
        entry = next(item for item in load_numeric_family_labels()["entries"]
                     if item["parameterCode"] == "AR-040")["attributes"][0]
        line = f'{entry["labels"][0]}: 1.19 {entry["unitAliases"][0]}'
        source = {"sourceFileId": "PD-1", "sha256": "a" * 64,
                  "objectId": "OBJECT-1", "stages": ["PD"],
                  "sectionCode": "AR", "revisionStatus": "CURRENT",
                  "approvalStatus": "APPROVED", "pageStages": {}}
        quality = qualify_page_text([line])
        artifact = {
            "schemaVersion": "document-text-v2", "sourceFileId": "PD-1",
            "inputSha256": "a" * 64,
            "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
            "pageCount": 1, "textPageCount": 1,
            "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
            "qualitySummary": {"textLayerCandidatePageCount": 1,
                               "ocrRequiredPageCount": 0},
            "pages": [{"pageNumber": 1, "widthMilliPoints": 600000,
                       "heightMilliPoints": 800000,
                       "blocks": [{"text": line,
                                   "bboxMilliPoints": [1000, 1000, 300000, 3000]}],
                       "quality": quality}],
        }
        preview = evaluate_run_candidate_family_preview(
            "OBJECT-1", MANIFEST_SHA, [source], [artifact])
        bundle = extract_candidate_family_observations(preview, [source], [artifact])
        self.assertEqual(bundle["outputCount"], 1)
        result = evaluate_candidate_observations(
            RULES["AR-040"], bundle, [], [], context_evidence={})
        self.assertEqual(result["reasonCodes"], ["SOURCE_REVIEW_INVALID"])

    def test_class_and_presence_need_typed_pair_before_family_proofs(self) -> None:
        for code in ("PZ-021", "SPZU-039"):
            with self.subTest(code=code):
                case = _fixture(code)
                result = _run(case, class_scale={"schemaVersion": "candidate-class-scale-v1",
                                                 "version": "1"},
                              set_scope={"status": "VERIFIED"})
                self.assertEqual(result["reasonCodes"], ["TYPED_OBSERVATION_UNAVAILABLE"])

    def test_presence_set_requires_separate_enumeration_and_scope_reviews(self) -> None:
        for rule in PACK["rules"]:
            if rule["family"] != "PRESENCE_SET":
                continue
            with self.subTest(code=rule["parameterCode"]):
                case = _reviewed_presence_case(rule["parameterCode"])
                reviewed = _run(case)
                self.assertEqual(reviewed["status"], "REVIEW_REQUIRED")
                self.assertTrue(reviewed["comparison"]["triggered"])
                self.assertEqual(reviewed["disposition"], "REVIEW_ONLY")
                self.assertEqual(reviewed["executionPolicy"], "NON_EXECUTING_ABSTAIN")
                self.assertEqual(_run(case, set_scope={})["reasonCodes"],
                                 ["SET_SCOPE_INCOMPLETE"])
        case = _reviewed_presence_case()
        missing = copy.deepcopy(case)
        missing[4].pop("reviewed_sets")
        self.assertEqual(_run(missing)["reasonCodes"], ["TYPED_OBSERVATION_UNAVAILABLE"])

    def test_presence_set_rejects_stale_or_unbound_reviewed_fact(self) -> None:
        original = _reviewed_presence_case()
        for mutation in ("review_reference", "fact_id", "source", "raw_text",
                         "extra_observation", "incomplete_scope"):
            with self.subTest(mutation=mutation):
                case = copy.deepcopy(original)
                items = case[4]["reviewed_sets"]
                first = items[case[1]["observations"][0]["observationId"]]
                if mutation == "review_reference":
                    first["review"]["reference"] = ""
                elif mutation == "fact_id":
                    first["fact"]["factId"] = "0" * 64
                elif mutation == "source":
                    first["fact"]["sourceSha256"] = "0" * 64
                    first["fact"]["factId"] = make_fact_id(first["fact"])
                    first["review"]["factId"] = first["fact"]["factId"]
                elif mutation == "raw_text":
                    first["fact"]["rawText"] = "forged enumeration"
                    first["fact"]["factId"] = make_fact_id(first["fact"])
                    first["review"]["factId"] = first["fact"]["factId"]
                elif mutation == "extra_observation":
                    items["0" * 64] = first
                else:
                    case[4]["set_scope"]["DRAINAGE_MEASURE_SET"]["completeActual"] = False
                reason = ("SET_SCOPE_INCOMPLETE" if mutation == "incomplete_scope"
                          else "SET_ENUMERATION_REVIEW_INVALID")
                self.assertEqual(_run(case)["reasonCodes"], [reason])

    def test_literal_class_pair_still_requires_reviewed_ordered_scale(self) -> None:
        rule = RULES["PZ-022"]
        _, _, sources, _, options = _fixture("PZ-022")
        attribute = rule["attributes"][0]
        observations = []
        for source, value in zip(sources, ("I", "II"), strict=True):
            observation = _observation(rule, source, attribute, value, typed=True)
            observation["rawUnit"] = None
            observation["observationId"] = _hash({
                key: item for key, item in observation.items() if key != "observationId"})
            observations.append(observation)
        case = (rule, _bundle(observations), sources,
                [_link(*observations)], options)
        self.assertEqual(_run(case)["reasonCodes"], ["CLASS_SCALE_UNVERIFIED"])
        scale = {
            "schemaVersion": "candidate-class-scale-v1", "scaleId": "synthetic-fire",
            "version": "1", "reference": "synthetic reviewed scale",
            "canonicalUnit": "fire_resistance_degree",
            "orderedValuesLowToHigh": ["V", "IV", "III", "II", "I"],
        }
        reviewed = _run(case, class_scale=scale)
        self.assertEqual(reviewed["status"], "REVIEW_REQUIRED")
        self.assertTrue(reviewed["comparison"]["triggered"])

    def test_tampered_bundle_fact_and_units_abstain(self) -> None:
        original = _fixture("AR-040", actual="1.19")
        for mutation in ("bundle", "fact", "unit"):
            with self.subTest(mutation=mutation):
                case = copy.deepcopy(original)
                observation = case[1]["observations"][0]
                if mutation == "bundle":
                    observation["rawValue"] = "999"
                elif mutation == "fact":
                    observation["typedFact"]["rawValue"] = "999"
                    observation["observationId"] = _hash({
                        key: value for key, value in observation.items()
                        if key != "observationId"})
                    _seal(case[1])
                else:
                    observation["rawUnit"] = "кВт"
                    observation["typedFact"]["rawUnit"] = "кВт"
                    observation["typedFact"]["factId"] = make_fact_id(
                        observation["typedFact"])
                    observation["observationId"] = _hash({
                        key: value for key, value in observation.items()
                        if key != "observationId"})
                    _seal(case[1])
                self.assertEqual(_run(case)["status"], "ABSTAIN")

    def test_observation_and_fact_must_match_run_manifest(self) -> None:
        case = _fixture("AR-040", actual="1.19")
        changed = copy.deepcopy(case)
        observation = changed[1]["observations"][0]
        observation["inputManifestHash"] = "0" * 64
        observation["observationId"] = _hash({
            key: value for key, value in observation.items() if key != "observationId"})
        _seal(changed[1])
        self.assertEqual(_run(changed)["reasonCodes"], ["OBSERVATION_PACK_INVALID"])

        changed = copy.deepcopy(case)
        observation = changed[1]["observations"][0]
        observation["typedFact"]["inputManifestHash"] = "0" * 64
        observation["typedFact"]["factId"] = make_fact_id(observation["typedFact"])
        observation["observationId"] = _hash({
            key: value for key, value in observation.items() if key != "observationId"})
        _seal(changed[1])
        self.assertEqual(_run(changed)["reasonCodes"], ["TYPED_OBSERVATION_UNAVAILABLE"])

    def test_invalid_input_and_unpinned_rule_abstain(self) -> None:
        case = _fixture("AR-040")
        self.assertEqual(_run(case, context_evidence=None)["reasonCodes"], ["INPUT_INVALID"])
        self.assertEqual(_run(case, reviewed_sets={})["reasonCodes"], ["INPUT_INVALID"])
        altered = copy.deepcopy(case[0])
        altered["comparison"]["threshold"]["value"] = "2"
        self.assertEqual(evaluate_candidate_observations(
            altered, case[1], case[2], case[3], **case[4])["reasonCodes"],
            ["RULE_NOT_CATALOG_PINNED"])


if __name__ == "__main__":
    unittest.main()
