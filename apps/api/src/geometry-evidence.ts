import { canonicalJson, sha256 } from "./canonical-json.js";

type Json = Record<string, unknown>;
type Matrix = [number, number, number, number, number, number];
type Box = [number, number, number, number];

/**
 * Values extracted by an independent, trusted PDF parser from sourceBytes.
 * This is an explicit trust boundary: this module cannot reconstruct the PDF
 * page tree or vector drawing commands from raw bytes without a PDF parser.
 */
export interface GeometryPageInspection {
  sourceSha256: string;
  pdfPageNumber: number;
  renderSha256: string;
  mediaBox: Box;
  cropBox: Box;
  rotate: 0 | 90 | 180 | 270;
  vectorItemSha256ByLocator: Record<string, string>;
}

export interface GeometryEvidenceVerificationInput {
  artifact: { content_json: unknown; content_hash: string };
  sourceBytes: Buffer;
  renderBytes: Buffer;
  trustedPageInspection: GeometryPageInspection;
  maskBytesBySha?: Record<string, Buffer>;
}

const shaPattern = /^[0-9a-f]{64}$/u;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  value && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const sha = (value: unknown): value is string => typeof value === "string"
  && shaPattern.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;
const finite = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value);
const near = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-5 * Math.max(1, Math.abs(expected));
const array = (value: unknown, length: number): value is number[] => Array.isArray(value)
  && value.length === length && value.every(finite);
const sameArray = (left: number[], right: number[]): boolean => left.length === right.length
  && left.every((value, index) => near(value, right[index]));
const exactArray = (left: number[], right: number[]): boolean => left.length === right.length
  && left.every((value, index) => value === right[index]);

