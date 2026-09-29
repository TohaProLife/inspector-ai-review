import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GeometryPageInspection } from "./geometry-evidence.js";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_RENDER_BYTES = 128 * 1024 * 1024;
const MAX_PAGE_NUMBER = 10_000;
const MAX_CONCURRENT_INSPECTIONS = 2;
const PDFINFO_TIMEOUT_MS = 15_000;
const PDFINFO_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_VERIFIED_RENDER_PIXELS = 16_000_000;
const POPPLER_RENDER_PROFILE_PREFIX = "poppler-pdftoppm-cropbox-72dpi-png-singlefile-v1@";
const numberPattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
type Box = [number, number, number, number];
let activeInspections = 0;

export interface PopplerGeometryInspectionInput {
  sourceBytes: Buffer;
  renderBytes: Buffer;
  pdfPageNumber: number;
  expectedSourceSha256?: string;
  expectedRenderSha256?: string;
}

export interface VerifiedPopplerRenderInspectionInput extends PopplerGeometryInspectionInput {
  /** Must match artifact.render.rendererProfileId and installed pdftoppm version. */
  rendererProfileId: string;
}

function singleMatch(output: string, expression: RegExp, label: string): RegExpExecArray {
  const matches = [...output.matchAll(expression)];
  if (matches.length !== 1) throw new Error(`ambiguous Poppler ${label}`);
  return matches[0];
}

function parsedBox(output: string, page: number, label: "MediaBox" | "CropBox"): Box {
  const expression = new RegExp(
    `^Page\\s+${page}\\s+${label}:\\s*(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})\\s+(${numberPattern})\\s*$`,
    "gm",
  );
  const parts = singleMatch(output, expression, label).slice(1).map(Number);
  if (parts.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)
    || parts[2] <= parts[0] || parts[3] <= parts[1]) {
    throw new Error(`invalid Poppler ${label}`);
  }
  return parts as Box;
}

/**
 * Parse one physical page from Poppler's `pdfinfo -box -f N -l N` output.
 * Poppler prints PDF boxes at limited decimal precision. Geometry verification
 * compares these values to the worker artifact exactly and abstains if rounded.
 */
export function parsePopplerPageInspection(output: string, page: number):
  Pick<GeometryPageInspection, "mediaBox" | "cropBox" | "rotate"> {
  if (typeof output !== "string" || Buffer.byteLength(output, "utf8") > PDFINFO_MAX_OUTPUT_BYTES
    || !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE_NUMBER) {
    throw new Error("invalid Poppler page inspection input");
  }
  const pages = Number(singleMatch(output, /^Pages:\s*(\d+)\s*$/gm, "page count")[1]);
  const encrypted = singleMatch(output, /^Encrypted:\s*(yes|no)(?:\s+.*)?$/gm, "encryption")[1];
  if (!Number.isSafeInteger(pages) || pages < page || pages > 1_000_000 || encrypted !== "no") {
    throw new Error("invalid or encrypted PDF page");
  }
  // A one-page selection must not silently include another page or duplicate fields.
  const reportedPages = [...output.matchAll(/^Page\s+(\d+)\s+(?:size|rot|MediaBox|CropBox):/gm)];
  if (reportedPages.length !== 4 || reportedPages.some((match) => Number(match[1]) !== page)) {
    throw new Error("ambiguous Poppler page selection");
  }
  const rotation = Number(singleMatch(output,
    new RegExp(`^Page\\s+${page}\\s+rot:\\s*(-?\\d+)\\s*$`, "gm"), "rotation")[1]);
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new Error("unsupported PDF rotation");
  }
  const mediaBox = parsedBox(output, page, "MediaBox");
  const cropBox = parsedBox(output, page, "CropBox");
  if (cropBox[0] < mediaBox[0] - 1e-5 || cropBox[1] < mediaBox[1] - 1e-5
    || cropBox[2] > mediaBox[2] + 1e-5 || cropBox[3] > mediaBox[3] + 1e-5) {
    throw new Error("CropBox outside MediaBox");
  }
  return { mediaBox, cropBox, rotate: rotation };
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validPngEnvelope(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width >= 1 && width <= 100_000 && height >= 1 && height <= 100_000
    && width * height <= 64_000_000;
}

/**
 * Independent page-frame inspection from original PDF bytes, using Poppler.
 * Render SHA binds supplied bytes to the artifact; Poppler does not prove that
 * those pixels are a faithful render. Vector locators remain unsupported.
 * Callers must not treat this alone as evidence for raster proposals.
 */
