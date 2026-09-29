from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.candidate_family_rules import load_candidate_family_pack
from inspector_worker.presence_family_candidates import (
    LABEL_PACK_PATH, PRESENCE_CODES, PresenceFamilyCandidateError, _hash,
    extract_indexed_presence_family_candidates, load_presence_family_labels,
)


CASES = {
    "SPZU-039": ("Зона дренажа З1: открытый лоток предусмотрен.", "SPZU", "OPEN_DRAIN_TRAY"),
    "AR-053": ("Узел перегородки У1: демпферная лента.", "AR", "DAMPING_TAPE"),
    "POD-092": ("Действующая сеть С1, зона работы техники З1: защитный короб.",
                "POD", "PROTECTIVE_BOX"),
    "POD-095": ("Зона демонтажа З1: система гидроорошения.", "POD", "HYDRO_SPRAY"),
    "ODI-120": ("Санузел МГН №1: откидной поручень.", "ODI", "FOLDING_GRAB_RAIL"),
    "ODI-122": ("Лестница Л1: предупреждающая тактильная полоса.",
                "ODI", "TACTILE_WARNING_STRIP"),
    "ODI-123": ("Санузел МГН №1: кнопка вызова персонала.", "ODI", "HELP_CALL_BUTTON"),
    "ZU-129": ("Вода, узел учета У1: счетчик воды.", "ZU", "WATER_METER"),
}


class PresenceFamilyCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.evidence = {
            "schemaVersion": "indexed-page-evidence-v1", "candidateStatus": "CANDIDATE",
            "manifestSha256": "a" * 64, "indexVersionHash": "1" * 20,
            "qualityPolicyVersion": "test", "sourceFileId": "F0001",
            "objectId": "OBJ-1", "stage": "PD", "section": "OTHER",
            "sourceSha256": "b" * 64, "sourceRelativePath": "plan.pdf",
            "pageNumber": 1, "pageArtifactSha256": "c" * 64,
            "parserProvenance": "pdfminer", "coordinateSystem": "PDF_POINTS_TOP_LEFT",
            "widthMilliPoints": 100000, "heightMilliPoints": 100000,
            "quality": {"disposition": "TEXT_LAYER_CANDIDATE"},
            "selectedBlockIndices": [0], "blocks": [], "lines": [],
            "sectionCandidates": [], "tableRowCandidates": [],
        }
        self._line(CASES["SPZU-039"][0])

    def _line(self, text: str) -> None:
        self.evidence["lines"] = [{
            "blockIndex": 0, "lineIndex": 2, "text": text,
            "bboxMilliPoints": [1000, 2000, 80000, 5000],
        }]
        self._sign()

    def _sign(self) -> None:
        self.evidence["evidenceSha256"] = _hash({
            key: value for key, value in self.evidence.items()
            if key != "evidenceSha256"
        })

    def _proof(self, drawing: str) -> dict:
        return {"status": "VERIFIED", "reference": "review:source-section",
                "sourceFileId": self.evidence["sourceFileId"],
                "sourceSha256": self.evidence["sourceSha256"],
                "manifestSha256": self.evidence["manifestSha256"],
                "stage": self.evidence["stage"],
                "manifestSection": self.evidence["section"],
                "drawingSection": drawing}

    def _extract(self, code: str, drawing: str, *,
                 resolution: dict | None = None,
                 drawing_proof: dict | None = None) -> list[dict]:
        with patch("inspector_worker.presence_family_candidates.load_indexed_page_evidence",
                   return_value=self.evidence) as load:
            result = extract_indexed_presence_family_candidates(
                self.root / "manifest.jsonl", self.root / "index",
                self.evidence["sourceFileId"], self.evidence["pageNumber"],
                expected_object_id="OBJ-1", expected_stage=self.evidence["stage"],
                expected_section=self.evidence["section"],
                block_indices=self.evidence["selectedBlockIndices"],
                parameter_code=code, drawing_section=drawing,
                section_resolution=resolution, drawing_section_proof=drawing_proof)
        load.assert_called_once()
        return result

    def test_policy_covers_exact_eight_catalog_pinned_codes(self) -> None:
        policy = load_presence_family_labels()
        rules = [rule for rule in load_candidate_family_pack()["rules"]
                 if rule["family"] == "PRESENCE_SET"]
        self.assertEqual(PRESENCE_CODES, set(CASES))
        self.assertEqual(PRESENCE_CODES, {rule["parameterCode"] for rule in rules})
        self.assertEqual(PRESENCE_CODES, {entry["parameterCode"]
                                          for entry in policy["entries"]})

    def test_exact_positive_path_for_all_eight_codes(self) -> None:
        policy = load_presence_family_labels()
        for code, (text, drawing, feature_key) in CASES.items():
            with self.subTest(code=code):
                rule = policy["rules"][code]
                self.evidence["section"] = (rule["requiredExpectedSections"][0]
                                            if rule["manifestSectionStatus"]["expected"] ==
                                            "EXACT_CATEGORY" else "OTHER")
                self._line(text)
                resolution = (self._proof(drawing)
                              if self.evidence["section"] == "OTHER" else None)
                found = self._extract(code, drawing, resolution=resolution)
                self.assertEqual(len(found), 1)
                item = found[0]
                self.assertEqual(item["featureKey"], feature_key)
                self.assertEqual(item["attribute"], rule["attributes"][0]["key"])
                self.assertEqual(item["lineText"], text)
                self.assertEqual(item["locator"], {
                    "blockIndex": 0, "lineIndex": 2,
                    "bboxMilliPoints": [1000, 2000, 80000, 5000],
                })
                self.assertEqual(item["sourceSha256"], "b" * 64)
                self.assertEqual(item["pageArtifactSha256"], "c" * 64)
                self.assertEqual(item["pageEvidenceSha256"], self.evidence["evidenceSha256"])
                self.assertEqual(item["candidateSha256"], _hash({
                    key: value for key, value in item.items() if key != "candidateSha256"
                }))
                self.assertEqual(item["executionPolicy"], "NON_EXECUTING_ABSTAIN")
                self.assertNotIn("finding", item)
                self.assertNotIn("coverage", item)
                self.assertNotIn("entityId", item)
                self.assertNotIn("completeSet", item)

    def test_negation_future_alternative_and_scope_ambiguity_abstain(self) -> None:
        bad_lines = [
            "Зона дренажа З1: открытый лоток отсутствует.",
            "Зона дренажа З1: нет открытого лотка.",
            "Зона дренажа З1: открытый лоток не предусмотрен.",
            "Зона дренажа З1: открытый лоток планируется.",
            "Зона дренажа З1: открытый лоток проектируется.",
            "Зона дренажа З1: вариант открытого лотка.",
            "Зона дренажа З1: открытый лоток требует установки.",
            "Зона дренажа З1: открытый лоток предусмотреть.",
            "Открытый лоток предусмотрен.",
            "Зона дренажа З1 и зона дренажа З2: открытый лоток.",
            "Зона дренажа: открытый лоток.",
            "Зона дренажа З1: псевдооткрытый лоток.",
        ]
        for line in bad_lines:
            with self.subTest(line=line):
                self._line(line)
                self.assertEqual(self._extract("SPZU-039", "SPZU",
                                               resolution=self._proof("SPZU")), [])

    def test_energy_carrier_must_match_meter_feature_and_be_unambiguous(self) -> None:
        for line in ("Тепло, узел учета У1: счетчик воды.",
                     "Вода и тепло, узел учета У1: счетчик воды.",
                     "Вода, узел учета У1 и узел учета У2: счетчик воды."):
            with self.subTest(line=line):
                self._line(line)
                self.assertEqual(self._extract("ZU-129", "ZU",
                                               resolution=self._proof("ZU")), [])

    def test_hyphenated_material_brand_is_not_absence(self) -> None:
        self.evidence["section"] = "AR"
        for line in (
            "Узел перегородки У1: звукоизоляционные прокладки Шума-нет 100.",
            "Узел перегородки У1: звукоизоляционные прокладки Шума- нет 100.",
        ):
            with self.subTest(line=line):
                self._line(line)
                found = self._extract("AR-053", "AR")
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]["featureKey"], "SOUND_INSULATION_GASKET")
        self._line("Узел перегородки У1: демпферной ленты нет.")
        self.assertEqual(self._extract("AR-053", "AR"), [])
        self._line("Узел перегородки У1: демпферная лента — нет.")
        self.assertEqual(self._extract("AR-053", "AR"), [])
        self._line("Узел перегородки У1: демпферная лента - нет.")
        self.assertEqual(self._extract("AR-053", "AR"), [])

    def test_public_layout_neighbors_do_not_supply_unbound_scope(self) -> None:
        # Literal lines and coordinates from F0151 p.37 and F0118 p.20.
        # The synthetic envelope tests the conservative association rule;
        # SHA-checked originals are documented in PRESENCE_FAMILY_CANDIDATES.
        cases = [
            ("ODI-123", "ODI", [
                (331, "Санузел для МГН", [1986880, 1562627, 2052098, 1574507]),
                (335, "— Кнопка вызова персонала",
                 [3001360, 1549849, 3137252, 1564518]),
            ]),
            ("ZU-129", "ZU", [
                (83, "Счетчик воды", [2967941, 1549237, 3021884, 1559237]),
                (87, "Квартира", [536571, 1514494, 575846, 1524494]),
                (89, "МОП", [794965, 1514494, 811056, 1524494]),
            ]),
        ]
        for code, drawing, items in cases:
            with self.subTest(code=code):
                self.evidence["section"] = "OTHER"
                self.evidence["selectedBlockIndices"] = [item[0] for item in items]
                self.evidence["lines"] = [
                    {"blockIndex": block, "lineIndex": 0, "text": text,
                     "bboxMilliPoints": bbox}
                    for block, text, bbox in items
                ]
                self.evidence["widthMilliPoints"] = 3370560
                self.evidence["heightMilliPoints"] = 2383920
                self._sign()
                self.assertEqual(self._extract(code, drawing,
                                                resolution=self._proof(drawing)), [])

    def test_bad_manifest_section_or_bound_section_proof_fails_closed(self) -> None:
        self.evidence["section"] = "KR"
        self._line(CASES["AR-053"][0])
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "manifest section"):
            self._extract("AR-053", "AR")
        self.evidence["section"] = "OTHER"
        self._sign()
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "resolution required"):
            self._extract("SPZU-039", "SPZU")
        proof = self._proof("SPZU")
        proof["sourceSha256"] = "f" * 64
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "resolution required"):
            self._extract("SPZU-039", "SPZU", resolution=proof)

    def test_stage_and_drawing_mark_proofs(self) -> None:
        self.evidence["stage"] = "RD"
        self.evidence["section"] = "AR"
        self._line(CASES["ODI-120"][0])
        self.assertEqual(len(self._extract("ODI-120", "AR")), 1)
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "drawing section"):
            self._extract("ODI-120", "GP")
        self.evidence["stage"] = "ID"
        self._sign()
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "stage"):
            self._extract("ODI-120", "AR")

    def test_page_evidence_sha_and_policy_tamper_rejected(self) -> None:
        self.evidence["sourceSha256"] = "f" * 64
        with self.assertRaisesRegex(PresenceFamilyCandidateError, "evidence SHA"):
            self._extract("SPZU-039", "SPZU", resolution=self._proof("SPZU"))
        copy_path = self.root / "tampered.json"
        policy = json.loads(LABEL_PACK_PATH.read_text(encoding="utf-8"))
        policy["entries"][0]["parameterCode"] = "PZ-002"
        copy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(PresenceFamilyCandidateError):
            load_presence_family_labels(copy_path)


if __name__ == "__main__":
    unittest.main()
