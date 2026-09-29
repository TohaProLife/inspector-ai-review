import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyOcrTableRows } from "../src/ocr-table-rows.js";

const stagePath = fileURLToPath(new URL(
  "../../../output/public-index-20260927/f0202-v5-ocr-stage-20260928.json", import.meta.url));
const v1PacketPath = fileURLToPath(new URL(
  "../../../output/public-index-20260927/f0202-v5-ocr-table-review-20260928.json", import.meta.url));
const v2Path = fileURLToPath(new URL(
  "../../../output/public-index-20260927/f0202-v5-ocr-table-rows-v2-20260928.json", import.meta.url));
const stageSha256 = "abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a";
const sourceSha256 = "632379a0e541f0c81e6b03e5528946730b4433939c796db4fdc1e5c3fc8b71ee";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultHash(result: Record<string, unknown>): void {
  const { contentHash: _ignored, ...unhashed } = result;
  result.contentHash = sha256(workerJson(unhashed));
}

function fixtures() {
  const bytes = readFileSync(stagePath);
  expect(sha256(bytes)).toBe(stageSha256);
  const content = JSON.parse(bytes.toString("utf8"));
  const canonical = canonicalJson(content);
  const stage = { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical), provider_profile_id: content.providerProfileId,
    provider_config_hash: content.providerConfigHash,
    input_manifest_hash: content.inputManifestHash };
  expect(stage.content_hash).toBe(stageSha256);
  return { stage, v1: JSON.parse(readFileSync(v1PacketPath, "utf8")).tableRows,
    v2: JSON.parse(readFileSync(v2Path, "utf8")) };
}

const available = [stagePath, v1PacketPath, v2Path].every(existsSync);

describe.skipIf(!available)("independent OCR table v2 verifier on original public F0202 stage", () => {
  it("accepts both explicit versions and only v2 extends right candidate tolerance", () => {
    const { stage, v1, v2 } = fixtures();
    expect(verifyOcrTableRows(v1, stage, stage.input_manifest_hash)).toBe(true);
    expect(verifyOcrTableRows(v2, stage, stage.input_manifest_hash)).toBe(true);
    expect(v2.schemaVersion).toBe("ocr-table-row-proposals-v2");
    expect(v2.profileId).toBe("conservative-ocr-table-rows-v2");
    expect(v2.findingCount).toBe(0);
    expect(v2.ocrStageSha256).toBe(stageSha256);
    expect(v1.proposals).toHaveLength(16);
    expect(v2.proposals).toHaveLength(17);
    expect(v2.proposals.filter((row: { pageNumber: number }) => row.pageNumber === 7)
      .map((row: { labelEvidence: { lineIndex: number }; valueEvidence: { lineIndex: number } }) =>
        [row.labelEvidence.lineIndex, row.valueEvidence.lineIndex]))
      .toContainEqual([42, 44]);
    expect(v2.proposals.filter((row: { pageNumber: number }) => row.pageNumber === 8))
      .toHaveLength(0);
    expect(v2.proposals.filter((row: { pageNumber: number }) => row.pageNumber === 9))
      .toHaveLength(13);
    expect(v2.proposals.every((row: { inputSha256: string }) =>
      row.inputSha256 === sourceSha256)).toBe(true);
  });

  it("rejects version downgrade and profile spoof, even with rewritten content hash", () => {
    const { stage, v2 } = fixtures();
    const downgraded = structuredClone(v2);
    downgraded.schemaVersion = "ocr-table-row-proposals-v1";
    downgraded.profileId = "conservative-ocr-table-rows-v1";
    resultHash(downgraded);
    expect(verifyOcrTableRows(downgraded, stage, stage.input_manifest_hash)).toBe(false);
    const mixed = structuredClone(v2);
    mixed.profileId = "conservative-ocr-table-rows-v1";
    resultHash(mixed);
    expect(verifyOcrTableRows(mixed, stage, stage.input_manifest_hash)).toBe(false);
  });

  it("rejects forged OCR row and stage identity after rehash", () => {
    const { stage, v2 } = fixtures();
    const forged = structuredClone(v2);
    forged.proposals.find((row: { pageNumber: number;
      valueEvidence: { lineIndex: number; text: string } }) =>
      row.pageNumber === 7 && row.valueEvidence.lineIndex === 44)!.valueEvidence.text = "999";
    resultHash(forged);
    expect(verifyOcrTableRows(forged, stage, stage.input_manifest_hash)).toBe(false);
    const wrongStage = structuredClone(v2);
    wrongStage.ocrStageSha256 = "f".repeat(64);
    resultHash(wrongStage);
    expect(verifyOcrTableRows(wrongStage, stage, stage.input_manifest_hash)).toBe(false);
  });
});
