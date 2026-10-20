import { useEffect, useRef, useState } from "react";
import { matrixWaterNodeInventorySelectionSchema, type MatrixWaterNodeInventoryFragment, type MatrixWaterNodeScopeInput,
  type MatrixWaterNodeInventorySelection, type MatrixInventorySourcePagesRead, type SourceFileSummary } from "@inspector-ai/contracts";
import { api, type MatrixWaterNodePreviewRead } from "./api";
import { inventoryPages, inventoryRegionEvidence, type InventoryPage } from "./SourceInventoryReviewFields";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { SourceWaterNodeReviewFields, validateWaterNodePreview,
  type WaterNodePreview, type WaterNodeSourceIdentity } from "./SourceWaterNodeReviewFields";

const HEADER="Состав общедомового вводного узла холодной воды";
const END="Конец состава общедомового вводного узла холодной воды";
const TOKEN="[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}";
const BUILDING=new RegExp(`^Здание: ${TOKEN}(?![\\s\\S])`,"u");
const NODE=new RegExp(`^Вводной узел: ${TOKEN}(?![\\s\\S])`,"u");
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameFragment=(a:MatrixWaterNodeInventoryFragment,b:MatrixWaterNodeInventoryFragment)=>same(
  [a.pageNumber,a.blockIndex,a.lineIndex,a.rawText,a.bboxMilliPoints],
  [b.pageNumber,b.blockIndex,b.lineIndex,b.rawText,b.bboxMilliPoints]);
const fragmentKey=(f:MatrixWaterNodeInventoryFragment)=>`${f.blockIndex}:${f.lineIndex}`;
export interface SourceWaterNodeSourcePreviewProps {
  objectId:string;checkId:string;file:SourceFileSummary;reviewHash:string|null;
  value?:MatrixWaterNodeScopeInput;onChange:(value:MatrixWaterNodeScopeInput)=>void;disabled:boolean;
}
export function waterNodeSourceIdentity(props:Pick<SourceWaterNodeSourcePreviewProps,"checkId"|"file"|"reviewHash">):WaterNodeSourceIdentity {
  return {checkId:props.checkId,sourceFileId:props.file.id,sourceSha256:props.file.sha256,reviewHash:props.reviewHash};
}
export function waterNodeLocators(page:InventoryPage) {
  return {headers:page.fragments.filter(f=>f.rawText===HEADER),
    buildings:page.fragments.filter(f=>f.rawText.startsWith("Здание:")),
    nodes:page.fragments.filter(f=>f.rawText.startsWith("Вводной узел:")),
    services:page.fragments.filter(f=>f.rawText.startsWith("Система:")),
    accountingScopes:page.fragments.filter(f=>f.rawText.startsWith("Назначение:")),
    ends:page.fragments.filter(f=>f.rawText===END)};
}
/** Exact original header + four distinct scope categories + end. Full width is
 * prescribed by the source wire; the server independently checks every line. */
