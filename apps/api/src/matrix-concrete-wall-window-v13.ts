/** OUTPUT ONLY. Closed transport consistency; no persisted/PDF authority. */
import { matrixFactScopeSchema } from "@inspector-ai/contracts";
import {
  assertConcreteWallLeaseNativeV13, assertConcreteWallOriginsNativeV1,
} from "./matrix-concrete-wall-native-v13.js";

export type ConcreteWallV13ConsistencyCode = "INVALID_INPUT" | "INPUT_LIMIT"
  | "SOURCE_PROVENANCE_UNVERIFIED" | "TARGET_UNVERIFIED";
export class ConcreteWallV13ConsistencyError extends Error {
  constructor(readonly code: ConcreteWallV13ConsistencyCode) { super(code); this.name = "ConcreteWallV13ConsistencyError"; }
}
export function failConcreteWallV13(code: ConcreteWallV13ConsistencyCode = "INVALID_INPUT"): never {
  throw new ConcreteWallV13ConsistencyError(code);
}
type Plain = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}(?![\s\S])/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu;
const RULE = "matrix-kr-055-concrete_class";
const FLOOR = "CONCRETE_WALL_FLOOR_SCOPE_V1";
export function plainConcreteWallV13(x: unknown): x is Plain { return x !== null && typeof x === "object" && !Array.isArray(x); }
export function exactConcreteWallV13(x: unknown, keys: readonly string[]): x is Plain {
  return plainConcreteWallV13(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
}
export function sameConcreteWallV13(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => sameConcreteWallV13(v, b[i]));
  if (!plainConcreteWallV13(a) || !plainConcreteWallV13(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameConcreteWallV13(a[k], b[k]));
}
const text = (x: unknown, max: number, min = 1): x is string => typeof x === "string" && x.length >= min && x.length <= max;
const hash = (x: unknown): x is string => typeof x === "string" && HASH.test(x);
const uuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
const stages = (x: unknown): boolean => Array.isArray(x) && x.length >= 1 && x.length <= 3
  && x.every(s => typeof s === "string" && ["PD", "RD", "ID"].includes(s)) && new Set(x).size === x.length;
const pages = (x: unknown): boolean => plainConcreteWallV13(x) && Object.keys(x).length <= 512
  && Object.entries(x).every(([k, v]) => /^[1-9][0-9]*(?![\s\S])/u.test(k)
    && typeof v === "string" && ["PD", "RD", "ID", "UNRESOLVED"].includes(v));
const targetKeys = ["checkId", "executionContentHash", "observationId", "evidenceHash", "textArtifactHash"];
const target = (x: unknown): boolean => exactConcreteWallV13(x, targetKeys) && text(x.checkId, 120)
  && targetKeys.slice(1).every(k => hash(x[k]));
const sourceKeys = ["sourceFileId", "sha256", "stages", "sectionCode", "byteSize", "mediaType", "downloadPath"];
const decisionKeys = ["sourceSha256", "revisionStatus", "approvalStatus", "linkGroupId", "sectionCode", "pageStages", "basis", "scopeProofs", "reviewDecisionId", "reviewContentHash"];
const proofKeys = ["schemaVersion", "bindings", "sourceFileId", "sourceSha256", "objectId", "inputManifestHash", "reviewDecisionId", "reviewContentHash", "status", "reference"];
const recordKeys = ["sourceFileId", "sourceSha256", "target", "objectId", "inputManifestHash", "originalStages", "originalPageStages"];
export function isConcreteWallClaimV13(binding: Plain, fact?: Plain): boolean {
  const contexts = binding.contexts as Plain;
  const element = contexts.ELEMENT_IDENTITY;
  return Object.hasOwn(contexts, FLOOR)
    || (plainConcreteWallV13(element) && element.componentRole === "MONOLITHIC_LOAD_BEARING_WALL")
    || (fact !== undefined && (fact.extractorVersion === "matrix-concrete-wall-prose-v1"
      || (typeof fact.rawText === "string" && /класс бетона по прочности на сжатие для стен/iu.test(fact.rawText))));
}

export function validateConcreteWallWindowV13(raw: unknown): Plain {
  // Descriptor-first entire native value, then the separately capped subtree.
  assertConcreteWallLeaseNativeV13(raw);
  if (!exactConcreteWallV13(raw, ["objectId", "runId", "inputManifestHash", "releaseId", "inputs"])
    || !uuid(raw.objectId) || !uuid(raw.runId) || !hash(raw.inputManifestHash) || !text(raw.releaseId, 200)) failConcreteWallV13();
  const inputs = raw.inputs;
  if (!plainConcreteWallV13(inputs) || !["sourceFiles", "sourceDecisions", "concreteWallOriginsV1"].every(k => Object.hasOwn(inputs, k))
    || Object.keys(inputs).some(k => !["sourceFiles", "sourceDecisions", "concreteWallOriginsV1", "reviewedEntityLinks"].includes(k))) failConcreteWallV13();
  const files = inputs.sourceFiles, decisions = inputs.sourceDecisions, origins = inputs.concreteWallOriginsV1;
  if (!Array.isArray(files) || files.length < 1 || files.length > 64 || !plainConcreteWallV13(decisions)
    || Object.keys(decisions).length > 64) failConcreteWallV13();
  assertConcreteWallOriginsNativeV1(origins);
  if (!exactConcreteWallV13(origins, ["schemaVersion", "records"])
    || origins.schemaVersion !== "matrix-concrete-wall-origin-contexts-v1" || !Array.isArray(origins.records)) failConcreteWallV13();
  if (origins.records.length > 2) failConcreteWallV13("INPUT_LIMIT");
  const sources = new Map<string, Plain>();
  for (const source of files) {
    if (!exactConcreteWallV13(source, sourceKeys) || !text(source.sourceFileId, 200) || !hash(source.sha256)
      || !stages(source.stages) || !(source.sectionCode === null || typeof source.sectionCode === "string")
      || typeof source.byteSize !== "number" || !Number.isSafeInteger(source.byteSize)
      || source.byteSize < (source.mediaType === "application/pdf" ? 5 : 1) || source.byteSize > 67_108_864
      || !text(source.mediaType, 200) || !text(source.downloadPath, 2000) || sources.has(source.sourceFileId)) failConcreteWallV13();
    sources.set(source.sourceFileId, source);
  }
  if (Object.hasOwn(inputs, "reviewedEntityLinks") && (!Array.isArray(inputs.reviewedEntityLinks)
    || inputs.reviewedEntityLinks.some(x => !plainConcreteWallV13(x)))) failConcreteWallV13();
  const bindings: Array<{ sourceId: string; binding: Plain }> = [];
  const proofs: Array<{ sourceId: string; decision: Plain; proof: Plain }> = [];
  // Complete closed primitive shapes BEFORE association mismatches.
  for (const [sourceId, decision] of Object.entries(decisions)) {
    if (!text(sourceId, 200) || !exactConcreteWallV13(decision, decisionKeys) || !hash(decision.sourceSha256)
      || !uuid(decision.reviewDecisionId) || !hash(decision.reviewContentHash)
      || typeof decision.revisionStatus !== "string" || !["UNKNOWN", "CURRENT", "SUPERSEDED"].includes(decision.revisionStatus)
      || typeof decision.approvalStatus !== "string" || !["UNKNOWN", "APPROVED", "UNAPPROVED"].includes(decision.approvalStatus)
      || !(decision.linkGroupId === null || text(decision.linkGroupId, 120))
      || !(decision.sectionCode === null || typeof decision.sectionCode === "string") || !pages(decision.pageStages)
      || !exactConcreteWallV13(decision.basis, ["reference"]) || !text(decision.basis.reference, 1000, 8)
      || !plainConcreteWallV13(decision.scopeProofs)) failConcreteWallV13();
    for (const [key, proof] of Object.entries(decision.scopeProofs)) {
      if (!plainConcreteWallV13(proof)) failConcreteWallV13();
      if (key !== "FACT_BINDINGS") continue; // Existing unchanged downstream validators own inherited proofs.
      if (!exactConcreteWallV13(proof, proofKeys) || proof.schemaVersion !== "matrix-fact-scopes-v1"
        || proof.status !== "VERIFIED" || proof.reference !== "Authenticated fact bindings; original evidence reviewed"
        || !text(proof.sourceFileId, 200) || !hash(proof.sourceSha256) || !uuid(proof.objectId)
        || !hash(proof.inputManifestHash) || !uuid(proof.reviewDecisionId) || !hash(proof.reviewContentHash)
        || !Array.isArray(proof.bindings) || proof.bindings.length > 500) failConcreteWallV13();
      const inherited = { schemaVersion: proof.schemaVersion, bindings: proof.bindings };
      const parsed = matrixFactScopeSchema.safeParse(inherited);
      if (!parsed.success) failConcreteWallV13();
      for (let i = 0; i < proof.bindings.length; i++) {
        const binding = proof.bindings[i] as Plain, decoded = parsed.data.bindings[i];
        // Human descriptions retain raw legacy bytes. Immutable target/source
        // identity must never be silently trimmed by generic Zod parsing.
        if (!sameConcreteWallV13(binding.target, decoded.target)) failConcreteWallV13();
        for (const [name, context] of Object.entries(binding.contexts as Plain)) {
          const original = context as Plain;
          if (!Object.hasOwn(original, "projectZeroAuthority")) continue;
          const authority = original.projectZeroAuthority as Plain;
          const normalized = decoded.contexts[name]?.projectZeroAuthority;
          if (!normalized || !sameConcreteWallV13(authority.target, normalized.target)
            || authority.sourceFileId !== normalized.sourceFileId) failConcreteWallV13();
        }
        // Exactly the frozen wall clean shape, only for a wall family. PZ and
        // other generic siblings are not subjected to wall-only restrictions.
        if (isConcreteWallClaimV13(binding) && !sameConcreteWallV13(binding, decoded)) failConcreteWallV13();
      }
      proofs.push({ sourceId, decision, proof });
      for (const binding of proof.bindings) bindings.push({ sourceId, binding: binding as Plain });
    }
  }
  const records = origins.records as Plain[];
  for (const record of records) if (!exactConcreteWallV13(record, recordKeys) || !text(record.sourceFileId, 200)
    || !hash(record.sourceSha256) || !target(record.target) || !uuid(record.objectId) || !hash(record.inputManifestHash)
    || !stages(record.originalStages) || !pages(record.originalPageStages)) failConcreteWallV13();
  for (const [sourceId, decision] of Object.entries(decisions)) if (!sources.has(sourceId)
    || sources.get(sourceId)!.sha256 !== (decision as Plain).sourceSha256) failConcreteWallV13("SOURCE_PROVENANCE_UNVERIFIED");
  for (const { sourceId, decision, proof } of proofs) if (proof.sourceFileId !== sourceId
    || proof.sourceSha256 !== decision.sourceSha256 || proof.objectId !== raw.objectId
    || proof.inputManifestHash !== raw.inputManifestHash || proof.reviewDecisionId !== decision.reviewDecisionId
    || proof.reviewContentHash !== decision.reviewContentHash) failConcreteWallV13("SOURCE_PROVENANCE_UNVERIFIED");
  for (const record of records) if (record.objectId !== raw.objectId || !sources.has(record.sourceFileId as string)
    || record.sourceSha256 !== sources.get(record.sourceFileId as string)!.sha256) failConcreteWallV13("TARGET_UNVERIFIED");
  if (new Set(records.map(r => r.sourceFileId)).size !== records.length || new Set(records.map(r => r.sourceSha256)).size !== records.length
    || new Set(records.map(r => r.inputManifestHash)).size > 1) failConcreteWallV13("TARGET_UNVERIFIED");
  for (const record of records) if (bindings.filter(b => b.sourceId === record.sourceFileId && sameConcreteWallV13(b.binding.target, record.target)).length !== 1) failConcreteWallV13("TARGET_UNVERIFIED");
  for (const { sourceId, binding } of bindings) if (isConcreteWallClaimV13(binding)) {
    if (binding.ruleId !== RULE || binding.ruleVersion !== "1" || binding.parameterCode !== "KR-055"
      || records.filter(r => r.sourceFileId === sourceId && sameConcreteWallV13(r.target, binding.target)).length !== 1) failConcreteWallV13("TARGET_UNVERIFIED");
  }
  return structuredClone(raw);
}

export function projectConcreteWallWindowV13(lease: unknown): Plain {
  assertConcreteWallLeaseNativeV13(lease);
  if (!plainConcreteWallV13(lease) || !plainConcreteWallV13(lease.inputs)
    || !["objectId", "runId", "inputManifestHash", "releaseId"].every(k => Object.hasOwn(lease, k))
    || !["sourceFiles", "sourceDecisions", "concreteWallOriginsV1"].every(k => Object.hasOwn(lease.inputs as Plain, k))) failConcreteWallV13();
  const inputs: Plain = {};
  const sourceInputs = lease.inputs as Plain;
  for (const key of ["sourceFiles", "sourceDecisions", "concreteWallOriginsV1", "reviewedEntityLinks"]) {
    if (Object.hasOwn(sourceInputs, key)) inputs[key] = sourceInputs[key];
  }
  return validateConcreteWallWindowV13({ objectId: lease.objectId, runId: lease.runId,
    inputManifestHash: lease.inputManifestHash, releaseId: lease.releaseId, inputs });
}
