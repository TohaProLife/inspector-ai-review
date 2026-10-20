import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { DocumentTextV4Artifact } from "@inspector-ai/contracts";
import { sha256 } from "./canonical-json.js";
import { readDocumentTextV4FullArtifact } from "./document-text-v4.js";
import { normalizeDocumentTextV4FullCompletion } from "./document-text-v4-full-wire.js";
import { validateDocumentTextV4FullAuditRelease } from "./document-text-v4-full-audit-release.js";

interface Source { id: string; apiId: string; sha256: string; mediaType: string }
const RESOURCE = "document-text-v4-full-source-bounds-v1" as const;
const PROFILE = "SOURCE_AUDIT_V4_FULL_SOURCE_V1" as const;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
export interface ValidatedLargeAuditTextArtifact {
  id: string; source: Source; artifact: DocumentTextV4Artifact;
  canonical: string; contentHash: string; byteSize: number; resourcePolicyVersion: typeof RESOURCE;
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable === true && Object.hasOwn(descriptors[key]!, "value"));
}
function text(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;
  let size = 0;
  for (const character of value) {
    if (++size > maximum) return false;
    const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return size > 0;
}
/** Small scalar metadata only: reject descriptors before field access, not a caller budget. */
function sourceSnapshot(value: unknown): Source[] | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value as object), length: unknown = descriptors.length?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1 || length > 64 || Reflect.ownKeys(descriptors).length !== length + 1) return undefined;
  const result: Source[] = [], ids = new Set<string>(), apiIds = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
    const item: unknown = descriptor.value;
    if (!exact(item, ["id", "apiId", "sha256", "mediaType"]) || !text(item.id, 200) || !text(item.apiId, 200) || typeof item.sha256 !== "string" || !SHA.test(item.sha256) || !text(item.mediaType, 200) || ids.has(item.id) || apiIds.has(item.apiId)) return undefined;
    ids.add(item.id); apiIds.add(item.apiId);
    result.push({ id: item.id, apiId: item.apiId, sha256: item.sha256, mediaType: item.mediaType });
  }
  return result;
}
function compare(left: string, right: string): number {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1; b += y > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}
/** Private: invoked solely on the detached, fixed-policy native snapshot. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Whole result guard precedes reads and uses the exact transport aggregate policy.
 * Repository separately authenticates complete persisted release, lease, manifest and original I/O. */
export function validateDocumentTextV4FullAuditResult(result: unknown, sources: Source[], release: unknown): {
  artifacts: ValidatedLargeAuditTextArtifact[]; storedResult: Record<string, unknown>;
} | undefined {
  try {
    const native = normalizeDocumentTextV4FullCompletion({ attemptId: "large-audit-admission-guard", fencingToken: 1, result });
    if (native.status !== "VALID") return undefined;
    const body = native.value.result;
    const originals = sourceSnapshot(sources);
    if (!originals || !validateDocumentTextV4FullAuditRelease(release, { requireCurrentProducer: true }) || !exact(body, ["disposition", "purpose", "resourcePolicyVersion", "sources", "workerId"]) || body.disposition !== "DOCUMENT_TEXT_LAYER_COMPLETED" || body.purpose !== "SOURCE_AUDIT_ONLY" || body.resourcePolicyVersion !== RESOURCE || !text(body.workerId, 200) || !Array.isArray(body.sources) || body.sources.length !== originals.length) return undefined;
    const expected = new Map(originals.map(source => [source.apiId, source]));
    const artifacts: ValidatedLargeAuditTextArtifact[] = [], storedSources: Record<string, unknown>[] = [];
    let ocrRequiredPageCount = 0;
    for (const item of body.sources) {
      if (!item || typeof item !== "object") return undefined;
      const status: unknown = (item as Record<string, unknown>).status;
      if (!exact(item, status === "EXTRACTED" ? ["sourceFileId", "inputSha256", "status", "artifact"] : ["sourceFileId", "inputSha256", "status", "reason"])) return undefined;
      const source = typeof item.sourceFileId === "string" ? expected.get(item.sourceFileId) : undefined;
      if (!source || item.inputSha256 !== source.sha256) return undefined;
      expected.delete(source.apiId);
      if (status === "EXTRACTED") {
        if (source.mediaType !== "application/pdf") return undefined;
        const read = readDocumentTextV4FullArtifact(item.artifact);
        if (read.status !== "VALID") return undefined;
        const artifact = item.artifact as DocumentTextV4Artifact;
        if (artifact.sourceFileId !== source.apiId || artifact.inputSha256 !== source.sha256 || artifact.extractorProfileHash !== release.extractorProfileHash || canonical(artifact.extractorProfile) !== canonical(release.extractorProfile)) return undefined;
        const encoded = canonical(artifact), contentHash = sha256(encoded), byteSize = Buffer.byteLength(encoded, "utf8"), id = randomUUID();
        artifacts.push({ id, source, artifact, canonical: encoded, contentHash, byteSize, resourcePolicyVersion: RESOURCE });
        ocrRequiredPageCount += artifact.qualitySummary.ocrRequiredPages;
        storedSources.push({ sourceFileId: source.apiId, inputSha256: source.sha256, status, artifactId: id, schemaVersion: artifact.schemaVersion, contentHash, byteSize, resourcePolicyVersion: RESOURCE, artifactContentHash: read.contentHash, pageCount: artifact.pageCount, locatedTextPageCount: artifact.locatedTextPageCount, unlocatedTextPageCount: artifact.unlocatedTextPageCount, qualitySummary: artifact.qualitySummary, extractorProfileHash: artifact.extractorProfileHash });
      } else {
        if (status !== "SKIPPED_UNSUPPORTED_FORMAT" || source.mediaType === "application/pdf" || !text(item.reason, 500)) return undefined;
        storedSources.push({ sourceFileId: source.apiId, inputSha256: source.sha256, status, reason: item.reason });
      }
    }
    if (expected.size) return undefined;
    return { artifacts, storedResult: { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: PROFILE, resourcePolicyVersion: RESOURCE, sourceCount: originals.length, extractedCount: artifacts.length, skippedCount: originals.length - artifacts.length, ocrRequiredPageCount, ocrScheduled: false, authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, sources: storedSources, workerId: body.workerId } };
  } catch { return undefined; }
}
