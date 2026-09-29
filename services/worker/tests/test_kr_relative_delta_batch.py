from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.kr_relative_delta_batch import (
    DEFAULT_KR067_TERMS, KrRelativeDeltaBatchError,
    evaluate_kr_relative_delta_batch,
)
from inspector_worker.public_document_index import build_public_index, get_indexed_page


ROOT = Path(__file__).resolve().parents[3]
AUDIT_SCRIPT = ROOT / "scripts" / "audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_document_index_audit_for_kr067", AUDIT_SCRIPT)
assert SPEC and SPEC.loader
AUDIT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT_MODULE)

CONCRETE = "Корпус 1, общий объем бетона: 1 250,5 м³"
STEEL = "Корпус 1, общая масса стали: 20,2 т"
FALSE_POSITIVE = "Корпус 1, объем бетона: 900 м³"
SOURCES = ("F0105", "F0106", "F0140")
EXPECTED = {"sourceCount": 4, "pdfSources": 3, "pdfPages": 6, "txtInventorySources": 1}
TABLE = [((100, 100), "Сводная ведомость расхода бетона, м3."),
         ((180, 250), "ИТОГО:"), ((265, 250), "432")]


def _cyrillic_font_path() -> Path | None:
    preferred = [Path(os.environ["INSPECTOR_TEST_CYRILLIC_FONT"])] if os.environ.get("INSPECTOR_TEST_CYRILLIC_FONT") else []
    for directory in (Path("/usr/share/fonts"), Path("/usr/local/share/fonts")):
        if directory.is_dir():
            preferred.extend(sorted(directory.rglob("*.ttf")))
            preferred.extend(sorted(directory.rglob("*.otf")))
    required = {ord(char) for char in CONCRETE + STEEL + FALSE_POSITIVE if ord(char) > 127}
    for candidate in preferred:
        if candidate.is_file():
            try:
                font = fitz.Font(fontfile=str(candidate))
                if all(font.has_glyph(codepoint) for codepoint in required):
                    return candidate
            except (RuntimeError, ValueError):
                continue
    return None


