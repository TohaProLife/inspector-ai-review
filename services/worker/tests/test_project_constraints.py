from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from inspector_worker.project_constraints import (
    canonical_project_constraint_json, extract_project_constraints, project_constraint_id,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures/pd-door-bound-F0151-p22.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text())
GOLDEN_ID = "e51a0851241b570283a8ec157f5dcafca4fddd1d67318428026bc4bd548dc419"
GOLDEN_TEXT_HASH = "67ed82e56120ffecd42281e9762224311c2e699a798668a8fbcae72eb7d0b737"


def extract(value=None):
    f = FIXTURE if value is None else value
    return extract_project_constraints(f["objectId"], f["inputManifestHash"], [f["source"]], [f["sourceArtifact"]])


def page(value):
    return value["sourceArtifact"]["pages"][21]


def replace_line(value, index, old, new):
    page(value)["blocks"][index]["text"] = page(value)["blocks"][index]["text"].replace(old, new)


class ProjectConstraintTests(unittest.TestCase):
    def test_actual_full_public_document_and_exact_payload(self):
        result = extract()
        self.assertEqual(set(result), {"schemaVersion", "objectId", "inputManifestHash", "extractorVersion", "purpose", "constraints"})
        self.assertEqual(result["purpose"], "EVIDENCE_ONLY")
        self.assertEqual(len(FIXTURE["sourceArtifact"]["pages"]), 40)
        self.assertEqual(len(result["constraints"]), 1)
        fact = result["constraints"][0]
        self.assertEqual(fact["id"], GOLDEN_ID)
        self.assertEqual(fact["textArtifactHash"], GOLDEN_TEXT_HASH)
        self.assertEqual(fact["pageNumber"], 22)
        self.assertEqual(fact["limitValue"], "0.9")
        self.assertEqual(fact["relation"], "GE")
        self.assertEqual(fact["canonicalUnit"], "m")
        self.assertIsNone(fact["entityKey"])
        self.assertEqual(fact["applicabilityStatus"], "UNREVIEWED")
        self.assertEqual(fact["measurementBasis"], "CLEAR_OPENING_WITH_LEAF_OPEN")
        self.assertEqual(set(fact), {"id", "schemaVersion", "kind", "relation", "attribute", "limitValue", "canonicalUnit",
            "sourceFileId", "sourceSha256", "textArtifactHash", "stage", "extractorVersion", "entityKey", "applicabilityStatus",
            "componentClass", "measurementBasis", "pageNumber", "widthMilliPoints", "heightMilliPoints", "fragments"})
        self.assertEqual([x["usedTextRange"] for x in fact["fragments"]],
                         [{"start": 0, "end": end} for end in [69, 73, 71, 27]])
        for i, fragment in enumerate(fact["fragments"]):
            self.assertEqual(fragment["rawText"], page(FIXTURE)["blocks"][i]["text"])
            self.assertEqual(fragment["bboxMilliPoints"], page(FIXTURE)["blocks"][i]["bboxMilliPoints"])
        last = fact["fragments"][-1]
        self.assertEqual(last["rawText"][:last["usedTextRange"]["end"]], "открытом  дверном  полотне.")
        self.assertIn("либо", last["rawText"][last["usedTextRange"]["end"]:])
        self.assertNotIn("bbox", fact)
        self.assertNotIn("results", result)
        self.assertNotIn("coverage", result)
        self.assertNotIn("bindings", result)

    def test_no_input_mutation_or_shared_output_objects(self):
        fixture = copy.deepcopy(FIXTURE)
        before = copy.deepcopy(fixture)
        first, second = extract(fixture), extract(fixture)
        self.assertEqual(first, second)
        first["constraints"][0]["fragments"][0]["bboxMilliPoints"][0] = 0
        self.assertEqual(fixture, before)
        self.assertEqual(second, extract(fixture))

    def test_source_hash_is_not_allowlisted(self):
        f = copy.deepcopy(FIXTURE)
        f["source"]["sourceFileId"] = f["sourceArtifact"]["sourceFileId"] = "other-public-source"
        f["source"]["sha256"] = f["sourceArtifact"]["inputSha256"] = "a" * 64
        result = extract(f)["constraints"]
        self.assertEqual(len(result), 1)
        self.assertNotEqual(result[0]["id"], GOLDEN_ID)

    def test_decimal_is_canonical_without_float(self):
        for raw, expected in [("0.900", "0.9"), ("1,80", "1.8"), ("10,00", "10"), ("1", "1")]:
            with self.subTest(raw=raw):
                f = copy.deepcopy(FIXTURE)
                replace_line(f, 2, "0,9", raw)
                self.assertEqual(extract(f)["constraints"][0]["limitValue"], expected)

    def test_invalid_numeric_forms_abstain(self):
        for raw in ["0", "0,000", "00,9", "0,9–1,2", "0,9-1,2", "0,9/1,2", "0,9 или 1,2", "1 000", "-0,9", "+0,9", "1e3", "NaN", "9" * 61]:
            with self.subTest(raw=raw):
                f = copy.deepcopy(FIXTURE)
                replace_line(f, 2, "0,9", raw)
                self.assertEqual(extract(f)["constraints"], [])

    def test_negations_quotes_normative_and_wrong_basis_abstain(self):
        changes = [(0, "Ширина", "Не ширина"), (0, "Ширина", "«Ширина"),
            (0, "Ширина", "Согласно СП ширина"), (2, "не менее", "не более"),
            (2, "не менее", "менее"), (2, "принята", "не принята"), (2, "принята", "рекомендуется"),
            (2, "принята", "должна быть"), (2, " м ", " мм "), (2, " м ", " М "),
            (2, "в свету", "по полотну"), (3, "открытом", "закрытом"),
            (3, "полотне.", "полотне, кроме двери Д1."), (3, "Дверные", "Однако дверные")]
        for index, old, new in changes:
            with self.subTest(index=index, new=new):
                f = copy.deepcopy(FIXTURE)
                replace_line(f, index, old, new)
                self.assertEqual(extract(f)["constraints"], [])

    def test_malformed_or_quoted_competing_anchor_abstains(self):
        for text in [page(FIXTURE)["blocks"][0]["text"], "«Ширина дверных проемов — не указана»", "Ширина дверных проемов ???"]:
            with self.subTest(text=text):
                f = copy.deepcopy(FIXTURE)
                page(f)["blocks"].append({"text": text, "bboxMilliPoints": [1000, 1000, 2000, 2000]})
                self.assertEqual(extract(f)["constraints"], [])

    def test_four_original_single_line_blocks_required(self):
        for kind in ["merged", "newline", "lineboxes", "insert"]:
            with self.subTest(kind=kind):
                f = copy.deepcopy(FIXTURE)
                b = page(f)["blocks"]
                if kind == "merged":
                    b[0]["text"] += " " + b[1]["text"]
                    b.pop(1)
                elif kind == "newline":
                    b[0]["text"] += "\n"
                elif kind == "lineboxes":
                    b[0]["lineBboxesMilliPoints"] = [b[0]["bboxMilliPoints"], b[0]["bboxMilliPoints"]]
                else:
                    b.insert(1, {"text": "", "bboxMilliPoints": [1000, 1000, 2000, 2000]})
                self.assertEqual(extract(f)["constraints"], [])

    def test_single_line_original_block_can_supply_exact_geometry(self):
        f = copy.deepcopy(FIXTURE)
        for b in page(f)["blocks"][:4]:
            del b["lineBboxesMilliPoints"]
        self.assertEqual(len(extract(f)["constraints"]), 1)

    def test_hidden_interleaving_row_abstains_even_after_selected_block_indices(self):
        f = copy.deepcopy(FIXTURE)
        page(f)["blocks"].append({"text": "кроме дверей Д1", "bboxMilliPoints": [85085, 760000, 556320, 766000]})
        self.assertEqual(extract(f)["constraints"], [])

    def test_geometry_guards_abstain(self):
        for kind in ["reverse", "gap", "indent", "left", "right", "height", "overlap", "outside", "float", "bool", "unsafe"]:
            with self.subTest(kind=kind):
                f = copy.deepcopy(FIXTURE)
                b = page(f)["blocks"]
                index = 0
                if kind == "reverse": b[0]["bboxMilliPoints"] = [120480, 700000, 556312, 714040]
                elif kind == "gap": b[0]["bboxMilliPoints"] = [120480, 790000, 556312, 804040]
                elif kind == "indent": b[0]["bboxMilliPoints"][0] += 10000
                elif kind == "left": index = 1; b[1]["bboxMilliPoints"][0] += 2000
                elif kind == "right": b[0]["bboxMilliPoints"][2] -= 5000
                elif kind == "height": b[0]["bboxMilliPoints"][3] -= 2000
                elif kind == "overlap": b[0]["bboxMilliPoints"][1] = 750000
                elif kind == "outside": b[0]["bboxMilliPoints"][2] = 1000000
                elif kind == "float": b[0]["bboxMilliPoints"][0] = 120480.0
                elif kind == "bool": b[0]["bboxMilliPoints"][0] = True
                else: b[0]["bboxMilliPoints"][0] = 2**53
                b[index]["lineBboxesMilliPoints"] = [copy.deepcopy(b[index]["bboxMilliPoints"])]
                self.assertEqual(extract(f)["constraints"], [])

    def test_single_stage_source_and_matching_origin_required(self):
        variants = [("stages", ["RD"]), ("stages", ["PD", "RD"]), ("stages", []),
                    ("sha256", "a" * 64), ("sourceFileId", "other"), ("objectId", "another-object")]
        for key, value in variants:
            with self.subTest(key=key, value=value):
                f = copy.deepcopy(FIXTURE)
                f["source"][key] = value
                self.assertEqual(extract(f)["constraints"], [])

    def test_review_proofs_do_not_grant_entity_or_applicability(self):
        f = copy.deepcopy(FIXTURE)
        f["source"].update(entityKey="invented-door", scopeProofs={"ENTITY_SCOPE": {"status": "VERIFIED"}},
            approvalStatus="APPROVED", revisionStatus="CURRENT")
        self.assertEqual(extract(f), extract())

    def test_quality_and_full_envelope_required(self):
        for kind in ["ocr", "missing-quality", "float-meta", "extra", "extra-block", "duplicate-page", "truncated", "wrong-frame", "bool-width", "malformed-policy"]:
            with self.subTest(kind=kind):
                f = copy.deepcopy(FIXTURE)
                a = f["sourceArtifact"]
                if kind == "ocr": page(f)["quality"]["disposition"] = "OCR_REQUIRED"
                elif kind == "missing-quality": del page(f)["quality"]
                elif kind == "float-meta": a["qualitySummary"]["ocrRequiredPageCount"] = 2.0
                elif kind == "extra": a["relation"] = "GE"
                elif kind == "extra-block": page(f)["blocks"][0]["approved"] = True
                elif kind == "duplicate-page": a["pages"][20]["pageNumber"] = 22
                elif kind == "truncated": a["pages"] = [a["pages"][21]]
                elif kind == "wrong-frame": a["coordinateSystem"] = "NORMALIZED"
                elif kind == "bool-width": page(f)["widthMilliPoints"] = True
                else: a["qualityPolicyVersion"] = []
                self.assertEqual(extract(f)["constraints"], [])

    def test_duplicate_sources_or_artifacts_cannot_select_convenient_candidate(self):
        f = FIXTURE
        for sources, artifacts in [([f["source"], f["source"]], [f["sourceArtifact"]]),
                                   ([f["source"]], [f["sourceArtifact"], f["sourceArtifact"]])]:
            self.assertEqual(extract_project_constraints(f["objectId"], f["inputManifestHash"], sources, artifacts)["constraints"], [])

    def test_entire_immutable_artifact_enters_identity(self):
        f = copy.deepcopy(FIXTURE)
        f["sourceArtifact"]["pages"][0]["blocks"][0]["text"] += " "
        fact = extract(f)["constraints"][0]
        self.assertNotEqual(fact["textArtifactHash"], GOLDEN_TEXT_HASH)
        self.assertNotEqual(fact["id"], GOLDEN_ID)
        self.assertEqual(fact["fragments"], extract()["constraints"][0]["fragments"])

    def test_every_semantic_field_enters_new_hash_domain(self):
        fact = extract()["constraints"][0]
        mutations = [(["relation"], "LE"), (["limitValue"], "1.8"), (["canonicalUnit"], "mm"),
            (["measurementBasis"], "LEAF_WIDTH"), (["sourceSha256"], "a" * 64),
            (["fragments", 3, "usedTextRange", "end"], 26), (["fragments", 0, "rawText"], "altered")]
        for path, value in mutations:
            with self.subTest(path=path):
                changed = copy.deepcopy(fact)
                target = changed
                for part in path[:-1]: target = target[part]
                target[path[-1]] = value
                self.assertNotEqual(project_constraint_id(changed), GOLDEN_ID)
        self.assertEqual(project_constraint_id({**fact, "id": "forged"}), GOLDEN_ID)

    def test_new_hash_json_policy_rejects_floats_surrogates_and_cycles(self):
        self.assertEqual(canonical_project_constraint_json({"z": "😀", "A": 1, "_": 2}), '{"A":1,"_":2,"z":"😀"}')
        cycle = []; cycle.append(cycle)
        for value in [1.0, float("nan"), {"а": 1}, "\ud800", 2**53, cycle]:
            with self.subTest(kind=type(value).__name__):
                with self.assertRaises(ValueError): canonical_project_constraint_json(value)

    def test_invalid_outer_input_raises_clean_value_error(self):
        for object_id, manifest, sources, artifacts in [("", "a" * 64, [], []), ("x", "wrong", [], []),
                                                       ("x", "a" * 64, {}, []), ("x", "a" * 64, [], {})]:
            with self.assertRaisesRegex(ValueError, "invalid project constraint input"):
                extract_project_constraints(object_id, manifest, sources, artifacts)

    def test_legacy_exact_engine_is_unchanged_by_pure_extraction(self):
        from inspector_worker.matrix_engine import build_matrix_execution
        f = copy.deepcopy(FIXTURE)
        kwargs = {"object_id": f["objectId"], "input_manifest_hash": f["inputManifestHash"],
                  "sources": [f["source"]], "text_artifacts": [f["sourceArtifact"]]}
        before = build_matrix_execution(**kwargs)
        extract(f)
        self.assertEqual(build_matrix_execution(**kwargs), before)
        self.assertFalse(any(o["pageNumber"] == 22 and o["attribute"] == "DOOR_CLEAR_OPENING_WIDTH" for o in before["observations"]))


if __name__ == "__main__":
    unittest.main()
