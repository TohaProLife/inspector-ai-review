import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DocumentCoordinatePageFrame } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { PdfPreviewError } from "./pdf-preview.js";

const run = promisify(execFile);
let activeFrames = 0;

/** Original bytes have already been read and SHA-verified from API-owned storage. */
export async function readCanonicalPdfPageFrame(input: {
  sourceBytes: Buffer; expectedSourceSha256: string; sourceFileId: string;
  pdfPageNumber: number;
}): Promise<DocumentCoordinatePageFrame> {
  if (sha256(input.sourceBytes) !== input.expectedSourceSha256 || !input.sourceBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !Number.isSafeInteger(input.pdfPageNumber) || input.pdfPageNumber < 1 || input.pdfPageNumber > 10_000) {
    throw new PdfPreviewError(422, "INVALID_SOURCE", "Исходный PDF или область привязки недопустимы");
  }
  if (activeFrames >= 2) throw new PdfPreviewError(429, "PAGE_FRAME_BUSY", "Проверка геометрии страниц занята; повторите запрос");
  activeFrames += 1;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "inspector-local-frame-"));
    const path = join(directory, "source.pdf"); await writeFile(path, input.sourceBytes, { mode: 0o600 });
    const { stdout } = await run("pdfinfo", ["-f", String(input.pdfPageNumber), "-l", String(input.pdfPageNumber), "-box", path],
      { timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, LC_ALL: "C" } });
    const pageCount = Number(/^Pages:\s*(\d+)\s*$/mu.exec(stdout)?.[1]);
    if (!Number.isSafeInteger(pageCount) || input.pdfPageNumber > pageCount) {
      throw new PdfPreviewError(404, "PAGE_NOT_FOUND", "Страница PDF не найдена");
    }
    const box = (name: string): number[] => {
      const match = new RegExp(`^Page\\s+${input.pdfPageNumber}\\s+${name}:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`, "m").exec(stdout);
      if (!match) throw new PdfPreviewError(422, "PAGE_FRAME_UNAVAILABLE", "Геометрия исходной страницы неизвестна");
      return match.slice(1).map(Number);
    };
    const mediaBox = box("MediaBox"); const cropBox = box("CropBox");
    const rotate = Number(new RegExp(`^Page\\s+${input.pdfPageNumber}\\s+rot:\\s*(0|90|180|270)\\s*$`, "m").exec(stdout)?.[1]);
    if (!Number.isSafeInteger(rotate) || ![0, 90, 180, 270].includes(rotate)
      || [...mediaBox, ...cropBox].some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)
      || mediaBox[2] <= mediaBox[0] || mediaBox[3] <= mediaBox[1]
      || cropBox[2] <= cropBox[0] || cropBox[3] <= cropBox[1]
      || cropBox.some((value, i) => i < 2 ? value < mediaBox[i] - 0.01 : value > mediaBox[i] + 0.01)) {
      throw new PdfPreviewError(422, "PAGE_FRAME_UNAVAILABLE", "Геометрия страницы PDF недопустима");
    }
    const width = cropBox[2] - cropBox[0]; const height = cropBox[3] - cropBox[1];
    const frameArtifact = { profile: "poppler-local-page-frame-box-2dp-v1", sourceSha256: input.expectedSourceSha256,
      pdfPageNumber: input.pdfPageNumber, mediaBox, cropBox, rotate, precisionPt: 0.01 };
    return { sourceFileId: input.sourceFileId, sourceSha256: input.expectedSourceSha256,
      pdfPageNumber: input.pdfPageNumber, pageFrameSha256: sha256(canonicalJson(frameArtifact)),
      coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED", visibleWidthPt: rotate % 180 ? height : width,
      visibleHeightPt: rotate % 180 ? width : height, rotate: rotate as DocumentCoordinatePageFrame["rotate"],
      geometryPrecisionPt: 0.01 };
  } catch (error) {
    if (error instanceof PdfPreviewError) throw error;
    throw new PdfPreviewError(422, "PAGE_FRAME_UNAVAILABLE", "Не удалось проверить геометрию исходного PDF");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    activeFrames -= 1;
  }
}