@requires_posix_storage
class KrRelativeDeltaBatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.font = _cyrillic_font_path()
        if self.font is None:
            self.skipTest("No installed Cyrillic font for PDF index integration test")
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        materials = self.root / "materials"
        materials.mkdir()
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit_path = self.root / "audit.json"
        self.rows = [self._pdf(materials, "F0105", "PD", [CONCRETE, FALSE_POSITIVE]),
                     self._pdf(materials, "F0106", "PD", [STEEL]),
                     self._pdf(materials, "F0140", "RD", [CONCRETE, STEEL, TABLE])]
        inventory = materials / "inventory.txt"
        inventory.write_text("Private answer text must not be read", encoding="utf-8")
        self.rows.append({
            "file_id": "F0194", "object_id": "OBJ-1", "stage": "OTHER",
            "section": "OTHER", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "relative_path": inventory.name, "extension": ".txt",
            "size_bytes": inventory.stat().st_size,
            "sha256": hashlib.sha256(inventory.read_bytes()).hexdigest(),
            "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX",
        })
        self._write_manifest()
        summary = build_public_index(self.manifest, self.index, materials_root=materials)
        self.assertEqual(summary["completeSources"], 3)
        audit = AUDIT_MODULE.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(audit["status"], "PASS")
        self.audit_path.write_text(json.dumps(audit, ensure_ascii=False), encoding="utf-8")

    def _pdf(self, materials: Path, source_id: str, stage: str,
             lines: list[str | list[tuple[tuple[int, int], str]]]) -> dict:
        path = materials / f"{source_id}.pdf"
        document = fitz.open()
        for value in lines:
            page = document.new_page()
            page.insert_font(fontname="TestCyrillic", fontfile=str(self.font))
            cells = value if isinstance(value, list) else [((40, 90), value)]
            for point, text in cells:
                page.insert_text(point, text, fontname="TestCyrillic", fontsize=10)
        document.save(path)
        document.close()
        return {
            "file_id": source_id, "object_id": "OBJ-1", "stage": stage,
            "section": "KR", "split": "TRAIN_PUBLIC",
            "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
            "relative_path": path.name, "extension": ".pdf",
            "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "pdf_pages": len(lines), "annotation_status": "UNLABELED",
        }

    def _write_manifest(self) -> None:
        self.manifest.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n"
                                         for row in self.rows), encoding="utf-8")

    def _evaluate(self, **kwargs: object) -> dict:
        return evaluate_kr_relative_delta_batch(
            self.manifest, self.index, self.audit_path,
            source_ids=SOURCES, terms=DEFAULT_KR067_TERMS,
            _expected_counts=EXPECTED, **kwargs,
        )

    def test_audited_real_index_reports_atomic_facts_by_source_and_stage(self) -> None:
        report = self._evaluate()
        self.assertEqual(report["schemaVersion"], "kr-relative-delta-public-batch-v1")
        self.assertEqual(report["parameterCode"], "KR-067")
        self.assertEqual(report["purpose"], "REVIEW_ONLY")
        self.assertEqual(report["auditExpected"], EXPECTED)
        self.assertEqual(report["auditActual"]["indexedPages"], 6)
        self.assertEqual(report["sourceFileIds"], list(SOURCES))
        self.assertEqual(report["attributeCounts"]["CONCRETE_VOLUME"],
                         {"candidatePages": 2, "abstainPages": 4})
        self.assertEqual(report["attributeCounts"]["STEEL_MASS"],
                         {"candidatePages": 2, "abstainPages": 4})
        self.assertEqual(report["tableObservationCounts"],
                         {"CONCRETE_VOLUME": 1, "STEEL_MASS": 0})
        stages = {row["stage"]: row for row in report["stageReports"]}
        self.assertEqual(stages["PD"]["attributes"]["CONCRETE_VOLUME"]["candidatePages"], 1)
        self.assertEqual(stages["RD"]["attributes"]["STEEL_MASS"]["candidatePages"], 1)
        self.assertEqual(stages["RD"]["tableObservationCounts"]["CONCRETE_VOLUME"], 1)
        source = next(row for row in report["sourceReports"] if row["sourceFileId"] == "F0105")
        self.assertEqual(source["attributes"]["CONCRETE_VOLUME"],
                         {"candidatePages": 1, "abstainPages": 1})
        page = next(row for row in source["pages"] if row["results"]["CONCRETE_VOLUME"]["facts"])
        fact, = page["results"]["CONCRETE_VOLUME"]["facts"]
        self.assertEqual(fact["sourceSha256"], source["sourceSha256"])
        self.assertEqual(page["evidenceSha256"], fact["indexProvenance"]["evidenceSha256"])
        self.assertEqual(page["pageArtifactSha256"], fact["indexProvenance"]["pageArtifactSha256"])
        self.assertEqual(fact["rawText"][fact["locator"]["start"]:fact["locator"]["end"]],
                         fact["rawValue"])
        self.assertIsNone(report["findingCount"])
        self.assertIsNone(report["parameterCoverage"])
        self.assertFalse(report["truncated"]["textPages"])
        table_page = next(page for row in report["sourceReports"] for page in row["pages"]
                          if page["tableObservations"])
        table_observation, = table_page["tableObservations"]
        self.assertEqual(table_observation["rawValue"], "432")
        self.assertEqual(table_observation["structureScopeStatus"], "UNVERIFIED")
        self.assertNotIn("factId", table_observation)

    def test_page_limit_is_visible_and_never_means_absence(self) -> None:
        report = self._evaluate(max_pages=2)
        self.assertTrue(report["truncated"]["textPages"])
        self.assertEqual(sum(row["selectedTextPages"] for row in report["sourceReports"]), 2)
        self.assertGreater(sum(row["omittedTextPages"] for row in report["sourceReports"]), 0)
        self.assertIsNone(report["parameterCoverage"])

    def test_invalid_geometry_abstains_on_one_page_and_continues_batch(self) -> None:
        def with_zero_area_line(index_root: Path, source_id: str, page_number: int) -> dict:
            indexed = get_indexed_page(index_root, source_id, page_number)
            if (source_id, page_number) != ("F0140", 3):
                return indexed
            indexed = copy.deepcopy(indexed)
            indexed["page"]["lines"].append({
                "blockIndex": 0, "lineIndex": 99, "text": "2800",
                "bboxMilliPoints": [734521, 1514401, 734521, 1514401],
            })
            return indexed

        with patch("inspector_worker.kr_relative_delta_batch.get_indexed_page",
                   side_effect=with_zero_area_line):
            report = self._evaluate()
        table_source = next(row for row in report["sourceReports"] if row["sourceFileId"] == "F0140")
        table_page = next(page for page in table_source["pages"] if page["pageNumber"] == 3)
        self.assertEqual(table_page["tableGeometryScanStatus"], "ABSTAIN_INVALID_GEOMETRY")
        self.assertEqual(table_page["tableObservations"], [])
        first = next(row for row in report["sourceReports"] if row["sourceFileId"] == "F0105")
        self.assertEqual(first["attributes"]["CONCRETE_VOLUME"]["candidatePages"], 1)
        self.assertEqual(report["attributeCounts"]["CONCRETE_VOLUME"],
                         {"candidatePages": 2, "abstainPages": 4})
        self.assertEqual(report["tableObservationCounts"],
                         {"CONCRETE_VOLUME": 0, "STEEL_MASS": 0})

    def test_audit_status_hash_inventory_and_fts_completeness_gate(self) -> None:
        original = json.loads(self.audit_path.read_text(encoding="utf-8"))
        for change in ({"status": "FAIL"}, {"manifestSha256": "0" * 64},
                       {"indexVersionHash": "0" * 20},
                       {"actual": {**original["actual"], "ftsRows": 4}},
                       {"findingsTruncated": 1}):
            with self.subTest(change=list(change)):
                self.audit_path.write_text(json.dumps(original | change), encoding="utf-8")
                with self.assertRaises(KrRelativeDeltaBatchError):
                    self._evaluate()
        self.audit_path.write_text(json.dumps(original), encoding="utf-8")

    def test_manifest_change_or_ground_truth_source_rejected(self) -> None:
        with self.assertRaisesRegex(KrRelativeDeltaBatchError, "public PDF"):
            evaluate_kr_relative_delta_batch(
                self.manifest, self.index, self.audit_path,
                source_ids=["F0194"], terms=DEFAULT_KR067_TERMS,
                _expected_counts=EXPECTED,
            )
        self.rows[0]["object_id"] = "OTHER-OBJECT"
        self._write_manifest()
        with self.assertRaisesRegex(KrRelativeDeltaBatchError, "manifest SHA"):
            self._evaluate()

    def test_cli_cannot_reduce_required_203_document_inventory(self) -> None:
        output = self.root / "must-not-write.json"
        completed = subprocess.run([
            sys.executable, str(ROOT / "scripts" / "evaluate-public-kr-relative-delta-batch.py"),
            "--manifest", str(self.manifest), "--index", str(self.index),
            "--audit", str(self.audit_path), "--source-id", "F0105",
            "--term", "бетон*", "--output", str(output),
        ], capture_output=True, text=True, check=False)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("FAILED", completed.stderr)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
