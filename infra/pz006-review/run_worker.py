"""Produce a bounded PyMuPDF review packet and complete p9 words in tmpfs."""

import hashlib
import json
from pathlib import Path

import fitz

from inspector_worker.pz006_building_levels_proposals import evaluate_pz006_building_levels_proposals


SOURCE = {
    "file_id": "F0101", "object_id": "OBJ-NOVOSLOBODSKAYA",
    "split": "TRAIN_PUBLIC", "distribution_status": "INCLUDE",
    "label_visibility": "PUBLIC_TRAIN", "stage": "PD", "section": "OTHER",
    "sha256": "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54",
    "size_bytes": 891_618, "pdf_pages": 13,
}

pdf_bytes = Path("/input/F0101.pdf").read_bytes()
if len(pdf_bytes) != SOURCE["size_bytes"] or hashlib.sha256(pdf_bytes).hexdigest() != SOURCE["sha256"]:
    raise ValueError("F0101 original PDF changed after shell check")
result = evaluate_pz006_building_levels_proposals(pdf_bytes, SOURCE, 9)
with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
    page = document[8]
    words = [{
        "pageNumber": 9, "wordIndex": index, "rawText": str(raw[4]),
        "wordTextSha256": hashlib.sha256(str(raw[4]).encode("utf-8")).hexdigest(),
        "bboxMilliPointsTopLeft": [round(float(value) * 1000) for value in raw[:4]],
    } for index, raw in enumerate(page.get_text("words", sort=False))]
    page_artifact = {
        "pdfPageCount": document.page_count, "pageNumber": 9,
        "pageWidthMilliPoints": round(page.rect.width * 1000),
        "pageHeightMilliPoints": round(page.rect.height * 1000),
        "pageText": page.get_text("text"), "words": words,
    }
if len(words) != result["wordCount"]:
    raise ValueError("PZ-006 worker word count mismatch")
payload = json.dumps({"result": result, "page": page_artifact}, ensure_ascii=False,
                     separators=(",", ":")).encode("utf-8")
if len(payload) > 512 * 1024:
    raise ValueError("PZ-006 review packet outside byte bound")
Path("/tmp/pz006-worker-result.json").write_bytes(payload)
