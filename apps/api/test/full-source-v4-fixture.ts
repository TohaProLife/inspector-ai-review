/** Hand-authored native geometry and per-page quote, independent of extractor output. */
export function fullSourceV4Artifact(profile: any, profileHash: string, count = 676): any {
  return {
    schemaVersion: "document-text-v4", sourceFileId: "SYNTHETIC-FULL-676", inputSha256: "a".repeat(64),
    coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: count, locatedTextPageCount: count,
    unlocatedTextPageCount: 0, extractorProfile: structuredClone(profile), extractorProfileHash: profileHash,
    qualitySummary: { candidatePages: count, partialPages: 0, ocrRequiredPages: 0 },
    pages: Array.from({ length: count }, (_, index) => ({
      pageNumber: index + 1, widthMilliPoints: 240000, heightMilliPoints: 160000,
      nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "240", "160"] },
      locatedLines: [{ sourcePath: [0], rawText: `FULLSOURCE PAGE ${index + 1}\n`,
        nativeBoxPointStrings: ["20", "120", "130", "130"], bboxMilliPoints: [20000, 120000, 130000, 130000] }],
      unlocatedLines: [], quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
        locatedLineCount: 1, unlocatedLineCount: 0, locatedNonWhitespaceCharacters: 14 + String(index + 1).length,
        unlocatedNonWhitespaceCharacters: 0, replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0,
      } },
    })),
  };
}
