import { canonicalJson, sha256 } from "./canonical-json.js";
import { inspectGeometryPageWithVerifiedPopplerRender } from "./geometry-poppler-inspection.js";
import { readRawPdfPageFrame } from "./geometry-pdf-raw-page.js";

type Json = Record<string, unknown>;
type Box = [number, number, number, number];
const shaPattern = /^[0-9a-f]{64}$/u;
const profilePattern = /^poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@\d+\.\d+\.\d+$/u;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const sha = (value: unknown): value is string => typeof value === "string"
  && shaPattern.test(value);
const finite = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value);
const integer = (value: unknown, low: number, high: number): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= low && value <= high;
const box = (value: unknown): value is Box => Array.isArray(value) && value.length === 4
  && value.every(finite) && value[2] > value[0] && value[3] > value[1];
const withinPrintedPrecision = (raw: Box, printed: Box): boolean => raw.every(
  (value, index) => Math.abs(value - printed[index]) < 0.005 - 1e-9);

function pngSize(bytes: Buffer): [number, number] | null {
  if (bytes.length < 45 || !bytes.subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width >= 1 && height >= 1 && width * height <= 16_000_000
    ? [width, height] : null;
}

export interface GeometryPageFrameV2Input {
  artifact: { content_json: unknown; content_hash: string };
  sourceBytes: Buffer;
  renderBytes: Buffer;
}

/**
 * Review-only bridge for Poppler's two-decimal frame output. It authenticates
 * one PDF page and exact Poppler PNG, but never validates object geometry.
 * A successful result only permits an immutable ABSTAIN navigation packet.
 */
export async function verifyGeometryPageFrameV2(input: GeometryPageFrameV2Input): Promise<boolean> {
  try {
    const { artifact, sourceBytes, renderBytes } = input;
    if (!record(artifact) || !exact(artifact, ["content_json", "content_hash"])
      || !sha(artifact.content_hash) || !record(artifact.content_json)
      || !Buffer.isBuffer(sourceBytes) || !Buffer.isBuffer(renderBytes)
      || Buffer.byteLength(canonicalJson(artifact.content_json), "utf8") > 16 * 1024
      || sha256(canonicalJson(artifact.content_json)) !== artifact.content_hash) return false;
    const packet = artifact.content_json;
    if (!exact(packet, ["schemaVersion", "status", "reasonCode", "source", "render",
      "workerFrame", "parserPrecision", "candidates"])
      || packet.schemaVersion !== "geometry-page-frame-v2" || packet.status !== "ABSTAIN"
      || packet.reasonCode !== "PAGE_FRAME_PRECISION_UNRESOLVED"
      || !Array.isArray(packet.candidates) || packet.candidates.length !== 0
      || !record(packet.source) || !exact(packet.source,
        ["sourceFileId", "sourceSha256", "byteSize", "pdfPageNumber"])
      || typeof packet.source.sourceFileId !== "string" || packet.source.sourceFileId.length === 0
      || !sha(packet.source.sourceSha256) || packet.source.sourceSha256 !== sha256(sourceBytes)
      || packet.source.byteSize !== sourceBytes.length
      || !integer(packet.source.pdfPageNumber, 1, 10_000)
      || !record(packet.render) || !exact(packet.render,
        ["rendererProfileId", "renderSha256", "byteSize", "widthPx", "heightPx"])
      || typeof packet.render.rendererProfileId !== "string"
      || !profilePattern.test(packet.render.rendererProfileId)
      || packet.render.renderSha256 !== sha256(renderBytes)
      || packet.render.byteSize !== renderBytes.length
      || !record(packet.workerFrame) || !exact(packet.workerFrame,
        ["mediaBox", "cropBox", "rotate"])
      || !box(packet.workerFrame.mediaBox) || !box(packet.workerFrame.cropBox)
      || ![0, 90, 180, 270].includes(packet.workerFrame.rotate as number)
      || !record(packet.parserPrecision) || !exact(packet.parserPrecision,
        ["profileId", "boxStepPt"])
      || packet.parserPrecision.profileId !== "poppler-pdfinfo-box-2dp-v1"
      || packet.parserPrecision.boxStepPt !== 0.01) return false;
    const size = pngSize(renderBytes);
    if (!size || packet.render.widthPx !== size[0] || packet.render.heightPx !== size[1]) return false;
    const inspected = await inspectGeometryPageWithVerifiedPopplerRender({
      sourceBytes, renderBytes, pdfPageNumber: packet.source.pdfPageNumber,
      expectedSourceSha256: packet.source.sourceSha256,
      expectedRenderSha256: packet.render.renderSha256,
      rendererProfileId: packet.render.rendererProfileId,
    });
    if (packet.workerFrame.rotate !== inspected.rotate
      || !withinPrintedPrecision(packet.workerFrame.mediaBox, inspected.mediaBox)
      || !withinPrintedPrecision(packet.workerFrame.cropBox, inspected.cropBox)) return false;
    const media = packet.workerFrame.mediaBox;
    const crop = packet.workerFrame.cropBox;
    return crop[0] >= media[0] && crop[1] >= media[1]
      && crop[2] <= media[2] && crop[3] <= media[3];
  } catch {
    return false;
  }
}

/**
 * Stricter review gate for PDFs supported by the lossless page-tree reader.
 * PyMuPDF reports PDF box operands after float32 conversion, so compare that
 * conversion explicitly with independently read original numeric operands.
 * This still permits only ABSTAIN navigation, never a geometry finding.
 */
export async function verifyGeometryPageFrameV2AgainstRawPage(
  input: GeometryPageFrameV2Input,
): Promise<boolean> {
  try {
    if (!await verifyGeometryPageFrameV2(input)) return false;
    const packet = input.artifact.content_json as Json;
    const source = packet.source as Json;
    const workerFrame = packet.workerFrame as Json;
    const raw = readRawPdfPageFrame(input.sourceBytes, source.pdfPageNumber as number);
    const matches = (claimed: unknown, operands: readonly string[]): boolean =>
      Array.isArray(claimed) && claimed.length === 4
      && claimed.every((value, index) => value === Math.fround(Number(operands[index])));
    return raw.sourceSha256 === source.sourceSha256
      && raw.rotate === workerFrame.rotate
      && matches(workerFrame.mediaBox, raw.mediaBoxOperands)
      && matches(workerFrame.cropBox, raw.cropBoxOperands);
  } catch {
    return false;
  }
}
