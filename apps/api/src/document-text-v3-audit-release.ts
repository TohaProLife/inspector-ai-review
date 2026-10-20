import { readFileSync } from "node:fs";
import { types } from "node:util";
import type { DocumentTextV3AuditRelease } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";

const schema = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3-audit.schema.json", import.meta.url), "utf8"));
const nativeSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3.schema.json", import.meta.url), "utf8"));
const releaseFields = schema.definitions.release.properties as Record<string, { const?: string }>;
const profileFields = nativeSchema.definitions.extractorProfile.properties as Record<string, { const?: string; enum?: string[] }>;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const source = (name: string) => sha256(readFileSync(new URL(`../../../services/worker/inspector_worker/${name}`, import.meta.url)));
function plain(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => {
    const descriptor = descriptors[key]; return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
export function buildDocumentTextV3AuditReleaseTextLayer(): DocumentTextV3AuditRelease {
  const profile = Object.fromEntries(Object.entries(profileFields).filter(([, field]) => field.const !== undefined)
    .map(([key, field]) => [key, field.const])) as unknown as DocumentTextV3AuditRelease["extractorProfile"];
  profile.textLayerSourceSha256 = source("text_layer.py");
  profile.documentTextV3SourceSha256 = source("document_text_v3.py");
  profile.traversalPolicyVersion = "pdfminer-analyzed-figures-boxes-flow-none-v1";
  return {
    artifactSchemaVersion: "document-text-v3", purpose: "SOURCE_AUDIT_ONLY", extractorProfile: profile,
    extractorProfileHash: sha256(canonicalJson({ hashDomain: "document-text-extractor-profile-v1", profile })),
    processorVersion: "durable-document-text-v3-v1", processorSourceSha256: source("durable_text_v3.py"),
    cachePolicyVersion: "durable-text-layer-v3-cache-v1", cacheSourceSha256: source("durable_text_v3_cache.py"),
  };
}
/** Shape and integrity do not approve a release. Admission also requires current installed pins;
 * historical reads must authenticate their already committed complete release and source origin.
 */
export function validateDocumentTextV3AuditRelease(value: unknown, options: { requireCurrentProducer?: boolean } = {}): value is DocumentTextV3AuditRelease {
  try {
    if (!plain(value, Object.keys(releaseFields)) || !plain(value.extractorProfile, Object.keys(profileFields))) return false;
    const profile = value.extractorProfile;
    for (const [key, field] of Object.entries(releaseFields)) {
      if (field.const !== undefined && value[key] !== field.const) return false;
      if (key.endsWith("Sha256") || key === "extractorProfileHash")
        if (typeof value[key] !== "string" || !SHA.test(value[key])) return false;
    }
    for (const [key, field] of Object.entries(profileFields)) {
      const item = profile[key];
      if (typeof item !== "string" || field.const !== undefined && item !== field.const
        || field.enum && !field.enum.includes(item) || key.endsWith("Sha256") && !SHA.test(item)) return false;
    }
    if ((profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-whole-lines-v1"
      && profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-v1")
      || value.extractorProfileHash !== sha256(canonicalJson({ hashDomain: "document-text-extractor-profile-v1", profile }))) return false;
    return !options.requireCurrentProducer || canonicalJson(value) === canonicalJson(buildDocumentTextV3AuditReleaseTextLayer());
  } catch { return false; }
}
