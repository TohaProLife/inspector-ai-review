import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyOcrTableRows } from "../src/ocr-table-rows.js";

const stagePath = fileURLToPath(new URL(
  "../../../output/public-index-20260927/f0202-v5-ocr-stage-20260928.json", import.meta.url));
const pythonPath = fileURLToPath(new URL(
  "../../../services/worker/.venv/bin/python", import.meta.url));
const stageSha256 = "abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a";
const v3Sha256 = "c5fc482b5eb90f4782aec25bd16d42d4ad969424a2e610a60f636fafaabea556";

type Json = Record<string, any>;

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rehashPacket(packet: Json): void {
  const { contentHash: _ignored, ...unhashed } = packet;
  packet.contentHash = sha256(workerJson(unhashed));
}

function stageFixture(): Json {
  const bytes = readFileSync(stagePath);
  expect(sha256(bytes)).toBe(stageSha256);
  return JSON.parse(bytes.toString("utf8"));
}

function persisted(stage: Json) {
  const canonical = canonicalJson(stage);
  return { content_json: stage, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical), provider_profile_id: stage.providerProfileId,
    provider_config_hash: stage.providerConfigHash,
    input_manifest_hash: stage.inputManifestHash };
}

function pythonPacket(stage: Json, trustedStageSha256: string): Json {
  const code = [
    "import json, sys",
    "from inspector_worker.ocr_table_rows import extract_ocr_table_rows, PROFILE_ID_V3",
    "stage=json.load(sys.stdin)",
    "result=extract_ocr_table_rows(stage, stage_sha256=sys.argv[1], profile_id=PROFILE_ID_V3)",
    "print(json.dumps(result, ensure_ascii=False, sort_keys=True))",
  ].join("\n");
  const run = spawnSync(pythonPath, ["-c", code, trustedStageSha256], {
    input: JSON.stringify(stage), encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

const available = existsSync(stagePath) && existsSync(pythonPath);

describe.skipIf(!available)("independent OCR table v3 verifier on original public F0202", () => {
  it("matches Python packet, source stage, continuation, counts, and content SHA", () => {
    const stage = stageFixture();
    const envelope = persisted(stage);
    const packet = pythonPacket(stage, envelope.content_hash);
    expect(envelope.content_hash).toBe(stageSha256);
    expect(packet.contentHash).toBe(v3Sha256);
    expect(packet.proposals).toHaveLength(17);
    expect(packet.abstentions).toHaveLength(3);
    expect(packet.findingCount).toBe(0);
    const wrapped = packet.proposals.find((row: Json) =>
      row.pageNumber === 7 && row.valueEvidence.lineIndex === 44);
    expect(wrapped.labelEvidence.lineIndex).toBe(42);
    expect(wrapped.labelContinuationEvidence).toEqual([expect.objectContaining({
      role: "rowLabelContinuation", lineIndex: 45, text: "26°",
    })]);
    expect(packet.proposals.every((row: Json) =>
      Array.isArray(row.labelContinuationEvidence))).toBe(true);
    expect(verifyOcrTableRows(packet, envelope, stage.inputManifestHash)).toBe(true);
  });

  it("rejects forged continuation text, index, score, and packet SHA", () => {
    const stage = stageFixture();
    const envelope = persisted(stage);
    const packet = pythonPacket(stage, envelope.content_hash);
    const wrappedIndex = packet.proposals.findIndex((row: Json) =>
      row.pageNumber === 7 && row.valueEvidence.lineIndex === 44);
    for (const [field, value] of [
      ["text", "-26°"], ["lineIndex", 46], ["score", 0.81],
    ] as const) {
      const altered = structuredClone(packet);
      altered.proposals[wrappedIndex].labelContinuationEvidence[0][field] = value;
      rehashPacket(altered);
      expect(verifyOcrTableRows(altered, envelope, stage.inputManifestHash)).toBe(false);
    }
    const forgedHash = structuredClone(packet);
    forgedHash.contentHash = "f".repeat(64);
    expect(verifyOcrTableRows(forgedHash, envelope, stage.inputManifestHash)).toBe(false);
    const forgedStage = structuredClone(packet);
    forgedStage.ocrStageSha256 = "f".repeat(64);
    rehashPacket(forgedStage);
    expect(verifyOcrTableRows(forgedStage, envelope, stage.inputManifestHash)).toBe(false);
  });

  it("matches Python ambiguity and low-score abstentions after stage rehash", () => {
    for (const change of ["ambiguous", "low-score"] as const) {
      const stage = stageFixture();
      const page = stage.analysis.sources[0].pages.find((item: Json) => item.pageNumber === 7);
      if (change === "ambiguous") {
        page.lines.push({ text: "-25°", bboxPx: [207, 713, 253, 740], score: 0.97 });
      } else {
        page.lines[45].score = 0.79;
      }
      const { contentHash: _ignored, ...unhashed } = page;
      page.contentHash = sha256(canonicalJson(unhashed));
      const envelope = persisted(stage);
      const packet = pythonPacket(stage, envelope.content_hash);
      expect(packet.proposals.some((row: Json) =>
        row.pageNumber === 7 && row.valueEvidence.lineIndex === 44)).toBe(false);
      expect(packet.abstentions).toContainEqual(expect.objectContaining({
        pageNumber: 7, lineIndex: 44,
        reasonCode: change === "ambiguous"
          ? "ROW_LABEL_CONTINUATION_AMBIGUOUS" : "OCR_SCORE_TOO_LOW",
      }));
      expect(verifyOcrTableRows(packet, envelope, stage.inputManifestHash)).toBe(true);
    }
  });

  it("keeps v2 envelope separate from v3 even after rehash", () => {
    const stage = stageFixture();
    const envelope = persisted(stage);
    const packet = pythonPacket(stage, envelope.content_hash);
    const downgraded = structuredClone(packet);
    downgraded.schemaVersion = "ocr-table-row-proposals-v2";
    downgraded.profileId = "conservative-ocr-table-rows-v2";
    rehashPacket(downgraded);
    expect(verifyOcrTableRows(downgraded, envelope, stage.inputManifestHash)).toBe(false);
  });
});
