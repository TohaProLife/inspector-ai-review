"""Fail-closed tests for fixed-source KR-055 observations."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from pdf_test_font import cyrillic_font

from inspector_worker import kr055_concrete_observations as probe
from inspector_worker.ocr_pilot import canonical_hash


def _insert(page: fitz.Page, point: tuple[int, int], value: str) -> None:
    page.insert_font(fontname="ru", fontfile=cyrillic_font())
    page.insert_text(point, value, fontname="ru")


class Kr055ConcreteObservationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "document_manifest.jsonl"
        self.paths = {file_id: self.root / f"{file_id}.pdf" for file_id in probe.SOURCES}
        self.page_text = {
            "F0106": {
                49: [((100, 100), "Корпус К1 (предварительно)"),
                     ((120, 130), "· фундаментная плита"), ((500, 130), "B40;"),
                     ((120, 150), "· пилоны, колонны, стены -3 по +1"), ((500, 150), "В60;"),
                     ((100, 300), "Корпус К2"),
                     ((120, 330), "· фундаментная плита"), ((500, 330), "B40;"),
                     ((120, 350), "· пилоны, колонны, стены -3 по +2"), ((500, 350), "В60;")],
                50: [((100, 100), "Подземная часть"),
                     ((120, 130), "· фундаментная плита"), ((500, 130), "B40;"),
                     ((120, 150), "· пилоны, колонны -3 по +1"), ((500, 150), "В60;"),
                     ((120, 170), "· стены -3го по +1"), ((500, 170), "В60;"),
                     ((100, 220), "Лестницы, лестничные площадки всех корпусов В30.")],
            },
            "F0139": {4: [((100, 100), "Класс бетона по прочности для лестничных маршей и площадок - В30, F150, W6, П4")]},
            "F0140": {27: [((1900, 50), "Спецификация материалов на ж/б фундаментную плиту на отм. -13.750 (окончание)"),
                            ((2100, 300), "B40,F150,W6, м3")]},
            "F0141": {4: [((100, 100), "Класс бетона по прочности на сжатие для стен В60")]},
        }
        self._write_pdfs()
        self._write_manifest()

    def _write_pdfs(self) -> None:
        for file_id, (_, count, _) in probe.SOURCES.items():
            document = fitz.open()
            for _ in range(count):
                document.new_page(width=2600, height=1700)
            for number, entries in self.page_text[file_id].items():
                for point, value in entries:
                    _insert(document[number - 1], point, value)
            document.save(self.paths[file_id])
            document.close()

    def _write_manifest(self) -> None:
        self.rows = {}
        for file_id, (stage, pages, _) in probe.SOURCES.items():
            path = self.paths[file_id]
            self.rows[file_id] = {
                "file_id": file_id, "object_id": "OBJ-PUBLIC", "split": "TRAIN_PUBLIC",
                "distribution_status": "INCLUDE", "label_visibility": "PUBLIC_TRAIN",
                "extension": ".pdf", "stage": stage, "section": "KR",
                "relative_path": f"{file_id}.pdf", "pdf_pages": pages,
                "size_bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        self.manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False)
                                           for row in self.rows.values()) + "\n", encoding="utf-8")

    def _build(self, *, repin: bool = True):
        pins = {file_id: (stage, pages, self.rows[file_id]["sha256"] if repin else actual_sha)
                for file_id, (stage, pages, actual_sha) in probe.SOURCES.items()}
        with patch.dict(probe.SOURCES, pins, clear=True):
            return probe.build_public_observation_slice(self.manifest, self.paths)

    def test_typed_observations_abstain_without_comparison(self) -> None:
        result = self._build()
        self.assertEqual(result["evaluation"]["machineStatus"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["evaluation"]["comparisonDisposition"], "ABSTAIN")
        self.assertEqual(result["evaluation"]["comparableFacts"], [])
        self.assertIsNone(result["finding"])
        self.assertEqual(len(result["observations"]), 11)
        self.assertEqual({row["value"] for row in result["observations"]}, {"B30", "B40", "B60"})
        for row in result["observations"]:
            self.assertEqual(row["sourceSha256"], self.rows[row["sourceFileId"]]["sha256"])
            self.assertEqual(len(row["bboxPt"]), 4)
            self.assertEqual(row["crossStageElementLink"], "UNRESOLVED")
        self.assertEqual(result["contentHash"], canonical_hash({
            key: value for key, value in result.items() if key != "contentHash"}))

    def test_forged_source_or_hidden_manifest_rejected(self) -> None:
        self.rows["F0106"]["split"] = "TEST_HIDDEN"
        self.manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False)
                                           for row in self.rows.values()) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "public KR PDF"):
            self._build()
        self._write_manifest()
        with self.paths["F0106"].open("ab") as stream:
            stream.write(b"forged")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self._build()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "pinned public source metadata"):
            self._build(repin=False)

    def test_wrong_class_or_element_rejected_even_with_rehashed_fixture(self) -> None:
        entries = self.page_text["F0106"][49]
        entries[2] = ((500, 130), "B30;")
        self.paths["F0106"].unlink()
        self._write_pdfs()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "unexpected concrete class B30"):
            self._build()
        entries[2] = ((500, 130), "B40;")
        entries[1] = ((120, 130), "· плита покрытия")
        for path in self.paths.values():
            path.unlink()
        self._write_pdfs()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "expected one text line"):
            self._build()

    def test_ambiguous_duplicate_and_missing_text_rejected(self) -> None:
        self.page_text["F0106"][49].append(((700, 130), "B40;"))
        for path in self.paths.values():
            path.unlink()
        self._write_pdfs()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "ambiguous same-row concrete class"):
            self._build()
        self.page_text["F0106"][49].pop()
        self.page_text["F0139"][4].clear()
        for path in self.paths.values():
            path.unlink()
        self._write_pdfs()
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "RD stairs: expected one text line"):
            self._build()


if __name__ == "__main__":
    unittest.main()
