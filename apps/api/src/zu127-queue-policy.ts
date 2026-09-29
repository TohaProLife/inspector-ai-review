import type { AnalysisJobType } from "./repository.js";

export const ZU127_POPPLER_V2_PROFILE_ID = "zu127-window-table-poppler-review-v2";
export const ZU127_POPPLER_V2_QUEUE = "rules.evaluate.zu127.poppler-v2";
export const ZU127_GENERIC_V3_PROFILE_ID = "zu127-generic-poppler-page-review-v3";
export const ZU127_GENERIC_V3_QUEUE = "rules.evaluate.zu127.poppler-v3";
export const ZU127_GENERIC_V3_CONFIG_HASH =
  "e593f2298e672177bbeac05cd9b6cda6f4926a3a9260ea3b3c35dbf63010264c";

const EXISTING_JOB_QUEUES: Record<AnalysisJobType, string> = {
  ANALYSIS_INVENTORY: "rules.evaluate",
  DOCUMENT_TEXT_LAYER: "documents.render",
  DOCUMENT_RENDER: "documents.render",
  DOCUMENT_OCR_LAYOUT: "documents.extract",
  DOCUMENT_METADATA: "documents.link",
  DOCUMENT_LINKING: "documents.link",
  ENTITY_EXTRACTION: "documents.extract",
  RULE_EVALUATION: "rules.evaluate",
  EVIDENCE_VALIDATION: "rules.evaluate",
  ANALYSIS_SEAL_UNSUPPORTED: "rules.evaluate",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Route only pinned ZU-127 rule stages to their isolated Poppler workers. */
export function resolveAnalysisJobQueue(jobType: AnalysisJobType, releaseManifest: unknown): string {
  const existingQueue = EXISTING_JOB_QUEUES[jobType];
  if (!existingQueue) throw new Error(`Unknown analysis job type: ${jobType}`);
  if (jobType !== "RULE_EVALUATION") return existingQueue;

  // Historic releases use the existing queue. The special profile requires a
  // complete immutable release slot; a partial or duplicate ZU slot cannot
  // silently fall back to the normal rules worker.
  if (!isRecord(releaseManifest) || !Array.isArray(releaseManifest.providerSlots)) {
    return existingQueue;
  }
  const ruleSlots = releaseManifest.providerSlots.filter((slot) =>
    isRecord(slot) && slot.stageJobType === "RULE_EVALUATION");
  if (ruleSlots.length > 1) throw new Error("Duplicate RULE_EVALUATION provider slots");
  const slot = ruleSlots[0];
  if (!isRecord(slot)) return existingQueue;
  if (typeof slot.profileId === "string" && slot.profileId.startsWith("zu127-")) {
    if (releaseManifest.schemaVersion !== "analysis-release-v1"
      || releaseManifest.lifecycle !== "DRAFT"
      || releaseManifest.externalNetworkAllowed !== false
      || slot.providerKind !== "RULE_ENGINE"
      || slot.status !== "CONFIGURED") {
      throw new Error("Invalid ZU-127 Poppler release slot");
    }
    if (slot.profileId === ZU127_POPPLER_V2_PROFILE_ID) return ZU127_POPPLER_V2_QUEUE;
    if (slot.profileId === ZU127_GENERIC_V3_PROFILE_ID
      && slot.configHash === ZU127_GENERIC_V3_CONFIG_HASH) return ZU127_GENERIC_V3_QUEUE;
    throw new Error("Invalid ZU-127 Poppler profile or config hash");
  }
  return existingQueue;
}

/** Check persisted queue against immutable release before granting a job lease. */
export function assertAnalysisJobQueue(
  jobType: AnalysisJobType,
  claimedQueue: string,
  releaseManifest: unknown,
): void {
  const expectedQueue = resolveAnalysisJobQueue(jobType, releaseManifest);
  if (claimedQueue !== expectedQueue) {
    throw new Error(`Analysis job queue mismatch: expected ${expectedQueue}`);
  }
}
