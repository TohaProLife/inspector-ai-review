/** Pure snapshot integrity and reference matching; neither grants actor/original authority. */
import {createHash} from 'node:crypto';
import {matrixSteelApplicabilityRunSnapshotSchema,type SteelApplicabilityRunSnapshot,
 type SteelComparisonSource,type SteelComparisonApplicabilityDecision} from '@inspector-ai/contracts';
import {steelComparisonExecutionInternal as internal} from './matrix-steel-comparison.js';
import {validateSteelComparisonLoaderPackage} from './matrix-steel-execution.js';
import {steelApplicabilityPairKey} from './matrix-steel-applicability-review.js';
function invalid():never{throw Error('STEEL_APPLICABILITY_SNAPSHOT_INTEGRITY');}
const encoded=(raw:unknown,bytes=524288):string=>{const result=internal.native(raw,bytes);return result.status==='VALID'?result.canonical:invalid();};
const detached=<T>(raw:unknown,bytes?:number):T=>JSON.parse(encoded(raw,bytes)) as T;
const same=(a:unknown,b:unknown)=>encoded(a,8000000)===encoded(b,8000000);
const hash=(raw:unknown)=>createHash('sha256').update(encoded(raw)).digest('hex');
const exact=(raw:unknown,keys:string[]):raw is Record<string,unknown>=>raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===keys.length&&keys.every(k=>Object.hasOwn(raw,k));
function validate(raw:unknown):SteelApplicabilityRunSnapshot{
 const parsed=matrixSteelApplicabilityRunSnapshotSchema.safeParse(raw);if(!parsed.success)invalid();const value=parsed.data;
 let previous:string|undefined;const ids=new Set<string>();
 for(const e of value.entries){if(previous!==undefined&&previous>=e.pairKey||ids.has(e.decisionId))invalid();previous=e.pairKey;ids.add(e.decisionId);}
 const {contentHash,...body}=value;
 if(hash({hashDomain:'matrix-kr056-steel-applicability-run-snapshot-json-v1',snapshot:body})!==contentHash)invalid();
 return value;
}
export function validateSteelApplicabilityRunSnapshot(raw:unknown):SteelApplicabilityRunSnapshot{return validate(detached(raw));}
export function buildSteelApplicabilityRunSnapshot(raw:unknown):SteelApplicabilityRunSnapshot{
 const value=detached<unknown>(raw);if(!exact(value,['objectId','inputManifestHash','entries']))invalid();
 const body={schemaVersion:'matrix-steel-applicability-run-snapshot-v1' as const,objectId:value.objectId,inputManifestHash:value.inputManifestHash,entries:value.entries};
 return validate({...body,contentHash:hash({hashDomain:'matrix-kr056-steel-applicability-run-snapshot-json-v1',snapshot:body})});
}
/** Full T70 package integrity precedes interpreting any included/excluded journal pointer. */
export function validateSteelApplicabilitySnapshotProjectionLinks(rawSnapshot:unknown,rawPackage:unknown):void{
 const snapshot=validateSteelApplicabilityRunSnapshot(rawSnapshot),pkg=validateSteelComparisonLoaderPackage(rawPackage);
 if(snapshot.objectId!==pkg.objectId||snapshot.inputManifestHash!==pkg.inputManifestHash)invalid();
 const included=snapshot.entries.filter(e=>e.included);if(included.length!==pkg.applicabilityDecisions.length)invalid();
 for(const projection of pkg.applicabilityDecisions){
  const entry=included.find(e=>e.decisionId===projection.decisionId&&e.projectionContentHash===projection.contentHash);if(!entry)invalid();
  if(entry.pairKey!==steelApplicabilityPairKey({objectId:projection.objectId,identity:projection.identity,
   expectedSourceFileId:projection.expected.sourceFileId,actualSourceFileId:projection.actual.sourceFileId}))invalid();
 }
}
/** Classification/reference matching only. The protected caller validates every complete historical journal first. */
export function steelApplicabilityProjectionMatchesSources(rawProjection:unknown,rawSources:unknown):boolean{
 const {projection,sources}=detached<{projection:SteelComparisonApplicabilityDecision;sources:SteelComparisonSource[]}>({projection:rawProjection,sources:rawSources},8000000);
 if(!internal.applicability(projection)||!Array.isArray(sources)||sources.length>64||!sources.every(internal.source))invalid();
 if(new Set(sources.map(s=>s.sourceFileId)).size!==sources.length)invalid();
 for(const ref of [projection.expected,projection.actual]){
  const s=sources.find(s=>s.sourceFileId===ref.sourceFileId&&s.sourceSha256===ref.sourceSha256&&s.objectId===projection.objectId);
  if(!s?.review||s.review.decisionId!==ref.reviewDecisionId||s.review.contentHash!==ref.reviewContentHash)return false;
  const claims=s.review.steelComparisonScope?.claims.filter(c=>same(c.identity,projection.identity)&&same(c.target,ref.target)&&same(c.declarationSnapshot.productScope,ref.productScope));
  if(claims?.length!==1)return false;
 }
 return true;
}
