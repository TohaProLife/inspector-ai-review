// Frozen rule definitions for the bounded PZ-002 release. Python receives these
// from the immutable release manifest, never from the evaluation dataset.
export const pilotPz002Rules = {
  navigation: {
    ruleId: "pilot-pz-002-navigation",
    version: "1",
    parameterCode: "PZ-002",
    requiredStages: ["PD", "RD"],
    sectionCodes: ["PZ"],
    subjectTerms: ["общая площадь здания"],
    locationTerms: [],
    visualFactRequired: false,
  },
  numeric: {
    schemaVersion: "typed-numeric-rule-v1",
    ruleId: "pilot-pz-002-area",
    version: "1",
    parameterCode: "PZ-002",
    expectedStage: "PD",
    actualStage: "RD",
    canonicalUnit: "m2",
    comparator: { family: "RELATIVE_DELTA", threshold: "0.01", operator: ">" },
  },
} as const;

// PZ-017 remains a bounded, non-finding extraction. Its values can only become
// a result after the API checks the saved text artifact and original geometry.
export const pilotPz002Pz017Rules = {
  ...pilotPz002Rules,
  heat: {
    ruleId: "pilot-pz-017-heat",
    version: "1",
    parameterCode: "PZ-017",
    extractionProfile: "pz-017-heat-components-v1",
  },
} as const;

// OCR v3 thermal rows are a separate review aid. This release deliberately
// retains the same PZ-017 fact rule; OCR rows cannot change its evaluation.
export const pilotPz002Pz017OcrHeatRules = {
  ...pilotPz002Pz017Rules,
  ocrHeatRows: {
    ruleId: "pilot-pz-017-ocr-heat-review",
    version: "1",
    parameterCode: "PZ-017",
    extractionProfile: "conservative-ocr-heat-rows-v1",
    disposition: "REVIEW_AID_ONLY",
  },
} as const;

// Review-only fact extraction over the five catalog-bound pilot rules. The
// pack hash pins the Python policy without claiming complete parameter coverage.
export const pilotFactFamilyPackHash = "7b91a75c3af9cd9082af95d2477e2165071fec256ef55b14a41996dc6b054690";
export const pilotFactFamilyRules = [
  { schemaVersion: "fact-comparison-rule-v1", ruleId: "pilot-pz-004-building-volume", version: "1",
    parameterCode: "PZ-004", attribute: "BUILDING_VOLUME", expectedStage: "PD", actualStage: "RD",
    canonicalUnit: "m3", comparator: { family: "DIFFERENT", operator: "!=", threshold: "0" },
    requiredContext: ["APPROVED_CHANGE_STATUS", "EXTERNAL_VOLUME_GEOMETRY"],
    requiredActualSection: ["AR", "KR"] },
  { schemaVersion: "fact-comparison-rule-v1", ruleId: "pilot-pz-007-floor-count", version: "1",
    parameterCode: "PZ-007", attribute: "ABOVE_GROUND_FLOOR_COUNT", expectedStage: "PD", actualStage: "RD",
    canonicalUnit: "count", comparator: { family: "DIFFERENT", operator: "!=", threshold: "0" },
    requiredContext: ["FLOOR_COUNT_CONVENTION", "BUILDING_SCOPE"], requiredActualSection: ["AR"] },
  { schemaVersion: "fact-comparison-rule-v1", ruleId: "pilot-kr-055-concrete-class", version: "1",
    parameterCode: "KR-055", attribute: "CONCRETE_CLASS", expectedStage: "PD", actualStage: "RD",
    canonicalUnit: "B_CLASS", comparator: { family: "CLASS_DECREASE", operator: ">", threshold: "0" },
    requiredContext: ["ELEMENT_IDENTITY", "MATERIAL_CLASS_BASIS"], requiredActualSection: ["KR"] },
  { schemaVersion: "fact-comparison-rule-v1", ruleId: "pilot-kr-058-foundation-thickness", version: "1",
    parameterCode: "KR-058", attribute: "FOUNDATION_THICKNESS", expectedStage: "PD", actualStage: "RD",
    canonicalUnit: "mm", comparator: { family: "DECREASE", operator: ">", threshold: "0" },
    requiredContext: ["FOUNDATION_ZONE_IDENTITY", "THICKNESS_MEASUREMENT_BASIS"],
    requiredActualSection: ["KR"] },
  { schemaVersion: "fact-comparison-rule-v1", ruleId: "pilot-kr-059-slab-thickness", version: "1",
    parameterCode: "KR-059", attribute: "SLAB_THICKNESS", expectedStage: "PD", actualStage: "RD",
    canonicalUnit: "mm", comparator: { family: "DECREASE", operator: ">", threshold: "0" },
    requiredContext: ["SLAB_FLOOR_ZONE_IDENTITY", "THICKNESS_MEASUREMENT_BASIS"],
    requiredActualSection: ["KR"] },
] as const;
export const pilotPz002Pz017OcrHeatFactFamilyRules = {
  ...pilotPz002Pz017OcrHeatRules,
  factFamily: {
    ruleId: "pilot-fact-family-review",
    version: "1",
    extractionProfile: "fact-family-pilot-v1",
    packSha256: pilotFactFamilyPackHash,
    disposition: "REVIEW_AID_ONLY",
    rules: pilotFactFamilyRules,
  },
} as const;

