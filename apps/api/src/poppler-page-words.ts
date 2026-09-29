import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SaxesParser } from "saxes";
import { sha256 } from "./canonical-json.js";
import { pythonHash, verifyTrustedPageWords,
  type TrustedPageWords } from "./trusted-page-words.js";

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_WORDS = 5000;
const MAX_PAGES = 10_000;
const PROVIDER_PREFIX = "api-poppler-pdftotext-bbox-layout-v1@";
let activeInspections = 0;

export type IndependentPdfWord = {
  wordIndex: number;
  rawText: string;
  bboxMilliPointsTopLeft: [number, number, number, number];
};

export type IndependentPdfPageWords = {
  providerId: string;
  sourceSha256: string;
  pdfPageCount: number;
  pageNumber: number;
  pageWidthMilliPoints: number;
  pageHeightMilliPoints: number;
  xmlSha256: string;
  plainTextSha256: string;
  pageText: string;
  words: IndependentPdfWord[];
  inspectionSha256: string;
};

function singleMatch(value: string, pattern: RegExp, field: string): string {
  const matches = [...value.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`ambiguous ${field}`);
  return matches[0][1];
}

function pointsToMilliPoints(value: string | undefined): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) {
    throw new Error("invalid Poppler word coordinate");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100_000) {
    throw new Error("Poppler word coordinate outside bounds");
  }
  return Math.round(number * 1000);
}

/** Parses the entire one-page Poppler XML, including words outside candidate rows. */
export function parsePopplerPageWordsXml(xml: string): {
  pageWidthMilliPoints: number;
  pageHeightMilliPoints: number;
  words: IndependentPdfWord[];
} {
  if (typeof xml !== "string" || Buffer.byteLength(xml) > MAX_XML_BYTES) {
    throw new Error("Poppler XML outside bounds");
  }
  let pageCount = 0;
  let pageOpen = false;
  let pageWidthMilliPoints = 0;
  let pageHeightMilliPoints = 0;
  let currentWord: { text: string; box: [number, number, number, number] } | undefined;
  const words: IndependentPdfWord[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    if (tag.name === "page") {
      pageCount += 1;
      if (pageCount !== 1 || pageOpen) throw new Error("Poppler XML contains multiple pages");
      pageOpen = true;
      pageWidthMilliPoints = pointsToMilliPoints(String(tag.attributes.width ?? ""));
      pageHeightMilliPoints = pointsToMilliPoints(String(tag.attributes.height ?? ""));
      if (!pageWidthMilliPoints || !pageHeightMilliPoints) throw new Error("empty Poppler page");
    }
    if (tag.name === "word") {
      if (!pageOpen || currentWord || words.length >= MAX_WORDS) {
        throw new Error("Poppler word outside page or above limit");
      }
      const attributes = tag.attributes;
      const box: [number, number, number, number] = [
        pointsToMilliPoints(String(attributes.xMin ?? "")),
        pointsToMilliPoints(String(attributes.yMin ?? "")),
        pointsToMilliPoints(String(attributes.xMax ?? "")),
        pointsToMilliPoints(String(attributes.yMax ?? "")),
      ];
      if (box[0] > box[2] || box[2] > pageWidthMilliPoints
        || box[1] > box[3] || box[3] > pageHeightMilliPoints) {
        throw new Error("Poppler word outside page box");
      }
      currentWord = { text: "", box };
    }
  });
  parser.on("text", (value) => {
    if (currentWord) currentWord.text += value;
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "page") {
      if (!pageOpen || currentWord) throw new Error("incomplete Poppler page");
      pageOpen = false;
    }
    if (tag.name !== "word") return;
    if (!currentWord || !currentWord.text) throw new Error("empty Poppler word");
    words.push({ wordIndex: words.length, rawText: currentWord.text,
      bboxMilliPointsTopLeft: currentWord.box });
    currentWord = undefined;
  });
  parser.write(xml).close();
  if (pageCount !== 1 || pageOpen || currentWord || !words.length) {
    throw new Error("missing or incomplete Poppler page words");
  }
  return { pageWidthMilliPoints, pageHeightMilliPoints, words };
}

