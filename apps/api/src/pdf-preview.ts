import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_CONCURRENT_PREVIEWS = 2;
const MAX_CROP_DPI = 600;
const MAX_VIRTUAL_PAGE_PIXELS = 50_000_000;
const TARGET_CROP_PIXELS = 1200;
let activePreviews = 0;

export type NormalizedCrop = readonly [number, number, number, number];

export class PdfPreviewError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function parseNormalizedCrop(value: unknown): NormalizedCrop | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PdfPreviewError(400, "INVALID_CROP", "Некорректная область просмотра");
  const fields = value.split(",");
  if (fields.length !== 4 || fields.some((field) => !/^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(field))) {
    throw new PdfPreviewError(400, "INVALID_CROP", "Некорректная область просмотра");
  }
  const coordinates = fields.map(Number) as unknown as NormalizedCrop;
  if (!(coordinates[0] < coordinates[2] && coordinates[1] < coordinates[3])) {
    throw new PdfPreviewError(400, "INVALID_CROP", "Область просмотра вне листа");
  }
  return coordinates;
}

function cropArguments(info: string, pageNumber: number, bbox: NormalizedCrop): string[] {
  const cropBox = new RegExp(`^Page\\s+${pageNumber}\\s+CropBox:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`, "m").exec(info);
  const rotation = new RegExp(`^Page\\s+${pageNumber}\\s+rot:\\s*(0|90|180|270)\\s*$`, "m").exec(info);
  if (!cropBox || !rotation) {
    throw new PdfPreviewError(422, "INVALID_SOURCE", "Геометрия страницы PDF неизвестна");
  }
  const values = cropBox.slice(1).map(Number);
  const [x0, y0, x1, y1] = values;
  let widthPt = x1 - x0;
  let heightPt = y1 - y0;
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    throw new PdfPreviewError(422, "INVALID_SOURCE", "Геометрия страницы PDF недопустима");
  }
  if (rotation[1] === "90" || rotation[1] === "270") [widthPt, heightPt] = [heightPt, widthPt];

  // Keep a long text line readable as a strip instead of expanding its context
  // to the whole page. Tall, narrow proposals still get a near-square crop.
  let regionWidth = Math.min(1, Math.max((bbox[2] - bbox[0]) * 1.5, 0.1));
  let regionHeight = Math.min(1, Math.max((bbox[3] - bbox[1]) * 4, 0.08));
  if (regionWidth * widthPt < regionHeight * heightPt) {
    regionWidth = Math.min(1, regionHeight * heightPt / widthPt);
  }
  const left = Math.max(0, Math.min(1 - regionWidth, (bbox[0] + bbox[2] - regionWidth) / 2));
  const top = Math.max(0, Math.min(1 - regionHeight, (bbox[1] + bbox[3] - regionHeight) / 2));
  const targetDpi = TARGET_CROP_PIXELS * 72 / Math.max(regionWidth * widthPt, regionHeight * heightPt);
  const pixelBoundDpi = Math.sqrt(MAX_VIRTUAL_PAGE_PIXELS / (widthPt * heightPt)) * 72;
  const dpi = Math.floor(Math.min(MAX_CROP_DPI, targetDpi, pixelBoundDpi));
  if (dpi < 1) throw new PdfPreviewError(422, "PDF_RENDER_FAILED", "Размер страницы PDF вне лимита");
  const renderedWidth = Math.ceil(widthPt * dpi / 72);
  const renderedHeight = Math.ceil(heightPt * dpi / 72);
  const x = Math.floor(left * renderedWidth);
  const y = Math.floor(top * renderedHeight);
  const width = Math.min(renderedWidth - x, Math.ceil((left + regionWidth) * renderedWidth) - x);
  const height = Math.min(renderedHeight - y, Math.ceil((top + regionHeight) * renderedHeight) - y);
  if (width < 1 || height < 1 || width > 1600 || height > 1600 || width * height > 2_560_000) {
    throw new PdfPreviewError(422, "PDF_RENDER_FAILED", "Размер фрагмента PDF вне лимита");
  }
  return ["-r", String(dpi), "-x", String(x), "-y", String(y), "-W", String(width), "-H", String(height)];
}

export async function renderVerifiedPdfPage(
  input: Readable,
  expected: { byteSize: number; sha256: string },
  pageNumber: number,
  crop?: NormalizedCrop,
): Promise<Buffer> {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10_000) {
    input.destroy();
    throw new PdfPreviewError(400, "INVALID_PAGE", "Номер страницы вне допустимого диапазона");
  }
  if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize < 1
    || expected.byteSize > MAX_SOURCE_BYTES || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    input.destroy();
    throw new PdfPreviewError(422, "INVALID_SOURCE", "Исходный PDF не прошёл проверку метаданных");
  }
  if (activePreviews >= MAX_CONCURRENT_PREVIEWS) {
    input.destroy();
    throw new PdfPreviewError(429, "PREVIEW_BUSY", "Просмотр страниц занят; повторите запрос позднее");
  }
  activePreviews += 1;
  let directory: string | undefined;
  const digest = createHash("sha256");
  let byteSize = 0;
  try {
    directory = await mkdtemp(join(tmpdir(), "inspector-page-preview-"));
    const source = join(directory, "source.pdf");
    const output = join(directory, "page.png");
    await pipeline(input, new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > expected.byteSize) {
          callback(new PdfPreviewError(422, "SOURCE_INTEGRITY_ERROR", "Размер исходного PDF не совпал"));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(source), { signal: AbortSignal.timeout(30_000) });
    if (byteSize !== expected.byteSize || digest.digest("hex") !== expected.sha256) {
      throw new PdfPreviewError(422, "SOURCE_INTEGRITY_ERROR", "Контрольная сумма исходного PDF не совпала");
    }
    let info: { stdout: string; stderr: string };
    try {
      info = await execFileAsync("pdfinfo", crop ? ["-f", String(pageNumber), "-l", String(pageNumber), "-box", source] : [source], {
        timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, LC_ALL: "C" },
      });
    } catch {
      throw new PdfPreviewError(422, "INVALID_SOURCE", "Не удалось прочитать исходный PDF");
    }
    const pages = /^Pages:\s*(\d+)\s*$/m.exec(info.stdout);
    const pageCount = pages ? Number(pages[1]) : 0;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw new PdfPreviewError(422, "INVALID_SOURCE", "Число страниц PDF неизвестно");
    }
    if (pageNumber > pageCount) {
      throw new PdfPreviewError(404, "PAGE_NOT_FOUND", "Страница PDF не найдена");
    }
    try {
      await execFileAsync("pdftoppm", [
        "-f", String(pageNumber), "-l", String(pageNumber), "-singlefile",
        "-cropbox", ...(crop ? cropArguments(info.stdout, pageNumber, crop) : ["-scale-to", "1200"]),
        "-png", source, join(directory, "page"),
      ], { timeout: 60_000, maxBuffer: 256 * 1024, env: { ...process.env, LC_ALL: "C" } });
    } catch {
      throw new PdfPreviewError(422, "PDF_RENDER_FAILED", "Не удалось отобразить страницу PDF");
    }
    const metadata = await stat(output);
    if (!metadata.isFile() || metadata.size < 8 || metadata.size > MAX_PREVIEW_BYTES) {
      throw new PdfPreviewError(422, "PDF_RENDER_FAILED", "Размер изображения страницы вне лимита");
    }
    const image = await readFile(output);
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new PdfPreviewError(422, "PDF_RENDER_FAILED", "Изображение страницы повреждено");
    }
    return image;
  } finally {
    input.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
    activePreviews -= 1;
  }
}
