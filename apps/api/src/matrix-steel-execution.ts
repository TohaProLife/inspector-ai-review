/** Pure typed KR-056 consistency; protected loaders still own PDF, actor and journal authority. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {MatrixCoverage,SourceDeclarationFragment,SteelComparisonIdentity,SteelComparisonSource,SteelComparisonInput,
  SteelComparisonExecutionLoaderPackage as Loader,SteelComparisonExecutionResult as Result,
  SteelComparisonExecutionComparisons as Envelope,SteelComparisonExecutionEvidence as Evidence} from '@inspector-ai/contracts';
import {canonicalSourceDeclarationJson as canonical} from './matrix-source-declarations.js';
import {compareKr056SteelDeclarations,projectSteelComparisonScopeDecision,steelComparisonExecutionInternal as internal} from './matrix-steel-comparison.js';

type Obj=Record<string,any>;
const fail=(why:string):never=>{throw new TypeError(`Steel execution integrity: ${why}`);};
const record=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:readonly string[]):v is Obj=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const nonnegative=(v:unknown):v is number=>integer(v)&&v>=0;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$(?![\s\S])/u.test(v);
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const key=(v:unknown):v is string=>typeof v==='string'&&[...v].length>0&&[...v].length<=200&&trim(v)===v&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
/** All external roots enter the unchanged descriptor-first T69 native boundary before reads. */
const encoded=(v:unknown):string=>{const checked=internal.native(v);return checked.status==='VALID'?checked.canonical:fail(`native ${checked.status}`);};
const clone=<T>(v:T):T=>JSON.parse(canonical(v)) as T;
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const hash=(v:unknown)=>createHash('sha256').update(canonical(v),'utf8').digest('hex');
const codepoints=(a:string,b:string):number=>{const x=Array.from(a,c=>c.codePointAt(0)!),y=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
const RULE='matrix-kr-056-reviewed_steel_catalog_transition';
const GAP='PARTIAL_SUBRULES_ONLY:EXPLICIT_REVIEWED_SAME_DISTRIBUTION_BELT_I_BEAM_PD_C345_TO_RD_C245_WITH_PAIR_APPLICABILITY_ONLY;OTHER_GRADES_MEMBERS_PROFILES_STANDARDS_STRENGTH_RANK_COMPLETENESS_AND_NORMATIVE_COMPLIANCE_UNSUPPORTED';
const REGISTRY={schemaVersion:'matrix-steel-comparison-capabilities-v1',entries:[{parameterCode:'KR-056',matrixCode:'M-056',ruleId:RULE,ruleVersion:'1',enabled:true,comparisonVariant:'PD_RD',family:'ENUM_TRANSITION',executionKind:'REVIEWED_PHYSICAL_MEMBER_STEEL_CATALOG_TRANSITION',resultSchemaVersion:'matrix-kr056-steel-comparison-v1',partialGap:GAP}]};
const REGISTRY_CANONICAL=canonical(REGISTRY);
/** A detached compatibility view; caller mutations cannot change private authoritative defaults. */
export const steelComparisonCapabilityRegistry=clone(REGISTRY);
export const steelComparisonCapabilityRegistryHash=hash(REGISTRY);
const registry=(raw:unknown)=>{if(encoded(raw)!==REGISTRY_CANONICAL)fail('capability registry');};

/** No current eligibility filters: every retained locally consistent claim contributes its identity. */
function deriveFromSources(raw:unknown):SteelComparisonIdentity[]{
  if(!Array.isArray(raw)||raw.length>64||!raw.every(internal.source))fail('source DTO');
  const sources=raw as SteelComparisonSource[],ids=new Map<string,SteelComparisonIdentity>(),sourceIds=new Set<string>();
  let objectId:string|undefined,total=0;
  for(const s of sources){
    if(sourceIds.has(s.sourceFileId)||(objectId!==undefined&&s.objectId!==objectId))fail('source object/identity association');
    sourceIds.add(s.sourceFileId);objectId=s.objectId;
    const scope=s.review?.steelComparisonScope;if(scope===null||scope===undefined)continue;
    if((total+=scope.claims.length)>128)fail('total claim limit');
    if(projectSteelComparisonScopeDecision(scope)===null)fail('scope snapshot/hash');
    for(const claim of scope.claims){
      if(claim.declarationSnapshot.sourceFileId!==s.sourceFileId||claim.declarationSnapshot.sourceSha256!==s.sourceSha256)fail('snapshot source association');
      ids.set(canonical(claim.identity),claim.identity);
    }
  }
  return [...ids.entries()].sort(([a],[b])=>codepoints(a,b)).map(([,id])=>id);
}
/** Source-only DTO/self-consistency helper; missing originals are not authenticated here. */
export function deriveSteelComparisonIdentities(raw:unknown):SteelComparisonIdentity[]{encoded(raw);return clone(deriveFromSources(raw));}

/** Complete retained integrity precedes both scoped iteration and the genuinely empty unbound case. */
export function validateSteelComparisonLoaderPackage(raw:unknown):Loader{
  encoded(raw);
  if(!exact(raw,['schemaVersion','objectId','inputManifestHash','sources','origins','applicabilityDecisions','identities'])
    ||raw.schemaVersion!=='matrix-kr056-steel-loader-inputs-v1'||!key(raw.objectId)||!sha(raw.inputManifestHash)
    ||!Array.isArray(raw.sources)||raw.sources.length>64||!raw.sources.every(internal.source)
    ||!Array.isArray(raw.origins)||raw.origins.length>128||!raw.origins.every(internal.origin)
    ||!Array.isArray(raw.applicabilityDecisions)||raw.applicabilityDecisions.length>16||!raw.applicabilityDecisions.every(internal.applicability)
    ||!Array.isArray(raw.identities)||raw.identities.length>128||!raw.identities.every(internal.identity)||internal.collectionLimit(raw))fail('loader DTO');
  const pkg=raw as Loader;
  const retained=internal.validateRetained({schemaVersion:'matrix-kr056-steel-comparison-input-v1',objectId:pkg.objectId,inputManifestHash:pkg.inputManifestHash,sources:pkg.sources,origins:pkg.origins,applicabilityDecisions:pkg.applicabilityDecisions});
  if(retained.status!=='VALID')fail(retained.reasonCode);
  if(!same(deriveFromSources(pkg.sources),pkg.identities))fail('claim-derived identities');
  return clone(pkg);
}
const common={schemaVersion:'matrix-steel-execution-result-v1',ruleId:RULE,ruleVersion:'1',parameterCode:'KR-056',comparisonVariant:'PD_RD'} as const;
const resultId=(e:Pick<Envelope,'objectId'|'inputManifestHash'|'capabilityRegistryHash'>,r:Obj):string=>{const{id:_,...body}=r;return hash({hashDomain:'matrix-steel-execution-result-id-v1',objectId:e.objectId,inputManifestHash:e.inputManifestHash,capabilityRegistryHash:e.capabilityRegistryHash,result:body});};
const projection=(p:Loader,id:SteelComparisonIdentity):SteelComparisonInput=>({schemaVersion:'matrix-kr056-steel-comparison-input-v1',objectId:p.objectId,inputManifestHash:p.inputManifestHash,identity:id,sources:p.sources,origins:p.origins,applicabilityDecisions:p.applicabilityDecisions});
export function buildSteelComparisons(raw:unknown,rawRegistry:unknown=REGISTRY):Envelope{
  registry(rawRegistry);const p=validateSteelComparisonLoaderPackage(raw);
  const e:Envelope={schemaVersion:'matrix-steel-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:p.objectId,inputManifestHash:p.inputManifestHash,capabilityRegistryHash:steelComparisonCapabilityRegistryHash,results:[]};
  const bodies=p.identities.length?p.identities.map(id=>({...common,kind:'SCOPED_COMPARISON' as const,identity:id,comparison:compareKr056SteelDeclarations(projection(p,id))})):[{...common,kind:'UNBOUND_ATOM_ABSTENTION' as const,reasonCode:'REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING' as const,calibratedProbability:null}];
  e.results=bodies.map(r=>({...r,id:resultId(e,r)}) as Result);
  return validateSteelComparisons(e);
}
const operational=new Set(['APPLICABILITY_DECISION_UNVERIFIED','REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING','AMBIGUOUS_DECLARATION_SCOPE','SOURCE_STAGE_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','SOURCE_LINK_UNVERIFIED','PHYSICAL_MEMBER_MAPPING_UNVERIFIED','APPLICABILITY_DECISION_MISSING','AMBIGUOUS_APPLICABILITY_DECISION','UNSUPPORTED_CATEGORY_TRANSITION','NEGATIVE_SCOPE_UNVERIFIED']);
function validComparison(v:unknown,id:SteelComparisonIdentity):boolean{
  if(!exact(v,['schemaVersion','status','reasonCode','identity','comparison','calibratedProbability'])||v.schemaVersion!=='matrix-kr056-steel-comparison-v1'||v.calibratedProbability!==null||!internal.identity(v.identity)||!same(v.identity,id))return false;
  if(v.status==='ABSTAIN')return operational.has(v.reasonCode)&&v.comparison===null;
  const c=v.comparison;
  return v.status==='CANDIDATE'&&v.reasonCode==='EXPLICIT_C345_TO_C245_IN_REVIEWED_SAME_MEMBER'
    &&exact(c,['scope','expected','actual','expectedValue','actualValue','applicabilityDecisionId','applicabilityDecisionContentHash'])
    &&c.scope==='HUMAN_REVIEWED_PHYSICAL_MEMBER_AND_DECLARATION_APPLICABILITY_ONLY'
    &&internal.referenceShape(c.expected)&&internal.referenceShape(c.actual)&&c.expected.sourceFileId!==c.actual.sourceFileId&&c.expected.sourceSha256!==c.actual.sourceSha256
    &&c.expectedValue==='С345'&&c.actualValue==='С245'&&key(c.applicabilityDecisionId)&&sha(c.applicabilityDecisionContentHash);
}
/** Exact stored DTO/hash validation only; this does not establish original or human authority. */
export function validateSteelComparisons(raw:unknown):Envelope{
  encoded(raw);
  if(!exact(raw,['schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'])||raw.schemaVersion!=='matrix-steel-comparisons-v1'||raw.purpose!=='MACHINE_COMPARISON'||!key(raw.objectId)||!sha(raw.inputManifestHash)||raw.capabilityRegistryHash!==steelComparisonCapabilityRegistryHash||!Array.isArray(raw.results)||raw.results.length<1||raw.results.length>128)fail('envelope DTO');
  const e=raw as Envelope;let previous:string|undefined;const ids=new Set<string>();
  for(const r of e.results){
    if(!record(r)||r.schemaVersion!==common.schemaVersion||r.ruleId!==RULE||r.ruleVersion!=='1'||r.parameterCode!=='KR-056'||r.comparisonVariant!=='PD_RD'||!sha(r.id)||ids.has(r.id))fail('result DTO');
    ids.add(r.id);
    if(r.kind==='UNBOUND_ATOM_ABSTENTION'){
      if(!exact(r,['schemaVersion','id','ruleId','ruleVersion','parameterCode','comparisonVariant','kind','reasonCode','calibratedProbability'])||e.results.length!==1||r.reasonCode!=='REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING'||r.calibratedProbability!==null)fail('unbound result');
    }else if(r.kind==='SCOPED_COMPARISON'){
      if(!exact(r,['schemaVersion','id','ruleId','ruleVersion','parameterCode','comparisonVariant','kind','identity','comparison'])||!internal.identity(r.identity)||!validComparison(r.comparison,r.identity))fail('scoped result');
      const value=canonical(r.identity);if(previous!==undefined&&codepoints(previous,value)>=0)fail('identity order');previous=value;
    }else fail('result kind');
    if(resultId(e,r)!==r.id)fail('result ID');
  }
  return clone(e);
}
export function steelComparisonEvidence(rawPackage:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):Evidence[]{
  const p=validateSteelComparisonLoaderPackage(rawPackage),e=validateSteelComparisons(rawEnvelope);
  if(!same(e,buildSteelComparisons(p,rawRegistry)))fail('evidence envelope reconstruction');
  const out:Evidence[]=[];
  for(const r of e.results){
    if(r.kind!=='SCOPED_COMPARISON'||r.comparison.status!=='CANDIDATE')continue;
    const comparison=r.comparison.comparison,decision=p.applicabilityDecisions.find(d=>d.decisionId===comparison.applicabilityDecisionId&&d.contentHash===comparison.applicabilityDecisionContentHash)??fail('evidence applicability decision');
    for(const role of ['EXPECTED','ACTUAL'] as const){
      const ref=comparison[role==='EXPECTED'?'expected':'actual'];
      const source=p.sources.find(s=>s.sourceFileId===ref.sourceFileId&&s.sourceSha256===ref.sourceSha256&&s.review?.decisionId===ref.reviewDecisionId&&s.review?.contentHash===ref.reviewContentHash)??fail('evidence source');
      const claims=(source.review!.steelComparisonScope?.claims??[]).filter(c=>same(c.identity,r.identity)&&same(c.target,ref.target));
      if(claims.length!==1)fail('evidence claim');
      const claim=claims[0],{declarationId:_,...originTarget}=ref.target;
      const origin=p.origins.find(o=>o.sourceFileId===ref.sourceFileId&&o.sourceSha256===ref.sourceSha256&&same(o.target,originTarget))??fail('evidence origin');
      const pages=origin.textArtifact.pages as {pageNumber:number;widthMilliPoints:number;heightMilliPoints:number}[];
      const groups:[Evidence['fragmentRole'],SourceDeclarationFragment[]][]=[['PRIMARY',claim.declarationSnapshot.primaryFragments],['DECLARATION_SCOPE',claim.declarationSnapshot.scopeFragments],['PHYSICAL_MEMBER_SCOPE',claim.memberMapping.scopeFragments],['APPLICABILITY_BASIS',decision.basis[role==='EXPECTED'?'expectedScopeFragments':'actualScopeFragments']]];
      for(const[fragmentRole,fragments]of groups)for(const fragment of fragments){
        const page=pages.find(v=>v.pageNumber===fragment.pageNumber)??fail('evidence page');
        out.push({resultId:r.id,role,sourceFileId:ref.sourceFileId,sourceSha256:ref.sourceSha256,reviewDecisionId:ref.reviewDecisionId,reviewContentHash:ref.reviewContentHash,target:ref.target,applicabilityDecisionId:decision.decisionId,applicabilityDecisionContentHash:decision.contentHash,pageNumber:fragment.pageNumber,pageFrame:{widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints},fragmentRole,fragment});
      }
    }
  }
  return clone(out);
}
const scalarRegistry=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json',import.meta.url),'utf8')) as {entries:{parameterCode:string;atomicRules:{ruleId:string}[]}[]};
const counters=['implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'] as const;
export function mergeSteelComparisonCoverage(raw:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):MatrixCoverage[]{
  encoded(raw);registry(rawRegistry);const e=validateSteelComparisons(rawEnvelope);
  if(!Array.isArray(raw)||raw.length!==132||scalarRegistry.entries.length!==132||scalarRegistry.entries.some(row=>row.atomicRules.some(rule=>rule.ruleId===RULE)))fail('coverage registry overlap/order');
  const rows=raw as Obj[];
  for(let i=0;i<rows.length;i++){const row=rows[i];if(!exact(row,['parameterCode',...counters,'executionStatus','reason'])||row.parameterCode!==scalarRegistry.entries[i].parameterCode||!counters.every(k=>nonnegative(row[k]))||!['UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'].includes(row.executionStatus)||typeof row.reason!=='string'||[...row.reason].length>2000000)fail('coverage row');}
  const base=rows.find(r=>r.parameterCode==='KR-056');if(!base||base.executionStatus!=='UNSUPPORTED'||!counters.every(k=>base[k]===0))fail('steel overlap');
  const successful=e.results.filter(r=>r.kind==='SCOPED_COMPARISON'&&r.comparison.status==='CANDIDATE').length;
  return clone(rows.map(row=>row.parameterCode!=='KR-056'?row:{...row,implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:successful,abstentions:e.results.length-successful,failures:0,executionStatus:'PARTIAL',reason:GAP})) as MatrixCoverage[];
}
