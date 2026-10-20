/** Typed inventory execution; input must originate from authenticated immutable repository projection. */
import { isProxy } from 'node:util/types';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { matrixInventoryScopeDecisionSchema, sourceSectionCodes, type MatrixCoverage } from '@inspector-ai/contracts';
import { compareAr053Inventories, type ComparisonResult } from './matrix-ar053-inventory-comparison.js';
import { reconstructAr053InventorySource, inventoryContentHash } from './matrix-inventory-source.js';
import { canonicalSourceDeclarationJson, extractSourceDeclarations } from './matrix-source-declarations.js';
const canonical = canonicalSourceDeclarationJson;
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const LIMIT={depth:64,nodes:200000,bytes:8000000,points:2000000,items:32768};
const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const key=(max:number)=>z.string().refine(s=>pyTrim(s)===s&&!!s&&[...s].length<=max&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s));
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const identityFields={entityKey:key(200),componentRole:z.literal('PARTITION_SLAB_JOINT'),componentKey:key(200),zoneKey:key(200),operatingModeKey:z.literal('DECLARED_NOISE_PROTECTION_MEASURES'),measurementBasisKey:z.literal('SOURCE_AUTHORED_MEASURE_MEMBERSHIP')};
const identitySchema=z.object(identityFields).strict();
const stages=['PD','RD','ID','UNRESOLVED'] as const;
const reviewSchema=z.object({decisionId:key(200),contentHash:sha,objectId:key(200),sourceFileId:key(200),sourceSha256:sha,actorId:key(200),revisionStatus:z.enum(['CURRENT','SUPERSEDED','UNKNOWN']),approvalStatus:z.enum(['APPROVED','UNAPPROVED','UNKNOWN']),sectionCode:z.enum(sourceSectionCodes).nullable(),linkGroupId:key(120).nullable(),pageStages:z.record(z.string(),z.enum(stages)),inventoryScope:matrixInventoryScopeDecisionSchema.nullable()}).strict();
const sourceSchema=z.object({sourceFileId:key(200),sourceSha256:sha,stages:z.array(z.enum(stages)).max(4).refine(s=>new Set(s).size===s.length),reviewSnapshot:z.object({decisionId:key(200),contentHash:sha}).strict().nullable(),review:reviewSchema.nullable()}).strict().refine(s=>(s.review===null)===(s.reviewSnapshot===null));
const originSchema=z.object({checkId:key(120),objectId:key(200),sourceFileId:key(200),sourceSha256:sha,inputManifestHash:sha,textStageContentHash:sha,textArtifactHash:sha,textArtifact:z.custom<Record<string,unknown>>(v=>!!v&&typeof v==='object'&&!Array.isArray(v))}).strict();
const packageSchema=z.object({schemaVersion:z.literal('matrix-ar053-loader-inputs-v1'),objectId:key(200),inputManifestHash:sha,sources:z.array(sourceSchema).max(64),origins:z.array(originSchema).max(128),identities:z.array(identitySchema).max(128)}).strict();
export type InventoryIdentity=z.infer<typeof identitySchema>;
export type InventoryLoaderPackage=z.infer<typeof packageSchema>;
export const INVENTORY_CAPABILITY={parameterCode:'AR-053',matrixCode:'M-053',ruleId:'matrix-ar-053-declared_joint_damping_tape_omission',ruleVersion:'1',enabled:true,comparisonVariant:'PD_RD',family:'PRESENCE_SET',executionKind:'REVIEWED_DECLARED_REGION_INVENTORY',resultSchemaVersion:'matrix-ar053-inventory-comparison-v1',partialGap:'PARTIAL_SUBRULES_ONLY:REVIEWED_DECLARED_JOINT_DAMPING_TAPE_MEMBERSHIP_ONLY;GLOBAL_OR_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED'} as const;
export const INVENTORY_CAPABILITY_REGISTRY={schemaVersion:'matrix-inventory-capabilities-v1',entries:[INVENTORY_CAPABILITY]} as const;
export const inventoryCapabilityRegistryHash=hash(INVENTORY_CAPABILITY_REGISTRY);
type ResultBody={schemaVersion:'matrix-inventory-execution-result-v1';ruleId:typeof INVENTORY_CAPABILITY.ruleId;ruleVersion:'1';parameterCode:'AR-053';comparisonVariant:'PD_RD'} & ({kind:'SCOPED_COMPARISON';identity:InventoryIdentity;comparison:ComparisonResult}|{kind:'UNBOUND_ATOM_ABSTENTION';reasonCode:'REVIEWED_INVENTORY_IDENTITY_MISSING';calibratedProbability:null});
export type InventoryExecutionResult=ResultBody & {id:string};
export interface InventoryComparisons {schemaVersion:'matrix-inventory-comparisons-v1';purpose:'MACHINE_COMPARISON';objectId:string;inputManifestHash:string;capabilityRegistryHash:string;results:InventoryExecutionResult[]}
const LEGITIMATE_ABSTENTIONS=['SOURCE_STAGE_UNVERIFIED','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED','NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED'] as const;
const referenceSchema=z.object({sourceFileId:key(200),sourceSha256:sha,reviewDecisionId:key(200),reviewContentHash:sha,inventoryContentHash:sha}).strict();
const comparisonSchema=z.discriminatedUnion('status',[
 z.object({schemaVersion:z.literal('matrix-ar053-inventory-comparison-v1'),status:z.literal('ABSTAIN'),reasonCode:z.enum(LEGITIMATE_ABSTENTIONS),calibratedProbability:z.null()}).strict(),
 z.object({schemaVersion:z.literal('matrix-ar053-inventory-comparison-v1'),status:z.literal('CANDIDATE'),ruleId:z.literal(INVENTORY_CAPABILITY.ruleId),ruleVersion:z.literal('1'),parameterCode:z.literal('AR-053'),reasonCode:z.literal('DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION'),calibratedProbability:z.null(),comparisonScope:z.literal('REVIEWED_DECLARED_REGIONS_ONLY'),identity:identitySchema,expected:referenceSchema,actual:referenceSchema,missingFeatureKeys:z.tuple([z.literal('DAMPING_TAPE')])}).strict()]);
