import { sha256 } from "./canonical-json.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type PdfWord = {
  pageNumber: number;
  wordIndex: number;
  rawText: string;
  wordTextSha256: string;
  bboxMilliPointsTopLeft: [number, number, number, number];
};

/** Produced by an API-owned PDF parser from source bytes, never from a worker result. */
export type TrustedPageWords = {
  providerId: "api-independent-pdf-words-v1";
  sourceSha256: string;
  pdfPageCount: number;
  pageNumber: number;
  pageWidthMilliPoints: number;
  pageHeightMilliPoints: number;
  pageText: string;
  words: PdfWord[];
  inspectionSha256: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
/** Python json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":")) parity. */
export function pythonCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${pythonCanonicalJson(value[key])}`).join(",")}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("non-JSON value");
  return serialized;
}
export const pythonHash = (value: unknown): string => sha256(pythonCanonicalJson(value));

export function verifyTrustedPageWords(
  pdfBytes: Buffer,
  sourceSha256: string,
  pageCount: number,
  inspection: TrustedPageWords,
): boolean {
  try {
    if (!Buffer.isBuffer(pdfBytes) || !hash(sourceSha256)
      || sha256(pdfBytes) !== sourceSha256 || !safe(pageCount, 1)
      || !record(inspection)
      || inspection.providerId !== "api-independent-pdf-words-v1"
      || inspection.sourceSha256 !== sourceSha256
      || inspection.pdfPageCount !== pageCount
      || !safe(inspection.pageNumber, 1) || inspection.pageNumber > pageCount
      || !safe(inspection.pageWidthMilliPoints, 1)
      || !safe(inspection.pageHeightMilliPoints, 1)
      || typeof inspection.pageText !== "string"
      || !Array.isArray(inspection.words) || inspection.words.length > 50_000
      || !hash(inspection.inspectionSha256)) return false;
    const { inspectionSha256, ...body } = inspection;
    if (pythonHash(body) !== inspectionSha256) return false;
    for (const [index, word] of inspection.words.entries()) {
      if (!record(word) || word.pageNumber !== inspection.pageNumber
        || word.wordIndex !== index || typeof word.rawText !== "string"
        || !hash(word.wordTextSha256)
        || sha256(word.rawText) !== word.wordTextSha256
        || !Array.isArray(word.bboxMilliPointsTopLeft)
        || word.bboxMilliPointsTopLeft.length !== 4
        || !word.bboxMilliPointsTopLeft.every((value) => safe(value))) return false;
      const [left, top, right, bottom] = word.bboxMilliPointsTopLeft;
      if (left > right || right > inspection.pageWidthMilliPoints
        || top > bottom || bottom > inspection.pageHeightMilliPoints) return false;
    }
    return true;
  } catch {
    return false;
  }
}

type PopplerWord = { text: string; box: [number, number, number, number] };
const decodeXml = (text: string): string => text.replace(
  /&(?:amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/gu,
  (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
    };
    if (named[entity]) return named[entity];
    const number = entity.startsWith("&#x")
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number) : entity;
  });

/**
 * Independent Poppler check for individual candidate words. Poppler and
 * PyMuPDF segment/order words differently; this does not verify wordIndex,
 * full proposal counts, or absence. Do not use it as a standalone durable gate.
 */
export function corroboratePdfWordsWithPoppler(input: {
  pdfPath: string; sourceSha256: string; pageNumber: number; words: PdfWord[];
}): boolean {
  try {
    if (!hash(input.sourceSha256) || !safe(input.pageNumber, 1)
      || !Array.isArray(input.words) || input.words.length < 1
      || input.words.length > 100 || sha256(readFileSync(input.pdfPath)) !== input.sourceSha256
      || input.words.some((word) => word.pageNumber !== input.pageNumber
        || !safe(word.wordIndex) || sha256(word.rawText) !== word.wordTextSha256)) return false;
    const xml = execFileSync("pdftotext", ["-f", String(input.pageNumber), "-l",
      String(input.pageNumber), "-bbox-layout", "-enc", "UTF-8", input.pdfPath, "-"],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    const matches = [...xml.matchAll(/<word\s+xMin="([0-9.]+)"\s+yMin="([0-9.]+)"\s+xMax="([0-9.]+)"\s+yMax="([0-9.]+)">([^<]*)<\/word>/gu)];
    const poppler: PopplerWord[] = matches.map((match) => ({ text: decodeXml(match[5]),
      box: [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] }));
    if (!poppler.length || poppler.some((word) => word.box.some((value) => !Number.isFinite(value)))) {
      return false;
    }
    // Poppler separates superscript footnote markers: 0,65 + * and 0,85 + **.
    // Combine only this observed adjacent numeric/marker pair; never join words generally.
    const withFootnotes = [...poppler];
    for (const [index, word] of poppler.entries()) {
      const marker = poppler[index + 1];
      if (!marker || !/^\d{1,2}[,.]\d{1,3}$/u.test(word.text)
        || !/^\*{1,2}$/u.test(marker.text)
        || marker.box[0] < word.box[2]
        || marker.box[0] - word.box[2] > 0.2
        || Math.min(word.box[3], marker.box[3]) - Math.max(word.box[1], marker.box[1]) <= 0) {
        continue;
      }
      withFootnotes.push({ text: word.text + marker.text,
        box: [word.box[0], Math.min(word.box[1], marker.box[1]),
          marker.box[2], Math.max(word.box[3], marker.box[3])] });
    }
    return input.words.every((word) => {
      const [left, top, right, bottom] = word.bboxMilliPointsTopLeft.map((value) => value / 1000);
      const height = bottom - top;
      const corroborating = withFootnotes.filter((candidate) => {
        const [x0, y0, x1, y1] = candidate.box;
        const overlap = Math.min(bottom, y1) - Math.max(top, y0);
        return candidate.text === word.rawText && Math.abs(x0 - left) <= 0.1
          && Math.abs(x1 - right) <= 0.1 && height > 0 && y1 > y0
          && overlap >= 0.7 * Math.min(height, y1 - y0);
      });
      return corroborating.length === 1;
    });
  } catch {
    return false;
  }
}
