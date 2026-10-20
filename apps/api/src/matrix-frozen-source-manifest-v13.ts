/** Output-only frozen manifest boundary. Scoped SQL must establish row authority. */
import { canonicalJson, sha256 } from "./canonical-json.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";

export class FrozenSourceManifestV13Error extends TypeError {
  readonly code = "SOURCE_MANIFEST_UNVERIFIED";
  constructor() { super("SOURCE_MANIFEST_UNVERIFIED"); }
}

export interface FrozenSourceManifestV13 {
  inspectionId: string;
  inputManifestHash: string;
  sources: Array<{ sourceFileId: string; sha256: string;
    stages: Array<"PD" | "RD" | "ID">; sourceReviewHash: string | null }>;
}

const fail = (): never => { throw new FrozenSourceManifestV13Error(); };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu;
const hash = /^[a-f0-9]{64}(?![\s\S])/u;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function digest(value: unknown): value is string { return typeof value === "string" && hash.test(value); }

/**
 * Pin the existing writer's entire manifest preimage without changing its order.
 * Original stages come only from this immutable body. Current source stages and
 * review eligibility belong to separate contexts and cannot be supplied here.
 * Matching caller-provided bytes and hash alone proves no persisted authority.
 * The caller must bind run, organization, inspection and manifest in scoped SQL;
 * verify full review parents, retained origins, releases and PDFs separately.
 */
export function pinFrozenSourceManifestV13(value: unknown): FrozenSourceManifestV13 {
  assertConcreteWallLeaseNativeV13(value);
  if (!record(value) || !closed(value, ["inspectionId", "inputManifestHash", "manifest"])
    || typeof value.inspectionId !== "string" || !uuid.test(value.inspectionId)
    || !digest(value.inputManifestHash) || !record(value.manifest)
    || !closed(value.manifest, ["inspectionId", "sources"])
    || value.manifest.inspectionId !== value.inspectionId
    || !Array.isArray(value.manifest.sources)
    || value.manifest.sources.length < 1 || value.manifest.sources.length > 64) return fail();
  const seen = new Set<string>();
  for (const source of value.manifest.sources) {
    if (!record(source) || !closed(source, ["sourceFileId", "sha256", "stages", "sourceReviewHash"])
      || typeof source.sourceFileId !== "string" || source.sourceFileId.length === 0
      || seen.has(source.sourceFileId) || !digest(source.sha256)
      || !(source.sourceReviewHash === null || digest(source.sourceReviewHash))
      || !Array.isArray(source.stages) || source.stages.length < 1 || source.stages.length > 3
      || source.stages.some(stage => !["PD", "RD", "ID"].includes(stage))
      || new Set(source.stages).size !== source.stages.length) return fail();
    seen.add(source.sourceFileId);
  }
  const canonical = canonicalJson(value.manifest);
  if (sha256(canonical) !== value.inputManifestHash) return fail();
  const detached = JSON.parse(canonical) as { inspectionId: string; sources: FrozenSourceManifestV13["sources"] };
  return { inspectionId: detached.inspectionId,
    inputManifestHash: value.inputManifestHash, sources: detached.sources };
}
