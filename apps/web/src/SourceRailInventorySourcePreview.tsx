import { useEffect, useRef, useState } from "react";
import { matrixRailInventorySelectionSchema, type MatrixRailInventoryFragment, type MatrixRailInventoryScopeInput,
  type MatrixRailInventorySelection, type MatrixInventorySourcePagesRead, type SourceFileSummary } from "@inspector-ai/contracts";
import { api, type MatrixRailInventoryPreviewRead } from "./api";
import { inventoryPages, inventoryRegionEvidence, type InventoryPage } from "./SourceInventoryReviewFields";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { SourceRailInventoryReviewFields, validateRailInventoryPreview,
  type RailInventoryPreview, type RailInventorySourceIdentity } from "./SourceRailInventoryReviewFields";

const HEADER="Перечень поручней доступного санузла";
const END="Конец перечня поручней доступного санузла";
const SCOPE=/^Санузел МГН: [A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u;
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameFragment=(a:MatrixRailInventoryFragment,b:MatrixRailInventoryFragment)=>same(
  [a.pageNumber,a.blockIndex,a.lineIndex,a.rawText,a.bboxMilliPoints],
  [b.pageNumber,b.blockIndex,b.lineIndex,b.rawText,b.bboxMilliPoints]);
const fragmentKey=(f:MatrixRailInventoryFragment)=>`${f.blockIndex}:${f.lineIndex}`;
export interface SourceRailInventorySourcePreviewProps {
  objectId:string;checkId:string;file:SourceFileSummary;reviewHash:string|null;
  value?:MatrixRailInventoryScopeInput;onChange:(value:MatrixRailInventoryScopeInput)=>void;disabled:boolean;
}
export function railSourceIdentity(props:Pick<SourceRailInventorySourcePreviewProps,"checkId"|"file"|"reviewHash">):RailInventorySourceIdentity {
  return {checkId:props.checkId,sourceFileId:props.file.id,sourceSha256:props.file.sha256,reviewHash:props.reviewHash};
}
export function railInventoryLocators(page:InventoryPage) {
  return {headers:page.fragments.filter(f=>f.rawText===HEADER),scopes:page.fragments.filter(f=>SCOPE.test(f.rawText)),
    ends:page.fragments.filter(f=>f.rawText===END)};
}
/** Region is prescribed by original header/end edges. No editable crop can hide
 * another line within the same closed band. The server validates the full page. */
export function railInventorySelection(page:InventoryPage,header:MatrixRailInventoryFragment,
  scope:MatrixRailInventoryFragment,end:MatrixRailInventoryFragment):MatrixRailInventorySelection {
  const locators=railInventoryLocators(page);
  for(const [selected,candidates] of [[header,locators.headers],[scope,locators.scopes],[end,locators.ends]] as const) {
    if(!selected||selected.pageNumber!==page.pageNumber||!candidates.some(f=>sameFragment(f,selected)))
      throw Error("Выберите точные исходные строки заголовка, комнаты и конца перечня на одном листе.");
  }
  const region:[number,number,number,number]=[0,end.bboxMilliPoints[1],page.widthMilliPoints,header.bboxMilliPoints[3]];
  if(region[1]>=region[3]||scope.bboxMilliPoints[1]<region[1]||scope.bboxMilliPoints[3]>region[3])
    throw Error("Строка комнаты должна находиться между заголовком и концом перечня.");
  return matrixRailInventorySelectionSchema.parse({pageNumber:page.pageNumber,regionBoxMilliPoints:region,
    headerFragments:[header],scopeFragments:[scope],endFragments:[end]});
}
function validateOrigin(identity:RailInventorySourceIdentity,data:MatrixInventorySourcePagesRead):InventoryPage[] {
  if(data.checkId!==identity.checkId||data.sourceFileId!==identity.sourceFileId||data.sourceSha256!==identity.sourceSha256
    ||data.latestReviewHash!==identity.reviewHash||!SHA.test(data.inputManifestHash)||!SHA.test(data.textStageContentHash)||!SHA.test(data.textArtifactHash)
    ||data.textArtifact.sourceFileId!==identity.sourceFileId||data.textArtifact.inputSha256!==identity.sourceSha256
    ||!["PD","RD","UNRESOLVED"].includes(data.stage))throw Error("Источник или решение изменились. Перезагрузите решение по документу.");
  const pages=inventoryPages(data.textArtifact);
  if(data.textArtifact.pageCount!==pages.length||pages.length<1||pages.length>512||pages.some((p,i)=>p.pageNumber!==i+1))
    throw Error("Не подтверждён полный набор исходных листов.");
  return pages;
}
export async function loadRailInventorySource(identity:RailInventorySourceIdentity,signal:AbortSignal):Promise<MatrixInventorySourcePagesRead> {
  signal.throwIfAborted();const data=await api.getSourceRailInventoryPages(identity.checkId,identity.sourceFileId,signal);
  signal.throwIfAborted();validateOrigin(identity,data);return data;
}
export async function previewRailInventorySource(identity:RailInventorySourceIdentity,origin:MatrixInventorySourcePagesRead,
  selection:MatrixRailInventorySelection,signal:AbortSignal):Promise<RailInventoryPreview> {
  signal.throwIfAborted();const pages=validateOrigin(identity,origin),parsed=matrixRailInventorySelectionSchema.parse(selection);
  const page=pages.find(p=>p.pageNumber===parsed.pageNumber);
  if(!page)throw Error("Исходная страница отсутствует.");
  const originalSelection=railInventorySelection(page,parsed.headerFragments[0],parsed.scopeFragments[0],parsed.endFragments[0]);
  if(!same(parsed,originalSelection))throw Error("Границы должны охватывать всю ширину листа от заголовка до конца перечня.");
  const response:MatrixRailInventoryPreviewRead=await api.previewSourceRailInventory(identity.checkId,identity.sourceFileId,parsed,signal);
  signal.throwIfAborted();
  if(response.checkId!==identity.checkId||response.sourceFileId!==identity.sourceFileId||response.sourceSha256!==identity.sourceSha256
    ||response.latestReviewHash!==identity.reviewHash||response.result.schemaVersion!=="matrix-odi120-rail-inventory-source-result-v1")
    throw Error("Предпросмотр относится к другому источнику или решению. Обновите данные.");
  const preview:RailInventoryPreview={...response,selection:parsed};
  if(response.result.status==="ABSTAIN") {
    if(response.target!==undefined||typeof response.result.reasonCode!=="string"||!response.result.reasonCode||response.result.reasonCode.length>200)
      throw Error("Некорректный ответ предпросмотра.");
    return preview;
  }
  if(response.result.status!=="RECONSTRUCTED")throw Error("Некорректный ответ предпросмотра.");
  const verified=validateRailInventoryPreview(identity,preview);
  if(verified.target.inputManifestHash!==origin.inputManifestHash||verified.target.textStageContentHash!==origin.textStageContentHash
    ||verified.target.textArtifactHash!==origin.textArtifactHash||verified.inventory.stage!==origin.stage
    ||verified.inventory.widthMilliPoints!==page.widthMilliPoints||verified.inventory.heightMilliPoints!==page.heightMilliPoints)
    throw Error("Предпросмотр не совпадает с исходным текстом выбранного запуска. Загрузите листы снова.");
  return preview;
}
export function SourceRailInventorySourcePreview(props:SourceRailInventorySourcePreviewProps) {
  return <RailSourcePreview key={JSON.stringify([props.objectId,props.checkId,props.file.id,props.file.sha256,props.reviewHash])} {...props}/>;
}
function RailSourcePreview(props:SourceRailInventorySourcePreviewProps) {
  const identity=railSourceIdentity(props);
  const [origin,setOrigin]=useState<MatrixInventorySourcePagesRead|null>(null),[pageNumber,setPageNumber]=useState(1);
  const [header,setHeader]=useState(""),[scope,setScope]=useState(""),[end,setEnd]=useState("");
  const [preview,setPreview]=useState<RailInventoryPreview|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const invalidate=()=>{generation.current++;request.current?.abort();setBusy(false);setPreview(undefined);setError("");};
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(props.disabled)invalidate();},[props.disabled]);
  const pages=origin?inventoryPages(origin.textArtifact):[],page=pages.find(p=>p.pageNumber===pageNumber);
  const locators=page?railInventoryLocators(page):{headers:[],scopes:[],ends:[]};
  const choose=(rows:MatrixRailInventoryFragment[],selected:string)=>rows.find(f=>fragmentKey(f)===selected)??(rows.length===1?rows[0]:undefined);
  const selectedHeader=choose(locators.headers,header),selectedScope=choose(locators.scopes,scope),selectedEnd=choose(locators.ends,end);
  let selection:MatrixRailInventorySelection|undefined;
  if(page&&selectedHeader&&selectedScope&&selectedEnd)try{selection=railInventorySelection(page,selectedHeader,selectedScope,selectedEnd);}catch{/* Explain at explicit preview request. */}
  async function load() {
    invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await loadRailInventorySource(identity,controller.signal);if(id!==generation.current)return;
      setOrigin(data);setHeader("");setScope("");setEnd("");
      setPageNumber(inventoryPages(data.textArtifact).find(p=>railInventoryLocators(p).headers.length>0)?.pageNumber??1);
    }catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function reconstruct() {
    if(!origin||!selection)return;invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await previewRailInventorySource(identity,origin,selection,controller.signal);if(id===generation.current)setPreview(data);}
    catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  const options=(label:string,rows:MatrixRailInventoryFragment[],selected:MatrixRailInventoryFragment|undefined,setter:(v:string)=>void)=><label><span>{label}</span>
    <select value={selected?fragmentKey(selected):""} onChange={e=>{invalidate();setter(e.target.value);}}><option value="">Выберите исходную строку</option>
      {rows.map(f=><option key={fragmentKey(f)} value={fragmentKey(f)}>{f.rawText} · строка {f.blockIndex+1}:{f.lineIndex+1}</option>)}</select></label>;
  return <section aria-label="Исходные строки перечня поручней доступного санузла">
    <fieldset disabled={props.disabled}><legend>Выбор исходной области ODI-120</legend>
      <p>Выберите исходные заголовок, строку комнаты и конец перечня. Область занимает всю ширину листа между крайними строками.</p>
      <button type="button" disabled={busy} onClick={()=>void load()}>{busy?"Проверяем источник…":origin?"Обновить исходные листы поручней":"Загрузить исходные листы поручней"}</button>
      {origin&&<>
        <label><span>Страница перечня поручней PDF</span><select value={pageNumber} onChange={e=>{invalidate();setPageNumber(Number(e.target.value));setHeader("");setScope("");setEnd("");}}>
          {pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>{p.pageNumber}</option>)}</select></label>
        {options("Исходный заголовок перечня поручней",locators.headers,selectedHeader,setHeader)}
        {options("Исходная строка санитарной комнаты",locators.scopes,selectedScope,setScope)}
        {options("Исходная строка конца перечня поручней",locators.ends,selectedEnd,setEnd)}
        {(!locators.headers.length||!locators.scopes.length||!locators.ends.length)&&<p>На листе нет всех трёх поддержанных исходных строк с точными координатами. Полноту подтвердить нельзя.</p>}
        {page&&selection&&<InspectorEvidenceViewer objectId={props.objectId} file={props.file}
          evidence={inventoryRegionEvidence(props.file,page,selection.regionBoxMilliPoints,origin.stage)} stage={origin.stage} onOpened={()=>{}}/>}
        <button type="button" disabled={busy||!selection} onClick={()=>void reconstruct()}>Проверить исходный перечень поручней</button>
      </>}
      {error&&<p role="alert">{error}</p>}
    </fieldset>
    <SourceRailInventoryReviewFields {...identity} value={props.value} onChange={props.onChange} disabled={props.disabled||busy} preview={preview}/>
  </section>;
}
