import { useState } from "react";
import type { InspectorEvidence, MatrixFireResistanceSourceDeclaration, SourceFileSummary } from "@inspector-ai/contracts";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";

export type FireFragmentKind="primary"|"scope"|"header"|"unit";
const fields={primary:"primaryFragments",scope:"scopeFragments",header:"headerFragments",unit:"unitFragments"} as const;
const labels={primary:"Значение из таблицы",scope:"Категория конструкции",header:"Заголовок таблицы",unit:"Единица из таблицы"};
export function fireDeclarationMatchesQuery(fact:MatrixFireResistanceSourceDeclaration,query:string,files:SourceFileSummary[],section:string|null=null):boolean {
  return [fact.criterion,fact.minutes,fact.rawValue,fact.rawUnit,fact.stage,fact.pageNumber,fact.sourceFileId,section??"",
    files.find(file=>file.id===fact.sourceFileId)?.name??"",...fact.constructionLabelLines,
    ...Object.values(fields).flatMap(field=>fact[field].map(part=>part.rawText))].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function fireDeclarationEvidence(fact:MatrixFireResistanceSourceDeclaration,kind:FireFragmentKind,index:number):InspectorEvidence {
  const fragment=fact[fields[kind]][index];if(!fragment)throw new RangeError("Source fire-resistance fragment is absent");
  const b=fragment.bboxMilliPoints;
  return {id:`${fact.id.slice(0,48)}:fire:${kind}:${index}`,sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,
    stage:fact.stage,pageNumber:fragment.pageNumber,sheet:null,revision:null,
    bbox:[b[0]/fact.widthMilliPoints,1-b[3]/fact.heightMilliPoints,b[2]/fact.widthMilliPoints,1-b[1]/fact.heightMilliPoints],
    value:fragment.rawText,unit:"",element:"Категория из таблицы; конкретный элемент не сопоставлен"};
}
export function fireDeclarationViewerKey(objectId:string,fact:MatrixFireResistanceSourceDeclaration,kind:FireFragmentKind,index:number):string {
  return JSON.stringify([objectId,fact.id,fact.sourceFileId,fact.sourceSha256,fact.pageNumber,kind,index]);
}
export function MatrixFireResistanceDeclarations({declarations,objectId,files,query,sections={}}:{
  declarations:MatrixFireResistanceSourceDeclaration[];objectId:string;files:SourceFileSummary[];query:string;sections?:Record<string,string|null>;
}) {
  const [selection,setSelection]=useState<{id:string;kind:FireFragmentKind;index:number}|null>(null);
  const visible=declarations.filter(fact=>fireDeclarationMatchesQuery(fact,query,files,sections[fact.sourceFileId]));
  const selected=selection?visible.find(fact=>fact.id===selection.id):undefined;
  const evidence=selected&&selection?fireDeclarationEvidence(selected,selection.kind,selection.index):undefined;
  return <section aria-label="Огнестойкость из исходной таблицы" style={{marginTop:"var(--space-lg)",overflowWrap:"anywhere"}}>
    <h3>Огнестойкость из исходной таблицы</h3>
    <p>Записи R и REI сохранены раздельно вместе с категориями конструкций и единицами. Фактическое достижение огнестойкости и применимость к конкретному элементу не проверены.</p>
    <p>Эти сведения доступны для сверки с оригиналом и не добавляют выполненных сравнений.</p>
    <p role="status">Строк огнестойкости: {visible.length} / {declarations.length}</p>
    <div style={{maxHeight:560,overflow:"auto"}}>{visible.map(fact=><article key={fact.id} style={{borderBottom:"1px solid var(--border-subtle)",padding:"12px 0"}}>
      <strong>Запись огнестойкости: {fact.rawValue} {fact.rawUnit}</strong>
      <p style={{whiteSpace:"pre-wrap"}}>{fact.constructionLabelLines.join("\n")}</p>
      <p>{fact.stage==="PD"?"ПД":"РД"} · Раздел: {sections[fact.sourceFileId]??"не установлен"} · PDF {fact.pageNumber}</p>
      <p>{files.find(file=>file.id===fact.sourceFileId)?.name??fact.sourceFileId} · SHA {fact.sourceSha256.slice(0,16)}</p>
      {(["primary","scope","header","unit"] as const).map(kind=><div key={kind}>
        <p><strong>{labels[kind]}</strong></p>
        {fact[fields[kind]].map((part,index)=><div key={`${part.blockIndex}:${part.lineIndex}`}>
          <p style={{whiteSpace:"pre-wrap"}}>{part.rawText}</p>
          <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}}
            onClick={()=>setSelection({id:fact.id,kind,index})}>{labels[kind]}: открыть оригинал · PDF {part.pageNumber} · фрагмент {index+1}</button>
        </div>)}
      </div>)}
      <small>Конкретный элемент не сопоставлен · ID {fact.id.slice(0,16)}</small>
    </article>)}</div>
    {!visible.length&&<p>Подходящих табличных записей в сохранённом результате нет. Полнота поиска огнестойкости по документам не подтверждена.</p>}
    {selected&&selection&&<>
      <p role="status">Выбран исходный фрагмент огнестойкости · {labels[selection.kind]} · PDF {evidence!.pageNumber} · фрагмент {selection.index+1}. Выделена полная исходная строка.</p>
      <div className="inspector-review-viewers"><InspectorEvidenceViewer key={fireDeclarationViewerKey(objectId,selected,selection.kind,selection.index)}
        objectId={objectId} stage={selected.stage} evidence={evidence} file={files.find(file=>file.id===selected.sourceFileId)} onOpened={()=>{}} /></div>
    </>}
  </section>;
}
