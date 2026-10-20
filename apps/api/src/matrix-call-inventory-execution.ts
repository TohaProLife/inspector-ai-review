/** Separate ODI123 typed execution. Metadata must come from the protected loader. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {matrixCallRoomIdentitySchema, matrixCallInventoryScopeDecisionSchema,
  sourceSectionCodes, type MatrixCoverage} from '@inspector-ai/contracts';
import {compareOdi123CallInventories} from './matrix-odi123-call-inventory-comparison.js';
import {reconstructOdi123CallInventorySource,callInventoryContentHash} from './matrix-call-inventory-source.js';
import {parseCallInventoryScopeDecision} from './matrix-call-inventory-review.js';
import {canonicalSourceDeclarationJson as canonical,extractSourceDeclarations} from './matrix-source-declarations.js';

const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const key=(max:number)=>z.string().refine(s=>!!s&&pyTrim(s)===s&&[...s].length<=max&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s));
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const stages=['PD','RD','ID','UNRESOLVED'] as const;
const pageStages=z.custom<Record<string,typeof stages[number]>>(v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).every(k=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(k)&&Number.isSafeInteger(Number(k))&&(stages as readonly unknown[]).includes((v as Record<string,unknown>)[k])));
const identity=matrixCallRoomIdentitySchema;
const review=z.object({decisionId:key(200),contentHash:sha,objectId:key(200),sourceFileId:key(200),sourceSha256:sha,
 actorId:key(200),revisionStatus:z.enum(['CURRENT','SUPERSEDED','UNKNOWN']),approvalStatus:z.enum(['APPROVED','UNAPPROVED','UNKNOWN']),
 sectionCode:z.enum(sourceSectionCodes).nullable(),linkGroupId:key(120).nullable(),pageStages,
 callInventoryScope:matrixCallInventoryScopeDecisionSchema.nullable()}).strict();
const source=z.object({sourceFileId:key(200),sourceSha256:sha,stages:z.array(z.enum(stages)).max(4).refine(a=>new Set(a).size===a.length),
 reviewSnapshot:z.object({decisionId:key(200),contentHash:sha}).strict().nullable(),review:review.nullable()}).strict()
 .refine(s=>(s.review===null)===(s.reviewSnapshot===null));
const origin=z.object({checkId:key(120),objectId:key(200),sourceFileId:key(200),sourceSha256:sha,inputManifestHash:sha,
 textStageContentHash:sha,textArtifactHash:sha,textArtifact:z.custom<Record<string,unknown>>(v=>!!v&&typeof v==='object'&&!Array.isArray(v))}).strict();
const loader=z.object({schemaVersion:z.literal('matrix-odi123-call-loader-inputs-v1'),objectId:key(200),inputManifestHash:sha,
 sources:z.array(source).max(64),origins:z.array(origin).max(128),identities:z.array(identity).max(128)}).strict();
export type CallInventoryLoaderPackage=z.infer<typeof loader>;
export type CallInventoryIdentity=z.infer<typeof identity>;
export const CALL_INVENTORY_CAPABILITY={parameterCode:'ODI-123',matrixCode:'M-123',
 ruleId:'matrix-odi-123-declared_sanitary_room_personnel_call_button_omission',ruleVersion:'1',enabled:true,comparisonVariant:'PD_RD',
 family:'PRESENCE_SET',executionKind:'REVIEWED_NAMED_ROOM_CALL_INVENTORY',resultSchemaVersion:'matrix-odi123-call-inventory-comparison-v1',
 partialGap:'PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_ACCESSIBLE_ROOM_PERSONNEL_CALL_BUTTON_MEMBERSHIP_ONLY;ENTRANCES_OTHER_ROOMS_GLOBAL_PHYSICAL_ABSENCE_FUNCTIONALITY_AND_SUBSTITUTION_UNSUPPORTED'} as const;
export const CALL_INVENTORY_CAPABILITY_REGISTRY={schemaVersion:'matrix-call-inventory-capabilities-v1',entries:[CALL_INVENTORY_CAPABILITY]} as const;
export const callInventoryCapabilityRegistryHash=digest(CALL_INVENTORY_CAPABILITY_REGISTRY);
const legitimate=['ROOM_IDENTITY_CONFLICT','SOURCE_STAGE_UNVERIFIED','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED',
 'SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','ROOM_MAPPING_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED',
 'NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED'] as const;
const reference=z.object({sourceFileId:key(200),sourceSha256:sha,reviewDecisionId:key(200),reviewContentHash:sha,inventoryContentHash:sha}).strict();
const comparison=z.discriminatedUnion('status',[
 z.object({schemaVersion:z.literal('matrix-odi123-call-inventory-comparison-v1'),status:z.literal('ABSTAIN'),reasonCode:z.enum(legitimate),calibratedProbability:z.null()}).strict(),
 z.object({schemaVersion:z.literal('matrix-odi123-call-inventory-comparison-v1'),status:z.literal('CANDIDATE'),ruleId:z.literal(CALL_INVENTORY_CAPABILITY.ruleId),ruleVersion:z.literal('1'),parameterCode:z.literal('ODI-123'),
  reasonCode:z.literal('PERSONNEL_CALL_BUTTON_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY'),calibratedProbability:z.null(),comparisonScope:z.literal('REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY'),
  identity,expected:reference,actual:reference,missingFeatureKeys:z.tuple([z.literal('PERSONNEL_CALL_BUTTON')])}).strict()]);
const common={schemaVersion:z.literal('matrix-call-inventory-execution-result-v1'),id:sha,ruleId:z.literal(CALL_INVENTORY_CAPABILITY.ruleId),ruleVersion:z.literal('1'),parameterCode:z.literal('ODI-123'),comparisonVariant:z.literal('PD_RD')};
const result=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('SCOPED_COMPARISON'),identity,comparison}).strict(),
 z.object({...common,kind:z.literal('UNBOUND_ATOM_ABSTENTION'),reasonCode:z.literal('REVIEWED_CALL_INVENTORY_IDENTITY_MISSING'),calibratedProbability:z.null()}).strict()]);
const envelopeSchema=z.object({schemaVersion:z.literal('matrix-call-inventory-comparisons-v1'),purpose:z.literal('MACHINE_COMPARISON'),objectId:key(200),inputManifestHash:sha,
 capabilityRegistryHash:sha,results:z.array(result).min(1).max(128)}).strict();
export type CallInventoryComparisons=z.infer<typeof envelopeSchema>;
export type CallInventoryExecutionResult=CallInventoryComparisons['results'][number];
function fail(reason:string):never {throw new Error('Call inventory execution integrity: '+reason);}

/** Portable budget, counted before traversal, schema parsing, hashing or user code. */
function native(raw:unknown):void {
 let nodes=0,bytes=0;const parents=new Set<object>();
 const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)fail('INVALID_INPUT');}};
 function visit(v:unknown,depth:number):void {
  if(++nodes>200000||depth>64)fail('INPUT_LIMIT');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('INVALID_INPUT');return;}
  if(typeof v==='string'){
   if(v.length>8000000)fail('INPUT_LIMIT');let points=0;for(const _ of v)if(++points>2000000)fail('INPUT_LIMIT');
   scalar(v);bytes+=Buffer.byteLength(v);if(bytes>8000000)fail('INPUT_LIMIT');return;
  }
  if(!v||typeof v!=='object'||isProxy(v)||parents.has(v))fail('INVALID_INPUT');
  const array=Array.isArray(v);if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))fail('INVALID_INPUT');
  const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);
  if(names.some(n=>typeof n!=='string'))fail('INVALID_INPUT');let keys:string[];
  if(array){const length=descriptors.length?.value;if(!Number.isSafeInteger(length)||length<0)fail('INVALID_INPUT');if(length>32768)fail('INPUT_LIMIT');
   if(names.length!==length+1)fail('INVALID_INPUT');keys=Array.from({length},(_,i)=>String(i));}
  else {if(names.length>32768)fail('INPUT_LIMIT');keys=names as string[];}
  parents.add(v);for(const k of keys){const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_INPUT');if(!array)visit(k,depth+1);visit(d.value,depth+1);}parents.delete(v);
 }
 visit(raw,0);
}
const order=(a:string,b:string)=>{const x=[...a],y=[...b];for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i]!.codePointAt(0)!-y[i]!.codePointAt(0)!;if(d)return d;}return x.length-y.length;};
function validateRegistry(raw:unknown):void {native(raw);if(canonical(raw)!==canonical(CALL_INVENTORY_CAPABILITY_REGISTRY))fail('unsupported capability registry');}
export function deriveCallInventoryIdentities(sources:CallInventoryLoaderPackage['sources']):CallInventoryIdentity[] {
 native(sources);const parsed=z.array(source).max(64).safeParse(sources);if(!parsed.success)fail('INVALID_INPUT');
 if(parsed.data.reduce((n,s)=>n+(s.review?.callInventoryScope?.claims.length??0),0)>128)fail('INPUT_LIMIT');
 const values=new Map<string,CallInventoryIdentity>();
 for(const s of parsed.data){const claims=s.review?.callInventoryScope?.claims??[];if(new Set(claims.map(c=>c.target.inventoryContentHash)).size!==claims.length)fail('duplicate review inventory');for(const c of claims){const value=identity.parse(c.identity);values.set(canonical(value),value);}}
 if(values.size>128)fail('INPUT_LIMIT');return [...values.keys()].sort(order).map(k=>values.get(k)!);
}
/** ALL supplied records, including no-identity runs and unrelated/UNKNOWN claims. */
export function validateCallInventoryLoaderPackage(raw:unknown):CallInventoryLoaderPackage {
 native(raw);const parsed=loader.safeParse(raw);if(!parsed.success)fail('INVALID_INPUT');const value=parsed.data;
 if(value.sources.reduce((n,s)=>n+(s.review?.callInventoryScope?.claims.length??0),0)>128)fail('INPUT_LIMIT');
 const sources=new Map(value.sources.map(s=>[s.sourceFileId,s]));
 const originKey=(sid:string,check:string)=>canonical([sid,check]);
 const origins=new Map(value.origins.map(o=>[originKey(o.sourceFileId,o.checkId),o]));
 if(sources.size!==value.sources.length||origins.size!==value.origins.length)fail('duplicate source/origin');
 for(const o of value.origins){
  const s=sources.get(o.sourceFileId);if(!s||o.objectId!==value.objectId||o.sourceSha256!==s.sourceSha256)fail('origin association');
  if(o.textArtifact.sourceFileId!==o.sourceFileId||o.textArtifact.inputSha256!==o.sourceSha256)fail('artifact source association');
  try{extractSourceDeclarations({objectId:value.objectId,inputManifestHash:o.inputManifestHash,sources:[{sourceFileId:o.sourceFileId,sha256:o.sourceSha256,stages:[]}],textArtifacts:[o.textArtifact]});}catch{fail('invalid full origin text artifact');}
  if(digest({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:o.textArtifact})!==o.textArtifactHash)fail('full origin artifact hash');
 }
 for(const s of value.sources){const r=s.review;if(!r)continue;
  if(r.objectId!==value.objectId||r.sourceFileId!==s.sourceFileId||r.sourceSha256!==s.sourceSha256||r.decisionId!==s.reviewSnapshot!.decisionId||r.contentHash!==s.reviewSnapshot!.contentHash)fail('review snapshot association');
  if(r.callInventoryScope){try{parseCallInventoryScopeDecision(r.callInventoryScope,{sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256});}catch{fail('invalid stored call inventory snapshot');}}
  for(const c of r.callInventoryScope?.claims??[]){
   const o=origins.get(originKey(s.sourceFileId,c.target.checkId));if(!o||o.inputManifestHash!==c.target.inputManifestHash||o.textStageContentHash!==c.target.textStageContentHash||o.textArtifactHash!==c.target.textArtifactHash)fail('claim origin association');
   const rebuilt=reconstructOdi123CallInventorySource({sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,stage:c.inventorySnapshot.stage,pageStages:{},textArtifact:o.textArtifact,selection:c.selection});
   if(rebuilt.status!=='RECONSTRUCTED'||canonical(rebuilt.inventory)!==canonical(c.inventorySnapshot)||callInventoryContentHash(rebuilt.inventory)!==c.target.inventoryContentHash||rebuilt.inventory.textArtifactHash!==o.textArtifactHash)fail('claim reconstruction');
  }
 }
 if(canonical(deriveCallInventoryIdentities(value.sources))!==canonical(value.identities))fail('identities differ from whole frozen source enumeration');
 return structuredClone(value);
}
const id=(envelope:Pick<CallInventoryComparisons,'objectId'|'inputManifestHash'|'capabilityRegistryHash'>,body:unknown)=>digest({hashDomain:'matrix-call-inventory-execution-result-id-v1',objectId:envelope.objectId,inputManifestHash:envelope.inputManifestHash,capabilityRegistryHash:envelope.capabilityRegistryHash,result:body});
export function validateCallInventoryComparisonsEnvelope(raw:unknown,registry:unknown=CALL_INVENTORY_CAPABILITY_REGISTRY):CallInventoryComparisons {
 validateRegistry(registry);native(raw);const parsed=envelopeSchema.safeParse(raw);if(!parsed.success)fail('invalid typed result wire');const value=parsed.data;
 if(value.capabilityRegistryHash!==callInventoryCapabilityRegistryHash)fail('capability hash');const identities:string[]=[];
 for(const row of value.results){const {id:stored,...body}=row;if(stored!==id(value,body))fail('typed result hash');
  if(row.kind==='UNBOUND_ATOM_ABSTENTION'){if(value.results.length!==1)fail('unbound mixed with scoped results');}
  else{identities.push(canonical(row.identity));if(row.comparison.status==='CANDIDATE'&&(canonical(row.identity)!==canonical(row.comparison.identity)||row.comparison.expected.sourceFileId===row.comparison.actual.sourceFileId))fail('candidate scope/source association');}
 }
 if(canonical(identities)!==canonical([...new Set(identities)].sort(order)))fail('duplicate or unsorted identities');return value;
}
export function buildCallInventoryComparisons(raw:unknown,registry:unknown=CALL_INVENTORY_CAPABILITY_REGISTRY):CallInventoryComparisons {
 validateRegistry(registry);const input=validateCallInventoryLoaderPackage(raw);
 const shared={schemaVersion:'matrix-call-inventory-execution-result-v1',ruleId:CALL_INVENTORY_CAPABILITY.ruleId,ruleVersion:'1',parameterCode:'ODI-123',comparisonVariant:'PD_RD'} as const;
 const bodies=input.identities.length?input.identities.map(identity=>{
  const compared=compareOdi123CallInventories({schemaVersion:'matrix-odi123-call-inventory-input-v1',objectId:input.objectId,inputManifestHash:input.inputManifestHash,identity,sources:input.sources,origins:input.origins});
  if(compared.status==='ABSTAIN'&&!(legitimate as readonly string[]).includes(compared.reasonCode))fail(compared.reasonCode);
  return {...shared,kind:'SCOPED_COMPARISON' as const,identity,comparison:compared};
 }):[{...shared,kind:'UNBOUND_ATOM_ABSTENTION' as const,reasonCode:'REVIEWED_CALL_INVENTORY_IDENTITY_MISSING',calibratedProbability:null}];
 const envelope={schemaVersion:'matrix-call-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:input.objectId,inputManifestHash:input.inputManifestHash,capabilityRegistryHash:callInventoryCapabilityRegistryHash};
 return validateCallInventoryComparisonsEnvelope({...envelope,results:bodies.map(body=>({...body,id:id(envelope,body)}))},registry);
}
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const coverageRow=z.object({parameterCode:key(200),implementedAtomicRules:count,enabledAtomicRules:count,evaluatedAtomicRules:count,successfulComparisons:count,abstentions:count,failures:count,
 executionStatus:z.enum(['UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE']),reason:z.string()}).strict();
const catalog=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json',import.meta.url),'utf8')).entries as Array<{parameterCode:string;atomicRules:Array<{ruleId:string}>}>;
/** Accept only independently authenticated execution inputs; preserve other131 rows. */
export function mergeCallInventoryCoverage(raw:unknown,envelope:CallInventoryComparisons,registry:unknown=CALL_INVENTORY_CAPABILITY_REGISTRY):MatrixCoverage[] {
 validateRegistry(registry);envelope=validateCallInventoryComparisonsEnvelope(envelope,registry);native(raw);const parsed=z.array(coverageRow).length(132).safeParse(raw);if(!parsed.success)fail('invalid base coverage');const rows=parsed.data;
 if(rows.some((r,i)=>r.parameterCode!==catalog[i]?.parameterCode))fail('base coverage catalog order');const base=rows.find(r=>r.parameterCode==='ODI-123');
 if(!base||base.executionStatus!=='UNSUPPORTED'||[base.implementedAtomicRules,base.enabledAtomicRules,base.evaluatedAtomicRules,base.successfulComparisons,base.abstentions,base.failures].some(n=>n!==0)||catalog.some(p=>p.atomicRules.some(r=>r.ruleId===CALL_INVENTORY_CAPABILITY.ruleId)))fail('capability overlaps base registry');
 const successful=envelope.results.filter(r=>r.kind==='SCOPED_COMPARISON'&&r.comparison.status==='CANDIDATE').length;
 return rows.map(r=>r.parameterCode!=='ODI-123'?{...r}:{...r,implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:successful,abstentions:envelope.results.length-successful,failures:0,executionStatus:'PARTIAL',reason:CALL_INVENTORY_CAPABILITY.partialGap});
}
