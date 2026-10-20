from __future__ import annotations

import unittest
from pathlib import Path

from inspector_worker.utility_unresolved_batch import (
    _checked_strategy, _family, _matches, _source_role,
)


ROOT = Path(__file__).resolve().parents[3]


class UtilityUnresolvedBatchTests(unittest.TestCase):
    def test_pinned_strategy_has_exactly_requested_21_design_only_codes(self) -> None:
        strategy = ROOT / "output/unresolved-parameter-strategy-20260927/report.json"
        if not strategy.is_file():
            self.skipTest(f"Verified public strategy report unavailable: {strategy}")
        _, report, codes = _checked_strategy(
            strategy,
            ROOT / "services/worker/rules/parameter_catalog_132.jsonl",
            ROOT / "services/worker/rules/parameter-family-registry-v1.json",
        )
        self.assertEqual(len(codes), 21)
        self.assertEqual({_family(code) for code in codes}, {"IOS1", "IOS5", "PPM", "ODI", "ZU"})
        self.assertTrue(all(item["sourceAvailability"]["verifiedComparablePair"] is False
                            for item in report["parameters"] if item["parameterCode"] in codes))

    def test_code_specific_phrases_avoid_broad_single_word_matches(self) -> None:
        self.assertTrue(_matches("IOS1-069", "Сечение жил распределительного кабеля"))
        self.assertFalse(_matches("IOS1-069", "Кабель уложен в лотке"))
        self.assertFalse(_matches("IOS1-069", "В местах пересечения кабелями конструкций"))
        self.assertTrue(_matches("PPM-111", "ОЗК при пересечении преграды"))
        self.assertFalse(_matches("PPM-111", "Клапан регулирования расхода"))
        self.assertTrue(_matches("ODI-119", "Универсальная кабина санузла"))
        self.assertFalse(_matches("ODI-119", "Кабина лифта"))
        self.assertTrue(_matches("ZU-130", "Светодиодный светильник"))
        self.assertFalse(_matches("ZU-130", "Светильник потолочный"))

    def test_source_role_uses_only_catalog_explicit_manifest_tags(self) -> None:
        entry = {"sourceAvailability": {"byStage": {
            "PD": {"catalogExplicitManifestTags": ["AR"]},
            "RD": {"catalogExplicitManifestTags": ["AR"]},
        }}}
        self.assertEqual(_source_role({"stage": "PD", "section": "AR"}, entry),
                         "PD_EXPLICIT_MANIFEST_TAG_CANDIDATE")
        self.assertEqual(_source_role({"stage": "RD", "section": "OTHER"}, entry),
                         "RD_SECTION_UNRESOLVED")
        self.assertEqual(_source_role({"stage": "RD_ID_MIXED", "section": "AR"}, entry),
                         "MIXED_STAGE_UNRESOLVED")
        self.assertEqual(_source_role({"stage": "ID", "section": "OTHER"}, entry),
                         "OTHER_STAGE")


if __name__ == "__main__":
    unittest.main()
