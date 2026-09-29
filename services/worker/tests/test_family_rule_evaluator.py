from __future__ import annotations

import copy
import unittest
from decimal import Decimal

from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.fact_comparison import make_fact_id
from inspector_worker.family_rule_evaluator import _canonical_numeric, evaluate_candidate_family_rule


PD_SHA = "a" * 64
RD_SHA = "b" * 64
MANIFEST_SHA = "c" * 64
PACK = load_candidate_family_pack()
RULES = {row["parameterCode"]: row for row in PACK["rules"]}


def _fact(code: str, attribute: str, stage: str, value: str, unit: str) -> dict:
    source_id = "PD-1" if stage == "PD" else "RD-1"
    raw_text = f"{attribute}: {value} {unit}"
    start = raw_text.index(value)
    row = {
        "schemaVersion": "typed-fact-v1", "parameterCode": code,
        "objectId": "OBJECT-1", "attribute": attribute, "stage": stage,
        "sourceFileId": source_id, "sourceSha256": PD_SHA if stage == "PD" else RD_SHA,
        "pageNumber": 1, "rawText": raw_text, "rawValue": value, "rawUnit": unit,
        "locator": {"kind": "TEXT_BLOCK", "blockIndex": 0, "start": start,
                    "end": start + len(value), "bboxMilliPoints": [1, 2, 100, 20]},
    }
    row["factId"] = make_fact_id(row)
    return row


def _link(expected: dict, actual: dict) -> dict:
    return {
        "schemaVersion": "fact-entity-link-v1", "pdFactId": expected["factId"],
        "actualFactId": actual["factId"], "objectId": "OBJECT-1",
        "linkGroupId": "BUILDING-1", "basis": {"reference": "reviewed drawing link"},
        "evidence": [{key: copy.deepcopy(fact[key]) for key in
                      ("factId", "sourceFileId", "sourceSha256", "pageNumber", "locator")}
                     for fact in (expected, actual)],
    }


def fixture(code: str, values: dict[str, tuple[str, str]], units: dict[str, str] | None = None):
    rule = RULES[code]
    units = units or {row["key"]: row["canonicalUnit"] for row in rule["attributes"]}
    sources = [{
        "sourceFileId": source_id, "objectId": "OBJECT-1", "sha256": sha,
        "manifestSha256": MANIFEST_SHA,
        "stages": [stage], "pageCount": 1, "pageStages": {},
        "revisionStatus": "CURRENT", "approvalStatus": "APPROVED",
        "linkGroupId": "BUILDING-1", "section": "KR" if code.startswith("KR-") else "AR",
        "drawingSection": rule[f"required{side}DrawingSections"][0],
    } for (source_id, sha, stage), side in zip(
        (("PD-1", PD_SHA, "PD"), ("RD-1", RD_SHA, "RD")),
        ("Expected", "Actual"), strict=True)]
    facts, links = [], []
    for attribute, (pd_value, rd_value) in values.items():
        pd = _fact(code, attribute, "PD", pd_value, units[attribute])
        rd = _fact(code, attribute, "RD", rd_value, units[attribute])
        if code.startswith("KR-"):
            for fact in (pd, rd):
                fact.update(elementType="FOUNDATION", zone="A", floor="1", scope="BLOCK-1")
                fact["factId"] = make_fact_id(fact)
        elif code == "SPZU-024":
            for fact in (pd, rd):
                fact["scope"] = "EARTHWORK-1"
                fact["factId"] = make_fact_id(fact)
        facts.extend((pd, rd))
        links.append(_link(pd, rd))
    context = {gate: {"status": "VERIFIED", "reference": "human review 1"}
               for gate in rule["requiredContext"] if not gate.endswith("_MANIFEST_SECTION_UNRESOLVED")}
    resolutions = {}
    for side, source_id in (("expected", "PD-1"), ("actual", "RD-1")):
        source = sources[0 if side == "expected" else 1]
        if rule["manifestSectionStatus"][side] == "EXACT_CATEGORY":
            allowed = rule[f"required{side.title()}Sections"]
            source["section"] = allowed[0]
        if (rule["manifestSectionStatus"][side] == "UNKNOWN_ABSTAIN"
                or source["drawingSection"] != source["section"]):
            resolutions[side] = {"status": "VERIFIED", "sourceFileId": source_id,
                                 "sourceSha256": source["sha256"],
                                 "manifestSha256": MANIFEST_SHA,
                                 "stage": "PD" if side == "expected" else "RD",
                                 "manifestSection": source["section"],
                                 "drawingSection": source["drawingSection"],
                                 "reference": "human section review 1"}
    return rule, sources, facts, links, context, resolutions


