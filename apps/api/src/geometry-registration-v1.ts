import { canonicalJson, sha256 } from "./canonical-json.js";

type Json = Record<string, unknown>;
type Point = [number, number];
type Matrix = [number, number, number, number, number, number];

/** These values must come from independent page and human-decision verification. */
export interface TrustedGeometryRegistrationV1 {
  source: unknown;
  pageFrame: unknown;
  targetFrame: unknown;
  controlPoints: unknown;
  trainingPointIds: unknown;
  maxHoldoutResidualProjectUnits: unknown;
  queryPoints: unknown;
}

export interface GeometryRegistrationV1VerificationInput {
  packet: unknown;
  result: unknown;
  sourceBytes: Buffer;
  expectedSourceSha256: string;
  renderBytes?: Buffer;
  expectedRenderSha256?: string;
  trusted: TrustedGeometryRegistrationV1;
}

const SHA = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const finite = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && Math.abs(value) <= 1e12;
const positive = (value: unknown): value is number => finite(value) && value > 0;
const name = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 128 && value.trim() === value;
const point = (value: unknown): value is Point => Array.isArray(value)
  && value.length === 2 && value.every(finite);
const cross = (o: Point, a: Point, b: Point): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const transform = (m: Matrix, p: Point): Point =>
  [m[0] * p[0] + m[1] * p[1] + m[2], m[3] * p[0] + m[4] * p[1] + m[5]];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function hull(points: Point[]): Point[] {
  const ordered = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [];
  const upper: Point[] = [];
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

function inHull(p: Point, vertices: Point[]): boolean {
  return vertices.every((v, i) => cross(v, vertices[(i + 1) % vertices.length], p) >= -1e-10);
}

function sameNumber(actual: unknown, expected: number): boolean {
  if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
  // Python math.dist and JS Math.hypot may differ by a few ULPs.
  return Math.abs(actual - expected) <= Math.max(1e-13, 8 * Number.EPSILON * Math.abs(expected));
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return sameNumber(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
    && expected.every((item, i) => sameValue(actual[i], item));
  if (record(expected)) return record(actual) && exact(actual, Object.keys(expected))
    && Object.entries(expected).every(([key, value]) => sameValue(actual[key], value));
  return actual === expected;
}

function replay(packet: Json): Json | null {
  if (!exact(packet, ["schemaVersion", "source", "pageFrame", "targetFrame", "controlPoints",
    "trainingPointIds", "maxHoldoutResidualProjectUnits", "queryPoints"])
    || packet.schemaVersion !== "geometry-registration-v1") return null;
  const source = packet.source;
  const page = packet.pageFrame;
  const target = packet.targetFrame;
  if (!record(source) || !exact(source, ["sourceSha256", "pdfPageNumber"])
    || typeof source.sourceSha256 !== "string" || !SHA.test(source.sourceSha256)
    || !Number.isSafeInteger(source.pdfPageNumber) || (source.pdfPageNumber as number) < 1
    || (source.pdfPageNumber as number) > 10_000
    || !record(page) || !exact(page, ["coordinateSpace", "width", "height", "rotate", "renderSha256"])
    || !positive(page.width) || !positive(page.height)
    || ![0, 90, 180, 270].includes(page.rotate as number)
    || !Number.isSafeInteger(page.rotate)
    || !record(target) || !exact(target, ["kind", "frameId", "unit", "xAxis", "yAxis",
      "minScale", "maxScale"])) return null;
  const width = page.width;
  const height = page.height;
  if (page.coordinateSpace === "CANONICAL_VISIBLE_NORMALIZED") {
    if (width !== 1 || height !== 1 || page.renderSha256 !== null) return null;
  } else if (page.coordinateSpace === "RASTER_PIXEL") {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width * height > 100_000_000 || typeof page.renderSha256 !== "string"
      || !SHA.test(page.renderSha256)) return null;
  } else return null;
  if (!["LOCAL_2D", "PROJECTED_CRS"].includes(target.kind as string)
    || !name(target.frameId) || !name(target.unit)
    || !["m", "mm", "cm", "ft", "in"].includes(target.unit)
    || target.xAxis !== "RIGHT" || !["UP", "DOWN"].includes(target.yAxis as string)
    || !positive(target.minScale) || !positive(target.maxScale)
    || target.minScale >= target.maxScale
    || !positive(packet.maxHoldoutResidualProjectUnits)
    || !Array.isArray(packet.controlPoints) || packet.controlPoints.length < 4
    || packet.controlPoints.length > 32) return null;

  const controls = new Map<string, { page: Point; project: Point; evidenceRef: string }>();
  for (const raw of packet.controlPoints) {
    if (!record(raw) || !exact(raw, ["id", "evidenceRef", "page", "project"])
      || !name(raw.id) || !name(raw.evidenceRef) || !point(raw.page) || !point(raw.project)
      || controls.has(raw.id) || raw.page[0] < 0 || raw.page[0] > width
      || raw.page[1] < 0 || raw.page[1] > height) return null;
    const pagePoint = raw.page;
    const projectPoint = raw.project;
    if ([...controls.values()].some((item) =>
      item.page[0] === pagePoint[0] && item.page[1] === pagePoint[1]
      || item.project[0] === projectPoint[0] && item.project[1] === projectPoint[1])) return null;
    controls.set(raw.id, { page: pagePoint, project: projectPoint, evidenceRef: raw.evidenceRef });
  }
  const ids = packet.trainingPointIds;
  if (!Array.isArray(ids) || ids.length !== 3 || ids.some((id) =>
    typeof id !== "string" || !controls.has(id)) || new Set(ids).size !== 3) return null;
  const [first, second, third] = ids.map((id) => controls.get(id as string)!);
  const p0: Point = [first.page[0] / width, first.page[1] / height];
  const p1: Point = [second.page[0] / width, second.page[1] / height];
  const p2: Point = [third.page[0] / width, third.page[1] / height];
  const denominator = cross(p0, p1, p2);
  if (Math.abs(denominator) <= 1e-10) return null;
  const u1 = p1[0] - p0[0]; const v1 = p1[1] - p0[1];
  const u2 = p2[0] - p0[0]; const v2 = p2[1] - p0[1];
  const q0 = first.project; const q1 = second.project; const q2 = third.project;
  const a = ((q1[0] - q0[0]) * v2 - (q2[0] - q0[0]) * v1) / denominator / width;
  const b = (u1 * (q2[0] - q0[0]) - u2 * (q1[0] - q0[0])) / denominator / height;
  const d = ((q1[1] - q0[1]) * v2 - (q2[1] - q0[1]) * v1) / denominator / width;
  const e = (u1 * (q2[1] - q0[1]) - u2 * (q1[1] - q0[1])) / denominator / height;
  const c = q0[0] - a * first.page[0] - b * first.page[1];
  const f = q0[1] - d * first.page[0] - e * first.page[1];
  const determinant = a * e - b * d;
  if (![a, b, c, d, e, f, determinant].every(Number.isFinite)
    || (determinant < 0) !== (target.yAxis === "UP")) return null;
  const trace = a * a + b * b + d * d + e * e;
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant ** 2));
  const largest = Math.sqrt(Math.max(0, (trace + discriminant) / 2));
  const smallest = largest ? Math.abs(determinant) / largest : 0;
  if (!(target.minScale <= smallest && smallest <= largest && largest <= target.maxScale)) return null;
  const forward: Matrix = [a, b, c, d, e, f];
  const inverse: Matrix = [e / determinant, -b / determinant,
    (b * f - e * c) / determinant, -d / determinant, a / determinant,
    (d * c - a * f) / determinant];
  if (!inverse.every(Number.isFinite)) return null;
  const holdouts: Json[] = [];
  for (const [id, control] of controls) {
    if (ids.includes(id)) continue;
    const residual = distance(transform(forward, control.page), control.project);
    if (!Number.isFinite(residual) || residual > packet.maxHoldoutResidualProjectUnits) return null;
    holdouts.push({ id, evidenceRef: control.evidenceRef, residualProjectUnits: residual });
  }
  const domain = hull([...controls.values()].map((item): Point =>
    [item.page[0] / width, item.page[1] / height]));
  if (!Array.isArray(packet.queryPoints) || packet.queryPoints.length > 128) return null;
  const queries: Json[] = [];
  for (const raw of packet.queryPoints) {
    if (!point(raw) || raw[0] < 0 || raw[0] > width || raw[1] < 0 || raw[1] > height
      || !inHull([raw[0] / width, raw[1] / height], domain)) return null;
    queries.push({ page: [...raw], project: transform(forward, raw) });
  }
  const roundtrip = [...controls.values()].map((item) => item.page)
    .concat(queries.map((item) => item.page as Point));
  const maxRoundtrip = Math.max(...roundtrip.map((item) =>
    distance(transform(inverse, transform(forward, item)), item)));
  if (!Number.isFinite(maxRoundtrip) || maxRoundtrip > 1e-8 * Math.max(width, height)) return null;
  return {
    schemaVersion: "geometry-registration-v1", status: "REVIEW_ONLY",
    reasonCode: "AUTHENTICATED_REGISTRATION_PENDING", source, pageFrame: page,
    targetFrame: target, trainingPointIds: ids, holdouts,
    maxHoldoutResidualProjectUnits: Math.max(...holdouts.map((item) => item.residualProjectUnits as number)),
    holdoutToleranceProjectUnits: packet.maxHoldoutResidualProjectUnits,
    maxRoundtripPageUnits: maxRoundtrip, forwardMatrix: forward, inverseMatrix: inverse,
    determinant, scaleRangeProjectUnitsPerPageUnit: [smallest, largest],
    calibrationDomainPage: domain.map(([x, y]) => [x * width, y * height]),
    queryPoints: queries, facts: [],
  };
}

