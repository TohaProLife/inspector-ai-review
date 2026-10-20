import { readFileSync } from "node:fs";
import { types } from "node:util";
import type { DocumentTextV3LargeAuditRelease } from "@inspector-ai/contracts";
import { sha256 } from "./canonical-json.js";
import { normalizeDocumentTextV3LargeCompletion } from "./document-text-v3-large-wire.js";

const schema = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3-large-audit.schema.json", import.meta.url), "utf8"));
const nativeSchema = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3.schema.json", import.meta.url), "utf8"));
const releaseFields = schema.definitions.release.properties as Record<string, { const?: string }>;
const profileFields = nativeSchema.definitions.extractorProfile.properties as Record<string, { const?: string; enum?: string[] }>;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
function compare(left: string, right: string): number {
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const x = left.codePointAt(a)!, y = right.codePointAt(b)!;
    if (x !== y) return x - y;
    a += x > 0xffff ? 2 : 1; b += y > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}
/** Private: input has already passed the fixed callback-free native guard. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable === true && Object.hasOwn(descriptors[key]!, "value"));
}
function currentOption(options: unknown): boolean | undefined {
  if (!options || typeof options !== "object" || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if (keys.length === 0) return false;
  if (keys.length !== 1 || keys[0] !== "requireCurrentProducer") return undefined;
  const descriptor = descriptors.requireCurrentProducer;
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "boolean" ? descriptor.value : undefined;
}
const source = (name: string) => sha256(readFileSync(new URL(`../../../services/worker/inspector_worker/${name}`, import.meta.url)));
/** Resolve actual source bytes at call time. Importing this module needs no worker file. */
export function buildDocumentTextV3LargeAuditReleaseTextLayer(): DocumentTextV3LargeAuditRelease {
  const profile = Object.fromEntries(Object.entries(profileFields).filter(([, field]) => field.const !== undefined).map(([key, field]) => [key, field.const])) as unknown as DocumentTextV3LargeAuditRelease["extractorProfile"];
  profile.textLayerSourceSha256 = source("text_layer.py");
  profile.documentTextV3SourceSha256 = source("document_text_v3.py");
  profile.traversalPolicyVersion = "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1";
  return {
    artifactSchemaVersion: "document-text-v3", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1", resourcePolicyVersion: "document-text-v3-large-source-bounds-v1",
    extractorProfile: profile, extractorProfileHash: sha256(canonical({ hashDomain: "document-text-extractor-profile-v1", profile })),
    processorVersion: "durable-document-text-v3-large-vertical-v1", processorSourceSha256: source("durable_text_v3_large.py"),
    cachePolicyVersion: "durable-text-layer-v3-large-vertical-cache-v1", cacheSourceSha256: source("durable_text_v3_large_cache.py"),
  };
}
/** Historical shape/integrity is separate from fresh current-producer admission.
 * Complete historical manifest/source/job authentication remains the repository's responsibility. */
export function validateDocumentTextV3LargeAuditRelease(value: unknown, options: { requireCurrentProducer?: boolean } = {}): value is DocumentTextV3LargeAuditRelease {
  try {
    const requireCurrent = currentOption(options);
    if (requireCurrent === undefined) return false;
    const native = normalizeDocumentTextV3LargeCompletion({ attemptId: "large-audit-release-guard", fencingToken: 1, result: value });
    if (native.status !== "VALID") return false;
    const release = native.value.result;
    if (!exact(release, Object.keys(releaseFields)) || !exact(release.extractorProfile, Object.keys(profileFields))) return false;
    const profile = release.extractorProfile;
    for (const [key, field] of Object.entries(releaseFields)) {
      if (field.const !== undefined && release[key] !== field.const) return false;
      if ((key.endsWith("Sha256") || key === "extractorProfileHash") && (typeof release[key] !== "string" || !SHA.test(release[key] as string))) return false;
    }
    for (const [key, field] of Object.entries(profileFields)) {
      const item = profile[key];
      if (typeof item !== "string" || field.const !== undefined && item !== field.const || field.enum && !field.enum.includes(item) || key.endsWith("Sha256") && !SHA.test(item)) return false;
    }
    if (profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1" || release.extractorProfileHash !== sha256(canonical({ hashDomain: "document-text-extractor-profile-v1", profile }))) return false;
    return !requireCurrent || canonical(release) === canonical(buildDocumentTextV3LargeAuditReleaseTextLayer());
  } catch { return false; }
}
