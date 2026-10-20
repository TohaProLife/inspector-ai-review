import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sha256 } from "../src/canonical-json.js";
import { frozenSourceAuditReleaseIdentities, isFrozenSourceAuditRelease } from "../src/source-audit-release-identity.js";

it("accepts exactly the three pinned whole source-audit releases, not a purpose label", () => {
  expect(frozenSourceAuditReleaseIdentities).toHaveLength(3);
  for (const identity of frozenSourceAuditReleaseIdentities) {
    const manifest = JSON.parse(identity.canonical);
    expect(sha256(identity.canonical)).toBe(identity.contentHash);
    expect(Buffer.byteLength(identity.canonical)).toBe(identity.byteSize);
    expect(isFrozenSourceAuditRelease(manifest)).toBe(true);
    for (const mutate of [
      (value: any) => { value.releaseId += "-forged"; },
      (value: any) => { value.rules.parameterCount = 131; },
      (value: any) => { value.providerSlots[0].profileId = "unrelated-model"; },
      (value: any) => { value.textLayer.extractorProfileHash = "0".repeat(64); },
      (value: any) => { value.extra = true; },
    ]) {
      const invalid = structuredClone(manifest); mutate(invalid);
      expect(isFrozenSourceAuditRelease(invalid)).toBe(false);
    }
  }
  expect(isFrozenSourceAuditRelease({ purpose: "SOURCE_AUDIT_ONLY" })).toBe(false);
  expect(isFrozenSourceAuditRelease({ purpose: "ENGINEERING", releaseId: "normal" })).toBe(false);
});

it("keeps the forward repair bound to the same whole frozen releases", () => {
  const sql = readFileSync(new URL("../../../migrations/052_source_audit_side_lane.sql", import.meta.url), "utf8");
  for (const identity of frozenSourceAuditReleaseIdentities) {
    expect(sql).toContain(identity.releaseId);
    expect(sql).toContain(identity.contentHash);
    expect(sql).toContain(String(identity.byteSize));
    expect(sql).toContain(identity.canonical.replaceAll("'", "''"));
  }
});