const commonRowSchema={schemaVersion:z.literal('matrix-inventory-execution-result-v1'),id:sha,ruleId:z.literal(INVENTORY_CAPABILITY.ruleId),ruleVersion:z.literal('1'),parameterCode:z.literal('AR-053'),comparisonVariant:z.literal('PD_RD')};
const typedRowSchema=z.discriminatedUnion('kind',[
 z.object({...commonRowSchema,kind:z.literal('SCOPED_COMPARISON'),identity:identitySchema,comparison:comparisonSchema}).strict(),
 z.object({...commonRowSchema,kind:z.literal('UNBOUND_ATOM_ABSTENTION'),reasonCode:z.literal('REVIEWED_INVENTORY_IDENTITY_MISSING'),calibratedProbability:z.null()}).strict()]);
const envelopeSchema=z.object({schemaVersion:z.literal('matrix-inventory-comparisons-v1'),purpose:z.literal('MACHINE_COMPARISON'),objectId:key(200),inputManifestHash:sha,capabilityRegistryHash:sha,results:z.array(typedRowSchema).min(1).max(128)}).strict();
function fail(message:string):never {throw new Error('Inventory execution integrity: '+message);}

function native(input:unknown):"VALID"|"INVALID"|"LIMIT" {
  let nodes=0,bytes=0,limited=false;const parents=new Set<object>();const limit=()=>{limited=true;return false;};
  function visit(v:unknown,depth:number):boolean {
    if(++nodes>LIMIT.nodes||depth>LIMIT.depth)return limit();
    if(v===null||typeof v==="boolean")return true;
    if(typeof v==="number")return Number.isSafeInteger(v);
    if(typeof v==="string"){
      if(v.length>LIMIT.bytes)return limit();if(v.length>LIMIT.points){let points=0;for(const _ of v)if(++points>LIMIT.points)return limit();}
      if(!scalar(v))return false;bytes+=Buffer.byteLength(v,"utf8");return bytes>LIMIT.bytes?limit():true;
    }
    if(!v||typeof v!=="object"||isProxy(v)||parents.has(v))return false;
    const array=Array.isArray(v);if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))return false;
    const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);if(names.some(k=>typeof k!=="string"))return false;
    let keys:string[];
    if(array){const length=descriptors.length?.value;if(!Number.isSafeInteger(length)||length<0)return false;if(length>LIMIT.items)return limit();if(names.length!==length+1)return false;keys=Array.from({length},(_,i)=>String(i));}
    else{if(names.length>LIMIT.items)return limit();keys=names as string[];}
    parents.add(v);for(const k of keys){const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,"value")||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)){parents.delete(v);return false;}}
    parents.delete(v);return true;
  }
  try{return visit(input,0)?"VALID":limited?"LIMIT":"INVALID";}catch{return "INVALID";}
}

