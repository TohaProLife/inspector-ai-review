/** New-reader identity syntax boundaries. Existing v1/v2/v3 semantics stay historical. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildSourceTextV3LargeIndex } from "./source-text-explorer";
function fixture() {
  const artifact = structuredClone(JSON.parse(readFileSync(new URL("../../../fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json", import.meta.url), "utf8")).cases[0].artifact);
  const file = { id: artifact.sourceFileId, sha256: artifact.inputSha256, stages: ["PD"], pageCount: 1 };
  const identity = { objectId: "OBJ", checkId: "CHK", file, reviewHash: null as string | null };
  const data = { schemaVersion: "document-text-v3-large-source-read-v1", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1",
    resourcePolicyVersion: "document-text-v3-large-source-bounds-v1", checkId: "CHK", sourceFileId: file.id, sourceSha256: file.sha256,
    inputManifestHash: "b".repeat(64), textStageContentHash: "c".repeat(64), textArtifactByteSha256: "c".repeat(64), textArtifactContentHash: "d".repeat(64), extractorProfileHash: artifact.extractorProfileHash,
    stage: "PD", pageStages: {} as unknown, latestReviewHash: null as string | null, authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact };
  return { identity, data };
}
it.each(["objectId", "checkId", "sourceId", "sourceSha", "reviewHash", "pageStages"])("rejects consistently rebound invalid new identity %s", kind => {
  const { identity, data } = fixture();
  if (kind === "objectId") identity.objectId += "\n";
  if (kind === "checkId") { identity.checkId += "\n"; data.checkId = identity.checkId; }
  if (kind === "sourceId") { identity.file.id += "\n"; data.sourceFileId = identity.file.id; data.textArtifact.sourceFileId = identity.file.id; }
  if (kind === "sourceSha") { identity.file.sha256 += "\n"; data.sourceSha256 = identity.file.sha256; data.textArtifact.inputSha256 = identity.file.sha256; }
  if (kind === "reviewHash") { identity.reviewHash = "a".repeat(64) + "\n"; data.latestReviewHash = identity.reviewHash; }
  if (kind === "pageStages") data.pageStages = [];
  expect(() => buildSourceTextV3LargeIndex(identity as any, data as any)).toThrow();
});