async function inspect(
  input: PopplerGeometryInspectionInput,
  exactRenderProfileId?: string,
): Promise<GeometryPageInspection> {
  const { sourceBytes, renderBytes, pdfPageNumber } = input;
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length < 5
    || sourceBytes.length > MAX_SOURCE_BYTES
    || !sourceBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !Buffer.isBuffer(renderBytes) || renderBytes.length > MAX_RENDER_BYTES
    || !validPngEnvelope(renderBytes)
    || !Number.isSafeInteger(pdfPageNumber) || pdfPageNumber < 1
    || pdfPageNumber > MAX_PAGE_NUMBER) throw new Error("geometry input outside bounds");
  const sourceSha256 = digest(sourceBytes);
  const renderSha256 = digest(renderBytes);
  if (input.expectedSourceSha256 !== undefined && input.expectedSourceSha256 !== sourceSha256
    || input.expectedRenderSha256 !== undefined && input.expectedRenderSha256 !== renderSha256) {
    throw new Error("geometry source or render SHA mismatch");
  }
  if (activeInspections >= MAX_CONCURRENT_INSPECTIONS) {
    throw new Error("geometry inspection concurrency limit");
  }
  activeInspections += 1;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "inspector-geometry-poppler-"));
    const sourcePath = join(directory, "source.pdf");
    await writeFile(sourcePath, sourceBytes, { mode: 0o600, flag: "wx" });
    const { stdout, stderr } = await execFileAsync("pdfinfo", [
      "-f", String(pdfPageNumber), "-l", String(pdfPageNumber), "-box", sourcePath,
    ], { timeout: PDFINFO_TIMEOUT_MS, maxBuffer: PDFINFO_MAX_OUTPUT_BYTES,
      env: { ...process.env, LC_ALL: "C" }, encoding: "utf8" });
    if (stderr.trim() !== "") throw new Error("Poppler reported PDF warning");
    const page = parsePopplerPageInspection(stdout, pdfPageNumber);
    if (exactRenderProfileId !== undefined) {
      const claimedVersion = exactRenderProfileId.startsWith(POPPLER_RENDER_PROFILE_PREFIX)
        ? exactRenderProfileId.slice(POPPLER_RENDER_PROFILE_PREFIX.length) : "";
      if (!/^\d+\.\d+\.\d+$/u.test(claimedVersion)) {
        throw new Error("unsupported Poppler renderer profile");
      }
      const { stdout: versionOut, stderr: versionErr } = await execFileAsync("pdftoppm", ["-v"], {
        timeout: 5_000, maxBuffer: 8 * 1024,
        env: { ...process.env, LC_ALL: "C" }, encoding: "utf8",
      });
      const versionText = `${versionOut}\n${versionErr}`;
      const versionMatch = /^pdftoppm version (\d+\.\d+\.\d+)\s*$/m.exec(versionText);
      if (!versionMatch || claimedVersion !== versionMatch[1]) {
        throw new Error("Poppler renderer version mismatch");
      }
      const width = page.cropBox[2] - page.cropBox[0];
      const height = page.cropBox[3] - page.cropBox[1];
      if (Math.ceil(width) < 1 || Math.ceil(height) < 1
        || Math.ceil(width) > 10_000 || Math.ceil(height) > 10_000
        || Math.ceil(width) * Math.ceil(height) > MAX_VERIFIED_RENDER_PIXELS) {
        throw new Error("Poppler render dimensions outside bounds");
      }
      const outputPrefix = join(directory, "page");
      const renderedPath = `${outputPrefix}.png`;
      const render = await execFileAsync("pdftoppm", [
        "-f", String(pdfPageNumber), "-l", String(pdfPageNumber), "-r", "72",
        "-cropbox", "-png", "-singlefile", sourcePath, outputPrefix,
      ], { timeout: 30_000, maxBuffer: PDFINFO_MAX_OUTPUT_BYTES,
        env: { ...process.env, LC_ALL: "C" }, encoding: "utf8" });
      if (render.stdout.trim() !== "" || render.stderr.trim() !== "") {
        throw new Error("Poppler reported render warning");
      }
      const renderedStat = await stat(renderedPath);
      if (!renderedStat.isFile() || renderedStat.size < 45 || renderedStat.size > MAX_RENDER_BYTES) {
        throw new Error("Poppler render size outside bounds");
      }
      const independentlyRendered = await readFile(renderedPath);
      if (!validPngEnvelope(independentlyRendered)
        || independentlyRendered.length !== renderBytes.length
        || !independentlyRendered.equals(renderBytes)) {
        throw new Error("Poppler render bytes mismatch");
      }
    }
    return { sourceSha256, pdfPageNumber, renderSha256, ...page,
      vectorItemSha256ByLocator: {} };
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      activeInspections -= 1;
    }
  }
}

/**
 * Frame-only provider. Use for ABSTAIN page evidence; it does not authenticate
 * pixels or raster masks and cannot verify PDF vector item locators.
 */
export async function inspectGeometryPageWithPoppler(
  input: PopplerGeometryInspectionInput,
): Promise<GeometryPageInspection> {
  return inspect(input);
}

/**
 * Exact Poppler PNG provider for a single pinned 72 dpi, cropped-page profile.
 * Caller must pass the artifact's rendererProfileId. Only this result can
 * authenticate the source/render binding needed by raster-mask proposals.
 * Classification, page registration and mask semantics remain unverified.
 */
export async function inspectGeometryPageWithVerifiedPopplerRender(
  input: VerifiedPopplerRenderInspectionInput,
): Promise<GeometryPageInspection> {
  return inspect(input, input.rendererProfileId);
}
