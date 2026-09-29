#!/usr/bin/env python3
"""Page-level audit against visible TRAIN_PUBLIC labels; no hidden answers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LABELS = (ROOT / "datasets/reference_methodology/hackathon_gold_20260811"
          / "УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/public_train_checks.jsonl")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    artifact = json.loads(args.artifact.read_text())
    candidates = artifact["candidates"]
    selected = {source["sourceFileId"] for source in
                json.loads((args.artifact.parent / "verification-input.json").read_text())
                ["sourceFiles"]}
    labels = [json.loads(line) for line in LABELS.read_text().splitlines()]
    labels = [row for row in labels if row["split"] == "TRAIN_PUBLIC"
              and row["visibility"] == "PUBLIC_TRAIN_LABEL"]
    positives = [row for row in labels if row.get("violation_label") == "VIOLATION_PRESENT"]
    negatives = [row for row in labels if row.get("violation_label") == "NO_VIOLATION"]
    groups: dict[str, list[dict]] = {}
    for row in positives:
        groups.setdefault(row["finding_group_id"], []).append(row)
    comparable = []
    for group_id, rows in sorted(groups.items()):
        evidence = {(item["file_id"], item["pdf_page_number"], row["parameter_code"])
                    for row in rows for item in row["evidence"]}
        if {item[0] for item in evidence} - selected:
            continue
        hits = [index + 1 for index, candidate in enumerate(candidates)
                if (candidate["sourceFileId"], candidate["pageNumber"],
                    candidate["parameterCode"]) in evidence]
        stages_hit = {item["stage"] for row in rows for item in row["evidence"]
                      if any(candidate["sourceFileId"] == item["file_id"]
                             and candidate["pageNumber"] == item["pdf_page_number"]
                             and candidate["parameterCode"] == row["parameter_code"]
                             for candidate in candidates)}
        comparable.append({"groupId": group_id, "code": rows[0]["parameter_code"],
                           "labelRows": len(rows), "pageHitRanks": hits,
                           "pdRdPagePairHit": {"PD", "RD"} <= stages_hit})
    hit_ranks = {rank for row in comparable for rank in row["pageHitRanks"]}
    report = {"scope": "TRAIN_PUBLIC_VISIBLE_LABELS_ONLY",
              "candidateArtifactHash": artifact["contentHash"],
              "candidateCount": len(candidates), "positiveLabelRows": len(positives),
              "positiveLabelGroups": len(groups),
              "comparablePositiveGroups": len(comparable),
              "pageLevelRecallAtCandidateCount": (sum(bool(row["pageHitRanks"])
                                                       for row in comparable)
                                                  / len(comparable) if comparable else None),
              "fullPdRdPagePairHits": sum(row["pdRdPagePairHit"] for row in comparable),
              "candidateRanksOnLabeledPositivePages": sorted(hit_ranks),
              "candidatesWithoutMatchingPositivePageLabel": len(candidates) - len(hit_ranks),
              "negativeLabelRows": len(negatives),
              "falsePositiveCount": None,
              "groups": comparable,
              "metricLimit": "Page-level navigation only; no room or violation adjudication."}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
