import {useEffect,useRef,useState} from "react";
import type {CheckRun,DocumentTextV3AuditSourceRead,MatrixLightingTechnologyScopeInput,SourceFileSummary} from "@inspector-ai/contracts";
import {api} from "./api";
import {buildSourceTextV3Index,sourceTextEvidence,type SourceTextIdentity,type SourceTextV3Line} from "./source-text-explorer";
import {InspectorEvidenceViewer} from "./InspectorEvidenceViewer";
import {LightingTechnologyReviewFields,lightingSelection,loadLightingSource,previewLightingSource,type LightingPreview} from "./LightingTechnologyReview";
const actualAudit=(check:CheckRun,objectId:string)=>check.objectId===objectId&&check.mode==="NORMAL"&&check.purpose==="SOURCE_AUDIT_ONLY"&&check.sourceAuditProfileVersion===undefined;
const sealed=(check:CheckRun)=>check.progress===100&&!!check.completedAt&&Number.isFinite(Date.parse(check.completedAt))
  &&["PARTIAL","REVIEW_REQUIRED","CLARIFICATION_REQUIRED","READY_TO_FINALIZE","FINALIZED"].includes(check.status);
const latest=(rows:CheckRun[])=>[...rows].filter(c=>Number.isFinite(Date.parse(c.startedAt))).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)||b.id.localeCompare(a.id))[0]??null;
export function selectLightingSourceAudit(rows:CheckRun[],objectId:string):CheckRun|null {
 return latest(rows.filter(check=>actualAudit(check,objectId)&&sealed(check)));
}
export function LightingTechnologyAuditStatus({check}:{check:CheckRun|null}) {
 if(!check)return <p>Сохранённого полного аудита исходников пока нет.</p>;
 return <p role="status">Аудит {check.id}: {sealed(check)?"Исходный текст готов":check.status==="FAILED"?"Ошибка подготовки исходников":"Подготовка исходников"}
   {" · "}{check.progress}% · {check.currentStage}. {check.failure&&`${check.failure.code}: ${check.failure.message}`}</p>;
}
interface Props {objectId:string;file:SourceFileSummary;reviewHash:string|null;value?:MatrixLightingTechnologyScopeInput;
 onChange:(value:MatrixLightingTechnologyScopeInput)=>void;disabled:boolean;canRun:boolean;canReview:boolean;
 review:{revisionStatus:string;approvalStatus:string;sectionCode:string|null;linkGroupId:string}}