export function waterNodeSelection(page:InventoryPage,header:MatrixWaterNodeInventoryFragment,
 scopes:[MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment],
 end:MatrixWaterNodeInventoryFragment):MatrixWaterNodeInventorySelection {
 const locators=waterNodeLocators(page);
 const categories=[locators.headers,locators.buildings,locators.nodes,locators.services,locators.accountingScopes,locators.ends];
 const selected=[header,...scopes,end];
 for(let i=0;i<categories.length;i++) {
   if(categories[i].length!==1||!selected[i]||selected[i].pageNumber!==page.pageNumber||!sameFragment(categories[i][0],selected[i]))
     throw Error("Выберите однозначные исходные заголовок, четыре строки области узла и конец состава на одном листе.");
 }
 if(!BUILDING.test(scopes[0].rawText)||!NODE.test(scopes[1].rawText)||scopes[2].rawText!=="Система: ХВС"||scopes[3].rawText!=="Назначение: общедомовой учёт")
   throw Error("Нужны точные исходные строки здания, вводного узла, системы ХВС и общедомового учёта.");
 const region:[number,number,number,number]=[0,end.bboxMilliPoints[1],page.widthMilliPoints,header.bboxMilliPoints[3]];
 for(let i=0;i<selected.length;i++) {
   const box=selected[i].bboxMilliPoints;
   if(box[0]<0||box[2]>page.widthMilliPoints||box[1]<region[1]||box[3]>region[3]
     ||(i>0&&selected[i-1].bboxMilliPoints[1]-box[3]<0))
     throw Error("Исходные строки должны идти по порядку в одной замкнутой области всей ширины листа.");
 }
 return matrixWaterNodeInventorySelectionSchema.parse({pageNumber:page.pageNumber,regionBoxMilliPoints:region,
   headerFragments:[header],scopeFragments:scopes,endFragments:[end]});
}
function validateOrigin(identity:WaterNodeSourceIdentity,data:MatrixInventorySourcePagesRead):InventoryPage[] {
  if(data.checkId!==identity.checkId||data.sourceFileId!==identity.sourceFileId||data.sourceSha256!==identity.sourceSha256
    ||data.latestReviewHash!==identity.reviewHash||!SHA.test(data.inputManifestHash)||!SHA.test(data.textStageContentHash)||!SHA.test(data.textArtifactHash)
    ||data.textArtifact.sourceFileId!==identity.sourceFileId||data.textArtifact.inputSha256!==identity.sourceSha256
    ||!["PD","RD","UNRESOLVED"].includes(data.stage))throw Error("Источник или решение изменились. Перезагрузите решение по документу.");
  const pages=inventoryPages(data.textArtifact);
  if(data.textArtifact.pageCount!==pages.length||pages.length<1||pages.length>512||pages.some((p,i)=>p.pageNumber!==i+1))
    throw Error("Не подтверждён полный набор исходных листов.");
  return pages;
}
export async function loadWaterNodeSource(identity:WaterNodeSourceIdentity,signal:AbortSignal):Promise<MatrixInventorySourcePagesRead> {
  signal.throwIfAborted();const data=await api.getSourceWaterNodePages(identity.checkId,identity.sourceFileId,signal);
  signal.throwIfAborted();validateOrigin(identity,data);return data;
}
export async function previewWaterNodeSource(identity:WaterNodeSourceIdentity,origin:MatrixInventorySourcePagesRead,
  selection:MatrixWaterNodeInventorySelection,signal:AbortSignal):Promise<WaterNodePreview> {
  signal.throwIfAborted();const pages=validateOrigin(identity,origin),parsed=matrixWaterNodeInventorySelectionSchema.parse(selection);
  const page=pages.find(p=>p.pageNumber===parsed.pageNumber);
  if(!page)throw Error("Исходная страница отсутствует.");
  const originalSelection=waterNodeSelection(page,parsed.headerFragments[0],parsed.scopeFragments as [MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment,MatrixWaterNodeInventoryFragment],parsed.endFragments[0]);
  if(!same(parsed,originalSelection))throw Error("Границы должны охватывать всю ширину листа от заголовка до конца перечня.");
  const response:MatrixWaterNodePreviewRead=await api.previewSourceWaterNode(identity.checkId,identity.sourceFileId,parsed,signal);
  signal.throwIfAborted();
  if(response.checkId!==identity.checkId||response.sourceFileId!==identity.sourceFileId||response.sourceSha256!==identity.sourceSha256
    ||response.latestReviewHash!==identity.reviewHash||response.result.schemaVersion!=="matrix-zu129-water-node-source-result-v1")
    throw Error("Предпросмотр относится к другому источнику или решению. Обновите данные.");
  const preview:WaterNodePreview={...response,selection:parsed};
  if(response.result.status==="ABSTAIN") {
    if(response.target!==undefined||typeof response.result.reasonCode!=="string"||!response.result.reasonCode||response.result.reasonCode.length>200)
      throw Error("Некорректный ответ предпросмотра.");
    return preview;
  }
  if(response.result.status!=="RECONSTRUCTED")throw Error("Некорректный ответ предпросмотра.");
  const verified=validateWaterNodePreview(identity,preview);
  if(verified.target.inputManifestHash!==origin.inputManifestHash||verified.target.textStageContentHash!==origin.textStageContentHash
    ||verified.target.textArtifactHash!==origin.textArtifactHash||verified.inventory.stage!==origin.stage
    ||verified.inventory.widthMilliPoints!==page.widthMilliPoints||verified.inventory.heightMilliPoints!==page.heightMilliPoints)
    throw Error("Предпросмотр не совпадает с исходным текстом выбранного запуска. Загрузите листы снова.");
  return preview;
}
export function SourceWaterNodeSourcePreview(props:SourceWaterNodeSourcePreviewProps) {
  return <WaterNodeSourcePreviewBody key={JSON.stringify([props.objectId,props.checkId,props.file.id,props.file.sha256,props.reviewHash])} {...props}/>;
}
function WaterNodeSourcePreviewBody(props:SourceWaterNodeSourcePreviewProps) {
  const identity=waterNodeSourceIdentity(props);
  const [origin,setOrigin]=useState<MatrixInventorySourcePagesRead|null>(null),[pageNumber,setPageNumber]=useState(1);
  const [header,setHeader]=useState(""),[building,setBuilding]=useState(""),[node,setNode]=useState(""),[service,setService]=useState(""),[accounting,setAccounting]=useState(""),[end,setEnd]=useState("");
  const resetLocators=()=>{setHeader("");setBuilding("");setNode("");setService("");setAccounting("");setEnd("");};
  const [preview,setPreview]=useState<WaterNodePreview|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const invalidate=()=>{generation.current++;request.current?.abort();setBusy(false);setPreview(undefined);setError("");};
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(props.disabled)invalidate();},[props.disabled]);
  const pages=origin?inventoryPages(origin.textArtifact):[],page=pages.find(p=>p.pageNumber===pageNumber);
  const locators=page?waterNodeLocators(page):{headers:[],buildings:[],nodes:[],services:[],accountingScopes:[],ends:[]};
  const choose=(rows:MatrixWaterNodeInventoryFragment[],selected:string)=>rows.find(f=>fragmentKey(f)===selected)??(rows.length===1?rows[0]:undefined);
  const selectedHeader=choose(locators.headers,header),selectedBuilding=choose(locators.buildings,building),selectedNode=choose(locators.nodes,node),selectedService=choose(locators.services,service),selectedAccounting=choose(locators.accountingScopes,accounting),selectedEnd=choose(locators.ends,end);
  let selection:MatrixWaterNodeInventorySelection|undefined,selectionError="";
  if(page&&selectedHeader&&selectedBuilding&&selectedNode&&selectedService&&selectedAccounting&&selectedEnd)try{selection=waterNodeSelection(page,selectedHeader,[selectedBuilding,selectedNode,selectedService,selectedAccounting],selectedEnd);}catch(e){selectionError=e instanceof Error?e.message:String(e);}
  async function load() {
    if(props.disabled)return;
    invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await loadWaterNodeSource(identity,controller.signal);if(id!==generation.current)return;
      setOrigin(data);resetLocators();
      setPageNumber(inventoryPages(data.textArtifact).find(p=>waterNodeLocators(p).headers.length>0)?.pageNumber??1);
    }catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function reconstruct() {
    if(props.disabled||!origin||!selection)return;invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await previewWaterNodeSource(identity,origin,selection,controller.signal);if(id===generation.current)setPreview(data);}
    catch(e){if(!controller.signal.aborted&&id===generation.current)setError(e instanceof Error?e.message:String(e));}
    finally{if(id===generation.current)setBusy(false);}
  }
  const options=(label:string,rows:MatrixWaterNodeInventoryFragment[],selected:MatrixWaterNodeInventoryFragment|undefined,setter:(v:string)=>void)=><label><span>{label}</span>
    <select value={selected?fragmentKey(selected):""} onChange={e=>{invalidate();setter(e.target.value);}}><option value="">Выберите исходную строку</option>
      {rows.map(f=><option key={fragmentKey(f)} value={fragmentKey(f)}>{f.rawText} · строка {f.blockIndex+1}:{f.lineIndex+1}</option>)}</select></label>;
  return <section aria-label="Исходные строки перечня общедомового вводного узла холодной воды">
    <fieldset disabled={props.disabled}><legend>Выбор исходной области ZU-129</legend>
      <p>Выберите исходные заголовок, четыре строки области узла и конец состава. Область занимает всю ширину листа между крайними строками.</p>
      <button type="button" disabled={busy} onClick={()=>void load()}>{busy?"Проверяем источник…":origin?"Обновить исходные листы водомерного узла":"Загрузить исходные листы водомерного узла"}</button>
      {origin&&<>
        <label><span>Страница перечня водомерного узла PDF</span><select value={pageNumber} onChange={e=>{invalidate();setPageNumber(Number(e.target.value));resetLocators();}}>
          {pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>{p.pageNumber}</option>)}</select></label>
        {options("Исходный заголовок перечня водомерного узла",locators.headers,selectedHeader,setHeader)}
        {options("Исходная строка здания",locators.buildings,selectedBuilding,setBuilding)}
        {options("Исходная строка вводного узла",locators.nodes,selectedNode,setNode)}
        {options("Исходная строка системы",locators.services,selectedService,setService)}
        {options("Исходная строка назначения",locators.accountingScopes,selectedAccounting,setAccounting)}
        {options("Исходная строка конца перечня водомерного узла",locators.ends,selectedEnd,setEnd)}
        {(!locators.headers.length||!locators.buildings.length||!locators.nodes.length||!locators.services.length||!locators.accountingScopes.length||!locators.ends.length)&&<p>На листе нет всех шести поддержанных исходных строк с точными координатами. Полноту подтвердить нельзя.</p>}
        {selectionError&&<p role="alert">{selectionError}</p>}
        {page&&selection&&<InspectorEvidenceViewer objectId={props.objectId} file={props.file}
          evidence={inventoryRegionEvidence(props.file,page,selection.regionBoxMilliPoints,origin.stage)} stage={origin.stage} onOpened={()=>{}}/>}
        <button type="button" disabled={busy||!selection} onClick={()=>void reconstruct()}>Проверить исходный перечень водомерного узла</button>
      </>}
      {error&&<p role="alert">{error}</p>}
    </fieldset>
    <SourceWaterNodeReviewFields {...identity} value={props.value} onChange={props.onChange} disabled={props.disabled||busy} preview={preview}/>
  </section>;
}
