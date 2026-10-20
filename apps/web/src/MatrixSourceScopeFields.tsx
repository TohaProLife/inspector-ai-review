import { useState } from "react";
import type { LegacyMatrixSourceScope as MatrixSourceScope } from "@inspector-ai/contracts";
import registry from "../../../services/worker/rules/matrix-execution-v1.json";

type Rule={ruleId:string;attribute:string;canonicalUnit:string;threshold:{value:string}|null;requiredContext:string[];expectedSections:string[];actualSections:string[];
  subruleContext?:{schemaVersion:string;componentRole:string;identityFields:string[]}};
const contextLabels:Record<string,string>={componentKey:"Позиция оборудования или слой",zoneKey:"Зона обслуживания или участок",
  operatingModeKey:"Режим работы или состояние конструкции",measurementBasisKey:"База измерения и расчётная точка"};
const entries=(registry.entries as Array<{parameterCode:string;name:string;trigger:string;atomicRules:Rule[]}>).filter(entry=>entry.atomicRules.length);

function atomicSelection(rules:Rule[],atomicContexts:Record<string,Record<string,string>>) {
  let partiallyFilled=false;
  const ready=rules.filter(rule=>{
    if(!rule.subruleContext)return true;
    const fields=rule.subruleContext.identityFields;
    const filled=fields.filter(field=>atomicContexts[rule.ruleId]?.[field]?.trim()).length;
    if(filled>0&&filled<fields.length)partiallyFilled=true;
    return filled===fields.length;
  });
  return {ready,partiallyFilled};
}

/** Replace the selected parameter's judgments; previous completeness cannot outlive its context. */
export function prepareMatrixSourceScope(input:{value:MatrixSourceScope|undefined;entityKey:string;reference:string;
  parameterCode:string;rules:Rule[];atomicContexts:Record<string,Record<string,string>>;
  complete:boolean;drawingSection:string;limit:string}):MatrixSourceScope|undefined {
  const {value,rules,atomicContexts,complete,drawingSection,limit,parameterCode}=input;
  const entityKey=input.entityKey.trim(),reference=input.reference.trim();
  const {ready,partiallyFilled}=atomicSelection(rules,atomicContexts);
  if(!entityKey||reference.length<8||partiallyFilled||!ready.length
    ||ready.some(rule=>rule.requiredContext.includes("TECHNICAL_CONDITIONS_LIMIT"))&&!/^\d+(?:\.\d+)?$/u.test(limit))return;
  const contexts:MatrixSourceScope["contexts"]=value?.entityKey===entityKey?{...value.contexts}:{};
  for(const rule of rules) {
    for(const key of rule.requiredContext)delete contexts[key];
    delete contexts[`RULE_SCOPE_COMPLETE:${rule.ruleId}`];
  }
  delete contexts[`PARAMETER_SCOPE_COMPLETE:${parameterCode}`];
  for(const rule of ready)for(const key of rule.requiredContext) {
    const details:MatrixSourceScope["contexts"][string]={reference};
    if(key==="NORM_APPLICABILITY_VERIFIED")Object.assign(details,{applicable:true,parameterCode,
      attribute:rule.attribute,threshold:rule.threshold!.value,canonicalUnit:rule.canonicalUnit});
    if(key==="TECHNICAL_CONDITIONS_LIMIT")Object.assign(details,{limitValue:limit,canonicalUnit:rule.canonicalUnit});
    if(key==="APPROVED_CHANGE_STATUS")details.approvedChangePresent=false;
    if(key==="THERMAL_RESISTANCE_REDUCTION_VERIFIED")details.reductionConfirmed=true;
    if(key===`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`&&rule.subruleContext)Object.assign(details,{
      parameterCode,attribute:rule.attribute,canonicalUnit:rule.canonicalUnit,
      componentRole:rule.subruleContext.componentRole,...Object.fromEntries(rule.subruleContext.identityFields
        .map(field=>[field,atomicContexts[rule.ruleId][field].trim()]))});
    contexts[key]=details;
  }
  if(drawingSection)contexts.DRAWING_SECTION_VERIFIED={reference,drawingSection};
  if(complete) {
    for(const rule of ready)contexts[`RULE_SCOPE_COMPLETE:${rule.ruleId}`]={reference};
    if(ready.length===rules.length)contexts[`PARAMETER_SCOPE_COMPLETE:${parameterCode}`]={reference};
  }
  return {entityKey,reference,contexts};
}

