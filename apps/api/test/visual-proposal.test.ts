import { describe, expect, it } from "vitest";
import {
  legacyVisualProposalConfigHash,
  legacyVisualProposalProfile,
  legacyVisualProposalProfileId,
  selectedVisualPages,
  validateVisualProposalStageResult,
  v2VisualProposalConfigHash,
  v2VisualProposalProfile,
  v2VisualProposalProfileId,
  v3VisualProposalConfigHash,
  v3VisualProposalProfile,
  v3VisualProposalProfileId,
  v5VisualProposalConfigHash,
  v5VisualProposalProfile,
  v5VisualProposalProfileId,
  v6VisualProposalConfigHash,
  v6VisualProposalProfile,
  v6VisualProposalProfileId,
  selectedVisualVlmOrdinals,
  visualProposalConfigHash,
  visualProposalProfile,
  visualProposalProfileId,
} from "../src/visual-proposal.js";

const hash = "a".repeat(64);
const sourceHash = "b".repeat(64);
const objectId = "object-visual-test";

function result() {
  return {
    schemaVersion: "analysis-stage-result-v2",
    jobType: "ENTITY_EXTRACTION",
    inputManifestHash: hash,
    disposition: "VISUAL_PROPOSAL_SCAN",
    reasonCode: "PROPOSAL_ONLY_UNVERIFIED",
    providerKind: "ENTITY_EXTRACTION_MODEL",
    providerProfileId: visualProposalProfileId,
    providerConfigHash: visualProposalConfigHash,
    outputCount: 1,
    analysis: {
      schemaVersion: "visual-proposal-analysis-v4",
      objectId,
      inputManifestHash: hash,
      profile: visualProposalProfile,
      sources: [{
        sourceFileId: "FILE-1",
        sourceSha256: sourceHash,
        pageCount: 36,
        scannedPageCount: 36,
        scannedPageNumbers: selectedVisualPages(36),
        skippedPageCount: 0,
        documentContext: {
          schemaVersion: "document-context-v1",
          methodId: "first-two-pdf-cover-text-pages-v1",
          status: "VENTILATION",
          reasonCode: "TITLE_KEYWORD_MATCH",
          inspectedPages: [
            { pageNumber: 1, textSha256: "c".repeat(64), titleWindow: "РАБОЧАЯ ДОКУМЕНТАЦИЯ\nСистема вентиляции" },
            { pageNumber: 2, textSha256: "d".repeat(64), titleWindow: null },
          ],
        },
        status: "SCANNED",
        proposals: [{
          pageNumber: 17,
          bboxNormalized: [0.1, 0.2, 0.3, 0.4],
          status: "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED",
        }],
        proposalLimitReached: false,
        unretainedProposalCount: 0,
      }],
    },
  };
}

function v5Result(): any {
  const next: any = structuredClone(result());
  next.providerProfileId = v5VisualProposalProfileId;
  next.providerConfigHash = v5VisualProposalConfigHash;
  next.analysis.schemaVersion = "visual-proposal-analysis-v5";
  next.analysis.profile = v5VisualProposalProfile;
  next.analysis.sources[0].vlm = {
    schemaVersion: "visual-vlm-observations-v1", methodId: "spread-two-saved-proposals-v1",
    eligibleProposalCount: 1, selectedOrdinals: [0], omittedProposalCount: 0,
    observations: [{
      proposalOrdinal: 0, sourceSha256: sourceHash, pageNumber: 17,
      bboxNormalized: [0.1, 0.2, 0.3, 0.4], cropSha256: "e".repeat(64),
      modelId: v5VisualProposalProfile.vlmModelId,
      modelWeightsSha256: v5VisualProposalProfile.vlmModelWeightsSha256,
      modelProjectorSha256: v5VisualProposalProfile.vlmModelProjectorSha256,
      promptSha256: v5VisualProposalProfile.vlmPromptSha256,
      decision: "RADIATOR_HINT", reasonCode: "MODEL_RESPONSE",
      responseSha256: "f".repeat(64),
    }],
  };
  return next;
}

function v6Result(): any {
  const next = v5Result();
  next.providerProfileId = v6VisualProposalProfileId;
  next.providerConfigHash = v6VisualProposalConfigHash;
  next.analysis.schemaVersion = "visual-proposal-analysis-v6";
  next.analysis.profile = v6VisualProposalProfile;
  next.analysis.sources[0].vlm.methodId = v6VisualProposalProfile.vlmMethodId;
  const observation = next.analysis.sources[0].vlm.observations[0];
  observation.modelId = v6VisualProposalProfile.vlmModelId;
  observation.modelRevision = v6VisualProposalProfile.vlmModelRevision;
  observation.modelLockSha256 = v6VisualProposalProfile.vlmModelLockSha256;
  delete observation.modelWeightsSha256;
  delete observation.modelProjectorSha256;
  return next;
}

