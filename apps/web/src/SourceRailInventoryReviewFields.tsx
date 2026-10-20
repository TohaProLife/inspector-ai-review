import { useState } from "react";
import { matrixRailInventoryScopeInputSchema, matrixRailInventorySelectionSchema, matrixRailInventoryTargetSchema,
  matrixRailSourceInventorySchema, type MatrixRailInventoryReviewClaimInput, type MatrixRailInventoryScopeInput,
  type MatrixRailInventorySelection, type MatrixRailInventoryTarget, type MatrixRailRoomIdentity,
  type MatrixRailSourceInventory } from "@inspector-ai/contracts";

export interface RailInventorySourceIdentity {
  checkId:string; sourceFileId:string; sourceSha256:string; reviewHash:string|null;
}
/** Preloaded authenticated response plus the exact selection sent for preview.
 * This component does not retrieve source text or create a client snapshot. */
export interface RailInventoryPreview extends Omit<RailInventorySourceIdentity,"reviewHash"> {
  latestReviewHash:string|null; selection:MatrixRailInventorySelection;
  target?:MatrixRailInventoryTarget;
  result:{status:"RECONSTRUCTED";inventory:MatrixRailSourceInventory}|{status:"ABSTAIN";reasonCode:string};
}
export interface SourceRailInventoryReviewFieldsProps extends RailInventorySourceIdentity {
  value?:MatrixRailInventoryScopeInput; onChange:(value:MatrixRailInventoryScopeInput)=>void;
  disabled:boolean; preview?:RailInventoryPreview;
}
const VERSION="matrix-odi120-rail-inventory-review-v1" as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function validateRailInventoryPreview(identity:RailInventorySourceIdentity, preview:RailInventoryPreview):{
  inventory:MatrixRailSourceInventory;target:MatrixRailInventoryTarget;selection:MatrixRailInventorySelection;
} {
  if(preview.checkId!==identity.checkId||preview.sourceFileId!==identity.sourceFileId
    ||preview.sourceSha256!==identity.sourceSha256||preview.latestReviewHash!==identity.reviewHash)
    throw Error("Источник или решение изменились. Обновите предпросмотр.");
  if(preview.result.status!=="RECONSTRUCTED"||!preview.target)throw Error("Нужен подтверждённый сервером предпросмотр исходных строк.");
  const inventory=matrixRailSourceInventorySchema.parse(preview.result.inventory);
  const target=matrixRailInventoryTargetSchema.parse(preview.target),selection=matrixRailInventorySelectionSchema.parse(preview.selection);
  if(target.checkId!==identity.checkId||target.textArtifactHash!==inventory.textArtifactHash
    ||inventory.sourceFileId!==identity.sourceFileId||inventory.sourceSha256!==identity.sourceSha256
    ||!same([inventory.pageNumber,inventory.regionBoxMilliPoints,inventory.headerFragments,inventory.scopeFragments,inventory.endFragments],
      [selection.pageNumber,selection.regionBoxMilliPoints,selection.headerFragments,selection.scopeFragments,selection.endFragments]))
    throw Error("Предпросмотр не совпадает с выбранными исходными строками и границами.");
  return {inventory,target,selection};
}
export interface RailInventoryHumanInput {
  identity:MatrixRailRoomIdentity; reference:string; sameRoom:boolean; complete:boolean;
}
export function appendRailInventoryPreview(scope:MatrixRailInventoryScopeInput|undefined,
  source:RailInventorySourceIdentity, preview:RailInventoryPreview,human:RailInventoryHumanInput):MatrixRailInventoryScopeInput {
  const {inventory,target,selection}=validateRailInventoryPreview(source,preview);
  if(scope?.claims.some(claim=>claim.target.inventoryContentHash===target.inventoryContentHash))
    throw Error("Эта область уже есть в черновике. Измените сохранённую область или явно отзовите её.");
  // Preserve all earlier claims. Competing regions must remain visible to the
  // independent comparator; never silently replace or merge by room or hash.
  return matrixRailInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:[...(scope?.claims??[]),{
    target,selection,identity:human.identity,roomMapping:{kind:"HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING",
      sourceRoomToken:inventory.roomToken,assertion:human.sameRoom?"HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM":"UNKNOWN"},
    assertion:human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  }]});
}
export function reviseRailInventoryClaim(scope:MatrixRailInventoryScopeInput,index:number,human:RailInventoryHumanInput):MatrixRailInventoryScopeInput {
  const prior=scope.claims[index];if(!prior)throw Error("Область отсутствует в текущем решении.");
  return matrixRailInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.map((claim,i)=>i!==index?claim:{
    target:claim.target,selection:claim.selection,identity:human.identity,
    roomMapping:{kind:claim.roomMapping.kind,sourceRoomToken:claim.roomMapping.sourceRoomToken,
      assertion:human.sameRoom?"HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM":"UNKNOWN"},
    assertion:human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  })});
}
export function withdrawRailInventoryClaim(scope:MatrixRailInventoryScopeInput,index:number):MatrixRailInventoryScopeInput {
  if(!scope.claims[index])throw Error("Область отсутствует в текущем решении.");
  return matrixRailInventoryScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.filter((_,i)=>i!==index)});
}
const emptyIdentity=():MatrixRailRoomIdentity=>({entityKey:"",buildingKey:"",floorKey:"",roomKey:"",
  componentRole:"ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY"});
