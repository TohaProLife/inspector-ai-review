import type { InspectorEvidence, SourceFileSummary, MatrixCallInventoryComparisons,
  MatrixCallInventoryComparisonEvidence } from "@inspector-ai/contracts";

type Result=MatrixCallInventoryComparisons["results"][number];
const reasons:Record<string,string>={
  REVIEWED_CALL_INVENTORY_IDENTITY_MISSING:"В сохранённом комплекте нет проверенной идентичности санитарной комнаты для сопоставления.",
  ROOM_IDENTITY_CONFLICT:"Сохранённые сведения об идентичности комнаты противоречат друг другу.",
  SOURCE_STAGE_UNVERIFIED:"Стадия исходного листа не подтверждена.",
  AMBIGUOUS_INVENTORY_SCOPE:"Для одной комнаты сохранено несколько конкурирующих перечней; однозначная пара не установлена.",
  MATCHED_INVENTORY_PAIR_UNVERIFIED:"Для этой комнаты нет однозначной пары исходных перечней ПД и РД.",
  SOURCE_REVIEW_UNVERIFIED:"Актуальность и согласование источников требуют проверки.",
  SOURCE_SECTION_UNVERIFIED:"Раздел системы связи или мероприятий доступности не подтверждён для выбранной стадии.",
  LINK_SCOPE_UNVERIFIED:"Принадлежность источников одному комплекту не подтверждена.",
  ROOM_MAPPING_UNVERIFIED:"Сопоставление исходных обозначений с одной доступной санитарной комнатой не подтверждено человеком.",
  HUMAN_COMPLETENESS_UNVERIFIED:"Полнота перечней в выбранных областях не подтверждена человеком.",
  NONEMPTY_CLOSED_REGION_UNVERIFIED:"Непустой состав выбранной области нельзя полностью восстановить по поддерживаемым исходным строкам.",
  PD_REQUIREMENT_UNVERIFIED:"В выбранном перечне ПД нет поддерживаемой исходной строки кнопки вызова персонала.",
  NEGATIVE_SCOPE_UNVERIFIED:"Условие расхождения в выбранных перечнях не установлено. Это не заключение об отсутствии нарушений.",
};
/** Convert one original line from an authenticated frozen review reference. No
 * scalar observation is created and latest source reviews are never substituted. */
