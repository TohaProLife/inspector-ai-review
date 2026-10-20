import {useState} from "react";
import {matrixLightingTechnologySelectionSchema,matrixLightingTechnologyTargetSchema,matrixLightingTechnologyDeclarationSchema,
  matrixLightingTechnologyScopeInputSchema,type MatrixLightingTechnologyScopeInput,type MatrixLightingTechnologyPreviewRead,
  type LightingTechnologyV3Selection,type DocumentTextV3AuditSourceRead,type LightingTechnologyComparisonIdentity,type SourceReviewInput} from "@inspector-ai/contracts";
import {api} from "./api";
import {buildSourceTextV3Index,type SourceTextIdentity,type SourceTextV3Index} from "./source-text-explorer";
export interface LightingPreview extends MatrixLightingTechnologyPreviewRead {selection:LightingTechnologyV3Selection}
export interface LightingHumanInput {identity:LightingTechnologyComparisonIdentity;reference:string;samePosition:boolean}
const VERSION="matrix-zu130-lighting-technology-review-v1" as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const changed=()=>Error("Источник или решение изменились. Обновите исходный текст и предпросмотр освещения.");
/** Preserve all parent fields and CAS; undefined inherits, an empty claim list withdraws. */
export function withLightingReviewScope(input:Omit<SourceReviewInput,"lightingTechnologyScope">,scope?:MatrixLightingTechnologyScopeInput):SourceReviewInput {
 return {...input,...(scope?{lightingTechnologyScope:matrixLightingTechnologyScopeInputSchema.parse(scope)}:{})};
}
/** Exact native paths and raw strings only; source geometry stays server-owned. */
export function lightingSelection(index:SourceTextV3Index,pageNumber:number,paths:number[][]):LightingTechnologyV3Selection {
  if(paths.length<1||paths.length>2||new Set(paths.map(p=>JSON.stringify(p))).size!==paths.length)throw Error("Выберите одну или две разные исходные строки одного листа.");
  const fragments=paths.map(path=>{
    const rows=index.lines.filter(row=>row.pageNumber===pageNumber&&same(row.sourcePath,path));
    if(rows.length!==1||!rows[0].bboxMilliPoints)throw Error("Нужна исходная строка с точным native sourcePath и координатами.");
    return {sourcePath:[...rows[0].sourcePath],rawText:rows[0].rawText};
  });
  return matrixLightingTechnologySelectionSchema.parse({pageNumber,fragments});
}
export async function loadLightingSource(identity:SourceTextIdentity,signal:AbortSignal):Promise<DocumentTextV3AuditSourceRead> {
  signal.throwIfAborted();const check=await api.getCheck(identity.checkId,signal);signal.throwIfAborted();
  if(check.id!==identity.checkId||check.objectId!==identity.objectId||check.mode!=="NORMAL"||check.purpose!=="SOURCE_AUDIT_ONLY"
    ||check.progress!==100||!check.completedAt||!Number.isFinite(Date.parse(check.completedAt))
    ||!["PARTIAL","REVIEW_REQUIRED","CLARIFICATION_REQUIRED","READY_TO_FINALIZE","FINALIZED"].includes(check.status))throw changed();
  const origin=await api.getDocumentTextV3Source(identity.checkId,identity.file.id,signal);signal.throwIfAborted();buildSourceTextV3Index(identity,origin);
  for(const page of origin.textArtifact.pages)matrixLightingTechnologyDeclarationSchema.shape.nativeFrame.parse(page.nativeFrame);
  return origin;
}
function validateLightingPreview(identity:SourceTextIdentity,preview:LightingPreview) {
  if(preview.checkId!==identity.checkId||preview.sourceFileId!==identity.file.id||preview.sourceSha256!==identity.file.sha256
    ||preview.latestReviewHash!==identity.reviewHash||preview.result.schemaVersion!=="matrix-zu130-lighting-technology-source-v3-result-v1"
    ||preview.result.status!=="RECONSTRUCTED"||!preview.target)throw changed();
  const declaration=matrixLightingTechnologyDeclarationSchema.parse(preview.result.declaration),target=matrixLightingTechnologyTargetSchema.parse(preview.target),selection=matrixLightingTechnologySelectionSchema.parse(preview.selection);
  if(target.checkId!==identity.checkId||target.textArtifactHash!==declaration.textArtifactHash||declaration.sourceFileId!==identity.file.id
    ||declaration.sourceSha256!==identity.file.sha256||declaration.pageNumber!==selection.pageNumber
    ||!same(selection.fragments,declaration.primaryFragments.map(f=>({sourcePath:f.sourcePath,rawText:f.rawText}))))throw changed();
  return {declaration,target,selection};
}
export async function previewLightingSource(identity:SourceTextIdentity,origin:DocumentTextV3AuditSourceRead,selection:LightingTechnologyV3Selection,signal:AbortSignal):Promise<LightingPreview> {
  signal.throwIfAborted();const index=buildSourceTextV3Index(identity,origin),parsed=matrixLightingTechnologySelectionSchema.parse(selection);
  if(!same(parsed,lightingSelection(index,parsed.pageNumber,parsed.fragments.map(f=>f.sourcePath))))throw changed();
  const response=await api.previewSourceLightingTechnology(identity.checkId,identity.file.id,parsed,signal);signal.throwIfAborted();
  if(response.checkId!==identity.checkId||response.sourceFileId!==identity.file.id||response.sourceSha256!==identity.file.sha256
    ||response.latestReviewHash!==identity.reviewHash||response.result.schemaVersion!=="matrix-zu130-lighting-technology-source-v3-result-v1")throw changed();
  const preview:LightingPreview={...response,selection:parsed};
  if(response.result.status==="ABSTAIN") {
    if(response.target!==undefined||typeof response.result.reasonCode!=="string"||!response.result.reasonCode||response.result.reasonCode.length>200)throw changed();
    return preview;
  }
  const {declaration,target}=validateLightingPreview(identity,preview),page=origin.textArtifact.pages[parsed.pageNumber-1];
  if(!page||target.inputManifestHash!==origin.inputManifestHash||target.textStageContentHash!==origin.textStageContentHash
    ||target.textArtifactHash!==origin.textArtifactContentHash||declaration.extractorProfileHash!==origin.extractorProfileHash
    ||declaration.stage!==(origin.pageStages[String(parsed.pageNumber)]??origin.stage)
    ||declaration.pageWidthMilliPoints!==page.widthMilliPoints||declaration.pageHeightMilliPoints!==page.heightMilliPoints
    ||!same(declaration.nativeFrame,page.nativeFrame))throw changed();
  for(const fragment of declaration.primaryFragments) {
    const original=page.locatedLines.find(row=>same(row.sourcePath,fragment.sourcePath));
    if(!original||fragment.pageNumber!==page.pageNumber||fragment.rawText!==original.rawText
      ||!same(fragment.nativeBoxPointStrings,original.nativeBoxPointStrings)||!same(fragment.bboxMilliPoints,original.bboxMilliPoints))throw changed();
  }
  return preview;
}
export function appendLightingPreview(scope:MatrixLightingTechnologyScopeInput|undefined,identity:SourceTextIdentity,preview:LightingPreview,human:LightingHumanInput):MatrixLightingTechnologyScopeInput {
  const {declaration,target,selection}=validateLightingPreview(identity,preview);
  if(!Array.isArray(identity.file.stages)||identity.file.stages.length!==1||!["PD","RD"].includes(identity.file.stages[0])
    ||declaration.stage!==identity.file.stages[0])throw Error("Привязка позиции освещения требует отдельного источника ПД или РД с подтверждённой стадией.");
  if(declaration.scopeStatus!=="NAMED_POSITION_LITERAL"||!declaration.positionLabel)throw Error("Групповое указание без названной позиции нельзя сопоставить с физическим светильником.");
  const prior=scope?matrixLightingTechnologyScopeInputSchema.parse(scope):undefined;
  if(prior?.claims.some(c=>c.target.declarationContentHash===target.declarationContentHash))throw Error("Эта декларация уже в черновике. Для замены явно отзовите прежнюю привязку.");
  return matrixLightingTechnologyScopeInputSchema.parse({schemaVersion:VERSION,claims:[...(prior?.claims??[]),{
    target,selection,identity:human.identity,positionMapping:{kind:"HUMAN_REVIEWED_LIGHTING_POSITION_MAPPING",sourcePositionLabel:declaration.positionLabel,
      assertion:human.samePosition?"HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION":"UNKNOWN"},reference:human.reference,
  }]});
}
export function withdrawLightingClaim(scope:MatrixLightingTechnologyScopeInput,index:number):MatrixLightingTechnologyScopeInput {
  const parsed=matrixLightingTechnologyScopeInputSchema.parse(scope);
  if(!Number.isSafeInteger(index)||index<0||!parsed.claims[index])throw Error("Привязка отсутствует в черновике.");
  return {...parsed,claims:parsed.claims.filter((_,i)=>i!==index)};
}
const fields=[["entityKey","Общий идентификатор позиции"],["buildingKey","Здание"],["systemKey","Система освещения"],["positionKey","Позиция для сопоставления"]] as const;
function LightingNewClaim({identity,preview,onAdd}:{identity:SourceTextIdentity;preview:LightingPreview;onAdd:(human:LightingHumanInput)=>void}) {
  const [human,setHuman]=useState<LightingHumanInput>({identity:{entityKey:"",buildingKey:"",systemKey:"",positionKey:"",componentRole:"LUMINAIRE_LIGHT_SOURCE"},reference:"",samePosition:false});
  const [error,setError]=useState("");
  let verified:ReturnType<typeof validateLightingPreview>|undefined;
  try{verified=validateLightingPreview(identity,preview);}catch{/* Display only; no draft from an invalid preview. */}
  if(!verified)return <p role="alert">Предпросмотр устарел. Повторно выберите исходные строки.</p>;
  const d=verified.declaration;
  return <div aria-label="Сопоставление позиции освещения">
    <p><strong>{d.technology}</strong> · Исходное обозначение: {d.positionLabel??"без названной позиции"} · {d.stage} · PDF {d.pageNumber}</p>
    {d.primaryFragments.map((f,i)=><pre key={i} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>Путь {f.sourcePath.join(" / ")}: {f.rawText}</pre>)}
    <p>Уверенность не измерена. Видимость строки на PDF и инженерная корректность не подтверждены.</p>
    {d.scopeStatus!=="NAMED_POSITION_LITERAL"?<p>Групповая декларация доступна для чтения. Привязка к отдельному светильнику недоступна.</p>:<>
      {fields.map(([key,label])=><label key={key}><span>{label}</span><input value={human.identity[key]} maxLength={200}
        onChange={e=>setHuman({...human,identity:{...human.identity,[key]:e.target.value},samePosition:false})}/></label>)}
      <label><span>Основание сопоставления позиции освещения</span><textarea value={human.reference} maxLength={1000}
        onChange={e=>setHuman({...human,reference:e.target.value})}/></label>
      <label><input type="checkbox" checked={human.samePosition} onChange={e=>setHuman({...human,samePosition:e.target.checked})}/>
        Человек сопоставил исходное обозначение с той же позицией светильника и источника света в ПД и РД</label>
      <button type="button" onClick={()=>{try{onAdd(human);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Добавить позицию освещения в черновик</button>
      {error&&<p role="alert">{error}</p>}
    </>}
  </div>;
}
export function LightingTechnologyReviewFields({identity,value,onChange,disabled,preview,canAdd=true}:{
 identity:SourceTextIdentity;value?:MatrixLightingTechnologyScopeInput;onChange:(v:MatrixLightingTechnologyScopeInput)=>void;disabled:boolean;preview?:LightingPreview;canAdd?:boolean;
}) {
  const [notice,setNotice]=useState("");
  return <fieldset disabled={disabled} aria-label="Привязки технологии освещения"><legend>Технология источника света · ZU-130</legend>
    <p>Сравнение ограничено одной названной позицией ПД и РД. Одинаковые идентификаторы, исходное обозначение и основание задаёт инспектор после сверки оригиналов.</p>
    {(value?.claims??[]).map((c,i)=><article key={JSON.stringify([i,c.target,c.identity])}>
      <strong>{c.positionMapping.sourcePositionLabel} · {c.identity.entityKey}</strong>
      <p>{c.identity.buildingKey} · {c.identity.systemKey} · {c.identity.positionKey} · PDF {c.selection.pageNumber}</p>
      <p>Сопоставление: {c.positionMapping.assertion==="UNKNOWN"?"не подтверждено":"подтверждено человеком"}. Основание: {c.reference}</p>
      <p><small>Запуск {c.target.checkId} · Декларация {c.target.declarationContentHash}</small></p>
      <button type="button" onClick={()=>{if(value){onChange(withdrawLightingClaim(value,i));setNotice("Отзыв в черновике. Сохраните решение по источнику.");}}}>Отозвать привязку освещения {i+1}</button>
    </article>)}
    {value?.claims.length===0&&<p>Все привязки освещения отозваны в черновике. Сохраните решение по источнику.</p>}
    {!preview&&<p>Новая привязка требует предпросмотра одной или двух исходных строк полного текста v3.</p>}
    {preview?.result.status==="ABSTAIN"&&<p role="status">Декларация не восстановлена: {preview.result.reasonCode}. Вывод и привязка не созданы.</p>}
    {!canAdd&&<p>Смешанный источник или ИД доступен для чтения. Новая привязка требует отдельного источника ПД или РД. Существующие привязки можно отозвать.</p>}
    {canAdd&&preview?.result.status==="RECONSTRUCTED"&&<LightingNewClaim key={JSON.stringify([identity,preview.target,preview.selection])} identity={identity} preview={preview}
      onAdd={human=>{if(disabled)return;onChange(appendLightingPreview(value,identity,preview,human));setNotice("Позиция добавлена в черновик. Сохраните решение по источнику, затем запустите новую проверку.");}}/>}
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
