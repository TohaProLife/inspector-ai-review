#!/usr/bin/env python3
"""Offline cross-language check for the OCR heat-row review aid.

Python produces each result from one OCR v3 stage. TypeScript then checks that
same result against the persisted-stage envelope and immutable manifest input.
No document data, DB, provider, or network access is needed.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))

from inspector_worker.ocr_heat_rows import extract_ocr_heat_rows  # noqa: E402
from inspector_worker.ocr_pilot import canonical_hash  # noqa: E402


SOURCE_ID = "FIL-OCR-CONTRACT"
SOURCE_SHA = "a" * 64
MANIFEST_SHA = "b" * 64

PROFILE_CODE = """
import { boundedOcrConfigHashV3, boundedOcrProfileIdV3,
  boundedOcrProfileV3 } from './apps/api/src/ocr-layout.ts';
process.stdout.write(JSON.stringify({
  configHash: boundedOcrConfigHashV3,
  profileId: boundedOcrProfileIdV3,
  profile: boundedOcrProfileV3,
}));
"""

VALIDATION_CODE = """
import { readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from './apps/api/src/canonical-json.ts';
import { validateOcrHeatRowProposals } from './apps/api/src/ocr-heat-row-proposals.ts';

const input = JSON.parse(readFileSync(0, 'utf8'));
const content = input.stage;
const canonical = canonicalJson(content);
const persisted = {
  content_json: content,
  content_hash: sha256(canonical),
  byte_size: Buffer.byteLength(canonical, 'utf8'),
  provider_profile_id: content.providerProfileId,
  provider_config_hash: content.providerConfigHash,
  input_manifest_hash: content.inputManifestHash,
};
const check = (entry, envelope = persisted, expectedHash = input.manifestHash) =>
  validateOcrHeatRowProposals(entry.result, envelope, entry.reviews,
    entry.sourceFiles, expectedHash);
const single = input.cases.singleStageRd;
const mixed = input.cases.mixedStageUnresolved;
const reviewed = input.cases.mixedStageReviewedRd;
const changedResult = structuredClone(single);
changedResult.result.proposals[0].values.kW = '999';
const badEnvelopeHash = { ...persisted, content_hash: 'f'.repeat(64) };
const changedStage = structuredClone(persisted);
const page = changedStage.content_json.analysis.sources[0].pages[0];
page.lines[2].text = '800,00 кВт. (0,621 Гкал/час)';
const { contentHash: _oldPageHash, ...pageWithoutHash } = page;
page.contentHash = sha256(canonicalJson(pageWithoutHash));
const newCanonical = canonicalJson(changedStage.content_json);
changedStage.content_hash = sha256(newCanonical);
changedStage.byte_size = Buffer.byteLength(newCanonical, 'utf8');
process.stdout.write(JSON.stringify({
  singleStageRd: check(single),
  mixedStageUnresolved: check(mixed),
  mixedStageReviewedRd: check(reviewed),
  tamperedResult: check(changedResult),
  tamperedEnvelopeHash: check(single, badEnvelopeHash),
  tamperedRehashedStage: check(single, changedStage),
  tamperedExpectedManifestHash: check(single, persisted, 'e'.repeat(64)),
}));
"""


def _typescript(code: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    cli = ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if not cli.is_file():
        raise RuntimeError("npm dependencies missing: run npm ci at repository root")
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js executable missing from PATH")
    completed = subprocess.run(
        [node, str(cli), "-e", code],
        input=None if payload is None else json.dumps(payload, ensure_ascii=False),
        text=True, encoding="utf-8", capture_output=True, check=True, cwd=ROOT, timeout=30,
    )
    return json.loads(completed.stdout)


def _line(text: str, box: list[int], score: float = 0.95) -> dict[str, Any]:
    return {"text": text, "bboxPx": box, "score": score}


def _stage(profile: dict[str, Any]) -> dict[str, Any]:
    lines = [
        _line("Система горячего водоснабжения", [215, 561, 476, 589]),
        _line("Максимальный расчетный расход тепла с учетом", [213, 599, 567, 626]),
        _line("722,64 кВт. (0,621 Гкал/час)", [595, 607, 799, 639], 0.84),
        _line("циркуляции", [214, 623, 304, 648]),
        _line("Средний расчетный расход тепла", [214, 666, 460, 696]),
        _line("225,11 кВт. (0,194 Гкал/час)", [594, 665, 798, 696], 0.85),
    ]
    page = {
        "schemaVersion": "document-ocr-page-v1", "sourceFileId": SOURCE_ID,
        "inputSha256": SOURCE_SHA, "pageNumber": 8,
        "render": {"sha256": "c" * 64, "widthPx": 993, "heightPx": 1403,
                   "dpi": 120, "rendererProfileId": profile["profile"]["rendererProfileId"]},
        "provider": {"profileId": profile["profile"]["ocrProviderProfileIds"][0],
                     "script": "eslav"},
        "lines": lines,
    }
    page["contentHash"] = canonical_hash(page)
    return {
        "schemaVersion": "analysis-stage-result-v2", "jobType": "DOCUMENT_OCR_LAYOUT",
        "inputManifestHash": MANIFEST_SHA, "disposition": "OCR_LAYOUT_BOUNDED",
        "reasonCode": "BOUNDED_OCR_ONLY", "providerKind": "OCR_LAYOUT",
        "providerProfileId": profile["profileId"],
        "providerConfigHash": profile["configHash"], "outputCount": 1,
        "analysis": {
            "schemaVersion": "bounded-ocr-layout-analysis-v3", "objectId": "OBJ-OCR-CONTRACT",
            "inputManifestHash": MANIFEST_SHA, "profile": profile["profile"],
            "sourceCount": 1, "processedPageCount": 1,
            "sources": [{"sourceFileId": SOURCE_ID, "sourceSha256": SOURCE_SHA,
                         "processedPageCount": 1, "pages": [page]}],
        },
    }


def run_contract() -> dict[str, Any]:
    profile = _typescript(PROFILE_CODE)
    stage = _stage(profile)
    single_files = [{"sourceFileId": SOURCE_ID, "sha256": SOURCE_SHA,
                     "stages": ["RD"]}]
    mixed_files = [{"sourceFileId": SOURCE_ID, "sha256": SOURCE_SHA,
                    "stages": ["PD", "RD"]}]
    reviewed = {SOURCE_ID: {"sourceSha256": SOURCE_SHA,
                            "pageStages": {"8": "RD"}}}
    cases = {
        "singleStageRd": {"sourceFiles": single_files, "reviews": {},
                          "result": extract_ocr_heat_rows(stage, {}, single_files)},
        "mixedStageUnresolved": {"sourceFiles": mixed_files, "reviews": {},
                                 "result": extract_ocr_heat_rows(stage, {}, mixed_files)},
        "mixedStageReviewedRd": {"sourceFiles": mixed_files, "reviews": reviewed,
                                 "result": extract_ocr_heat_rows(stage, reviewed, mixed_files)},
    }
    actual = _typescript(VALIDATION_CODE, {"stage": stage, "manifestHash": MANIFEST_SHA,
                                           "cases": cases})
    expected = {
        "singleStageRd": True, "mixedStageUnresolved": True,
        "mixedStageReviewedRd": True, "tamperedResult": False,
        "tamperedEnvelopeHash": False, "tamperedRehashedStage": False,
        "tamperedExpectedManifestHash": False,
    }
    if actual != expected:
        raise AssertionError(f"cross-language validator mismatch: {actual}")
    single_result = cases["singleStageRd"]["result"]
    mixed_result = cases["mixedStageUnresolved"]["result"]
    if (len(single_result["proposals"]) != 2
            or single_result["abstentions"]
            or mixed_result["proposals"]
            or [item["reasonCode"] for item in mixed_result["abstentions"]]
            != ["PAGE_STAGE_UNRESOLVED", "PAGE_STAGE_UNRESOLVED"]):
        raise AssertionError("worker fixture no longer covers expected RD and abstention paths")
    return {"schemaVersion": "ocr-heat-worker-api-contract-v1", "checks": actual,
            "singleStageProposalCount": len(single_result["proposals"]),
            "mixedStageAbstentionCount": len(mixed_result["abstentions"])}


if __name__ == "__main__":
    print(json.dumps(run_contract(), ensure_ascii=False, sort_keys=True))
