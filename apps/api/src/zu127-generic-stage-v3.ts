import { sha256 } from "./canonical-json.js";
import { verifyPopplerPageEvidenceAgainstOriginalPdf } from "./poppler-page-evidence.js";
import { pythonCanonicalJson, pythonHash } from "./trusted-page-words.js";
import { verifyZu127PageSelectionV3 } from "./zu127-page-selection-v3.js";

type Json = Record<string, unknown>;
const SHA = /^[a-f0-9]{64}$/u;
const MAX_STAGE_BYTES = 32 * 1024 * 1024;
const PROFILE_ID = "zu127-generic-poppler-page-review-v3";
const PROFILE_DEFINITION = {
  profileId: PROFILE_ID,
  pageSelectionSchemaVersion: "zu127-page-selection-v3",
  pageEvidenceSchemaVersion: "poppler-page-evidence-v1",
  maxSelectedPages: 4,
  disposition: "REVIEW_AID_ONLY",
};
export const ZU127_GENERIC_V3_CONFIG_HASH = pythonHash(PROFILE_DEFINITION);

const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const hash = (value: unknown): value is string =>
  typeof value === "string" && SHA.test(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);

/** Every field must come from the immutable DB run/lease and release snapshot. */
export interface AuthenticatedZu127GenericV3Input {
  jobId: string;
  runId: string;
  objectId: string;
  inputManifestHash: string;
  releaseId: string;
  releaseManifestHash: string;
  providerProfileId: string;
  providerConfigHash: string;
  sourceFiles: unknown[];
  sourceDecisions: Record<string, unknown>;
  textArtifacts: unknown[];
  /** API-owned object storage reader. Never use a worker-provided path or bytes. */
  originalPdfBytesForSource: (sourceFileId: string) => Promise<Buffer>;
  workerResult: unknown;
}

/**
 * Replays selection from committed text, then every selected full-page Poppler
 * receipt from original PDF bytes. This does not authenticate the DB input
 * itself; save/seal/GET callers must load immutable snapshots independently.
 */
export async function verifyZu127GenericStageV3(
  input: AuthenticatedZu127GenericV3Input,
): Promise<boolean> {
  try {
    const { jobId, runId, objectId, inputManifestHash, releaseId,
      releaseManifestHash, providerProfileId, providerConfigHash, sourceFiles,
      sourceDecisions, textArtifacts, originalPdfBytesForSource, workerResult } = input;
    if (!nonempty(jobId) || !nonempty(runId) || !nonempty(objectId)
      || !nonempty(releaseId) || !hash(inputManifestHash)
      || !hash(releaseManifestHash) || providerProfileId !== PROFILE_ID
      || providerConfigHash !== ZU127_GENERIC_V3_CONFIG_HASH
      || !Array.isArray(sourceFiles) || sourceFiles.length < 1
      || sourceFiles.length > 64 || !record(sourceDecisions)
      || !Array.isArray(textArtifacts)
      || typeof originalPdfBytesForSource !== "function"
      || !record(workerResult)) return false;
    const serialized = pythonCanonicalJson(workerResult);
    if (Buffer.byteLength(serialized) > MAX_STAGE_BYTES) return false;
    const result = workerResult;
    if (!record(result.selection) || !Array.isArray(result.pageReceipts)
      || typeof result.selectedPageCount !== "number"
      || !Number.isSafeInteger(result.selectedPageCount)
      || result.selectedPageCount < 0 || result.selectedPageCount > 4
      || !hash(result.contentHash)
      || result.schemaVersion !== "zu127-generic-stage-v3"
      || result.purpose !== "REVIEW_ONLY" || result.status !== "ABSTAIN"
      || result.parameterCode !== "ZU-127"
      || result.absenceConclusion !== "NOT_AVAILABLE"
      || result.typedFacts !== null || result.findings !== null
      || result.findingCount !== null || result.parameterCoverage !== null
      || result.sourceDecisionSnapshotSha256 !== pythonHash(sourceDecisions)
      || !verifyZu127PageSelectionV3({ objectId, inputManifestHash,
        sources: sourceFiles, sourceDecisions, textArtifacts,
        workerResult: result.selection })) return false;

    const rows = result.selection.sourceRows;
    if (!Array.isArray(rows) || rows.length !== sourceFiles.length
      || result.selectedPageCount !== result.selection.selectedPageCount) return false;
    const sources = new Map<string, Json>();
    for (const source of sourceFiles) {
      if (!record(source) || !nonempty(source.sourceFileId)
        || sources.has(source.sourceFileId) || !hash(source.sha256)
        || typeof source.byteSize !== "number"
        || !Number.isSafeInteger(source.byteSize)
        || typeof source.pageCount !== "number"
        || !Number.isSafeInteger(source.pageCount)) return false;
      sources.set(source.sourceFileId, source);
      const decision = sourceDecisions[source.sourceFileId];
      if (decision !== undefined && decision !== null && (!record(decision)
        || source.sectionCode !== decision.sectionCode)) return false;
    }
    const selectedRows = rows.filter((row) => record(row)
      && Array.isArray(row.selectedPageNumbers)
      && row.selectedPageNumbers.length > 0);
    if (result.pageReceipts.length !== selectedRows.length) return false;
    for (const [index, row] of selectedRows.entries()) {
      if (!record(row) || !nonempty(row.sourceFileId)
        || !hash(row.textArtifactSha256)
        || !Array.isArray(row.selectedPageNumbers)) return false;
      const receipt = result.pageReceipts[index];
      const source = sources.get(row.sourceFileId);
      if (!source || !record(receipt)
        || receipt.sourceFileId !== row.sourceFileId
        || receipt.textArtifactSha256 !== row.textArtifactSha256) return false;
      const originalPdfBytes = await originalPdfBytesForSource(row.sourceFileId);
      if (!Buffer.isBuffer(originalPdfBytes)
        || sha256(originalPdfBytes) !== source.sha256
        || originalPdfBytes.length !== source.byteSize) return false;
      await verifyPopplerPageEvidenceAgainstOriginalPdf({
        originalPdfBytes, expectedSourceSha256: source.sha256,
        expectedSourceByteSize: source.byteSize as number,
        expectedPdfPageCount: source.pageCount as number,
        expectedSelectedPageNumbers: row.selectedPageNumbers as number[],
        workerResult: receipt.pageEvidence,
      });
      if (!equal(receipt, { sourceFileId: row.sourceFileId,
        textArtifactSha256: row.textArtifactSha256,
        pageEvidence: receipt.pageEvidence })) return false;
    }
    const expected = {
      schemaVersion: "zu127-generic-stage-v3", purpose: "REVIEW_ONLY",
      status: "ABSTAIN", parameterCode: "ZU-127",
      jobId, runId, objectId, inputManifestHash, releaseId,
      releaseManifestHash, providerProfileId, providerConfigHash,
      sourceDecisionSnapshotSha256: pythonHash(sourceDecisions),
      selection: result.selection, pageReceipts: result.pageReceipts,
      selectedPageCount: result.selection.selectedPageCount,
      absenceConclusion: "NOT_AVAILABLE", typedFacts: null,
      findings: null, findingCount: null, parameterCoverage: null,
    };
    return equal(result, { ...expected, contentHash: pythonHash(expected) });
  } catch {
    return false;
  }
}
