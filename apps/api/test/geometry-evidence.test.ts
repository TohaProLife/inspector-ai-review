import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyGeometryEvidence,
  type GeometryEvidenceVerificationInput } from "../src/geometry-evidence.js";

// Generated once by Python worker's PyMuPDF synthetic PDF fixture. Includes
// cropped pages at 0, 90, 180 and 270 degrees, PNG renders, and vector item SHA.
const pythonFixtureBrotliBase64 = "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";

function fixture(index: number): GeometryEvidenceVerificationInput {
  const rows = JSON.parse(brotliDecompressSync(Buffer.from(
    pythonFixtureBrotliBase64, "base64")).toString("utf8")) as any[];
  const row = rows[index];
  return { artifact: { content_json: row.record,
    content_hash: sha256(canonicalJson(row.record)) },
  sourceBytes: Buffer.from(row.pdf, "base64"),
  renderBytes: Buffer.from(row.png, "base64"),
  trustedPageInspection: row.inspection };
}
function rehash(input: GeometryEvidenceVerificationInput): void {
  input.artifact.content_hash = sha256(canonicalJson(input.artifact.content_json));
}

test("verifies Python geometry proposal and abstention across cropped rotations", () => {
  const proposal = fixture(0);
  assert.equal((proposal.artifact.content_json as any).candidates.length, 2);
  assert.equal(verifyGeometryEvidence(proposal), true);
  for (const rotation of [90, 180, 270]) {
    const abstention = fixture(rotation / 90);
    assert.equal((abstention.artifact.content_json as any).status, "ABSTAIN");
    assert.equal(verifyGeometryEvidence(abstention), true);
  }
});

test("rejects rehashed forged page frame, render, geometry and classification", () => {
  const changes: Array<(input: GeometryEvidenceVerificationInput) => void> = [
    (input) => { (input.artifact.content_json as any).pageFrame.rotate = 180; },
    (input) => { (input.artifact.content_json as any).pageFrame.cropBox[0] += 1; },
    (input) => { (input.artifact.content_json as any).pageFrame.nativeToVisible[1] = -1; },
    (input) => { (input.artifact.content_json as any).render.widthPx += 1; },
    (input) => { (input.artifact.content_json as any).render.renderSha256 = "0".repeat(64); },
    (input) => { (input.artifact.content_json as any).source.byteSize += 1; },
    (input) => { (input.artifact.content_json as any).source.pdfPageNumber = 2; },
    (input) => { (input.artifact.content_json as any).candidates[0].geometry.coordinates[0][0] = 2; },
    (input) => { (input.artifact.content_json as any).candidates[0].geometry.coordinates =
      [[0.1, 0.1], [0.9, 0.8], [0.1, 0.8], [0.9, 0.1]]; },
    (input) => { (input.artifact.content_json as any).candidates[1].provenance.pathSha256 = "0".repeat(64); },
    (input) => { (input.artifact.content_json as any).worldCrs = "EPSG:3857"; },
    (input) => { (input.artifact.content_json as any).status = "PASS"; },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture(0); change(input); rehash(input);
    assert.equal(verifyGeometryEvidence(input), false, `tamper ${index}`);
  }
});

test("rejects altered bytes, forged independent inspection and missing mask", () => {
  const alteredPdf = fixture(0);
  alteredPdf.sourceBytes[100] ^= 1;
  assert.equal(verifyGeometryEvidence(alteredPdf), false);
  const alteredPng = fixture(0);
  alteredPng.renderBytes[50] ^= 1;
  assert.equal(verifyGeometryEvidence(alteredPng), false);
  const alteredInspection = fixture(0);
  alteredInspection.trustedPageInspection.cropBox[0] += 1;
  assert.equal(verifyGeometryEvidence(alteredInspection), false);
  const alteredRenderInspection = fixture(0);
  alteredRenderInspection.trustedPageInspection.renderSha256 = "0".repeat(64);
  assert.equal(verifyGeometryEvidence(alteredRenderInspection), false);
  const forgedVectorLocator = fixture(0);
  delete forgedVectorLocator.trustedPageInspection.vectorItemSha256ByLocator["0:0"];
  assert.equal(verifyGeometryEvidence(forgedVectorLocator), false);
  const missingMask = fixture(0);
  (missingMask.artifact.content_json as any).candidates[0].provenance = {
    kind: "RASTER_MASK", maskSha256: sha256(missingMask.renderBytes),
    renderSha256: sha256(missingMask.renderBytes), widthPx: 160, heightPx: 70 };
  rehash(missingMask);
  assert.equal(verifyGeometryEvidence(missingMask), false);
  missingMask.maskBytesBySha = { [sha256(missingMask.renderBytes)]: missingMask.renderBytes };
  assert.equal(verifyGeometryEvidence(missingMask), true);
});
