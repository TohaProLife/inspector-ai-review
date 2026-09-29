from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from platform_test_support import requires_posix_storage
from pathlib import Path
from unittest.mock import patch

import fitz

from inspector_worker.numeric_family_candidates import LABEL_PACK_PATH
from inspector_worker.numeric_label_probe import (
    NumericLabelProbeError, probe_public_numeric_labels,
)
from inspector_worker.public_document_index import build_public_index, get_indexed_page


SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "audit-public-document-index.py"
SPEC = importlib.util.spec_from_file_location("public_document_index_audit_for_numeric_probe", SCRIPT)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


@requires_posix_storage
class NumericLabelProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.materials = self.root / "materials"
        self.materials.mkdir()
        self.pdf = self.materials / "plan.pdf"
        self.txt = self.materials / "answers.txt"
        self.txt.write_text("Wall thickness: 999 mm; hidden answer body")
        self.manifest = self.root / "manifest.jsonl"
        self.index = self.root / "index"
        self.audit_path = self.root / "audit.json"
        self.labels_path = self.root / "labels.json"
        labels = json.loads(LABEL_PACK_PATH.read_text())
        kr = next(item for item in labels["entries"] if item["parameterCode"] == "KR-061")
        kr["attributes"][0]["labels"] = ["Wall thickness"]
        kr["attributes"][0]["unitAliases"] = ["mm"]
        self.labels_path.write_text(json.dumps(labels))

    def _build(self, lines: list[str], *, blank_second_page: bool = True) -> None:
        document = fitz.open()
        page = document.new_page()
        for number, text in enumerate(lines):
            page.insert_text((70, 70 + number * 25), text)
        if blank_second_page:
            document.new_page()
        document.save(self.pdf)
        document.close()
        pdf_pages = 2 if blank_second_page else 1
        rows = [
            {"file_id": "F0001", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
             "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "label_visibility": "PUBLIC_TRAIN", "relative_path": "plan.pdf",
             "extension": ".pdf", "size_bytes": self.pdf.stat().st_size,
             "sha256": hashlib.sha256(self.pdf.read_bytes()).hexdigest(),
             "pdf_pages": pdf_pages, "annotation_status": "UNLABELED"},
            {"file_id": "F0194", "object_id": "OBJ-1", "stage": "PD", "section": "KR",
             "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
             "label_visibility": "PUBLIC_TRAIN", "relative_path": "answers.txt",
             "extension": ".txt", "size_bytes": self.txt.stat().st_size,
             "sha256": hashlib.sha256(self.txt.read_bytes()).hexdigest(),
             "pdf_pages": None, "annotation_status": "GROUND_TRUTH_INDEX"},
        ]
        self.manifest.write_text("".join(json.dumps(row) + "\n" for row in rows))
        built = build_public_index(self.manifest, self.index, materials_root=self.materials)
        self.assertEqual(built["failedSources"], [])
        audit = AUDIT.audit_public_document_index(self.manifest, self.index)
        self.assertEqual(audit["status"], "PASS")
        self.audit_path.write_text(json.dumps(audit))

    def _probe(self, *, limit: int = 20,
               selected_pages: list[tuple[str, int]] | None = None) -> dict:
        pages = len(fitz.open(self.pdf))
        return probe_public_numeric_labels(
            self.manifest, self.index, self.audit_path,
            label_pack_path=self.labels_path,
            required_inventory=(2, 1, pages), max_examples_per_code=limit,
            selected_pages=selected_pages)

    def test_full_page_census_skips_txt_body_and_counts_ocr(self) -> None:
        self._build(["Wall thickness: 220 mm", "Wall thickness: 22 cm",
                     "Wall thickness is specified in chapter 13",
                     "Other material 310 mm", "Drawing specification text"])
        self.txt.unlink()  # Ground-truth TXT body is not needed or read.
        result = self._probe()
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["inventory"]["sourceCount"], 2)
        self.assertEqual(result["inventory"]["pdfSources"], 1)
        self.assertEqual(result["inventory"]["pdfPages"], 2)
        self.assertEqual(result["inventory"]["ocrRequiredPages"], 1)
        self.assertEqual(result["codes"]["KR-061"]["exactLineMatches"], 1)
        self.assertEqual(result["codes"]["KR-061"]["nonExactNumericLines"], 1)
        example = result["codes"]["KR-061"]["examples"][0]
        self.assertEqual(example["sourceFileId"], "F0001")
        self.assertEqual(example["pageNumber"], 1)
        self.assertRegex(example["pageArtifactSha256"], r"^[a-f0-9]{64}$")
        self.assertIsNone(result["findingCount"])
        self.assertIsNone(result["parameterCoverage"])

    def test_ambiguous_exact_lines_and_bounded_examples(self) -> None:
        self._build(["Wall thickness: 220 mm", "Wall thickness: 240 mm",
                     "Wall thickness 22 cm", "Wall thickness: 220 mm, 240 mm"])
        result = self._probe(limit=1)
        code = result["codes"]["KR-061"]
        self.assertEqual(code["exactLineMatches"], 2)
        self.assertEqual(code["matchedPages"], 1)
        self.assertEqual(code["ambiguousAttributePages"], 1)
        self.assertEqual(code["nonExactNumericLines"], 2)
        self.assertEqual(len(code["examples"]), 1)
        self.assertEqual(code["examplesTruncated"], 3)
        self.assertTrue(code["examples"][0]["ambiguousSameAttributeOnPage"])

    def test_incomplete_or_stale_audit_receipt_rejected(self) -> None:
        self._build(["Wall thickness: 220 mm", "Other line 11 mm",
                     "Section reference 12 mm", "Drawing specification text"])
        receipt = json.loads(self.audit_path.read_text())
        for mutation in (lambda report: report.update(status="INCOMPLETE"),
                         lambda report: report.update(manifestSha256="0" * 64),
                         lambda report: report["actual"].update(verifiedPageArtifacts=1),
                         lambda report: report["sources"].pop()):
            changed = json.loads(json.dumps(receipt))
            mutation(changed)
            self.audit_path.write_text(json.dumps(changed))
            with self.assertRaises(NumericLabelProbeError):
                self._probe()
        self.audit_path.write_text(json.dumps(receipt))
        self.assertEqual(self._probe()["status"], "COMPLETE")

    def test_page_artifact_modified_after_pass_audit_rejected(self) -> None:
        self._build(["Wall thickness: 220 mm", "Other line 11 mm",
                     "Section reference 12 mm", "Drawing specification text"])
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            relative, = connection.execute(
                "SELECT artifact_path FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        artifact = self.index / relative
        page = json.loads(gzip.decompress(artifact.read_bytes()))
        page["lines"][0]["text"] = "Wall thickness: 999 mm"
        artifact.write_bytes(gzip.compress(json.dumps(page).encode()))
        with self.assertRaisesRegex(NumericLabelProbeError, "artifact/FTS verification failed"):
            self._probe()

    def test_standard_inventory_gate_rejects_fixture_scale(self) -> None:
        self._build(["Wall thickness: 220 mm", "Other line 11 mm",
                     "Section reference 12 mm", "Drawing specification text"])
        with self.assertRaisesRegex(NumericLabelProbeError, "required corpus"):
            probe_public_numeric_labels(self.manifest, self.index, self.audit_path,
                                        label_pack_path=self.labels_path)

    def test_targeted_scan_is_explicit_and_does_not_claim_full_corpus(self) -> None:
        self._build(["Wall thickness: 220 mm", "Other line 11 mm",
                     "Section reference 12 mm", "Drawing specification text"])
        report = self._probe(selected_pages=[("F0001", 1)])
        self.assertEqual(report["purpose"], "TARGETED_ALIAS_VALIDATION_ONLY")
        self.assertEqual(report["inventory"]["pdfPages"], 2)
        self.assertEqual(report["inventory"]["scannedPages"], 1)
        self.assertEqual(report["inventory"]["ocrRequiredPages"], 0)
        self.assertEqual(report["selectedPages"], [{"sourceFileId": "F0001", "pageNumber": 1}])
        for bad in ([('F0194', 1)], [('F0001', 3)], [('F0001', 1), ('F0001', 1)]):
            with self.assertRaisesRegex(NumericLabelProbeError, "page addresses"):
                self._probe(selected_pages=bad)

    def test_targeted_alias_sample_requires_actual_page_sha_and_line(self) -> None:
        self._build(["Area: 220 m2", "Other line 11 mm",
                     "Section reference 12 mm", "Drawing specification text"])
        policy = json.loads(self.labels_path.read_text())
        pz = next(item for item in policy["entries"] if item["parameterCode"] == "PZ-002")
        pz["attributes"][0]["labels"].append("Area")
        pz["attributes"][0]["unitAliases"].append("m2")
        indexed = get_indexed_page(self.index, "F0001", 1)
        line = next(line for line in indexed["page"]["lines"] if line["text"] == "Area: 220 m2")
        with sqlite3.connect(self.index / "index.sqlite3") as connection:
            artifact_sha, = connection.execute(
                "SELECT artifact_sha256 FROM pages WHERE source_id='F0001' AND page_number=1").fetchone()
        source = json.loads(self.manifest.read_text().splitlines()[0])
        sample = {"sourceFileId": "F0001", "sourceSha256": source["sha256"],
                  "stage": "PD", "manifestSection": "KR", "pageNumber": 1,
                  "blockIndex": line["blockIndex"], "lineIndex": line["lineIndex"],
                  "pageArtifactSha256": artifact_sha, "lineText": line["text"],
                  "lineTextSha256": hashlib.sha256(line["text"].encode()).hexdigest(),
                  "sourceGate": "SECTION_UNRESOLVED"}
        policy["verifiedAliasEvidence"] = [{"parameterCode": "PZ-002",
                                             "attribute": "BUILDING_TOTAL_AREA",
                                             "label": "Area", "unitAlias": "m2",
                                             "samples": [sample]}]
        policy["publicManifestSha256"] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.labels_path.write_text(json.dumps(policy))
        report = self._probe(selected_pages=[("F0001", 1)])
        self.assertEqual(report["totals"]["verifiedAliasSamples"], 1)
        self.assertEqual(report["codes"]["PZ-002"]["exactLineMatches"], 1)
        policy["verifiedAliasEvidence"][0]["samples"][0]["pageArtifactSha256"] = "0" * 64
        self.labels_path.write_text(json.dumps(policy))
        with self.assertRaisesRegex(NumericLabelProbeError, "source or page SHA differs"):
            self._probe(selected_pages=[("F0001", 1)])

    def test_longer_exact_alias_is_not_counted_again_as_near_miss(self) -> None:
        self._build(["Wall thickness S=220 mm"])
        policy = json.loads(self.labels_path.read_text())
        kr = next(item for item in policy["entries"] if item["parameterCode"] == "KR-061")
        kr["attributes"][0]["labels"].append("Wall thickness S")
        self.labels_path.write_text(json.dumps(policy))
        report = self._probe(selected_pages=[("F0001", 1)])
        self.assertEqual(report["codes"]["KR-061"]["exactLineMatches"], 1)
        self.assertEqual(report["codes"]["KR-061"]["nonExactNumericLines"], 0)

    def test_read_only_sqlite_uses_immutable_uri(self) -> None:
        self._build(["Wall thickness: 220 mm"])
        original_connect = sqlite3.connect
        seen_immutable = []

        def guarded_connect(database, *args, **kwargs):
            if str(database).startswith("file:") and "index.sqlite3" in str(database):
                self.assertIn("mode=ro", str(database))
                self.assertIn("immutable=1", str(database))
                seen_immutable.append(str(database))
            return original_connect(database, *args, **kwargs)

        with patch("sqlite3.connect", side_effect=guarded_connect):
            self.assertEqual(self._probe(selected_pages=[("F0001", 1)])["status"], "COMPLETE")
        self.assertGreaterEqual(len(seen_immutable), 2)


if __name__ == "__main__":
    unittest.main()
