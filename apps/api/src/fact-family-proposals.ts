import { canonicalJson, sha256 } from "./canonical-json.js";
import { pilotFactFamilyRules } from "./pilot-rules.js";

/** Trusted arguments come from one immutable run manifest, its frozen review snapshots,
 * committed document-text-v2 rows, and the pinned release definition. `result` is untrusted. */
export interface FactFamilyVerificationInput {
  objectId: string;
  inputManifestHash: string;
  sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
    stages: string[]; sourceReviewHash: string | null; sectionCode?: string | null }>;
  sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
    approvalStatus: string; linkGroupId: string | null; pageStages: Record<string, string>;
    contentHash: string; decisionHash?: string }>;
  textArtifacts: Record<string, { content_json: unknown; content_hash: string }>;
  result: unknown;
  rules: unknown[];
  entityLinks: unknown[];
}

type Json = Record<string, unknown>;
type Source = FactFamilyVerificationInput["sourceFiles"][number];
type Review = FactFamilyVerificationInput["sourceReviews"][string];
type Fact = Json & { factId: string; sourceFileId: string; sourceSha256: string;
  objectId: string; stage: string; pageNumber: number; parameterCode: string;
  attribute: string; rawText: string; rawValue: string; rawUnit: string; locator: Json };
type Rational = { numerator: bigint; denominator: bigint };

const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const exact = (value: Json, fields: readonly string[]): boolean =>
  canonicalJson(Object.keys(value).sort()) === canonicalJson([...fields].sort());
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function box(value: unknown, width: number, height: number): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((part) => integer(part))
    && value[0] < value[2] && value[1] < value[3]
    && value[2] <= width && value[3] <= height;
}

function stageForPage(source: Source, review: Review | undefined, pageCount: number,
  pageNumber: number): string | null {
  if (source.stages.length === 1) {
    if (review && Object.keys(review.pageStages).length !== 0) return null;
    return source.stages[0];
  }
  if (!review || Object.keys(review.pageStages).length !== pageCount) return null;
  for (let index = 1; index <= pageCount; index += 1) {
    if (!source.stages.includes(review.pageStages[String(index)])) return null;
  }
  return review.pageStages[String(pageNumber)] ?? null;
}