/**
 * Pure numerical replay. `trusted` must be independently authenticated by its
 * caller; matching two copies of an untrusted packet proves no real-world point.
 * No runtime route may use this until that provider exists.
 */
export function verifyGeometryRegistrationV1(input: GeometryRegistrationV1VerificationInput): boolean {
  try {
    const { packet, result, sourceBytes, expectedSourceSha256, trusted } = input;
    if (!record(packet) || !record(result) || !record(trusted)
      || !Buffer.isBuffer(sourceBytes) || sourceBytes.length < 8
      || sourceBytes.length > 512 * 1024 * 1024
      || !sourceBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      || typeof expectedSourceSha256 !== "string" || !SHA.test(expectedSourceSha256)
      || sha256(sourceBytes) !== expectedSourceSha256
      || !exact(trusted, ["source", "pageFrame", "targetFrame", "controlPoints",
        "trainingPointIds", "maxHoldoutResidualProjectUnits", "queryPoints"])
      || canonicalJson(packet.source) !== canonicalJson(trusted.source)
      || canonicalJson(packet.pageFrame) !== canonicalJson(trusted.pageFrame)
      || canonicalJson(packet.targetFrame) !== canonicalJson(trusted.targetFrame)
      || canonicalJson(packet.controlPoints) !== canonicalJson(trusted.controlPoints)
      || canonicalJson(packet.trainingPointIds) !== canonicalJson(trusted.trainingPointIds)
      || packet.maxHoldoutResidualProjectUnits !== trusted.maxHoldoutResidualProjectUnits
      || canonicalJson(packet.queryPoints) !== canonicalJson(trusted.queryPoints)) return false;
    const source = packet.source;
    const page = packet.pageFrame;
    if (!record(source) || source.sourceSha256 !== expectedSourceSha256 || !record(page)) return false;
    if (page.coordinateSpace === "RASTER_PIXEL") {
      const bytes = input.renderBytes;
      if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > 128 * 1024 * 1024
        || typeof input.expectedRenderSha256 !== "string" || !SHA.test(input.expectedRenderSha256)
        || sha256(bytes) !== input.expectedRenderSha256
        || page.renderSha256 !== input.expectedRenderSha256
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.toString("ascii", 12, 16) !== "IHDR"
        || bytes.readUInt32BE(16) !== page.width || bytes.readUInt32BE(20) !== page.height) return false;
    } else if (input.renderBytes !== undefined || input.expectedRenderSha256 !== undefined) return false;
    const expected = replay(packet);
    return expected !== null && sameValue(result, expected);
  } catch { return false; }
}
