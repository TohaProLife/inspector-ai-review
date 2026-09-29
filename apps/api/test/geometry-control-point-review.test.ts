import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { reviewGeometryControlPointsV1,
  type GeometryControlPointReviewV1Input } from "../src/geometry-control-point-review.js";

function pdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [10 10 90 90] /Resources << >> >>",
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

async function fixture(): Promise<{ input: GeometryControlPointReviewV1Input;
  review: any; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-control-review-"));
  try {
    const sourceBytes = pdf();
    const pdfPath = join(directory, "source.pdf");
    await writeFile(pdfPath, sourceBytes);
    const version = spawnSync("pdftoppm", ["-v"], { encoding: "utf8", timeout: 5_000 });
    assert.equal(version.status, 0);
    const parsed = /^pdftoppm version (\d+\.\d+\.\d+)\s*$/m.exec(
      `${version.stdout}\n${version.stderr}`)?.[1];
    assert.ok(parsed);
    const target = join(directory, "page");
    const rendered = spawnSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "72", "-cropbox",
      "-png", "-singlefile", pdfPath, target], { encoding: "utf8", timeout: 30_000 });
    assert.equal(rendered.status, 0);
    const renderBytes = await readFile(`${target}.png`);
    const sourceSha256 = sha256(sourceBytes);
    const renderSha256 = sha256(renderBytes);
    const rendererProfileId = `poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@${parsed}`;
    const frame = {
      schemaVersion: "geometry-page-frame-v2", status: "ABSTAIN",
      reasonCode: "PAGE_FRAME_PRECISION_UNRESOLVED",
      source: { sourceFileId: "SYNTHETIC", sourceSha256,
        byteSize: sourceBytes.length, pdfPageNumber: 1 },
      render: { rendererProfileId, renderSha256, byteSize: renderBytes.length,
        widthPx: renderBytes.readUInt32BE(16), heightPx: renderBytes.readUInt32BE(20) },
      workerFrame: { mediaBox: [0, 0, 100, 100], cropBox: [10, 10, 90, 90], rotate: 0 },
      parserPrecision: { profileId: "poppler-pdfinfo-box-2dp-v1", boxStepPt: 0.01 },
      candidates: [],
    };
    const frameHash = sha256(canonicalJson(frame));
    const pageEvidence = { sourceSha256, pdfPageNumber: 1, locator: "synthetic page mark" };
    const points = [[0, 0], [80, 0], [0, 80], [80, 80]].map((page, i) => ({
      id: `P${i}`, evidenceRef: `synthetic-${i}`, page,
      project: [page[0] * 2, page[1] * 2], pageEvidence,
      projectEvidence: { sourceSha256, pdfPageNumber: 1, locator: `synthetic coordinate ${i}` },
    }));
    const review = {
      schemaVersion: "geometry-control-point-review-v1", frameContentHash: frameHash,
      source: { sourceFileId: "SYNTHETIC", sourceSha256, pdfPageNumber: 1 },
      render: { rendererProfileId, renderSha256, widthPx: frame.render.widthPx,
        heightPx: frame.render.heightPx },
      decision: { action: "CONFIRM", decisionId: "synthetic-decision", actorId: "reviewer-1",
        decidedAt: "2026-09-28T12:00:00Z", reason: "synthetic contract exercise" },
      targetFrame: { kind: "LOCAL_2D", frameId: "synthetic-grid", unit: "m",
        xAxis: "RIGHT", yAxis: "DOWN", minScale: 0.1, maxScale: 10,
        crsMetadata: null, frameEvidence: pageEvidence },
      controlPoints: points,
    };
    const input: GeometryControlPointReviewV1Input = {
      frame: { artifact: { content_json: frame, content_hash: frameHash },
        sourceBytes, renderBytes },
      reviewArtifact: { content_json: review, content_hash: sha256(canonicalJson(review)) },
      authenticatedActorId: "reviewer-1",
    };
    return { input, review, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function rehash(input: GeometryControlPointReviewV1Input): void {
  input.reviewArtifact.content_hash = sha256(canonicalJson(input.reviewArtifact.content_json));
}

test("synthetic reviewer confirmation remains review-only with empty findings and null coverage", async () => {
  const { input, cleanup } = await fixture();
  try {
    const output = await reviewGeometryControlPointsV1(input);
    assert.equal(output.status, "CONFIRMED_REVIEW_ONLY");
    assert.equal(output.reasonCode, "HUMAN_REVIEW_CONFIRMED_REGISTRATION_PENDING");
    assert.equal(output.reviewContentHash, input.reviewArtifact.content_hash);
    assert.equal(output.reviewedControlPoints?.length, 4);
    assert.deepEqual(output.findings, []);
    assert.equal(output.coverage, null);
  } finally { await cleanup(); }
});

test("missing decision, unauthenticated actor and explicit rejection remain distinct", async () => {
  const { input, review, cleanup } = await fixture();
  try {
    review.decision = null;
    rehash(input);
    let output = await reviewGeometryControlPointsV1(input);
    assert.equal(output.status, "UNVERIFIED");
    assert.equal(output.reviewedTargetFrame, null);
    review.decision = { action: "REJECT", decisionId: "synthetic-rejection",
      actorId: "reviewer-1", decidedAt: "2026-09-28T12:00:00Z", reason: "wrong mark" };
    rehash(input);
    output = await reviewGeometryControlPointsV1(input);
    assert.equal(output.status, "REJECTED");
    assert.equal(output.reviewedControlPoints, null);
    input.authenticatedActorId = null;
    output = await reviewGeometryControlPointsV1(input);
    assert.equal(output.status, "UNVERIFIED");
    assert.equal(output.reasonCode, "HUMAN_DECISION_UNVERIFIED");
  } finally { await cleanup(); }
});

test("source, page, render and review hash changes close review", async () => {
  const { input, review, cleanup } = await fixture();
  try {
    const original = structuredClone(review);
    for (const change of [
      (value: any) => { value.source.sourceSha256 = "0".repeat(64); },
      (value: any) => { value.source.pdfPageNumber = 2; },
      (value: any) => { value.render.renderSha256 = "0".repeat(64); },
      (value: any) => { value.frameContentHash = "0".repeat(64); },
    ]) {
      input.reviewArtifact.content_json = structuredClone(original);
      change(input.reviewArtifact.content_json);
      rehash(input);
      assert.equal((await reviewGeometryControlPointsV1(input)).status, "UNVERIFIED");
    }
    input.reviewArtifact.content_json = structuredClone(original);
    input.reviewArtifact.content_hash = "0".repeat(64);
    assert.equal((await reviewGeometryControlPointsV1(input)).status, "UNVERIFIED");
    input.reviewArtifact.content_hash = sha256(canonicalJson(original));
    input.frame.renderBytes = Buffer.from(input.frame.renderBytes);
    input.frame.renderBytes[input.frame.renderBytes.length - 20] ^= 1;
    const output = await reviewGeometryControlPointsV1(input);
    assert.equal(output.reasonCode, "FRAME_UNVERIFIED");
    assert.equal(output.reviewedTargetFrame, null);
  } finally { await cleanup(); }
});

test("confirmation requires complete CRS and each point's page and project provenance", async () => {
  const { input, review, cleanup } = await fixture();
  try {
    const local = structuredClone(review.targetFrame);
    review.targetFrame = { ...local, kind: "PROJECTED_CRS", frameId: "EPSG:9999",
      crsMetadata: null };
    rehash(input);
    assert.equal((await reviewGeometryControlPointsV1(input)).reasonCode,
      "CONTROL_POINT_METADATA_INCOMPLETE");
    review.targetFrame.crsMetadata = { authority: "EPSG", code: "9999",
      definitionSha256: "1".repeat(64), horizontalDatum: "synthetic-datum",
      coordinateEpoch: null };
    rehash(input);
    assert.equal((await reviewGeometryControlPointsV1(input)).status,
      "CONFIRMED_REVIEW_ONLY");
    review.controlPoints[2].projectEvidence = null;
    rehash(input);
    assert.equal((await reviewGeometryControlPointsV1(input)).status, "UNVERIFIED");
    review.controlPoints[2].projectEvidence = { sourceSha256: "1".repeat(64),
      pdfPageNumber: 1, locator: "synthetic survey mark" };
    review.controlPoints[2].pageEvidence.pdfPageNumber = 2;
    rehash(input);
    assert.equal((await reviewGeometryControlPointsV1(input)).reasonCode,
      "PAGE_EVIDENCE_MISMATCH");
  } finally { await cleanup(); }
});
