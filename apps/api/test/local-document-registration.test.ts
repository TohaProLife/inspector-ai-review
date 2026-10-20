import assert from "node:assert/strict";
import { test } from "vitest";
import { compareRegisteredDisplacement, evaluateLocalDocumentRegistration,
  localDocumentRegistrationDigest, type LocalDocumentFrame, type LocalDocumentPoint,
  type LocalDocumentRegistrationPacket, type LocalDocumentRegistrationTrust } from "../src/local-document-registration.js";

const sourceFrame: LocalDocumentFrame = { sourceFileId: "PD-original", sourceSha256: "a".repeat(64),
  pdfPageNumber: 13, pageFrameSha256: "c".repeat(64), coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED",
  visibleWidthPt: 1_000, visibleHeightPt: 500, rotate: 270,
  objectKey: "building-A", floorKey: "floor-1", phaseKey: "construction-A", revisionKey: "PD-v1" };
const targetFrame: LocalDocumentFrame = { ...sourceFrame, sourceFileId: "RD-original",
  sourceSha256: "b".repeat(64), pageFrameSha256: "d".repeat(64), revisionKey: "RD-v2", rotate: 90 };

function fixture(method: LocalDocumentRegistrationPacket["method"] = "SIMILARITY") {
  const scale = method === "RIGID" ? 1 : 0.8;
  const angle = 0.12;
  const target = (p: LocalDocumentPoint): LocalDocumentPoint => [
    (scale * (Math.cos(angle) * p[0] * 1_000 - Math.sin(angle) * p[1] * 500) + 70) / 1_000,
    (scale * (Math.sin(angle) * p[0] * 1_000 + Math.cos(angle) * p[1] * 500) + 5) / 500];
  const locations: LocalDocumentPoint[] = [[0.1, 0.1], [0.8, 0.1], [0.1, 0.7], [0.8, 0.7], [0.45, 0.4]];
  const packet: LocalDocumentRegistrationPacket = { schemaVersion: "local-document-registration-v1",
    sourceFrame: structuredClone(sourceFrame), targetFrame: structuredClone(targetFrame), method,
    basis: { kind: "DOCUMENT_AXES", evidenceRefs: ["PD:13:axes", "RD:13:axes"] },
    anchors: locations.map((p, i) => ({ id: `axis-${i}`, source: p, target: target(p),
      role: i < 3 ? "FIT" : "HOLDOUT", referenceKind: "DOCUMENT_AXIS",
      sourceLocator: `PD:13:axis-${i}`, targetLocator: `RD:13:axis-${i}` })),
    minScale: 0.5, maxScale: 1.5, maxAnisotropy: 1.05, maxResidualTargetPoints: 0.01,
    sourceLocalizationUncertaintyPt: 0.01, targetLocalizationUncertaintyPt: 0.01,
    targetScale: { unit: "m", unitsPerVisiblePoint: 0.01, relativeUncertainty: 0.01, evidenceRef: "RD:13:dimension-10000" } };
  return { packet, target };
}
const trusted = (packet: LocalDocumentRegistrationPacket): LocalDocumentRegistrationTrust => ({
  sourceFrame: structuredClone(packet.sourceFrame), targetFrame: structuredClone(packet.targetFrame),
  reviewedRegistrationSha256: localDocumentRegistrationDigest(packet) });
const evaluate = (packet: LocalDocumentRegistrationPacket) => evaluateLocalDocumentRegistration(packet, trusted(packet));

test("similarity uses canonical visible aspect ratio, holds out anchors, never claims world CRS", () => {
  const { packet } = fixture(); const result = evaluate(packet);
  assert.equal(result.status, "REGISTERED_RELATIVE");
  if (result.status !== "REGISTERED_RELATIVE") return;
  assert.equal(result.fitResiduals.length, 3);
  assert.equal(result.holdoutResiduals.length, 2);
  assert.ok(result.maxResidualTargetPoints < 1e-10);
  assert.ok(Math.abs(result.scaleRange[0] - 0.8) < 1e-12);
  assert.deepEqual(result.scaleRange, [result.scaleRange[0], result.scaleRange[0]]);
  assert.equal(result.absoluteGeoreference, false);
  assert.equal(Object.hasOwn(result, "worldCrs"), false);
  assert.equal(Object.hasOwn(result, "findings"), false);
});