def run(case, **overrides):
    rule, sources, facts, links, context, resolutions = case
    options = {"context_evidence": context, "section_resolutions": resolutions}
    options.update(overrides)
    return evaluate_candidate_family_rule(rule, sources, facts, links, **options)


def basis(case):
    rule, _, facts, _, _, _ = case
    return {attribute: {"status": "VERIFIED", "reference": "approved denominator",
                        "denominator": "EXPECTED", "parameterCode": rule["parameterCode"],
                        "objectId": "OBJECT-1", "attribute": attribute,
                        "manifestSha256": MANIFEST_SHA,
                        "expectedFactId": next(f["factId"] for f in facts
                                               if f["attribute"] == attribute and f["stage"] == "PD"),
                        "actualFactId": next(f["factId"] for f in facts
                                             if f["attribute"] == attribute and f["stage"] == "RD")}
            for attribute in rule["comparison"]["attributeKeys"]}


class FamilyRuleEvaluatorTests(unittest.TestCase):
    def test_all_47_are_pinned_and_review_only(self):
        for rule in PACK["rules"]:
            with self.subTest(code=rule["parameterCode"]):
                result = evaluate_candidate_family_rule(rule, [], [], [], context_evidence={})
                self.assertEqual(result["schemaVersion"], "candidate-family-evaluation-v1")
                self.assertEqual(result["disposition"], "REVIEW_ONLY")
                self.assertEqual(result["status"], "ABSTAIN")
                self.assertNotIn("findings", result)
                self.assertNotIn("coverage", result)

    def test_all_47_accept_synthetic_inputs_without_accidental_execution(self):
        for rule in PACK["rules"]:
            with self.subTest(code=rule["parameterCode"]):
                values = {row["key"]: ("100", "101") for row in rule["attributes"]}
                case = fixture(rule["parameterCode"], values)
                result = run(case)
                self.assertIn(result["status"], {"ABSTAIN", "REVIEW_REQUIRED"})
                self.assertEqual(result["disposition"], "REVIEW_ONLY")
                self.assertFalse({"findings", "coverage", "negativeVerified"} & result.keys())
                if result["status"] == "REVIEW_REQUIRED":
                    self.assertIn(rule["family"], {"DECREASE", "INCREASE", "DIFFERENT"})

    def test_wrong_drawing_section_and_denominator_fact_abstain(self):
        key = "BUILDING_TOTAL_AREA"
        case = fixture("PZ-002", {key: ("100", "101.01")})
        case[1][0]["drawingSection"] = "AR"
        self.assertEqual(run(case, relative_basis=basis(case))["reasonCodes"],
                         ["EXPECTED_SECTION_UNVERIFIED"])
        case = fixture("PZ-002", {key: ("100", "101.01")})
        wrong = basis(case)
        wrong[key]["expectedFactId"] = "unrelated"
        self.assertEqual(run(case, relative_basis=wrong)["reasonCodes"],
                         ["RELATIVE_BASIS_UNVERIFIED"])

    def test_section_resolution_is_bound_to_source_manifest_stage_and_section(self):
        key = "BUILDING_TOTAL_AREA"
        original = fixture("PZ-002", {key: ("100", "101.01")})
        self.assertEqual(run(original, relative_basis=basis(original))["status"],
                         "REVIEW_REQUIRED")
        for field, wrong in (("sourceFileId", "RD-1"), ("sourceSha256", RD_SHA),
                             ("manifestSha256", "d" * 64), ("stage", "RD"),
                             ("manifestSection", "PZ"), ("drawingSection", "AR"),
                             ("status", "PROPOSED"), ("reference", " ")):
            with self.subTest(field=field):
                case = copy.deepcopy(original)
                case[5]["expected"][field] = wrong
                self.assertEqual(run(case, relative_basis=basis(case))["reasonCodes"],
                                 ["EXPECTED_SECTION_UNVERIFIED"])
        case = copy.deepcopy(original)
        case[5]["expected"]["unreviewedExtra"] = True
        self.assertEqual(run(case, relative_basis=basis(case))["reasonCodes"],
                         ["EXPECTED_SECTION_UNVERIFIED"])
        case = copy.deepcopy(original)
        case[1][0]["manifestSha256"] = "d" * 64
        self.assertEqual(run(case, relative_basis=basis(case))["reasonCodes"],
                         ["SOURCE_MANIFEST_MISMATCH"])

    def test_exact_manifest_category_needs_bound_drawing_mark_when_different(self):
        key = "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS"
        original = fixture("KR-061", {key: ("200", "199")})
        self.assertEqual(run(original)["status"], "REVIEW_REQUIRED")
        case = copy.deepcopy(original)
        case[5].pop("actual")
        self.assertEqual(run(case)["reasonCodes"], ["ACTUAL_SECTION_UNVERIFIED"])
        case = copy.deepcopy(original)
        case[5]["actual"]["sourceSha256"] = PD_SHA
        self.assertEqual(run(case)["reasonCodes"], ["ACTUAL_SECTION_UNVERIFIED"])

    def test_proofs_reject_stale_fact_pair_or_manifest(self):
        relative_key = "BUILDING_TOTAL_AREA"
        relative = fixture("PZ-002", {relative_key: ("100", "101.01")})
        relative_proof = basis(relative)
        for field, wrong in (("actualFactId", "stale"),
                             ("manifestSha256", "d" * 64)):
            with self.subTest(proof="relative", field=field):
                stale = copy.deepcopy(relative_proof)
                stale[relative_key][field] = wrong
                self.assertEqual(run(relative, relative_basis=stale)["reasonCodes"],
                                 ["RELATIVE_BASIS_UNVERIFIED"])
        norm_key = "EVACUATION_CORRIDOR_WIDTH"
        norm = fixture("AR-040", {norm_key: ("1.3", "1.19")})
        norm_proof = {norm_key: {"status": "VERIFIED", "reference": "approved norm",
                                 "applicable": True, "parameterCode": "AR-040",
                                 "objectId": "OBJECT-1", "attribute": norm_key,
                                 "threshold": "1.2", "canonicalUnit": "m",
                                 "expectedFactId": norm[2][0]["factId"],
                                 "actualFactId": norm[2][1]["factId"],
                                 "manifestSha256": MANIFEST_SHA}}
        self.assertEqual(run(norm, norm_basis=norm_proof)["status"], "REVIEW_REQUIRED")
        for field, wrong in (("expectedFactId", "stale"), ("actualFactId", "stale"),
                             ("manifestSha256", "d" * 64)):
            with self.subTest(proof="norm", field=field):
                stale = copy.deepcopy(norm_proof)
                stale[norm_key][field] = wrong
                self.assertEqual(run(norm, norm_basis=stale)["reasonCodes"],
                                 ["NORM_APPLICABILITY_UNVERIFIED"])

    def test_decrease_strict_sign_and_equal(self):
        key = "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS"
        for rd, triggered in (("199", True), ("200", False), ("201", False)):
            case = fixture("KR-061", {key: ("200", rd)})
            self.assertEqual(run(case)["comparison"]["triggered"], triggered)

    def test_increase_requires_verified_context(self):
        key = "DESIGN_ELECTRIC_POWER"
        case = fixture("PZ-014", {key: ("100", "101")})
        self.assertTrue(run(case)["comparison"]["triggered"])
        case[4].pop("TECHNICAL_CONDITIONS_LIMIT")
        self.assertEqual(run(case)["reasonCodes"], ["CONTEXT_NOT_VERIFIED"])

    def test_russian_catalog_numeric_units_evaluate(self):
        cases = (
            ("PZ-008", "BUILDING_HEIGHT", "м"),
            ("PZ-014", "DESIGN_ELECTRIC_POWER", "кВт"),
            ("PZ-016", "DAILY_WATER_CONSUMPTION", "м³/сут"),
            ("PZ-017", "TOTAL_HEATING_LOAD", "Гкал/ч"),
            ("PZ-018", "MAX_HOURLY_GAS_FLOW", "м³/ч"),
            ("ZU-126", "WALL_INSULATION_THERMAL_CONDUCTIVITY", "Вт/(м·С)"),
            ("ZU-131", "ANNUAL_SPECIFIC_HEATING_ENERGY", "кВт·ч/м²"),
        )
        for code, key, unit in cases:
            with self.subTest(code=code):
                case = fixture(code, {key: ("1,0", "1,1")}, {key: unit})
                result = run(case)
                self.assertEqual(result["status"], "REVIEW_REQUIRED")
                self.assertTrue(result["comparison"]["triggered"])

    def test_russian_day_mass_and_cost_units_evaluate(self):
        duration = fixture("POS-082", {"CRITICAL_CONSTRUCTION_STAGE_DURATION": ("10", "12")},
                           {"CRITICAL_CONSTRUCTION_STAGE_DURATION": "дни"})
        self.assertTrue(run(duration, relative_basis=basis(duration))["comparison"]["triggered"])
        mass = fixture("KR-067", {"CONCRETE_VOLUME": ("100", "100"),
                                  "STEEL_MASS": ("10", "10,3")},
                       {"CONCRETE_VOLUME": "м³", "STEEL_MASS": "т"})
        result = run(mass, relative_basis=basis(mass))
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertTrue(result["comparison"]["triggered"])
        self.assertEqual(result["attributeComparisons"][1]["observed"], "3")
        cost = fixture("SM-132", {"CONSTRUCTION_TOTAL_COST": ("100", "106")},
                       {"CONSTRUCTION_TOTAL_COST": "тыс. руб."})
        self.assertTrue(run(cost, relative_basis=basis(cost))["comparison"]["triggered"])

    def test_explicit_unit_conversions_and_ambiguous_units(self):
        conversions = (
            ("m", "см", "125", "1.25"),
            ("kW", "Вт", "1500", "1.5"),
            ("t", "кг", "1500", "1.5"),
            ("thousand_rub", "руб.", "1500", "1.5"),
        )
        for canonical, raw_unit, raw_value, expected in conversions:
            with self.subTest(canonical=canonical, raw_unit=raw_unit):
                self.assertEqual(_canonical_numeric(
                    {"rawUnit": raw_unit, "rawValue": raw_value}, canonical), Decimal(expected))
        for canonical, wrong_unit in (
            ("m", "м²"), ("kW", "кВА"), ("Gcal/h", "МВт"),
            ("kW", "мВт"),
            ("m3/day", "м³/ч"), ("m3/h", "м³/сут"),
            ("t", "т/м³"), ("day", "час"),
            ("W/(m*C)", "Вт/(м²·С)"), ("kWh/m2", "кВт"),
            ("thousand_rub", "руб/м²"),
        ):
            with self.subTest(canonical=canonical, wrong_unit=wrong_unit):
                self.assertIsNone(_canonical_numeric(
                    {"rawUnit": wrong_unit, "rawValue": "12"}, canonical))
        self.assertEqual(_canonical_numeric(
            {"rawUnit": "тыс.\u00a0руб.", "rawValue": "1 500,5"}, "thousand_rub"),
            Decimal("1500.5"))

    def test_wrong_russian_unit_abstains_end_to_end(self):
        case = fixture("PZ-014", {"DESIGN_ELECTRIC_POWER": ("100", "101")},
                       {"DESIGN_ELECTRIC_POWER": "кВА"})
        self.assertEqual(run(case)["reasonCodes"], ["VALUE_OR_UNIT_INVALID"])

    def test_different_count_and_wrong_unit(self):
        key = "APARTMENT_COUNT"
        case = fixture("PZ-010", {key: ("100", "101")})
        self.assertTrue(run(case)["comparison"]["triggered"])
        case = fixture("PZ-010", {key: ("100", "101")}, {key: "m3"})
        self.assertEqual(run(case)["reasonCodes"], ["VALUE_OR_UNIT_INVALID"])

    def test_relative_strict_threshold_and_zero(self):
        key = "BUILDING_TOTAL_AREA"
        for actual, triggered in (("101", False), ("101.01", True), ("99", False)):
            case = fixture("PZ-002", {key: ("100", actual)})
            self.assertEqual(run(case, relative_basis=basis(case))["comparison"]["triggered"], triggered)
        zero = fixture("PZ-002", {key: ("0", "10")})
        self.assertEqual(run(zero, relative_basis=basis(zero))["reasonCodes"], ["ZERO_BASELINE"])

    def test_relative_increase_direction_and_basis(self):
        key = "CRITICAL_CONSTRUCTION_STAGE_DURATION"
        case = fixture("POS-082", {key: ("100", "110")})
        self.assertFalse(run(case, relative_basis=basis(case))["comparison"]["triggered"])
        case = fixture("POS-082", {key: ("100", "111")})
        self.assertTrue(run(case, relative_basis=basis(case))["comparison"]["triggered"])
        self.assertEqual(run(case)["reasonCodes"], ["RELATIVE_BASIS_UNVERIFIED"])

    def test_lower_and_upper_bound_require_applicable_norm(self):
        for code, key, expected, actual, threshold in (
            ("AR-040", "EVACUATION_CORRIDOR_WIDTH", "1.3", "1.19", "1.2"),
            ("ODI-118", "ACCESSIBLE_DOOR_THRESHOLD_HEIGHT", "0.01", "0.015", "0.014"),
        ):
            case = fixture(code, {key: (expected, actual)})
            self.assertEqual(run(case)["reasonCodes"], ["NORM_APPLICABILITY_UNVERIFIED"])
            proof = {"status": "VERIFIED", "applicable": True, "reference": "approved norm",
                     "parameterCode": code, "objectId": "OBJECT-1", "attribute": key,
                     "threshold": threshold, "canonicalUnit": "m",
                     "expectedFactId": case[2][0]["factId"],
                     "actualFactId": case[2][1]["factId"],
                     "manifestSha256": MANIFEST_SHA}
            self.assertTrue(run(case, norm_basis={key: proof})["comparison"]["triggered"])
            self.assertEqual(run(case, norm_basis={key: {**proof, "applicable": False}})["status"],
                             "ABSTAIN")
            self.assertEqual(run(case, norm_basis={key: {**proof, "threshold": "99"}})["status"],
                             "ABSTAIN")
            boundary = fixture(code, {key: (expected, threshold)})
            boundary_proof = {**proof, "expectedFactId": boundary[2][0]["factId"],
                              "actualFactId": boundary[2][1]["factId"]}
            self.assertFalse(run(boundary, norm_basis={key: boundary_proof})["comparison"]["triggered"])

    def test_atomic_composites_abstain_on_missing_component(self):
        for code, attributes, units in (
            ("SPZU-024", {"EXCAVATION_VOLUME": ("100", "106"),
                           "BACKFILL_VOLUME": ("100", "100")}, None),
            ("KR-067", {"CONCRETE_VOLUME": ("100", "103"),
                        "STEEL_MASS": ("50", "50")}, None),
        ):
            case = fixture(code, attributes, units)
            relative = basis(case)
            self.assertEqual(len(run(case, relative_basis=relative)["attributeComparisons"]), 2)
            case[2][:] = [fact for fact in case[2] if fact["attribute"] != list(attributes)[1]]
            self.assertEqual(run(case, relative_basis=relative)["status"], "ABSTAIN")

    def test_composite_cannot_mix_structure_scopes(self):
        attributes = {"CONCRETE_VOLUME": ("100", "103"), "STEEL_MASS": ("50", "50")}
        case = fixture("KR-067", attributes)
        relative = basis(case)
        for fact in case[2]:
            if fact["attribute"] == "STEEL_MASS":
                fact["scope"] = "BLOCK-2"
                fact["factId"] = make_fact_id(fact)
        case[3][1] = _link(case[2][2], case[2][3])
        relative["STEEL_MASS"]["expectedFactId"] = case[2][2]["factId"]
        relative["STEEL_MASS"]["actualFactId"] = case[2][3]["factId"]
        self.assertEqual(run(case, relative_basis=relative)["reasonCodes"],
                         ["COMPOSITE_SCOPE_MISMATCH"])

    def test_pos_086_unresolved_baseline_abstains(self):
        case = fixture("POS-086", {"PEAK_PERSONNEL_COUNT": ("100", "150")})
        self.assertEqual(run(case)["reasonCodes"], ["RULE_COMPARISON_UNRESOLVED"])

    def test_class_requires_versioned_scale(self):
        key = "ENERGY_EFFICIENCY_CLASS"
        case = fixture("PZ-021", {key: ("B", "C")})
        self.assertEqual(run(case)["reasonCodes"], ["CLASS_SCALE_UNVERIFIED"])
        scale = {"schemaVersion": "candidate-class-scale-v1", "version": "1",
                 "scaleId": "approved-energy-class", "canonicalUnit": "energy_class",
                 "orderedValuesLowToHigh": ["D", "C", "B", "A"],
                 "reference": "approved class scale"}
        self.assertTrue(run(case, class_scale=scale)["comparison"]["triggered"])
        self.assertEqual(run(case, class_scale={**scale, "version": ""})["status"], "ABSTAIN")

    def test_presence_set_abstains_without_complete_scope(self):
        key = "DRAINAGE_MEASURE_SET"
        case = fixture("SPZU-039", {key: ("лотки", "дренаж")})
        self.assertEqual(run(case)["reasonCodes"], ["SET_SCOPE_INCOMPLETE"])
        proof = {"status": "VERIFIED", "reference": "complete area survey",
                 "parameterCode": "SPZU-039", "completeExpected": True,
                 "completeActual": True, "sameSearchScope": True,
                 "manifestSha256": MANIFEST_SHA,
                 "expectedFactId": case[2][0]["factId"], "actualFactId": case[2][1]["factId"],
                 "expectedMembers": ["лотки"], "actualMembers": ["дренаж"]}
        self.assertTrue(run(case, set_scope={key: proof})["comparison"]["triggered"])
        self.assertEqual(run(case, set_scope={key: {**proof, "completeActual": False}})["status"],
                         "ABSTAIN")
        for field, wrong in (("actualFactId", "stale"),
                             ("manifestSha256", "d" * 64)):
            with self.subTest(field=field):
                self.assertEqual(run(case, set_scope={key: {**proof, field: wrong}})["reasonCodes"],
                                 ["SET_SCOPE_INCOMPLETE"])

    def test_revision_link_and_locator_fail_closed(self):
        key = "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS"
        case = fixture("KR-061", {key: ("200", "199")})
        case[1][1]["revisionStatus"] = "SUPERSEDED"
        self.assertEqual(run(case)["reasonCodes"], ["REVISION_NOT_CURRENT"])
        case = fixture("KR-061", {key: ("200", "199")})
        case[3][0]["actualFactId"] = "wrong"
        self.assertEqual(run(case)["status"], "ABSTAIN")
        case = fixture("KR-061", {key: ("200", "199")})
        case[2][1]["rawText"] = "tampered"
        self.assertEqual(run(case)["status"], "ABSTAIN")

    def test_mutated_rule_cannot_evaluate(self):
        key = "LOAD_BEARING_MONOLITHIC_WALL_THICKNESS"
        case = fixture("KR-061", {key: ("200", "199")})
        case = ({**case[0], "comparison": {**case[0]["comparison"], "threshold": None,
                                          "operator": ">"}}, *case[1:])
        self.assertEqual(run(case)["reasonCodes"], ["RULE_NOT_CATALOG_PINNED"])


if __name__ == "__main__":
    unittest.main()