const fields=[['entityKey','Общий идентификатор комнаты'],['buildingKey','Здание'],['floorKey','Этаж'],['roomKey','Комната для сопоставления']] as const;
function HumanFields({value,onChange}: {value:RailInventoryHumanInput;onChange:(v:RailInventoryHumanInput)=>void}) {
  return <>
    {fields.map(([key,label])=><label key={key}><span>{label}</span><input value={value.identity[key]} maxLength={200}
      onChange={e=>onChange({...value,identity:{...value.identity,[key]:e.target.value},sameRoom:false,complete:false})}/></label>)}
    <label><span>Основание сопоставления комнаты и полноты области</span><textarea value={value.reference}
      onChange={e=>onChange({...value,reference:e.target.value})}/></label>
    <label><input type="checkbox" checked={value.sameRoom} onChange={e=>onChange({...value,sameRoom:e.target.checked})}/>
      Человек сопоставил эту комнату с той же доступной санитарной комнатой в другом документе</label>
    <label><input type="checkbox" checked={value.complete} onChange={e=>onChange({...value,complete:e.target.checked})}/>
      Человек проверил весь перечень поручней в выбранной области</label>
  </>;
}
function StoredClaim({claim,index,onApply,onWithdraw}: {claim:MatrixRailInventoryReviewClaimInput;index:number;
  onApply:(v:RailInventoryHumanInput)=>void;onWithdraw:()=>void}) {
  const initial=()=>({identity:{...claim.identity},reference:claim.reference,
    sameRoom:claim.roomMapping.assertion==="HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM",complete:claim.assertion==="HUMAN_ASSERTED_COMPLETE"});
  const [human,setHuman]=useState(initial),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  return <fieldset aria-label={`Сохранённая область поручней ${index+1}`}>
    <legend>PDF {claim.selection.pageNumber} · {claim.roomMapping.sourceRoomToken}</legend>
    <p>{claim.assertion==="UNKNOWN"?"UNKNOWN: полнота области не установлена":"Полноту выбранной области подтвердил человек"}.
      {claim.roomMapping.assertion==="UNKNOWN"?" Сопоставление комнаты не установлено.":" Сопоставление комнаты подтвердил человек."}</p>
    <HumanFields value={human} onChange={v=>{setHuman(v);setDirty(true);setError("");}}/>
    <button type="button" disabled={!dirty} onClick={()=>{try{onApply(human);setDirty(false);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Применить изменения области в черновик</button>
    <button type="button" onClick={onWithdraw}>Отозвать область поручней из решения</button>
    {dirty&&<p role="status">Изменения полей ещё не применены к черновику решения.</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
function NewClaim({source,preview,onAdd}: {source:RailInventorySourceIdentity;preview:RailInventoryPreview;onAdd:(v:RailInventoryHumanInput)=>void}) {
  const [human,setHuman]=useState<RailInventoryHumanInput>(()=>({identity:emptyIdentity(),reference:"",sameRoom:false,complete:false}));
  const [error,setError]=useState("");let verified:ReturnType<typeof validateRailInventoryPreview>|undefined,previewError="";
  try{verified=validateRailInventoryPreview(source,preview);}catch(e){previewError=e instanceof Error?e.message:String(e);}
  if(!verified)return <p role="alert">{previewError}</p>;
  const inv=verified.inventory;
  return <fieldset aria-label="Новая область поручней из предпросмотра"><legend>Проверенный исходный перечень · PDF {inv.pageNumber}</legend>
    <p>Исходное обозначение комнаты: {inv.roomToken}</p>
    <ul>{[...inv.headerFragments,...inv.scopeFragments,...inv.featureRows.flatMap(row=>row.fragments),...inv.endFragments]
      .map((f,i)=><li key={i}>{f.rawText}</li>)}</ul>
    <HumanFields value={human} onChange={v=>{setHuman(v);setError("");}}/>
    <button type="button" onClick={()=>{try{onAdd(human);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Добавить область поручней в черновик</button>
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
export function SourceRailInventoryReviewFields(props:SourceRailInventoryReviewFieldsProps) {
  return <RailInventoryEditor key={JSON.stringify([props.checkId,props.sourceFileId,props.sourceSha256,props.reviewHash])} {...props}/>;
}
function RailInventoryEditor(props:SourceRailInventoryReviewFieldsProps) {
  const {value,onChange,preview}=props;
  const [notice,setNotice]=useState("");
  return <fieldset disabled={props.disabled} aria-label="Перечень поручней в санитарной комнате">
    <legend>Поручни доступного санузла · ODI-120</legend>
    <p>Полнота относится к выбранной области документа. Сопоставление комнаты и полноту подтверждает человек.
      Отсутствие оборудования в реальном помещении этой формой не доказывается.</p>
    {(value?.claims??[]).map((claim,i)=><StoredClaim key={JSON.stringify([i,claim])} claim={claim} index={i}
      onApply={human=>{onChange(reviseRailInventoryClaim(value!,i,human));setNotice("Изменения области в черновике. Сохраните решение по источнику.");}}
      onWithdraw={()=>{onChange(withdrawRailInventoryClaim(value!,i));setNotice("Отзыв области в черновике. Сохраните решение по источнику.");}}/>)}
    {value?.claims.length===0&&<p>Все области поручней отозваны в черновике. Отзыв вступит в силу после сохранения решения.</p>}
    {!preview&&<p>Новые области добавляются только из проверенного сервером предпросмотра исходных строк.</p>}
    {preview?.result.status==="ABSTAIN"&&<p role="status">Область не разобрана: {preview.result.reasonCode}. Подтверждение полноты не создано.</p>}
    {preview?.result.status==="RECONSTRUCTED"&&<NewClaim key={JSON.stringify([preview.target,preview.selection])} source={props} preview={preview}
      onAdd={human=>{onChange(appendRailInventoryPreview(value,props,preview,human));setNotice("Область добавлена в черновик. Сохраните решение по источнику.");}}/>}
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