/** Unicode codepoint comparison, including astral values; JS default sort uses UTF16 units. */
function portableOrder(a:string,b:string):number {const left=[...a],right=[...b];for(let i=0;i<Math.min(left.length,right.length);i++){const d=left[i]!.codePointAt(0)!-right[i]!.codePointAt(0)!;if(d)return d;}return left.length-right.length;}
export function deriveInventoryIdentities(sources:InventoryLoaderPackage['sources']):InventoryIdentity[] {
  const unique=new Map<string,InventoryIdentity>();
  for(const source of sources)for(const claim of source.review?.inventoryScope?.claims??[]){
    const identity=identitySchema.parse(Object.fromEntries(Object.keys(identityFields).map(k=>[k,claim[k as keyof typeof identityFields]])));
    unique.set(canonical(identity),identity);
  }
  if(unique.size>128)fail('identity limit');
  return [...unique.keys()].sort(portableOrder).map(k=>unique.get(k)!);
}
/** Strict whole-package integrity before any eligible-pair/ambiguity gate, including no-identity runs. */
export function validateInventoryLoaderPackage(raw:unknown):InventoryLoaderPackage {
  const guarded=native(raw);if(guarded!=='VALID')fail(guarded==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
    const data=raw as Record<string,unknown>;
    if(Array.isArray(data.sources))for(const item of data.sources){
      if(item&&typeof item==='object'&&!Array.isArray(item)){
        const review=(item as Record<string,unknown>).review;
        if(review&&typeof review==='object'&&!Array.isArray(review)){
          const pages=(review as Record<string,unknown>).pageStages;
          if(pages&&typeof pages==='object'&&!Array.isArray(pages)&&Object.keys(pages).some(k=>!/^[1-9][0-9]{0,15}(?![\s\S])/u.test(k)||!Number.isSafeInteger(Number(k))))fail('invalid original pageStage key');
        }
      }
    }
  }
  const decoded=packageSchema.safeParse(raw);if(!decoded.success)fail('INVALID_INPUT');const value=decoded.data;
  const count=value.sources.reduce((n,s)=>n+(s.review?.inventoryScope?.claims.length??0),0);if(count>128)fail('claim limit');
  const sourceMap=new Map(value.sources.map(s=>[s.sourceFileId,s]));
  const originKey=(sourceId:string,checkId:string)=>canonical([sourceId,checkId]);
  const originMap=new Map(value.origins.map(o=>[originKey(o.sourceFileId,o.checkId),o]));
  if(sourceMap.size!==value.sources.length||originMap.size!==value.origins.length)fail('duplicate source/origin');
  for(const origin of value.origins){
    const source=sourceMap.get(origin.sourceFileId);
    if(!source||origin.objectId!==value.objectId||origin.sourceSha256!==source.sourceSha256)fail('origin association');
    const artifact=origin.textArtifact;
    if(artifact.sourceFileId!==origin.sourceFileId||artifact.inputSha256!==origin.sourceSha256)fail('artifact source association');
    try{extractSourceDeclarations({objectId:value.objectId,inputManifestHash:origin.inputManifestHash,sources:[{sourceFileId:origin.sourceFileId,sha256:origin.sourceSha256,stages:[]}],textArtifacts:[artifact]});}catch{fail('invalid full origin text artifact');}
    if(hash({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact})!==origin.textArtifactHash)fail('full origin artifact hash');
  }
  for(const source of value.sources){const review=source.review;if(!review)continue;
    if(review.objectId!==value.objectId||review.sourceFileId!==source.sourceFileId||review.sourceSha256!==source.sourceSha256||review.decisionId!==source.reviewSnapshot!.decisionId||review.contentHash!==source.reviewSnapshot!.contentHash)fail('review snapshot association');
    for(const claim of review.inventoryScope?.claims??[]){
      const origin=originMap.get(originKey(source.sourceFileId,claim.target.checkId));
      if(!origin||origin.inputManifestHash!==claim.target.inputManifestHash||origin.textStageContentHash!==claim.target.textStageContentHash||origin.textArtifactHash!==claim.target.textArtifactHash)fail('claim origin association');
      const rebuilt=reconstructAr053InventorySource({sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,stage:claim.inventorySnapshot.stage,pageStages:{},textArtifact:origin.textArtifact,selection:claim.selection});
      if(rebuilt.status!=='RECONSTRUCTED'||inventoryContentHash(rebuilt.inventory)!==claim.target.inventoryContentHash||rebuilt.inventory.textArtifactHash!==origin.textArtifactHash||canonical(rebuilt.inventory)!==canonical(claim.inventorySnapshot))fail('claim reconstruction');
    }
  }
  const derived=deriveInventoryIdentities(value.sources);
  if(canonical(derived)!==canonical(value.identities))fail('identities differ from whole frozen source enumeration');
  return value;
}
function validateRegistry(registry:unknown):void {
  if(native(registry)!=='VALID'||canonical(registry)!==canonical(INVENTORY_CAPABILITY_REGISTRY))fail('unsupported capability registry');
}
export function buildInventoryComparisons(raw:unknown,registry:unknown=INVENTORY_CAPABILITY_REGISTRY):InventoryComparisons {
  validateRegistry(registry);const input=validateInventoryLoaderPackage(raw);
  const common={schemaVersion:'matrix-inventory-execution-result-v1',ruleId:INVENTORY_CAPABILITY.ruleId,ruleVersion:'1',parameterCode:'AR-053',comparisonVariant:'PD_RD'} as const;
  const bodies:ResultBody[]=input.identities.length?input.identities.map(identity=>{
    const comparison=compareAr053Inventories({schemaVersion:'matrix-ar053-inventory-input-v1',objectId:input.objectId,inputManifestHash:input.inputManifestHash,identity,sources:input.sources,origins:input.origins});
    if(comparison.status==='ABSTAIN'&&!(LEGITIMATE_ABSTENTIONS as readonly string[]).includes(comparison.reasonCode))fail(comparison.reasonCode);
    return {...common,kind:'SCOPED_COMPARISON',identity,comparison};
  }):[{...common,kind:'UNBOUND_ATOM_ABSTENTION',reasonCode:'REVIEWED_INVENTORY_IDENTITY_MISSING',calibratedProbability:null}];
  const envelope:InventoryComparisons={schemaVersion:'matrix-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:input.objectId,inputManifestHash:input.inputManifestHash,capabilityRegistryHash:inventoryCapabilityRegistryHash,
    results:bodies.map(body=>({...body,id:hash({hashDomain:'matrix-inventory-execution-result-id-v1',objectId:input.objectId,inputManifestHash:input.inputManifestHash,capabilityRegistryHash:inventoryCapabilityRegistryHash,result:body})}))};
  return validateInventoryComparisonsEnvelope(envelope);
}
/** Shape/hash validation alone never substitutes for reconstruction from authenticated inputs. */
export function validateInventoryComparisonsEnvelope(raw:unknown):InventoryComparisons {
  if(native(raw)!=='VALID')fail('nonportable typed result envelope');
  const decoded=envelopeSchema.safeParse(raw);if(!decoded.success)fail('invalid typed result wire');const envelope=decoded.data;
  if(envelope.capabilityRegistryHash!==inventoryCapabilityRegistryHash)fail('inventory capability hash');
  const identities:string[]=[];
  for(const row of envelope.results){
    const {id,...body}=row;
    if(id!==hash({hashDomain:'matrix-inventory-execution-result-id-v1',objectId:envelope.objectId,inputManifestHash:envelope.inputManifestHash,capabilityRegistryHash:envelope.capabilityRegistryHash,result:body}))fail('typed result hash');
    if(row.kind==='UNBOUND_ATOM_ABSTENTION'){if(envelope.results.length!==1)fail('unbound row mixed with scopes');}
    else{
      identities.push(canonical(row.identity));
      if(row.comparison.status==='CANDIDATE'&&(canonical(row.comparison.identity)!==canonical(row.identity)||row.comparison.expected.sourceFileId===row.comparison.actual.sourceFileId))fail('candidate scope/source association');
    }
  }
  if(canonical(identities)!==canonical([...new Set(identities)].sort(portableOrder)))fail('duplicate or unsorted result identities');
  return envelope;
}
const coverageRow=z.object({parameterCode:key(200),implementedAtomicRules:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),enabledAtomicRules:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),evaluatedAtomicRules:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),successfulComparisons:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),abstentions:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),failures:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),executionStatus:z.enum(['UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE']),reason:z.string()}).strict();
const catalog=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json',import.meta.url),'utf8')).entries as Array<{parameterCode:string;atomicRules:Array<{ruleId:string}>}>;
/** Merge only already independently verified execution outputs. Other131 coverage rows are preserved. */
export function mergeInventoryCoverage(raw:unknown,envelope:InventoryComparisons,registry:unknown=INVENTORY_CAPABILITY_REGISTRY):MatrixCoverage[] {
  validateRegistry(registry);envelope=validateInventoryComparisonsEnvelope(envelope);if(native(raw)!=='VALID')fail('nonportable coverage');
  const decoded=z.array(coverageRow).length(132).safeParse(raw);if(!decoded.success)fail('invalid base coverage');
  const rows=decoded.data;
  if(rows.some((row,i)=>row.parameterCode!==catalog[i]?.parameterCode))fail('base coverage catalog order');
  const base=rows.find(r=>r.parameterCode==='AR-053');
  if(!base||base.executionStatus!=='UNSUPPORTED'||[base.implementedAtomicRules,base.enabledAtomicRules,base.evaluatedAtomicRules,base.successfulComparisons,base.abstentions,base.failures].some(n=>n!==0)||catalog.some(p=>p.atomicRules.some(a=>a.ruleId===INVENTORY_CAPABILITY.ruleId)))fail('capability overlaps scalar registry');
  if(envelope.schemaVersion!=='matrix-inventory-comparisons-v1'||envelope.purpose!=='MACHINE_COMPARISON'||envelope.capabilityRegistryHash!==inventoryCapabilityRegistryHash||!envelope.results.length||envelope.results.length>128)fail('invalid inventory coverage envelope');
  let successful=0;
  for(const row of envelope.results){const {id,...body}=row;
    if(id!==hash({hashDomain:'matrix-inventory-execution-result-id-v1',objectId:envelope.objectId,inputManifestHash:envelope.inputManifestHash,capabilityRegistryHash:envelope.capabilityRegistryHash,result:body})||row.parameterCode!=='AR-053'||row.ruleId!==INVENTORY_CAPABILITY.ruleId||row.ruleVersion!=='1'||row.comparisonVariant!=='PD_RD')fail('invalid typed result binding');
    if(row.kind==='SCOPED_COMPARISON'&&row.comparison.status==='CANDIDATE')successful++;
  }
  return rows.map(row=>row.parameterCode!=='AR-053'?{...row}:{...row,implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:successful,abstentions:envelope.results.length-successful,failures:0,executionStatus:'PARTIAL',reason:INVENTORY_CAPABILITY.partialGap});
}
