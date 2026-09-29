import { describe, expect, it } from "vitest";
import type { AnalysisJobType } from "../src/repository.js";
import { assertAnalysisJobQueue, resolveAnalysisJobQueue,
  ZU127_POPPLER_V2_PROFILE_ID, ZU127_POPPLER_V2_QUEUE,
  ZU127_GENERIC_V3_PROFILE_ID, ZU127_GENERIC_V3_QUEUE,
  ZU127_GENERIC_V3_CONFIG_HASH } from "../src/zu127-queue-policy.js";
import { ZU127_GENERIC_V3_CONFIG_HASH as WORKER_RESULT_CONFIG_HASH }
  from "../src/zu127-generic-stage-v3.js";

const release = (profileId: string | null = ZU127_POPPLER_V2_PROFILE_ID) => ({
  schemaVersion: "analysis-release-v1",
  lifecycle: "DRAFT",
  externalNetworkAllowed: false,
  providerSlots: [{ stageJobType: "RULE_EVALUATION", providerKind: "RULE_ENGINE",
    status: "CONFIGURED", profileId }],
});

describe("ZU-127 dedicated queue policy", () => {
  it("routes only exact configured ZU-127 v2 RULE_EVALUATION", () => {
    expect(resolveAnalysisJobQueue("RULE_EVALUATION", release())).toBe(ZU127_POPPLER_V2_QUEUE);
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", ZU127_POPPLER_V2_QUEUE, release()))
      .not.toThrow();
  });

  it("routes only exact configured ZU-127 generic v3 to its separate queue", () => {
    const manifest = release(ZU127_GENERIC_V3_PROFILE_ID);
    manifest.providerSlots[0] = { ...manifest.providerSlots[0],
      configHash: ZU127_GENERIC_V3_CONFIG_HASH } as typeof manifest.providerSlots[0];
    expect(ZU127_GENERIC_V3_CONFIG_HASH).toBe(WORKER_RESULT_CONFIG_HASH);
    expect(resolveAnalysisJobQueue("RULE_EVALUATION", manifest)).toBe(ZU127_GENERIC_V3_QUEUE);
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", ZU127_GENERIC_V3_QUEUE, manifest))
      .not.toThrow();
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", "rules.evaluate", manifest))
      .toThrow("queue mismatch");
    expect(() => resolveAnalysisJobQueue("RULE_EVALUATION", release(ZU127_GENERIC_V3_PROFILE_ID)))
      .toThrow("config hash");
  });

  it("keeps normal and historical rule profiles on existing queue", () => {
    for (const manifest of [undefined, {}, release(null), release("typed-pz002-v1"),
      release("typed-pz002-pz017-ocr-heat-v1")]) {
      expect(resolveAnalysisJobQueue("RULE_EVALUATION", manifest)).toBe("rules.evaluate");
      expect(() => assertAnalysisJobQueue("RULE_EVALUATION", "rules.evaluate", manifest))
        .not.toThrow();
    }
  });

  it("keeps every other job on its existing queue even in ZU-127 release", () => {
    const queues: Array<[AnalysisJobType, string]> = [
      ["ANALYSIS_INVENTORY", "rules.evaluate"],
      ["DOCUMENT_TEXT_LAYER", "documents.render"],
      ["DOCUMENT_RENDER", "documents.render"],
      ["DOCUMENT_OCR_LAYOUT", "documents.extract"],
      ["DOCUMENT_METADATA", "documents.link"],
      ["DOCUMENT_LINKING", "documents.link"],
      ["ENTITY_EXTRACTION", "documents.extract"],
      ["EVIDENCE_VALIDATION", "rules.evaluate"],
      ["ANALYSIS_SEAL_UNSUPPORTED", "rules.evaluate"],
    ];
    for (const [jobType, queue] of queues) {
      expect(resolveAnalysisJobQueue(jobType, release())).toBe(queue);
      expect(() => assertAnalysisJobQueue(jobType, queue, release())).not.toThrow();
    }
  });

  it("rejects old and dedicated queue swaps at claim", () => {
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", "rules.evaluate", release()))
      .toThrow("queue mismatch");
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", ZU127_POPPLER_V2_QUEUE,
      release("typed-pz002-v1"))).toThrow("queue mismatch");
    expect(() => assertAnalysisJobQueue("EVIDENCE_VALIDATION", ZU127_POPPLER_V2_QUEUE, release()))
      .toThrow("queue mismatch");
    expect(() => assertAnalysisJobQueue("DOCUMENT_RENDER", "documents.extract", release()))
      .toThrow("queue mismatch");
  });

  it("rejects modified ZU profile, scope, provider, and duplicate rule slot", () => {
    const base = release();
    for (const tampered of [
      { ...base, lifecycle: "SCAFFOLD" },
      { ...base, externalNetworkAllowed: true },
      { ...base, schemaVersion: "analysis-release-v2" },
      { ...base, providerSlots: [{ ...base.providerSlots[0], status: "UNCONFIGURED" }] },
      { ...base, providerSlots: [{ ...base.providerSlots[0], providerKind: "OTHER" }] },
      { ...base, providerSlots: [{ ...base.providerSlots[0], profileId: "zu127-window-table-review-v1" }] },
      { ...base, providerSlots: [...base.providerSlots, { ...base.providerSlots[0] }] },
    ]) {
      expect(() => resolveAnalysisJobQueue("RULE_EVALUATION", tampered)).toThrow();
    }
    expect(() => resolveAnalysisJobQueue("RULE_EVALUATION", {
      ...base, providerSlots: [{ ...base.providerSlots[0], profileId: "zu127-window-table-poppler-review-v3" }],
    })).toThrow();
    expect(() => resolveAnalysisJobQueue("UNKNOWN" as AnalysisJobType, base))
      .toThrow("Unknown analysis job type");
  });
});