function box(value: unknown): value is Box {
  return array(value, 4) && value[2] > value[0] && value[3] > value[1];
}
function matrix(value: unknown): value is Matrix {
  return array(value, 6) && Math.abs(value[0] * value[4] - value[1] * value[3]) >= 1e-12;
}
function inverse([a, b, c, d, e, f]: Matrix): Matrix {
  const determinant = a * e - b * d;
  return [e / determinant, -b / determinant, (b * f - e * c) / determinant,
    -d / determinant, a / determinant, (d * c - a * f) / determinant];
}
function transform([a, b, c, d, e, f]: Matrix, [x, y]: [number, number]): [number, number] {
  return [a * x + b * y + c, d * x + e * y + f];
}
function expectedFrame(crop: Box, rotate: number, width: number, height: number): {
  visibleSizePt: [number, number]; nativeToVisible: Matrix; visibleToNative: Matrix;
  visibleToPixel: Matrix; pixelToVisible: Matrix;
} {
  const [x0, y0, x1, y1] = crop;
  const w = x1 - x0; const h = y1 - y0;
  let nativeToVisible: Matrix;
  let visibleSizePt: [number, number];
  if (rotate === 0) { nativeToVisible = [1, 0, -x0, 0, -1, y1]; visibleSizePt = [w, h]; }
  else if (rotate === 90) { nativeToVisible = [0, 1, -y0, 1, 0, -x0]; visibleSizePt = [h, w]; }
  else if (rotate === 180) { nativeToVisible = [-1, 0, x1, 0, 1, -y0]; visibleSizePt = [w, h]; }
  else if (rotate === 270) { nativeToVisible = [0, -1, y1, -1, 0, x1]; visibleSizePt = [h, w]; }
  else throw new Error("unsupported PDF Rotate");
  const visibleToPixel: Matrix = [width / visibleSizePt[0], 0, 0,
    0, height / visibleSizePt[1], 0];
  return { visibleSizePt, nativeToVisible,
    visibleToNative: inverse(nativeToVisible), visibleToPixel,
    pixelToVisible: inverse(visibleToPixel) };
}
function point(value: unknown): value is [number, number] {
  return array(value, 2) && value.every((part) => part >= 0 && part <= 1);
}
function cross(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: number[], b: number[], p: number[]): boolean {
  return Math.abs(cross(a, b, p)) <= 1e-12
    && p[0] >= Math.min(a[0], b[0]) - 1e-12 && p[0] <= Math.max(a[0], b[0]) + 1e-12
    && p[1] >= Math.min(a[1], b[1]) - 1e-12 && p[1] <= Math.max(a[1], b[1]) + 1e-12;
}
function intersects(a: number[], b: number[], c: number[], d: number[]): boolean {
  const ac = cross(a, b, c); const ad = cross(a, b, d);
  const ca = cross(c, d, a); const cb = cross(c, d, b);
  return (ac > 0 && ad < 0 || ac < 0 && ad > 0)
    && (ca > 0 && cb < 0 || ca < 0 && cb > 0)
    || onSegment(a, b, c) || onSegment(a, b, d)
    || onSegment(c, d, a) || onSegment(c, d, b);
}
function polygon(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 3 || value.length > 256
    || !value.every(point)) return false;
  const vertices = value as [number, number][];
  if (new Set(vertices.map((vertex) => vertex.join(","))).size !== vertices.length) return false;
  const area = vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + vertex[0] * next[1] - next[0] * vertex[1];
  }, 0);
  if (Math.abs(area) <= 1e-12) return false;
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      if (j === i + 1 || i === 0 && j === vertices.length - 1) continue;
      if (intersects(vertices[i], vertices[(i + 1) % vertices.length],
        vertices[j], vertices[(j + 1) % vertices.length])) return false;
    }
  }
  return true;
}
function pngSize(bytes: Buffer): [number, number] | null {
  if (bytes.length < 45 || !bytes.subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") return null;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  return width >= 1 && width <= 100_000 && height >= 1 && height <= 100_000
    && width * height <= 64_000_000 ? [width, height] : null;
}
function validInspection(value: GeometryPageInspection): boolean {
  return record(value) && exact(value, ["sourceSha256", "pdfPageNumber", "mediaBox",
    "cropBox", "rotate", "renderSha256", "vectorItemSha256ByLocator"])
    && sha(value.sourceSha256) && sha(value.renderSha256)
    && integer(value.pdfPageNumber, 1, 1_000_000)
    && box(value.mediaBox) && box(value.cropBox)
    && [0, 90, 180, 270].includes(value.rotate)
    && value.cropBox[0] >= value.mediaBox[0] - 1e-5
    && value.cropBox[1] >= value.mediaBox[1] - 1e-5
    && value.cropBox[2] <= value.mediaBox[2] + 1e-5
    && value.cropBox[3] <= value.mediaBox[3] + 1e-5
    && record(value.vectorItemSha256ByLocator)
    && Object.entries(value.vectorItemSha256ByLocator).every(([key, digest]) =>
      /^(0|[1-9]\d*):(0|[1-9]\d*)$/u.test(key) && sha(digest));
}

function verified(input: GeometryEvidenceVerificationInput): boolean {
  const { artifact, sourceBytes, renderBytes, trustedPageInspection: inspection } = input;
  if (!record(artifact) || !exact(artifact, ["content_json", "content_hash"])
    || !sha(artifact.content_hash) || !record(artifact.content_json)
    || Buffer.byteLength(canonicalJson(artifact.content_json), "utf8") > 8 * 1024 * 1024
    || sha256(canonicalJson(artifact.content_json)) !== artifact.content_hash
    || !Buffer.isBuffer(sourceBytes) || sourceBytes.length < 1
    || sourceBytes.length > 512 * 1024 * 1024
    || !sourceBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !Buffer.isBuffer(renderBytes) || renderBytes.length < 24
    || renderBytes.length > 128 * 1024 * 1024
    || !validInspection(inspection)) return false;
  const result = artifact.content_json;
  if (!exact(result, ["schemaVersion", "status", "reasonCode", "source",
    "pageFrame", "render", "candidates"])
    || result.schemaVersion !== "geometry-proposal-v1"
    || !["ABSTAIN", "PROPOSAL"].includes(String(result.status))
    || !record(result.source) || !exact(result.source,
      ["sourceFileId", "sourceSha256", "byteSize", "pdfPageNumber"])
    || typeof result.source.sourceFileId !== "string" || !result.source.sourceFileId
    || !sha(result.source.sourceSha256)
    || result.source.sourceSha256 !== sha256(sourceBytes)
    || result.source.sourceSha256 !== inspection.sourceSha256
    || result.source.byteSize !== sourceBytes.length
    || !integer(result.source.byteSize, 1, 512 * 1024 * 1024)
    || result.source.pdfPageNumber !== inspection.pdfPageNumber) return false;
  if (!record(result.render) || !exact(result.render,
    ["rendererProfileId", "dpi", "renderSha256", "byteSize", "widthPx", "heightPx",
      "visibleToPixel", "pixelToVisible"])
    || typeof result.render.rendererProfileId !== "string"
    || !result.render.rendererProfileId || !sha(result.render.renderSha256)
    || result.render.renderSha256 !== sha256(renderBytes)
    || result.render.renderSha256 !== inspection.renderSha256
    || result.render.byteSize !== renderBytes.length
    || !integer(result.render.byteSize, 24, 128 * 1024 * 1024)
    || !finite(result.render.dpi) || result.render.dpi < 36 || result.render.dpi > 1200) return false;
  const size = pngSize(renderBytes);
  if (!size || result.render.widthPx !== size[0] || result.render.heightPx !== size[1]) return false;
  if (!record(result.pageFrame) || !exact(result.pageFrame,
    ["mediaBox", "cropBox", "rotate", "visibleSizePt",
      "nativeToVisible", "visibleToNative"])
    || !box(result.pageFrame.mediaBox) || !box(result.pageFrame.cropBox)
    || !exactArray(result.pageFrame.mediaBox, inspection.mediaBox)
    || !exactArray(result.pageFrame.cropBox, inspection.cropBox)
    || result.pageFrame.rotate !== inspection.rotate
    || !integer(result.pageFrame.rotate, 0, 270)) return false;
  const frame = expectedFrame(inspection.cropBox, inspection.rotate, size[0], size[1]);
  if (!array(result.pageFrame.visibleSizePt, 2)
    || !sameArray(result.pageFrame.visibleSizePt, frame.visibleSizePt)
    || !matrix(result.pageFrame.nativeToVisible)
    || !matrix(result.pageFrame.visibleToNative)
    || !matrix(result.render.visibleToPixel)
    || !matrix(result.render.pixelToVisible)
    || !sameArray(result.pageFrame.nativeToVisible, frame.nativeToVisible)
    || !sameArray(result.pageFrame.visibleToNative, frame.visibleToNative)
    || !sameArray(result.render.visibleToPixel, frame.visibleToPixel)
    || !sameArray(result.render.pixelToVisible, frame.pixelToVisible)) return false;
  if (Math.abs(size[0] - frame.visibleSizePt[0] * result.render.dpi / 72) > 1.01
    || Math.abs(size[1] - frame.visibleSizePt[1] * result.render.dpi / 72) > 1.01) return false;
  const [x0, y0, x1, y1] = inspection.cropBox;
  for (const native of [[x0, y0], [x0, y1], [x1, y0], [x1, y1],
    [(x0 + x1) / 2, (y0 + y1) / 2]] as [number, number][]) {
    const visible = transform(result.pageFrame.nativeToVisible, native);
    const restored = transform(result.pageFrame.visibleToNative, visible);
    const pixels = transform(result.render.visibleToPixel, visible);
    const restoredVisible = transform(result.render.pixelToVisible, pixels);
    if (native.some((coordinate, index) => Math.abs(coordinate - restored[index]) > 1e-4)
      || visible.some((coordinate, index) =>
        Math.abs(coordinate - restoredVisible[index]) > 1e-4)) return false;
  }
  if (!Array.isArray(result.candidates) || result.candidates.length > 128
    || result.status === "ABSTAIN" && (result.candidates.length !== 0
      || typeof result.reasonCode !== "string" || !result.reasonCode)
    || result.status === "PROPOSAL" && (result.candidates.length === 0
      || result.reasonCode !== null)) return false;
  for (const [ordinal, candidate] of result.candidates.entries()) {
    if (!record(candidate) || !exact(candidate, ["ordinal", "geometry", "provenance"])
      || candidate.ordinal !== ordinal || !record(candidate.geometry)
      || !exact(candidate.geometry, ["kind", "coordinates"])
      || !(candidate.geometry.kind === "POINT" && point(candidate.geometry.coordinates)
        || candidate.geometry.kind === "POLYGON" && polygon(candidate.geometry.coordinates))
      || !record(candidate.provenance)) return false;
    const provenance = candidate.provenance;
    if (provenance.kind === "PDF_VECTOR_PATH") {
      if (!exact(provenance, ["kind", "drawingIndex", "itemIndex", "pathSha256"])
        || !integer(provenance.drawingIndex, 0, 1_000_000)
        || !integer(provenance.itemIndex, 0, 1_000_000)
        || !sha(provenance.pathSha256)
        || inspection.vectorItemSha256ByLocator[
          `${provenance.drawingIndex}:${provenance.itemIndex}`] !== provenance.pathSha256) return false;
    } else if (provenance.kind === "RASTER_MASK") {
      if (!exact(provenance, ["kind", "maskSha256", "renderSha256", "widthPx", "heightPx"])
        || !sha(provenance.maskSha256)
        || provenance.renderSha256 !== result.render.renderSha256
        || provenance.widthPx !== size[0] || provenance.heightPx !== size[1]) return false;
      const bytes = input.maskBytesBySha?.[provenance.maskSha256];
      const maskSize = bytes && Buffer.isBuffer(bytes) ? pngSize(bytes) : null;
      if (!bytes || !maskSize || sha256(bytes) !== provenance.maskSha256
        || maskSize[0] !== size[0] || maskSize[1] !== size[1]) return false;
    } else return false;
  }
  return true;
}

/** Returns false on any untrusted, incomplete, or unsupported geometry evidence. */
export function verifyGeometryEvidence(input: GeometryEvidenceVerificationInput): boolean {
  try { return verified(input); } catch { return false; }
}
