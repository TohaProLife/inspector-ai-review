import {useState} from 'react';
import {matrixSteelComparisonScopeInputSchema,matrixSteelComparisonScopeDecisionSchema,matrixSteelApplicabilityReviewInputSchema,
 matrixSteelApplicabilityReviewDecisionSchema,type SourceReviewInput,type SourceReviewDecision,type SourceFileSummary,
 type MatrixInventorySourcePagesRead,type MatrixSteelSourceDeclaration,type MatrixExecutionRead,type SteelComparisonScopeRequest,
 type SteelComparisonScopeClaimDecision,type SteelComparisonIdentity,type SourceDeclarationFragment,type SteelApplicabilityReviewInput,
 type SteelApplicabilityReviewDecision,type InspectorEvidence} from '@inspector-ai/contracts';
import {api} from './api';
import {inventoryPages,type InventoryPage} from './SourceInventoryReviewFields';
import {sourceDeclarationScopeLabel} from './MatrixSourceDeclarations';
export function steelJsonEqual(a:unknown,b:unknown):boolean {
 if(Array.isArray(a)||Array.isArray(b)){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||Object.keys(a).length!==a.length||Object.keys(b).length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(!Object.hasOwn(a,i)||!Object.hasOwn(b,i)||!steelJsonEqual(a[i],b[i]))return false;
  return true;
 }
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a),right=Object.keys(b);if(left.length!==right.length)return false;
 return left.every(key=>Object.hasOwn(b,key)&&steelJsonEqual((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}
const same=steelJsonEqual;
const stale=()=>Error('Источник, запуск или решение изменились. Обновите исходные декларации и решение.');
export interface SteelSourceIdentity {objectId:string;checkId:string;file:SourceFileSummary;reviewHash:string|null}
export interface SteelLoadedSource {identity:SteelSourceIdentity;origin:MatrixInventorySourcePagesRead;read:MatrixExecutionRead;declarations:MatrixSteelSourceDeclaration[];pages:InventoryPage[]}
export interface SteelHumanMapping {identity:SteelComparisonIdentity;reference:string;sameMember:boolean;fragments:SourceDeclarationFragment[]}
export interface SteelPairSelection {file:SourceFileSummary;review:SourceReviewDecision;claim:SteelComparisonScopeClaimDecision}
export const steelFragmentKey=(f:SourceDeclarationFragment)=>JSON.stringify([f.pageNumber,f.blockIndex,f.lineIndex,f.rawText,f.bboxMilliPoints]);
const declarationSchema=matrixSteelComparisonScopeDecisionSchema.shape.claims.element.shape.declarationSnapshot;
function verifiedSource(data:SteelLoadedSource) {
 const {identity,origin,read}=data,artifact=read.sourceDeclarations;
 // getCheck binds the public object ID; immutable artifacts use their internal object ID namespace.
 if(read.checkId!==identity.checkId||origin.checkId!==identity.checkId||origin.sourceFileId!==identity.file.id
   ||origin.sourceSha256!==identity.file.sha256||origin.latestReviewHash!==identity.reviewHash
   ||origin.textArtifact.sourceFileId!==identity.file.id||origin.textArtifact.inputSha256!==identity.file.sha256
   ||!artifact||artifact.purpose!=='EVIDENCE_ONLY'||artifact.objectId!==read.execution.objectId
   ||artifact.inputManifestHash!==read.execution.inputManifestHash||artifact.inputManifestHash!==origin.inputManifestHash)throw stale();
 const pages=inventoryPages(origin.textArtifact);
 const declarations=artifact.declarations.filter((d):d is MatrixSteelSourceDeclaration=>d.kind==='SOURCE_AUTHORED_STEEL_DECLARATION'&&d.sourceFileId===identity.file.id).map(d=>declarationSchema.parse(d));
 if(new Set(declarations.map(d=>d.id)).size!==declarations.length)throw stale();
 for(const d of declarations){const page=pages.find(p=>p.pageNumber===d.pageNumber);
  if(d.sourceSha256!==identity.file.sha256||d.textArtifactHash!==origin.textArtifactHash||!page
    ||d.widthMilliPoints!==page.widthMilliPoints||d.heightMilliPoints!==page.heightMilliPoints
    ||d.stage!==(origin.pageStages[String(d.pageNumber)]??origin.stage))throw stale();
  for(const f of [...d.primaryFragments,...d.scopeFragments])if(!pages.some(p=>p.fragments.some(line=>same(line,f))))throw stale();
 }
 return {pages,declarations};
}
export async function loadSteelSource(identity:SteelSourceIdentity,signal:AbortSignal):Promise<SteelLoadedSource> {
 signal.throwIfAborted();const check=await api.getCheck(identity.checkId,signal);signal.throwIfAborted();
 if(check.id!==identity.checkId||check.objectId!==identity.objectId||check.mode!=='NORMAL'||check.progress!==100||!check.completedAt
   ||!Number.isFinite(Date.parse(check.completedAt))||!['PARTIAL','REVIEW_REQUIRED','CLARIFICATION_REQUIRED','READY_TO_FINALIZE','FINALIZED'].includes(check.status))throw stale();
 const [read,origin]=await Promise.all([api.getMatrixExecution(identity.checkId,signal),api.getSourceInventoryPages(identity.checkId,identity.file.id,signal)]);signal.throwIfAborted();
 const data={identity:structuredClone(identity),origin,read,declarations:[],pages:[]} as SteelLoadedSource;
 return {...data,...verifiedSource(data)};
}
export function withSteelReviewScope(input:Omit<SourceReviewInput,'steelComparisonScope'>,scope?:SteelComparisonScopeRequest):SourceReviewInput {
 return {...input,...(scope?{steelComparisonScope:matrixSteelComparisonScopeInputSchema.parse(scope)}:{})};
}
export function appendSteelClaim(scope:SteelComparisonScopeRequest|undefined,loaded:SteelLoadedSource,declarationId:string,human:SteelHumanMapping):SteelComparisonScopeRequest {
 const {pages,declarations}=verifiedSource(loaded),d=declarations.find(d=>d.id===declarationId);
 if(!d||loaded.identity.file.stages.length!==1||loaded.identity.file.stages[0]!==d.stage)throw stale();
 if(!human.fragments.length||human.fragments.some(f=>!pages.some(p=>p.fragments.some(original=>same(original,f))))
   ||new Set(human.fragments.map(steelFragmentKey)).size!==human.fragments.length)throw Error('Выберите разные исходные строки, подтверждающие физический элемент.');
 const prior=scope?matrixSteelComparisonScopeInputSchema.parse(scope):undefined;
 if(prior?.claims.some(c=>c.target.declarationId===declarationId))throw Error('Декларация уже привязана. Для замены отзовите прежнюю привязку.');
 const target={checkId:loaded.identity.checkId,inputManifestHash:loaded.origin.inputManifestHash,textStageContentHash:loaded.origin.textStageContentHash,textArtifactHash:loaded.origin.textArtifactHash,declarationId};
 return matrixSteelComparisonScopeInputSchema.parse({schemaVersion:'matrix-kr056-steel-review-v1',claims:[...(prior?.claims??[]),{
  target,identity:human.identity,memberMapping:{identity:human.identity,assertion:human.sameMember?'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER':'UNKNOWN',scopeFragments:human.fragments,reference:human.reference}}]});
}
export function withdrawSteelClaim(scope:SteelComparisonScopeRequest,index:number):SteelComparisonScopeRequest {
 const parsed=matrixSteelComparisonScopeInputSchema.parse(scope);if(!Number.isSafeInteger(index)||!parsed.claims[index])throw Error('Привязка отсутствует.');
 return {...parsed,claims:parsed.claims.filter((_,i)=>i!==index)};
}
function pairSelection(s:SteelPairSelection,stage:'PD'|'RD') {
 const scope=s.review.steelComparisonScope&&matrixSteelComparisonScopeDecisionSchema.parse(s.review.steelComparisonScope);
 if(!scope||!scope.claims.some(c=>same(c,s.claim))||s.review.sourceFileId!==s.file.id||s.review.sourceSha256!==s.file.sha256
   ||s.file.review?.contentHash!==s.review.contentHash||s.review.revisionStatus!=='CURRENT'||s.review.approvalStatus!=='APPROVED'
   ||s.review.sectionCode!=='KR'||!s.review.linkGroupId||s.file.stages.length!==1||s.file.stages[0]!==stage
   ||Object.values(s.review.pageStages).some(value=>value!==stage)||s.claim.declarationSnapshot.stage!==stage
   ||s.claim.declarationSnapshot.sourceFileId!==s.file.id||s.claim.declarationSnapshot.sourceSha256!==s.file.sha256
   ||s.claim.memberMapping.assertion!=='HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER'||!same(s.claim.identity,s.claim.memberMapping.identity))throw stale();
 return {sourceFileId:s.file.id,sourceSha256:s.file.sha256,reviewDecisionId:s.review.id,reviewContentHash:s.review.contentHash,target:s.claim.target,productScope:s.claim.declarationSnapshot.productScope};
}
/** Cross-page references require their own full original frame; never borrow declaration-page dimensions. */
export function steelPairFragmentEvidence(selection:SteelPairSelection,fragment:SourceDeclarationFragment,loaded:SteelLoadedSource):InspectorEvidence {
 const {pages,declarations}=verifiedSource(loaded),s=selection,ref=pairSelection(s,s.claim.declarationSnapshot.stage),target=ref.target;
 if(loaded.identity.objectId!==s.review.objectId||loaded.identity.file.id!==s.file.id||loaded.identity.file.sha256!==s.file.sha256
   ||loaded.identity.reviewHash!==s.review.contentHash||target.checkId!==loaded.identity.checkId||target.inputManifestHash!==loaded.origin.inputManifestHash
   ||target.textStageContentHash!==loaded.origin.textStageContentHash||target.textArtifactHash!==loaded.origin.textArtifactHash
   ||!declarations.some(d=>d.id===target.declarationId&&same(d,s.claim.declarationSnapshot)))throw stale();
 const page=pages.find(p=>p.pageNumber===fragment.pageNumber);
 if(!page||!page.fragments.some(f=>same(f,fragment)))throw stale();
 const stage=loaded.origin.pageStages[String(fragment.pageNumber)]??loaded.origin.stage;
 if(stage!==s.claim.declarationSnapshot.stage)throw stale();
 const b=fragment.bboxMilliPoints;
 return {id:`steel-basis:${fragment.pageNumber}:${fragment.blockIndex}:${fragment.lineIndex}`,sourceFileId:s.file.id,sourceSha256:s.file.sha256,stage,pageNumber:fragment.pageNumber,sheet:null,revision:null,value:fragment.rawText,unit:null,element:'Основание применимости пары; решение принимает инспектор',bbox:[b[0]/page.widthMilliPoints,1-b[3]/page.heightMilliPoints,b[2]/page.widthMilliPoints,1-b[1]/page.heightMilliPoints]};
}
export function steelPairMatches(decision:SteelApplicabilityReviewDecision,expected:SteelPairSelection,actual:SteelPairSelection):boolean {
 return decision.projection.expected.sourceFileId===expected.file.id&&decision.projection.actual.sourceFileId===actual.file.id&&same(decision.projection.identity,expected.claim.identity);
}
export function steelApplicabilityInput(expected:SteelPairSelection,actual:SteelPairSelection,basis:{reference:string;expectedScopeFragments:SourceDeclarationFragment[];actualScopeFragments:SourceDeclarationFragment[];approved:boolean},previous?:SteelApplicabilityReviewDecision):SteelApplicabilityReviewInput {
 const pd=pairSelection(expected,'PD'),rd=pairSelection(actual,'RD');
 if(expected.review.objectId!==actual.review.objectId||expected.file.id===actual.file.id||expected.file.sha256===actual.file.sha256
   ||expected.review.linkGroupId!==actual.review.linkGroupId||!same(expected.claim.identity,actual.claim.identity)
   ||(previous&&!steelPairMatches(previous,expected,actual)))throw stale();
 for(const [selection,fragments] of [[expected,basis.expectedScopeFragments],[actual,basis.actualScopeFragments]] as const){
  const allowed=[...selection.claim.declarationSnapshot.primaryFragments,...selection.claim.declarationSnapshot.scopeFragments,...selection.claim.memberMapping.scopeFragments];
  if(!fragments.length||new Set(fragments.map(steelFragmentKey)).size!==fragments.length||fragments.some(f=>!allowed.some(a=>same(a,f))))throw Error('Выберите исходные строки основания применимости для ПД и РД.');
 }
 return matrixSteelApplicabilityReviewInputSchema.parse({schemaVersion:'matrix-kr056-steel-applicability-review-v1',status:basis.approved?'APPROVED':'UNKNOWN',identity:expected.claim.identity,expected:pd,actual:rd,
  basis:{reference:basis.reference,expectedScopeFragments:basis.expectedScopeFragments,actualScopeFragments:basis.actualScopeFragments,catalogScope:'ONLY_KR056_EXPLICIT_C345_TO_C245',standardsTreatment:'RETAINED_DIFFERENCES_HUMAN_REVIEWED_NO_NORMATIVE_EQUIVALENCE',profilesTreatment:'RETAINED_DIFFERENCES_NO_GEOMETRY_OR_STRENGTH_RANK'},expectedReviewHash:previous?.contentHash??null});
}
export function withdrawSteelApplicability(raw:SteelApplicabilityReviewDecision):SteelApplicabilityReviewInput {
 const decision=matrixSteelApplicabilityReviewDecisionSchema.parse(raw),p=decision.projection;
 return matrixSteelApplicabilityReviewInputSchema.parse({schemaVersion:'matrix-kr056-steel-applicability-review-v1',status:'WITHDRAWN',identity:p.identity,expected:p.expected,actual:p.actual,basis:p.basis,expectedReviewHash:decision.contentHash});
}
const fields=[['entityKey','Общий идентификатор элемента'],['buildingKey','Здание'],['zoneKey','Зона или ярус'],['memberKey','Физический элемент']] as const;
function NewSteelClaim({loaded,onAdd,onOpen}:{loaded:SteelLoadedSource;onAdd:(id:string,human:SteelHumanMapping)=>void;onOpen?:(fragment:SourceDeclarationFragment)=>void}) {
 const [id,setId]=useState(''),[reference,setReference]=useState(''),[sameMember,setSameMember]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const [pageNumber,setPageNumber]=useState(0);
 const [identity,setIdentity]=useState<SteelComparisonIdentity>({entityKey:'',buildingKey:'',zoneKey:'',memberKey:'',componentRole:'DISTRIBUTION_BELT_I_BEAM'});
 const d=loaded.declarations.find(d=>d.id===id),page=d&&loaded.pages.find(p=>p.pageNumber===(pageNumber||d.pageNumber));
 return <div aria-label="Сопоставление элемента"><label>Исходная декларация стали<select value={id} onChange={e=>{setId(e.target.value);setPageNumber(loaded.declarations.find(d=>d.id===e.target.value)?.pageNumber??0);setSameMember(false);setSelected([]);}}><option value="">Выберите декларацию</option>{loaded.declarations.map(d=><option key={d.id} value={d.id}>{d.stage} · PDF {d.pageNumber} · {d.rawValue} · {sourceDeclarationScopeLabel(d)}</option>)}</select></label>
 {d&&<><p>{sourceDeclarationScopeLabel(d)}. Указаны {d.productScope.productStandard}; {d.productScope.gradeStandard}.</p>
 {[...d.primaryFragments,...d.scopeFragments].map((f,i)=><pre key={i} style={{whiteSpace:'pre-wrap'}}>{f.rawText}</pre>)}
 {fields.map(([key,label])=><label key={key}>{label}<input value={identity[key]} maxLength={200} onChange={e=>{setIdentity({...identity,[key]:e.target.value});setSameMember(false);}}/></label>)}
 <p>Выберите исходные строки, по которым сопоставлен физический элемент. Каждая строка сохраняется целиком.</p>
 <label>Страница основания сопоставления<select value={page?.pageNumber??''} onChange={e=>setPageNumber(Number(e.target.value))}>{loaded.pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>PDF {p.pageNumber}</option>)}</select></label>
 <p>Выбрано строк: {selected.length} / 16. Выбор сохраняется при переходе между страницами.</p>
 <div style={{maxHeight:280,overflow:'auto'}}>{page?.fragments.map(f=><div key={steelFragmentKey(f)}><label style={{display:'block',whiteSpace:'pre-wrap'}}><input type="checkbox" checked={selected.includes(steelFragmentKey(f))} disabled={!selected.includes(steelFragmentKey(f))&&selected.length>=16} onChange={e=>{setSameMember(false);setSelected(keys=>e.target.checked?[...keys,steelFragmentKey(f)]:keys.filter(k=>k!==steelFragmentKey(f)));}}/>{f.rawText}</label>{onOpen&&<button type="button" onClick={()=>onOpen(f)}>Открыть строку на PDF</button>}</div>)}</div>
 <label>Основание сопоставления<textarea value={reference} maxLength={1000} onChange={e=>setReference(e.target.value)}/></label>
 <label><input type="checkbox" checked={sameMember} onChange={e=>setSameMember(e.target.checked)}/>Человек сопоставил эту декларацию с тем же физическим элементом ПД и РД</label>
 <button type="button" onClick={()=>onAdd(id,{identity,reference,sameMember,fragments:selected.map(key=>loaded.pages.flatMap(p=>p.fragments).find(f=>steelFragmentKey(f)===key)!).filter(Boolean)})}>Добавить привязку стали в черновик</button></>}
 </div>;
}
export function SteelSourceReviewFields({identity,value,loaded,onChange,disabled,onOpen}:{identity:SteelSourceIdentity;value?:SteelComparisonScopeRequest;loaded?:SteelLoadedSource;onChange:(value:SteelComparisonScopeRequest)=>void;disabled:boolean;onOpen?:(fragment:SourceDeclarationFragment)=>void}) {
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 return <fieldset disabled={disabled} aria-label="Привязки деклараций стали"><legend>Сталь · KR-056</legend>
 <p>Привязка декларации к элементу требует проверки исходного PDF. Применимость пары ПД/РД согласуется отдельно. Уверенность не измерена.</p>
 {(value?.claims??[]).map((c,i)=><article key={JSON.stringify([i,c.target,c.identity])}><strong>{c.identity.entityKey} · {c.identity.memberKey}</strong><p>{c.identity.buildingKey} · {c.identity.zoneKey}</p><p>Сопоставление: {c.memberMapping.assertion==='UNKNOWN'?'не подтверждено':'подтверждено человеком'}. Основание: {c.memberMapping.reference}</p><small>Запуск {c.target.checkId} · Декларация {c.target.declarationId}</small><p><button type="button" onClick={()=>{if(!disabled&&value){onChange(withdrawSteelClaim(value,i));setNotice('Отзыв в черновике. Сохраните решение по источнику.');}}}>Отозвать привязку стали {i+1}</button></p></article>)}
 {value?.claims.length===0&&<p>Все привязки стали отозваны в черновике. Сохраните решение по источнику.</p>}
 {loaded&&same(loaded.identity,identity)?<NewSteelClaim loaded={loaded} onOpen={onOpen} onAdd={(id,human)=>{if(disabled)return;try{onChange(appendSteelClaim(value,loaded,id,human));setError('');setNotice('Привязка добавлена в черновик. Сохраните решение по источнику, затем согласуйте пару ПД/РД.');}catch(e){setError(e instanceof Error?e.message:String(e));}}}/>:<p>Новая привязка требует загрузки исходных деклараций из завершённой проверки.</p>}
 {loaded?.declarations.length===0&&<p>Поддержанных деклараций стали в этом источнике нет. Привязка не создана.</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </fieldset>;
}