/** API-owned, bounded full-page parser from the original PDF bytes. */
export async function inspectPdfPageWordsWithPoppler(input: {
  originalPdfBytes: Buffer;
  expectedSourceSha256: string;
  expectedPdfPageCount: number;
  pageNumber: number;
}): Promise<IndependentPdfPageWords> {
  const { originalPdfBytes, expectedSourceSha256, expectedPdfPageCount, pageNumber } = input;
  if (!Buffer.isBuffer(originalPdfBytes) || originalPdfBytes.length < 5
    || originalPdfBytes.length > MAX_PDF_BYTES
    || originalPdfBytes.toString("ascii", 0, 5) !== "%PDF-"
    || !/^[0-9a-f]{64}$/u.test(expectedSourceSha256)
    || sha256(originalPdfBytes) !== expectedSourceSha256
    || !Number.isSafeInteger(expectedPdfPageCount) || expectedPdfPageCount < 1
    || expectedPdfPageCount > MAX_PAGES || !Number.isSafeInteger(pageNumber)
    || pageNumber < 1 || pageNumber > expectedPdfPageCount) {
    throw new Error("PDF word inspection source outside bounds or SHA mismatch");
  }
  if (activeInspections >= 2) throw new Error("PDF word inspection concurrency limit");
  activeInspections += 1;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "inspector-poppler-words-"));
    const pdfPath = join(directory, "source.pdf");
    await writeFile(pdfPath, originalPdfBytes, { mode: 0o600, flag: "wx" });
    const options = { encoding: "utf8" as const, timeout: 15_000,
      maxBuffer: MAX_XML_BYTES, env: { ...process.env, LC_ALL: "C" } };
    const version = await execFileAsync("pdftotext", ["-v"], options);
    const versionText = `${version.stdout}\n${version.stderr}`;
    const versionNumber = singleMatch(versionText,
      /^pdftotext version (\d+\.\d+\.\d+)\s*$/gm, "pdftotext version");
    const info = await execFileAsync("pdfinfo", [pdfPath], options);
    if (info.stderr.trim()) throw new Error("Poppler reported PDF warning");
    const pages = Number(singleMatch(info.stdout, /^Pages:\s*(\d+)\s*$/gm, "page count"));
    const encrypted = singleMatch(info.stdout,
      /^Encrypted:\s*(yes|no)(?:\s+.*)?$/gm, "PDF encryption");
    if (pages !== expectedPdfPageCount || encrypted !== "no") {
      throw new Error("Poppler page count or encryption mismatch");
    }
    const extracted = await execFileAsync("pdftotext", ["-f", String(pageNumber), "-l",
      String(pageNumber), "-bbox-layout", "-enc", "UTF-8", pdfPath, "-"], options);
    if (extracted.stderr.trim()) throw new Error("Poppler reported extraction warning");
    const plain = await execFileAsync("pdftotext", ["-f", String(pageNumber), "-l",
      String(pageNumber), "-raw", "-enc", "UTF-8", pdfPath, "-"], options);
    if (plain.stderr.trim()) throw new Error("Poppler reported text warning");
    const parsed = parsePopplerPageWordsXml(extracted.stdout);
    const body = { providerId: `${PROVIDER_PREFIX}${versionNumber}`,
      sourceSha256: expectedSourceSha256, pdfPageCount: expectedPdfPageCount,
      pageNumber, ...parsed, xmlSha256: sha256(extracted.stdout),
      plainTextSha256: sha256(plain.stdout), pageText: plain.stdout };
    return { ...body, inspectionSha256: pythonHash(body) };
  } finally {
    activeInspections -= 1;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export type FullWordEquivalence = {
  equivalent: boolean;
  reason: "FULL_ORDER_TEXT_BOX_AND_PAGE_TEXT_MATCH"
    | "SOURCE_OR_SCOPE_MISMATCH" | "WORD_COUNT_MISMATCH" | "WORD_ORDER_TEXT_OR_BOX_MISMATCH"
    | "PAGE_TEXT_MISMATCH";
  workerWordCount: number;
  independentWordCount: number;
};

const normalizedPageText = (value: string): string => value.replace(/\s+/gu, " ").trim();

/**
 * No partial mapping: every PyMuPDF word, its index/order, geometry and full
 * page text must agree with Poppler. Distinct parser segmentation fails closed.
 */
export function compareCompleteWorkerWordsWithPoppler(
  worker: TrustedPageWords,
  independent: IndependentPdfPageWords,
): FullWordEquivalence {
  const result = (reason: FullWordEquivalence["reason"]): FullWordEquivalence => ({
    equivalent: reason === "FULL_ORDER_TEXT_BOX_AND_PAGE_TEXT_MATCH", reason,
    workerWordCount: Array.isArray(worker?.words) ? worker.words.length : 0,
    independentWordCount: Array.isArray(independent?.words) ? independent.words.length : 0,
  });
  if (worker?.sourceSha256 !== independent?.sourceSha256
    || worker?.pdfPageCount !== independent?.pdfPageCount
    || worker?.pageNumber !== independent?.pageNumber
    || worker?.pageWidthMilliPoints !== independent?.pageWidthMilliPoints
    || worker?.pageHeightMilliPoints !== independent?.pageHeightMilliPoints) {
    return result("SOURCE_OR_SCOPE_MISMATCH");
  }
  if (worker.words.length !== independent.words.length) return result("WORD_COUNT_MISMATCH");
  for (const [index, word] of worker.words.entries()) {
    const other = independent.words[index];
    if (word.wordIndex !== index || other.wordIndex !== index || word.rawText !== other.rawText
      || word.pageNumber !== worker.pageNumber || sha256(word.rawText) !== word.wordTextSha256
      || word.bboxMilliPointsTopLeft.some((value, position) =>
        Math.abs(value - other.bboxMilliPointsTopLeft[position]) > 100)) {
      return result("WORD_ORDER_TEXT_OR_BOX_MISMATCH");
    }
  }
  if (normalizedPageText(worker.pageText) !== normalizedPageText(independent.pageText)) {
    return result("PAGE_TEXT_MISMATCH");
  }
  return result("FULL_ORDER_TEXT_BOX_AND_PAGE_TEXT_MATCH");
}

/** Produces independent words itself before comparing; never accepts a caller's receipt. */
export async function verifyCompleteWorkerWordsAgainstOriginalPdf(input: {
  originalPdfBytes: Buffer;
  expectedSourceSha256: string;
  expectedPdfPageCount: number;
  workerPage: TrustedPageWords;
}): Promise<FullWordEquivalence> {
  if (!verifyTrustedPageWords(input.originalPdfBytes, input.expectedSourceSha256,
    input.expectedPdfPageCount, input.workerPage)) {
    return { equivalent: false, reason: "SOURCE_OR_SCOPE_MISMATCH",
      workerWordCount: Array.isArray(input.workerPage?.words) ? input.workerPage.words.length : 0,
      independentWordCount: 0 };
  }
  const independent = await inspectPdfPageWordsWithPoppler({
    originalPdfBytes: input.originalPdfBytes,
    expectedSourceSha256: input.expectedSourceSha256,
    expectedPdfPageCount: input.expectedPdfPageCount,
    pageNumber: input.workerPage.pageNumber,
  });
  return compareCompleteWorkerWordsWithPoppler(input.workerPage, independent);
}
