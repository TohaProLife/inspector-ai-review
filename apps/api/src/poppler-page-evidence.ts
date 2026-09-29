import { execFile } from "node:child_process";
import { sha256 } from "./canonical-json.js";
import { parsePopplerPageWordsXml } from "./poppler-page-words.js";
import { pythonCanonicalJson, pythonHash } from "./trusted-page-words.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POPPLER_VERSION = "25.12.0";
const SCHEMA_VERSION = "poppler-page-evidence-v1";
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_PDF_PAGES = 10_000;
const MAX_SELECTED_PAGES = 4;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const MAX_WORDS_PER_PAGE = 5_000;
const SHA256 = /^[0-9a-f]{64}$/u;
let activeVerifications = 0;

type WorkerPage = {
  providerId: string;
  sourceSha256: string;
  pdfPageCount: number;
  pageNumber: number;
  pageWidthMilliPoints: number;
  pageHeightMilliPoints: number;
  xmlSha256: string;
  plainTextSha256: string;
  pageText: string;
  words: Array<{ wordIndex: number; rawText: string;
    bboxMilliPointsTopLeft: [number, number, number, number] }>;
  wordArtifactSha256: string;
  inspectionSha256: string;
};

type WorkerResult = {
  schemaVersion: string;
  purpose: string;
  sourceSha256: string;
  sourceByteSize: number;
  pdfPageCount: number;
  selectedPageNumbers: number[];
  pageEvidence: WorkerPage[];
  absenceConclusion: string;
  typedFacts: null;
  findings: null;
  parameterCoverage: null;
  contentHash: string;
};

