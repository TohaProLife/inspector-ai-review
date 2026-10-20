"""Independent hand-authored676-page source contract; no project labels as input."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from inspector_worker.document_text_v4 import (
    extract_pdf_text_artifact_v4_full, read_document_text_v4_full_artifact,
    document_text_v4_full_content_hash,
)
from inspector_worker.document_text_v3 import read_document_text_v3_large_artifact

POLICY = "document-text-v4-full-source-bounds-v1"
TRAVERSAL = "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
ROOT = Path(__file__).resolve().parents[3]


def authored_pdf(count):
    """Deterministic authored PDF: one exact quoted line on every physical page."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    pages = []
    for n in range(1, count + 1):
        page_id = len(objects) + 1
        content_id = page_id + 1
        pages.append(f"{page_id} 0 R")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode())
        text = f"BT /F1 10 Tf 20 120 Td (FULLSOURCE PAGE {n}) Tj ET\n".encode()
        objects.append(f"<< /Length {len(text)} >>\nstream\n".encode() + text + b"endstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(pages)}] /Count {count} >>".encode()
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(data)
    data += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    data += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    data += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(data)


class FullSourceV4Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.pdf = Path(cls.temp.name) / "authored676.pdf"
        cls.pdf.write_bytes(authored_pdf(676))
        cls.sha = hashlib.sha256(cls.pdf.read_bytes()).hexdigest()
        cls.artifact = extract_pdf_text_artifact_v4_full(cls.pdf, "SYNTHETIC-FULL-676", cls.sha, traversal_policy_version=TRAVERSAL)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_all676_physical_pages_and_last_quote(self):
        a = self.artifact
        self.assertEqual(a["pageCount"], 676)
        self.assertEqual([p["pageNumber"] for p in a["pages"]], list(range(1, 677)))
        self.assertEqual(a["inputSha256"], self.sha)
        self.assertEqual(a["pages"][0]["locatedLines"][0]["rawText"], "FULLSOURCE PAGE 1\n")
        self.assertEqual(a["pages"][-1]["locatedLines"][0]["rawText"], "FULLSOURCE PAGE 676\n")
        self.assertEqual(sum(len(p["locatedLines"]) for p in a["pages"]), 676)
        self.assertEqual(a["qualitySummary"], {"candidatePages": 676, "partialPages": 0, "ocrRequiredPages": 0})
        self.assertEqual(read_document_text_v4_full_artifact(a), {"status": "VALID", "resourcePolicyVersion": POLICY, "contentHash": document_text_v4_full_content_hash(a)})
        self.assertEqual(read_document_text_v3_large_artifact(a), {"status": "ABSTAIN", "resourcePolicyVersion": "document-text-v3-large-source-bounds-v1", "reasonCode": "INPUT_LIMIT"})

    def test_missing_duplicate_last_or_middle_not_accepted(self):
        for kind in ("missing", "duplicate", "missing-last", "bad-last-quality"):
            a = copy.deepcopy(self.artifact)
            if kind == "missing": del a["pages"][200]
            elif kind == "duplicate": a["pages"][200] = copy.deepcopy(a["pages"][199])
            elif kind == "missing-last": a["pages"].pop()
            else: a["pages"][-1]["quality"]["metrics"]["locatedLineCount"] = 2
            self.assertEqual(read_document_text_v4_full_artifact(a)["reasonCode"], "INVALID_TEXT_ARTIFACT", kind)

    def test_page_and_native_budget_refuse_before_semantics(self):
        self.assertEqual(read_document_text_v4_full_artifact({"pages": [None] * 1025})["reasonCode"], "INPUT_LIMIT")
        # 1 root + arrays and their scalar children exceeds1.4M without huge single container.
        tree = [[None] * 32768 for _ in range(43)]
        self.assertEqual(read_document_text_v4_full_artifact(tree)["reasonCode"], "INPUT_LIMIT")

    def test_real_manifest_sha_mismatch_rejected_before_layout(self):
        real_sha = "0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd"
        manifest = ROOT / "datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl"
        record = next(json.loads(line) for line in manifest.read_text().splitlines() if json.loads(line)["file_id"] == "F0201")
        self.assertEqual((record["sha256"], record["size_bytes"], record["pdf_pages"]), (real_sha, 43033348, 676))
        with patch("inspector_worker.document_text_v4._stable_visible_pdf_layouts") as layouts:
            with self.assertRaisesRegex(ValueError, "SOURCE_SHA256_MISMATCH"):
                extract_pdf_text_artifact_v4_full(self.pdf, "F0201", real_sha, traversal_policy_version=TRAVERSAL)
            layouts.assert_not_called()


if __name__ == "__main__": unittest.main()
