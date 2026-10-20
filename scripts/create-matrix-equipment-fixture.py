#!/usr/bin/env python3
"""Create explicitly synthetic T07 originals and review descriptors. Requires PyMuPDF."""
import argparse
import json
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
CODES = {"IOS2-073", "IOS4-077", "PPM-112", "SPZU-032"}


def create(directory: Path) -> dict:
    registry = json.loads((ROOT / "services/worker/rules/matrix-execution-v1.json").read_text())
    directory.mkdir(parents=True, exist_ok=True)
    documents = []
    for entry in registry["entries"]:
        code = entry["parameterCode"]
        if code not in CODES:
            continue
        for stage in (["PD", "RD", "ID"] if code == "SPZU-032" else ["PD", "RD"]):
            rules = entry["atomicRules"]
            section = rules[0]["expectedSections" if stage == "PD" else "actualSections"][0]
            value = "100" if stage == "PD" or code == "IOS4-077" else "80" if stage == "ID" else "90"
            contexts = {}
            rows = [f"СИНТЕТИЧЕСКИЙ ТЕСТ T07: {code} / {stage}",
                    "Не данные реального строительного объекта", f"Раздел: {section}"]
            for rule in rules:
                rows.append(f'{rule["labels"][0]}: {value} {rule["unitAliases"][0]}')
                policy = rule["subruleContext"]
                key = "ATOMIC_SUBRULE_SCOPE:" + rule["ruleId"]
                contexts[key] = {"reference": "Synthetic original: controlled component, zone, duty point and measurement basis",
                    "parameterCode": code, "attribute": rule["attribute"], "canonicalUnit": rule["canonicalUnit"],
                    "componentRole": policy["componentRole"], "componentKey": "synthetic:" + policy["componentRole"],
                    "zoneKey": "synthetic-zone-A", "operatingModeKey": "synthetic-design-point-1",
                    "measurementBasisKey": "synthetic:" + rule["attribute"]}
                if code == "PPM-112" and stage == "RD":
                    # Deliberate mismatch: a numerically smaller value must still abstain.
                    contexts[key]["operatingModeKey"] = "synthetic-different-duty-point"
                if code == "IOS4-077":
                    contexts["RULE_SCOPE_COMPLETE:" + rule["ruleId"]] = {
                        "reference": "Synthetic radiator originals: complete reviewed rule scope"}
            if stage == "ID":
                contexts["DRAWING_SECTION_VERIFIED"] = {"reference": "Synthetic ID road-layer drawing section checked", "drawingSection": section}
            document = fitz.open()
            page = document.new_page(width=595, height=842)
            for index, row in enumerate(rows):
                page.insert_text((30, 55 + index * 38), row, fontsize=10,
                    fontfile="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", fontname="DejaVu")
            name = f"matrix-equipment-{code}-{stage}.pdf"
            document.save(directory / name)
            document.close()
            documents.append({"name": name, "stage": stage, "sectionCode": section,
                "matrixScope": {"entityKey": "synthetic:" + code,
                    "reference": "Explicitly synthetic controlled T07 component, not a real project review", "contexts": contexts}})
    descriptor = {"schemaVersion": "synthetic-matrix-equipment-v1", "documents": documents,
        "expected": {"observations": 18, "qualifiedComparisons": 10, "candidates": 8, "negativeVerified": 2,
                     "contextAbstentions": 2, "implementedParameters": 49, "unsupportedParameters": 83}}
    (directory / "fixture.json").write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
    return {"directory": str(directory), "pdfCount": len(documents), "expected": descriptor["expected"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("/tmp/matrix-equipment-fixture"))
    print(json.dumps(create(parser.parse_args().directory.resolve()), ensure_ascii=False))
