import { pythonExecutable, pythonEnv } from "./python.js";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyCandidateFamilyObservations,
  type CandidateFamilyObservationsVerificationInput } from "../src/candidate-family-observations.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureScript = `
import json, sys
from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from services.worker.tests.test_candidate_family_observations import (
    source, artifact, digest, candidate_line, OBJECT, MANIFEST)
from inspector_worker.candidate_family_rules import load_candidate_family_pack
codes = ['PZ-002'] if sys.argv[1] == 'one' else [
    rule['parameterCode'] for rule in load_candidate_family_pack()['rules']]
rules = {rule['parameterCode']: rule for rule in load_candidate_family_pack()['rules']}
sources = [source(code, rules[code]['requiredExpectedDrawingSections'][0]) for code in codes]
artifacts = [artifact(src, [candidate_line(src['sourceFileId'])]) for src in sources]
preview = evaluate_run_candidate_family_preview(OBJECT, MANIFEST, sources, artifacts)
observations = extract_candidate_family_observations(preview, sources, artifacts)
review_hash = 'c' * 64
print(json.dumps({
  'objectId': OBJECT, 'inputManifestHash': MANIFEST,
  'sourceFiles': [{'sourceFileId': src['sourceFileId'], 'objectId': OBJECT,
    'sha256': src['sha256'], 'stages': src['stages'], 'sourceReviewHash': review_hash,
    'sectionCode': src['sectionCode']} for src in sources],
  'sourceReviews': {src['sourceFileId']: {'sourceSha256': src['sha256'],
    'revisionStatus': 'CURRENT', 'approvalStatus': 'APPROVED', 'linkGroupId': None,
    'pageStages': {}, 'contentHash': review_hash, 'decisionHash': review_hash}
    for src in sources},
  'textArtifacts': {art['sourceFileId']: {'content_json': art, 'content_hash': digest(art)}
    for art in artifacts},
  'preview': preview, 'result': observations,
}, ensure_ascii=False))
`;

function fixture(kind: "one" | "all" = "one"): CandidateFamilyObservationsVerificationInput {
  const run = spawnSync(pythonExecutable, ["-c", fixtureScript, kind], {
    cwd: root, env: { ...process.env, ...pythonEnv, PYTHONPATH: resolve(root, "services/worker") },
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`Python observation fixture failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as CandidateFamilyObservationsVerificationInput;
}

function reseal(input: CandidateFamilyObservationsVerificationInput): void {
  const result = input.result as Record<string, any>;
  for (const observation of result.observations) {
    if (observation.typedFact) {
      const { factId: _oldFactId, ...factBody } = observation.typedFact;
      observation.typedFact.factId = sha256(canonicalJson(factBody));
    }
    const { observationId: _oldId, ...body } = observation;
    observation.observationId = sha256(canonicalJson(body));
  }
  const { contentHash: _oldHash, ...content } = result;
  result.contentHash = sha256(canonicalJson(content));
}

describe("candidate family observation verifier", () => {
  const one = fixture();

  it("accepts exact Python hashes and binds one numeric fact to its committed lead", () => {
    expect(verifyCandidateFamilyObservations(one)).toBe(true);
    const result = one.result as Record<string, any>;
    expect(result.codeRows).toHaveLength(47);
    expect(result.outputCount).toBe(1);
    expect(result.observations[0].typedFact.factId).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.findingCount).toBeNull();
    expect(result.parameterCoverage).toBeNull();
  });

  it("accepts every Python-generated code and keeps presence facts untyped", () => {
    const all = fixture("all");
    expect(verifyCandidateFamilyObservations(all)).toBe(true);
    const result = all.result as Record<string, any>;
    expect(result.outputCount).toBe(47);
    expect(result.observations.filter((item: Record<string, any>) => item.typedFact !== null))
      .toHaveLength(39);
    const classObservation = result.observations.find((item: Record<string, any>) =>
      item.family === "CLASS_DECREASE");
    expect(classObservation.rawUnit).toBeNull();
    expect(classObservation.typedFact.rawUnit).toBe(classObservation.canonicalUnit);
    const forged = structuredClone(all);
    const classFact = (forged.result as Record<string, any>).observations.find(
      (item: Record<string, any>) => item.family === "CLASS_DECREASE");
    classFact.typedFact.rawUnit = "unreviewed-scale";
    reseal(forged);
    expect(verifyCandidateFamilyObservations(forged)).toBe(false);
  }, 30_000); // Runs the Python extractor across all 47 pinned parameter codes.

  it("rejects rehashed source, lead, locator, value and unit forgeries", () => {
    const edits: Array<(input: CandidateFamilyObservationsVerificationInput) => void> = [
      (input) => { (input.result as Record<string, any>).observations[0].leadSha256 = "d".repeat(64); },
      (input) => { (input.result as Record<string, any>).observations[0].rawValue = "99"; },
      (input) => { (input.result as Record<string, any>).observations[0].typedFact.rawValue = "99"; },
      (input) => { (input.result as Record<string, any>).observations[0].typedFact.rawText = "forged"; },
      (input) => { (input.result as Record<string, any>).observations[0].typedFact.rawUnit = "кВт"; },
      (input) => { (input.result as Record<string, any>).observations[0].typedFact.locator.start += 1; },
      (input) => { (input.result as Record<string, any>).observations[0].inputManifestHash = "d".repeat(64); },
      (input) => { input.sourceReviews["PZ-002"].approvalStatus = "UNKNOWN"; },
      (input) => { input.textArtifacts["PZ-002"].content_hash = "d".repeat(64); },
    ];
    for (const edit of edits) {
      const forged = structuredClone(one);
      edit(forged);
      reseal(forged);
      expect(verifyCandidateFamilyObservations(forged)).toBe(false);
    }
  });

  it("rejects missing, duplicate and reordered observations after full rehash", () => {
    const all = fixture("all");
    const edits: Array<(result: Record<string, any>) => void> = [
      (result) => { result.observations.pop(); result.outputCount -= 1; },
      (result) => { result.observations[1] = structuredClone(result.observations[0]); },
      (result) => { [result.observations[0], result.observations[1]] =
        [result.observations[1], result.observations[0]]; },
      (result) => { result.codeRows[0].observationCount = 0; },
      (result) => { result.findingCount = 1; },
      (result) => { result.parameterCoverage = "PARTIAL"; },
    ];
    for (const edit of edits) {
      const forged = structuredClone(all);
      edit(forged.result as Record<string, any>);
      reseal(forged);
      expect(verifyCandidateFamilyObservations(forged)).toBe(false);
    }
  }, 30_000); // Includes full-catalog Python extraction and every replay check.

  it("rejects preview tampering even if both outputs are rehashed", () => {
    const forged = structuredClone(one);
    const preview = forged.preview as Record<string, any>;
    const row = preview.codeRows.find((item: Record<string, any>) => item.parameterCode === "PZ-002");
    row.candidateLeads[0].rawUnit = "кВт";
    const { leadSha256: _oldLead, ...leadBody } = row.candidateLeads[0];
    row.candidateLeads[0].leadSha256 = sha256(canonicalJson(leadBody));
    const { contentHash: _oldPreview, ...previewBody } = preview;
    preview.contentHash = sha256(canonicalJson(previewBody));
    reseal(forged);
    expect(verifyCandidateFamilyObservations(forged)).toBe(false);
  });
});
