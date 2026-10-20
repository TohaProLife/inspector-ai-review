import { useState } from "react";
import { matrixCallInventoryScopeInputSchema, matrixCallInventorySelectionSchema, matrixCallInventoryTargetSchema,
  matrixCallSourceInventorySchema, type MatrixCallInventoryReviewClaimInput, type MatrixCallInventoryScopeInput,
  type MatrixCallInventorySelection, type MatrixCallInventoryTarget, type MatrixCallRoomIdentity,
  type MatrixCallSourceInventory } from "@inspector-ai/contracts";

export interface CallInventorySourceIdentity {
  checkId:string; sourceFileId:string; sourceSha256:string; reviewHash:string|null;
}
/** Preloaded authenticated response plus the exact selection sent for preview.
 * This component does not retrieve source text or create a client snapshot. */
export interface CallInventoryPreview extends Omit<CallInventorySourceIdentity,"reviewHash"> {
  latestReviewHash:string|null; selection:MatrixCallInventorySelection;
  target?:MatrixCallInventoryTarget;
  result:{status:"RECONSTRUCTED";inventory:MatrixCallSourceInventory}|{status:"ABSTAIN";reasonCode:string};
}
export interface SourceCallInventoryReviewFieldsProps extends CallInventorySourceIdentity {
  value?:MatrixCallInventoryScopeInput; onChange:(value:MatrixCallInventoryScopeInput)=>void;
  disabled:boolean; preview?:CallInventoryPreview;
}
const VERSION="matrix-odi123-call-inventory-review-v1" as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function validateCallInventoryPreview(identity:CallInventorySourceIdentity, preview:CallInventoryPreview):{
  inventory:MatrixCallSourceInventory;target:MatrixCallInventoryTarget;selection:MatrixCallInventorySelection;
} {
  if(preview.checkId!==identity.checkId||preview.sourceFileId!==identity.sourceFileId
    ||preview.sourceSha256!==identity.sourceSha256||preview.latestReviewHash!==identity.reviewHash)
    throw Error("Источник или решение изменились. Обновите предпросмотр.");
  if(preview.result.status!=="RECONSTRUCTED"||!preview.target)throw Error("Нужен подтверждённый сервером предпросмотр исходных строк.");
  const inventory=matrixCallSourceInventorySchema.parse(preview.result.inventory);
  const target=matrixCallInventoryTargetSchema.parse(preview.target),selection=matrixCallInventorySelectionSchema.parse(preview.selection);
  if(target.checkId!==identity.checkId||target.textArtifactHash!==inventory.textArtifactHash
    ||inventory.sourceFileId!==identity.sourceFileId||inventory.sourceSha256!==identity.sourceSha256
    ||!same([inventory.pageNumber,inventory.regionBoxMilliPoints,inventory.headerFragments,inventory.scopeFragments,inventory.endFragments],
      [selection.pageNumber,selection.regionBoxMilliPoints,selection.headerFragments,selection.scopeFragments,selection.endFragments]))
    throw Error("Предпросмотр не совпадает с выбранными исходными строками и границами.");
  return {inventory,target,selection};
}
export interface CallInventoryHumanInput {
  identity:MatrixCallRoomIdentity; reference:string; sameRoom:boolean; complete:boolean;
}
export function appendCallInventoryPreview(scope:MatrixCallInventoryScopeInput|undefined,
  source:CallInventorySourceIdentity, preview:CallInventoryPreview,human:CallInventoryHumanInput):MatrixCallInventoryScopeInput {
  const {inventory,target,selection}=validateCallInventoryPreview(source,preview);
  if(scope?.claims.some(claim=>claim.target.inventoryContentHash===target.inventoryContentHash))
    throw Error("Эта область уже есть в черновике. Измените сохранённую область или явно отзовите её.");
  // Preserve all earlier claims. Competing regions must remain visible to the
  // independent comparator; never silently replace or merge by room or hash.
  return matrixCallInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:[...(scope?.claims??[]),{
    target,selection,identity:human.identity,roomMapping:{kind:"HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING",
      sourceRoomToken:inventory.roomToken,assertion:human.sameRoom?"HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM":"UNKNOWN"},
    assertion:human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  }]});
}
export function reviseCallInventoryClaim(scope:MatrixCallInventoryScopeInput,index:number,human:CallInventoryHumanInput):MatrixCallInventoryScopeInput {
  const prior=scope.claims[index];if(!prior)throw Error("Область отсутствует в текущем решении.");
  return matrixCallInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.map((claim,i)=>i!==index?claim:{
    target:claim.target,selection:claim.selection,identity:human.identity,
    roomMapping:{kind:claim.roomMapping.kind,sourceRoomToken:claim.roomMapping.sourceRoomToken,
      assertion:human.sameRoom?"HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM":"UNKNOWN"},
    assertion:human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  })});
}
export function withdrawCallInventoryClaim(scope:MatrixCallInventoryScopeInput,index:number):MatrixCallInventoryScopeInput {
  if(!scope.claims[index])throw Error("Область отсутствует в текущем решении.");
  return matrixCallInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.filter((_,i)=>i!==index)});
}
const emptyIdentity=():MatrixCallRoomIdentity=>({entityKey:"",buildingKey:"",floorKey:"",roomKey:"",
  componentRole:"ACCESSIBLE_SANITARY_ROOM_CALL_SYSTEM",systemKind:"PERSONNEL_CALL"});
