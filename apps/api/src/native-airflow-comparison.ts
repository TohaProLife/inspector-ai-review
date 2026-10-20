import { types } from "node:util";
import type { DocumentTextV4LocatedLine, DocumentTextV4Page } from "@inspector-ai/contracts";
import type { NativeAirflowAbstainReason, NativeAirflowComparison, NativeAirflowEvidenceLine,
  NativeAirflowMemberValue, NativeAirflowOrigin, NativeAirflowQuote, NativeAirflowReference,
  NativeAirflowSelection } from "@inspector-ai/contracts";
import { freezeNativeSourceOutput, nativeSourceCanonicalTrusted, nativeSourceProvenance,
  nativeSourceSha256, NATIVE_SOURCE_COMPARISON_LIMITS, validateNativeSourceComparisonPair,
  verifyNativeSourceComparisonHash } from "./native-source-comparison-origin.js";

export const NATIVE_AIRFLOW_LIMITS = Object.freeze({ ...NATIVE_SOURCE_COMPARISON_LIMITS,
  maxSelectedRdSystems: 16, maxSystemIdDigits: 6 });
const DOMAIN = "native-airflow-comparison-v1";
const SYSTEM = "[ПВ][1-9][0-9]{0,5}(?:\\.[1-9][0-9]{0,5})?";
const SYSTEM_ID = new RegExp(`^${SYSTEM}$(?![\\s\\S])`, "u");
const SYSTEM_MENTIONS = new RegExp(`(?<![\\p{L}\\p{N}_.])${SYSTEM}(?![\\p{L}\\p{N}_]|\\.[0-9])`, "gu");
// One whole line, explicit units. No joins, table-neighbor inference, OCR or unit conversion.
const DECLARATION = new RegExp(`^[ \\t]*(?:(?:Проект:|Итого по)[ \\t]+)?(${SYSTEM})[ \\t]*\\(L[ \\t]*=[ \\t]*([1-9][0-9]{0,11})[ \\t]+м3/ч,[ \\t]*Pc[ \\t]*=[ \\t]*([1-9][0-9]{0,11})[ \\t]+Па\\)[ \\t]*(?:\\n)?$(?![\\s\\S])`, "u");
const NOTICES = ["SOURCE_DECLARATIONS_ONLY", "USER_SELECTED_GROUP_ONLY", "PHYSICAL_GROUP_AND_OPERATING_MODE_UNVERIFIED",
  "SOURCE_ROLE_UNVERIFIED", "REVISION_AND_APPROVAL_UNVERIFIED", "RENDERED_VISIBILITY_UNVERIFIED",
  "PUBLIC_MAPPING_CONFLICT_REMAINS", "PRESSURE_NOT_AGGREGATED", "NO_ENGINEERING_OR_ABSENCE_CONCLUSION"];

