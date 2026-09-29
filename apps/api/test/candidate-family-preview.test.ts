import { pythonExecutable, pythonEnv } from "./python.js";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyCandidateFamilyPreview,
  type CandidateFamilyPreviewVerificationInput } from "../src/candidate-family-preview.js";
import { projectCandidateFamilyPreviewRead } from "../src/pilot-result-read.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureScript = `
import json, sys
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from services.worker.tests.test_run_candidate_family_preview import source, artifact, digest, candidate_line, OBJECT, MANIFEST
from inspector_worker.candidate_family_rules import load_candidate_family_pack
if sys.argv[1] in ('all-pd', 'all-rd', 'saturated'):
  stage = 'RD' if sys.argv[1] == 'all-rd' else 'PD'
  section_key = 'requiredActualDrawingSections' if stage == 'RD' else 'requiredExpectedDrawingSections'
  sources = [source(rule['parameterCode'], rule[section_key][0], stage=stage)
    for rule in load_candidate_family_pack()['rules']]
  artifacts = [artifact(src, [candidate_line(src['sourceFileId']).ljust(480)] * 16)
    if sys.argv[1] == 'saturated' else artifact(src, [candidate_line(src['sourceFileId'])])
    for src in sources]
elif sys.argv[1] in ('mixed-unresolved', 'mixed-partial'):
  src = source('SRC-1', 'PZ')
  src['stages'] = ['PD', 'RD']
  src['pageStages'] = ({'1': 'PD', '2': 'UNRESOLVED'}
    if sys.argv[1] == 'mixed-partial' else {'1': 'UNRESOLVED'})
  sources = [src]
  artifacts = [artifact(src, ['Общая площадь здания: 42 м²',
    'Общая площадь здания: 99 м²'] if sys.argv[1] == 'mixed-partial'
    else ['Общая площадь здания: 42 м²'])]
else:
  sources = [source('SRC-1', 'PZ')]
  artifacts = [artifact(sources[0], ['Общая площадь здания: 42 м²'] * int(sys.argv[1]))]
preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
review_hash = 'c' * 64
print(json.dumps({
  'objectId': OBJECT, 'inputManifestHash': MANIFEST,
  'sourceFiles': [{'sourceFileId': src['sourceFileId'], 'objectId': OBJECT,
    'sha256': src['sha256'], 'stages': src['stages'],
    'sourceReviewHash': review_hash, 'sectionCode': src['sectionCode']} for src in sources],
  'sourceReviews': {src['sourceFileId']: {'sourceSha256': src['sha256'],
    'revisionStatus': 'CURRENT', 'approvalStatus': 'APPROVED',
    'linkGroupId': None, 'pageStages': src['pageStages'], 'contentHash': review_hash,
    'decisionHash': review_hash} for src in sources},
  'textArtifacts': {art['sourceFileId']: {'content_json': art,
    'content_hash': digest(art)} for art in artifacts}, 'result': preview,
}, ensure_ascii=False))
`;

function workerFixture(pages: number | "all-pd" | "all-rd" | "mixed-unresolved" | "mixed-partial" | "saturated" = 1): CandidateFamilyPreviewVerificationInput {
  const run = spawnSync(pythonExecutable, ["-c", fixtureScript, String(pages)], {
    cwd: root, env: { ...process.env, ...pythonEnv, PYTHONPATH: resolve(root, "services/worker") },
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`Worker fixture failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as CandidateFamilyPreviewVerificationInput;
}

function reseal(fixture: CandidateFamilyPreviewVerificationInput): void {
  const result = fixture.result as Record<string, any>;
  for (const row of result.codeRows) {
    for (const lead of row.candidateLeads) {
      const { leadSha256: _old, ...unhashed } = lead;
      lead.leadSha256 = sha256(canonicalJson(unhashed));
    }
  }
  const { contentHash: _old, ...unhashed } = result;
  result.contentHash = sha256(canonicalJson(unhashed));
}

