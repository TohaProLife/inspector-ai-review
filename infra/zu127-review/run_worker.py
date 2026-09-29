"""One-shot public F0152 worker result; retained only in container tmpfs."""

import json
from pathlib import Path

from inspector_worker.zu127_window_table_poppler_v2 import evaluate_zu127_window_table_poppler_v2


SOURCE = {
    "file_id": "F0152",
    "split": "TRAIN_PUBLIC",
    "distribution_status": "INCLUDE",
    "label_visibility": "PUBLIC_TRAIN",
    "object_id": "OBJ-TYUMENSKAYA-5-GOLD-SEED",
    "sha256": "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af",
    "size_bytes": 6_359_136,
    "pdf_pages": 77,
    "stage": "PD",
    "section": "OTHER",
}


result = evaluate_zu127_window_table_poppler_v2(Path("/input/F0152.pdf"), SOURCE, [49, 51])
payload = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
if len(payload) > 256 * 1024:
    raise ValueError("ZU-127 result outside byte bound")
Path("/tmp/zu127-worker-result.json").write_bytes(payload)
