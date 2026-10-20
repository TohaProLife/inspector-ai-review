import { canonicalJson, sha256 } from "./canonical-json.js";

import type { LocalDocumentFrame, LocalDocumentPoint, LocalDocumentMatrix, LocalDocumentRegistrationPacket,
  LocalDocumentRegistrationTrust, LocalDocumentRegistrationReason, LocalDocumentRegistrationResult,
  RegisteredDisplacementComparison } from "@inspector-ai/contracts";
export type { LocalDocumentPoint, LocalDocumentMatrix, LocalDocumentFrame, LocalDocumentAnchor,
  LocalDocumentRegistrationPacket, LocalDocumentRegistrationTrust, LocalDocumentRegistrationReason,
  RegisteredLocalDocuments, LocalDocumentRegistrationResult, RegisteredDisplacementComparison,
  LocalDocumentRegistrationPreview, LocalDocumentRegistrationReview,
  PersistedLocalDocumentRegistrationReview, LocalDocumentRegistrationWorkspaceRead,
  LocalDocumentRegistrationPreviewInput, LocalDocumentRegistrationSaveInput } from "@inspector-ai/contracts";

type Json = Record<string, unknown>;
const SHA = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]): boolean => Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
  && Math.abs(value) <= 1_000_000;
const positive = (value: unknown): value is number => finite(value) && value > 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim() === value
  && value.length > 0 && value.length <= 256;
const digest = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
const normalized = (value: unknown): value is LocalDocumentPoint => Array.isArray(value) && value.length === 2
  && value.every((part) => finite(part) && part >= 0 && part <= 1);
const point = (p: LocalDocumentPoint, frame: LocalDocumentFrame): LocalDocumentPoint =>
  [p[0] * frame.visibleWidthPt, p[1] * frame.visibleHeightPt];
