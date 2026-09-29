"""Review packet rejects altered crops and unlinked room proposals."""

from __future__ import annotations

import hashlib
from pathlib import Path
import runpy
import tempfile
import unittest


PACKET = runpy.run_path(str(Path(__file__).resolve().parents[1]
                         / "build-drawing-subroom-review-packet.py"))


class SubroomReviewPacketTests(unittest.TestCase):
    def test_selects_only_sha_verified_pending_proposal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crop = root / "candidate-0001.png"
            crop.write_bytes(b"public crop")
            sha = hashlib.sha256(crop.read_bytes()).hexdigest()
            source = {"file_id": "F", "sha256": "pdf-sha"}
            candidate = {"file_id": "F", "page_number": 17}
            report = {"schema_version": "drawing-subroom-link-public-probe-v1",
                      "status": "EXPLORATORY_ONLY", "source_file_id": "F",
                      "source_pdf_sha256": "pdf-sha", "results": [
                          {"candidate_index": 1, "candidate": candidate,
                           "domain_decision": "NOT_ACCEPTED_PROBE_ONLY",
                           "subroom_status": "SUBROOM_CANDIDATE_REVIEW_REQUIRED",
                           "proposed_subroom": {"number": "233.1", "wall_mask_hits": 0}}]}
            circles = {"schema_version": "drawing-red-circle-ocr-public-v1",
                       "number_kind": "decimal", "source_pdf_sha256": "pdf-sha",
                       "results": [{"label_status": "RED_SUBROOM_LABEL_REVIEW_REQUIRED",
                                    "proposed_label": {"number": "233.1"}}]}
            callout = {"schema_version": "drawing-vector-callout-probe-v1",
                       "source_pdf_sha256": "pdf-sha", "results": [
                           {"candidate_index": 1, "candidate": candidate,
                            "link_status": "LINKED_LABEL_REVIEW_REQUIRED",
                            "crop_sha256": sha}]}
            selected = PACKET["checked_entries"](
                report, circles, [(root, callout)], source)
            self.assertEqual(len(selected), 1)
            crop.write_bytes(b"altered crop")
            with self.assertRaisesRegex(ValueError, "crop SHA-256 mismatch"):
                PACKET["checked_entries"](report, circles, [(root, callout)], source)
            crop.write_bytes(b"public crop")
            callout["results"][0]["link_status"] = "ABSTAIN_NO_LEADER"
            with self.assertRaisesRegex(ValueError, "unlinked"):
                PACKET["checked_entries"](report, circles, [(root, callout)], source)

    def test_integer_circle_report_cannot_feed_decimal_packet(self) -> None:
        source = {"file_id": "F", "sha256": "pdf-sha"}
        report = {"schema_version": "drawing-subroom-link-public-probe-v1",
                  "status": "EXPLORATORY_ONLY", "source_file_id": "F",
                  "source_pdf_sha256": "pdf-sha", "results": []}
        circles = {"schema_version": "drawing-red-circle-ocr-public-v1",
                   "number_kind": "integer", "source_pdf_sha256": "pdf-sha"}
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            PACKET["checked_entries"](report, circles, [], source)


if __name__ == "__main__":
    unittest.main()
