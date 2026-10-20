import { matrixFactScopeSchema, matrixFactScopeTargetSchema, matrixSourceScopeSchema, sourceReviewSchema,
  type MatrixObservation, type MatrixFactScopeTarget, type SourceReviewDecision,
  type SourceFileSummary, type MatrixProjectZeroAuthority } from "@inspector-ai/contracts";
import { matrixFactScopeRules } from "./MatrixFactScopeEditor";

export interface MatrixFactReviewPreflightInput {
  objectId: string;
  /** Immutable saved-run identity/reason; never replaced by latest decisions. */
  savedRun: {
    checkId: string;
    executionContentHash: string;
    reasonCode: string | null;
  };
  fact: MatrixObservation;
  /** Authenticated address returned for savedRun, not an observation-only ID. */
  target: MatrixFactScopeTarget;
  fragmentsHash?: string;
  /** Actual editor selection. No fallback to preference or first rule here.
   * Rule definition is resolved by matrixFactScopeRules(fact), not caller DTO. */
  selectedRuleId: string | null;
  /** Successfully loaded saved decision only. NEVER the dirty editor scope. */
  latestDecision: SourceReviewDecision | null;
  /** Existing current-file association; exact ID AND SHA required for action. */
  currentFile: Pick<SourceFileSummary, "id" | "sha256"> | null;
}

export type MatrixFactReviewInvalidReason =
  | "INVALID_TARGET"
  | "RULE_NOT_SELECTED_OR_UNAVAILABLE"
  | "SOURCE_REVIEW_IDENTITY_MISMATCH"
  | "INVALID_STORED_SCOPE";
export type MatrixFactReviewBindingStatus =
  | "NOT_RECORDED"
  | "MATCHED_CURRENT_TARGET"
  | "MATCHED_BY_OBSERVATION_EVIDENCE_AND_TEXT_HASH"
  | "EVIDENCE_MISMATCH_NOT_APPLIED";
export type MatrixFactReviewTableStatus =
  | "NOT_APPLICABLE_TO_SELECTED_FACT"
  | "NOT_RECORDED"
  | "TARGET_HASH_UNAVAILABLE"
  | "HASH_MISMATCH"
  | "HASH_MATCH_RECORDED";
export type MatrixFactReviewAuthorityStatus =
  | "NOT_REQUIRED_BY_SELECTED_RULE"
  | "NOT_RECORDED"
  | "GENERIC_REFERENCE_WITHOUT_TYPED_AUTHORITY"
  | "TYPED_POINTER_RECORDED";

export interface MatrixFactReviewPreflight {
  /** RECORDED_STATE is a description, not a validation/qualification outcome. */
  status: "RECORDED_STATE" | "INVALID_INPUT";
  invalidReason: MatrixFactReviewInvalidReason | null;
  objectId: string;
  sourceFileId: string;
  sourceSha256: string;
  rule: { ruleId: string; version: string; parameterCode: string } | null;
  savedRun: MatrixFactReviewPreflightInput["savedRun"];
  latestReviewContentHash: string | null;
  sourceRevision: SourceReviewDecision["revisionStatus"];
  sourceApproval: SourceReviewDecision["approvalStatus"];
  sourceSection: SourceReviewDecision["sectionCode"] | null;
  allowedSectionsForSelectedStage: string[];
  rowSectionOverride: {
    drawingSection: string;
    status: "RECORDED_NOT_SEMANTICALLY_VERIFIED";
  } | null;
  linkGroup: { status: "NOT_RECORDED" | "RECORDED_SELECTED_SOURCE_ONLY"; value: string | null };
  legacyWarning: boolean;
  binding: {
    status: MatrixFactReviewBindingStatus;
    /** Historical origin is displayed. A different check/hash alone is NOT stale. */
    origin: MatrixFactScopeTarget | null;
    entityKey: string | null;
  };
  /** Same order as exact selected rule.requiredContext. Presence is not truth. */
  requiredContexts: Array<{ key: string; status: "RECORDED" | "MISSING" }>;
  semanticContextStatus: "NOT_CHECKED";
  tableContext: { status: MatrixFactReviewTableStatus };
  authority: {
    status: MatrixFactReviewAuthorityStatus;
    /** Stored typed pointer only. Current PD authority/pair NOT revalidated. */
    pointer: MatrixProjectZeroAuthority | null;
  };
  counterpart: "NOT_CHECKED";
  /** No SHA-only remapping. Null on invalid review/source/target association. */
  sourceNavigation: { id: string; sha256: string } | null;
}
const sha = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/u.test(value);