export function callInventoryFragmentEvidence(row:Result,item:MatrixCallInventoryComparisonEvidence):InspectorEvidence|null {
  if(!row||row.kind!=="SCOPED_COMPARISON"||row.comparison.status!=="CANDIDATE"||!item||item.resultId!==row.id
    ||!["EXPECTED","ACTUAL"].includes(item.role)||!["HEADER","SCOPE","END","FEATURE"].includes(item.fragmentRole))return null;
  const reference=item.role==="EXPECTED"?row.comparison.expected:row.comparison.actual;
  for(const key of ["sourceFileId","sourceSha256","reviewDecisionId","reviewContentHash","inventoryContentHash"] as const)
    if(item[key]!==reference[key])return null;
  if(!item.pageFrame||!item.fragment||typeof item.originCheckId!=="string"||!item.originCheckId
    ||typeof item.fragment.rawText!=="string"||!item.fragment.rawText
    ||!Number.isSafeInteger(item.fragment.blockIndex)||item.fragment.blockIndex<0
    ||!Number.isSafeInteger(item.fragment.lineIndex)||item.fragment.lineIndex<0)return null;
  const {widthMilliPoints:w,heightMilliPoints:h}=item.pageFrame,box=item.fragment.bboxMilliPoints;
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0
    ||!Number.isSafeInteger(item.pageNumber)||item.pageNumber<1||item.pageNumber>512
    ||item.fragment.pageNumber!==item.pageNumber||!Array.isArray(box)||box.length!==4||!Array.from(box).every(Number.isSafeInteger)
    ||box[0]<0||box[1]<0||box[0]>=box[2]||box[1]>=box[3]||box[2]>w||box[3]>h)return null;
  return {id:`call:${row.id.slice(0,24)}:${item.role}:${item.fragmentRole}:${item.fragment.blockIndex}:${item.fragment.lineIndex}`.slice(0,80),
    sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,stage:item.role==="EXPECTED"?"PD":"RD",pageNumber:item.pageNumber,
    sheet:null,revision:null,bbox:[box[0]/w,1-box[3]/h,box[2]/w,1-box[1]/h],value:item.fragment.rawText,unit:null,
    element:`${row.identity.entityKey} · ${row.identity.buildingKey} · ${row.identity.floorKey} · ${row.identity.roomKey}`};
}
export function CallInventoryComparisonsPanel({comparisons,evidence,files,onSelect}:{
  comparisons?:MatrixCallInventoryComparisons;evidence?:MatrixCallInventoryComparisonEvidence[];
  files:SourceFileSummary[];onSelect:(evidence:InspectorEvidence)=>void;
}) {
  if(!comparisons)return null;
  const candidates=comparisons.results.filter(row=>row.kind==="SCOPED_COMPARISON"&&row.comparison.status==="CANDIDATE");
  const abstentions=comparisons.results.filter(row=>!(row.kind==="SCOPED_COMPARISON"&&row.comparison.status==="CANDIDATE"));
  return <section aria-label="Сопоставление перечней вызова в санитарной комнате" style={{overflowWrap:"anywhere"}}>
    <h3>Оборудование вызова персонала · ODI-123</h3>
    <p>Сравниваются исходные перечни ПД и РД только для названной доступной санитарной комнаты и проверенных областей документов.
      Идентичность комнаты и полноту этих областей подтверждает человек.</p>
    <p role="status">Кандидатов: {candidates.length} · Областей без вывода: {abstentions.length}</p>
    {candidates.map(row=>{
      if(row.kind!=="SCOPED_COMPARISON"||row.comparison.status!=="CANDIDATE")return null;
      const comparison=row.comparison;
      return <article key={row.id} style={{border:"1px solid var(--border-subtle)",padding:12,marginBottom:12}}>
        <strong>ODI-123 · Кандидат</strong>
        <dl><dt>Общий идентификатор комнаты</dt><dd>{row.identity.entityKey}</dd>
          <dt>Здание</dt><dd>{row.identity.buildingKey}</dd><dt>Этаж</dt><dd>{row.identity.floorKey}</dd><dt>Комната</dt><dd>{row.identity.roomKey}</dd>
          <dt>Назначение комнаты</dt><dd>Доступная санитарная комната</dd><dt>Система</dt><dd>Вызов персонала</dd></dl>
        <p>В выбранном перечне РД не указана кнопка вызова персонала, перечисленная в ПД для сопоставленной доступной санитарной комнаты.</p>
        <p>Уверенность не измерена. Физическое отсутствие, работоспособность и эквивалентность оборудования этот вывод не устанавливает.
          Остальные помещения и условия параметра ODI-123 остаются непроверенными. Требуется решение инспектора.</p>
        {(["EXPECTED","ACTUAL"] as const).map(role=>{
          const reference=role==="EXPECTED"?comparison.expected:comparison.actual;
          const fragments=(evidence??[]).filter(item=>item.resultId===row.id&&item.role===role)
            .map(item=>({item,original:callInventoryFragmentEvidence(row,item)})).filter(part=>part.original!==null);
          return <div key={role}><h4>{role==="EXPECTED"?"ПД: исходный перечень":"РД: сопоставляемый перечень"}</h4>
            <p>{files.find(file=>file.id===reference.sourceFileId&&file.sha256===reference.sourceSha256)?.name??reference.sourceFileId}</p>
            <p><small>SHA {reference.sourceSha256.slice(0,16)} · Решение {reference.reviewDecisionId} · Перечень {reference.inventoryContentHash.slice(0,16)}</small></p>
            {!fragments.length&&<p role="alert">Оригинальные фрагменты для сохранённой ссылки недоступны.</p>}
            {fragments.map(({item,original},i)=><div key={`${item.fragmentRole}:${item.fragment.blockIndex}:${item.fragment.lineIndex}:${i}`}>
              <p>{item.fragmentRole==="HEADER"?"Заголовок":item.fragmentRole==="SCOPE"?"Исходная комната":item.fragmentRole==="END"?"Конец перечня":"Строка оборудования"} · PDF {item.pageNumber}: {item.fragment.rawText}</p>
              <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}}
                onClick={()=>onSelect(original!)}>Открыть оригинал · {role==="EXPECTED"?"ПД":"РД"} · PDF {item.pageNumber}</button>
            </div>)}
          </div>;
        })}
      </article>;
    })}
    {abstentions.length>0&&<details><summary>Почему сравнение ограничено: {abstentions.length}</summary>
      {abstentions.map(row=><div key={row.id}>
        {row.kind==="SCOPED_COMPARISON"&&<p>{row.identity.entityKey} · {row.identity.buildingKey} · {row.identity.floorKey} · {row.identity.roomKey}</p>}
        <p>{reasons[row.kind==="UNBOUND_ATOM_ABSTENTION"?row.reasonCode:row.comparison.reasonCode]
          ??"Для этой комнаты недостаточно подтверждённых исходных данных; вывод не установлен."}</p>
      </div>)}
    </details>}
    <p>Этот атом проверяет только перечисление кнопки вызова в указанных исходных областях. Результат не подтверждает отсутствие нарушений по всему параметру ODI-123.</p>
  </section>;
}