function result(body: Record<string, unknown>): NativeAirflowComparison {
  const output = { schemaVersion: DOMAIN, policyVersion: "native-selected-system-airflow-v1", purpose: "SOURCE_ONLY",
    associatedParameterCode: "IOS4-079", parameterMappingStatus: "PUBLIC_MAPPING_CONFLICT",
    attribute: "SELECTED_SYSTEM_DECLARED_VOLUMETRIC_FLOW", p: null, calibratedProbability: null,
    factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false,
    notices: [...NOTICES], ...body };
  return freezeNativeSourceOutput({ ...output,
    contentHash: nativeSourceSha256(nativeSourceCanonicalTrusted({ hashDomain: DOMAIN, result: output })) }) as unknown as NativeAirflowComparison;
}
const abstain = (reasonCode: NativeAirflowAbstainReason) => result({ status: "ABSTAIN", reasonCode });
/** Integrity only; repository still admits schema, source scope, authorization and immutable origin. */
export function verifyNativeAirflowComparisonHash(value: NativeAirflowComparison): boolean {
  return verifyNativeSourceComparisonHash(value, DOMAIN);
}
function selectionCopy(value: unknown): NativeAirflowSelection | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (keys.length !== 2 || !["pdSystemId", "rdSystemIds"].every(k => d[k]?.enumerable && Object.hasOwn(d[k], "value"))) return undefined;
  const pd = d.pdSystemId.value, rd = d.rdSystemIds.value;
  if (typeof pd !== "string" || !SYSTEM_ID.test(pd) || !Array.isArray(rd) || types.isProxy(rd)
    || Object.getPrototypeOf(rd) !== Array.prototype) return undefined;
  const a = Object.getOwnPropertyDescriptors(rd) as Record<string, PropertyDescriptor>;
  const names = Reflect.ownKeys(a), length = a.length?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > NATIVE_AIRFLOW_LIMITS.maxSelectedRdSystems || names.length !== length + 1) return undefined;
  const members: string[] = [];
  for (let i = 0; i < length; i++) {
    const item = a[String(i)];
    if (!item?.enumerable || !Object.hasOwn(item, "value") || typeof item.value !== "string" || !SYSTEM_ID.test(item.value)) return undefined;
    members.push(item.value);
  }
  return new Set(members).size === members.length ? { pdSystemId: pd, rdSystemIds: members } : undefined;
}
function evidenceLine(origin: NativeAirflowOrigin, role: "PD" | "RD", page: DocumentTextV4Page, line: DocumentTextV4LocatedLine): NativeAirflowEvidenceLine {
  return { sourceFileId: origin.sourceFileId, sourceSha256: origin.sourceSha256,
    textArtifactContentHash: origin.textArtifactContentHash, inputRole: role, evidenceKind: "NATIVE",
    physicalPage: page.pageNumber, pageWidthMilliPoints: page.widthMilliPoints, pageHeightMilliPoints: page.heightMilliPoints,
    nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: [...page.nativeFrame.visibleBoxPointStrings] },
    sourcePath: [...line.sourcePath], rawText: line.rawText, nativeBoxPointStrings: [...line.nativeBoxPointStrings],
    bboxMilliPoints: [...line.bboxMilliPoints], coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", renderedVisibility: "UNVERIFIED" };
}
function selectedMentions(raw: string, wanted: ReadonlySet<string>): string[] {
  return [...new Set(Array.from(raw.matchAll(SYSTEM_MENTIONS), m => m[0]).filter(id => wanted.has(id)))];
}
function hasValueSyntax(raw: string): boolean {
  // Remove all system marks before detecting numbers; ordinary lists of systems remain references.
  const rest = raw.replace(SYSTEM_MENTIONS, "");
  return /[0-9]|(?:^|[^\p{L}])(?:L|Pc)[ \t]*=|м(?:3|³)\s*\/\s*ч|расход|производительност/iu.test(rest);
}
function malformedSelectedMark(raw: string, wanted: ReadonlySet<string>): boolean {
  const tokens = raw.matchAll(/(?<![\p{L}\p{N}_])[ПВ][0-9][\p{L}\p{N}_.]*/gu);
  return Array.from(tokens, m => m[0]).some(token => !SYSTEM_ID.test(token)
    && [...wanted].some(id => token.startsWith(id) && /^[.\p{L}_]/u.test(token.slice(id.length))));
}
type Scan = { quotes: NativeAirflowQuote[]; references: NativeAirflowReference[]; members: NativeAirflowMemberValue[]; count: number }
  | { reason: NativeAirflowAbstainReason };
