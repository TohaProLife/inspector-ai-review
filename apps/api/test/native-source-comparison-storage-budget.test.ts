import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { NativeAirflowRecord } from "../../../packages/contracts/src/native-airflow-record.js";
import type { NativeCapacityRecord } from "../../../packages/contracts/src/native-capacity-record.js";
import {
  assertNativeSourceComparisonHistoryBudget, beginNativeSourceComparisonCapture,
  lockNativeSourceComparisonHistory, nativeSourceComparisonBindingsMatch,
} from "../src/native-source-comparison-storage.js";

const MAX_BYTES = 16 * 1024 * 1024;
function poolBudget(count = "0", bytes = "0") {
  const query = vi.fn(async () => ({ rows: [{ count, bytes }] }));
  return { query, client: { query } as unknown as PoolClient };
}
function captureError(action: () => unknown) {
  try { action(); throw new Error("Expected capture rejection"); }
  catch (error) { return error; }
}

it("capacity and airflow share exactly two slots; duplicate release cannot create a third slot", () => {
  const releases: (() => void)[] = [];
  try {
    const capacity = beginNativeSourceComparisonCapture("CAPACITY"); releases.push(capacity);
    const airflow = beginNativeSourceComparisonCapture("AIRFLOW"); releases.push(airflow);
    expect(captureError(() => beginNativeSourceComparisonCapture("AIRFLOW")))
      .toMatchObject({ statusCode: 503, code: "NATIVE_AIRFLOW_BUSY" });
    expect(captureError(() => beginNativeSourceComparisonCapture("CAPACITY")))
      .toMatchObject({ statusCode: 503, code: "NATIVE_CAPACITY_BUSY" });
    capacity(); capacity();
    releases.push(beginNativeSourceComparisonCapture("AIRFLOW"));
    expect(captureError(() => beginNativeSourceComparisonCapture("CAPACITY")))
      .toMatchObject({ statusCode: 503, code: "NATIVE_CAPACITY_BUSY" });
  } finally { releases.forEach(release => release()); }
  // Both original slots are available again after callers finish, including duplicate release.
  const first = beginNativeSourceComparisonCapture("CAPACITY"), second = beginNativeSourceComparisonCapture("AIRFLOW");
  first(); second();
});

