import { REBAR_ATTRIBUTE, REBAR_UNIT, normalizeRebarClass, validRebarSourceBinding } from "./matrix-rebar-prose.js";
import { isConcreteProseFact, validConcreteSourceBinding } from "./matrix-concrete-prose.js";
import { extractProjectZeroCandidates, normalizeProjectZeroValue } from "./matrix-project-zero-prose.js";
import { isStairDimension, validStairSourceBinding } from "./matrix-stair-prose.js";
import { isTerritoryFenceHeight, validFenceSourceBinding } from "./matrix-fence-prose.js";
import { rebuildMatrixRuleResultsV13, type MatrixRuleVerificationSource } from "./matrix-rule-verifier-v13.js";
import { prepareConcreteWallObservationsV13, verifyConcreteWallObservationSetV13,
  isReservedConcreteWallObservationV13, concreteWallObservationOrderV13,
  type MatrixConcreteWallV13Input } from "./matrix-concrete-wall-observations-v13.js";
import { sameConcreteWallV13 as same } from "./matrix-concrete-wall-window-v13.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import { portableEvidenceHash } from "./matrix-fact-scope.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { MatrixExecution } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { normalizeFact } from "./fact-family-proposals.js";
import { validConcreteTableContext, validSlabTableContext, validSidewalkTileTableContext } from "./matrix-table-context.js";

