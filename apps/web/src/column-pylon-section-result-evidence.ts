import type {ColumnPylonSectionExecutionComparisons,ColumnPylonSectionExecutionExecutionResult,
  ColumnPylonSectionExecutionEvidence,ColumnPylonSectionRunSnapshot,InspectorEvidence} from '@inspector-ai/contracts';

export type SavedColumnPylonSectionContext={objectId:string;inputManifestHash:string};
const RULE='matrix-kr-060-reviewed_rectangular_gross_section_area_decrease';
const identityKeys=['entityKey','buildingKey','zoneKey','levelKey','memberKey','sectionKey'] as const;
const reasons=['PAIR_REVIEW_UNAPPROVED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','SOURCE_STAGE_UNVERIFIED','SOURCE_LINK_UNVERIFIED',
  'PHYSICAL_MEMBER_UNVERIFIED','SECTION_SHAPE_UNVERIFIED','DIMENSION_MEANING_UNVERIFIED','UNIT_UNVERIFIED','PAIR_APPLICABILITY_UNVERIFIED'];
export const columnPylonSectionFragmentLabels={FIRST_DIMENSION:'Первый размер',SECOND_DIMENSION:'Второй размер',EXPLICIT_UNIT:'Буквальная единица',
  PHYSICAL_MEMBER_BASIS:'Основание физического элемента',SECTION_SHAPE_BASIS:'Основание прямоугольной формы',GROSS_SECTION_BASIS:'Основание габаритного бетонного сечения',
  UNIT_BASIS:'Основание единицы мм',UNIT_SCOPE_BASIS:'Применимость единицы к обоим размерам'} as const;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu.test(v);
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function equal(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((x,i)=>equal(x,b[i]));
  if(!object(a)||!object(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}
const scalar=(s:unknown,max=8192):s is string=>typeof s==='string'&&s.length<=max*2&&Array.from(s).length>0&&Array.from(s).length<=max&&!/[\ud800-\udfff]/u.test(s);
const page=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=1&&(n as number)<=512;
const path=(v:unknown):v is number[]=>Array.isArray(v)&&v.length>0&&v.length<=64&&v.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=32767);
function token(v:unknown):boolean {
  if(!object(v)||!page(v.pageNumber)||!path(v.sourcePath)||!scalar(v.rawText)||!Array.isArray(v.usedTextRangeCodePoints))return false;
  const r=v.usedTextRangeCodePoints;
  return r.length===2&&r.every(Number.isSafeInteger)&&r[0]>=0&&r[0]<r[1]&&r[1]<=Array.from(v.rawText).length;
}
function identity(v:unknown):boolean{return object(v)&&v.componentRole==='BEARING_VERTICAL_MEMBER_SECTION'&&identityKeys.every(k=>scalar(v[k],200));}
function origin(v:unknown):boolean{return object(v)&&['inputManifestHash','textStageContentHash','textArtifactByteSha256','textArtifactContentHash','extractorProfileHash'].every(k=>sha(v[k]))
  &&scalar(v.checkId,200)&&v.resourcePolicyVersion==='document-text-v3-large-source-bounds-v1'&&v.sourceAuditProfileVersion==='SOURCE_AUDIT_V3_LARGE_VERTICAL_V1';}
function reference(v:unknown):boolean {
  if(!object(v)||!scalar(v.sourceFileId,200)||!sha(v.sourceSha256)||!uuid(v.sourceReviewDecisionId)||!sha(v.sourceReviewContentHash)||!origin(v.origin)||!object(v.selection))return false;
  const s=v.selection;
  return s.mode==='LITERAL_T77_V1'?page(s.pageNumber)&&path(s.sourcePath)&&sha(s.literalContentHash)
    :s.mode==='NATIVE_SECTION_SELECTION_V1'&&token(s.first)&&token(s.second)&&(s.unit===null||token(s.unit))&&sha(s.selectionContentHash);
}
function rowMatches(row:any,entries:any[]):boolean {
  if(!object(row)||row.schemaVersion!=='matrix-column-pylon-section-execution-result-v1'||!sha(row.id)||row.ruleId!==RULE||row.ruleVersion!=='1'||row.parameterCode!=='KR-060'||row.comparisonVariant!=='PD_RD')return false;
  if(row.kind==='UNBOUND_ATOM_ABSTENTION')return row.reasonCode==='REVIEWED_COLUMN_PYLON_PAIR_MISSING'&&row.calibratedProbability===null&&entries.every(e=>!e.included);
  if(row.kind!=='SCOPED_COMPARISON'||!identity(row.identity)||!sha(row.pairKey))return false;
  const entry=entries.find(e=>e.pairKey===row.pairKey);
  if(!entry?.included||entry.decisionId!==row.pairDecisionId||entry.journalContentHash!==row.pairJournalContentHash||entry.projectionContentHash!==row.pairProjectionContentHash)return false;
  const c=row.comparison;
  if(!object(c)||c.schemaVersion!=='matrix-kr060-column-pylon-comparison-v2'||c.calibratedProbability!==null||!equal(c.identity,row.identity))return false;
  if(c.status==='ABSTAIN')return c.comparison===null&&reasons.includes(c.reasonCode);
  if(!['CANDIDATE','NO_DECREASE_IN_REVIEWED_PAIR'].includes(c.status))return false;
  if(c.status==='CANDIDATE'?(c.reasonCode!=='REVIEWED_RECTANGULAR_GROSS_SECTION_AREA_DECREASE'||c.expertReviewRequired!==true):c.reasonCode!=='REVIEWED_PAIR_HAS_NO_AREA_DECREASE')return false;
  const v=c.comparison;
  return object(v)&&v.scope==='ONE_HUMAN_REVIEWED_RECTANGULAR_GROSS_SECTION_PD_RD'&&reference(v.expected)&&reference(v.actual)
    &&v.expected.sourceFileId!==v.actual.sourceFileId&&v.expected.sourceSha256!==v.actual.sourceSha256
    &&v.pairDecisionId===row.pairDecisionId&&v.pairJournalContentHash===row.pairJournalContentHash&&v.pairProjectionContentHash===row.pairProjectionContentHash
    &&typeof v.expectedAreaMm2==='string'&&/^[1-9][0-9]{0,17}(?![\s\S])/u.test(v.expectedAreaMm2)
    &&typeof v.actualAreaMm2==='string'&&/^[1-9][0-9]{0,17}(?![\s\S])/u.test(v.actualAreaMm2)
    &&typeof v.deltaAreaMm2==='string'&&/^(?:0|-?[1-9][0-9]{0,17})(?![\s\S])/u.test(v.deltaAreaMm2);
}
/** Display associations only. The server authenticates full original bytes, journals and hashes. */
export function columnPylonSectionSavedResultMatches(context:SavedColumnPylonSectionContext,comparisons:ColumnPylonSectionExecutionComparisons,snapshot:ColumnPylonSectionRunSnapshot):boolean {
  try {
    if(!object(comparisons)||!object(snapshot)||comparisons.schemaVersion!=='matrix-column-pylon-section-comparisons-v1'||comparisons.purpose!=='MACHINE_COMPARISON'
      ||comparisons.objectId!==context.objectId||comparisons.inputManifestHash!==context.inputManifestHash||!sha(comparisons.capabilityRegistryHash)
      ||snapshot.schemaVersion!=='matrix-kr060-column-pylon-run-snapshot-v1'||!uuid(snapshot.objectId)||snapshot.objectApiId!==context.objectId||snapshot.inputManifestHash!==context.inputManifestHash
      ||!sha(snapshot.contentHash)||comparisons.pairReviewSnapshotHash!==snapshot.contentHash||!Array.isArray(snapshot.entries)||snapshot.entries.length>16
      ||!Array.isArray(comparisons.results)||!comparisons.results.length||comparisons.results.length>16)return false;
    let last='';const decisions=new Set<string>();
    for(const e of snapshot.entries){if(!object(e)||!sha(e.pairKey)||e.pairKey<=last||!uuid(e.decisionId)||decisions.has(e.decisionId)||!sha(e.journalContentHash)||!sha(e.projectionContentHash)
      ||typeof e.sequenceNo!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/u.test(e.sequenceNo)||e.sequenceNo.length===19&&e.sequenceNo>'9223372036854775807'
      ||typeof e.included!=='boolean'||(e.included?e.exclusionReason!==null:!(typeof e.exclusionReason==='string'&&['SOURCE_NOT_IN_MANIFEST','SOURCE_REVIEW_REFERENCE_CHANGED'].includes(e.exclusionReason))))return false;
      last=e.pairKey;decisions.add(e.decisionId);}
    const included=snapshot.entries.filter(e=>e.included),rows=comparisons.results;
    if(included.length===0)return rows.length===1&&rowMatches(rows[0],snapshot.entries);
    return rows.length===included.length&&new Set(rows.map(r=>r.id)).size===rows.length&&rows.every((r,i)=>r.kind==='SCOPED_COMPARISON'&&r.pairKey===included[i]!.pairKey&&rowMatches(r,snapshot.entries));
  }catch{return false;}
}
type Rational={n:bigint;d:bigint};
function decimal(value:unknown):Rational|null {
  if(typeof value!=='string'||value.length>64)return null;
  const m=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?(?![\s\S])/u.exec(value);
  if(!m||m[4]&&m[4].length>4)return null;
  const exp=Number(m[4]??0);if(exp < -324||exp>308)return null;
  const fraction=m[3]??'',power=exp-fraction.length;
  let n=BigInt(m[2]!+fraction)*(m[1]? -1n:1n),d=1n;
  if(power>=0)n*=10n**BigInt(power);else d=10n**BigInt(-power);
  if(n>1000000000n*d||n< -1000000000n*d)return null;
  return {n,d};
}
const subtract=(a:Rational,b:Rational):Rational=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
function mpt(a:Rational):number {
  const sign=a.n<0n? -1n:1n,n=(a.n<0n? -a.n:a.n)*1000n,q=n/a.d,r=n%a.d;
  return Number(sign*(q+(r*2n>a.d||r*2n===a.d&&q%2n===1n?1n:0n)));
}
function nativeBox(value:unknown):Rational[]|null {
  if(!Array.isArray(value)||value.length!==4)return null;
  const n=value.map(decimal);return n.every(x=>x!==null)&&subtract(n[2]!,n[0]!).n>0n&&subtract(n[3]!,n[1]!).n>0n?n as Rational[]:null;
}
function geometry(frame:any,rawNative:unknown,b:number[]):boolean {
  const f=nativeBox(frame.nativeFrame.visibleBoxPointStrings),line=nativeBox(rawNative);
  if(!f||!line||mpt(subtract(f[2]!,f[0]!))!==frame.widthMilliPoints||mpt(subtract(f[3]!,f[1]!))!==frame.heightMilliPoints)return false;
  const w=frame.widthMilliPoints,h=frame.heightMilliPoints;
  const expected=line.map((n,i)=>Math.max(0,Math.min(i%2?h:w,mpt(subtract(n,f[i%2]!)))));
  return equal(b,expected);
}
export function columnPylonSectionResultEvidence(context:SavedColumnPylonSectionContext,comparisons:ColumnPylonSectionExecutionComparisons,snapshot:ColumnPylonSectionRunSnapshot,row:ColumnPylonSectionExecutionExecutionResult,item:ColumnPylonSectionExecutionEvidence):InspectorEvidence|null {
  try {
    if(!columnPylonSectionSavedResultMatches(context,comparisons,snapshot)||row.kind!=='SCOPED_COMPARISON'||row.comparison.status==='ABSTAIN'
      ||comparisons.results.filter(r=>r.id===row.id).length!==1||!equal(comparisons.results.find(r=>r.id===row.id),row)||!object(item)
      ||item.resultId!==row.id||item.pairKey!==row.pairKey||!['EXPECTED','ACTUAL'].includes(item.role)||!Object.hasOwn(columnPylonSectionFragmentLabels,item.fragmentRole)
      ||item.pairDecisionId!==row.pairDecisionId||item.pairJournalContentHash!==row.pairJournalContentHash||item.pairProjectionContentHash!==row.pairProjectionContentHash)return null;
    const ref=item.role==='EXPECTED'?row.comparison.comparison.expected:row.comparison.comparison.actual;
    for(const k of ['sourceFileId','sourceSha256','sourceReviewDecisionId','sourceReviewContentHash'] as const)if(item[k]!==ref[k])return null;
    if(!equal(item.origin,ref.origin)||!token(item.fragment))return null;
    const f=item.fragment,frame=f.pageFrame,b=f.bboxMilliPoints;
    if(!object(frame)||!Number.isSafeInteger(frame.widthMilliPoints)||!Number.isSafeInteger(frame.heightMilliPoints)||frame.widthMilliPoints<=0||frame.heightMilliPoints<=0
      ||!object(frame.nativeFrame)||frame.nativeFrame.coordinateSystem!=='PDFMINER_LAYOUT_POINTS'||!nativeBox(frame.nativeFrame.visibleBoxPointStrings)||!nativeBox(f.nativeBoxPointStrings)
      ||!Array.isArray(b)||b.length!==4||!b.every(n=>Number.isSafeInteger(n)&&n>=0)||b[0]>=b[2]||b[1]>=b[3]||b[2]>frame.widthMilliPoints||b[3]>frame.heightMilliPoints||!geometry(frame,f.nativeBoxPointStrings,b))return null;
    if(['FIRST_DIMENSION','SECOND_DIMENSION','EXPLICIT_UNIT'].includes(item.fragmentRole)){
      const s=ref.selection;
      if(s.mode==='LITERAL_T77_V1'){if(f.pageNumber!==s.pageNumber||!equal(f.sourcePath,s.sourcePath))return null;}
      else {const t=item.fragmentRole==='FIRST_DIMENSION'?s.first:item.fragmentRole==='SECOND_DIMENSION'?s.second:s.unit;
        if(!t||!equal({pageNumber:f.pageNumber,sourcePath:f.sourcePath,rawText:f.rawText,usedTextRangeCodePoints:f.usedTextRangeCodePoints},t))return null;}
    }
    return {id:`kr060:${row.id.slice(0,20)}:${item.role}:${item.fragmentRole}:${f.pageNumber}`.slice(0,80),sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,
      stage:item.role==='EXPECTED'?'PD':'RD',pageNumber:f.pageNumber,sheet:null,revision:null,bbox:[b[0]/frame.widthMilliPoints,1-b[3]/frame.heightMilliPoints,b[2]/frame.widthMilliPoints,1-b[1]/frame.heightMilliPoints],
      value:f.rawText,unit:null,element:identityKeys.map(k=>row.identity[k]).join(' · ')};
  }catch{return null;}
}
