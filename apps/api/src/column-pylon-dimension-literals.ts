import type { ColumnPylonDimensionLiteral, ColumnPylonDimensionLiteralsResult, ColumnPylonLiteralToken, DocumentTextV3Artifact } from "@inspector-ai/contracts";
import { readDocumentTextV3LargeArtifact } from "./document-text-v3.js";

const BASE = { schemaVersion: "column-pylon-dimension-literals-v1", resourcePolicyVersion: "document-text-v3-large-source-bounds-v1" } as const;
const language = /^(Колонна|Пилон) ([1-9][0-9]{0,8})х([1-9][0-9]{0,8})(мм) ([+-]?(?:0|[1-9][0-9]{0,3})) этаж \[([^\[\]\x00-\x1f\x7f-\x9f\u2028\u2029\ufffd]{1,200})\]$(?![\s\S])/u;
const whitespace = new Set([9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);

/** Complete-source literal extraction only; no physical or structural authority. */
export function extractColumnPylonDimensionLiterals(value: unknown): ColumnPylonDimensionLiteralsResult {
  const read = readDocumentTextV3LargeArtifact(value);
  if (read.status !== "VALID") return { ...BASE, status: "ABSTAIN", reasonCode: read.reasonCode };
  const artifact = value as DocumentTextV3Artifact;
  const literals: ColumnPylonDimensionLiteral[] = [];
  const excludedPages: { pageNumber: number; reasonCode: "PAGE_NOT_CANDIDATE" | "UNLOCATED_RECORDS" }[] = [];
  for (const page of artifact.pages) {
    if (page.unlocatedLines.length || page.quality.disposition !== "TEXT_LAYER_CANDIDATE") {
      excludedPages.push({ pageNumber: page.pageNumber, reasonCode: page.unlocatedLines.length ? "UNLOCATED_RECORDS" : "PAGE_NOT_CANDIDATE" });
      continue;
    }
    for (const line of page.locatedLines) {
      const chars = Array.from(line.rawText);
      if (chars.length > 8192) continue;
      let left = 0, end = chars.length;
      if (chars[end - 1] === "\n") end--;
      while (left < end && chars[left] === " ") left++;
      while (end > left && chars[end - 1] === " ") end--;
      const match = language.exec(chars.slice(left, end).join(""));
      if (!match) continue;
      const [, kindRaw, firstRaw, secondRaw, unitRaw, levelRaw, scopeRaw] = match;
      if (scopeRaw.startsWith(" ") || scopeRaw.endsWith(" ") || !Array.from(scopeRaw).some(c => !whitespace.has(c.codePointAt(0)!))) continue;
      let cursor = left;
      const token = (raw: string): ColumnPylonLiteralToken => {
        const start = cursor;
        cursor += Array.from(raw).length;
        return { raw, rangeCodePoints: [start, cursor] };
      };
      const kind = token(kindRaw); cursor++;
      const first = token(firstRaw); cursor++;
      const second = token(secondRaw);
      const unit = token(unitRaw); cursor++;
      const level = token(levelRaw); cursor += 7;
      const scope = token(scopeRaw);
      literals.push({
        pageNumber: page.pageNumber, sourcePath: [...line.sourcePath], rawText: line.rawText,
        nativeBoxPointStrings: [...line.nativeBoxPointStrings], bboxMilliPoints: [...line.bboxMilliPoints],
        pageFrame: { widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
          nativeFrame: { coordinateSystem: page.nativeFrame.coordinateSystem, visibleBoxPointStrings: [...page.nativeFrame.visibleBoxPointStrings] } },
        usedTextRangeCodePoints: [left, end], tokens: { kind, first, second, unit, level, scope },
        sourceOnly: true, calibratedProbability: null,
        rectangleStatus: "UNVERIFIED", grossSectionStatus: "UNVERIFIED", physicalMemberStatus: "UNVERIFIED",
        applicabilityStatus: "UNVERIFIED", renderedVisibilityStatus: "UNVERIFIED",
      });
      if (literals.length > 128) return { ...BASE, status: "ABSTAIN", reasonCode: "INPUT_LIMIT" };
    }
  }
  return {
    ...BASE, status: "SOURCE_LITERALS", sourceFileId: artifact.sourceFileId, inputSha256: artifact.inputSha256,
    sourceArtifactContentHash: read.contentHash, extractorProfile: { ...artifact.extractorProfile },
    extractorProfileHash: artifact.extractorProfileHash, literals, excludedPages,
  };
}
