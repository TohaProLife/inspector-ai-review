import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MatrixAtomicResult, MatrixExecution, MatrixObservation } from "@inspector-ai/contracts";
import { describe, expect, it } from "vitest";
import { buildMatrixSubmission, matrixRegistryHash } from "../src/matrix-execution.js";
import { publicSourceMapHash, resolveMatrixSubmissionIdentity } from "../src/matrix-submission-identity.js";
import { projectRoot, pythonAvailable, pythonEnv, pythonExecutable } from "./python.js";

const applicationObject = "bda6a841-e647-4c8e-ac7b-86619f0ae815";
const sources = [
  { sourceFileId: "application-pd", sha256: "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54", stages: ["PD"] },
  { sourceFileId: "application-rd", sha256: "cb4929c8a0f069a325ba16991767f26ba3c43a521e8052bad55c803b9e89fa5b", stages: ["RD"] },
  { sourceFileId: "application-id", sha256: "1ff8cccb7e104f0ef22223af31350f9c8d7956c4df33a537f6c5e5a96c881b2e", stages: ["ID"] },
];
const sourceMap = JSON.parse(readFileSync(new URL("../../../services/worker/rules/public-source-id-map-v1.json", import.meta.url), "utf8")) as {
  sources: Array<{ fileId: string; objectId: string; sha256: string; stage: string }>;
};