// Separate opt-in run diagnostic. These hashes pin the worker's catalog-bound
// candidate and lexical label policies; no candidate becomes an executable rule.
export const candidateFamilyPreviewPolicy = {
  ruleId: "pilot-candidate-family-preview", version: "1",
  extractionProfile: "candidate-family-preview-v1",
  candidateRulePackSha256: "a3ad00a04865f04bfeef5c2f21f5a11054fec88dcab264590fdb66d70a968581",
  numericLabelPackSha256: "d270b569f73228df0ede228cf86bd89a6bc703eca23c6e2ea885e05969aac769",
  classLabelPackSha256: "1a4627bc40a5e2a625956448bca95ac72334b20aef501bbf6461a113d567230e",
  presenceLabelPackSha256: "0bf932092db14b4669748599172b80f5db36bb5670b15180cfa4e310446164ed",
  codeCount: 47, disposition: "REVIEW_AID_ONLY",
} as const;

export const pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules = {
  ...pilotPz002Pz017OcrHeatFactFamilyRules,
  candidateFamilyPreview: candidateFamilyPreviewPolicy,
} as const;

export const candidateFamilyObservationsPolicy = {
  ruleId: "pilot-candidate-family-observations", version: "1",
  extractionProfile: "candidate-family-observations-v1",
  candidateRulePackSha256: candidateFamilyPreviewPolicy.candidateRulePackSha256,
  numericLabelPackSha256: candidateFamilyPreviewPolicy.numericLabelPackSha256,
  classLabelPackSha256: candidateFamilyPreviewPolicy.classLabelPackSha256,
  presenceLabelPackSha256: candidateFamilyPreviewPolicy.presenceLabelPackSha256,
  codeCount: 47, disposition: "REVIEW_AID_ONLY",
} as const;

export const pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules,
  candidateFamilyObservations: candidateFamilyObservationsPolicy,
} as const;

// OCR-derived leads remain a separate review aid. Their own profile requires
// committed OCR output and cannot upgrade text observations to typed facts.
export const candidateFamilyOcrObservationsPolicy = {
  ruleId: "pilot-candidate-family-ocr-observations", version: "1",
  extractionProfile: "candidate-family-ocr-observations-v1",
  candidateRulePackSha256: candidateFamilyPreviewPolicy.candidateRulePackSha256,
  numericLabelPackSha256: candidateFamilyPreviewPolicy.numericLabelPackSha256,
  classLabelPackSha256: candidateFamilyPreviewPolicy.classLabelPackSha256,
  presenceLabelPackSha256: candidateFamilyPreviewPolicy.presenceLabelPackSha256,
  codeCount: 47, disposition: "REVIEW_AID_ONLY",
} as const;

export const pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules,
  candidateFamilyOcrObservations: candidateFamilyOcrObservationsPolicy,
} as const;

// Page-local OCR label/value geometry for source review only. No parameter code
// or typed fact can be inferred from these uncoded rows.
export const pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules,
  ocrTableRows: {
    ruleId: "pilot-ocr-table-rows-review",
    version: "1",
    extractionProfile: "conservative-ocr-table-rows-v1",
    disposition: "REVIEW_AID_ONLY",
  },
} as const;

// Opt-in v2 keeps OCR table rows separate from typed facts. Existing v1
// release definitions remain frozen for runs that already pin their hash.
export const pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2 = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules,
  ocrTableRows: {
    ruleId: "pilot-ocr-table-rows-review",
    version: "2",
    extractionProfile: "conservative-ocr-table-rows-v2",
    disposition: "REVIEW_AID_ONLY",
  },
} as const;

// Opt-in v3 preserves the older immutable releases and binds row-label
// continuations to their own OCR evidence for human review.
export const pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3 = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules,
  ocrTableRows: {
    ruleId: "pilot-ocr-table-rows-review",
    version: "3",
    extractionProfile: "conservative-ocr-table-rows-v3",
    disposition: "REVIEW_AID_ONLY",
  },
} as const;

// Additional lexical review for three unresolved catalog codes. It never
// supplies a typed fact, comparison, finding, or parameter coverage.
export const unresolvedFamilyRunReviewPolicy = {
  ruleId: "pilot-unresolved-family-text-review",
  version: "1",
  extractionProfile: "unresolved-family-text-review-v1",
  codeCount: 3,
  disposition: "REVIEW_AID_ONLY",
} as const;

export const pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableUnresolvedRulesV1 = {
  ...pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3,
  unresolvedFamilyReview: unresolvedFamilyRunReviewPolicy,
} as const;
