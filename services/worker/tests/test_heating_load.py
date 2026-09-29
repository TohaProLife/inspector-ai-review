"""PZ-017 facts remain proposals until source and scope gates are proven."""

from __future__ import annotations

import copy

import unittest

from inspector_worker.heating_load import (
    compare_heat_load_components,
    extract_heat_load_lines,
    extract_heat_load_table,
)


SHA = "a" * 64


def cell(text: str, *, source: str = "FIL-PD", page: int = 23,
         block: int = 0, line: int = 0) -> dict:
    return {
        "sourceFileId": source,
        "inputSha256": SHA,
        "pageNumber": page,
        "blockIndex": block,
        "lineIndex": line,
        "text": text,
    }


def table(*, stage: str = "PD", values: tuple[str, ...] =
          ("0,335", "0,926", "0,000", "0,120"), source: str = "FIL-PD") -> list[dict]:
    heading = cell("Тепловой поток, Гкал/ч", source=source, line=0)
    labels = ("на отопление", "на вентиляцию", "на тепло-завесы", "на ГВС")
    columns = [
        {"header": cell(label, source=source, line=1 + index),
         "value": cell(value, source=source, line=5 + index)}
        for index, (label, value) in enumerate(zip(labels, values))
    ]
    columns.append({
        "header": cell("Общий", source=source, line=9),
        "value": cell("1,381", source=source, line=10),
    })
    return extract_heat_load_table(heading, columns, stage=stage, entity_key="building:school")


