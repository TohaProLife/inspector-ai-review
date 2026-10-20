import {railInventoryScopeDecisionToInput} from "@inspector-ai/contracts";
import { useEffect, useRef, useState } from "react";
import { callInventoryScopeDecisionToInput, inventoryScopeDecisionToInput, matrixFactScopeSchema, matrixFactScopeTargetSchema, sourceReviewSchema } from "@inspector-ai/contracts";
import type { MatrixFactScope, MatrixFactScopeTarget, MatrixObservation, SourceReviewDecision, SourceReviewInput, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { projectZeroAuthorityOptions, type ProjectZeroAuthorityOption } from "./matrix-project-zero-authority";
import { MatrixFactScopeEditor } from "./MatrixFactScopeEditor";
import { buildMatrixFactReviewPreflight } from "./matrix-fact-review-preflight";
import { MatrixFactReviewPreflight } from "./MatrixFactReviewPreflight";

type Selection = {objectId:string;checkId:string;executionContentHash:string;fact:MatrixObservation;projectZeroSources?:SourceFileSummary[];preferredRuleId?:string;concreteWallReviewAvailable?:boolean};
type LoadedReview = {target:MatrixFactScopeTarget;fragmentsHash?:string;prior:SourceReviewDecision|null;
  scope:MatrixFactScope;legacy:boolean;projectZeroAuthorities:ProjectZeroAuthorityOption[]};
type ReviewPresentation = {currentFile?:Pick<SourceFileSummary,"id"|"sha256">|null;
  onSource?:(file:{id:string;sha256:string})=>void;savedReasonCode?:string|null};
const emptyScope = ():MatrixFactScope => ({schemaVersion:"matrix-fact-scopes-v1",bindings:[]});
const hash=/^[a-f0-9]{64}$/u;
const isLegacy=(prior:SourceReviewDecision|null)=>!!prior?.matrixScope&&!("schemaVersion" in prior.matrixScope);

function verifySourceReview(prior:SourceReviewDecision|null, objectId:string, fact:MatrixObservation):void {
  if(prior&&(prior.objectId!==objectId||prior.sourceFileId!==fact.sourceFileId
    ||prior.sourceSha256!==fact.sourceSha256||!hash.test(prior.contentHash)))
    throw Error("Сохранённое решение относится к другой версии источника. Перезагрузите данные.");
}

/** Read both independent authorities; an observation ID alone is not an evidence address. */
export async function loadMatrixFactScopeReview(input:Selection&{signal?:AbortSignal}):Promise<LoadedReview> {
  const {objectId,checkId,executionContentHash,fact,signal}=input;
  signal?.throwIfAborted();
  if(fact.method!=="TEXT_LAYER")throw Error("Привязка исходного факта доступна только для текстового слоя.");
  const [targets,prior]=await Promise.all([api.getMatrixFactTargets(checkId,signal),
    api.getSourceReview(objectId,fact.sourceFileId,signal)]);
  signal?.throwIfAborted();
  const matches=targets.items.filter(item=>item.sourceFileId===fact.sourceFileId&&item.target.observationId===fact.id);
  const item=matches[0];
  if(targets.checkId!==checkId||targets.executionContentHash!==executionContentHash||matches.length!==1
    ||!matrixFactScopeTargetSchema.safeParse(item?.target).success||item.target.checkId!==checkId
    ||item.target.executionContentHash!==executionContentHash
    ||(item.fragmentsHash!==undefined&&!hash.test(item.fragmentsHash)))
    throw Error("Адрес исходного факта не совпадает с сохранённым результатом запуска. Перезагрузите данные.");
  verifySourceReview(prior,objectId,fact);
  const scope=prior?.matrixScope&&"schemaVersion" in prior.matrixScope
    ?matrixFactScopeSchema.parse(prior.matrixScope):emptyScope();
  let projectZeroAuthorities:ProjectZeroAuthorityOption[]=[];
  if(fact.attribute==="PROJECT_ZERO_ABSOLUTE_ELEVATION"&&fact.stage==="RD") {
    const files=(input.projectZeroSources??[]).filter(file=>file.stages.includes("PD"));
    if(files.length>50)throw Error("Слишком много источников ПД для выбора основания. Уточните комплект документов.");
    const decisions=await Promise.all(files.map(file=>api.getSourceReview(objectId,file.id,signal)));
    signal?.throwIfAborted();
    projectZeroAuthorities=files.flatMap((file,index)=>projectZeroAuthorityOptions(objectId,file,decisions[index]));
  }
  return {target:item.target,projectZeroAuthorities,...(item.fragmentsHash?{fragmentsHash:item.fragmentsHash}:{}),prior,scope,legacy:isLegacy(prior)};
}

type SaveInput = {objectId:string;fact:MatrixObservation;prior:SourceReviewDecision|null;scope:MatrixFactScope;
  basisReference:string;canReview:boolean;replaceLegacyConfirmed:boolean};

/** Preserve source judgments; reviewing a fact never promotes revision or approval. */
export function prepareMatrixFactScopeReviewInput(input:SaveInput):SourceReviewInput {
  const {objectId,fact,prior,scope,basisReference,canReview,replaceLegacyConfirmed}=input;
  if(!canReview)throw Error("Нет прав на сохранение решения по источнику.");
  if(fact.method!=="TEXT_LAYER")throw Error("Привязка исходного факта доступна только для текстового слоя.");
  verifySourceReview(prior,objectId,fact);
  if(isLegacy(prior)&&!replaceLegacyConfirmed)throw Error("Явно подтвердите замену прежней области файла привязками отдельных строк.");
  const parsed=matrixFactScopeSchema.parse(scope);
  const reference=basisReference.trim()||parsed.bindings.find(binding=>binding.target.observationId===fact.id)?.reference||"";
  if(reference.trim().length<8)throw Error("Укажите основание сохранения от 8 символов. Для удаления привязок нужно отдельное основание.");
  return sourceReviewSchema.parse({sourceSha256:fact.sourceSha256,
    revisionStatus:prior?.revisionStatus??"UNKNOWN",approvalStatus:prior?.approvalStatus??"UNKNOWN",
    linkGroupId:prior?.linkGroupId??null,sectionCode:prior?.sectionCode??null,pageStages:{...prior?.pageStages},
    basis:{reference},matrixScope:parsed,
    ...(prior?.inventoryScope?{inventoryScope:inventoryScopeDecisionToInput(prior.inventoryScope)}:{}),
    ...(prior?.callInventoryScope?{callInventoryScope:callInventoryScopeDecisionToInput(prior.callInventoryScope)}:{}),
    ...(prior?.railInventoryScope?{railInventoryScope:railInventoryScopeDecisionToInput(prior.railInventoryScope)}:{}),
    expectedReviewHash:prior?.contentHash??null});
}

/** One authenticated CAS command. A rejected command is never retried or rebased here. */
export async function saveMatrixFactScopeReview(input:SaveInput):Promise<SourceReviewDecision> {
  return api.recordSourceReview(input.objectId,input.fact.sourceFileId,prepareMatrixFactScopeReviewInput(input));
}

export function MatrixFactScopeReview(props:Selection&ReviewPresentation&{canReview:boolean}) {
  return <FactScopeReviewFields key={`${props.objectId}:${props.checkId}:${props.executionContentHash}:${props.fact.sourceFileId}:${props.fact.sourceSha256}:${props.fact.id}:${props.preferredRuleId ?? ""}`}
    {...props}/>;
}

function FactScopeReviewFields(props:Selection&ReviewPresentation&{canReview:boolean}) {
  const [loaded,setLoaded]=useState<LoadedReview|null>(null);
  const [scope,setScope]=useState<MatrixFactScope|null>(null);
  const [basis,setBasis]=useState("");
  const [replaceLegacy,setReplaceLegacy]=useState(false);
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [requiresReload,setRequiresReload]=useState(false);
  const [reload,setReload]=useState(0);
  const [activeRuleId,setActiveRuleId]=useState<string|null>(null);
  const generation=useRef(0),busy=useRef(false);
  const {objectId,checkId,executionContentHash,fact,canReview,projectZeroSources}=props;
  useEffect(()=>{
    const serial=++generation.current,controller=new AbortController();
    setLoaded(null);setScope(null);setError("");setMessage("");setRequiresReload(false);
    setDirty(false);setBasis("");setReplaceLegacy(false);
    setActiveRuleId(null);
    void loadMatrixFactScopeReview({objectId,checkId,executionContentHash,fact,projectZeroSources,signal:controller.signal})
      .then(value=>{if(serial===generation.current){setLoaded(value);setScope(value.scope);}})
      .catch((cause:unknown)=>{if(serial===generation.current&&!controller.signal.aborted)
        {setError(cause instanceof Error?cause.message:String(cause));setRequiresReload(true);}});
    return()=>{generation.current++;controller.abort();};
  },[objectId,checkId,executionContentHash,fact,projectZeroSources,reload]);
  const save=async()=>{
    if(!loaded||!scope||busy.current||requiresReload||!dirty)return;
    const input:SaveInput={objectId,fact,prior:loaded.prior,scope,basisReference:basis,
      canReview,replaceLegacyConfirmed:replaceLegacy};
    try{prepareMatrixFactScopeReviewInput(input);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));return;}
    const serial=generation.current;
    busy.current=true;setSaving(true);setError("");setMessage("");
    try{
      const saved=await saveMatrixFactScopeReview(input);
      if(serial!==generation.current)return;
      verifySourceReview(saved,objectId,fact);
      setLoaded({...loaded,prior:saved,scope,legacy:false});setDirty(false);setReplaceLegacy(false);setBasis("");
      setMessage("Решение по выбранным строкам сохранено. Для применения нужен новый запуск проверки. Машинный результат этого запуска сохранён без изменений.");
    }catch(cause){if(serial===generation.current){setError(cause instanceof Error?cause.message:String(cause));setRequiresReload(true);}}
    finally{busy.current=false;if(serial===generation.current)setSaving(false);}
  };
  const preflight=loaded&&activeRuleId&&!error&&!requiresReload?buildMatrixFactReviewPreflight({objectId,
    savedRun:{checkId,executionContentHash,reasonCode:activeRuleId===props.preferredRuleId?props.savedReasonCode??null:null},fact,target:loaded.target,
    fragmentsHash:loaded.fragmentsHash,selectedRuleId:activeRuleId,latestDecision:loaded.prior,
    currentFile:props.currentFile??null}):null;
  return <section aria-label="Сохранение привязки машинного факта" style={{marginTop:16,padding:12,border:"1px solid var(--border-subtle)",minWidth:0,overflowWrap:"anywhere"}}>
    {!canReview&&<p role="status">Нет права изменять решение по источнику. Доступен просмотр.</p>}
    {!loaded&&!error&&<p role="status">Загружаем адрес исходного факта и последнее решение по источнику…</p>}
    {loaded&&scope&&<>
      <MatrixFactScopeEditor fact={fact} target={loaded.target} fragmentsHash={loaded.fragmentsHash} projectZeroAuthorities={loaded.projectZeroAuthorities} preferredRuleId={props.preferredRuleId} concreteWallReviewAvailable={props.concreteWallReviewAvailable} value={scope}
        disabled={!canReview||saving||requiresReload} onRuleChange={setActiveRuleId} onChange={value=>{setScope(value);setDirty(true);setMessage("");setError("");}}/>
      {preflight&&<MatrixFactReviewPreflight value={preflight} onSource={props.onSource} disabled={saving||requiresReload}/>}
      {loaded.legacy&&<div role="note"><p>Ранее сохранена общая область файла. Привязки отдельных строк заменят её; прежние условия и полнота автоматически не переносятся.</p>
        <label><input type="checkbox" checked={replaceLegacy} disabled={!canReview||saving||requiresReload}
          onChange={event=>{setReplaceLegacy(event.target.checked);setDirty(true);}}/>Подтверждаю замену общей области файла привязками отдельных строк.</label></div>}
      <label style={{display:"grid",gap:4}}>Основание сохранения решения
        <textarea aria-label="Основание сохранения решения" rows={2} maxLength={1000} value={basis} disabled={!canReview||saving||requiresReload}
          style={{width:"100%",minWidth:0,boxSizing:"border-box"}} onChange={event=>{setBasis(event.target.value);setDirty(true);setMessage("");}}/>
        <small>Можно использовать основание добавленной привязки выбранной строки. Для удаления всех привязок укажите отдельное основание.</small>
      </label>
      <button type="button" className="button button--primary" style={{marginTop:12,maxWidth:"100%",whiteSpace:"normal"}}
        disabled={!canReview||saving||requiresReload||!dirty||(loaded.legacy&&!replaceLegacy)} onClick={()=>void save()}>
        {saving?"Сохраняем решение…":"Сохранить привязки источника"}</button>
    </>}
    {error&&<p role="alert">Сохранение или загрузка не выполнены: {error}</p>}
    {requiresReload&&<div><p>Черновик не перезаписан. Перезагрузите последнее решение перед повторным сохранением.</p>
      <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}} disabled={saving}
        onClick={()=>{setLoaded(null);setScope(null);setActiveRuleId(null);setReload(value=>value+1);}}>Перезагрузить решение и сбросить черновик</button></div>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