function scan(origin: NativeAirflowOrigin, role: "PD" | "RD", ids: readonly string[]): Scan {
  const wanted = new Set(ids), quotes: NativeAirflowQuote[] = [], references: NativeAirflowReference[] = [];
  const members = new Map<string, NativeAirflowMemberValue>(); let count = 0, rawBytes = 0;
  if (origin.textArtifact.pageCount > NATIVE_AIRFLOW_LIMITS.maxPagesPerSource) return { reason: "INPUT_LIMIT" };
  for (const page of origin.textArtifact.pages) {
    count += page.locatedLines.length + page.unlocatedLines.length;
    if (count > NATIVE_AIRFLOW_LIMITS.maxNativeLinesPerSource) return { reason: "INPUT_LIMIT" };
    for (const line of page.unlocatedLines) if (selectedMentions(line.rawText, wanted).length
      || (malformedSelectedMark(line.rawText, wanted) && hasValueSyntax(line.rawText))) return { reason: "UNLOCATED_SELECTED_SYSTEM" };
    for (const line of page.locatedLines) {
      if (malformedSelectedMark(line.rawText, wanted) && hasValueSyntax(line.rawText)) return { reason: "UNSUPPORTED_AIRFLOW_GRAMMAR" };
      const mentions = selectedMentions(line.rawText, wanted); if (!mentions.length) continue;
      if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") return { reason: "MATCHING_PAGE_UNVERIFIED" };
      rawBytes += Buffer.byteLength(line.rawText, "utf8");
      // References share the same finite evidence-record/UTF8 budget as declarations.
      if (quotes.length + references.length >= NATIVE_AIRFLOW_LIMITS.maxQuotesPerSource
        || rawBytes > NATIVE_AIRFLOW_LIMITS.maxQuoteUtf8BytesPerSource) return { reason: "INPUT_LIMIT" };
      const match = DECLARATION.exec(line.rawText);
      if (!match) {
        if (hasValueSyntax(line.rawText)) return { reason: mentions.length > 1 ? "AMBIGUOUS_SELECTED_SYSTEM" : "UNSUPPORTED_AIRFLOW_GRAMMAR" };
        references.push({ ...evidenceLine(origin, role, page, line), systemIds: mentions,
          reason: "SELECTED_SYSTEM_REFERENCE_WITHOUT_AIRFLOW" });
        continue;
      }
      const [, systemId, value, pressure] = match;
      if (mentions.length !== 1 || mentions[0] !== systemId) return { reason: "AMBIGUOUS_SELECTED_SYSTEM" };
      const previous = members.get(systemId);
      if (previous && (previous.value !== value || previous.freePressurePa !== pressure)) return { reason: "AIRFLOW_DECLARATIONS_CONFLICT" };
      members.set(systemId, { systemId, value, unit: "м³/ч", freePressurePa: pressure, quoteCount: (previous?.quoteCount ?? 0) + 1 });
      const start = Array.from(line.rawText.slice(0, line.rawText.indexOf(value, line.rawText.indexOf("L") + 1))).length;
      quotes.push({ ...evidenceLine(origin, role, page, line), systemId, rawValue: value, value, unit: "м³/ч", rawUnit: "м3/ч",
        freePressurePa: pressure, rawPressureUnit: "Па", matchedRangeCodePoints: [start, start + value.length],
        extractionMethod: "NATIVE_SINGLE_LINE_SYSTEM_AIRFLOW" });
    }
  }
  if (ids.some(id => !members.has(id))) return { reason: "SELECTED_MEMBER_EVIDENCE_MISSING" };
  return { quotes, references, members: ids.map(id => members.get(id)!), count };
}
/** Pure selected-source arithmetic. Does not infer grouping, concurrent operating mode or compliance. */
export function compareNativeAirflow(pdOrigin: NativeAirflowOrigin, rdOrigin: NativeAirflowOrigin,
  inputSelection: NativeAirflowSelection): NativeAirflowComparison {
  try {
    const selection = selectionCopy(inputSelection); if (!selection) return abstain("INVALID_SELECTION");
    const reason = validateNativeSourceComparisonPair(pdOrigin, rdOrigin); if (reason) return abstain(reason);
    const pd = scan(pdOrigin, "PD", [selection.pdSystemId]); if ("reason" in pd) return abstain(pd.reason);
    const rd = scan(rdOrigin, "RD", selection.rdSystemIds); if ("reason" in rd) return abstain(rd.reason);
    const pdValue = pd.members[0].value, rdValue = String(rd.members.reduce((sum, m) => sum + BigInt(m.value), 0n));
    const delta = BigInt(rdValue) - BigInt(pdValue);
    return result({ status: "COMPARED", selection, comparison: delta === 0n ? "EQUAL" : delta < 0n ? "DECREASE" : "INCREASE",
      pdValue, rdValue, deltaRdMinusPd: String(delta), unit: "м³/ч", memberValues: { PD: pd.members[0], RD: rd.members },
      sources: { PD: nativeSourceProvenance(pdOrigin, "PD", pd.count), RD: nativeSourceProvenance(rdOrigin, "RD", rd.count) },
      quotes: { PD: pd.quotes, RD: rd.quotes }, references: { PD: pd.references, RD: rd.references } });
  } catch { return abstain("INVALID_ORIGIN"); }
}
