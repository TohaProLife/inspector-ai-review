import { useState } from "react";
import { matrixWaterNodeScopeInputSchema, matrixWaterNodeInventorySelectionSchema, matrixWaterNodeInventoryTargetSchema,
  matrixWaterNodeSourceInventorySchema, type MatrixWaterNodeReviewClaimInput, type MatrixWaterNodeScopeInput,
  type MatrixWaterNodeInventorySelection, type MatrixWaterNodeInventoryTarget, type MatrixWaterNodeIdentity,
  type MatrixWaterNodeSourceInventory } from "@inspector-ai/contracts";

export interface WaterNodeSourceIdentity {
  checkId:string; sourceFileId:string; sourceSha256:string; reviewHash:string|null;
}
/** Preloaded authenticated response plus the exact selection sent for preview.
 * This component does not retrieve source text or create a client snapshot. */
export interface WaterNodePreview extends Omit<WaterNodeSourceIdentity,"reviewHash"> {
  latestReviewHash:string|null; selection:MatrixWaterNodeInventorySelection;
  target?:MatrixWaterNodeInventoryTarget;
  result:{schemaVersion:"matrix-zu129-water-node-source-result-v1";status:"RECONSTRUCTED";inventory:MatrixWaterNodeSourceInventory}|{schemaVersion:"matrix-zu129-water-node-source-result-v1";status:"ABSTAIN";reasonCode:string};
}
export interface SourceWaterNodeReviewFieldsProps extends WaterNodeSourceIdentity {
  value?:MatrixWaterNodeScopeInput; onChange:(value:MatrixWaterNodeScopeInput)=>void;
  disabled:boolean; preview?:WaterNodePreview;
}
const VERSION="matrix-zu129-water-node-review-v1" as const;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function validateWaterNodePreview(identity:WaterNodeSourceIdentity, preview:WaterNodePreview):{
  inventory:MatrixWaterNodeSourceInventory;target:MatrixWaterNodeInventoryTarget;selection:MatrixWaterNodeInventorySelection;
} {
  if(preview.checkId!==identity.checkId||preview.sourceFileId!==identity.sourceFileId
    ||preview.sourceSha256!==identity.sourceSha256||preview.latestReviewHash!==identity.reviewHash)
    throw Error("Источник или решение изменились. Обновите предпросмотр.");
  if(preview.result.schemaVersion!=="matrix-zu129-water-node-source-result-v1"||preview.result.status!=="RECONSTRUCTED"||!preview.target)throw Error("Нужен подтверждённый сервером предпросмотр исходных строк.");
  const inventory=matrixWaterNodeSourceInventorySchema.parse(preview.result.inventory);
  const target=matrixWaterNodeInventoryTargetSchema.parse(preview.target),selection=matrixWaterNodeInventorySelectionSchema.parse(preview.selection);
  if(target.checkId!==identity.checkId||target.textArtifactHash!==inventory.textArtifactHash
    ||inventory.sourceFileId!==identity.sourceFileId||inventory.sourceSha256!==identity.sourceSha256
    ||!same([inventory.pageNumber,inventory.regionBoxMilliPoints,inventory.headerFragments,inventory.scopeFragments,inventory.endFragments],
      [selection.pageNumber,selection.regionBoxMilliPoints,selection.headerFragments,selection.scopeFragments,selection.endFragments]))
    throw Error("Предпросмотр не совпадает с выбранными исходными строками и границами.");
  return {inventory,target,selection};
}
export interface WaterNodeHumanInput {
  identity:MatrixWaterNodeIdentity; reference:string; sameNode:boolean; complete:boolean;
}
export function appendWaterNodePreview(scope:MatrixWaterNodeScopeInput|undefined,
  source:WaterNodeSourceIdentity, preview:WaterNodePreview,human:WaterNodeHumanInput):MatrixWaterNodeScopeInput {
  const {inventory,target,selection}=validateWaterNodePreview(source,preview);
  if(scope)scope=matrixWaterNodeScopeInputSchema.parse(scope);
  if(scope?.claims.some(claim=>claim.target.inventoryContentHash===target.inventoryContentHash))
    throw Error("Эта область уже есть в черновике. Измените сохранённую область или явно отзовите её.");
  // Preserve all earlier claims. Competing regions must remain visible to the
  // independent comparator; never silently replace or merge by node or hash.
  return matrixWaterNodeScopeInputSchema.parse({schemaVersion:VERSION,claims:[...(scope?.claims??[]),{
    target,selection,identity:human.identity,nodeMapping:{kind:"HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING",
      sourceBuildingToken:inventory.buildingToken,sourceNodeToken:inventory.nodeToken,assertion:human.sameNode?"HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE":"UNKNOWN"},
    assertion:human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  }]});
}
export function reviseWaterNodeClaim(scope:MatrixWaterNodeScopeInput,index:number,human:WaterNodeHumanInput):MatrixWaterNodeScopeInput {
  scope=matrixWaterNodeScopeInputSchema.parse(scope);
  if(!Number.isSafeInteger(index)||index<0)throw Error("Область отсутствует в текущем решении.");
  const prior=scope.claims[index];if(!prior)throw Error("Область отсутствует в текущем решении.");
  const identityChanged=!same(prior.identity,human.identity);
  return matrixWaterNodeScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.map((claim,i)=>i!==index?claim:{
    target:claim.target,selection:claim.selection,identity:human.identity,
    nodeMapping:{kind:claim.nodeMapping.kind,sourceBuildingToken:claim.nodeMapping.sourceBuildingToken,sourceNodeToken:claim.nodeMapping.sourceNodeToken,
      assertion:!identityChanged&&human.sameNode?"HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE":"UNKNOWN"},
    assertion:!identityChanged&&human.complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:human.reference,
  })});
}
export function withdrawWaterNodeClaim(scope:MatrixWaterNodeScopeInput,index:number):MatrixWaterNodeScopeInput {
  scope=matrixWaterNodeScopeInputSchema.parse(scope);
  if(!Number.isSafeInteger(index)||index<0||!scope.claims[index])throw Error("Область отсутствует в текущем решении.");
  return matrixWaterNodeScopeInputSchema.parse({schemaVersion:VERSION,claims:scope.claims.filter((_,i)=>i!==index)});
}
const emptyIdentity=():MatrixWaterNodeIdentity=>({entityKey:"",buildingKey:"",nodeKey:"",service:"COLD_WATER",
  accountingScope:"COMMON_BUILDING_INLET",componentRole:"COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS"});
