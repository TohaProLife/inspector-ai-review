from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_parameter_catalog(path: str | Path) -> list[dict[str, Any]]:
    catalog_path = Path(path)
    rows: list[dict[str, Any]] = []
    with catalog_path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            required = {"parameter_id", "parameter_code", "parameter_name"}
            missing = required.difference(row)
            if missing:
                raise ValueError(f"catalog line {line_number} misses: {', '.join(sorted(missing))}")
            rows.append(row)

    codes = [row["parameter_code"] for row in rows]
    if len(codes) != len(set(codes)):
        raise ValueError("parameter_code must be unique")
    return rows
