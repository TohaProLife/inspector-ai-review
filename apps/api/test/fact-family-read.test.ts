import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { projectFactFamilyRead, projectOcrHeatRowsRead } from "../src/pilot-result-read.js";

const manifest = "a".repeat(64);
const config = "b".repeat(64);

function stage() {
  const factFamily = { schemaVersion: "fact-family-proposals-v1",
    inputManifestHash: manifest, objectId: "OBJECT-1", facts: [], comparisons: [],
    outputCount: 0, findingCount: 0, contentHash: "c".repeat(64) };
  const content = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
    inputManifestHash: manifest, disposition: "RULES_EVALUATED", providerKind: "RULE_ENGINE",
    providerProfileId: "typed-pz002-pz017-ocr-heat-fact-family-v1",
    providerConfigHash: config, outputCount: 4,
    ocrHeatRows: { schemaVersion: "ocr-heat-row-proposals-v1",
      profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: manifest,
      proposals: [], abstentions: [], findingCount: 0 }, factFamily };
  const canonical = canonicalJson(content);
  return { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical, "utf8"), schema_version: "analysis-stage-result-v2",
    disposition: "RULES_EVALUATED", provider_profile_id: content.providerProfileId,
    provider_config_hash: config, input_manifest_hash: manifest, output_count: 4,
    job_state: "SUCCEEDED" };
}

describe("scoped fact family read projector", () => {
  it("returns review aid alongside OCR rows without promoting findings", () => {
    const saved = stage();
    expect(projectFactFamilyRead(saved, manifest, config)).toEqual(saved.content_json.factFamily);
    expect(projectOcrHeatRowsRead(saved, manifest, config)).toMatchObject({
      proposalCount: 0, findingCount: 0,
    });
  });

  it("rejects wrong profile, bytes, and config", () => {
    const saved = stage();
    expect(() => projectFactFamilyRead({ ...saved, provider_profile_id: "typed-pz002-pz017-ocr-heat-v1" },
      manifest, config)).toThrow(/integrity/);
    expect(() => projectFactFamilyRead({ ...saved, byte_size: saved.byte_size + 1 },
      manifest, config)).toThrow(/integrity/);
    expect(() => projectFactFamilyRead(saved, manifest, "d".repeat(64))).toThrow(/integrity/);
  });
});