test("rigid fit preserves unit scale rather than resizing tested geometry", () => {
  const { packet } = fixture("RIGID"); const result = evaluate(packet);
  assert.equal(result.status, "REGISTERED_RELATIVE");
  if (result.status === "REGISTERED_RELATIVE") assert.ok(Math.abs(result.scaleRange[0] - 1) < 1e-12);
  const scaled = fixture().packet; scaled.method = "RIGID";
  assert.equal(evaluate(scaled).reasonCode, "RESIDUAL_OUTSIDE_POLICY");
});

test("immutable frame and authenticated review digest cannot be replaced by packet claims", () => {
  const { packet } = fixture();
  const pin = trusted(packet); packet.maxResidualTargetPoints = 100;
  assert.equal(evaluateLocalDocumentRegistration(packet, pin).reasonCode, "REGISTRATION_REVIEW_REQUIRED");
  packet.sourceFrame.sourceSha256 = "e".repeat(64);
  assert.equal(evaluateLocalDocumentRegistration(packet, pin).reasonCode, "PAGE_FRAME_MISMATCH");
  const original = fixture().packet;
  assert.equal(evaluateLocalDocumentRegistration(original, { ...trusted(original), reviewedRegistrationSha256: "0".repeat(64) })
    .reasonCode, "REGISTRATION_REVIEW_REQUIRED");
  for (const field of ["pdfPageNumber", "rotate", "pageFrameSha256", "visibleWidthPt"] as const) {
    const changed = fixture().packet; const independent = trusted(changed);
    (changed.sourceFrame as unknown as Record<string, unknown>)[field] = field === "pageFrameSha256" ? "e".repeat(64) : 5;
    assert.ok(["PAGE_FRAME_MISMATCH", "INVALID_REGISTRATION_PACKET"].includes(
      evaluateLocalDocumentRegistration(changed, independent).reasonCode));
  }
});

test("different object, floor, phase or same PDF page cannot become a comparative registration", () => {
  for (const key of ["objectKey", "floorKey", "phaseKey"] as const) {
    const { packet } = fixture(); packet.targetFrame[key] = "other";
    assert.equal(evaluate(packet).reasonCode, "SCOPE_MISMATCH");
  }
  const { packet } = fixture(); packet.targetFrame = structuredClone(packet.sourceFrame);
  assert.equal(evaluate(packet).reasonCode, "SCOPE_MISMATCH");
});

test("tested contour, missing provenance, duplicate or out-of-frame anchors fail closed", () => {
  const changes: Array<(packet: any) => void> = [
    (p) => { p.anchors[0].referenceKind = "TESTED_BUILDING_CONTOUR"; },
    (p) => { p.anchors[0].sourceLocator = ""; },
    (p) => { p.anchors[1].id = p.anchors[0].id; },
    (p) => { p.anchors[1].source = p.anchors[0].source; },
    (p) => { p.anchors[0].source[0] = 1.1; },
    (p) => { p.sourceFrame.coordinateSpace = "PDF_UNROTATED"; },
    (p) => { p.worldCrs = "EPSG:3857"; },
  ];
  for (const change of changes) {
    const { packet } = fixture(); change(packet);
    assert.equal(evaluate(packet).reasonCode, "INVALID_REGISTRATION_PACKET");
  }
});

test("missing holdout, collinear fit, reflection and unapproved scale each abstain", () => {
  const noHoldout = fixture().packet; noHoldout.anchors.forEach((anchor) => { anchor.role = "FIT"; });
  assert.equal(evaluate(noHoldout).reasonCode, "INSUFFICIENT_INDEPENDENT_ANCHORS");
  const collinear = fixture(); collinear.packet.anchors[2].source = [0.45, 0.1];
  collinear.packet.anchors[2].target = collinear.target([0.45, 0.1]);
  assert.equal(evaluate(collinear.packet).reasonCode, "DEGENERATE_ANCHOR_GEOMETRY");
  const reflected = fixture().packet; reflected.method = "AFFINE"; reflected.basis.kind = "SCAN_DISTORTION";
  reflected.anchors.forEach((anchor) => { anchor.target = [1 - anchor.source[0], anchor.source[1]]; });
  assert.equal(evaluate(reflected).reasonCode, "SCALE_OR_DISTORTION_OUTSIDE_POLICY");
  const scale = fixture().packet; scale.minScale = 0.9;
  assert.equal(evaluate(scale).reasonCode, "SCALE_OR_DISTORTION_OUTSIDE_POLICY");
});