const cross = (o: LocalDocumentPoint, a: LocalDocumentPoint, b: LocalDocumentPoint): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const transform = (m: LocalDocumentMatrix, p: LocalDocumentPoint): LocalDocumentPoint =>
  [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
const distance = (a: LocalDocumentPoint, b: LocalDocumentPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function frame(value: unknown): value is LocalDocumentFrame {
  return record(value) && exact(value, ["sourceFileId", "sourceSha256", "pdfPageNumber", "pageFrameSha256",
    "coordinateSpace", "visibleWidthPt", "visibleHeightPt", "rotate", "objectKey", "floorKey", "phaseKey", "revisionKey"])
    && text(value.sourceFileId) && digest(value.sourceSha256) && digest(value.pageFrameSha256)
    && Number.isSafeInteger(value.pdfPageNumber) && (value.pdfPageNumber as number) >= 1
    && (value.pdfPageNumber as number) <= 10_000 && value.coordinateSpace === "CANONICAL_VISIBLE_NORMALIZED"
    && positive(value.visibleWidthPt) && positive(value.visibleHeightPt)
    && [0, 90, 180, 270].includes(value.rotate as number)
    && [value.objectKey, value.floorKey, value.phaseKey, value.revisionKey].every(text);
}

function parsePacket(value: unknown): LocalDocumentRegistrationPacket | null {
  if (!record(value) || !exact(value, ["schemaVersion", "sourceFrame", "targetFrame", "method", "basis", "anchors",
    "minScale", "maxScale", "maxAnisotropy", "maxResidualTargetPoints", "sourceLocalizationUncertaintyPt",
    "targetLocalizationUncertaintyPt", "targetScale"])
    || value.schemaVersion !== "local-document-registration-v1" || !frame(value.sourceFrame) || !frame(value.targetFrame)
    || !["RIGID", "SIMILARITY", "AFFINE"].includes(value.method as string)
    || !record(value.basis) || !exact(value.basis, ["kind", "evidenceRefs"])
    || !["DOCUMENT_AXES", "STABLE_REFERENCES", "SCAN_DISTORTION"].includes(value.basis.kind as string)
    || !Array.isArray(value.basis.evidenceRefs) || value.basis.evidenceRefs.length < 1
    || value.basis.evidenceRefs.length > 32 || !value.basis.evidenceRefs.every(text)
    || !Array.isArray(value.anchors) || value.anchors.length < 4 || value.anchors.length > 64
    || !positive(value.minScale) || !positive(value.maxScale) || value.minScale >= value.maxScale
    || !finite(value.maxAnisotropy) || value.maxAnisotropy < 1 || value.maxAnisotropy > 2
    || !positive(value.maxResidualTargetPoints) || !finite(value.sourceLocalizationUncertaintyPt)
    || value.sourceLocalizationUncertaintyPt < 0 || !finite(value.targetLocalizationUncertaintyPt)
    || value.targetLocalizationUncertaintyPt < 0) return null;
  const ids = new Set<string>();
  const sourcePoints = new Set<string>();
  const targetPoints = new Set<string>();
  for (const anchor of value.anchors) {
    if (!record(anchor) || !exact(anchor, ["id", "source", "target", "role", "referenceKind", "sourceLocator", "targetLocator"])
      || !text(anchor.id) || ids.has(anchor.id) || !normalized(anchor.source) || !normalized(anchor.target)
      || !["FIT", "HOLDOUT"].includes(anchor.role as string)
      || !["DOCUMENT_AXIS", "STABLE_REFERENCE"].includes(anchor.referenceKind as string)
      || !text(anchor.sourceLocator) || !text(anchor.targetLocator)) return null;
    const sourceKey = anchor.source.join(","); const targetKey = anchor.target.join(",");
    if (sourcePoints.has(sourceKey) || targetPoints.has(targetKey)) return null;
    ids.add(anchor.id); sourcePoints.add(sourceKey); targetPoints.add(targetKey);
  }
  if (value.targetScale !== null && (!record(value.targetScale)
    || !exact(value.targetScale, ["unit", "unitsPerVisiblePoint", "relativeUncertainty", "evidenceRef"])
    || !["m", "cm", "mm"].includes(value.targetScale.unit as string)
    || !positive(value.targetScale.unitsPerVisiblePoint) || !finite(value.targetScale.relativeUncertainty)
    || value.targetScale.relativeUncertainty < 0 || value.targetScale.relativeUncertainty >= 1
    || !text(value.targetScale.evidenceRef))) return null;
  return structuredClone(value) as unknown as LocalDocumentRegistrationPacket;
}

function hull(points: LocalDocumentPoint[]): LocalDocumentPoint[] {
  const ordered = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: LocalDocumentPoint[] = []; const upper: LocalDocumentPoint[] = [];
  for (const p of ordered) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  for (const p of ordered.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function inHull(p: LocalDocumentPoint, vertices: LocalDocumentPoint[]): boolean {
  return vertices.length >= 3 && vertices.every((v, i) =>
    cross(v, vertices[(i + 1) % vertices.length], p) >= -1e-10);
}

/** Digest binds the entire reviewed scope, anchor roles, fitting model and tolerance policy. */
export function localDocumentRegistrationDigest(packet: unknown): string {
  return sha256(canonicalJson(packet));
}

/** Local drawing alignment only; never creates CRS, absolute position, findings or coverage. */
export function evaluateLocalDocumentRegistration(raw: unknown,
  trusted: LocalDocumentRegistrationTrust): LocalDocumentRegistrationResult {
  const abstain = (reasonCode: Exclude<LocalDocumentRegistrationReason, "REGISTERED_RELATIVE">): LocalDocumentRegistrationResult =>
    ({ status: "ABSTAIN", reasonCode, schemaVersion: "local-document-registration-result-v1", absoluteGeoreference: false });
  const packet = parsePacket(raw);
  if (!packet) return abstain("INVALID_REGISTRATION_PACKET");
  if (!trusted || !frame(trusted.sourceFrame) || !frame(trusted.targetFrame)
    || canonicalJson(trusted.sourceFrame) !== canonicalJson(packet.sourceFrame)
    || canonicalJson(trusted.targetFrame) !== canonicalJson(packet.targetFrame)) return abstain("PAGE_FRAME_MISMATCH");
  const source = packet.sourceFrame; const target = packet.targetFrame;
  if (source.objectKey !== target.objectKey || source.floorKey !== target.floorKey || source.phaseKey !== target.phaseKey
    || source.sourceSha256 === target.sourceSha256 && source.pdfPageNumber === target.pdfPageNumber) {
    return abstain("SCOPE_MISMATCH");
  }
  const registrationSha256 = localDocumentRegistrationDigest(packet);
  if (!digest(trusted.reviewedRegistrationSha256) || trusted.reviewedRegistrationSha256 !== registrationSha256) {
    return abstain("REGISTRATION_REVIEW_REQUIRED");
  }
  if (packet.method === "AFFINE" && packet.basis.kind !== "SCAN_DISTORTION") {
    return abstain("AFFINE_SCAN_BASIS_REQUIRED");
  }
  const fitting = packet.anchors.filter((item) => item.role === "FIT");
  const heldout = packet.anchors.filter((item) => item.role === "HOLDOUT");
  if (fitting.length < 3 || heldout.length < 1) return abstain("INSUFFICIENT_INDEPENDENT_ANCHORS");
  const fitSource = fitting.map((item) => point(item.source, source));
  const fitTarget = fitting.map((item) => point(item.target, target));
  const mean = (points: LocalDocumentPoint[]): LocalDocumentPoint => [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length];
  const pc = mean(fitSource); const qc = mean(fitTarget);
  let xx = 0; let xy = 0; let yy = 0; let ux = 0; let uy = 0; let vx = 0; let vy = 0;
  for (let i = 0; i < fitting.length; i += 1) {
    const x = fitSource[i][0] - pc[0]; const y = fitSource[i][1] - pc[1];
    const u = fitTarget[i][0] - qc[0]; const v = fitTarget[i][1] - qc[1];
    xx += x * x; xy += x * y; yy += y * y;
    ux += u * x; uy += u * y; vx += v * x; vy += v * y;
  }
  const covarianceDet = xx * yy - xy * xy;
  // A narrow/collinear cloud cannot establish stable two-dimensional registration.
  if (covarianceDet <= 1e-10 * (xx + yy) ** 2 || !Number.isFinite(covarianceDet)) {
    return abstain("DEGENERATE_ANCHOR_GEOMETRY");
  }
  let a: number; let b: number; let d: number; let e: number;
  if (packet.method === "AFFINE") {
    a = (ux * yy - uy * xy) / covarianceDet; b = (uy * xx - ux * xy) / covarianceDet;
    d = (vx * yy - vy * xy) / covarianceDet; e = (vy * xx - vx * xy) / covarianceDet;
  } else {
    const dot = ux + vy; const turn = vx - uy; const magnitude = Math.hypot(dot, turn);
    if (magnitude <= 1e-12) return abstain("DEGENERATE_ANCHOR_GEOMETRY");
    const scale = packet.method === "RIGID" ? 1 : magnitude / (xx + yy);
    a = scale * dot / magnitude; b = -scale * turn / magnitude; d = -b; e = a;
  }
  const c = qc[0] - a * pc[0] - b * pc[1]; const f = qc[1] - d * pc[0] - e * pc[1];
  const determinant = a * e - b * d;
  const forward: LocalDocumentMatrix = [a, b, c, d, e, f];
  if (!forward.every(Number.isFinite) || determinant <= 1e-12) return abstain("SCALE_OR_DISTORTION_OUTSIDE_POLICY");
  const trace = a * a + b * b + d * d + e * e;
  const largest = packet.method !== "AFFINE" ? Math.hypot(a, d)
    : Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant ** 2))) / 2);
  const smallest = packet.method !== "AFFINE" ? largest : determinant / largest;
  if (smallest < packet.minScale || largest > packet.maxScale || largest / smallest > packet.maxAnisotropy + 1e-12) {
    return abstain("SCALE_OR_DISTORTION_OUTSIDE_POLICY");
  }
  const residuals = packet.anchors.map((anchor) => ({ anchorId: anchor.id, role: anchor.role,
    targetPoints: distance(transform(forward, point(anchor.source, source)), point(anchor.target, target)) }));
  const maximum = Math.max(...residuals.map((item) => item.targetPoints));
  if (!Number.isFinite(maximum) || maximum > packet.maxResidualTargetPoints) return abstain("RESIDUAL_OUTSIDE_POLICY");
  const inverse: LocalDocumentMatrix = [e / determinant, -b / determinant, (b * f - e * c) / determinant,
    -d / determinant, a / determinant, (d * c - a * f) / determinant];
  if (!inverse.every(Number.isFinite)) return abstain("DEGENERATE_ANCHOR_GEOMETRY");
  const roundtrip = Math.max(...packet.anchors.map((anchor) => {
    const original = point(anchor.source, source);
    return distance(transform(inverse, transform(forward, original)), original);
  }));
  if (roundtrip > 1e-8 * Math.max(source.visibleWidthPt, source.visibleHeightPt)) {
    return abstain("DEGENERATE_ANCHOR_GEOMETRY");
  }
  const mapResidual = (role: "FIT" | "HOLDOUT") => residuals.filter((item) => item.role === role)
    .map(({ anchorId, targetPoints }) => ({ anchorId, targetPoints }));
  const scale = packet.targetScale;
  return { status: "REGISTERED_RELATIVE", reasonCode: "REGISTERED_RELATIVE",
    schemaVersion: "local-document-registration-result-v1", sourceFrame: source, targetFrame: target,
    registrationSha256, method: packet.method, forwardMatrix: forward, inverseMatrix: inverse,
    scaleRange: [smallest, largest], fitResiduals: mapResidual("FIT"), holdoutResiduals: mapResidual("HOLDOUT"),
    maxResidualTargetPoints: maximum,
    uncertaintyTargetPoints: largest * packet.sourceLocalizationUncertaintyPt
      + packet.targetLocalizationUncertaintyPt + maximum,
    sourceDomain: hull(packet.anchors.map((anchor) => anchor.source)),
    targetDomain: hull(packet.anchors.map((anchor) => anchor.target)),
    metricScale: scale ? { metresPerVisiblePoint: scale.unitsPerVisiblePoint
      * ({ m: 1, cm: 0.01, mm: 0.001 }[scale.unit]), relativeUncertainty: scale.relativeUncertainty,
    evidenceRef: scale.evidenceRef } : null, absoluteGeoreference: false };
}

