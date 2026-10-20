import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { DocumentTextV3Artifact, DocumentTextV3AuditRelease } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { readDocumentTextV3Artifact } from "./document-text-v3.js";
import { validateDocumentTextV3AuditRelease } from "./document-text-v3-audit-release.js";

interface Source { id: string; apiId: string; sha256: string; mediaType: string }
export interface ValidatedAuditTextArtifact {
  id: string; source: Source; artifact: DocumentTextV3Artifact;
  canonical: string; contentHash: string; byteSize: number;
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const properties = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(properties).length === keys.length && keys.every(key => properties[key]?.enumerable
    && Object.hasOwn(properties[key], "value"));
}
/** Server admission binds every original and complete producer profile to this release.
 * Storage SHA256 continues to identify canonical bytes; artifactContentHash uses the v3 domain.
 */
export function validateDocumentTextV3AuditResult(result: unknown, sources: Source[], release: DocumentTextV3AuditRelease): {
  artifacts: ValidatedAuditTextArtifact[]; storedResult: Record<string, unknown>;
} | undefined {
  try {
    if (!validateDocumentTextV3AuditRelease(release, { requireCurrentProducer: true })
      || !exact(result, ["disposition", "purpose", "sources", "workerId"])
      || result.disposition !== "DOCUMENT_TEXT_LAYER_COMPLETED" || result.purpose !== "SOURCE_AUDIT_ONLY"
      || typeof result.workerId !== "string" || result.workerId.length < 1 || result.workerId.length > 200
      || !Array.isArray(result.sources) || types.isProxy(result.sources)
      || result.sources.length !== sources.length || sources.length < 1 || sources.length > 64) return undefined;
    const expected = new Map(sources.map(source => [source.apiId, source]));
    if (expected.size !== sources.length) return undefined;
    const artifacts: ValidatedAuditTextArtifact[] = [], storedSources: Record<string, unknown>[] = [];
    let ocrRequiredPageCount = 0;
    for (let index = 0; index < result.sources.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(result.sources, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
      const item: unknown = descriptor.value;
      if (!item || typeof item !== "object" || types.isProxy(item)) return undefined;
      const metadata = Object.getOwnPropertyDescriptors(item);
      const status = metadata.status && Object.hasOwn(metadata.status, "value") ? metadata.status.value : undefined;
      if (!exact(item, status === "EXTRACTED" ? ["sourceFileId", "inputSha256", "status", "artifact"]
        : ["sourceFileId", "inputSha256", "status", "reason"])) return undefined;
      const source = typeof item.sourceFileId === "string" ? expected.get(item.sourceFileId) : undefined;
      if (!source || item.inputSha256 !== source.sha256) return undefined;
      expected.delete(source.apiId);
      if (status === "EXTRACTED") {
        if (source.mediaType !== "application/pdf") return undefined;
        const read = readDocumentTextV3Artifact(item.artifact);
        if (read.status !== "VALID") return undefined;
        const artifact = item.artifact as DocumentTextV3Artifact;
        if (artifact.sourceFileId !== source.apiId || artifact.inputSha256 !== source.sha256
          || artifact.extractorProfileHash !== release.extractorProfileHash
          || canonicalJson(artifact.extractorProfile) !== canonicalJson(release.extractorProfile)) return undefined;
        const canonical = canonicalJson(artifact), contentHash = sha256(canonical), byteSize = Buffer.byteLength(canonical, "utf8");
        const id = randomUUID();
        artifacts.push({ id, source, artifact, canonical, contentHash, byteSize });
        ocrRequiredPageCount += artifact.qualitySummary.ocrRequiredPages;
        storedSources.push({ sourceFileId: source.apiId, inputSha256: source.sha256, status, artifactId: id,
          schemaVersion: artifact.schemaVersion, contentHash, byteSize, artifactContentHash: read.contentHash,
          pageCount: artifact.pageCount, locatedTextPageCount: artifact.locatedTextPageCount,
          unlocatedTextPageCount: artifact.unlocatedTextPageCount, qualitySummary: artifact.qualitySummary,
          extractorProfileHash: artifact.extractorProfileHash });
      } else {
        if (status !== "SKIPPED_UNSUPPORTED_FORMAT" || source.mediaType === "application/pdf"
          || typeof item.reason !== "string" || item.reason.length < 1 || item.reason.length > 500) return undefined;
        storedSources.push({ sourceFileId: source.apiId, inputSha256: source.sha256, status, reason: item.reason });
      }
    }
    if (expected.size || Buffer.byteLength(canonicalJson(result), "utf8") > 8_000_000) return undefined;
    return { artifacts, storedResult: { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", purpose: "SOURCE_AUDIT_ONLY",
      sourceCount: sources.length, extractedCount: artifacts.length, skippedCount: sources.length - artifacts.length,
      ocrRequiredPageCount, ocrScheduled: false, authorityStatus: "SOURCE_DECLARED_UNVERIFIED",
      renderedVisibility: "UNVERIFIED", calibratedProbability: null, sources: storedSources, workerId: result.workerId } };
  } catch { return undefined; }
}
