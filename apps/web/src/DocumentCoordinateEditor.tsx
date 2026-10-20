import { useEffect, useRef, useState } from "react";
import { documentCoordinateInputSha256, documentCoordinatePageFrameSchema, documentCoordinatePreviewInputSchema,
  type DocumentCoordinatePageFrame, type DocumentCoordinatePreviewInput, type DocumentCoordinatePreviewRead,
  type DocumentCoordinateCalibration } from "@inspector-ai/contracts";

type Pair=[number,number];
type Unit=DocumentCoordinatePreviewInput["target"]["unit"];
export interface DocumentCoordinateDraft {
  target:{label:string;unit:""|Unit;yAxis:""|"UP"|"DOWN";minScale:string;maxScale:string;maxHoldoutResidual:string};
  points:Array<{id:string;page:Pair|null;rawX:string;rawY:string;role:"FIT"|"HOLDOUT";reference:string}>;
}
export interface DocumentCoordinateEditorProps {
  frame:DocumentCoordinatePageFrame;checkId:string;previewUrl:string;originalUrl:string;
  onPreview:(input:DocumentCoordinatePreviewInput,signal:AbortSignal)=>Promise<DocumentCoordinatePreviewRead>;disabled?:boolean;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const frameKeys=["sourceFileId","sourceSha256","pdfPageNumber","pageFrameSha256","coordinateSpace","visibleWidthPt","visibleHeightPt","rotate","geometryPrecisionPt"] as const;
const sameFrame=(a:DocumentCoordinatePageFrame,b:DocumentCoordinatePageFrame)=>frameKeys.every(key=>a[key]===b[key]);
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const pair=(v:unknown):v is Pair=>Array.isArray(v)&&v.length===2&&Array.from(v).every(finite);
const normalized=(v:unknown):v is Pair=>pair(v)&&v.every(n=>n>=0&&n<=1);
function decimal(raw:string):number|null {
  if(typeof raw!=="string"||!/^[-+]?(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)$/u.test(raw))return null;
  const n=Number(raw.replace(",","."));return finite(n)?n:null;
}
/** A draft never infers a unit or repairs numerical policy. Schema parsing makes
 * a detached request, preserving explicit text and original normalized points. */
export function buildDocumentCoordinateInput(checkId:string,frame:DocumentCoordinatePageFrame,draft:DocumentCoordinateDraft):DocumentCoordinatePreviewInput|null {
  if(!draft||!draft.target||!Array.isArray(draft.points)||draft.points.length<4||draft.points.length>32)return null;
  const minScale=decimal(draft.target.minScale),maxScale=decimal(draft.target.maxScale),maxHoldoutResidual=decimal(draft.target.maxHoldoutResidual);
  if(minScale===null||maxScale===null||maxHoldoutResidual===null)return null;
  const points:DocumentCoordinatePreviewInput["points"]=[];
  const ids=new Set<string>(),pages=new Set<string>(),printed=new Set<string>();
  for(const row of draft.points) {
    if(!row||!normalized(row.page)||ids.has(row.id))return null;
    const x=decimal(row.rawX),y=decimal(row.rawY);if(x===null||y===null)return null;
    const pageKey=JSON.stringify(row.page),printedKey=JSON.stringify([x,y]);
    if(pages.has(pageKey)||printed.has(printedKey))return null;
    ids.add(row.id);pages.add(pageKey);printed.add(printedKey);
    points.push({id:row.id,page:[...row.page],printed:[x,y],role:row.role,reference:row.reference});
  }
  if(points.filter(p=>p.role==="FIT").length!==3||!points.some(p=>p.role==="HOLDOUT"))return null;
  const parsed=documentCoordinatePreviewInputSchema.safeParse({schemaVersion:"document-coordinate-preview-v1",checkId,sourceFrame:frame,
    target:{label:draft.target.label,unit:draft.target.unit,yAxis:draft.target.yAxis,minScale,maxScale,maxHoldoutResidual},points,queryPoints:[]});
  return parsed.success?parsed.data:null;
}
/** The protected preview is already in the canonical visible orientation. Use
 * the actual image rectangle once; do not apply PDF Rotate or flip Y again. */
export function documentCoordinateClick(rect:{left:number;top:number;width:number;height:number},client:{x:number;y:number}):Pair|null {
  if(!rect||!client||![rect.left,rect.top,rect.width,rect.height,client.x,client.y].every(finite)||rect.width<=0||rect.height<=0)return null;
  const point:Pair=[(client.x-rect.left)/rect.width,(client.y-rect.top)/rect.height];return normalized(point)?point:null;
}
function initialDraft():DocumentCoordinateDraft {
  return {target:{label:"",unit:"",yAxis:"",minScale:"",maxScale:"",maxHoldoutResidual:""},
    points:Array.from({length:4},(_,i)=>({id:`P${i+1}`,page:null,rawX:"",rawY:"",role:i<3?"FIT":"HOLDOUT",reference:""}))};
}
function validCalibration(c:DocumentCoordinateCalibration):boolean {
  if(!c||![c.forwardMatrix,c.inverseMatrix].every(a=>Array.isArray(a)&&a.length===6&&Array.from(a).every(finite))
    ||!Array.isArray(c.fitResiduals)||!Array.isArray(c.holdoutResiduals)||c.fitResiduals.length!==3||c.holdoutResiduals.length<1||c.holdoutResiduals.length>29)return false;
  const ids=new Set<string>();
  for(const r of [...c.fitResiduals,...c.holdoutResiduals]) {
    if(!r||typeof r.id!=="string"||!r.id||ids.has(r.id)||!pair(r.predicted)||!finite(r.residualProjectUnits)||r.residualProjectUnits<0)return false;
    ids.add(r.id);
  }
  return finite(c.maxHoldoutResidual)&&c.maxHoldoutResidual>=0&&finite(c.declaredTolerance)&&c.declaredTolerance>0
    &&c.maxHoldoutResidual<=c.declaredTolerance&&finite(c.maxRoundtripPageUnits)&&c.maxRoundtripPageUnits>=0
    &&pair(c.scaleRangeProjectUnitsPerNormalizedPageUnit)&&c.scaleRangeProjectUnitsPerNormalizedPageUnit[0]>0
    &&c.scaleRangeProjectUnitsPerNormalizedPageUnit[0]<=c.scaleRangeProjectUnitsPerNormalizedPageUnit[1]
    &&Array.isArray(c.supportedDomain)&&c.supportedDomain.length>=3&&c.supportedDomain.length<=32&&Array.from(c.supportedDomain).every(normalized)
    &&Array.isArray(c.queryPoints)&&c.queryPoints.length<=128&&Array.from(c.queryPoints).every(q=>!!q&&normalized(q.page)&&pair(q.project));
}
function validResponse(value:DocumentCoordinatePreviewRead):boolean {
  if(!value||value.schemaVersion!=="document-coordinate-preview-read-v1"||value.status!=="PREVIEW_ONLY"
    ||value.coordinateAuthority!=="USER_DECLARED_UNVERIFIED"||value.absoluteGeoreference!==false||value.physicalPositionValidated!==false
    ||value.calibratedProbability!==null||!Array.isArray(value.facts)||value.facts.length!==0
    ||typeof value.inputSha256!=="string"||value.inputSha256.length!==64||!/^[a-f0-9]{64}$/u.test(value.inputSha256)||!documentCoordinatePageFrameSchema.safeParse(value.sourceFrame).success||!value.result)return false;
  if(value.result.status==="ABSTAIN")return ["PAGE_FRAME_MISMATCH","REGISTRATION_POLICY_REJECTED"].includes(value.result.reasonCode);
  return value.result.status==="CALCULATED"&&validCalibration(value.result.calibration);
}
function validateResponseForInput(value:DocumentCoordinatePreviewRead,input:DocumentCoordinatePreviewInput,inputSha256:string):void {
  if(!validResponse(value)||value.inputSha256!==inputSha256||!sameFrame(value.sourceFrame,input.sourceFrame))throw Error("Ответ расчёта не совпадает с исходной страницей или точным запросом. Загрузите рамку снова.");
  if(value.result.status!=="CALCULATED")return;
  const c=value.result.calibration;
  const ids=(role:"FIT"|"HOLDOUT")=>input.points.filter(p=>p.role===role).map(p=>p.id).sort();
  if(!same(c.fitResiduals.map(p=>p.id).sort(),ids("FIT"))||!same(c.holdoutResiduals.map(p=>p.id).sort(),ids("HOLDOUT"))
    ||c.declaredTolerance!==input.target.maxHoldoutResidual||c.scaleRangeProjectUnitsPerNormalizedPageUnit[0]<input.target.minScale
    ||c.scaleRangeProjectUnitsPerNormalizedPageUnit[1]>input.target.maxScale||c.queryPoints.length!==input.queryPoints.length
    ||!c.queryPoints.every((p,i)=>same(p.page,input.queryPoints[i])))throw Error("Роли точек или заявленные условия не совпадают с ответом расчёта.");
}
/** Pure presenter, also used by the live editor. Numerical consistency never
 * grants source authority, measured probability or an absolute georeference. */
export function DocumentCoordinatePreviewResult({value,unit}:{value:DocumentCoordinatePreviewRead;unit?:Unit}) {
  if(!validResponse(value))return <p role="alert">Некорректный предварительный ответ. Привязка не подтверждена.</p>;
  return <section aria-label="Результат предварительной привязки" style={{overflowWrap:"anywhere"}}>
    <h4>Предварительный расчёт · PREVIEW_ONLY</h4>
    <p>USER_DECLARED_UNVERIFIED · Уверенность не измерена. Абсолютная геопривязка и положение на местности не подтверждены.</p>
    <p>Контрольная точка HOLDOUT не участвовала в подборе преобразования. Точка того же листа не является независимой геодезической проверкой.</p>
    {value.result.status==="ABSTAIN"?<p role="status">Расчёт не принят: {value.result.reasonCode}. Изменения точек и условий автоматически не выполняются.</p>:<>
      <p role="status">CALCULATED · Только внутренняя согласованность заявленных координат.</p>
      <p>Единицы: {unit??"единицы заявленной системы"} · Допуск контрольной ошибки: {value.result.calibration.declaredTolerance} · Максимальная ошибка HOLDOUT: {value.result.calibration.maxHoldoutResidual}</p>
      {([['FIT',value.result.calibration.fitResiduals],['HOLDOUT',value.result.calibration.holdoutResiduals]] as const).map(([role,rows])=><div key={role}>
        <h5>{role}: ошибки всех точек</h5>{rows.map(row=><p key={row.id}>{row.id} · {role} · Расчётные X/Y: {row.predicted.join("; ")} · Ошибка: {row.residualProjectUnits} {unit??""}</p>)}
      </div>)}
      <p>Диапазон масштабов на нормализованную ось страницы: {value.result.calibration.scaleRangeProjectUnitsPerNormalizedPageUnit.join("; ")} {unit??"единиц заявленной системы"} / нормализованная единица страницы.</p>
      <p>Максимальная ошибка обратного преобразования на странице: {value.result.calibration.maxRoundtripPageUnits}</p>
      <p>Поддерживаемая область нормализованной страницы: {value.result.calibration.supportedDomain.map(p=>`[${p.join("; ")}]`).join(" · ")}. За пределами этой области координаты не подтверждены.</p>
    </>}
    <p>Расчёт не создаёт фактов, нормативных нарушений или подтверждённой системы координат. Нужны проверка исходных подписей и отдельное основание геодезической привязки.</p>
  </section>;
}
export function DocumentCoordinateEditor(props:DocumentCoordinateEditorProps) {
  return <CoordinateEditor key={JSON.stringify([props.checkId,props.frame,props.previewUrl,props.originalUrl])} {...props}/>;
}
function CoordinateEditor(props:DocumentCoordinateEditorProps) {
  const [draft,setDraft]=useState(initialDraft),[selected,setSelected]=useState("P1"),[imageReady,setImageReady]=useState(false);
  const [value,setValue]=useState<DocumentCoordinatePreviewRead|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const request=useRef<AbortController|null>(null),generation=useRef(0),nextId=useRef(5);
  const invalidate=()=>{generation.current++;request.current?.abort();setValue(null);setError("");setBusy(false);};
  const change=(next:DocumentCoordinateDraft)=>{invalidate();setDraft(next);};
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(props.disabled){generation.current++;request.current?.abort();setValue(null);setBusy(false);}},[props.disabled]);
  const input=buildDocumentCoordinateInput(props.checkId,props.frame,draft);
  async function preview() {
    if(props.disabled||busy||!input)return;
    invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try {
      if(!globalThis.crypto?.subtle)throw Error("WebCrypto недоступен. Точный запрос расчёта нельзя проверить.");
      const inputSha=await documentCoordinateInputSha256(input);controller.signal.throwIfAborted();if(id!==generation.current)return;
      const response=await props.onPreview(input,controller.signal);controller.signal.throwIfAborted();if(id!==generation.current)return;
      validateResponseForInput(response,input,inputSha);controller.signal.throwIfAborted();if(id===generation.current)setValue(response);
    }catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  const pointChange=(index:number,patch:Partial<DocumentCoordinateDraft['points'][number]>)=>change({...draft,points:draft.points.map((p,i)=>i===index?{...p,...patch}:p)});
  return <section aria-label="Предварительная привязка к напечатанным координатам листа" style={{overflowWrap:"anywhere",minWidth:0}}>
    <h3>Предварительная привязка к напечатанным координатам листа</h3>
    <p>PREVIEW_ONLY · Координаты и единицы задаёт пользователь. Геодезическая достоверность и положение на местности не подтверждены. Уверенность не измерена.</p>
    <p>SHA-256 <code>{props.frame.sourceSha256}</code> · PDF {props.frame.pdfPageNumber} · Поворот исходного PDF: {props.frame.rotate}° · Видимая рамка: {props.frame.visibleWidthPt} × {props.frame.visibleHeightPt} pt · Точность рамки: {props.frame.geometryPrecisionPt} pt</p>
    <p>Рамка <code>{props.frame.pageFrameSha256}</code> · CANONICAL_VISIBLE_NORMALIZED</p>
    <a href={props.originalUrl} target="_blank" rel="noopener noreferrer">Открыть оригинал PDF · страница {props.frame.pdfPageNumber}</a>
    <fieldset disabled={props.disabled} style={{minWidth:0}}><legend>Точки и явные условия расчёта</legend>
      <p>Выберите строку точки, затем её положение на исходном листе. Ровно три точки FIT участвуют в расчёте; минимум одна HOLDOUT остаётся контрольной. Никакая точка не заполняется автоматически.</p>
      <div style={{position:"relative",minWidth:0}}>
        <img src={props.previewUrl} alt={`Исходная страница PDF ${props.frame.pdfPageNumber} для выбора координат`} style={{display:"block",width:"100%",height:"auto",cursor:props.disabled?"default":"crosshair"}}
          onLoad={()=>setImageReady(true)} onError={()=>{setImageReady(false);invalidate();setError("Изображение исходного листа недоступно.");}}
          onClick={e=>{if(props.disabled||!imageReady)return;const rect=e.currentTarget.getBoundingClientRect();const point=documentCoordinateClick(rect,{x:e.clientX,y:e.clientY});
            const index=draft.points.findIndex(p=>p.id===selected);if(point&&index>=0)pointChange(index,{page:point});}}/>
        {draft.points.filter(p=>p.page).map(p=><span key={p.id} style={{position:"absolute",left:`${p.page![0]*100}%`,top:`${p.page![1]*100}%`,transform:"translate(-50%,-50%)",pointerEvents:"none",background:"var(--surface,#fff)",color:"var(--text-primary,#111)",border:"2px solid currentColor",borderRadius:4,padding:2}}>{p.id}</span>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(240px,100%),1fr))",gap:12,marginTop:12}}>
        {draft.points.map((point,index)=><fieldset key={point.id} aria-label={`Точка ${point.id}`} style={{minWidth:0}}><legend>Точка {point.id}</legend>
          <button type="button" aria-pressed={selected===point.id} onClick={()=>{if(!props.disabled)setSelected(point.id);}}>Выбрать точку {point.id} на листе</button>
          <p>Положение на нормализованной странице: {point.page?point.page.join("; "):"не выбрано"}</p>
          <label>Напечатанная X · {point.id}<input inputMode="decimal" value={point.rawX} onChange={e=>pointChange(index,{rawX:e.target.value})}/></label>
          <label>Напечатанная Y · {point.id}<input inputMode="decimal" value={point.rawY} onChange={e=>pointChange(index,{rawY:e.target.value})}/></label>
          <label>Роль · {point.id}<select value={point.role} onChange={e=>pointChange(index,{role:e.target.value as 'FIT'|'HOLDOUT'})}><option value="FIT">FIT</option><option value="HOLDOUT">HOLDOUT</option></select></label>
          <label>Ссылка на исходную подпись · {point.id}<input maxLength={128} value={point.reference} onChange={e=>pointChange(index,{reference:e.target.value})}/></label>
          <button type="button" disabled={draft.points.length<=4} onClick={()=>{if(props.disabled)return;change({...draft,points:draft.points.filter((_,i)=>i!==index)});if(selected===point.id)setSelected(draft.points.find((_,i)=>i!==index)!.id);}}>Удалить точку {point.id}</button>
        </fieldset>)}
      </div>
      <button type="button" disabled={draft.points.length>=32} onClick={()=>{if(props.disabled)return;const id=`P${nextId.current++}`;change({...draft,points:[...draft.points,{id,page:null,rawX:"",rawY:"",role:"HOLDOUT",reference:""}]});setSelected(id);}}>Добавить точку</button>
      <fieldset style={{minWidth:0}}><legend>Заявленная система координат и числовые условия</legend>
        <label>Название системы координат<input maxLength={128} value={draft.target.label} onChange={e=>change({...draft,target:{...draft.target,label:e.target.value}})}/></label>
        <label>Единица напечатанных координат<select value={draft.target.unit} onChange={e=>change({...draft,target:{...draft.target,unit:e.target.value as ''|Unit}})}><option value="">Выберите единицу явно</option>{(['m','mm','cm','ft','in'] as const).map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label>Направление оси Y<select value={draft.target.yAxis} onChange={e=>change({...draft,target:{...draft.target,yAxis:e.target.value as ''|'UP'|'DOWN'}})}><option value="">Выберите направление явно</option><option value="UP">UP · вверх</option><option value="DOWN">DOWN · вниз</option></select></label>
        {([['minScale','Минимальный масштаб на нормализованную ось страницы'],['maxScale','Максимальный масштаб на нормализованную ось страницы'],['maxHoldoutResidual','Допуск контрольной ошибки']] as const).map(([key,label])=><label key={key}>{label}<input inputMode="decimal" value={draft.target[key]} onChange={e=>change({...draft,target:{...draft.target,[key]:e.target.value}})}/></label>)}
      </fieldset>
      {!input&&<p role="status">Нужны 4–32 полностью заданные точки, ровно 3 FIT, минимум 1 HOLDOUT, единица, направление оси Y и явные положительные числовые условия. Масштаб задаётся на нормализованную ось страницы.</p>}
      <button type="button" disabled={!input||busy} onClick={()=>void preview()}>{busy?"Рассчитываем…":"Рассчитать предварительную привязку"}</button>
    </fieldset>
    {error&&<p role="alert">{error}</p>}{value&&<DocumentCoordinatePreviewResult value={value} unit={input?.target.unit}/>}
  </section>;
}