/** OUTPUT ONLY. No profile/release/capsule shortcut. Private unchanged registry. */
const matrixRegistry = JSON.parse(readFileSync(new URL("../../../services/worker/rules/matrix-execution-v1.json", import.meta.url), "utf8")) as {
  entries: Array<{ parameterCode: string; atomicRules: Array<{ ruleId: string; version: string; enabled: boolean;
    attribute: string; canonicalUnit: string; [key: string]: unknown }> }>;
};
const matrixRegistryHash = sha256(canonicalJson(matrixRegistry));

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const box = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1) })
  .refine((b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001);
const observation = z.object({ id: z.string().min(1), sourceFileId: z.string().min(1),
  sourceSha256: hash, stage: z.enum(["PD", "RD", "ID", "UNRESOLVED"]), pageNumber: z.number().int().positive(),
  blockId: z.string().regex(/^\d+:\d+$/u), bbox: box, rawText: z.string().min(1),
  attribute: z.string().min(1), value: z.string().min(1), unit: z.string().min(1),
  entityKey: z.string().nullable(), method: z.literal("TEXT_LAYER"), extractorVersion: z.string().min(1),
  contextFragments: z.array(z.object({ pageNumber:z.number().int().positive(),
    blockId:z.string().regex(/^\d+:\d+$/u), rawText:z.string().min(1), bbox:box,
    role:z.enum(["ATTRIBUTE_HEADER","TABLE_SCOPE","UNIT_DECLARATION","MATERIAL_SCOPE"]),
  }).strict()).min(1).max(8).optional(),
}).passthrough();
const atomic = z.object({ ruleId: z.string().min(1), ruleVersion: z.string().min(1),
  parameterCode: z.string(), entityKey: z.string().nullable(), comparisonVariant: z.enum(["PD_RD", "PD_ID", "RD_ID"]),
  executionStatus: z.enum(["SUCCEEDED", "FAILED"]), machineStatus: z.enum([
    "CANDIDATE", "NEGATIVE_VERIFIED", "MISSING_EVIDENCE", "NOT_COMPARABLE", "CLARIFICATION_REQUIRED"]),
  reasonCode: z.string().min(1), expectedObservationId: z.string().nullable(),
  actualObservationId: z.string().nullable(), expectedValue: z.string().nullable(),
  actualValue: z.string().nullable(), delta: z.string().nullable(), qualified: z.boolean(),
}).passthrough();
const executionSchema = z.object({ schemaVersion: z.literal("matrix-execution-v1"),
  objectId: z.string(), inputManifestHash: hash, registryHash: hash,
  observations: z.array(observation).max(50000), metadata: z.array(z.record(z.string(), z.unknown())),
  results: z.array(atomic).max(50000), coverage: z.array(z.unknown()).length(132),
}).passthrough();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface MatrixVerificationSource extends MatrixRuleVerificationSource {}

/** Independent source-boundary verification. Worker cannot inject a page or a qualified result. */
export function validateMatrixExecutionV13(raw: unknown, rawInput: MatrixConcreteWallV13Input): MatrixExecution | null {
  try { return admitMatrixExecutionV13(raw, rawInput); } catch { return null; }
}
function admitMatrixExecutionV13(raw: unknown, rawInput: MatrixConcreteWallV13Input): MatrixExecution | null {
  // No unknown/native field access or callbacks before descriptor-safe admission.
  assertConcreteWallLeaseNativeV13({ raw, input: rawInput });
  const prepared = prepareConcreteWallObservationsV13(rawInput);
  const input = { objectId: prepared.window.objectId as string, inputManifestHash: prepared.window.inputManifestHash as string,
    sources: prepared.sources };
  const decoded = executionSchema.safeParse(raw);
  if (!decoded.success) return null;
  const value = decoded.data;
  if (value.objectId !== input.objectId || value.inputManifestHash !== input.inputManifestHash
    || value.registryHash !== matrixRegistryHash) return null;
  // This schema has no calibrated worker confidence contract. Reject invented claims before persistence.
  const reservedConfidenceKeys = ["probability", "confidence", "calibratedProbability"];
  if ([value, ...value.results, ...value.observations].some(row =>
    reservedConfidenceKeys.some(key => Object.prototype.hasOwnProperty.call(row, key)))) return null;
  // Exact observation IDs/selectors have no bound relation in their preimage.
  // Bounds must use the separately verified artifact, never the v1 passthrough.
  const reservedDeclarationFields = ["sourceDeclarations", "declarations", "productScope", "declarationId",
    "primaryFragments", "scopeFragments", "applicabilityStatus", "criterion", "minutes", "constructionLabelLines",
    "headerFragments", "unitFragments", "bindingPolicyVersion", "tableBoxMilliPoints", "tablePolicyHash"];
  if ([value, ...value.observations, ...value.results].some(item => reservedDeclarationFields.some(key => Object.hasOwn(item,key)))
    || ["projectConstraints", "constraints"].some(key => Object.hasOwn(value, key))
    || value.observations.some(item => ["relation", "limitValue", "constraintId", "kind"].some(key => Object.hasOwn(item, key)))) return null;
  const sources = new Map(input.sources.map((s) => [s.sourceFileId, s]));
  if (!validMetadata(value.metadata,input.sources)) return null;
  const observations = new Map<string, typeof value.observations[number]>();
  for (const item of value.observations) {
    const source = sources.get(item.sourceFileId);
    const artifact = source?.textArtifact;
    if (!source || source.sha256 !== item.sourceSha256 || observations.has(item.id)
      || !artifact || artifact.inputSha256 !== source.sha256 || !Array.isArray(artifact.pages)) return null;
    const stage = source.stages.length === 1 ? source.stages[0]
      : source.review?.pageStages?.[String(item.pageNumber)] ?? "UNRESOLVED";
    if (stage !== item.stage) return null;
    const page = artifact.pages.find((p: unknown) => record(p) && p.pageNumber === item.pageNumber);
    if (!record(page) || !Array.isArray(page.blocks)) return null;
    const fragments = Array.isArray(item.evidenceFragments) ? item.evidenceFragments : [item];
    if (!fragments.length) return null;
    const boxes: number[][] = [];
    for (const fragment of fragments) {
      if (!record(fragment) || typeof fragment.blockId !== "string" || typeof fragment.rawText !== "string"
        || !/^\d+:\d+$/u.test(fragment.blockId)) return null;
      const [blockIndex, lineIndex] = fragment.blockId.split(":").map(Number);
      const block = page.blocks[blockIndex];
      if (!record(block) || typeof block.text !== "string"
        || block.text.split(/\r?\n/u)[lineIndex]?.trim() !== fragment.rawText.trim()) return null;
      const lineBoxes = block.lineBboxesMilliPoints;
      const sourceBox = Array.isArray(lineBoxes) ? lineBoxes[lineIndex] : block.bboxMilliPoints;
      if (!Array.isArray(sourceBox) || sourceBox.length !== 4 || sourceBox.some(n => !Number.isFinite(n))) return null;
      boxes.push(sourceBox);
      if (!sameBox(fragment.bbox, normalizedBox(sourceBox, page))) return null;
    }
    const union = [Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),
      Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
    for(const fragment of item.contextFragments??[]) {
      const contextPage=artifact.pages.find((p:unknown)=>record(p)&&p.pageNumber===fragment.pageNumber);
      const contextStage=source.stages.length===1?source.stages[0]
        :source.review?.pageStages?.[String(fragment.pageNumber)]??"UNRESOLVED";
      if(contextStage!==item.stage||!record(contextPage)||!Array.isArray(contextPage.blocks))return null;
      const [bi,li]=fragment.blockId.split(":").map(Number),block=contextPage.blocks[bi];
      if(!record(block)||typeof block.text!=="string"||block.text.split(/\r?\n/u)[li]?.trim()!==fragment.rawText.trim())return null;
      const sourceBox=Array.isArray(block.lineBboxesMilliPoints)?block.lineBboxesMilliPoints[li]:block.bboxMilliPoints;
      if(!Array.isArray(sourceBox)||sourceBox.length!==4||sourceBox.some(n=>!Number.isFinite(n))
        ||!sameBox(fragment.bbox,normalizedBox(sourceBox,contextPage)))return null;
    }
    const concreteWall = isReservedConcreteWallObservationV13(item);
    const identity = { sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,
      stage:item.stage,pageNumber:item.pageNumber,blockIds:fragments.map(f=>f.blockId),
      attribute:item.attribute,value:item.value,unit:item.unit,
      ...(item.contextFragments?{contextFragments:item.contextFragments}:{}) };
    const expectedId = concreteWall ? portableEvidenceHash({ schemaVersion: "matrix-concrete-wall-observation-v1",
      ...identity, extractorVersion: item.extractorVersion }) : sha256(canonicalJson(identity));
    if (item.blockId !== fragments[0].blockId || !sameBox(item.bbox, normalizedBox(union,page))
      || item.rawText !== fragments.map(f=>f.rawText).join(" ") || item.id !== expectedId) return null;
    const rawValue = item.rawValue;
    const rawUnit = item.rawUnit;
    const rebar = item.attribute === REBAR_ATTRIBUTE;
    if (typeof rawValue !== "string" || (rebar ? rawUnit !== null || item.unit !== REBAR_UNIT : typeof rawUnit !== "string")
      || !item.rawText.replace(/\s+/gu," ").includes(rawValue.replace(/\s+/gu," "))) return null;
    const classUnit = ["B_CLASS","energy_class","reliability_category","fire_resistance_degree",
      "structural_fire_hazard_class","fire_rating","finish_fire_class","F_CLASS","W_CLASS"].includes(item.unit);
    const projectZero = item.attribute === "PROJECT_ZERO_ABSOLUTE_ELEVATION";
    const normalized = projectZero || rebar || classUnit ? null : normalizeFact({rawValue,rawUnit:rawUnit as string,attribute:item.attribute},item.unit);
    if (rebar) {
      if (normalizeRebarClass(rawValue) !== item.value) return null;
    } else if (projectZero) {
      if (normalizeProjectZeroValue(rawValue, rawUnit) !== item.value || item.unit !== "m") return null;
    } else if (normalized) {
      const match = /^([+-]?\d+)(?:\.(\d+))?$/u.exec(item.value);
      if (!match) return null;
      const denominator = 10n ** BigInt(match[2]?.length ?? 0);
      const numerator = BigInt(`${match[1]}${match[2] ?? ""}`);
      if (normalized.numerator * denominator !== numerator * normalized.denominator) return null;
    } else if (item.value !== rawValue || !classUnit || rawUnit !== item.unit) return null;
    if (concreteWall) {
      // Every preceding raw source/geometry/identity/normalization check still
      // ran. This exact reconstruction cannot hide bad generic observations.
      const reconstructed = prepared.walls.find(fact => fact.id === item.id);
      if (!reconstructed || !same(item, reconstructed)) return null;
    } else if (rebar) {
      if (!validRebarSourceBinding(item, fragments, page)) return null;
    } else if (isConcreteProseFact(item)) {
      if (!validConcreteSourceBinding(item, fragments, artifact,
        pageNumber=>source.stages.length===1?source.stages[0]:source.review?.pageStages?.[String(pageNumber)]??"UNRESOLVED"))return null;
    } else if (projectZero) {
      if (!validProjectZeroSourceBinding(item, fragments, page)) return null;
    } else if (isTerritoryFenceHeight(item.attribute)) {
      if (!validFenceSourceBinding(item,fragments,page)) return null;
    } else if(item.contextFragments) {
      if(!validConcreteTableContext(item as MatrixExecution["observations"][number],artifact,
        pageNumber=>source.stages.length===1?source.stages[0]:source.review?.pageStages?.[String(pageNumber)]??"UNRESOLVED")
        &&!validSlabTableContext(item as MatrixExecution["observations"][number],artifact)
        &&!validSidewalkTileTableContext(item as MatrixExecution["observations"][number],artifact))return null;
    } else if (!(isStairDimension(item.attribute) ? validStairSourceBinding(item,fragments,page)
      : validLexicalBinding(item,fragments))) return null;
    observations.set(item.id, item);
  }
  // Only now, after ALL raw rows passed their source checks, require the
  // complete reserved family and deterministic final observation sequence.
  verifyConcreteWallObservationSetV13(value.observations, prepared);
  if (!same(value.observations, [...value.observations].sort(concreteWallObservationOrderV13))) return null;
  const rules = new Map(matrixRegistry.entries.flatMap((entry) => entry.atomicRules.map((rule) =>
    [rule.ruleId, { ...rule, parameterCode: entry.parameterCode }] as const)));
  const keys = new Set<string>();
  for (const result of value.results) {
    const rule = rules.get(result.ruleId);
    const key = canonicalJson([result.ruleId, result.entityKey, result.comparisonVariant]);
    if (!rule?.enabled || rule.version !== result.ruleVersion || rule.parameterCode !== result.parameterCode
      || keys.has(key)) return null;
    keys.add(key);
    const expected = result.expectedObservationId ? observations.get(result.expectedObservationId) : null;
    const actual = result.actualObservationId ? observations.get(result.actualObservationId) : null;
    if ((result.expectedObservationId && !expected) || (result.actualObservationId && !actual)) return null;
    for (const fact of [expected, actual]) if (fact && (fact.attribute !== rule.attribute
      || fact.unit !== rule.canonicalUnit)) return null;
    if (expected && result.expectedValue !== null && result.expectedValue !== expected.value) return null;
    if (actual && result.actualValue !== null && result.actualValue !== actual.value) return null;
  }
  const rebuilt = rebuildMatrixRuleResultsV13(value as MatrixExecution, rawInput);
  if (!same(value.results, rebuilt.results) || !same(value.coverage, rebuilt.coverage)) return null;
  return { schemaVersion:value.schemaVersion, objectId:value.objectId,inputManifestHash:value.inputManifestHash,
    registryHash:value.registryHash, observations:value.observations,metadata:value.metadata,
    results:rebuilt.results,coverage:rebuilt.coverage } as MatrixExecution;
}

function validProjectZeroSourceBinding(item: z.infer<typeof observation>, fragments: Record<string, unknown>[],
  page: Record<string, unknown>): boolean {
  if (canonicalJson(item.parameterCodes) !== '["PZ-009"]' || item.unit !== "m") return false;
  const candidates = extractProjectZeroCandidates(page, item.stage);
  if (candidates.length !== 1) return false;
  const candidate = candidates[0];
  const expectedPrimary = candidate.primaryFragments.map(part => ({ blockId: `${part.blockIndex}:${part.lineIndex}`,
    rawText: part.rawText, bbox: normalizedBox(part.bboxMilliPoints, page) }));
  const expectedContext = candidate.unitAuthorityFragments.map(part => ({ pageNumber: item.pageNumber,
    blockId: `${part.blockIndex}:${part.lineIndex}`, rawText: part.rawText,
    bbox: normalizedBox(part.bboxMilliPoints, page), role: "UNIT_DECLARATION" }));
  return item.value === candidate.value && item.rawValue === candidate.rawValue && item.rawUnit === candidate.rawUnit
    && canonicalJson(fragments) === canonicalJson(expectedPrimary)
    && (expectedContext.length ? canonicalJson(item.contextFragments) === canonicalJson(expectedContext)
      : item.contextFragments === undefined)
    && !["datumName", "referenceKind", "referenceText", "localZero", "projectZeroAuthority"].some(key => Object.hasOwn(item, key));
}

function validMetadata(metadata: Record<string,unknown>[], sources: MatrixVerificationSource[]) {
  if(metadata.length!==sources.length)return false;
  const seen=new Set<string>();
  const expressions:Record<string,RegExp>={
    documentCode:/^(?:Шифр|Обозначение|Код документа)\s*[:=]?\s*(\S.{2,79})$/iu,
    revision:/^(?:Изм\.?|Ревизия|Редакция)\s*[:=]?\s*([A-ZА-Я0-9.-]{1,16})$/iu,
    date:/^(?:Дата\s*[:=]?\s*)?([0-3]\d\.[01]\d\.(?:19|20)\d{2})$/u,
    stage:/^Стадия\s*[:=]?\s*(ПД|РД|ИД|П|Р)$/iu,
    floor:/^Этаж\s*[:=]?\s*(-?\d{1,3})$/iu,
    section:/^Раздел\s*[:=]?\s*(ПЗ|СПЗУ|АР|КР|КЖ|КМ|ОВ|ВК|ЭОМ|ППМ|ЗУ|ОДИ)$/iu,
  };
  for(const meta of metadata){
    const source=sources.find(s=>s.sourceFileId===meta.sourceFileId);
    if(!source||seen.has(source.sourceFileId)||meta.sourceSha256!==source.sha256
      ||meta.stage!==(source.stages.length===1?source.stages[0]:"UNRESOLVED")
      ||meta.sectionCode!==(source.review?.sectionCode??null)
      ||meta.revisionStatus!==(source.review?.revisionStatus??"UNKNOWN")
      ||meta.approvalStatus!==(source.review?.approvalStatus??"UNKNOWN")
      ||meta.linkGroupId!==(source.review?.linkGroupId??null)
      ||meta.pageCount!==(source.textArtifact?.pageCount??0)
      ||canonicalJson(meta.reasonCodes)!==canonicalJson(source.textArtifact?[]:["TEXT_ARTIFACT_MISSING"])
      ||!Array.isArray(meta.stampCandidates))return false;
    seen.add(source.sourceFileId);
    const stamps=new Set<string>();
    for(const stamp of meta.stampCandidates){
      if(!record(stamp)||typeof stamp.field!=="string"||typeof stamp.blockId!=="string"
        ||!/^\d+:\d+$/u.test(stamp.blockId)||typeof stamp.rawText!=="string")return false;
      const pages=source.textArtifact?.pages;
      const page=Array.isArray(pages)?pages.find((p:unknown)=>record(p)&&p.pageNumber===stamp.pageNumber):null;
      if(!record(page)||!Array.isArray(page.blocks))return false;
      const [blockIndex,lineIndex]=stamp.blockId.split(":").map(Number);const block=page.blocks[blockIndex];
      if(!record(block)||typeof block.text!=="string"||block.text.split(/\r?\n/u)[lineIndex]?.trim()!==stamp.rawText.trim())return false;
      const sourceBox=Array.isArray(block.lineBboxesMilliPoints)?block.lineBboxesMilliPoints[lineIndex]:block.bboxMilliPoints;
      const found=expressions[stamp.field]?.exec(stamp.rawText.replace(/\s+/gu," ").trim());
      const key=canonicalJson([stamp.pageNumber,stamp.blockId,stamp.field]);
      if(!found||found[1]!==stamp.value||stamps.has(key)||!Array.isArray(sourceBox)||!sameBox(stamp.bbox,normalizedBox(sourceBox,page)))return false;
      stamps.add(key);
    }
  }
  return true;
}

function normalizedBox(b: number[], page: Record<string, unknown>) {
  const width=Number(page.widthMilliPoints),height=Number(page.heightMilliPoints);
  return {x:b[0]/width,y:1-b[3]/height,width:(b[2]-b[0])/width,height:(b[3]-b[1])/height};
}
function sameBox(a: unknown,b: {x:number;y:number;width:number;height:number}) {
  return record(a)&&["x","y","width","height"].every(key=>typeof a[key]==="number"
    && Number.isFinite(b[key as keyof typeof b]) && Math.abs(Number(a[key])-b[key as keyof typeof b])<1e-9);
}
const clean=(s:string)=>s.replace(/\s+/gu," ").trim();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
function validLexicalBinding(item: z.infer<typeof observation>,fragments: Record<string,unknown>[]) {
  if (!Array.isArray(item.parameterCodes)||!item.parameterCodes.length) return false;
  return item.parameterCodes.every(code=>{
    const entry=matrixRegistry.entries.find(e=>e.parameterCode===code);
    return entry?.atomicRules.some(rule=>{
      if(rule.attribute!==item.attribute||rule.canonicalUnit!==item.unit)return false;
      if(["SIDEWALK_TILE_AREA","EVACUATION_CORRIDOR_CLEAR_HEIGHT","EVACUATION_DOOR_CLEAR_HEIGHT"].includes(rule.attribute)
        &&fragments.length!==1)return false;
      const labels=rule.labels as string[], allowed=rule.allowedValues as string[];
      const text=clean(item.rawText),raw=clean(String(item.rawValue));
      if(rule.prosePolicy==="FIRE_CLASS_SENTENCE_V1" && fragments.length===1
        && /^(?:Здание|Комплекс|Объект)\s+запроектирован(?:о|а|ы)?\s+/iu.test(text)) {
        const pattern=rule.attribute==="FIRE_RESISTANCE_DEGREE"
          ? /(?:^|[^\p{L}\p{N}_])(I|II|III|IV|V)\s+степени\s+огнестойкости/gu
          : /(?:^|[^\p{L}\p{N}_])([CС][0-3])\s+класса\s+конструктивной\s+пожарной\s+опасности/gu;
        const matches=[...text.matchAll(pattern)];return matches.length===1&&matches[0][1]===raw;
      }
      if(rule.valueKind==="CATEGORY"&&!allowed.includes(raw))return false;
      if(rule.valueKind==="CONCRETE_CLASS"&&!/^[BВ]\d+(?:[.,]\d+)?$/u.test(raw))return false;
      if(item.stage==="RD"&&fragments.length===1&&rule.attribute==="CONCRETE_CLASS"&&rule.valueKind==="CONCRETE_CLASS") {
        const concrete=/^Класс бетона по прочности на сжатие\s+([BВ]\d+(?:[.,]\d+)?)(?:,\s*марка по морозостойкости\s+F\d+)?(?:,\s*марка по водонепроницаемости\s+W\d+)?\.?$/iu.exec(text);
        if(concrete&&concrete[1]===raw)return true;
      }
      if(item.stage==="RD"&&fragments.length===1&&rule.attribute==="SLAB_THICKNESS"&&rule.valueKind==="DECIMAL") {
        const slab=/^Толщина ж\/б плиты перекрытия подземного этажа - ([0-9]+(?:[.,][0-9]+)?)\s*(мм|mm|см|cm|м|m), ж\/б капители толщиной - ([0-9]+(?:[.,][0-9]+)?)\s*(мм|mm|см|cm|м|m)\.?$/iu.exec(text);
        if(slab&&slab[1]===raw&&slab[2]===item.rawUnit&&(rule.unitAliases as string[]).includes(slab[2])
          &&(rule.unitAliases as string[]).includes(slab[4]))return true;
      }
      if(rule.subruleContext && !(rule.unitAliases as string[]).includes(clean(String(item.rawUnit))))return false;
      // The normalized unit must have been verified separately. Labels bind the value's attribute.
      const unit=escape(String(item.rawUnit)).replace(/[²³]/gu,s=>`\\s*${s}`);
      const tail=rule.valueKind==="CATEGORY"||rule.valueKind==="CONCRETE_CLASS"
        ? escape(raw)+"\\s*[.;]?\\s*$"
        : `(?:${escape(raw)}\\s*(?:\\|\\s*)?${unit}|${unit}\\s*(?:\\|\\s*|[:,;]\\s*|\\s+)${escape(raw)})\\s*[.;]?\\s*$`;
      for(const label of labels) {
        const match=new RegExp("^\\s*"+escape(label)+"\\s*(?:[:,;=|—–-]\\s*|\\s+)","iu").exec(text);
        if(match&&new RegExp("^"+tail,"u").test(text.slice(match[0].length)))return true;
        // Explicit column-unit headers remain unqualified table candidates.
        if(fragments.length===3 && clean(String(fragments[0].rawText)).replace(/[:,;]$/u,"").toLocaleLowerCase()===clean(label).toLocaleLowerCase()
          && clean(String(fragments[1].rawText))===raw && Array.isArray(item.sourceFlags)
          && item.sourceFlags.includes("TABLE_HEADER_UNIT_SCOPE_UNVERIFIED")
          && new RegExp("^(?:В гр\\. ГПЗУ|Значение|Показатель|Площадь)\\s*[,;:]?\\s*"+unit+"$","u").test(clean(String(fragments[2].rawText))))return true;
      }
      return false;
    })??false;
  });
}

