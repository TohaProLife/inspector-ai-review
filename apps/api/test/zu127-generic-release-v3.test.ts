import { describe, expect, it, vi } from "vitest";
import { buildZu127GenericV3ReleaseManifest,
  PostgresInspectionRepository } from "../src/postgres-repository.js";
import { createInspectionRepositoryFromEnv } from "../src/repository-factory.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { assertAnalysisJobQueue, resolveAnalysisJobQueue,
  ZU127_GENERIC_V3_CONFIG_HASH, ZU127_GENERIC_V3_PROFILE_ID,
  ZU127_GENERIC_V3_QUEUE } from "../src/zu127-queue-policy.js";

describe("ZU-127 generic v3 release preparation", () => {
  it("builds a deterministic, networkless review descriptor for the dedicated queue", () => {
    const first = buildZu127GenericV3ReleaseManifest(132);
    const second = buildZu127GenericV3ReleaseManifest(132);
    expect(first).toEqual(second);
    expect(first.manifest.lifecycle).toBe("DRAFT");
    expect(first.manifest.externalNetworkAllowed).toBe(false);
    expect(first.manifest.rules).toEqual({
      catalogVersion: "matrix-132-v1", parameterCount: 132, executionStatus: "PILOT",
    });
    const rulesSlot = first.manifest.providerSlots.filter((slot) =>
      slot.stageJobType === "RULE_EVALUATION");
    expect(rulesSlot).toHaveLength(1);
    expect(rulesSlot[0]).toMatchObject({
      providerKind: "RULE_ENGINE", status: "CONFIGURED",
      profileId: ZU127_GENERIC_V3_PROFILE_ID,
      adapterVersion: "3", configHash: ZU127_GENERIC_V3_CONFIG_HASH,
      resourceProfile: "CPU",
    });
    expect(first.canonical).toBe(canonicalJson(first.manifest));
    expect(first.contentHash).toBe(sha256(first.canonical));
    expect(first.byteSize).toBe(Buffer.byteLength(first.canonical, "utf8"));
    expect(resolveAnalysisJobQueue("RULE_EVALUATION", first.manifest))
      .toBe(ZU127_GENERIC_V3_QUEUE);
    expect(() => assertAnalysisJobQueue("RULE_EVALUATION", "rules.evaluate", first.manifest))
      .toThrow("queue mismatch");
  });

  it("rejects the profile before opening a repository while its consumer is absent", async () => {
    const create = vi.spyOn(PostgresInspectionRepository, "create")
      .mockResolvedValue({} as PostgresInspectionRepository);
    try {
      await expect(createInspectionRepositoryFromEnv({
        DATABASE_URL: "postgres://unused",
        INSPECTOR_ANALYSIS_PROFILE: "PILOT_PZ002_PZ017",
        INSPECTOR_ZU127_GENERIC_REVIEW_PROFILE: "v3",
      })).rejects.toThrow("dedicated consumer and durable verifier");
      await expect(createInspectionRepositoryFromEnv({
        INSPECTOR_ZU127_GENERIC_REVIEW_PROFILE: "v3",
      })).rejects.toThrow("dedicated consumer and durable verifier");
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });
});
