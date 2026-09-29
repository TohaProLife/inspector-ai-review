import { pythonExecutable, pythonEnv } from "./python.js";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { verifyCandidateFamilyOcrObservations,
  type CandidateFamilyOcrObservationsVerificationInput,
} from "../src/candidate-family-ocr-observations.js";
import { verifyCandidateFamilyPreview } from "../src/candidate-family-preview.js";
import { stageContent, verifiedPage } from "../src/ocr-heat-row-proposals.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = `
import json, sys
from services.worker.tests.test_candidate_family_ocr_observations import fixture, OBJECT, MANIFEST, digest
from inspector_worker.candidate_family_ocr_observations import evaluate_run_candidate_family_ocr_observations
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.ocr_pilot import json_stable_ocr_artifact, canonical_hash
sources, texts, stage = fixture(page_count=2)
if sys.argv[1] == 'integral':
  page = stage['analysis']['sources'][0]['pages'][0]
  page['lines'][0]['score'] = 1.0
  page['lines'][0]['bboxPx'] = [10.0, 20.0, 300.0, 40.0]
  page['contentHash'] = canonical_hash({key: value for key, value in page.items()
    if key != 'contentHash'})
  legacy_hash = page['contentHash']
  stage['analysis']['sources'][0]['pages'][0] = json_stable_ocr_artifact(page)
else:
  legacy_hash = None
preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, texts)
result = evaluate_run_candidate_family_ocr_observations(OBJECT, MANIFEST, sources, texts, stage)
review_hash = 'c' * 64
print(json.dumps({
  'objectId': OBJECT, 'inputManifestHash': MANIFEST,
  'sourceFiles': [{'sourceFileId': source['sourceFileId'], 'objectId': OBJECT,
    'sha256': source['sha256'], 'stages': source['stages'],
    'sourceReviewHash': review_hash, 'sectionCode': source['sectionCode']}
    for source in sources],
  'sourceReviews': {source['sourceFileId']: {
    'sourceSha256': source['sha256'], 'revisionStatus': source['revisionStatus'],
    'approvalStatus': source['approvalStatus'], 'linkGroupId': None,
    'pageStages': source['pageStages'], 'contentHash': review_hash,
    'decisionHash': review_hash} for source in sources},
  'textArtifacts': {text['sourceFileId']: {'content_json': text, 'content_hash': digest(text)}
    for text in texts},
  'preview': preview,
  'ocrStage': {'content_json': stage, 'content_hash': digest(stage),
    'byte_size': len(json.dumps(stage, ensure_ascii=False, sort_keys=True,
      separators=(',', ':'), allow_nan=False).encode('utf-8')),
    'provider_profile_id': stage['providerProfileId'],
    'provider_config_hash': stage['providerConfigHash'],
    'input_manifest_hash': MANIFEST},
  'result': result,
  'legacyPageHash': legacy_hash,
}, ensure_ascii=False))
`;

function fixture(mode = "default"): CandidateFamilyOcrObservationsVerificationInput {
  const run = spawnSync(pythonExecutable, ["-c", script, mode], {
    cwd: root, env: { ...process.env, ...pythonEnv, PYTHONPATH: resolve(root, "services/worker") },
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`Worker fixture failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as CandidateFamilyOcrObservationsVerificationInput;
}

function workerJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function reseal(result: Record<string, any>): void {
  for (const row of result.codeRows) {
    for (const lead of row.candidateLeads) {
      const { leadSha256: _old, ...unhashedLead } = lead;
      lead.leadSha256 = sha256(workerJson(unhashedLead));
    }
  }
  const { contentHash: _old, ...unhashed } = result;
  result.contentHash = sha256(workerJson(unhashed));
}

describe("candidate family OCR observations verifier", () => {
  const valid = fixture();

  it("accepts actual Python worker output bound to committed OCR and text", () => {
    expect(verifyCandidateFamilyPreview({ ...valid, result: valid.preview })).toBe(true);
    expect(stageContent(valid.ocrStage, valid.inputManifestHash)).not.toBeNull();
    const stage = valid.ocrStage.content_json as Record<string, any>;
    expect(verifiedPage(stage.analysis.sources[0].pages[0], "source-A", "a".repeat(64))).not.toBeNull();
    expect(verifyCandidateFamilyOcrObservations(valid)).toBe(true);
    const result = valid.result as Record<string, any>;
    expect(result.codeRows).toHaveLength(47);
    expect(result.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
      .candidateLeads).toHaveLength(1);
    expect(result.findingCount).toBeNull();
    expect(result.parameterCoverage).toBeNull();
  });

  it("accepts a new run stage from a verified legacy page with integral float OCR values", () => {
    const normalized = fixture("integral");
    const page = (normalized.ocrStage.content_json as Record<string, any>)
      .analysis.sources[0].pages[0];
    expect(page.contentHash).not.toBe((normalized as any).legacyPageHash);
    expect(page.lines[0].score).toBe(1);
    expect(verifyCandidateFamilyOcrObservations(normalized)).toBe(true);
  });

  it("rejects a moved line, changed score, forged source or deferred-page claim", () => {
    for (const mutate of [
      (x: CandidateFamilyOcrObservationsVerificationInput) => {
        const result = x.result as Record<string, any>;
        const lead = result.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
          .candidateLeads[0];
        lead.locator.start += 1;
        reseal(result);
      },
      (x: CandidateFamilyOcrObservationsVerificationInput) => {
        const result = x.result as Record<string, any>;
        const lead = result.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
          .candidateLeads[0];
        lead.locator.score = 0.1;
        reseal(result);
      },
      (x: CandidateFamilyOcrObservationsVerificationInput) => {
        const result = x.result as Record<string, any>;
        const lead = result.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
          .candidateLeads[0];
        lead.sourceSha256 = "0".repeat(64);
        reseal(result);
      },
      (x: CandidateFamilyOcrObservationsVerificationInput) => {
        const result = x.result as Record<string, any>;
        const row = result.codeRows.find((item: Record<string, any>) => item.parameterCode === "PZ-002");
        row.ocrDeferredPageCount = 0;
        reseal(result);
      },
    ]) {
      const altered = structuredClone(valid);
      mutate(altered);
      expect(verifyCandidateFamilyOcrObservations(altered)).toBe(false);
    }
  });

  it("rejects an unreviewed source and a stage altered after persistence", () => {
    const unreviewed = structuredClone(valid);
    unreviewed.sourceReviews["source-A"].approvalStatus = "UNKNOWN";
    expect(verifyCandidateFamilyOcrObservations(unreviewed)).toBe(false);
    const alteredPage = structuredClone(valid);
    const stage = alteredPage.ocrStage.content_json as Record<string, any>;
    stage.analysis.sources[0].pages[0].lines[0].text += " edited";
    expect(verifyCandidateFamilyOcrObservations(alteredPage)).toBe(false);
  });
});