describe("candidate family preview verifier", () => {
  const valid = workerFixture();

  it("accepts actual Python worker output and its Unicode hashes", () => {
    expect(verifyCandidateFamilyPreview(valid)).toBe(true);
    const result = valid.result as Record<string, any>;
    expect(result.codeRows).toHaveLength(47);
    expect(result.codeRows.every((row: Record<string, any>) => row.status === "ABSTAIN")).toBe(true);
    expect(result.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
      .candidateLeads).toHaveLength(1);
    expect(result.findingCount).toBeNull();
    expect(result.parameterCoverage).toBeNull();
  });

  it("verifies the bounded 16-lead case against one hashed source artifact", () => {
    const many = workerFixture(16);
    expect(verifyCandidateFamilyPreview(many)).toBe(true);
    const row = (many.result as Record<string, any>).codeRows.find(
      (entry: Record<string, any>) => entry.parameterCode === "PZ-002");
    expect(row.leadCount).toBe(16);
  });

  it("accepts mixed-stage worker abstention when a page stage is unresolved", () => {
    const mixed = workerFixture("mixed-unresolved");
    const row = (mixed.result as Record<string, any>).codeRows.find(
      (entry: Record<string, any>) => entry.parameterCode === "PZ-002");
    expect(row.reasonCodes).toContain("SOURCE_PAGE_STAGE_UNRESOLVED");
    expect(row.candidateLeads).toHaveLength(0);
    expect(row.reasonCodes).not.toContain("NO_EXACT_LABEL_LEAD");
    expect(verifyCandidateFamilyPreview(mixed)).toBe(true);
  });

  it("keeps a reviewed PD page lead when another page stage is unresolved", () => {
    const mixed = workerFixture("mixed-partial");
    const row = (mixed.result as Record<string, any>).codeRows.find(
      (entry: Record<string, any>) => entry.parameterCode === "PZ-002");
    expect(row.reasonCodes).toContain("SOURCE_PAGE_STAGE_UNRESOLVED");
    expect(row.eligibleSourceCount).toBe(1);
    expect(row.textScannedPageCount).toBe(1);
    expect(row.candidateLeads.map((lead: Record<string, any>) => lead.pageNumber)).toEqual([1]);
    expect(verifyCandidateFamilyPreview(mixed)).toBe(true);
  });

  it("accepts a byte-limited saturated preview without turning omitted leads into absence", () => {
    const saturated = workerFixture("saturated");
    const preview = saturated.result as Record<string, any>;
    expect(Buffer.byteLength(canonicalJson(preview), "utf8")).toBeLessThanOrEqual(1024 * 1024);
    expect(preview.codeRows.some((row: Record<string, any>) =>
      row.reasonCodes.includes("PREVIEW_BYTE_BUDGET_REACHED"))).toBe(true);
    expect(verifyCandidateFamilyPreview(saturated)).toBe(true);
  }, 15_000);

  it("accepts authentic leads for every pinned code and source section role", () => {
    for (const role of ["all-pd", "all-rd"] as const) {
      const all = workerFixture(role);
      expect(verifyCandidateFamilyPreview(all)).toBe(true);
      expect((all.result as Record<string, any>).codeRows.every(
        (row: Record<string, any>) => row.leadCount >= 1)).toBe(true);
      if (role === "all-rd") {
        const forged = structuredClone(all);
        const source = forged.sourceFiles.find((entry) => entry.sourceFileId === "PZ-002")!;
        const row = (forged.result as Record<string, any>).codeRows.find(
          (entry: Record<string, any>) => entry.parameterCode === "PZ-002");
        source.sectionCode = "PZ";
        row.candidateLeads[0].sectionCode = "PZ";
        reseal(forged);
        expect(verifyCandidateFamilyPreview(forged)).toBe(false);
      }
    }
  }, 30_000); // Executes the complete Python catalog for both PD and RD sources.

  it("rejects rehashed release, scope, code, status and coverage forgeries", () => {
    const edits: Array<(result: Record<string, any>) => void> = [
      (result) => { result.scope = "TRAIN_PUBLIC_INCLUDE_PUBLIC_TRAIN_ONLY"; },
      (result) => { result.candidateRulePackSha256 = "f".repeat(64); },
      (result) => { result.inputManifestHash = "f".repeat(64); },
      (result) => { result.codeRows.pop(); result.outputCount = 46; },
      (result) => { result.codeRows[0].status = "REVIEW_REQUIRED"; },
      (result) => { result.findingCount = 1; },
      (result) => { result.parameterCoverage = "PARTIAL"; },
    ];
    for (const edit of edits) {
      const forged = structuredClone(valid);
      edit(forged.result as Record<string, any>);
      reseal(forged);
      expect(verifyCandidateFamilyPreview(forged)).toBe(false);
    }
  });

  it("rejects rehashed locator, label and source-review forgeries", () => {
    const lead = (input: CandidateFamilyPreviewVerificationInput) =>
      (input.result as Record<string, any>).codeRows.find(
        (row: Record<string, any>) => row.parameterCode === "PZ-002").candidateLeads[0];
    const edits: Array<(input: CandidateFamilyPreviewVerificationInput) => void> = [
      (input) => { lead(input).locator.start += 1; },
      (input) => { lead(input).matchedLabel = "Несуществующая метка"; },
      (input) => { lead(input).blockTextSha256 = "f".repeat(64); },
      (input) => { lead(input).sourceSha256 = "f".repeat(64); },
      (input) => { lead(input).rawUnit = "кВт"; },
      (input) => { input.sourceReviews["SRC-1"].approvalStatus = "UNKNOWN"; },
      (input) => { input.sourceFiles[0].sectionCode = "AR"; },
      (input) => { input.sourceFiles[0].sectionCode = "KR"; lead(input).sectionCode = "KR"; },
    ];
    for (const edit of edits) {
      const forged = structuredClone(valid);
      edit(forged);
      reseal(forged);
      expect(verifyCandidateFamilyPreview(forged)).toBe(false);
    }
  });

  it("rejects rehashed eligible-source and page counters", () => {
    const edits: Array<(row: Record<string, any>) => void> = [
      (row) => { row.eligibleSourceCount = 0; },
      (row) => { row.textScannedPageCount = 0; },
      (row) => { row.ocrRequiredPageCount = 999; },
    ];
    for (const edit of edits) {
      const forged = structuredClone(valid);
      const row = (forged.result as Record<string, any>).codeRows.find(
        (entry: Record<string, any>) => entry.parameterCode === "PZ-002");
      edit(row);
      reseal(forged);
      expect(verifyCandidateFamilyPreview(forged)).toBe(false);
    }
  });

  it("projects only the new immutable stage profile", () => {
    const content = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
      disposition: "RULES_EVALUATED", providerKind: "RULE_ENGINE",
      providerProfileId: "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
      providerConfigHash: "d".repeat(64), inputManifestHash: valid.inputManifestHash,
      outputCount: 5, candidateFamilyPreview: valid.result };
    const canonical = canonicalJson(content);
    const stage = { content_json: content, content_hash: sha256(canonical),
      byte_size: Buffer.byteLength(canonical, "utf8"), schema_version: "analysis-stage-result-v2",
      disposition: "RULES_EVALUATED", provider_profile_id: content.providerProfileId,
      provider_config_hash: content.providerConfigHash,
      input_manifest_hash: content.inputManifestHash, output_count: 5, job_state: "SUCCEEDED" };
    expect(projectCandidateFamilyPreviewRead(stage, valid.inputManifestHash, "d".repeat(64)))
      .toEqual(valid.result);
    expect(() => projectCandidateFamilyPreviewRead({ ...stage,
      provider_profile_id: "typed-pz002-pz017-ocr-heat-fact-family-v1" },
    valid.inputManifestHash, "d".repeat(64))).toThrow();
  });
});