const fields=[['entityKey','Общий идентификатор узла'],['buildingKey','Здание для сопоставления'],['nodeKey','Вводной узел для сопоставления']] as const;
function HumanFields({value,onChange}: {value:WaterNodeHumanInput;onChange:(v:WaterNodeHumanInput)=>void}) {
  return <>
    {fields.map(([key,label])=><label key={key}><span>{label}</span><input value={value.identity[key]} maxLength={200}
      onChange={e=>onChange({...value,identity:{...value.identity,[key]:e.target.value},sameNode:false,complete:false})}/></label>)}
    <label><span>Основание сопоставления узла и полноты области</span><textarea value={value.reference}
      onChange={e=>onChange({...value,reference:e.target.value})}/></label>
    <label><input type="checkbox" checked={value.sameNode} onChange={e=>onChange({...value,sameNode:e.target.checked})}/>
      Человек сопоставил исходные обозначения с тем же общедомовым вводным узлом холодной воды</label>
    <label><input type="checkbox" checked={value.complete} onChange={e=>onChange({...value,complete:e.target.checked})}/>
      Человек проверил весь состав оборудования узла в выбранной области</label>
  </>;
}
function StoredClaim({claim,index,onApply,onWithdraw}: {claim:MatrixWaterNodeReviewClaimInput;index:number;
  onApply:(v:WaterNodeHumanInput)=>void;onWithdraw:()=>void}) {
  const initial=()=>({identity:{...claim.identity},reference:claim.reference,
    sameNode:claim.nodeMapping.assertion==="HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE",complete:claim.assertion==="HUMAN_ASSERTED_COMPLETE"});
  const [human,setHuman]=useState(initial),[dirty,setDirty]=useState(false),[error,setError]=useState("");
  return <fieldset aria-label={`Сохранённая область водомерного узла ${index+1}`}>
    <legend>PDF {claim.selection.pageNumber} · {claim.nodeMapping.sourceBuildingToken} · {claim.nodeMapping.sourceNodeToken}</legend>
    <p>{claim.assertion==="UNKNOWN"?"UNKNOWN: полнота области не установлена":"Полноту выбранной области подтвердил человек"}.
      {claim.nodeMapping.assertion==="UNKNOWN"?" Сопоставление узла не установлено.":" Сопоставление узла подтвердил человек."}</p>
    <p>Система: ХВС · Назначение: общедомовой учёт</p>
    <HumanFields value={human} onChange={v=>{setHuman(v);setDirty(true);setError("");}}/>
    <button type="button" disabled={!dirty} onClick={()=>{try{onApply(human);setDirty(false);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Применить изменения области в черновик</button>
    <button type="button" onClick={onWithdraw}>Отозвать область водомерного узла из решения</button>
    {dirty&&<p role="status">Изменения полей ещё не применены к черновику решения.</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
function NewClaim({source,preview,onAdd}: {source:WaterNodeSourceIdentity;preview:WaterNodePreview;onAdd:(v:WaterNodeHumanInput)=>void}) {
  const [human,setHuman]=useState<WaterNodeHumanInput>(()=>({identity:emptyIdentity(),reference:"",sameNode:false,complete:false}));
  const [error,setError]=useState("");let verified:ReturnType<typeof validateWaterNodePreview>|undefined,previewError="";
  try{verified=validateWaterNodePreview(source,preview);}catch(e){previewError=e instanceof Error?e.message:String(e);}
  if(!verified)return <p role="alert">{previewError}</p>;
  const inv=verified.inventory;
  return <fieldset aria-label="Новая область водомерного узла из предпросмотра"><legend>Проверенный исходный перечень · PDF {inv.pageNumber}</legend>
    <p>Исходное здание: {inv.buildingToken} · Исходный вводной узел: {inv.nodeToken}</p>
    <ul>{[...inv.headerFragments,...inv.scopeFragments,...inv.featureRows.flatMap(row=>row.fragments),...inv.endFragments]
      .map((f,i)=><li key={i}>{f.rawText}</li>)}</ul>
    <p>Система: ХВС · Назначение: общедомовой учёт</p>
    <HumanFields value={human} onChange={v=>{setHuman(v);setError("");}}/>
    <button type="button" onClick={()=>{try{onAdd(human);setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}}}>Добавить область водомерного узла в черновик</button>
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
export function SourceWaterNodeReviewFields(props:SourceWaterNodeReviewFieldsProps) {
  return <WaterNodeEditor key={JSON.stringify([props.checkId,props.sourceFileId,props.sourceSha256,props.reviewHash])} {...props}/>;
}
function WaterNodeEditor(props:SourceWaterNodeReviewFieldsProps) {
  const {value,onChange,preview}=props;
  const [notice,setNotice]=useState("");
  return <fieldset disabled={props.disabled} aria-label="Состав водомерного узла">
    <legend>Общедомовой вводной узел холодной воды · ZU-129</legend>
    <p>Полнота относится к выбранной области документа. Сопоставление узла и полноту подтверждает человек.
      Отсутствие оборудования в реальном узле этой формой не доказывается.</p>
    {(value?.claims??[]).map((claim,i)=><StoredClaim key={JSON.stringify([i,claim])} claim={claim} index={i}
      onApply={human=>{if(props.disabled)return;onChange(reviseWaterNodeClaim(value!,i,human));setNotice("Изменения области в черновике. Сохраните решение по источнику.");}}
      onWithdraw={()=>{if(props.disabled)return;onChange(withdrawWaterNodeClaim(value!,i));setNotice("Отзыв области в черновике. Сохраните решение по источнику.");}}/>)}
    {value?.claims.length===0&&<p>Все области водомерного узла отозваны в черновике. Отзыв вступит в силу после сохранения решения.</p>}
    {!preview&&<p>Новые области добавляются только из проверенного сервером предпросмотра исходных строк.</p>}
    {preview?.result.status==="ABSTAIN"&&<p role="status">Область не разобрана: {preview.result.reasonCode}. Подтверждение полноты не создано.</p>}
    {preview?.result.status==="RECONSTRUCTED"&&<NewClaim key={JSON.stringify([preview.target,preview.selection])} source={props} preview={preview}
      onAdd={human=>{if(props.disabled)return;onChange(appendWaterNodePreview(value,props,preview,human));setNotice("Область добавлена в черновик. Сохраните решение по источнику.");}}/>}
    {notice&&<p role="status">{notice}</p>}
  </fieldset>;
}