export type VerifiedPopplerPageEvidence = {
  verified: true;
  providerId: `api-poppler-pdftotext-bbox-layout-v1@${string}`;
  sourceSha256: string;
  selectedPageNumbers: number[];
  pageWordCounts: number[];
  contentHash: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function run(program: "pdftotext" | "pdfinfo", args: string[], maxBuffer: number):
    Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(program, args, {
      encoding: "buffer", timeout: 15_000, maxBuffer,
      env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
    }, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Poppler ${program} unavailable or failed`, { cause: error })); return; }
      const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
      const err = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr);
      if (out.length > maxBuffer || err.length > 4096) {
        reject(new Error("Poppler output outside bounds")); return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

async function requireVersion(program: "pdftotext" | "pdfinfo"): Promise<void> {
  const { stdout, stderr } = await run(program, ["-v"], 4096);
  const lines = Buffer.concat([stdout, stderr]).toString("utf8").split(/\r?\n/u)
    .filter((line) => line.length > 0);
  if (lines[0] !== `${program} version ${POPPLER_VERSION}`
    || lines.slice(1).some((line) => !line.startsWith("Copyright "))) {
    throw new Error(`page evidence requires ${program} ${POPPLER_VERSION}`);
  }
}

function singleMatch(text: string, pattern: RegExp, label: string): string {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`ambiguous Poppler ${label}`);
  return matches[0][1];
}

function validateScope(input: {
  originalPdfBytes: Buffer;
  expectedSourceSha256: string;
  expectedSourceByteSize: number;
  expectedPdfPageCount: number;
  expectedSelectedPageNumbers: number[];
  workerResult: unknown;
}): asserts input is typeof input & { workerResult: WorkerResult } {
  const { originalPdfBytes, expectedSourceSha256, expectedSourceByteSize,
    expectedPdfPageCount, expectedSelectedPageNumbers, workerResult } = input;
  if (!Buffer.isBuffer(originalPdfBytes) || originalPdfBytes.length < 5
    || originalPdfBytes.length > MAX_PDF_BYTES
    || originalPdfBytes.toString("ascii", 0, 5) !== "%PDF-"
    || !SHA256.test(expectedSourceSha256)
    || !Number.isSafeInteger(expectedSourceByteSize)
    || expectedSourceByteSize !== originalPdfBytes.length
    || sha256(originalPdfBytes) !== expectedSourceSha256
    || !Number.isSafeInteger(expectedPdfPageCount) || expectedPdfPageCount < 1
    || expectedPdfPageCount > MAX_PDF_PAGES
    || !Array.isArray(expectedSelectedPageNumbers)
    || expectedSelectedPageNumbers.length < 1
    || expectedSelectedPageNumbers.length > MAX_SELECTED_PAGES
    || expectedSelectedPageNumbers.some((page, index) => !Number.isSafeInteger(page)
      || page < 1 || page > expectedPdfPageCount
      || index > 0 && page <= expectedSelectedPageNumbers[index - 1])
    || !record(workerResult)
    || workerResult.schemaVersion !== SCHEMA_VERSION
    || workerResult.purpose !== "REVIEW_ONLY"
    || workerResult.sourceSha256 !== expectedSourceSha256
    || workerResult.sourceByteSize !== expectedSourceByteSize
    || workerResult.pdfPageCount !== expectedPdfPageCount
    || !Array.isArray(workerResult.selectedPageNumbers)
    || pythonCanonicalJson(workerResult.selectedPageNumbers)
       !== pythonCanonicalJson(expectedSelectedPageNumbers)
    || !Array.isArray(workerResult.pageEvidence)
    || workerResult.pageEvidence.length !== expectedSelectedPageNumbers.length
    || workerResult.pageEvidence.some((page, index) => !record(page)
      || page.pageNumber !== expectedSelectedPageNumbers[index]
      || typeof page.pageText !== "string"
      || Buffer.byteLength(page.pageText) > MAX_XML_BYTES
      || !Array.isArray(page.words) || page.words.length < 1
      || page.words.length > MAX_WORDS_PER_PAGE
      || page.words.some((word) => !record(word)
        || typeof word.rawText !== "string"
        || Buffer.byteLength(word.rawText) > MAX_XML_BYTES))
    || workerResult.absenceConclusion !== "NOT_AVAILABLE"
    || workerResult.typedFacts !== null || workerResult.findings !== null
    || workerResult.parameterCoverage !== null
    || typeof workerResult.contentHash !== "string"
    || !SHA256.test(workerResult.contentHash)) {
    throw new Error("page evidence source, scope, or review-only result invalid");
  }
  if (Buffer.byteLength(pythonCanonicalJson(workerResult)) > MAX_RESULT_BYTES) {
    throw new Error("page evidence result exceeds bound");
  }
}

/**
 * Re-extracts every selected page from original PDF bytes owned by API. The
 * worker packet supplies no trusted PDF path, page list, word list, or count.
 * Caller authenticates dataset permission and source-review snapshot separately.
 */
export async function verifyPopplerPageEvidenceAgainstOriginalPdf(input: {
  originalPdfBytes: Buffer;
  expectedSourceSha256: string;
  expectedSourceByteSize: number;
  expectedPdfPageCount: number;
  expectedSelectedPageNumbers: number[];
  workerResult: unknown;
}): Promise<VerifiedPopplerPageEvidence> {
  validateScope(input);
  if (activeVerifications >= 2) throw new Error("page evidence verification concurrency limit");
  activeVerifications += 1;
  let directory: string | undefined;
  try {
    // Version gate runs before either tool parses caller-controlled PDF bytes.
    await requireVersion("pdftotext");
    await requireVersion("pdfinfo");
    directory = await mkdtemp(join(tmpdir(), "inspector-poppler-page-evidence-api-"));
    const verifiedPath = join(directory, "source.pdf");
    await writeFile(verifiedPath, input.originalPdfBytes, { flag: "wx", mode: 0o600 });
    const info = await run("pdfinfo", [verifiedPath], 128 * 1024);
    if (info.stderr.length) throw new Error("Poppler reported PDF warning");
    const infoText = info.stdout.toString("utf8");
    const pages = Number(singleMatch(infoText, /^Pages:\s*(\d+)\s*$/gm, "page count"));
    const encrypted = singleMatch(infoText,
      /^Encrypted:\s*(yes|no)(?:\s+.*)?$/gm, "PDF encryption");
    if (pages !== input.expectedPdfPageCount || encrypted !== "no") {
      throw new Error("Poppler page count or encryption mismatch");
    }

    const pageEvidence: WorkerPage[] = [];
    for (const pageNumber of input.expectedSelectedPageNumbers) {
      const range = ["-f", String(pageNumber), "-l", String(pageNumber)];
      const xml = await run("pdftotext", [...range, "-bbox-layout", "-enc", "UTF-8",
        verifiedPath, "-"], MAX_XML_BYTES);
      const plain = await run("pdftotext", [...range, "-raw", "-enc", "UTF-8",
        verifiedPath, "-"], MAX_XML_BYTES);
      if (xml.stderr.length || plain.stderr.length) {
        throw new Error("Poppler reported extraction warning");
      }
      const parsed = parsePopplerPageWordsXml(xml.stdout.toString("utf8"));
      if (parsed.words.length > MAX_WORDS_PER_PAGE) {
        throw new Error("Poppler page word count outside bounds");
      }
      const body = {
        providerId: `worker-poppler-pdftotext-bbox-layout-v1@${POPPLER_VERSION}`,
        sourceSha256: input.expectedSourceSha256,
        pdfPageCount: input.expectedPdfPageCount,
        pageNumber,
        pageWidthMilliPoints: parsed.pageWidthMilliPoints,
        pageHeightMilliPoints: parsed.pageHeightMilliPoints,
        xmlSha256: sha256(xml.stdout),
        plainTextSha256: sha256(plain.stdout),
        pageText: plain.stdout.toString("utf8"),
        words: parsed.words,
        wordArtifactSha256: pythonHash(parsed.words),
      };
      pageEvidence.push({ ...body, inspectionSha256: pythonHash(body) });
    }
    const resultBody = {
      schemaVersion: SCHEMA_VERSION, purpose: "REVIEW_ONLY",
      sourceSha256: input.expectedSourceSha256,
      sourceByteSize: input.expectedSourceByteSize,
      pdfPageCount: input.expectedPdfPageCount,
      selectedPageNumbers: input.expectedSelectedPageNumbers,
      pageEvidence,
      absenceConclusion: "NOT_AVAILABLE",
      typedFacts: null, findings: null, parameterCoverage: null,
    };
    const expected: WorkerResult = { ...resultBody, contentHash: pythonHash(resultBody) };
    if (pythonCanonicalJson(input.workerResult) !== pythonCanonicalJson(expected)) {
      throw new Error("page evidence differs from independent original PDF extraction");
    }
    return {
      verified: true, providerId: `api-poppler-pdftotext-bbox-layout-v1@${POPPLER_VERSION}`,
      sourceSha256: input.expectedSourceSha256,
      selectedPageNumbers: [...input.expectedSelectedPageNumbers],
      pageWordCounts: pageEvidence.map((page) => page.words.length),
      contentHash: expected.contentHash,
    };
  } finally {
    activeVerifications -= 1;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
