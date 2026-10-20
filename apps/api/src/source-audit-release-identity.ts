import { canonicalJson, sha256 } from "./canonical-json.js";
import { buildDocumentTextV3AuditReleaseTextLayer } from "./document-text-v3-audit-release.js";
import { buildDocumentTextV3LargeAuditReleaseTextLayer } from "./document-text-v3-large-audit-release.js";
import { buildDocumentTextV4FullAuditReleaseTextLayer } from "./document-text-v4-full-audit-release.js";

// Whole immutable release identities, including provider slots and pinned Python
// sources. A purpose flag alone must never admit a non-current worker attempt.
const slots = [
  ["DOCUMENT_RENDER", "RENDERER"], ["DOCUMENT_OCR_LAYOUT", "OCR_LAYOUT"],
  ["DOCUMENT_METADATA", "METADATA_EXTRACTOR"], ["DOCUMENT_LINKING", "LINKING_POLICY"],
  ["ENTITY_EXTRACTION", "ENTITY_EXTRACTION_MODEL"], ["RULE_EVALUATION", "RULE_ENGINE"],
  ["EVIDENCE_VALIDATION", "EVIDENCE_VALIDATOR"],
] as const;

function identity(prefix: string, textLayer: unknown) {
  const content = {
    schemaVersion: "analysis-release-v1", lifecycle: "DRAFT", externalNetworkAllowed: false,
    purpose: "SOURCE_AUDIT_ONLY", textLayer,
    rules: { catalogVersion: "matrix-132-v1", parameterCount: 132, executionStatus: "UNCONFIGURED" },
    providerSlots: slots.map(([stageJobType, providerKind]) => ({ stageJobType, providerKind,
      status: "UNCONFIGURED", profileId: null, adapterVersion: null, artifactHash: null,
      configHash: null, licenseId: null, resourceProfile: null })),
  };
  const manifest = { ...content, releaseId: `${prefix}:${sha256(canonicalJson(content)).slice(0, 24)}` };
  const canonical = canonicalJson(manifest);
  return Object.freeze({ releaseId: manifest.releaseId, contentHash: sha256(canonical),
    byteSize: Buffer.byteLength(canonical, "utf8"), canonical });
}

export const frozenSourceAuditReleaseIdentities = Object.freeze([
  identity("release:source-audit-v3", buildDocumentTextV3AuditReleaseTextLayer()),
  identity("release:source-audit-v3-large-vertical-v1", buildDocumentTextV3LargeAuditReleaseTextLayer()),
  identity("release:source-audit-v4-full-source-v1", buildDocumentTextV4FullAuditReleaseTextLayer()),
]);

export function isFrozenSourceAuditRelease(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  try {
    const canonical = canonicalJson(manifest);
    return frozenSourceAuditReleaseIdentities.some(expected => expected.canonical === canonical);
  } catch { return false; }
}
