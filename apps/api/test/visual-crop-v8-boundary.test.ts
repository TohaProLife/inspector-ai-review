import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { validateVisualProposalStageResult, v7SampleVisualProposalConfigHash, v7FullVisualProposalConfigHash,
  v8SampleVisualProposalConfigHash, v8FullVisualProposalConfigHash,
  v8SampleVisualProposalProfile, v8FullVisualProposalProfile } from "../src/visual-proposal.js";
import { pythonAvailable, pythonEnv, pythonExecutable } from "./python.js";

import { visualCropFixtureScript as script } from "./visual-crop-fixture.js";

type Fixture = { result: Record<string, any>; source: { apiId: string; sha256: string; pageCount: number } };
let fixtures: Fixture[] = [];

const validate = (fixture: Fixture) => validateVisualProposalStageResult(fixture.result,
  "a".repeat(64), "OBJ-CROP-V8", [fixture.source], fixture.result.providerProfileId);

describe.skipIf(!pythonAvailable)("versioned displayed-coordinate crop boundary", () => {
  beforeAll(() => {
    const generated = spawnSync(pythonExecutable, ["-c", script], {
      env: { ...process.env, ...pythonEnv }, encoding: "utf8", timeout: 30_000,
    });
    expect(generated.status, generated.stderr).toBe(0);
    fixtures = JSON.parse(generated.stdout);
  }, 35_000);

  it("accepts actual worker v8 SAMPLE/FULL with separately pinned crop method and retains v7", () => {
    expect(fixtures).toHaveLength(4);
    const hashes = [v7SampleVisualProposalConfigHash, v7FullVisualProposalConfigHash,
      v8SampleVisualProposalConfigHash, v8FullVisualProposalConfigHash];
    for (const [index, fixture] of fixtures.entries()) {
      expect(fixture.result.providerConfigHash).toBe(hashes[index]);
      expect(validate(fixture), fixture.result.providerProfileId).toBeDefined();
      expect(fixture.result.outputCount).toBe(3);
      const analysis = fixture.result.analysis;
      expect(analysis.sources[0].vlm.observations).toHaveLength(index % 2 ? 3 : 2);
      if (index >= 2) {
        expect(analysis.schemaVersion).toBe("visual-proposal-analysis-v8");
        expect(analysis.profile.vlmCropMethodId).toBe("normalized-display-square-v2");
        expect(analysis.sources[0].vlm.observations.every((row: Record<string, unknown>) =>
          row.reasonCode === "MODEL_ABSTAIN" && typeof row.cropSha256 === "string")).toBe(true);
      } else expect(analysis.profile).not.toHaveProperty("vlmCropMethodId");
      expect(fixture.result).not.toHaveProperty("findings");
      expect(fixture.result).not.toHaveProperty("coverage");
    }
    expect(v8SampleVisualProposalConfigHash).toBe(sha256(canonicalJson(v8SampleVisualProposalProfile)));
    expect(v8FullVisualProposalConfigHash).toBe(sha256(canonicalJson(v8FullVisualProposalProfile)));
    expect(new Set(hashes).size).toBe(4);
  });

  it("rejects changed crop policy, version, budget, omitted FULL work and semantic claims", () => {
    const mutations: Array<(value: Record<string, any>) => void> = [
      value => { value.analysis.profile.vlmCropMethodId = "normalized-derotated-square-v1"; },
      value => { delete value.analysis.profile.vlmCropMethodId; },
      value => { value.analysis.schemaVersion = "visual-proposal-analysis-v7"; },
      value => { value.analysis.profile.vlmCropMaxEdgePx = 4096; },
      value => { value.providerConfigHash = v7FullVisualProposalConfigHash; },
      value => { value.analysis.sources[0].vlm.observations.pop(); },
      value => { value.analysis.sources[0].skippedPageCount = 1; },
      value => { value.analysis.sources[0].unretainedProposalCount = 1; },
      value => { value.analysis.sources[0].proposals[0].status = "CONFIRMED_VIOLATION"; },
      value => { value.analysis.sources[0].vlm.observations[0].probability = .99; },
      value => { value.findings = [{ violation: true }]; },
    ];
    for (const mutate of mutations) {
      const fixture = structuredClone(fixtures[3]); mutate(fixture.result);
      expect(validate(fixture)).toBeUndefined();
    }
  });
});