export function MatrixSourceScopeFields({value,onChange,disabled}:{value:MatrixSourceScope|undefined;
  onChange:(value:MatrixSourceScope|undefined)=>void;disabled:boolean}) {
  const [entity,setEntity]=useState("");const [reference,setReference]=useState("");
  const [code,setCode]=useState(entries[0].parameterCode);const [confirmed,setConfirmed]=useState(false);
  const [complete,setComplete]=useState(false);const [drawingSection,setDrawingSection]=useState("");
  const [limit,setLimit]=useState("");
  const [atomicContexts,setAtomicContexts]=useState<Record<string,Record<string,string>>>({});
  const entry=entries.find(e=>e.parameterCode===code)!;
  const rules=entry.atomicRules;
  const selection=atomicSelection(rules,atomicContexts);
  const special=selection.ready.flatMap(r=>r.requiredContext);
  const invalidLimit=special.includes("TECHNICAL_CONDITIONS_LIMIT")&&!/^\d+(?:\.\d+)?$/u.test(limit);
  const invalidAtomic=selection.partiallyFilled||!selection.ready.length;
  const apply=()=>{
    if(!confirmed||!entity.trim()||reference.trim().length<8||invalidLimit||invalidAtomic)return;
    const prepared=prepareMatrixSourceScope({value,entityKey:entity,reference,parameterCode:code,rules,atomicContexts,
      complete,drawingSection,limit});
    if(prepared){onChange(prepared);setConfirmed(false);}
  };
  return <details className="matrix-source-scope"><summary>Объект и контекст машинного сравнения</summary>
    <p>Заполняйте после проверки оригинала. Одинаковый ключ обозначает одно здание, этаж или элемент в сравниваемых файлах.
      Область относится ко всему выбранному файлу. Для нескольких разных элементов оставьте её неподтверждённой.</p>
    {value&&<p role="status">Подготовлено: {value.entityKey} · {Object.keys(value.contexts).length} условий.
      Решение вступит в силу после сохранения и нового запуска.
      <button type="button" disabled={disabled} onClick={()=>onChange(undefined)}>Снять подтверждение области</button></p>}
    <label>Ключ здания, этажа или элемента<input value={entity} onChange={e=>{setEntity(e.target.value);setConfirmed(false);}}
      placeholder={value?.entityKey??"Например: корпус-1/этаж-2/дверь-Д12"} maxLength={200} disabled={disabled}/></label>
    <label>Параметр<select value={code} disabled={disabled} onChange={e=>{setCode(e.target.value);setConfirmed(false);setComplete(false);}}>
      {entries.map(e=><option key={e.parameterCode} value={e.parameterCode}>{e.parameterCode} · {e.name}</option>)}</select></label>
    <p>{entry.trigger}</p>
    <label>Раздел по штампу, если отличается от раздела файла<select value={drawingSection} disabled={disabled}
      onChange={e=>{setDrawingSection(e.target.value);setConfirmed(false);}}><option value="">Не подтверждаю отдельно</option>
      {[...new Set(rules.flatMap(r=>[...r.expectedSections,...r.actualSections]))].map(s=><option key={s}>{s}</option>)}</select></label>
    {special.includes("TECHNICAL_CONDITIONS_LIMIT")&&<label>Проверенный предел ТУ, в единицах {rules[0].canonicalUnit}
      <input value={limit} onChange={e=>{setLimit(e.target.value);setConfirmed(false);}} disabled={disabled}/></label>}
    {rules.filter(rule=>rule.subruleContext).map(rule=><fieldset key={rule.ruleId}>
      <legend>{rule.attribute} · {rule.canonicalUnit}</legend>
      <p>Для подтверждения этого правила заполните все поля по оригиналу; непроверенное правило оставьте полностью пустым.
        В сравниваемых источниках ключи должны совпадать. Для разных элементов используйте разные ключи.</p>
      {rule.subruleContext!.identityFields.map(field=><label key={field}>{contextLabels[field]??field}
        <input value={atomicContexts[rule.ruleId]?.[field]??""} maxLength={200} disabled={disabled}
          onChange={e=>{setAtomicContexts(previous=>({...previous,[rule.ruleId]:{...previous[rule.ruleId],[field]:e.target.value}}));setConfirmed(false);}}/>
      </label>)}</fieldset>)}
    <label>Основание связи и применимости условий<textarea value={reference} rows={3} maxLength={1000}
      onChange={e=>{setReference(e.target.value);setConfirmed(false);}} disabled={disabled}
      placeholder="Лист, позиция, оси, отметка, действующие ТУ или другой проверенный документ"/></label>
    <label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e=>setConfirmed(e.target.checked)}/>
      Проверены идентичность элемента, база измерения и условия заполненных правил выбранного параметра.
      {special.includes("NORM_APPLICABILITY_VERIFIED")&&" Проверена применимость указанного в правиле норматива."}
      {special.includes("APPROVED_CHANGE_STATUS")&&" Согласованное изменение отсутствует."}
      {special.includes("THERMAL_RESISTANCE_REDUCTION_VERIFIED")&&" Снижение сопротивления теплопередаче подтверждено."}</label>
    <label><input type="checkbox" checked={complete} disabled={disabled} onChange={e=>setComplete(e.target.checked)}/>
      Дополнительно проверена полнота области по заполненным правилам во всём файле; допустим отрицательный результат.
      Полнота параметра подтверждается только при заполнении всех его правил.</label>
    <button type="button" className="button button--secondary" onClick={apply}
      disabled={disabled||!confirmed||!entity.trim()||reference.trim().length<8||invalidLimit||invalidAtomic}>Добавить проверенный контекст к решению</button>
    {value&&<details><summary>Подготовленные основания</summary><p>{value.reference}</p>
      {Object.entries(value.contexts).map(([key,p])=><p key={key}>{key}: {p.reference}</p>)}</details>}
  </details>;
}