function verifiedSource(input: FactFamilyVerificationInput, source: Source, review: Review | undefined): boolean {
  if (source.objectId !== input.objectId || !nonempty(source.sourceFileId) || !hash(source.sha256)
    || !Array.isArray(source.stages) || source.stages.length < 1 || source.stages.length > 3
    || source.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))
    || new Set(source.stages).size !== source.stages.length) return false;
  if (review === undefined) return source.sourceReviewHash === null;
  if (!hash(source.sourceReviewHash) || !hash(review.contentHash)
    || source.sourceReviewHash !== review.contentHash
    || review.decisionHash !== undefined && review.decisionHash !== review.contentHash
    || review.sourceSha256 !== source.sha256 || !record(review.pageStages)
    || !["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(review.revisionStatus)
    || !["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(review.approvalStatus)
    || review.linkGroupId !== null && !nonempty(review.linkGroupId)) return false;
  return Object.entries(review.pageStages).every(([page, stage]) =>
    /^[1-9][0-9]*$/u.test(page) && ["PD", "RD", "ID", "UNRESOLVED"].includes(stage));
}

function verifiedTextArtifact(input: FactFamilyVerificationInput, source: Source): Json | null {
  const stored = input.textArtifacts[source.sourceFileId];
  if (!record(stored) || !record(stored.content_json) || !hash(stored.content_hash)
    || sha256(canonicalJson(stored.content_json)) !== stored.content_hash) return null;
  const artifact = stored.content_json;
  if (artifact.schemaVersion !== "document-text-v2" || artifact.sourceFileId !== source.sourceFileId
    || artifact.inputSha256 !== source.sha256
    || artifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !integer(artifact.pageCount, 1) || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount) return null;
  return artifact;
}

function locatedBlock(locator: unknown, artifact: Json, pageNumber: number,
  span: string, fullText?: string): { text: string; block: Json } | null {
  if (!record(locator) || locator.kind !== "TEXT_BLOCK" || !integer(locator.blockIndex)
    || !integer(locator.start) || !integer(locator.end, 1) || locator.end <= locator.start
    || !Array.isArray(artifact.pages)) return null;
  const page = artifact.pages[pageNumber - 1];
  if (!record(page) || page.pageNumber !== pageNumber || !record(page.quality)
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !integer(page.widthMilliPoints, 1) || !integer(page.heightMilliPoints, 1)
    || !Array.isArray(page.blocks)) return null;
  const block = page.blocks[locator.blockIndex];
  if (!record(block) || typeof block.text !== "string" || block.text.length === 0
    || !box(block.bboxMilliPoints, page.widthMilliPoints, page.heightMilliPoints)
    || !same(locator.bboxMilliPoints, block.bboxMilliPoints)
    || fullText !== undefined && fullText !== block.text
    || locator.end > block.text.length
    || block.text.slice(locator.start, locator.end) !== span) return null;
  return { text: block.text, block };
}

function auxiliaryLocator(value: unknown, artifact: Json, pageNumber: number): string | null {
  if (!record(value) || !exact(value, ["kind", "blockIndex", "start", "end", "bboxMilliPoints", "text"])
    || typeof value.text !== "string" || !integer(value.start) || !integer(value.end, 1)
    || value.end <= value.start) return null;
  const span = value.text.slice(value.start, value.end);
  return span && locatedBlock(value, artifact, pageNumber, span, value.text) ? span : null;
}

function verifiedFact(raw: unknown, input: FactFamilyVerificationInput,
  sources: Map<string, Source>, artifacts: Map<string, Json>): Fact | null {
  if (!record(raw) || raw.schemaVersion !== "typed-fact-v1" || !hash(raw.factId)
    || !nonempty(raw.parameterCode) || !nonempty(raw.attribute) || raw.objectId !== input.objectId
    || !nonempty(raw.sourceFileId) || !hash(raw.sourceSha256)
    || !["PD", "RD", "ID"].includes(String(raw.stage))
    || !integer(raw.pageNumber, 1) || !nonempty(raw.rawText)
    || !nonempty(raw.rawValue) || !nonempty(raw.rawUnit) || !record(raw.locator)) return null;
  if (raw.rawText.length > 4096 || raw.rawValue.length > 120 || raw.rawUnit.length > 80) return null;
  const { factId, ...identity } = raw;
  if (sha256(canonicalJson(identity)) !== factId) return null;
  const source = sources.get(raw.sourceFileId);
  if (!source || source.sha256 !== raw.sourceSha256) return null;
  const artifact = artifacts.get(source.sourceFileId);
  if (!artifact || !Array.isArray(artifact.pages) || raw.pageNumber > artifact.pages.length) return null;
  const review = input.sourceReviews[source.sourceFileId];
  if (stageForPage(source, review, artifact.pages.length, raw.pageNumber) !== raw.stage) return null;
  if (!exact(raw.locator, ["kind", "blockIndex", "start", "end", "bboxMilliPoints"])
    || !locatedBlock(raw.locator, artifact, raw.pageNumber, raw.rawValue, raw.rawText)) return null;
  const unitInValueBlock = raw.rawText.includes(raw.rawUnit);
  const unitLocator = raw.unitLocator === undefined ? null : auxiliaryLocator(raw.unitLocator, artifact, raw.pageNumber);
  if (raw.unitLocator !== undefined && unitLocator !== raw.rawUnit) return null;
  if (!unitInValueBlock && unitLocator !== raw.rawUnit) return null;
  if (unitInValueBlock && unitLocator === null) {
    const rawUnit = raw.rawUnit as string;
    const locator = raw.locator as Json;
    const starts = [...raw.rawText.matchAll(new RegExp(escapeRegExp(rawUnit), "gu"))]
      .map((match) => match.index);
    if (!starts.some((start) => Math.min(
      Math.abs(start + rawUnit.length - Number(locator.start)),
      Math.abs(start - Number(locator.end))) <= 160)) return null;
  }
  for (const key of ["labelLocator", "contextLocator"] as const) {
    if (raw[key] !== undefined && auxiliaryLocator(raw[key], artifact, raw.pageNumber) === null) return null;
  }
  const rule = pilotFactFamilyRules.find((item) => item.parameterCode === raw.parameterCode
    && item.attribute === raw.attribute);
  if (!rule || !normalizeFact(raw as Fact, rule.canonicalUnit)) return null;
  return raw as Fact;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Independent admission check. True only means bounded review aids may be displayed. */
export function verifyFactFamilyProposals(input: FactFamilyVerificationInput): boolean {
  if (!hash(input.inputManifestHash) || !nonempty(input.objectId)
    || !Array.isArray(input.sourceFiles) || !record(input.sourceReviews)
    || !record(input.textArtifacts) || !Array.isArray(input.rules)
    || !Array.isArray(input.entityLinks) || !record(input.result)
    || !same(input.rules, pilotFactFamilyRules)) return false;
  const result = input.result;
  if (!exact(result, ["schemaVersion", "inputManifestHash", "objectId", "facts",
    "comparisons", "outputCount", "findingCount", "contentHash"])
    || result.schemaVersion !== "fact-family-proposals-v1"
    || result.inputManifestHash !== input.inputManifestHash || result.objectId !== input.objectId
    || !Array.isArray(result.facts) || !Array.isArray(result.comparisons)
    || result.facts.length > 512 || result.comparisons.length > 1000
    || result.outputCount !== result.facts.length + result.comparisons.length
    || result.findingCount !== 0 || !hash(result.contentHash)) return false;
  const { contentHash, ...content } = result;
  if (sha256(canonicalJson(content)) !== contentHash) return false;
  const sources = new Map<string, Source>();
  const artifacts = new Map<string, Json>();
  for (const source of input.sourceFiles) {
    if (!record(source) || sources.has(source.sourceFileId)
      || !verifiedSource(input, source, input.sourceReviews[source.sourceFileId])) return false;
    sources.set(source.sourceFileId, source);
    if (input.textArtifacts[source.sourceFileId] !== undefined) {
      const artifact = verifiedTextArtifact(input, source);
      if (!artifact) return false;
      artifacts.set(source.sourceFileId, artifact);
    }
  }
  if (Object.keys(input.sourceReviews).some((id) => !sources.has(id))
    || Object.keys(input.textArtifacts).some((id) => !sources.has(id))) return false;
  const facts = new Map<string, Fact>();
  const occupied = new Set<string>();
  for (const raw of result.facts) {
    const fact = verifiedFact(raw, input, sources, artifacts);
    if (!fact || facts.has(fact.factId)) return false;
    const locatorKey = `${fact.sourceFileId}:${fact.pageNumber}:${fact.locator.blockIndex}:`
      + `${fact.locator.start}:${fact.locator.end}:${fact.parameterCode}:${fact.attribute}:${fact.stage}`;
    if (occupied.has(locatorKey)) return false;
    occupied.add(locatorKey);
    facts.set(fact.factId, fact);
  }
  return verifyComparisons(result.comparisons, input, sources, facts);
}

function verifyComparisons(comparisons: unknown[], input: FactFamilyVerificationInput,
  sources: Map<string, Source>, facts: Map<string, Fact>): boolean {
  if (comparisons.length !== input.rules.length || input.entityLinks.length > input.rules.length) return false;
  // Callers derive these from hashed review snapshots. Recheck every selected
  // link here, including links unused because section policy filtered a fact.
  for (const raw of input.entityLinks) {
    if (!record(raw) || !nonempty(raw.pdFactId) || !nonempty(raw.actualFactId)) return false;
    const pd = facts.get(raw.pdFactId);
    const actual = facts.get(raw.actualFactId);
    if (!pd || !actual || pd.stage !== "PD" || !["RD", "ID"].includes(actual.stage)
      || pd.parameterCode !== actual.parameterCode || pd.attribute !== actual.attribute
      || input.sourceReviews[pd.sourceFileId]?.revisionStatus !== "CURRENT"
      || input.sourceReviews[actual.sourceFileId]?.revisionStatus !== "CURRENT"
      || input.sourceReviews[pd.sourceFileId]?.approvalStatus !== "APPROVED"
      || input.sourceReviews[actual.sourceFileId]?.approvalStatus !== "APPROVED"
      || !validLink(raw, pd, actual, input.sourceReviews)) return false;
  }
  for (let index = 0; index < input.rules.length; index += 1) {
    const rule = input.rules[index];
    if (!record(rule) || !record(rule.comparator)
      || rule.schemaVersion !== "fact-comparison-rule-v1" || !nonempty(rule.ruleId)
      || !nonempty(rule.version) || !nonempty(rule.parameterCode) || !nonempty(rule.attribute)
      || rule.expectedStage !== "PD" || !["RD", "ID"].includes(String(rule.actualStage))
      || !["m2", "m3", "mm", "count", "B_CLASS"].includes(String(rule.canonicalUnit))
      || !validComparator(rule.comparator)
      || (rule.comparator.family === "CLASS_DECREASE") !== (rule.canonicalUnit === "B_CLASS")) return false;
    const submitted = comparisons[index];
    if (!record(submitted) || !exact(submitted, ["schemaVersion", "ruleId", "ruleVersion",
      "objectId", "parameterCode", "attribute", "expectedStage", "actualStage",
      "canonicalUnit", "status", "reasonCodes", "expectedFactId", "actualFactId",
      "normalizedExpected", "normalizedActual", "comparison", "contentHash"])
      || submitted.schemaVersion !== "fact-comparison-result-v1"
      || submitted.ruleId !== rule.ruleId || submitted.ruleVersion !== rule.version
      || submitted.objectId !== input.objectId || submitted.parameterCode !== rule.parameterCode
      || submitted.attribute !== rule.attribute || submitted.expectedStage !== rule.expectedStage
      || submitted.actualStage !== rule.actualStage || submitted.canonicalUnit !== rule.canonicalUnit
      || !hash(submitted.contentHash)) return false;
    const { contentHash, ...withoutHash } = submitted;
    if (sha256(canonicalJson(withoutHash)) !== contentHash) return false;
    const allowedActualSections = Array.isArray(rule.requiredActualSection)
      ? rule.requiredActualSection : [];
    if (allowedActualSections.length === 0
      || allowedActualSections.some((section) => !nonempty(section))) return false;
    const candidates = [...facts.values()].filter((fact) => fact.objectId === input.objectId
      && fact.parameterCode === rule.parameterCode && fact.attribute === rule.attribute
      && (fact.stage === "PD" || fact.stage === rule.actualStage
        && allowedActualSections.includes(sources.get(fact.sourceFileId)?.sectionCode)));
    const expectedFacts = candidates.filter((fact) => fact.stage === "PD");
    const actualFacts = candidates.filter((fact) => fact.stage === rule.actualStage);
    let expected: Fact | null = null;
    let actual: Fact | null = null;
    let reason: string | null = null;
    let selectedLink: { raw: Json; linkIndex: number } | null = null;
    if (expectedFacts.length === 0 || actualFacts.length === 0) reason = "REQUIRED_FACT_MISSING";
    else if (expectedFacts.length > 1 || actualFacts.length > 1) {
      const pdIds = new Set(expectedFacts.map((fact) => fact.factId));
      const actualIds = new Set(actualFacts.map((fact) => fact.factId));
      const touching = input.entityLinks.flatMap((raw, linkIndex) => record(raw)
        && (pdIds.has(String(raw.pdFactId)) || actualIds.has(String(raw.actualFactId)))
        ? [{ raw, linkIndex }] : []);
      if (touching.length > 1) reason = "AMBIGUOUS_ENTITY_LINK";
      else if (touching.length === 0) reason = "AMBIGUOUS_FACTS";
      else {
        const selectedExpected = expectedFacts.find((fact) => fact.factId === touching[0].raw.pdFactId);
        const selectedActual = actualFacts.find((fact) => fact.factId === touching[0].raw.actualFactId);
        if (!selectedExpected || !selectedActual) reason = "AMBIGUOUS_FACTS";
        else {
          expected = selectedExpected;
          actual = selectedActual;
          selectedLink = touching[0];
        }
      }
    } else {
      expected = expectedFacts[0];
      actual = actualFacts[0];
    }
    if (expected && actual && !reason) {
      if (expected.factId === actual.factId) reason = "DUPLICATE_FACT_ID";
      for (const fact of [expected, actual]) {
        if (reason) break;
        const review = input.sourceReviews[fact.sourceFileId];
        if (review?.revisionStatus !== "CURRENT") reason = "REVISION_NOT_CURRENT";
        else if (review.approvalStatus !== "APPROVED") reason = "APPROVAL_NOT_APPROVED";
        else if (!nonempty(review.linkGroupId)) reason = "LINK_GROUP_MISSING";
      }
      if (!reason && input.sourceReviews[expected.sourceFileId].linkGroupId
        !== input.sourceReviews[actual.sourceFileId].linkGroupId) reason = "LINK_GROUP_MISMATCH";
    }
    let normalizedExpected: Rational | null = null;
    let normalizedActual: Rational | null = null;
    let expectedComparison: Json | null = null;
    if (expected && actual && !reason) {
      const related = selectedLink ? [selectedLink] : input.entityLinks.flatMap((raw, linkIndex) => record(raw)
        && (raw.pdFactId === expected!.factId || raw.actualFactId === actual!.factId)
        ? [{ raw, linkIndex }] : []);
      if (related.length === 0) reason = "ENTITY_LINK_MISSING";
      else if (related.length > 1) reason = "AMBIGUOUS_ENTITY_LINK";
      else if (!validLink(related[0].raw, expected, actual, input.sourceReviews)) {
        reason = "ENTITY_LINK_INVALID";
      } else {
        if (!sameEntityContext(expected, actual)) reason = "ENTITY_CONTEXT_MISMATCH";
        else {
          normalizedExpected = normalizeFact(expected, String(rule.canonicalUnit));
          normalizedActual = normalizeFact(actual, String(rule.canonicalUnit));
          if (!normalizedExpected || !normalizedActual) reason = "VALUE_OR_UNIT_INVALID";
          else {
            const evaluated = comparisonState(rule.comparator, normalizedExpected, normalizedActual);
            reason = evaluated?.reason ?? null;
            expectedComparison = evaluated?.comparison ?? null;
          }
        }
      }
    }
    if (reason) {
      if (submitted.status !== "ABSTAIN" || !same(submitted.reasonCodes, [reason])
        || submitted.expectedFactId !== (expected?.factId ?? null)
        || submitted.actualFactId !== (actual?.factId ?? null)
        || submitted.normalizedExpected !== (normalizedExpected ? decimalText(normalizedExpected) : null)
        || submitted.normalizedActual !== (normalizedActual ? decimalText(normalizedActual) : null)
        || submitted.comparison !== null) return false;
    } else {
      if (!expected || !actual || !normalizedExpected || !normalizedActual || !expectedComparison
        || submitted.status !== "REVIEW_REQUIRED"
        || submitted.expectedFactId !== expected.factId || submitted.actualFactId !== actual.factId
        || submitted.normalizedExpected !== decimalText(normalizedExpected)
        || submitted.normalizedActual !== decimalText(normalizedActual)
        || !checkedComparison(submitted.comparison, expectedComparison)) return false;
      const reasonCode = equal(normalizedExpected, normalizedActual) ? "NO_DIFFERENCE_OBSERVED"
        : expectedComparison.triggered ? "COMPARISON_TRIGGERED_REVIEW"
          : "COMPARISON_NOT_TRIGGERED_REVIEW";
      if (!same(submitted.reasonCodes, [reasonCode])) return false;
    }
  }
  return true;
}

function sameEntityContext(expected: Fact, actual: Fact): boolean {
  if (expected.parameterCode.startsWith("KR-")
    && (!nonempty(expected.elementType) || !nonempty(actual.elementType)
      || expected.elementType !== actual.elementType)) return false;
  return ["elementType", "zone", "floor", "scope"].every((field) => {
    const left = expected[field];
    const right = actual[field];
    return left === undefined && right === undefined
      || nonempty(left) && nonempty(right) && left === right;
  });
}

function validLink(value: unknown, expected: Fact, actual: Fact,
  reviews: FactFamilyVerificationInput["sourceReviews"]): boolean {
  if (!record(value) || !exact(value, ["schemaVersion", "pdFactId", "actualFactId",
    "objectId", "linkGroupId", "basis", "evidence"])
    || value.schemaVersion !== "fact-entity-link-v1" || value.pdFactId !== expected.factId
    || value.actualFactId !== actual.factId || value.objectId !== expected.objectId
    || expected.sourceFileId === actual.sourceFileId
    || !nonempty(reviews[expected.sourceFileId]?.linkGroupId)
    || value.linkGroupId !== reviews[expected.sourceFileId].linkGroupId
    || value.linkGroupId !== reviews[actual.sourceFileId]?.linkGroupId
    || !(nonempty(value.basis) || record(value.basis)
      && exact(value.basis, ["reference"]) && nonempty(value.basis.reference))
    || !Array.isArray(value.evidence) || value.evidence.length !== 2) return false;
  const evidence = value.evidence as unknown[];
  return [expected, actual].every((fact) => evidence.filter((raw: unknown) =>
    record(raw) && exact(raw, ["factId", "sourceFileId", "sourceSha256", "pageNumber", "locator"])
      && raw.factId === fact.factId && raw.sourceFileId === fact.sourceFileId
      && raw.sourceSha256 === fact.sourceSha256 && raw.pageNumber === fact.pageNumber
      && same(raw.locator, fact.locator)).length === 1);
}

/** Validate frozen human-reviewed link envelopes exactly as the worker does.
 * Bad or stale envelope set yields no links, keeping comparisons in ABSTAIN. */
export function verifiedReviewedFactEntityLinks(
  envelopes: unknown,
  objectId: string,
  rawFacts: unknown,
  sourceFiles: FactFamilyVerificationInput["sourceFiles"],
  sourceReviews: FactFamilyVerificationInput["sourceReviews"],
): unknown[] {
  if (!Array.isArray(envelopes) || envelopes.length > 5 || !Array.isArray(rawFacts)
    || !Array.isArray(sourceFiles) || !record(sourceReviews)) return [];
  const facts = new Map<string, Fact>();
  for (const raw of rawFacts) {
    if (!record(raw) || !hash(raw.factId) || facts.has(raw.factId)) return [];
    facts.set(raw.factId, raw as Fact);
  }
  const sources = new Map<string, Source>();
  for (const raw of sourceFiles) {
    if (!record(raw) || !nonempty(raw.sourceFileId) || sources.has(raw.sourceFileId)) return [];
    sources.set(raw.sourceFileId, raw);
  }
  const links: unknown[] = [];
  for (const envelope of envelopes) {
    if (!record(envelope) || !exact(envelope, ["schemaVersion", "link", "contentHash",
      "decisionHash", "actorId"])
      || envelope.schemaVersion !== "reviewed-fact-entity-link-v1"
      || !nonempty(envelope.actorId) || !record(envelope.link)
      || !hash(envelope.contentHash) || envelope.decisionHash !== envelope.contentHash
      || sha256(canonicalJson({ actorId: envelope.actorId, link: envelope.link }))
        !== envelope.contentHash) return [];
    const link = envelope.link;
    if (!nonempty(link.pdFactId) || !nonempty(link.actualFactId)) return [];
    const expected = facts.get(link.pdFactId);
    const actual = facts.get(link.actualFactId);
    if (!expected || !actual || link.objectId !== objectId
      || expected.objectId !== actual.objectId || expected.objectId !== objectId
      || expected.stage !== "PD" || !["RD", "ID"].includes(actual.stage)
      || expected.parameterCode !== actual.parameterCode
      || expected.attribute !== actual.attribute) return [];
    for (const fact of [expected, actual]) {
      const source = sources.get(fact.sourceFileId);
      const review = sourceReviews[fact.sourceFileId];
      if (!source || source.sha256 !== fact.sourceSha256 || !review
        || review.sourceSha256 !== source.sha256 || review.revisionStatus !== "CURRENT"
        || review.approvalStatus !== "APPROVED") return [];
    }
    if (!validLink(link, expected, actual, sourceReviews)) return [];
    links.push(link);
  }
  return links;
}

function rational(raw: unknown): Rational | null {
  if (typeof raw !== "string" || raw.length > 120
    || !/^-?(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?$/u.test(raw)) return null;
  const negative = raw.startsWith("-");
  const [whole, fractional = ""] = raw.replace(/^[+-]/u, "")
    .replace(/[ \u00a0]/gu, "").replace(",", ".").split(".");
  return { numerator: BigInt(`${negative ? "-" : ""}${whole}${fractional}`),
    denominator: 10n ** BigInt(fractional.length) };
}

function multiply(left: Rational, right: Rational): Rational {
  return { numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator };
}
function subtract(left: Rational, right: Rational): Rational {
  return { numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator };
}
function absolute(value: Rational): Rational {
  return { numerator: value.numerator < 0n ? -value.numerator : value.numerator,
    denominator: value.denominator };
}
function equal(left: Rational, right: Rational): boolean {
  return left.numerator * right.denominator === right.numerator * left.denominator;
}
function greater(left: Rational, right: Rational): boolean {
  return left.numerator * right.denominator > right.numerator * left.denominator;
}
function decimalText(value: Rational): string | null {
  if (value.numerator === 0n) return "0";
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) { denominator /= 2n; twos += 1; }
  while (denominator % 5n === 0n) { denominator /= 5n; fives += 1; }
  if (denominator !== 1n) return null;
  const places = Math.max(twos, fives);
  const scaled = value.numerator * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, "0");
  const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return `${negative ? "-" : ""}${text.replace(/\.?0+$/u, (match) => match.startsWith(".") ? "" : match)}`
    .replace(/(\.[0-9]*?)0+$/u, "$1").replace(/\.$/u, "");
}

const factors: Record<string, Record<string, string>> = {
  m: { m: "1", "м": "1", cm: "0.01", "см": "0.01", mm: "0.001", "мм": "0.001" },
  m2: { m2: "1", "m²": "1", "м2": "1", "м²": "1", "кв.м": "1", "кв. м": "1",
    cm2: "0.0001", "cm²": "0.0001", "см2": "0.0001", "см²": "0.0001",
    mm2: "0.000001", "mm²": "0.000001", "мм2": "0.000001", "мм²": "0.000001" },
  m3: { m3: "1", "m³": "1", "м3": "1", "м³": "1", "куб.м": "1", "куб. м": "1",
    cm3: "0.000001", "cm³": "0.000001", "см3": "0.000001", "см³": "0.000001",
    mm3: "0.000000001", "mm³": "0.000000001", "мм3": "0.000000001", "мм³": "0.000000001",
    "тыс. м3": "1000", "тыс. м³": "1000", "тыс. куб.м": "1000", "тыс. куб. м": "1000" },
  mm: { mm: "1", "мм": "1", cm: "10", "см": "10", m: "1000", "м": "1000" },
  count: { count: "1", pcs: "1", "шт": "1", "шт.": "1", "ед": "1", "ед.": "1",
    "этаж": "1", "этажа": "1", "этажей": "1", "эт.": "1", "этажность": "1", "кв.": "1" },
  kW: { kW: "1", "кВт": "1", "Вт": "0.001", "МВт": "1000" },
  "m3/day": { "m3/day": "1", "м3/сут": "1", "м³/сут": "1" },
  "Gcal/h": { "Gcal/h": "1", "Гкал/ч": "1", "Гкал/час": "1" },
  "m3/h": { "m3/h": "1", "м3/ч": "1", "м³/ч": "1" },
  t: { t: "1", "т": "1", "т.": "1", kg: "0.001", "кг": "0.001" },
  day: { day: "1", "день": "1", "дня": "1", "дни": "1",
    "сут": "1", "сут.": "1", "сутки": "1" },
  "W/(m*C)": { "W/(m*C)": "1", "Вт/(м·С)": "1", "Вт/(м·°С)": "1",
    "Вт/(м·C)": "1", "Вт/(м·°C)": "1" },
  "kWh/m2": { "kWh/m2": "1", "кВт·ч/м²": "1", "кВт·ч/м2": "1",
    "кВт*ч/м²": "1" },
  thousand_rub: { "thousand_rub": "1", "тыс. руб.": "1", "тыс руб.": "1",
    "тыс.руб.": "1", "руб.": "0.001", "руб": "0.001" },
};

export function normalizeFact(fact: { rawValue: string; rawUnit: string; attribute: string },
  unit: string): Rational | null {
  if (unit === "B_CLASS") {
    if (!["B", "В"].includes(fact.rawUnit)
      || !/^[BВ][0-9]+(?:[.,][0-9]+)?$/u.test(fact.rawValue)
      || !fact.rawValue.startsWith(fact.rawUnit)) return null;
    return rational(fact.rawValue.slice(1));
  }
  const raw = rational(fact.rawValue);
  if (!raw || raw.numerator < 0n) return null;
  // New family units keep SI case: МВт and мВт are different quantities.
  // Legacy pilot units retain their existing case-insensitive contract.
  const legacyUnit = ["m2", "m3", "mm", "count"].includes(unit);
  const rawUnit = legacyUnit ? fact.rawUnit.trim().toLocaleLowerCase("ru")
    : fact.rawUnit.trim().replace(/[\s\u00a0\u202f]+/gu, " ");
  const factorText = factors[unit]?.[rawUnit];
  if (!factorText || rawUnit === "этажность" && fact.attribute !== "ABOVE_GROUND_FLOOR_COUNT"
    || rawUnit === "кв." && fact.attribute !== "APARTMENT_COUNT") return null;
  const factor = rational(factorText);
  if (!factor) return null;
  const normalized = multiply(raw, factor);
  if (unit === "count" && normalized.numerator % normalized.denominator !== 0n) return null;
  return normalized;
}

function validComparator(comparator: Json): boolean {
  const threshold = rational(comparator.threshold);
  if (!threshold || threshold.numerator < 0n) return false;
  const family = comparator.family;
  return ["DIFFERENT", "DECREASE", "CLASS_DECREASE", "INCREASE",
    "RELATIVE_DELTA", "RELATIVE_INCREASE"].includes(String(family))
    && comparator.operator === (family === "DIFFERENT" ? "!=" : ">")
    && (family !== "DIFFERENT" || threshold.numerator === 0n);
}

function comparisonFor(comparator: Json, expected: Rational, actual: Rational): Json | null {
  if (!validComparator(comparator)) return null;
  const threshold = rational(comparator.threshold);
  if (!threshold) return null;
  const family = comparator.family;
  const difference = subtract(actual, expected);
  const observed = family === "DIFFERENT" ? absolute(difference)
    : family === "RELATIVE_DELTA"
      ? multiply(absolute(difference), { numerator: expected.denominator,
        denominator: expected.numerator })
      : family === "RELATIVE_INCREASE"
        ? multiply(difference, { numerator: expected.denominator,
          denominator: expected.numerator })
        : family === "INCREASE" ? difference : subtract(expected, actual);
  const triggered = family === "DIFFERENT" ? observed.numerator !== 0n
    : greater(observed, threshold);
  return { family, operator: comparator.operator, threshold: decimalText(threshold),
    observed: decimalText(observed), triggered, observedRational: observed };
}

function comparisonState(comparator: Json, expected: Rational, actual: Rational):
  { reason: "ZERO_BASELINE" | null; comparison: Json | null } | null {
  if (!validComparator(comparator)) return null;
  if (["RELATIVE_DELTA", "RELATIVE_INCREASE"].includes(String(comparator.family))
    && expected.numerator === 0n) return { reason: "ZERO_BASELINE", comparison: null };
  const comparison = comparisonFor(comparator, expected, actual);
  return comparison ? { reason: null, comparison } : null;
}

/** Test and future rule-pack seam over normalized decimal values. */
export function verifyComparatorOutcome(comparator: unknown, expectedValue: string,
  actualValue: string, submitted: unknown): boolean {
  if (!record(comparator) || !record(submitted)) return false;
  const expected = rational(expectedValue);
  const actual = rational(actualValue);
  if (!expected || !actual || expected.numerator < 0n || actual.numerator < 0n) return false;
  const state = comparisonState(comparator, expected, actual);
  if (!state) return false;
  if (state.reason) return submitted.status === "ABSTAIN"
    && same(submitted.reasonCodes, [state.reason]) && submitted.comparison === null;
  const comparison = state.comparison;
  if (!comparison) return false;
  const reason = equal(expected, actual) ? "NO_DIFFERENCE_OBSERVED"
    : comparison.triggered ? "COMPARISON_TRIGGERED_REVIEW" : "COMPARISON_NOT_TRIGGERED_REVIEW";
  return submitted.status === "REVIEW_REQUIRED" && same(submitted.reasonCodes, [reason])
    && checkedComparison(submitted.comparison, comparison);
}

function checkedComparison(submitted: unknown, expected: Json): boolean {
  if (!record(submitted) || !exact(submitted, ["family", "operator", "threshold", "observed", "triggered"])
    || submitted.family !== expected.family || submitted.operator !== expected.operator
    || submitted.threshold !== expected.threshold || submitted.triggered !== expected.triggered) return false;
  const observed = rational(submitted.observed);
  const wanted = expected.observedRational;
  if (!observed || !record(wanted) || typeof wanted.numerator !== "bigint"
    || typeof wanted.denominator !== "bigint") return false;
  const difference = absolute(subtract(observed, wanted as Rational));
  return difference.numerator === 0n
    || difference.numerator * 10n ** 70n <= difference.denominator;
}
