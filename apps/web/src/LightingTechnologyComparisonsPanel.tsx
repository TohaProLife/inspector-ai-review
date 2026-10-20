import {matrixLightingTechnologyDeclarationSchema,type InspectorEvidence,type SourceFileSummary,
 type LightingTechnologyExecutionComparisons,type LightingTechnologyExecutionEvidence} from "@inspector-ai/contracts";
type Result=LightingTechnologyExecutionComparisons["results"][number];
const reasons:Record<string,string>={
 REVIEWED_LIGHTING_POSITION_IDENTITY_MISSING:"Нет сохранённой проверенной идентичности позиции светильника и источника света.",
 SOURCE_PROVENANCE_UNVERIFIED:"Происхождение исходного текста не подтверждено.",
 DECLARATION_RECONSTRUCTION_UNVERIFIED:"Буквальную декларацию технологии не удалось восстановить по оригиналу.",
 SOURCE_STAGE_UNVERIFIED:"Стадия ПД или РД исходного листа не подтверждена.",
 POSITION_IDENTITY_CONFLICT:"Сохранённые сведения об идентичности позиции противоречат друг другу.",
 AMBIGUOUS_DECLARATION_SCOPE:"Для позиции есть конкурирующие декларации; однозначная пара не установлена.",
 MATCHED_DECLARATION_PAIR_UNVERIFIED:"Для позиции нет однозначной пары исходных деклараций ПД и РД.",
 SOURCE_REVIEW_UNVERIFIED:"Актуальность и согласование источников требуют проверки.",
 SOURCE_SECTION_UNVERIFIED:"Раздел документа не подтверждён для выбранной стадии.",
 LINK_SCOPE_UNVERIFIED:"Принадлежность ПД и РД одному комплекту не подтверждена.",
 NAMED_POSITION_UNVERIFIED:"В исходной декларации не подтверждено обозначение отдельной позиции.",
 POSITION_MAPPING_UNVERIFIED:"Человек не подтвердил сопоставление одной позиции светильника и источника света.",
 DIRECTED_TRANSITION_UNSUPPORTED:"Поддерживаемая замена LED в ПД на люминесцентный источник или лампу накаливания в РД не установлена.",
};
const technology=(value:string)=>value==="LED"?"LED":value==="FLUORESCENT"?"Люминесцентный источник":value==="INCANDESCENT"?"Лампа накаливания":"Не установлена";
/** Frozen original evidence only. Native frames remain explicit; no v2 row or scalar observation is fabricated. */
export function lightingFragmentEvidence(row:Result,item:LightingTechnologyExecutionEvidence):InspectorEvidence|null {
 if(!row||row.kind!=="SCOPED_COMPARISON"||row.comparison.status!=="CANDIDATE"||row.comparison.calibratedProbability!==null
   ||!item||item.resultId!==row.id||!["EXPECTED","ACTUAL"].includes(item.role)||item.fragmentRole!=="PRIMARY")return null;
 const reference=item.role==="EXPECTED"?row.comparison.expected:row.comparison.actual;
 for(const key of ["sourceFileId","sourceSha256","reviewDecisionId","reviewContentHash","declarationContentHash"] as const)if(item[key]!==reference[key])return null;
 if(!item.pageFrame||typeof item.originCheckId!=="string"||!item.originCheckId||!Number.isSafeInteger(item.pageNumber)||item.pageNumber<1||item.pageNumber>512)return null;
 const frame=matrixLightingTechnologyDeclarationSchema.shape.nativeFrame.safeParse(item.nativeFrame);
 const fragment=matrixLightingTechnologyDeclarationSchema.shape.primaryFragments.safeParse([item.fragment]);
 if(!frame.success||!fragment.success)return null;
 const native=frame.data.visibleBoxPointStrings.map(Number),f=fragment.data[0],w=item.pageFrame.widthMilliPoints,h=item.pageFrame.heightMilliPoints,b=f.bboxMilliPoints;
 if(!native.every(Number.isFinite)||native[0]>=native[2]||native[1]>=native[3]
   ||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0||f.pageNumber!==item.pageNumber
   ||f.usedTextRange.end>[...f.rawText].length||f.usedTextRange.start>=f.usedTextRange.end
   ||b[0]>=b[2]||b[1]>=b[3]||b[2]>w||b[3]>h)return null;
 return {id:`lighting:${row.id.slice(0,24)}:${item.role}:${f.sourcePath.join(".")}`.slice(0,80),sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,
   stage:item.role==="EXPECTED"?"PD":"RD",pageNumber:item.pageNumber,sheet:null,revision:null,bbox:[b[0]/w,1-b[3]/h,b[2]/w,1-b[1]/h],
   value:f.rawText,unit:null,element:`${row.identity.entityKey} · ${row.identity.buildingKey} · ${row.identity.systemKey} · ${row.identity.positionKey}`};
}
export function LightingTechnologyComparisonsPanel({comparisons,evidence,files,onSelect}:{comparisons?:LightingTechnologyExecutionComparisons;
 evidence?:LightingTechnologyExecutionEvidence[];files:SourceFileSummary[];onSelect:(evidence:InspectorEvidence)=>void}) {
 if(!comparisons)return null;
 const candidates=comparisons.results.filter(row=>row.kind==="SCOPED_COMPARISON"&&row.comparison.status==="CANDIDATE"&&row.comparison.calibratedProbability===null);
 const abstentions=comparisons.results.filter(row=>!candidates.includes(row));
 return <section aria-label="Сопоставление технологии источника света" style={{overflowWrap:"anywhere"}}>
   <h3>Технология источника света · ZU-130</h3>
   <p>Проверяется одна сопоставленная человеком позиция: указание LED в ПД и люминесцентного источника или лампы накаливания в РД.</p>
   <p role="status">Кандидатов: {candidates.length} · Областей без вывода: {abstentions.length}</p>
   {candidates.map(row=>{
    if(row.kind!=="SCOPED_COMPARISON"||row.comparison.status!=="CANDIDATE")return null;
    const comparison=row.comparison;
    return <article key={row.id} style={{border:"1px solid var(--border-subtle)",padding:12,marginBottom:12}}>
      <strong>ZU-130 · Кандидат</strong>
      <p>{row.identity.entityKey} · Здание {row.identity.buildingKey} · Система {row.identity.systemKey} · Позиция {row.identity.positionKey}</p>
      <p>ПД: {technology(comparison.expectedTechnology)}. РД: {technology(comparison.actualTechnology)}.</p>
      <p>Уверенность не измерена. Исходные декларации требуют решения инспектора; фактическая установка, мощность, энергоэффективность, количество и нормативное соответствие не проверены.</p>
      {(["EXPECTED","ACTUAL"] as const).map(role=>{
       const reference=role==="EXPECTED"?comparison.expected:comparison.actual;
       const supplied=(evidence??[]).filter(item=>item.resultId===row.id&&item.role===role);
       const parts=supplied.map(item=>({item,original:lightingFragmentEvidence(row,item)})).filter(p=>p.original!==null);
       return <div key={role}><h4>{role==="EXPECTED"?"ПД: исходная декларация":"РД: сопоставляемая декларация"}</h4>
        <p>{files.find(f=>f.id===reference.sourceFileId&&f.sha256===reference.sourceSha256)?.name??reference.sourceFileId}</p>
        <p><small>SHA {reference.sourceSha256} · Решение {reference.reviewDecisionId} · Декларация {reference.declarationContentHash}</small></p>
        {parts.length!==supplied.length&&<p role="alert">Часть фрагментов не совпадает с сохранённой ссылкой или native frame; открытие недоступно.</p>}
        {parts.length===0&&<p role="alert">Оригинальные фрагменты для сохранённой декларации недоступны.</p>}
        {parts.map(({item,original},i)=><div key={`${item.fragment.sourcePath.join(".")}:${i}`}>
         <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>PDF {item.pageNumber} · Путь {item.fragment.sourcePath.join(" / ")}: {item.fragment.rawText}</pre>
         <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}} onClick={()=>onSelect(original!)}>Открыть оригинал · {role==="EXPECTED"?"ПД":"РД"} · PDF {item.pageNumber}</button>
        </div>)}
       </div>;
      })}
    </article>;
   })}
   {abstentions.length>0&&<details><summary>Почему сравнение ограничено: {abstentions.length}</summary>{abstentions.map(row=><div key={row.id}>
     {row.kind==="SCOPED_COMPARISON"&&<p>{row.identity.entityKey} · {row.identity.positionKey}</p>}
     <p>{reasons[row.kind==="UNBOUND_ATOM_ABSTENTION"?row.reasonCode:row.comparison.reasonCode]??"Недостаточно подтверждённых исходных данных; вывод не установлен."}</p>
   </div>)}</details>}
   <p>Групповые декларации без названной позиции, другие технологии и остальные условия ZU-130 этим сравнением не покрываются.</p>
 </section>;
}