for (const kind of ["CAPACITY", "AIRFLOW"] as const) {
  describe(`${kind} serialized history budget`, () => {
    it("passes hostile run IDs only as SQL parameters, with a lane-specific transaction lock", async () => {
      const { client, query } = poolBudget(), runId = "run'); DROP TABLE analysis_runs;--";
      await lockNativeSourceComparisonHistory(client, runId, kind);
      const [sql, args] = query.mock.calls[0] as unknown as [string, string[]];
      expect(sql).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");
      expect(args).toEqual([`native-source-history:${kind}:${runId}`]);
      expect(sql).not.toContain(runId);
    });
    it.each([["0", "0", 1], ["999", "0", 1], ["999", String(MAX_BYTES - 1), 1],
      ["0", "0", MAX_BYTES], ["1", "15", MAX_BYTES - 15]])(
      "accepts count=%s bytes=%s newBytes=%s including exact final boundaries", async (count, bytes, newBytes) => {
        const { client, query } = poolBudget(count, bytes);
        await expect(assertNativeSourceComparisonHistoryBudget(client, "RUN", kind, newBytes)).resolves.toBeUndefined();
        const [sql, args] = query.mock.calls[0] as unknown as [string, string[]];
        expect(sql).toContain(`FROM native_${kind.toLowerCase()}_comparisons WHERE run_id=$1`);
        expect(args).toEqual(["RUN"]);
      });
    it.each([["1000", "0", 1], ["1001", "0", 1], ["999", String(MAX_BYTES), 1],
      ["1", "1", MAX_BYTES], ["0", "9007199254740993", 1], ["9007199254740993", "0", 1]])(
      "rejects count=%s bytes=%s newBytes=%s without rounding large PostgreSQL integers", async (count, bytes, newBytes) => {
        await expect(assertNativeSourceComparisonHistoryBudget(poolBudget(count, bytes).client, "RUN", kind, newBytes))
          .rejects.toMatchObject({ statusCode: 413, code: `NATIVE_${kind}_RECORD_LIMIT` });
      });
    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid new byte count%s", async newBytes => {
      await expect(assertNativeSourceComparisonHistoryBudget(poolBudget().client, "RUN", kind, newBytes))
        .rejects.toMatchObject({ statusCode: 413, code: `NATIVE_${kind}_RECORD_LIMIT` });
    });
    it("rejects an unavailable history aggregate and propagates DB failure without an insert", async () => {
      const missing = { query: vi.fn(async () => ({ rows: [] })) };
      await expect(assertNativeSourceComparisonHistoryBudget(missing as unknown as PoolClient, "RUN", kind, 1))
        .rejects.toMatchObject({ statusCode: 413, code: `NATIVE_${kind}_RECORD_LIMIT` });
      const failure = new Error("Database unavailable"), query = vi.fn(async () => { throw failure; });
      await expect(assertNativeSourceComparisonHistoryBudget({ query } as unknown as PoolClient, "RUN", kind, 1)).rejects.toBe(failure);
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
}

// Independent synthetic saved-record fixture. This suite tests address binding only;
// schema/hash validation is a separate prerequisite in the durable readers.
const sha = (digit: string) => digit.repeat(64);
const profile = { schemaVersion: "document-text-extractor-profile-v1" as const, textLayerSourceSha256: sha("1"),
  documentTextV4SourceSha256: sha("2"), pdfminerVersion: "20260107" as const, geometryPolicyVersion: "document-text-v4-decimal-half-even-v1" as const,
  cropPolicyVersion: "visible-crop-contained-epsilon-1e-6-v1" as const,
  traversalPolicyVersion: "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1" as const, qualityPolicyVersion: "document-text-quality-v4" as const };
function source(role: "PD" | "RD") {
  return { checkId: "CHECK", sourceFileId: role, sourceSha256: sha(role === "PD" ? "a" : "b"), inputManifestHash: sha("c"),
    textStageContentHash: sha(role === "PD" ? "d" : "e"), textArtifactByteSha256: sha(role === "PD" ? "d" : "e"),
    textArtifactContentHash: sha(role === "PD" ? "f" : "0"), extractorProfileHash: sha("3"), extractorProfile: profile,
    sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1" as const, resourcePolicyVersion: "document-text-v4-full-source-bounds-v1" as const,
    declaredStage: role, selectedRole: role, roleQualification: "UNVERIFIED" as const, pageCount: 1, scannedNativeLineCount: 2 };
}
function evidence(role: "PD" | "RD") {
  const origin = source(role);
  return { inputRole: role, sourceFileId: origin.sourceFileId, sourceSha256: origin.sourceSha256,
    textArtifactContentHash: origin.textArtifactContentHash, evidenceKind: "NATIVE" as const,
    physicalPage: 1, pageWidthMilliPoints: 595000, pageHeightMilliPoints: 842000,
    nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS" as const, visibleBoxPointStrings: ["0", "0", "595", "842"] as const },
    sourcePath: [1, 0], nativeBoxPointStrings: ["20", "100", "200", "110"] as const,
    bboxMilliPoints: [20000, 100000, 200000, 110000] as const, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS" as const,
    renderedVisibility: "UNVERIFIED" as const };
}
function airflowRecord(): Omit<NativeAirflowRecord, "contentHash"> {
  const quote = (role: "PD" | "RD") => ({ ...evidence(role), rawText: `${role === "PD" ? "П17" : "П17.1"} (L=9060 м3/ч, Pc=540 Па)\n`,
    systemId: role === "PD" ? "П17" : "П17.1", rawValue: "9060", value: "9060", unit: "м³/ч" as const, rawUnit: "м3/ч" as const,
    freePressurePa: "540", rawPressureUnit: "Па" as const, matchedRangeCodePoints: (role === "PD" ? [7, 11] : [9, 13]) as readonly [number, number],
    extractionMethod: "NATIVE_SINGLE_LINE_SYSTEM_AIRFLOW" as const });
  const reference = (role: "PD" | "RD") => ({ ...evidence(role), rawText: role === "PD" ? "П17\n" : "П17.1\n",
    systemIds: [role === "PD" ? "П17" : "П17.1"], reason: "SELECTED_SYSTEM_REFERENCE_WITHOUT_AIRFLOW" as const });
  return { schemaVersion: "native-airflow-record-v1", id: "record", objectId: "OBJECT", checkId: "CHECK", createdAt: "2026-10-20T00:00:00.000Z", createdBy: "actor",
    input: { schemaVersion: "native-airflow-command-v1", pdSourceFileId: "PD", rdSourceFileId: "RD", selection: { pdSystemId: "П17", rdSystemIds: ["П17.1"] } },
    bindings: { inputManifestHash: sha("c"), releaseId: "release", pdSourceSha256: sha("a"), rdSourceSha256: sha("b"),
      pdTextArtifactHash: sha("d"), rdTextArtifactHash: sha("e"), selectionHash: sha("4") },
    comparison: { schemaVersion: "native-airflow-comparison-v1", policyVersion: "native-selected-system-airflow-v1", purpose: "SOURCE_ONLY",
      associatedParameterCode: "IOS4-079", parameterMappingStatus: "PUBLIC_MAPPING_CONFLICT", attribute: "SELECTED_SYSTEM_DECLARED_VOLUMETRIC_FLOW",
      p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false,
      notices: [], contentHash: sha("5"), status: "COMPARED", selection: { pdSystemId: "П17", rdSystemIds: ["П17.1"] },
      comparison: "EQUAL", pdValue: "9060", rdValue: "9060", deltaRdMinusPd: "0", unit: "м³/ч",
      memberValues: { PD: { systemId: "П17", value: "9060", unit: "м³/ч", freePressurePa: "540", quoteCount: 1 },
        RD: [{ systemId: "П17.1", value: "9060", unit: "м³/ч", freePressurePa: "540", quoteCount: 1 }] },
      sources: { PD: source("PD"), RD: source("RD") }, quotes: { PD: [quote("PD")], RD: [quote("RD")] },
      references: { PD: [reference("PD")], RD: [reference("RD")] } } };
}
function capacityRecord(): Omit<NativeCapacityRecord, "contentHash"> {
  const base = airflowRecord(), quote = (role: "PD" | "RD") => ({ ...evidence(role), rawText: "Школа на 600 мест\n",
    rawValue: "600", value: "600", unit: "мест" as const, matchedRangeCodePoints: [9, 12] as const, extractionMethod: "NATIVE_SINGLE_LINE_TITLE" as const });
  const { selectionHash: _selectionHash, ...bindings } = base.bindings;
  return { ...base, schemaVersion: "native-capacity-record-v1", input: { schemaVersion: "native-capacity-command-v1", pdSourceFileId: "PD", rdSourceFileId: "RD" },
    bindings,
    comparison: { schemaVersion: "native-capacity-comparison-v1", policyVersion: "native-school-title-capacity-v1", purpose: "SOURCE_ONLY", parameterCode: "PZ-013",
      attribute: "DECLARED_SCHOOL_SEAT_CAPACITY", p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false,
      completeConfiguration: false, notices: [], contentHash: sha("5"), status: "COMPARED", comparison: "EQUAL", pdValue: "600", rdValue: "600", deltaRdMinusPd: "0", unit: "мест",
      sources: { PD: source("PD"), RD: source("RD") }, quotes: { PD: [quote("PD")], RD: [quote("RD")] },
      excludedTitleFragments: [{ ...evidence("PD"), rawText: "Школа на\n", reason: "TITLE_WITHOUT_QUANTITY", continuationLines: [] }] } };
}

for (const [lane, fixture] of [["AIRFLOW", airflowRecord], ["CAPACITY", capacityRecord]] as const) {
  describe(`${lane} outer/inner source address binding`, () => {
    it("accepts independently bound saved addresses and does not mutate the record", () => {
      const record = fixture(), before = JSON.stringify(record);
      expect(nativeSourceComparisonBindingsMatch(record)).toBe(true);
      expect(JSON.stringify(record)).toBe(before);
    });
    for (const role of ["PD", "RD"] as const) {
      it.each(["checkId", "sourceFileId", "sourceSha256", "inputManifestHash", "textArtifactByteSha256", "selectedRole"])(
        `rejects foreign ${role} provenance field%s even when the inner result is otherwise consistent`, field => {
          const record = structuredClone(fixture()) as any;
          record.comparison.sources[role][field] = field === "selectedRole" ? (role === "PD" ? "RD" : "PD") : "FOREIGN";
          expect(nativeSourceComparisonBindingsMatch(record)).toBe(false);
        });
      it.each(["sourceFileId", "sourceSha256", "textArtifactContentHash", "inputRole"])(`rejects foreign ${role} quote field%s`, field => {
        const record = structuredClone(fixture()) as any;
        record.comparison.quotes[role][0][field] = field === "inputRole" ? (role === "PD" ? "RD" : "PD") : "FOREIGN";
        expect(nativeSourceComparisonBindingsMatch(record)).toBe(false);
      });
      it(`rejects missing ${role} declarations; a source record without quotes is not a comparison`, () => {
        const record = structuredClone(fixture()) as any; record.comparison.quotes[role] = [];
        expect(nativeSourceComparisonBindingsMatch(record)).toBe(false);
      });
    }
  });
}
it.each(["PD", "RD"] as const)("binds every airflow%s reference, including the final saved reference", role => {
  for (const field of ["sourceFileId", "sourceSha256", "textArtifactContentHash", "inputRole"]) {
    const record = airflowRecord() as any, references = record.comparison.references[role];
    references.push({ ...references[0], [field]: field === "inputRole" ? (role === "PD" ? "RD" : "PD") : "FOREIGN" });
    expect(nativeSourceComparisonBindingsMatch(record)).toBe(false);
  }
});
it("binds capacity excluded fragments in compared and abstained results; airflow abstention needs no fictitious sources", () => {
  const compared = capacityRecord() as any;
  for (const field of ["sourceFileId", "sourceSha256", "textArtifactContentHash", "inputRole"]) {
    const changed = structuredClone(compared); changed.comparison.excludedTitleFragments[0][field] = field === "inputRole" ? "RD" : "FOREIGN";
    expect(nativeSourceComparisonBindingsMatch(changed)).toBe(false);
  }
  const { comparison: _comparison, ...outer } = capacityRecord();
  const abstained = { ...outer, comparison: { schemaVersion: "native-capacity-comparison-v1", policyVersion: "native-school-title-capacity-v1", purpose: "SOURCE_ONLY",
    parameterCode: "PZ-013", attribute: "DECLARED_SCHOOL_SEAT_CAPACITY", p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0,
    engineeringQualification: false, completeConfiguration: false, notices: [], contentHash: sha("5"), status: "ABSTAIN", reasonCode: "CAPACITY_EVIDENCE_MISSING",
    excludedTitleFragments: compared.comparison.excludedTitleFragments } } as Omit<NativeCapacityRecord, "contentHash">;
  expect(nativeSourceComparisonBindingsMatch(abstained)).toBe(true);
  for (const field of ["sourceFileId", "sourceSha256", "inputRole"]) {
    const changed = structuredClone(abstained) as any; changed.comparison.excludedTitleFragments[0][field] = field === "inputRole" ? "RD" : "FOREIGN";
    expect(nativeSourceComparisonBindingsMatch(changed)).toBe(false);
  }
  const airflow = airflowRecord(), { comparison: _airflowComparison, ...airflowOuter } = airflow;
  const airflowAbstained = { ...airflowOuter, comparison: { schemaVersion: "native-airflow-comparison-v1", policyVersion: "native-selected-system-airflow-v1", purpose: "SOURCE_ONLY",
    associatedParameterCode: "IOS4-079", parameterMappingStatus: "PUBLIC_MAPPING_CONFLICT", attribute: "SELECTED_SYSTEM_DECLARED_VOLUMETRIC_FLOW",
    p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false,
    notices: [], contentHash: sha("5"), status: "ABSTAIN", reasonCode: "SELECTED_MEMBER_EVIDENCE_MISSING" } } as Omit<NativeAirflowRecord, "contentHash">;
  expect(nativeSourceComparisonBindingsMatch(airflowAbstained)).toBe(true);
});