test("heldout residual cannot be hidden by changing fit residual or adding a loose result", () => {
  const { packet } = fixture(); packet.anchors[3].target[0] += 0.01;
  assert.equal(evaluate(packet).reasonCode, "RESIDUAL_OUTSIDE_POLICY");
  const noisyFit = fixture().packet; noisyFit.anchors[2].target[1] += 0.01;
  assert.equal(evaluate(noisyFit).reasonCode, "RESIDUAL_OUTSIDE_POLICY");
});

test("affine allowed only for explicitly reviewed scan distortion within anisotropy policy", () => {
  const { packet } = fixture("AFFINE");
  assert.equal(evaluate(packet).reasonCode, "AFFINE_SCAN_BASIS_REQUIRED");
  packet.basis.kind = "SCAN_DISTORTION";
  packet.anchors.forEach((anchor) => {
    const x = anchor.source[0] * 1_000; const y = anchor.source[1] * 500;
    anchor.target = [(1.01 * x + 0.01 * y + 10) / 1_000, (0.01 * x + 0.99 * y + 5) / 500];
  });
  assert.equal(evaluate(packet).status, "REGISTERED_RELATIVE");
  packet.maxAnisotropy = 1.001;
  assert.equal(evaluate(packet).reasonCode, "SCALE_OR_DISTORTION_OUTSIDE_POLICY");
});

test("within-domain displacement requires metric scale and respects threshold uncertainty", () => {
  const { packet, target } = fixture(); const registration = evaluate(packet);
  const source: LocalDocumentPoint = [0.4, 0.4]; const measured = target(source); measured[0] += 0.01;
  const violation = compareRegisteredDisplacement(registration, source, measured, 0.05);
  assert.equal(violation.status, "VIOLATION");
  assert.ok(Math.abs(violation.distanceMetres - 0.1) < 1e-10);
  assert.equal(compareRegisteredDisplacement(registration, source, measured, 0.2).status, "NO_VIOLATION");
  assert.equal(compareRegisteredDisplacement(registration, source, measured, 0.1).reasonCode, "THRESHOLD_WITHIN_UNCERTAINTY");
  packet.targetScale = null;
  assert.equal(compareRegisteredDisplacement(evaluate(packet), source, measured, 0.05).reasonCode, "METRIC_SCALE_REQUIRED");
});

test("no extrapolation outside anchor hull, including a valid PDF point", () => {
  const { packet, target } = fixture(); const registration = evaluate(packet);
  assert.equal(compareRegisteredDisplacement(registration, [0.9, 0.9], target([0.9, 0.9]), 0.1)
    .reasonCode, "OUTSIDE_REGISTERED_DOMAIN");
  assert.equal(compareRegisteredDisplacement(registration, [0.4, 0.4], [0.95, 0.95], 0.1)
    .reasonCode, "OUTSIDE_REGISTERED_DOMAIN");
  assert.equal(compareRegisteredDisplacement(registration, [Number.NaN, 0.4], [0.5, 0.5], 0.1)
    .reasonCode, "INVALID_COMPARISON");
});

test("metric interval includes localization and scale cross term; mm equals m", () => {
  const { packet, target } = fixture(); packet.sourceLocalizationUncertaintyPt = 1;
  packet.targetLocalizationUncertaintyPt = 1; packet.targetScale!.relativeUncertainty = 0.1;
  const source: LocalDocumentPoint = [0.4, 0.4]; const measured = target(source); measured[0] += 0.01;
  const metric = compareRegisteredDisplacement(evaluate(packet), source, measured, 0.05);
  assert.ok(metric.status === "VIOLATION" || metric.status === "NO_VIOLATION");
  assert.ok(Math.abs(metric.intervalMetres[1] - 0.1298) < 1e-10);
  packet.targetScale!.unit = "mm"; packet.targetScale!.unitsPerVisiblePoint = 10;
  const millimetres = compareRegisteredDisplacement(evaluate(packet), source, measured, 0.05);
  assert.equal(millimetres.status, metric.status);
  assert.deepEqual(millimetres.intervalMetres, metric.intervalMetres);
});
