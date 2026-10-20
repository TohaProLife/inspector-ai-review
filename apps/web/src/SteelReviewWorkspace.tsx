import {useEffect,useRef,useState} from 'react';
import {matrixSteelApplicabilityReviewDecisionSchema,type SteelComparisonScopeRequest,type SteelApplicabilityReviewDecision,type SourceDeclarationFragment,type InspectorEvidence} from '@inspector-ai/contracts';
import {api} from './api';
import {SteelSourceReviewFields,loadSteelSource,steelApplicabilityInput,withdrawSteelApplicability,steelPairMatches,steelFragmentKey,steelJsonEqual,steelPairFragmentEvidence,
 type SteelSourceIdentity,type SteelLoadedSource,type SteelPairSelection} from './SteelReview';
import {InspectorEvidenceViewer} from './InspectorEvidenceViewer';
export function SteelSourceReviewWorkspace(props:{identity:SteelSourceIdentity;value?:SteelComparisonScopeRequest;onChange:(value:SteelComparisonScopeRequest)=>void;disabled:boolean}) {
 return <SteelSourceWorkspaceBody key={JSON.stringify(props.identity)} {...props}/>;
}
function SteelSourceWorkspaceBody({identity,value,onChange,disabled}:{identity:SteelSourceIdentity;value?:SteelComparisonScopeRequest;onChange:(value:SteelComparisonScopeRequest)=>void;disabled:boolean}) {
 const [loaded,setLoaded]=useState<SteelLoadedSource>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[opened,setOpened]=useState<InspectorEvidence>();
 const generation=useRef(0),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{if(disabled){generation.current++;request.current?.abort();setBusy(false);setLoaded(undefined);setOpened(undefined);}},[disabled]);
 async function load(){if(disabled||busy)return;request.current?.abort();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);setError('');setLoaded(undefined);setOpened(undefined);
  try{const value=await loadSteelSource(identity,controller.signal);if(id===generation.current)setLoaded(value);}catch(e){if(id===generation.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{if(id===generation.current)setBusy(false);}
 }
 function open(f:SourceDeclarationFragment){if(!loaded)return;const page=loaded.pages.find(p=>p.pageNumber===f.pageNumber),stage=loaded.origin.pageStages[String(f.pageNumber)]??loaded.origin.stage;
  if(!page||!['PD','RD'].includes(stage))return;const b=f.bboxMilliPoints;
  setOpened({id:`steel-source:${f.pageNumber}:${f.blockIndex}:${f.lineIndex}`,sourceFileId:identity.file.id,sourceSha256:identity.file.sha256,stage:stage as 'PD'|'RD',pageNumber:f.pageNumber,sheet:null,revision:null,value:f.rawText,unit:null,element:'Исходная строка; сопоставление требует решения человека',bbox:[b[0]/page.widthMilliPoints,1-b[3]/page.heightMilliPoints,b[2]/page.widthMilliPoints,1-b[1]/page.heightMilliPoints]});
 }
 return <section aria-label="Подготовка деклараций стали" style={{overflowWrap:'anywhere'}}><h3>Сталь: исходные декларации и физический элемент</h3>
 <button type="button" disabled={disabled||busy} onClick={()=>void load()}>{busy?'Проверяем исходные декларации…':'Загрузить декларации стали выбранной проверки'}</button>
 {error&&<p role="alert">{error}</p>}
 {loaded&&<details><summary>Оригинальные строки для проверки элемента</summary>{loaded.pages.filter(p=>loaded.declarations.some(d=>d.pageNumber===p.pageNumber)).map(page=><div key={page.pageNumber}><h4>PDF {page.pageNumber}</h4>{page.fragments.map(f=><p key={steelFragmentKey(f)} style={{whiteSpace:'pre-wrap'}}>{f.rawText}{' '}<button type="button" onClick={()=>{const b=f.bboxMilliPoints;setOpened({id:`steel-source:${f.pageNumber}:${f.blockIndex}:${f.lineIndex}`,sourceFileId:identity.file.id,sourceSha256:identity.file.sha256,stage:loaded.declarations.find(d=>d.pageNumber===f.pageNumber)!.stage,pageNumber:f.pageNumber,sheet:null,revision:null,value:f.rawText,unit:null,element:'Исходная строка; сопоставление требует решения человека',bbox:[b[0]/page.widthMilliPoints,1-b[3]/page.heightMilliPoints,b[2]/page.widthMilliPoints,1-b[1]/page.heightMilliPoints]});}}>Открыть строку на PDF</button></p>)}</div>)}</details>}
 <SteelSourceReviewFields identity={identity} loaded={loaded} value={value} onChange={onChange} onOpen={open} disabled={disabled||busy}/>
 {opened&&<InspectorEvidenceViewer objectId={identity.objectId} stage={opened.stage} evidence={opened} file={identity.file} onOpened={()=>{}}/>}
 </section>;
}
const itemKey=(s:SteelPairSelection)=>JSON.stringify([s.file.id,s.review.id,s.claim.target.declarationId,s.claim.identity]);
function basisLines(s:SteelPairSelection):SourceDeclarationFragment[]{const values=[...s.claim.declarationSnapshot.primaryFragments,...s.claim.declarationSnapshot.scopeFragments,...s.claim.memberMapping.scopeFragments];return values.filter((f,i)=>values.findIndex(other=>steelJsonEqual(other,f))===i);}
const statusLabel={UNKNOWN:'Применимость не установлена',APPROVED:'Применимость согласована человеком',WITHDRAWN:'Согласование отозвано'};
export function SteelApplicabilityWorkspace({objectId,disabled,refreshKey}:{objectId:string;disabled:boolean;refreshKey?:string|null}) {
 return <SteelPairWorkspaceBody key={JSON.stringify([objectId,refreshKey])} objectId={objectId} disabled={disabled}/>;
}
function SteelPairWorkspaceBody({objectId,disabled}:{objectId:string;disabled:boolean}) {
 const [items,setItems]=useState<SteelApplicabilityReviewDecision[]>([]),[sources,setSources]=useState<SteelPairSelection[]>([]),[canReview,setCanReview]=useState(false);
 const [expected,setExpected]=useState(''),[actual,setActual]=useState(''),[reference,setReference]=useState(''),[approved,setApproved]=useState(false),[expectedLines,setExpectedLines]=useState<string[]>([]),[actualLines,setActualLines]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[opened,setOpened]=useState<{selection:SteelPairSelection;evidence:InspectorEvidence}>();
 const generation=useRef(0),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{if(disabled){generation.current++;request.current?.abort();setBusy(false);setApproved(false);setLoaded(false);setSources([]);}},[disabled]);
 const pd=sources.find(s=>itemKey(s)===expected),rd=sources.find(s=>itemKey(s)===actual);
 async function refresh(){if(disabled||busy)return;request.current?.abort();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);setLoaded(false);setCanReview(false);setError('');setApproved(false);setExpected('');setActual('');setSources([]);setItems([]);setOpened(undefined);
  try{const [journal,files]=await Promise.all([api.getSteelApplicabilityReviews(objectId,controller.signal),api.listSourceFiles(objectId)]);controller.signal.throwIfAborted();
   if(!Array.isArray(journal.items)||journal.items.length>16)throw Error('Некорректный список согласований.');
   const decisions=journal.items.map(d=>matrixSteelApplicabilityReviewDecisionSchema.parse(d));if(decisions.some(d=>d.objectId!==objectId))throw Error('Согласование относится к другому объекту.');
   // Bound parallel reads. Each source is fetched only by explicit action; missing historical reviews stay visible in the journal.
   const eligible=files.items.filter(f=>f.review?.revisionStatus==='CURRENT'&&f.review.approvalStatus==='APPROVED'&&f.review.sectionCode==='KR'&&f.review.linkGroupId&&f.stages.length===1&&['PD','RD'].includes(f.stages[0]));
   const candidates:SteelPairSelection[]=[];
   for(let offset=0;offset<eligible.length;offset+=4){controller.signal.throwIfAborted();const batch=await Promise.all(eligible.slice(offset,offset+4).map(async file=>{
    const review=await api.getSourceReview(objectId,file.id,controller.signal);if(!review)return [];
    if(review.objectId!==objectId||review.sourceFileId!==file.id||review.sourceSha256!==file.sha256||review.contentHash!==file.review?.contentHash)throw Error('Решения по источникам изменились. Повторите загрузку.');
    return (review.steelComparisonScope?.claims??[]).map(claim=>({file,review,claim}));}));candidates.push(...batch.flat());}
   if(id!==generation.current)return;setItems(decisions);setSources(candidates);setCanReview(journal.canReview&&files.permissions.review);setLoaded(true);
  }catch(e){if(id===generation.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}finally{if(id===generation.current)setBusy(false);}
 }
 async function save(withdraw?:SteelApplicabilityReviewDecision){if(disabled||busy||!loaded||!canReview)return;
  let input;try{if(withdraw)input=withdrawSteelApplicability(withdraw);else{if(!pd||!rd)throw Error('Выберите сохранённые декларации ПД и РД.');const previous=items.find(d=>steelPairMatches(d,pd,rd));input=steelApplicabilityInput(pd,rd,{reference,approved,expectedScopeFragments:basisLines(pd).filter(f=>expectedLines.includes(steelFragmentKey(f))),actualScopeFragments:basisLines(rd).filter(f=>actualLines.includes(steelFragmentKey(f)))},previous);}}catch(e){setError(e instanceof Error?e.message:String(e));return;}
  const id=++generation.current,controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setNotice('');
  try{const decision=matrixSteelApplicabilityReviewDecisionSchema.parse(await api.recordSteelApplicabilityReview(objectId,input,controller.signal));if(id!==generation.current)return;if(decision.objectId!==objectId)throw Error('Решение относится к другому объекту.');setItems(rows=>[decision,...rows.filter(d=>d.projection.expected.sourceFileId!==decision.projection.expected.sourceFileId||d.projection.actual.sourceFileId!==decision.projection.actual.sourceFileId||!steelJsonEqual(d.projection.identity,decision.projection.identity))]);setApproved(false);setNotice('Решение сохранено. Его использует следующая проверка; прежние результаты сохраняют свой снимок.');}
  catch(e){if(id===generation.current&&!controller.signal.aborted){setError(e instanceof Error?e.message:String(e));setLoaded(false);setCanReview(false);setApproved(false);}}finally{if(id===generation.current)setBusy(false);}
 }
 async function open(selection:SteelPairSelection,f:SourceDeclarationFragment){if(disabled||busy)return;const id=++generation.current,controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setOpened(undefined);setApproved(false);
  try{const loaded=await loadSteelSource({objectId,checkId:selection.claim.target.checkId,file:selection.file,reviewHash:selection.review.contentHash},controller.signal);const evidence=steelPairFragmentEvidence(selection,f,loaded);if(id===generation.current)setOpened({selection,evidence});}
  catch(e){if(id===generation.current&&!controller.signal.aborted){setError(e instanceof Error?e.message:String(e));setLoaded(false);setCanReview(false);}}finally{if(id===generation.current)setBusy(false);}
 }
 return <section className="surface" aria-label="Согласование применимости пары стали" style={{padding:16,overflowWrap:'anywhere'}}><h3>Сталь: применимость пары ПД/РД</h3>
 <p>Отдельное решение инспектора для одного физического элемента. Поддержана только буквальная замена С345 на С245. Различия стандартов и профилей сохраняются; нормативная эквивалентность и прочность не подтверждаются.</p>
 <button type="button" disabled={disabled||busy} onClick={()=>void refresh()}>{busy?'Выполняется…':'Загрузить согласования и сохранённые привязки'}</button>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {items.map(d=><article key={d.id}><strong>{d.projection.identity.entityKey} · {d.projection.identity.memberKey}</strong><p>{statusLabel[d.projection.status]}. {d.projection.basis.reference}</p><p>ПД {d.projection.expected.sourceFileId} · РД {d.projection.actual.sourceFileId}</p><small>Решение {d.id} · {d.createdAt} · SHA журнала {d.contentHash}</small><p><button type="button" disabled={disabled||busy||!loaded||!canReview||d.projection.status==='WITHDRAWN'} onClick={()=>void save(d)}>Отозвать согласование этой пары</button></p></article>)}
 {loaded&&<fieldset disabled={disabled||busy||!canReview}><legend>Новое решение о применимости</legend>{!canReview&&<p>Учётная запись может читать решения; право согласования отсутствует.</p>}
 {(['PD','RD'] as const).map(stage=><label key={stage}>Декларация {stage==='PD'?'ПД':'РД'}<select value={stage==='PD'?expected:actual} onChange={e=>{setApproved(false);if(stage==='PD'){setExpected(e.target.value);setExpectedLines([]);}else{setActual(e.target.value);setActualLines([]);}}}><option value="">Выберите сохранённую привязку</option>{sources.filter(s=>s.claim.declarationSnapshot.stage===stage).map(s=><option key={itemKey(s)} value={itemKey(s)}>{s.file.name} · {s.claim.identity.entityKey} · {s.claim.identity.memberKey} · {s.claim.declarationSnapshot.rawValue}</option>)}</select></label>)}
 {([['EXPECTED',pd,expectedLines,setExpectedLines],['ACTUAL',rd,actualLines,setActualLines]] as const).map(([role,s,selected,setSelected])=>s&&<div key={role}><h4>{role==='EXPECTED'?'ПД':'РД'}: строки основания</h4><p>{s.claim.declarationSnapshot.productScope.productStandard}; {s.claim.declarationSnapshot.productScope.gradeStandard}</p>{basisLines(s).map(f=><div key={steelFragmentKey(f)}><label style={{whiteSpace:'pre-wrap'}}><input type="checkbox" checked={selected.includes(steelFragmentKey(f))} onChange={e=>{setApproved(false);setSelected(keys=>e.target.checked?[...keys,steelFragmentKey(f)]:keys.filter(k=>k!==steelFragmentKey(f)));}}/>{f.rawText}</label><button type="button" onClick={()=>void open(s,f)}>Открыть основание на PDF · {f.pageNumber}</button></div>)}</div>)}
 <label>Основание применимости<textarea value={reference} maxLength={1000} onChange={e=>{setReference(e.target.value);setApproved(false);}}/></label>
 <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>Человек проверил оригиналы, один физический элемент и применимость именно этой пары деклараций с сохранением различий стандартов и профилей</label>
 <button type="button" disabled={!pd||!rd} onClick={()=>void save()}>{approved?'Согласовать применимость пары':'Сохранить: применимость не установлена'}</button>
 </fieldset>}
 {opened&&<InspectorEvidenceViewer key={JSON.stringify([opened.selection.file.id,opened.evidence])} objectId={objectId} stage={opened.evidence.stage} evidence={opened.evidence} file={opened.selection.file} onOpened={()=>{}}/>}
 </section>;
}