class HeatingLoadTests(unittest.TestCase):
    def test_thermal_table_extracts_four_components_with_exact_cell_provenance(self) -> None:
        facts = table()
        assert [fact["component"] for fact in facts] == [
            "HEATING", "VENTILATION", "CURTAINS", "DHW",
        ]
        assert facts[0]["rawValue"] == "0,335"
        assert facts[0]["normalizedValue"] == "0.335"
        assert facts[0]["canonicalUnit"] == "Gcal/h"
        assert [(item["role"], item["text"], item["pageNumber"], item["blockIndex"], item["lineIndex"])
                for item in facts[0]["evidence"]] == [
            ("thermalHeading", "Тепловой поток, Гкал/ч", 23, 0, 0),
            ("componentHeader", "на отопление", 23, 0, 1),
            ("valueCell", "0,335", 23, 0, 5),
        ]
        assert all(fact["component"] != "TOTAL" for fact in facts)


    def test_inline_requires_thermal_context_and_rejects_electrical_load(self) -> None:
        facts = extract_heat_load_lines([
            cell("Тепловая нагрузка на отопление — 1 250,5 кВт", line=0),
            cell("Тепловой поток на вентиляцию: 0,926 Гкал/ч", line=1),
            cell("Тепловая нагрузка на ГВС - 1,2 МВт", line=2),
            cell("на отопление — 1250,5 кВт", line=3),
            cell("Электрическая тепловая нагрузка на вентиляцию — 100 кВт", line=4),
            cell("на электрические воздушно-тепловые завесы — 66,0 кВт", line=5),
        ], stage="PD", entity_key="building:school")
        assert [(fact["component"], fact["normalizedValue"], fact["canonicalUnit"])
                for fact in facts] == [
            ("HEATING", "1250.5", "kW"),
            ("VENTILATION", "0.926", "Gcal/h"),
            ("DHW", "1200.0", "kW"),
        ]
        assert facts[0]["evidence"][0]["text"] == "Тепловая нагрузка на отопление — 1 250,5 кВт"


    def test_table_skips_missing_or_ambiguous_value_without_making_zero(self) -> None:
        heading = cell("Тепловой поток, Гкал/ч")
        facts = extract_heat_load_table(heading, [
            {"header": cell("на отопление", line=1), "value": cell("—", line=2)},
            {"header": cell("на вентиляцию", line=3), "value": cell("0,3 / 0,4", line=4)},
            {"header": cell("на ГВС", line=5), "value": cell("0,120", line=6)},
        ], stage="RD", entity_key="building:school")
        assert [(fact["component"], fact["rawValue"]) for fact in facts] == [("DHW", "0,120")]


    def test_pd_tep_header_with_q_and_hour_alias_is_accepted(self) -> None:
        facts = extract_heat_load_table(cell("Тепловая нагрузка Q, Гкал/час"), [
            {"header": cell("Отопление", line=1), "value": cell("0,331", line=4)},
            {"header": cell("Вентиляция", line=2), "value": cell("0,927", line=5)},
            {"header": cell("ГВС", line=3), "value": cell("0,108", line=6)},
        ], stage="PD", entity_key="building:school")
        assert [(fact["component"], fact["normalizedValue"], fact["canonicalUnit"])
                for fact in facts] == [
            ("HEATING", "0.331", "Gcal/h"),
            ("VENTILATION", "0.927", "Gcal/h"),
            ("DHW", "0.108", "Gcal/h"),
        ]


    def test_table_rejects_nonthermal_header_and_cross_page_cell(self) -> None:
        assert extract_heat_load_table(
            cell("Расход электроэнергии, кВт"), [
                {"header": cell("на отопление"), "value": cell("100")},
            ], stage="RD", entity_key="building:school",
        ) == []
        with self.assertRaisesRegex(ValueError, "share source and page"):
            extract_heat_load_table(
                cell("Тепловой поток, Гкал/ч"), [
                    {"header": cell("на отопление"), "value": cell("0,335", page=24)},
                ], stage="RD", entity_key="building:school",
            )


    def test_compare_matching_components_only_never_computes_total_or_finding(self) -> None:
        pd = table()
        rd = table(stage="RD", source="FIL-RD", values=("0,335", "0,926", "0,000", "0,100"))
        result = compare_heat_load_components(pd, rd)
        assert result["disposition"] == "COMPONENTS_COMPARABLE"
        assert result["totalComparable"] is False
        assert result["finding"] is None
        assert result["componentBasis"] == ["CURTAINS", "DHW", "HEATING", "VENTILATION"]
        assert next(item for item in result["comparisons"] if item["component"] == "DHW")["delta"] == "-0.020"


    def test_compare_abstains_if_component_composition_differs(self) -> None:
        pd = table()
        rd = [fact for fact in table(stage="RD", source="FIL-RD") if fact["component"] != "DHW"]
        result = compare_heat_load_components(pd, rd)
        assert result["disposition"] == "ABSTAIN"
        assert result["reasonCode"] == "COMPONENT_BASIS_MISMATCH"
        assert result["pdComponents"] == ["CURTAINS", "DHW", "HEATING", "VENTILATION"]
        assert result["rdComponents"] == ["CURTAINS", "HEATING", "VENTILATION"]
        assert result["finding"] is None


    def test_public_school_table_shape_does_not_compare_reported_total(self) -> None:
        # Shapes and numbers observed in TRAIN_PUBLIC F0150 p23 and F0201 p14.
        # Locators below are synthetic: this test does not verify PDF geometry.
        pd = [fact for fact in table(values=("0,331", "0,927", "0,000", "0,108"))
              if fact["component"] != "CURTAINS"]
        rd = [fact for fact in table(stage="RD", source="FIL-RD",
                                      values=("0,335", "0,926", "0,000", "0,000"))
              if fact["component"] in {"HEATING", "VENTILATION"}]
        result = compare_heat_load_components(pd, rd)
        assert result["disposition"] == "ABSTAIN"
        assert result["reasonCode"] == "COMPONENT_BASIS_MISMATCH"
        assert result["pdComponents"] == ["DHW", "HEATING", "VENTILATION"]
        assert result["rdComponents"] == ["HEATING", "VENTILATION"]
        assert result["totalComparable"] is False


    def test_compare_abstains_on_duplicate_entity_and_unit_basis(self) -> None:
        pd = table()
        rd = table(stage="RD", source="FIL-RD")
        assert compare_heat_load_components(pd + [copy.deepcopy(pd[0])], rd)["reasonCode"] == "DUPLICATE_COMPONENT"
        rd[0]["entityKey"] = "building:other"
        assert compare_heat_load_components(pd, rd)["reasonCode"] == "ENTITY_BASIS_MISMATCH"
        rd[0]["entityKey"] = "building:school"
        kw_heating = extract_heat_load_lines(
            [cell("Тепловая нагрузка на отопление — 389,6 кВт", source="FIL-RD")],
            stage="RD", entity_key="building:school",
        )[0]
        assert compare_heat_load_components(pd, [kw_heating, *rd[1:]])["reasonCode"] == "UNIT_BASIS_MISMATCH"


    def test_compare_rejects_value_changed_after_extraction(self) -> None:
        pd = table()
        rd = table(stage="RD", source="FIL-RD")
        rd[0]["normalizedValue"] = "1000000"
        with self.assertRaisesRegex(ValueError, "differs from its raw evidence"):
            compare_heat_load_components(pd, rd)


    def test_invalid_locator_does_not_become_a_fact(self) -> None:
        invalid = cell("Тепловая нагрузка на отопление — 1 кВт")
        invalid["inputSha256"] = "bad"
        with self.assertRaisesRegex(ValueError, "requires source hash"):
            extract_heat_load_lines([invalid], stage="PD", entity_key="building:school")
