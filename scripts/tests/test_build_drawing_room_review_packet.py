"""Review packet must preserve provenance and pending status."""

from __future__ import annotations

from pathlib import Path
import runpy
import tempfile
import unittest

import fitz


PACKET = runpy.run_path(str(Path(__file__).resolve().parents[1]
                         / "build-drawing-room-review-packet.py"))


class RoomReviewPacketTests(unittest.TestCase):
    def test_hidden_manifest_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.jsonl"
            path.write_text('{"file_id":"X","split":"TEST_HIDDEN","distribution_status":"INCLUDE"}\n')
            with self.assertRaisesRegex(ValueError, "TRAIN_PUBLIC"):
                PACKET["source_from_manifest"](path, "X")

    def test_out_of_page_room_box_is_rejected(self) -> None:
        with fitz.open() as document:
            document.new_page(width=200, height=200)
            item = {"candidate_index": 0, "room_status": "ROOM_GROUP_CANDIDATE_REVIEW_REQUIRED",
                    "domain_decision": "NOT_ACCEPTED_PROBE_ONLY",
                    "candidate": {"file_id": "X", "source_sha256": "sha", "page_number": 1,
                                  "bbox_display_pt": [50, 50, 56, 80]},
                    "proposed_room_group": {"number": "233", "circle_bbox_display_pt": [190, 190, 210, 210]}}
            report = {"schema_version": "drawing-room-link-public-probe-v1",
                      "status": "EXPLORATORY_ONLY", "source_file_id": "X",
                      "source_pdf_sha256": "sha", "results": [item]}
            with self.assertRaisesRegex(ValueError, "outside PDF page"):
                PACKET["checked_proposals"](report, {"file_id": "X", "sha256": "sha"}, document)

    def test_unlinked_result_cannot_become_review_entry(self) -> None:
        with fitz.open() as document:
            document.new_page(width=200, height=200)
            report = {"schema_version": "drawing-room-link-public-probe-v1",
                      "status": "EXPLORATORY_ONLY", "source_file_id": "X",
                      "source_pdf_sha256": "sha", "results": [
                          {"candidate_index": 0, "room_status": "ABSTAIN_CALLOUT_UNLINKED"}]}
            self.assertEqual(PACKET["checked_proposals"](
                report, {"file_id": "X", "sha256": "sha"}, document), [])


if __name__ == "__main__":
    unittest.main()