/** Strict greater-than comparator; uncertainty overlap cannot become a confident warning. */
export function compareRegisteredDisplacement(registration: LocalDocumentRegistrationResult,
  sourcePoint: LocalDocumentPoint, targetPoint: LocalDocumentPoint, thresholdMetres: number): RegisteredDisplacementComparison {
  if (registration.status !== "REGISTERED_RELATIVE") return { status: "ABSTAIN", reasonCode: "REGISTRATION_REQUIRED" };
  if (!normalized(sourcePoint) || !normalized(targetPoint) || !finite(thresholdMetres) || thresholdMetres < 0) {
    return { status: "ABSTAIN", reasonCode: "INVALID_COMPARISON" };
  }
  const scale = registration.metricScale;
  if (!scale) return { status: "ABSTAIN", reasonCode: "METRIC_SCALE_REQUIRED" };
  const projected = transform(registration.forwardMatrix, point(sourcePoint, registration.sourceFrame));
  const projectedNormalized: LocalDocumentPoint = [projected[0] / registration.targetFrame.visibleWidthPt,
    projected[1] / registration.targetFrame.visibleHeightPt];
  if (!inHull(sourcePoint, registration.sourceDomain) || !inHull(targetPoint, registration.targetDomain)
    || !inHull(projectedNormalized, registration.targetDomain)) {
    return { status: "ABSTAIN", reasonCode: "OUTSIDE_REGISTERED_DOMAIN" };
  }
  const distancePoints = distance(projected, point(targetPoint, registration.targetFrame));
  const distanceMetres = distancePoints * scale.metresPerVisiblePoint;
  // Include the cross term between localization and scale uncertainty at both bounds.
  const intervalMetres: [number, number] = [
    Math.max(0, distancePoints - registration.uncertaintyTargetPoints)
      * scale.metresPerVisiblePoint * (1 - scale.relativeUncertainty),
    (distancePoints + registration.uncertaintyTargetPoints)
      * scale.metresPerVisiblePoint * (1 + scale.relativeUncertainty)];
  if (intervalMetres[0] <= thresholdMetres && intervalMetres[1] > thresholdMetres) {
    return { status: "ABSTAIN", reasonCode: "THRESHOLD_WITHIN_UNCERTAINTY", intervalMetres };
  }
  const exceeds = intervalMetres[0] > thresholdMetres;
  return { status: exceeds ? "VIOLATION" : "NO_VIOLATION",
    reasonCode: exceeds ? "DISPLACEMENT_EXCEEDS_THRESHOLD" : "DISPLACEMENT_WITHIN_THRESHOLD",
    distanceMetres, intervalMetres, thresholdMetres, registrationSha256: registration.registrationSha256 };
}