// Synthetic facts exercise serialization only. They do not claim these values occur in the mapped originals.
function execution(): MatrixExecution {
  const observations: MatrixObservation[] = sources.map((source, index) => ({ id: `fixture-${index}`,
    sourceFileId: source.sourceFileId, sourceSha256: source.sha256, stage: source.stages[0] as "PD" | "RD" | "ID",
    pageNumber: 1, blockId: "0:0", bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    rawText: "synthetic serializer fixture", attribute: "CONCRETE_CLASS", value: ["B35", "B30", "B25"][index],
    unit: "B_CLASS", entityKey: "fixture-element", method: "TEXT_LAYER", extractorVersion: "matrix-text-facts-v1" }));
  const results: MatrixAtomicResult[] = ([[0, 1, "PD_RD"], [0, 2, "PD_ID"], [1, 2, "RD_ID"]] as const).map(([a, b, variant]) => ({
    ruleId: "matrix-kr-055-concrete_class", ruleVersion: "1", parameterCode: "KR-055", entityKey: "fixture-element",
    comparisonVariant: variant, executionStatus: "SUCCEEDED", machineStatus: "CANDIDATE", reasonCode: "CATALOG_TRIGGER_MATCHED",
    expectedObservationId: observations[a].id, actualObservationId: observations[b].id,
    expectedValue: observations[a].value, actualValue: observations[b].value, delta: "-5", qualified: true }));
  return { schemaVersion: "matrix-execution-v1", objectId: applicationObject, inputManifestHash: "a".repeat(64),
    registryHash: matrixRegistryHash, observations, metadata: [], results, coverage: [] };
}
function validateSaved(value: unknown, strict = false, raw?: string) {
  const directory = mkdtempSync(join(tmpdir(), "matrix-submission-schema-"));
  try {
    const path = join(directory, "submission.json"); writeFileSync(path, raw ?? JSON.stringify(value));
    const result = spawnSync(pythonExecutable, [join(projectRoot, "scripts/validate-matrix-submission.py"), path,
      ...(strict ? ["--require-official-ids"] : [])], { env: { ...process.env, ...pythonEnv }, encoding: "utf8", timeout: 10_000 });
    if (result.status === 2 || result.error) throw new Error(result.stderr || String(result.error));
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("matrix public submission identity", () => {
  it("maps exact SHA and stage for F0101/F0136/F0002, without trusting application IDs", () => {
    const identity = resolveMatrixSubmissionIdentity(applicationObject, sources);
    expect(identity.officialIdsVerified).toBe(true); expect(identity.objectId).toBe("OBJ-NOVOSLOBODSKAYA");
    expect(identity.mappingHash).toBe(publicSourceMapHash);
    expect([...identity.fileIds]).toEqual([["application-pd:PD", "F0101"], ["application-rd:RD", "F0136"], ["application-id:ID", "F0002"]]);
    const renamed = sources.map((s, i) => ({ ...s, sourceFileId: `untrusted-F${i}` }));
    expect(resolveMatrixSubmissionIdentity(applicationObject, renamed).fileIds.get("untrusted-F1:RD")).toBe("F0136");
  });

  it("falls back atomically for a wrong SHA, wrong stage, unknown source, or empty source set", () => {
    for (const changed of [
      sources.map((s, i) => i === 1 ? { ...s, sha256: "0".repeat(64) } : s),
      sources.map((s, i) => i === 0 ? { ...s, stages: ["RD"] } : s),
      [...sources, { sourceFileId: "foreign", sha256: "f".repeat(64), stages: ["PD"] }], [],
    ]) {
      const identity = resolveMatrixSubmissionIdentity(applicationObject, changed);
      expect(identity.officialIdsVerified).toBe(false); expect(identity.objectId).toBe(applicationObject);
      expect(identity.fileIds.size).toBe(0);
    }
  });

  it("does not map a mixed set of original documents from different public objects", () => {
    const foreign = sourceMap.sources.find(s => s.objectId !== "OBJ-NOVOSLOBODSKAYA" && s.stage === "PD")!;
    const identity = resolveMatrixSubmissionIdentity(applicationObject,
      [...sources, { sourceFileId: "other-building", sha256: foreign.sha256, stages: [foreign.stage] }]);
    expect(identity.officialIdsVerified).toBe(false); expect(identity.objectId).toBe(applicationObject);
    expect(identity.fileIds.size).toBe(0);
  });

  it("maps RD_ID_MIXED only to its allowed RD and ID stages", () => {
    const mixed = sourceMap.sources.find(s => s.stage === "RD_ID_MIXED")!;
    const identity = resolveMatrixSubmissionIdentity(applicationObject,
      [{ sourceFileId: "mixed", sha256: mixed.sha256, stages: ["RD", "ID"] }]);
    expect(identity.officialIdsVerified).toBe(true);
    expect(identity.fileIds.get("mixed:RD")).toBe(mixed.fileId);
    expect(identity.fileIds.get("mixed:ID")).toBe(mixed.fileId);
    expect(resolveMatrixSubmissionIdentity(applicationObject,
      [{ sourceFileId: "mixed", sha256: mixed.sha256, stages: ["PD"] }]).officialIdsVerified).toBe(false);
  });

  it("exports catalog M codes and keeps PD/RD/ID values in their own fields, including RD_ID baseline", () => {
    const identity = resolveMatrixSubmissionIdentity(applicationObject, sources);
    const output = buildMatrixSubmission(execution(), applicationObject, identity);
    expect(output.object_id).toBe("OBJ-NOVOSLOBODSKAYA");
    expect(output.checks.every(check => check.parameter_code === "M-055" && check.violation_label === "COMPARISON_IMPOSSIBLE"
      && check.protocol_status === "COMPARISON_IMPOSSIBLE")).toBe(true);
    expect(output.checks.map(c => [c.pd_value, c.rd_value, c.id_value])).toEqual([["B35", "B30", null], ["B35", null, "B25"], [null, "B30", "B25"]]);
    expect(output.checks.map(c => c.evidence)).toEqual([
      [{ stage: "PD", file_id: "F0101", pdf_page_number: 1 }, { stage: "RD", file_id: "F0136", pdf_page_number: 1 }],
      [{ stage: "PD", file_id: "F0101", pdf_page_number: 1 }, { stage: "ID", file_id: "F0002", pdf_page_number: 1 }],
      [{ stage: "RD", file_id: "F0136", pdf_page_number: 1 }, { stage: "ID", file_id: "F0002", pdf_page_number: 1 }],
    ]);
  });

  it.skipIf(!pythonAvailable)("validates saved frozen exporter bytes against the unchanged official schema offline", () => {
    const output = buildMatrixSubmission(execution(), applicationObject, resolveMatrixSubmissionIdentity(applicationObject, sources));
    const valid = validateSaved(output, true);
    expect(valid.status).toBe(0); expect(valid.report.schemaValid).toBe(true);
    expect(valid.report.officialSchemaSha256).toBe("75c58bef6b580528e7e4af8e4fdcdf5a5d40599b8966dae90df38b3a5f04a8d7");
    expect(valid.report.publicReferences.consistent).toBe(true);
    expect(valid.report.publicReferences.originalSourceShaVerified).toBe(false);
    const fallback = buildMatrixSubmission(execution(), applicationObject, resolveMatrixSubmissionIdentity(applicationObject,
      sources.map((s, i) => i === 0 ? { ...s, sha256: "0".repeat(64) } : s)));
    expect(fallback.object_id).toBe(applicationObject);
    expect(fallback.checks[0].evidence[0].file_id).toBe("application-pd");
    expect(validateSaved(fallback).status).toBe(0);
    const strict = validateSaved(fallback, true);
    expect(strict.status).toBe(1); expect(strict.report.schemaValid).toBe(true);
    expect(strict.report.publicReferences.consistent).toBe(false);
  });

  it.skipIf(!pythonAvailable)("rejects invalid saved shape and JSON, while enforcing exact public object/stage references separately", () => {
    const output = buildMatrixSubmission(execution(), applicationObject, resolveMatrixSubmissionIdentity(applicationObject, sources));
    for (const change of [
      (v: any) => { delete v.object_id; },
      (v: any) => { delete v.checks[0].parameter_code; },
      (v: any) => { v.checks[0].violation_label = "GUESSED"; },
      (v: any) => { v.checks[0].evidence[0].stage = "UNRESOLVED"; },
      (v: any) => { v.checks[0].evidence[0].pdf_page_number = 0; },
    ]) {
      const value = structuredClone(output); change(value);
      const invalid = validateSaved(value); expect(invalid.status).toBe(1); expect(invalid.report.schemaValid).toBe(false);
    }
    const changedStage = structuredClone(output); changedStage.checks[0].evidence[0].stage = "ID";
    const inconsistent = validateSaved(changedStage, true);
    expect(inconsistent.report.schemaValid).toBe(true); expect(inconsistent.status).toBe(1);
    expect(inconsistent.report.publicReferences.issues[0].reason).toBe("FILE_STAGE_MISMATCH");
    const crossObject = structuredClone(output);
    crossObject.object_id = sourceMap.sources.find(s => s.objectId !== "OBJ-NOVOSLOBODSKAYA")!.objectId;
    expect(validateSaved(crossObject, true).report.publicReferences.issues[0].reason).toBe("FILE_OBJECT_MISMATCH");
    expect(validateSaved(null, false, '{"object_id":"x","object_id":"y","checks":[]}').status).toBe(1);
    expect(validateSaved(null, false, '{"object_id":"x","checks":[],"extra":NaN}').status).toBe(1);
  });
});