/** Selected saved fields only. This intentionally does not implement comparison
 * eligibility, context semantics, pairing, current authority or completeness. */
export function buildMatrixFactReviewPreflight(input: MatrixFactReviewPreflightInput): MatrixFactReviewPreflight {
  const { fact, target, latestDecision: decision, currentFile } = input;
  const value: MatrixFactReviewPreflight = {
    status: "RECORDED_STATE", invalidReason: null,
    objectId: input.objectId, sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
    rule: null, savedRun: { ...input.savedRun }, latestReviewContentHash: null,
    sourceRevision: "UNKNOWN", sourceApproval: "UNKNOWN", sourceSection: null,
    allowedSectionsForSelectedStage: [], rowSectionOverride: null,
    linkGroup: { status: "NOT_RECORDED", value: null }, legacyWarning: false,
    binding: { status: "NOT_RECORDED", origin: null, entityKey: null }, requiredContexts: [],
    semanticContextStatus: "NOT_CHECKED", tableContext: { status: "NOT_APPLICABLE_TO_SELECTED_FACT" },
    authority: { status: "NOT_REQUIRED_BY_SELECTED_RULE", pointer: null },
    counterpart: "NOT_CHECKED", sourceNavigation: null,
  };
  const invalid = (reason: MatrixFactReviewInvalidReason): MatrixFactReviewPreflight => ({
    ...value, status: "INVALID_INPUT", invalidReason: reason, sourceNavigation: null,
  });
  if (!matrixFactScopeTargetSchema.safeParse(target).success || fact.method !== "TEXT_LAYER"
      || !sha(fact.id) || !sha(fact.sourceSha256) || !fact.sourceFileId || !input.objectId
      || target.observationId !== fact.id || target.checkId !== input.savedRun.checkId
      || target.executionContentHash !== input.savedRun.executionContentHash
      || (input.fragmentsHash !== undefined && !sha(input.fragmentsHash))) return invalid("INVALID_TARGET");
  const rules = matrixFactScopeRules(fact).filter(rule => rule.ruleId === input.selectedRuleId);
  if (rules.length !== 1 || !["PD", "RD", "ID"].includes(fact.stage)) return invalid("RULE_NOT_SELECTED_OR_UNAVAILABLE");
  const rule = rules[0];
  value.rule = { ruleId: rule.ruleId, version: rule.version, parameterCode: rule.parameterCode };
  value.allowedSectionsForSelectedStage = [...(fact.stage === "PD" ? rule.expectedSections : rule.actualSections)];
  value.requiredContexts = rule.requiredContext.map(key => ({ key, status: "MISSING" }));
  const needsAuthority = rule.requiredContext.includes("PROJECT_ZERO_GEODETIC_AUTHORITY");
  if (needsAuthority) value.authority.status = "NOT_RECORDED";
  const concreteProse = fact.attribute === "CONCRETE_CLASS" && fact.unit === "B_CLASS"
    && Array.isArray(fact.parameterCodes) && fact.parameterCodes.includes("KR-055") && fact.contextFragments?.some(part => part.role === "MATERIAL_SCOPE");
  const tableApplicable = !concreteProse && !!fact.contextFragments?.some(part => ["ATTRIBUTE_HEADER", "TABLE_SCOPE"].includes(part.role));
  if (tableApplicable) value.tableContext.status = input.fragmentsHash ? "NOT_RECORDED" : "TARGET_HASH_UNAVAILABLE";
  if (decision) {
    if (decision.objectId !== input.objectId || decision.sourceFileId !== fact.sourceFileId
        || decision.sourceSha256 !== fact.sourceSha256 || !sha(decision.contentHash)) return invalid("SOURCE_REVIEW_IDENTITY_MISMATCH");
    if (!["UNKNOWN", "CURRENT", "SUPERSEDED"].includes(decision.revisionStatus)
        || !["UNKNOWN", "APPROVED", "UNAPPROVED"].includes(decision.approvalStatus)
        || !sourceReviewSchema.shape.sectionCode.safeParse(decision.sectionCode).success
        || !sourceReviewSchema.shape.linkGroupId.safeParse(decision.linkGroupId).success) return invalid("INVALID_STORED_SCOPE");
    let bindings: ReturnType<typeof matrixFactScopeSchema.parse>["bindings"] = [];
    if (decision.matrixScope !== undefined) {
      const parsed = matrixSourceScopeSchema.safeParse(decision.matrixScope);
      if (!parsed.success) return invalid("INVALID_STORED_SCOPE");
      if ("schemaVersion" in parsed.data) bindings = parsed.data.bindings;
      else value.legacyWarning = true;
    }
    value.latestReviewContentHash = decision.contentHash;
    value.sourceRevision = decision.revisionStatus; value.sourceApproval = decision.approvalStatus;
    value.sourceSection = decision.sectionCode ?? null;
    if (typeof decision.linkGroupId === "string" && decision.linkGroupId.trim())
      value.linkGroup = { status: "RECORDED_SELECTED_SOURCE_ONLY", value: decision.linkGroupId };
    const candidates = bindings.filter(binding => binding.target.observationId === fact.id
      && binding.ruleId === rule.ruleId && binding.ruleVersion === rule.version && binding.parameterCode === rule.parameterCode);
    // The schema prevents duplicate observation/rule addresses. Other rows are
    // not candidates; never borrow their contexts or select a nearby fact.
    const candidate = candidates[0];
    if (candidate) {
      value.binding.origin = { ...candidate.target };
      const matches = candidate.target.evidenceHash === target.evidenceHash && candidate.target.textArtifactHash === target.textArtifactHash;
      if (!matches) value.binding.status = "EVIDENCE_MISMATCH_NOT_APPLIED";
      else {
        value.binding.status = candidate.target.checkId === target.checkId && candidate.target.executionContentHash === target.executionContentHash
          ? "MATCHED_CURRENT_TARGET" : "MATCHED_BY_OBSERVATION_EVIDENCE_AND_TEXT_HASH";
        value.binding.entityKey = candidate.entityKey;
        value.requiredContexts = rule.requiredContext.map(key => ({ key,
          status: Object.hasOwn(candidate.contexts, key) ? "RECORDED" : "MISSING" }));
        const section = candidate.contexts.DRAWING_SECTION_VERIFIED?.drawingSection;
        if (typeof section === "string") value.rowSectionOverride = { drawingSection: section, status: "RECORDED_NOT_SEMANTICALLY_VERIFIED" };
        if (tableApplicable && candidate.tableContextReview) value.tableContext.status = !input.fragmentsHash ? "TARGET_HASH_UNAVAILABLE"
          : candidate.tableContextReview.fragmentsHash === input.fragmentsHash ? "HASH_MATCH_RECORDED" : "HASH_MISMATCH";
        if (needsAuthority) {
          const authority = candidate.contexts.PROJECT_ZERO_GEODETIC_AUTHORITY;
          if (authority?.projectZeroAuthority) value.authority = { status: "TYPED_POINTER_RECORDED", pointer: {
            ...authority.projectZeroAuthority, target: { ...authority.projectZeroAuthority.target },
          } };
          else if (authority) value.authority.status = "GENERIC_REFERENCE_WITHOUT_TYPED_AUTHORITY";
        }
      }
    }
  }
  if (currentFile && currentFile.id === fact.sourceFileId && currentFile.sha256 === fact.sourceSha256)
    value.sourceNavigation = { id: currentFile.id, sha256: currentFile.sha256 };
  return value;
}
