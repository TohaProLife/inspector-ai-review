import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyGeometryPageFrameV2,
  verifyGeometryPageFrameV2AgainstRawPage } from "../src/geometry-page-frame-v2.js";

function pdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 123.456789 100] /CropBox [20 10 100 90] /Resources << >> >>",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

async function fixture(): Promise<{ input: Parameters<typeof verifyGeometryPageFrameV2>[0]; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-frame-v2-"));
  try {
    const sourceBytes = pdf();
    const path = join(directory, "source.pdf");
    await writeFile(path, sourceBytes);
    const version = spawnSync("pdftoppm", ["-v"], { encoding: "utf8", timeout: 5_000 });
    assert.equal(version.status, 0);
    const parsed = /^pdftoppm version (\d+\.\d+\.\d+)\s*$/m.exec(
      `${version.stdout}\n${version.stderr}`)?.[1];
    assert.ok(parsed);
    const target = join(directory, "page");
    const rendered = spawnSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "72", "-cropbox",
      "-png", "-singlefile", path, target], { encoding: "utf8", timeout: 30_000 });
    assert.equal(rendered.status, 0);
    const renderBytes = await readFile(`${target}.png`);
    const packet = {
      schemaVersion: "geometry-page-frame-v2", status: "ABSTAIN",
      reasonCode: "PAGE_FRAME_PRECISION_UNRESOLVED",
      source: { sourceFileId: "SYNTHETIC", sourceSha256: sha256(sourceBytes),
        byteSize: sourceBytes.length, pdfPageNumber: 1 },
      render: { rendererProfileId: `poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@${parsed}`,
        renderSha256: sha256(renderBytes), byteSize: renderBytes.length,
        widthPx: renderBytes.readUInt32BE(16), heightPx: renderBytes.readUInt32BE(20) },
      workerFrame: { mediaBox: [0, 0, 123.456789, 100], cropBox: [20, 10, 100, 90], rotate: 0 },
      parserPrecision: { profileId: "poppler-pdfinfo-box-2dp-v1", boxStepPt: 0.01 },
      candidates: [],
    };
    return { input: { artifact: { content_json: packet,
      content_hash: sha256(canonicalJson(packet)) }, sourceBytes, renderBytes },
    cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function rehash(input: Parameters<typeof verifyGeometryPageFrameV2>[0]): void {
  input.artifact.content_hash = sha256(canonicalJson(input.artifact.content_json));
}

test("independently accepts only an ABSTAIN frame within documented print precision", async () => {
  const { input, cleanup } = await fixture();
  try {
    assert.equal(await verifyGeometryPageFrameV2(input), true);
    assert.equal(await verifyGeometryPageFrameV2AgainstRawPage(input), false);
    const packet = input.artifact.content_json as any;
    packet.workerFrame.mediaBox[2] = Math.fround(123.456789);
    rehash(input);
    assert.equal(await verifyGeometryPageFrameV2AgainstRawPage(input), true);
    packet.workerFrame.mediaBox[2] = 123.454;
    rehash(input);
    assert.equal(await verifyGeometryPageFrameV2(input), false);
  } finally { await cleanup(); }
});

test("rejects proposals, changed source, render, profile and precision", async () => {
  const { input, cleanup } = await fixture();
  try {
    const original = structuredClone(input.artifact.content_json);
    const changes: Array<(packet: any) => void> = [
      (packet) => { packet.status = "PROPOSAL"; },
      (packet) => { packet.candidates.push({ geometry: [0, 0] }); },
      (packet) => { packet.source.pdfPageNumber = 2; },
      (packet) => { packet.workerFrame.rotate = 90; },
      (packet) => { packet.parserPrecision.boxStepPt = 1; },
      (packet) => { packet.render.rendererProfileId += "-forged"; },
      (packet) => { packet.worldCrs = "EPSG:3857"; },
    ];
    for (const change of changes) {
      input.artifact.content_json = structuredClone(original);
      change(input.artifact.content_json);
      rehash(input);
      assert.equal(await verifyGeometryPageFrameV2(input), false);
    }
    input.artifact.content_json = original;
    rehash(input);
    const altered = Buffer.from(input.renderBytes);
    altered[altered.length - 20] ^= 1;
    assert.equal(await verifyGeometryPageFrameV2({ ...input, renderBytes: altered }), false);
    const changedSource = Buffer.from(input.sourceBytes);
    changedSource[20] ^= 1;
    assert.equal(await verifyGeometryPageFrameV2({ ...input, sourceBytes: changedSource }), false);
  } finally { await cleanup(); }
});

const publicFixturePdf = process.env.INSPECTOR_GEOMETRY_FRAME_V2_PUBLIC_PDF;
const publicFixturePacket = process.env.INSPECTOR_GEOMETRY_FRAME_V2_PUBLIC_PACKET;
const publicFixtureRender = process.env.INSPECTOR_GEOMETRY_FRAME_V2_PUBLIC_RENDER;
test.skipIf(!publicFixturePdf || !publicFixturePacket || !publicFixtureRender)(
  "independently verifies worker packet on allowed original F0126 page 17", async () => {
    assert.ok(publicFixturePdf && publicFixturePacket && publicFixtureRender);
    const sourceBytes = await readFile(publicFixturePdf);
    assert.equal(sha256(sourceBytes),
      "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088");
    const renderBytes = await readFile(publicFixtureRender);
    const packet = JSON.parse(await readFile(publicFixturePacket, "utf8"));
    assert.equal(sha256(canonicalJson(packet)),
      "f14cc7b1b95e29a33dc2425ffa9da10454a72fdfb7d6d7d1125ed4996c2111f5");
    assert.equal(packet.source.pdfPageNumber, 17);
    assert.equal(packet.status, "ABSTAIN");
    assert.equal(packet.candidates.length, 0);
    assert.equal(await verifyGeometryPageFrameV2({
      artifact: { content_json: packet, content_hash: sha256(canonicalJson(packet)) },
      sourceBytes, renderBytes,
    }), true);
    assert.equal(await verifyGeometryPageFrameV2AgainstRawPage({
      artifact: { content_json: packet, content_hash: sha256(canonicalJson(packet)) },
      sourceBytes, renderBytes,
    }), true);
  });