const expected = [{ apiId: "FILE-1", sha256: sourceHash, pageCount: 36 }];

describe("visual proposal stage validation", () => {
  it("pins immutable profile hashes", () => {
    expect(legacyVisualProposalConfigHash).toBe("743ed8a34a0a740afa838277f6147d0f28a81e17fea1a856ac91b8d67ec4d01c");
    expect(v2VisualProposalConfigHash).toBe("d957b90597b415b5ec894816f65304e8a679687099c83c43e09240fec914bb52");
    expect(v3VisualProposalConfigHash).toBe("4e9bee5f3ffe6683ced20e9838e76a664ff159857d58f107b54fa501bab4e67a");
    expect(visualProposalConfigHash).toBe("9384e39c72eaf7cd2d1664a7b4855152240311b64ff3fd301625e7f3c57757be");
    expect(v5VisualProposalConfigHash).toBe("d526877fc14eac48a61026f9e9c5394017e25b84d519bacc661af78e2fd89f78");
    expect(v6VisualProposalConfigHash).toBe("0df298161c7ffc7b2b24e72b875db6a9c60805fac31216c04884ef11ac5fef04");
  });
  it("selects every page through 1024 and exactly 1024 distinct pages above limit", () => {
    for (const pageCount of [64, 65, 614, 676, 1024]) {
      const pages = selectedVisualPages(pageCount);
      expect(pages).toEqual(Array.from({ length: pageCount }, (_, index) => index + 1));
    }
    for (const pageCount of [1025, 10_000]) {
      const pages = selectedVisualPages(pageCount);
      expect(pages).toHaveLength(1024);
      expect(new Set(pages).size).toBe(1024);
      expect(pages[0]).toBe(1);
      expect(pages.at(-1)).toBe(pageCount);
      expect(pages.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(pages.slice(-8)).toEqual(Array.from({ length: 8 }, (_, index) => pageCount - 7 + index));
      expect(pages).toEqual([...pages].sort((left, right) => left - right));
    }
    expect(selectedVisualPages(614, 64)).toHaveLength(64);
  });
  it("persists only a bounded proposal artifact", () => {
    const validated = validateVisualProposalStageResult(result(), hash, objectId, expected);
    expect(validated?.outputCount).toBe(1);
    expect(validated?.storedResult.disposition).toBe("VISUAL_PROPOSAL_SCAN");
    expect(validated?.storedResult).not.toHaveProperty("finding");
    expect(validated?.storedResult).not.toHaveProperty("coverage");
  });

  it("validates v5 hints separately from geometry and verdict", () => {
    const valid = v5Result();
    const checked = validateVisualProposalStageResult(valid, hash, objectId, expected, v5VisualProposalProfileId);
    expect(checked?.outputCount).toBe(1);
    expect(checked?.storedResult).not.toHaveProperty("finding");
    expect(checked?.storedResult).not.toHaveProperty("coverage");
    expect(selectedVisualVlmOrdinals(20)).toEqual([5, 15]);
    const forged = v5Result();
    forged.analysis.sources[0].vlm.observations[0].bboxNormalized = [0.2, 0.2, 0.3, 0.4];
    expect(validateVisualProposalStageResult(forged, hash, objectId, expected, v5VisualProposalProfileId)).toBeUndefined();
    forged.analysis.sources[0].vlm.observations[0].bboxNormalized = [0.1, 0.2, 0.3, 0.4];
    forged.analysis.sources[0].vlm.observations[0].decision = "RADIATOR_HINT";
    forged.analysis.sources[0].vlm.observations[0].reasonCode = "MODEL_TIMEOUT";
    expect(validateVisualProposalStageResult(forged, hash, objectId, expected, v5VisualProposalProfileId)).toBeUndefined();
    const omitted = v5Result();
    omitted.analysis.sources[0].vlm.omittedProposalCount = 1;
    expect(validateVisualProposalStageResult(omitted, hash, objectId, expected, v5VisualProposalProfileId)).toBeUndefined();
    const abstained = v5Result();
    abstained.analysis.sources[0].vlm.observations[0].decision = "ABSTAIN";
    abstained.analysis.sources[0].vlm.observations[0].reasonCode = "MODEL_ABSTAIN";
    expect(validateVisualProposalStageResult(abstained, hash, objectId, expected, v5VisualProposalProfileId)).toBeDefined();
  });

  it("validates distinct v6 H100 lock and keeps OTHER as abstention", () => {
    const valid = v6Result();
    expect(validateVisualProposalStageResult(valid, hash, objectId, expected, v6VisualProposalProfileId)).toBeDefined();
    expect(validateVisualProposalStageResult(valid, hash, objectId, expected, v5VisualProposalProfileId)).toBeUndefined();
    const other = v6Result();
    other.analysis.sources[0].vlm.observations[0].decision = "ABSTAIN";
    other.analysis.sources[0].vlm.observations[0].reasonCode = "MODEL_OTHER_UNTRUSTED";
    expect(validateVisualProposalStageResult(other, hash, objectId, expected, v6VisualProposalProfileId)).toBeDefined();
    other.analysis.sources[0].vlm.observations[0].decision = "OTHER_HINT";
    other.analysis.sources[0].vlm.observations[0].reasonCode = "MODEL_RESPONSE";
    expect(validateVisualProposalStageResult(other, hash, objectId, expected, v6VisualProposalProfileId)).toBeUndefined();
    const forged = v6Result();
    forged.analysis.sources[0].vlm.observations[0].modelLockSha256 = "0".repeat(64);
    expect(validateVisualProposalStageResult(forged, hash, objectId, expected, v6VisualProposalProfileId)).toBeUndefined();
    const projector = v6Result();
    projector.analysis.sources[0].vlm.observations[0].modelProjectorSha256 = "0".repeat(64);
    expect(validateVisualProposalStageResult(projector, hash, objectId, expected, v6VisualProposalProfileId)).toBeUndefined();
  });

  it("rejects source, page and semantic claims that are not in the contract", () => {
    const altered = result();
    altered.analysis.sources[0].sourceSha256 = "c".repeat(64);
    expect(validateVisualProposalStageResult(altered, hash, objectId, expected)).toBeUndefined();

    const outOfBounds = result();
    outOfBounds.analysis.sources[0].proposals[0].bboxNormalized = [0.1, 0.2, 1.1, 0.4];
    expect(validateVisualProposalStageResult(outOfBounds, hash, objectId, expected)).toBeUndefined();

    const classified = result() as Record<string, unknown>;
    (classified.analysis as Record<string, unknown>).deviceClass = "RADIATOR";
    expect(validateVisualProposalStageResult(classified, hash, objectId, expected)).toBeUndefined();
  });

  it("validates cover context without treating it as proposal class", () => {
    const match = result();
    expect(validateVisualProposalStageResult(match, hash, objectId, expected)).toBeDefined();
    const forged = result();
    forged.analysis.sources[0].documentContext.status = "HEATING";
    expect(validateVisualProposalStageResult(forged, hash, objectId, expected)).toBeUndefined();
    const noTitle = result();
    noTitle.analysis.sources[0].documentContext.inspectedPages[0].titleWindow = null;
    noTitle.analysis.sources[0].documentContext.status = "UNKNOWN";
    noTitle.analysis.sources[0].documentContext.reasonCode = "NO_TITLE_KEYWORD_MATCH";
    expect(validateVisualProposalStageResult(noTitle, hash, objectId, expected)).toBeDefined();
    const conflicted = result();
    conflicted.analysis.sources[0].documentContext.inspectedPages[0].titleWindow = "РАБОЧАЯ ДОКУМЕНТАЦИЯ\nОтопление и вентиляция";
    conflicted.analysis.sources[0].documentContext.status = "UNKNOWN";
    conflicted.analysis.sources[0].documentContext.reasonCode = "TITLE_CONFLICT";
    expect(validateVisualProposalStageResult(conflicted, hash, objectId, expected)).toBeDefined();
  });

  it("requires exact deterministic partial page scope and proposal provenance", () => {
    const partial = result();
    partial.outputCount = 0;
    partial.analysis.sources[0] = {
      ...partial.analysis.sources[0],
      pageCount: 1025, scannedPageCount: 1024,
      scannedPageNumbers: selectedVisualPages(1025), skippedPageCount: 1,
      status: "PARTIALLY_SCANNED_PAGE_LIMIT", proposals: [],
    };
    expect(validateVisualProposalStageResult(partial, hash, objectId, [
      { ...expected[0], pageCount: 1025 },
    ])).toBeDefined();
    partial.analysis.sources[0].scannedPageNumbers[20] += 1;
    expect(validateVisualProposalStageResult(partial, hash, objectId, [
      { ...expected[0], pageCount: 1025 },
    ])).toBeUndefined();
  });

  it("validates full 614 and 676 page scope and rejects fabricated omissions", () => {
    for (const pageCount of [614, 676]) {
      const full = result();
      full.analysis.sources[0].pageCount = pageCount;
      full.analysis.sources[0].scannedPageCount = pageCount;
      full.analysis.sources[0].scannedPageNumbers = selectedVisualPages(pageCount);
      full.analysis.sources[0].proposals[0].pageNumber = pageCount;
      const source = [{ ...expected[0], pageCount }];
      expect(validateVisualProposalStageResult(full, hash, objectId, source)).toBeDefined();
      full.analysis.sources[0].scannedPageNumbers.splice(30, 1);
      expect(validateVisualProposalStageResult(full, hash, objectId, source)).toBeUndefined();
    }
  });

  it("rejects proposals on pages outside sampled scope and inconsistent counts", () => {
    const source = [{ ...expected[0], pageCount: 1025 }];
    const partial = result();
    partial.analysis.sources[0].pageCount = 1025;
    partial.analysis.sources[0].scannedPageCount = 1024;
    partial.analysis.sources[0].scannedPageNumbers = selectedVisualPages(1025);
    partial.analysis.sources[0].skippedPageCount = 1;
    partial.analysis.sources[0].status = "PARTIALLY_SCANNED_PAGE_LIMIT";
    const omittedPage = Array.from({ length: 1025 }, (_, index) => index + 1)
      .find((page) => !partial.analysis.sources[0].scannedPageNumbers.includes(page));
    expect(omittedPage).toBeDefined();
    partial.analysis.sources[0].proposals[0].pageNumber = omittedPage!;
    expect(validateVisualProposalStageResult(partial, hash, objectId, source)).toBeUndefined();
    partial.analysis.sources[0].proposals[0].pageNumber = 1;
    expect(validateVisualProposalStageResult(partial, hash, objectId, source)).toBeDefined();
    partial.analysis.sources[0].skippedPageCount = 0;
    expect(validateVisualProposalStageResult(partial, hash, objectId, source)).toBeUndefined();
    partial.analysis.sources[0].skippedPageCount = 1;
    partial.outputCount = 0;
    expect(validateVisualProposalStageResult(partial, hash, objectId, source)).toBeUndefined();
  });

  it("keeps v2 immutable release and validation contract", () => {
    const old: any = result();
    old.providerProfileId = v2VisualProposalProfileId;
    old.providerConfigHash = v2VisualProposalConfigHash;
    old.analysis.schemaVersion = "visual-proposal-analysis-v2";
    old.analysis.profile = v2VisualProposalProfile;
    delete old.analysis.sources[0].documentContext;
    old.analysis.sources[0].pageCount = 100;
    old.analysis.sources[0].scannedPageCount = 64;
    old.analysis.sources[0].scannedPageNumbers = selectedVisualPages(100, 64);
    old.analysis.sources[0].skippedPageCount = 36;
    old.analysis.sources[0].status = "PARTIALLY_SCANNED_PAGE_LIMIT";
    old.analysis.sources[0].proposals[0].pageNumber = 1;
    expect(validateVisualProposalStageResult(old, hash, objectId,
      [{ ...expected[0], pageCount: 100 }], v2VisualProposalProfileId)).toBeDefined();
    expect(validateVisualProposalStageResult(old, hash, objectId,
      [{ ...expected[0], pageCount: 100 }])).toBeUndefined();
  });

  it("keeps immutable v3 results readable", () => {
    const old: any = result();
    old.providerProfileId = v3VisualProposalProfileId;
    old.providerConfigHash = v3VisualProposalConfigHash;
    old.analysis.schemaVersion = "visual-proposal-analysis-v3";
    old.analysis.profile = v3VisualProposalProfile;
    delete old.analysis.sources[0].documentContext;
    expect(validateVisualProposalStageResult(old, hash, objectId, expected, v3VisualProposalProfileId)).toBeDefined();
    expect(validateVisualProposalStageResult(old, hash, objectId, expected)).toBeUndefined();
  });

  it("still validates immutable v1 results from earlier runs", () => {
    const old = result();
    const legacy = {
      ...old,
      providerProfileId: legacyVisualProposalProfileId,
      providerConfigHash: legacyVisualProposalConfigHash,
      analysis: {
        ...old.analysis,
        schemaVersion: "visual-proposal-analysis-v1",
        profile: legacyVisualProposalProfile,
        sources: [{
          sourceFileId: "FILE-1", sourceSha256: sourceHash,
          pageCount: 36, scannedPageCount: 36, status: "SCANNED",
          proposals: old.analysis.sources[0].proposals,
          proposalLimitReached: false, unretainedProposalCount: 0,
        }],
      },
    };
    expect(validateVisualProposalStageResult(legacy, hash, objectId, expected, legacyVisualProposalProfileId)).toBeDefined();
    expect(validateVisualProposalStageResult(legacy, hash, objectId, expected)).toBeUndefined();
  });
});