const fields=[['entityKey','Общий идентификатор комнаты'],['buildingKey','Здание'],['floorKey','Этаж'],['roomKey','Комната для сопоставления']] as const;
function HumanFields({value,onChange}: {value:CallInventoryHumanInput;onChange:(v:CallInventoryHumanInput)=>void}) {
  return <>
    {fields.map(([key,label])=><label key={key}><span>{label}</span><input value={value.identity[key]} maxLength={200}
      onChange={e=>onChange({...value,identity:{...value.identity,[key]:e.target.value},sameRoom:false,complete:false})}/></label>)}
    <label><span>Основание сопоставления комнаты и полноты области</span><textarea value={value.reference}
      onChange={e=>onChange({...value,reference:e.target.value})}/></label>
    <label><input type="checkbox" checked={value.sameRoom} onChange={e=>onChange({...value,sameRoom:e.target.checked})}/>
      Человек сопоставил эту комнату с той же доступной санитарной комнатой в другом документе</label>
    <label><input type="checkbox" checked={value.complete} onChange={e=>onChange({...value,complete:e.target.checked})}/>
      Человек проверил весь перечень оборудования вызова в выбранной области</label>
  </>;
}
function StoredClaim({claim,index,onApply,onWithdraw}: {claim:MatrixCallInventoryReviewClaimInput;index:number;
  onApply:(v:CallInventoryHumanInput)=>void;onWithdraw:()=>void}) {
  const initial=()=>({identity:{...claim.identity},reference:claim.reference,
    sameRoom:claim.roomMapping.assertion==="HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM",complete:claim.assertion==="HUMAN_ASSERTED_COMPLETE"});
  const [human,setHuman]=useState(initial),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  return <fieldset aria-label={`Сохранённая область вызова ${index+1}`}>
    <legend>PDF {claim.selection.pageNumber} · {claim.roomMapping.sourceRoomToken}</legend>
    <p>{claim.assertion==="UNKNOWN"?"UNKNOWN: полнота области не установлена":"Полноту выбранной области подтвердил человек"}.
      {claim.roomMapping.assertion==="UNKNOWN"?" Сопоставление комнаты не установлено.":" Сопоставление комнаты подтвердил человек."}</p>
    <HumanFields value={human} onChange={v=>{setHuman(v);setDirty(true);setError("");}}/>
    <button type="button" disabled={!dirty} onClick={()=>{try{onApply(human);setDirty(false);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Применить изменения области в черновик</button>
    <button type="button" onClick={onWithdraw}>Отозвать область вызова из решения</button>
    {dirty&&<p role="status">Изменения полей ещё не применены к черновику решения.</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
function NewClaim({source,preview,onAdd}: {source:CallInventorySourceIdentity;preview:CallInventoryPreview;onAdd:(v:CallInventoryHumanInput)=>void}) {
  const [human,setHuman]=useState<CallInventoryHumanInput>(()=>({identity:emptyIdentity(),reference:"",sameRoom:false,complete:false}));
  const [error,setError]=useState("");let verified:ReturnType<typeof validateCallInventoryPreview>|undefined,previewError="";
  try{verified=validateCallInventoryPreview(source,preview);}catch(e){previewError=e instanceof Error?e.message:String(e);}
  if(!verified)return <p role="alert">{previewError}</p>;
  const inv=verified.inventory;
  return <fieldset aria-label="Новая область вызова из предпросмотра"><legend>Проверенный исходный перечень · PDF {inv.pageNumber}</legend>
    <p>Исходное обозначение комнаты: {inv.roomToken}</p>
    <ul>{[...inv.headerFragments,...inv.scopeFragments,...inv.featureRows.flatMap(row=>row.fragments),...inv.endFragments]
      .map((f,i)=><li key={i}>{f.rawText}</li>)}</ul>
    <HumanFields value={human} onChange={v=>{setHuman(v);setError("");}}/>
    <button type="button" onClick={()=>{try{onAdd(human);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Добавить область вызова в черновик</button>
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
export function SourceCallInventoryReviewFields(props:SourceCallInventoryReviewFieldsProps) {
  return <CallInventoryEditor key={JSON.stringify([props.checkId,props.sourceFileId,props.sourceSha256,props.reviewHash])} {...props}/>;
}
function CallInventoryEditor(props:SourceCallInventoryReviewFieldsProps) {
  const {value,onChange,preview}=props;
  const [notice,setNotice]=useState("");
  return <fieldset disabled={props.disabled} aria-label="Перечень оборудования вызова в санитарной комнате">
    <legend>Оборудование вызова персонала · ODI-123</legend>
    <p>Полнота относится к выбранной области документа. Сопоставление комнаты и полноту подтверждает человек.
      Отсутствие оборудования в реальном помещении этой формой не доказывается.</p>
    {(value?.claims??[]).map((claim,i)=><StoredClaim key={JSON.stringify([i,claim])} claim={claim} index={i}
      onApply={human=>{onChange(reviseCallInventoryClaim(value!,i,human));setNotice("Изменения области в черновике. Сохраните решение по источнику.");}}
      onWithdraw={()=>{onChange(withdrawCallInventoryClaim(value!,i));setNotice("Отзыв области в черновике. Сохраните решение по источнику.");}}/>)}
    {value?.claims.length===0&&<p>Все области вызова отозваны в черновике. Отзыв вступит в силу после сохранения решения.</p>}
    {!preview&&<p>Новые области добавляются только из проверенного сервером предпросмотра исходных строк.</p>}
    {preview?.result.status==="ABSTAIN"&&<p role="status">Область не разобрана: {preview.result.reasonCode}. Подтверждение полноты не создано.</p>}
    {preview?.result.status==="RECONSTRUCTED"&&<NewClaim key={JSON.stringify([preview.target,preview.selection])} source={props} preview={preview}
      onAdd={human=>{onChange(appendCallInventoryPreview(value,props,preview,human));setNotice("Область добавлена в черновик. Сохраните решение по источнику.");}}/>}
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
