import { useEffect, useRef, useState } from "react";
import { matrixInventoryScopeInputSchema, matrixSourceInventorySchema,
  type MatrixInventoryFragment, type MatrixInventoryPreviewRead, type MatrixInventoryReviewClaimInput,
  type MatrixInventoryScopeInput, type MatrixInventorySelection, type MatrixInventorySourcePagesRead,
  type MatrixSourceInventory, type SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { InspectorEvidenceViewer, type InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";

type Box = [number, number, number, number];
export interface InventoryPage { pageNumber:number; widthMilliPoints:number; heightMilliPoints:number; fragments:MatrixInventoryFragment[] }
interface Identity { objectId:string; checkId:string; file:SourceFileSummary; reviewHash:string|null }
interface Props extends Identity { value:MatrixInventoryScopeInput|undefined; onChange:(scope:MatrixInventoryScopeInput)=>void; disabled:boolean }
const HEADER = "Ведомость мероприятий сопряжения перегородки с перекрытием";
const SCOPE = /^Узел [A-Za-z0-9А-Яа-яЁё_-]{1,40}\. Сопряжение перегородки с перекрытием(?![\s\S])/u;
const positive = (n:unknown):n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const box = (v:unknown):v is Box => Array.isArray(v) && v.length===4 && v.every(n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0) && v[0]<v[2] && v[1]<v[3];
const aborted = (signal:AbortSignal) => { if(signal.aborted) throw new DOMException("Aborted", "AbortError"); };

/** Display exact full lines only; no block-box fallback or text normalization. Server validates the full envelope. */
export function inventoryPages(artifact:Record<string,unknown>):InventoryPage[] {
  if(artifact.schemaVersion!=="document-text-v2" || !Array.isArray(artifact.pages)) throw new Error("Текст исходного документа недоступен");
  return artifact.pages.map(raw=>{
    if(!record(raw)||!positive(raw.pageNumber)||!positive(raw.widthMilliPoints)||!positive(raw.heightMilliPoints)||!Array.isArray(raw.blocks))
      throw new Error("Не подтверждена система координат исходного листа");
    const page:InventoryPage={pageNumber:raw.pageNumber,widthMilliPoints:raw.widthMilliPoints,heightMilliPoints:raw.heightMilliPoints,fragments:[]};
    raw.blocks.forEach((block,blockIndex)=>{
      if(!record(block)||typeof block.text!=="string")return;
      const lines=block.text.split("\n"),bounds=block.lineBboxesMilliPoints;
      if(!Array.isArray(bounds)||bounds.length!==lines.length)return;
      lines.forEach((rawText,lineIndex)=>{const b=bounds[lineIndex];
        if(box(b)&&b[2]<=page.widthMilliPoints&&b[3]<=page.heightMilliPoints&&rawText.trim())page.fragments.push({pageNumber:page.pageNumber,blockIndex,lineIndex,rawText,bboxMilliPoints:[...b]});
      });
    });
    return page;
  });
}

/** Percentages refer to the displayed original PDF frame: left, top, right, bottom. */
export function inventoryRegion(page:InventoryPage,percent:Box):Box {
  if(percent.some(n=>!Number.isFinite(n)||n<0||n>100)||percent[0]>=percent[2]||percent[1]>=percent[3])throw new Error("Проверьте границы области: от 0 до 100%, слева направо и сверху вниз");
  const b:Box=[Math.round(page.widthMilliPoints*percent[0]/100),Math.round(page.heightMilliPoints*(1-percent[3]/100)),
    Math.round(page.widthMilliPoints*percent[2]/100),Math.round(page.heightMilliPoints*(1-percent[1]/100))];
  if(!box(b))throw new Error("Область слишком мала");return b;
}
export function inventoryRegionEvidence(file:SourceFileSummary,page:InventoryPage,region:Box,stage:MatrixInventorySourcePagesRead["stage"]):NonNullable<InspectorEvidenceViewerProps["evidence"]> {
  return {id:JSON.stringify([file.id,file.sha256,page.pageNumber,region]),sourceFileId:file.id,sourceSha256:file.sha256,stage,
    pageNumber:page.pageNumber,sheet:null,revision:null,element:"Выбранная область перечня; полнота объекта не установлена",
    value:"Область исходного листа",unit:"",bbox:[region[0]/page.widthMilliPoints,1-region[3]/page.heightMilliPoints,region[2]/page.widthMilliPoints,1-region[1]/page.heightMilliPoints]};
}
export async function loadSourceInventory(identity:Identity,signal:AbortSignal):Promise<MatrixInventorySourcePagesRead> {
  const data=await api.getSourceInventoryPages(identity.checkId,identity.file.id,signal);aborted(signal);
  if(data.checkId!==identity.checkId||data.sourceFileId!==identity.file.id||data.sourceSha256!==identity.file.sha256
    ||data.latestReviewHash!==identity.reviewHash||data.textArtifact.sourceFileId!==identity.file.id||data.textArtifact.inputSha256!==identity.file.sha256)
    throw new Error("Источник или решение изменились. Перезагрузите решение по документу");
  inventoryPages(data.textArtifact);return data;
}
export async function previewSourceInventory(identity:Identity,origin:MatrixInventorySourcePagesRead,selection:MatrixInventorySelection,signal:AbortSignal):Promise<MatrixInventoryPreviewRead> {
  const data=await api.previewSourceInventory(identity.checkId,identity.file.id,selection,signal);aborted(signal);
  if(data.checkId!==identity.checkId||data.sourceFileId!==identity.file.id||data.sourceSha256!==identity.file.sha256)throw new Error("Ответ относится к другому источнику");
  if(data.result.status==="RECONSTRUCTED") {
    const inv=matrixSourceInventorySchema.parse(data.result.inventory),target=data.target;
    const page=inventoryPages(origin.textArtifact).find(p=>p.pageNumber===selection.pageNumber);
    if(!target||target.checkId!==identity.checkId||target.inputManifestHash!==origin.inputManifestHash||target.textStageContentHash!==origin.textStageContentHash
      ||target.textArtifactHash!==origin.textArtifactHash||inv.textArtifactHash!==origin.textArtifactHash||inv.sourceFileId!==identity.file.id||inv.sourceSha256!==identity.file.sha256
      ||!page||inv.stage!==origin.stage||inv.pageNumber!==selection.pageNumber||inv.widthMilliPoints!==page.widthMilliPoints||inv.heightMilliPoints!==page.heightMilliPoints
      ||JSON.stringify([inv.regionBoxMilliPoints,inv.headerFragments,inv.scopeFragments])!==JSON.stringify([selection.regionBoxMilliPoints,selection.headerFragments,selection.scopeFragments]))
      throw new Error("Предпросмотр не совпадает с выбранным исходным листом");
  }
  return data;
}
export function inventoryCanAssertComplete(inv:MatrixSourceInventory):boolean { return inv.featureRows.length>0&&inv.unresolvedRows.length===0; }
export function addInventoryClaim(scope:MatrixInventoryScopeInput|undefined,preview:MatrixInventoryPreviewRead,selection:MatrixInventorySelection,
  identity:{entityKey:string;componentKey:string;zoneKey:string;reference:string;complete:boolean}):MatrixInventoryScopeInput {
  if(preview.result.status!=="RECONSTRUCTED"||!preview.target)throw new Error("Сначала проверьте выбранную область");
  const inv=preview.result.inventory;
  if(inv.pageNumber!==selection.pageNumber||inv.textArtifactHash!==preview.target.textArtifactHash
    ||JSON.stringify([inv.regionBoxMilliPoints,inv.headerFragments,inv.scopeFragments])!==JSON.stringify([selection.regionBoxMilliPoints,selection.headerFragments,selection.scopeFragments]))
    throw new Error("Область изменилась после предпросмотра. Проверьте строки снова");
  if(identity.complete&&!inventoryCanAssertComplete(preview.result.inventory))throw new Error("Полноту нельзя подтвердить: перечень пуст или содержит неразобранные строки");
  const claim:MatrixInventoryReviewClaimInput={target:preview.target,selection,entityKey:identity.entityKey.trim(),componentKey:identity.componentKey.trim(),zoneKey:identity.zoneKey.trim(),
    componentRole:"PARTITION_SLAB_JOINT",operatingModeKey:"DECLARED_NOISE_PROTECTION_MEASURES",measurementBasisKey:"SOURCE_AUTHORED_MEASURE_MEMBERSHIP",
    assertion:identity.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:identity.reference.trim()};
  const claims=(scope?.claims??[]).filter(c=>c.target.inventoryContentHash!==claim.target.inventoryContentHash);
  return matrixInventoryScopeInputSchema.parse({schemaVersion:"matrix-inventory-review-v1",claims:[...claims,claim]});
}

export function InventoryReconstruction({inventory}: {inventory:MatrixSourceInventory}) {
  return <div className="inventory-reconstruction"><p>Стадия {inventory.stage} · PDF {inventory.pageNumber}. Строк перечня: {inventory.featureRows.length}. Неразобранных строк: {inventory.unresolvedRows.length}.</p>
    <p>Заголовок: {inventory.headerFragments[0]?.rawText}<br/>Область применения: {inventory.scopeFragments[0]?.rawText}</p>
    <ul>{inventory.featureRows.map((row,i)=><li key={`feature-${i}`}>{row.fragments[0].rawText}</li>)}
      {inventory.unresolvedRows.map((row,i)=><li key={`unresolved-${i}`}><strong>{row.reasonCode==="DUPLICATE_FEATURE"?"Повтор строки":"Не разобрано"}:</strong> {row.fragments[0].rawText}</li>)}</ul>
    {!inventoryCanAssertComplete(inventory)&&<p>Подтверждение полноты недоступно: нужен непустой перечень без неразобранных и повторных строк.</p>}
  </div>;
}

export function SourceInventoryReviewFields(props:Props) {
  return <InventoryReviewEditor key={JSON.stringify([props.objectId,props.checkId,props.file.id,props.file.sha256,props.reviewHash])} {...props}/>;
}
function InventoryReviewEditor(props:Props) {
  const {objectId,checkId,file,reviewHash,value,onChange,disabled}=props;
  const [origin,setOrigin]=useState<MatrixInventorySourcePagesRead|null>(null),[pageNumber,setPageNumber]=useState(1);
  const [percent,setPercent]=useState<Box>([0,0,100,100]),[header,setHeader]=useState(""),[scope,setScope]=useState("");
  const [preview,setPreview]=useState<MatrixInventoryPreviewRead|null>(null),[complete,setComplete]=useState(false);
  const [entityKey,setEntityKey]=useState(""),[componentKey,setComponentKey]=useState(""),[zoneKey,setZoneKey]=useState(""),[reference,setReference]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  const pages=origin?inventoryPages(origin.textArtifact):[],page=pages.find(p=>p.pageNumber===pageNumber);
  const headers=page?.fragments.filter(f=>f.rawText===HEADER)??[],scopes=page?.fragments.filter(f=>SCOPE.test(f.rawText))??[];
  const key=(f:MatrixInventoryFragment)=>`${f.blockIndex}:${f.lineIndex}`;
  const selectedHeader=headers.find(f=>key(f)===header)??(headers.length===1?headers[0]:undefined);
  const selectedScope=scopes.find(f=>key(f)===scope)??(scopes.length===1?scopes[0]:undefined);
  let region:Box|undefined,selection:MatrixInventorySelection|undefined;
  if(page)try{region=inventoryRegion(page,percent);if(selectedHeader&&selectedScope)selection={pageNumber:page.pageNumber,regionBoxMilliPoints:region,headerFragments:[selectedHeader],scopeFragments:[selectedScope]};}catch{/* Validated when requesting preview. */}
  const invalidate=()=>{generation.current++;request.current?.abort();setBusy(false);setPreview(null);setComplete(false);setError(null);setNotice(null);};
  async function load() {
    invalidate();const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await loadSourceInventory({objectId,checkId,file,reviewHash},controller.signal);if(id!==generation.current)return;
      setOrigin(data);const first=inventoryPages(data.textArtifact).find(p=>p.fragments.some(f=>f.rawText===HEADER));setPageNumber(first?.pageNumber??1);setHeader("");setScope("");setPercent([0,0,100,100]);
    }catch(cause){if(!controller.signal.aborted&&id===generation.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function reconstruct() {
    if(!origin||!page)return;invalidate();
    try{inventoryRegion(page,percent);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));return;}
    if(!selection){setError("Выберите исходный заголовок и строку узла на одном листе");return;}
    const id=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);
    try{const data=await previewSourceInventory({objectId,checkId,file,reviewHash},origin,selection,controller.signal);if(id===generation.current)setPreview(data);}
    catch(cause){if(!controller.signal.aborted&&id===generation.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(id===generation.current)setBusy(false);}
  }
  function add() {
    if(!preview||!selection)return;
    try{onChange(addInventoryClaim(value,preview,selection,{entityKey,componentKey,zoneKey,reference,complete}));setError(null);setNotice("Область добавлена в черновик. Сохраните решение по источнику ниже.");}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  }
  const reconstructed=preview?.result.status==="RECONSTRUCTED"?preview.result.inventory:null;
  return <fieldset className="source-inventory-review" disabled={disabled} aria-label="Перечень мероприятий узла">
    <legend>Перечень мероприятий узла перегородки и перекрытия</legend>
    <p>Человек подтверждает полноту перечня в указанной области документа. Машинно проверены источники, строки и границы области. Полнота всего объекта не доказана.</p>
    {(value?.claims??[]).map((claim,i)=><div className="inventory-saved-claim" key={claim.target.inventoryContentHash}>
      <p>PDF {claim.selection.pageNumber} · {claim.selection.scopeFragments[0]?.rawText}<br/>{claim.entityKey} · {claim.componentKey} · {claim.zoneKey}<br/>
        {claim.assertion==="HUMAN_ASSERTED_COMPLETE"?"Полнота выбранной области подтверждена человеком":"Полнота не установлена"}</p>
      <button type="button" onClick={()=>{onChange({schemaVersion:"matrix-inventory-review-v1",claims:value!.claims.filter((_,n)=>n!==i)});setNotice("Удаление области в черновике. Сохраните решение по источнику ниже.");}}>Удалить область из решения</button>
    </div>)}
    {value?.claims.length===0&&<p>Перечни отозваны в этом черновике. Изменение вступит в силу после сохранения решения.</p>}
    <button type="button" onClick={()=>void load()} disabled={busy}>{busy?"Проверяем источник…":origin?"Обновить исходные листы":"Загрузить исходные листы для перечня"}</button>
    {origin&&<>
      <label><span>Страница перечня PDF</span><select value={pageNumber} onChange={e=>{invalidate();setPageNumber(Number(e.target.value));setHeader("");setScope("");setPercent([0,0,100,100]);}}>
        {pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>{p.pageNumber}</option>)}</select></label>
      {(!headers.length||!scopes.length)&&<p>На выбранном листе нет поддержанного заголовка или строки узла с точными координатами. Полноту подтвердить нельзя.</p>}
      <label><span>Исходный заголовок</span><select value={selectedHeader?key(selectedHeader):""} onChange={e=>{invalidate();setHeader(e.target.value);}}><option value="">Выберите строку</option>{headers.map(f=><option key={key(f)} value={key(f)}>{f.rawText} · строка {f.blockIndex+1}:{f.lineIndex+1}</option>)}</select></label>
      <label><span>Исходная строка узла</span><select value={selectedScope?key(selectedScope):""} onChange={e=>{invalidate();setScope(e.target.value);}}><option value="">Выберите строку</option>{scopes.map(f=><option key={key(f)} value={key(f)}>{f.rawText} · строка {f.blockIndex+1}:{f.lineIndex+1}</option>)}</select></label>
      <p>Границы на исходном листе, в процентах его ширины и высоты. Область должна включать заголовок, строку узла и весь подтверждаемый перечень.</p>
      <div className="source-review-fields">{["Слева, %","Сверху, %","Справа, %","Снизу, %"].map((label,i)=><label key={label}><span>{label}</span><input type="number" min={0} max={100} step="any" value={Number.isNaN(percent[i])?"":percent[i]} onChange={e=>{invalidate();setPercent(previous=>previous.map((n,j)=>j===i?e.target.valueAsNumber:n) as Box);}}/></label>)}</div>
      {page&&region&&<InspectorEvidenceViewer objectId={objectId} file={file} evidence={inventoryRegionEvidence(file,page,region,origin.stage)} stage={origin.stage} onOpened={()=>{}}/>}
      <button type="button" onClick={()=>void reconstruct()} disabled={busy||!selection}>Проверить строки выбранной области</button>
    </>}
    {preview?.result.status==="ABSTAIN"&&<p role="status">Область не разобрана: {preview.result.reasonCode}. Исправьте область или исходную разметку. Решение о полноте не создано.</p>}
    {reconstructed&&<>
      <InventoryReconstruction inventory={reconstructed}/>
      <label><span>Объект сопоставления</span><input value={entityKey} onChange={e=>{setEntityKey(e.target.value);setComplete(false);}} maxLength={200} placeholder="Проверенный одинаковый код в ПД и РД"/></label>
      <label><span>Элемент узла</span><input value={componentKey} onChange={e=>{setComponentKey(e.target.value);setComplete(false);}} maxLength={200}/></label>
      <label><span>Зона или оси</span><input value={zoneKey} onChange={e=>{setZoneKey(e.target.value);setComplete(false);}} maxLength={200}/></label>
      <label><span>Основание сопоставления и полноты области</span><textarea value={reference} onChange={e=>{setReference(e.target.value);setComplete(false);}} maxLength={1000} rows={3}/></label>
      <label><input type="checkbox" checked={complete} disabled={!inventoryCanAssertComplete(reconstructed)} onChange={e=>setComplete(e.target.checked)}/> Подтверждаю полноту перечня только в выбранной области документа</label>
      <button type="button" onClick={add} disabled={busy||!entityKey.trim()||!componentKey.trim()||!zoneKey.trim()||[...reference.trim()].length<8}>Добавить область в решение по источнику</button>
    </>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