export function LightingTechnologyReviewWorkspace(props:Props) {
 return <LightingWorkspaceBody key={JSON.stringify([props.objectId,props.file.id,props.file.sha256,props.reviewHash])} {...props}/>;
}
function LightingWorkspaceBody(props:Props) {
 const [checks,setChecks]=useState<CheckRun[]>([]),[selectedAudit,setSelectedAudit]=useState("");
 const [origin,setOrigin]=useState<DocumentTextV3AuditSourceRead|null>(null),[pageNumber,setPageNumber]=useState(1),[paths,setPaths]=useState<number[][]>([]);
 const [query,setQuery]=useState(""),[preview,setPreview]=useState<LightingPreview|undefined>(),[opened,setOpened]=useState<SourceTextV3Line|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[auditError,setAuditError]=useState(""),[starting,setStarting]=useState(false),[refreshing,setRefreshing]=useState(false),[refreshToken,setRefreshToken]=useState(0);
 const request=useRef<AbortController|null>(null),generation=useRef(0),mounted=useRef(true),polls=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
 const invalidate=()=>{generation.current++;request.current?.abort();setBusy(false);setPreview(undefined);setError("");};
 useEffect(()=>{if(props.disabled)invalidate();},[props.disabled]);
 useEffect(()=>{
  const controller=new AbortController();setRefreshing(true);setAuditError("");
  void api.listObjectChecks(props.objectId,controller.signal).then(data=>{
   if(controller.signal.aborted)return;if(!Array.isArray(data.items))throw Error("Некорректный список запусков аудита.");
   setChecks(data.items.filter(c=>actualAudit(c,props.objectId)));
  }).catch(e=>{if(!controller.signal.aborted)setAuditError(e instanceof Error?e.message:String(e));}).finally(()=>{if(!controller.signal.aborted)setRefreshing(false);});
  return()=>controller.abort();
 },[props.objectId,refreshToken]);
 const audits=checks.filter(c=>actualAudit(c,props.objectId)&&sealed(c));
 const active=latest(checks.filter(c=>actualAudit(c,props.objectId)&&!c.completedAt&&c.status!=="FAILED"));
 const chosen=(selectedAudit?audits.find(c=>c.id===selectedAudit):selectLightingSourceAudit(checks,props.objectId))??null;
 useEffect(()=>{
  if(!active||polls.current>=120)return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   polls.current++;
   void api.getCheck(active.id,controller.signal).then(check=>{
    if(controller.signal.aborted)return;if(!actualAudit(check,props.objectId)||check.id!==active.id)throw Error("Аудит относится к другому объекту или режиму.");
    setChecks(rows=>rows.map(c=>c.id===check.id?check:c));
   }).catch(e=>{if(!controller.signal.aborted)setAuditError(e instanceof Error?e.message:String(e));});
  },3000);
  return()=>{clearTimeout(timer);controller.abort();};
 },[active,props.objectId]);
 const identity:SourceTextIdentity={objectId:props.objectId,checkId:chosen?.id??"NO-AUDIT",file:props.file,reviewHash:props.reviewHash};
 let index:ReturnType<typeof buildSourceTextV3Index>|null=null;
 if(origin&&chosen?.id===origin.checkId)try{index=buildSourceTextV3Index(identity,origin);}catch{/* The explicit load action reports stale sources. */}
 const pageLines=index?.lines.filter(row=>row.pageNumber===pageNumber)??[];
 const matched=pageLines.filter(row=>!query||row.rawText.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU")));
 const selectedLines=paths.map(path=>pageLines.find(row=>JSON.stringify(row.sourcePath)===JSON.stringify(path))).filter((row):row is SourceTextV3Line=>!!row);
 let selection:ReturnType<typeof lightingSelection>|undefined;
 if(index&&paths.length)try{selection=lightingSelection(index,pageNumber,paths);}catch{/* Invalid selections stay disabled. */}
 async function start() {
  if(!props.canRun||props.disabled||starting||active)return;
  setStarting(true);setAuditError("");invalidate();setOrigin(null);setPaths([]);setOpened(null);setSelectedAudit("");
  try{const check=await api.startSourceAuditV3(props.objectId);if(!mounted.current)return;
   if(!actualAudit(check,props.objectId))throw Error("Ответ запуска не подтверждает аудит исходников v3.");
   setChecks(rows=>[check,...rows.filter(c=>c.id!==check.id)]);polls.current=0;
  }catch(e){if(mounted.current)setAuditError(e instanceof Error?e.message:String(e));}
  finally{if(mounted.current)setStarting(false);}
 }
 async function load() {
  if(!chosen||props.disabled||starting)return;
  invalidate();setOrigin(null);setPaths([]);setOpened(null);const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
  try{const data=await loadLightingSource(identity,controller.signal);if(id!==generation.current)return;setOrigin(data);setPageNumber(1);setQuery("");}
  catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(id===generation.current)setBusy(false);}
 }
 async function reconstruct() {
  if(!origin||!selection||props.disabled||starting)return;
  invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
  try{const data=await previewLightingSource(identity,origin,selection,controller.signal);if(id===generation.current)setPreview(data);}
  catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(id===generation.current)setBusy(false);}
 }
 const metadataReady=props.review.revisionStatus==="CURRENT"&&props.review.approvalStatus==="APPROVED"&&!!props.review.linkGroupId.trim()
   &&(origin?.stage==="PD"?["ZU","IOS1"].includes(props.review.sectionCode??""):origin?.stage==="RD"?["IOS1","EOM"].includes(props.review.sectionCode??""):false);
 return <section aria-label="Подготовка и проверка технологии освещения" style={{overflowWrap:"anywhere"}}>
   <h3>Освещение: исходные строки ПД и РД</h3>
   <p>Подготовьте полный текст PDF, выберите одну или две исходные строки названной позиции. Сравнение проверяет только замену указанного LED на люминесцентный источник или лампу накаливания в РД.</p>
   <button type="button" disabled={props.disabled||!props.canRun||starting||!!active} onClick={()=>void start()}>{starting?"Ставим аудит в очередь…":"Подготовить полный текст исходников v3"}</button>
   <button type="button" disabled={refreshing||starting||props.disabled} onClick={()=>{polls.current=0;setRefreshToken(n=>n+1);}}>Обновить список аудитов</button>
   <LightingTechnologyAuditStatus check={active??chosen??latest(checks)}/>
   {polls.current>=120&&active&&<p>Автоматическое обновление завершено. Проверьте состояние кнопкой «Обновить список аудитов».</p>}
   {auditError&&<p role="alert">{auditError}</p>}
   <p>Аудит выполняется очередью заданий. Готовность текста не означает завершение инженерной проверки.</p>
   {audits.length>0&&<label><span>Сохранённый аудит исходников для освещения</span><select value={chosen?.id??""} disabled={busy||starting||props.disabled} onChange={e=>{
     invalidate();setSelectedAudit(e.target.value);setOrigin(null);setPaths([]);setOpened(null);
   }}>{audits.sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).map(c=><option key={c.id} value={c.id}>{c.id} · {new Date(c.startedAt).toLocaleString("ru-RU")}</option>)}</select></label>}
   <button type="button" disabled={!chosen||busy||starting||props.disabled} onClick={()=>void load()}>{busy?"Проверяем исходные данные…":"Загрузить исходные листы освещения"}</button>
   {index&&<fieldset disabled={busy||starting||props.disabled}><legend>Оригинальный текст v3</legend>
     <p>Видимость строки на PDF не подтверждена. Сверьте оригинал до сопоставления позиции. Строк без координат: {index.unlocatedLines}.</p>
     <label><span>Лист освещения PDF</span><select value={pageNumber} onChange={e=>{invalidate();setPageNumber(Number(e.target.value));setPaths([]);setOpened(null);}}>{origin!.textArtifact.pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>{p.pageNumber}</option>)}</select></label>
     <label><span>Поиск исходных строк освещения на листе</span><input value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label>
     <p>Строк на листе: {pageLines.length}. Найдено: {matched.length}; показано до 200. Выбрано {paths.length} из 2.</p>
     <div style={{maxHeight:380,overflow:"auto"}}>{matched.slice(0,200).map(row=>{
       const selected=paths.some(p=>JSON.stringify(p)===JSON.stringify(row.sourcePath));
       return <div key={row.key} style={{borderBottom:"1px solid var(--border-subtle)",padding:"8px 0"}}>
         <label><input type="checkbox" checked={selected} disabled={!row.bboxMilliPoints||!selected&&paths.length===2} onChange={e=>{
           invalidate();setPaths(current=>e.target.checked?[...current,[...row.sourcePath]]:current.filter(p=>JSON.stringify(p)!==JSON.stringify(row.sourcePath)));
         }}/> PDF {row.pageNumber} · Путь {row.sourcePath.join(" / ")}{!row.bboxMilliPoints&&" · Нет точных координат; выбор недоступен"}</label>
         <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{row.rawText}</pre>
         {row.bboxMilliPoints&&<button type="button" onClick={()=>setOpened(row)}>Открыть исходную строку освещения</button>}
       </div>;
     })}</div>
     {selectedLines.map(row=><p key={row.key}>Выбрано: {row.sourcePath.join(" / ")} · {row.rawText}</p>)}
     {opened&&<InspectorEvidenceViewer objectId={props.objectId} file={props.file} evidence={sourceTextEvidence(index,opened)} stage={index.origin.stage} onOpened={()=>{}}/>}
     <button type="button" disabled={!selection} onClick={()=>void reconstruct()}>Проверить декларацию технологии освещения</button>
   </fieldset>}
   {error&&<p role="alert">{error}</p>}
   <p>Решение по документу: {props.review.revisionStatus} / {props.review.approvalStatus} · Раздел {props.review.sectionCode??"не выбран"} · Группа {props.review.linkGroupId||"не выбрана"}.</p>
   {!metadataReady&&<p>Для сравнения сохраните актуальную согласованную редакцию, одинаковую группу ПД и РД; раздел ПД: ЗУ или ИОС1, РД: ИОС1 или ЭОМ. Значения задаются в форме источника выше.</p>}
   <LightingTechnologyReviewFields identity={identity} value={props.value} onChange={props.onChange} preview={preview}
     canAdd={props.file.stages.length===1&&["PD","RD"].includes(props.file.stages[0])} disabled={props.disabled||busy||starting||!props.canReview}/>
 </section>;
}
