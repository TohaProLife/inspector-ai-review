import type {InspectorEvidence,SourceFileSummary,SteelComparisonExecutionComparisons,SteelComparisonExecutionEvidence,SteelApplicabilityRunSnapshot} from '@inspector-ai/contracts';
import {steelJsonEqual as same} from './SteelReview';
type Result=SteelComparisonExecutionComparisons['results'][number];
const fragmentLabels={PRIMARY:'Декларация класса',DECLARATION_SCOPE:'Контекст декларации',PHYSICAL_MEMBER_SCOPE:'Сопоставление физического элемента',APPLICABILITY_BASIS:'Основание применимости пары'};
const reasons:Record<string,string>={REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING:'Нет сохранённой привязки декларации к элементу.',SOURCE_REVIEW_UNVERIFIED:'Редакция или согласование источника не подтверждены.',SOURCE_STAGE_UNVERIFIED:'Стадия исходника не подтверждена.',SOURCE_SECTION_UNVERIFIED:'Раздел КР не подтверждён.',SOURCE_LINK_UNVERIFIED:'Принадлежность одному комплекту не подтверждена.',PHYSICAL_MEMBER_MAPPING_UNVERIFIED:'Один физический элемент не сопоставлен.',APPLICABILITY_DECISION_MISSING:'Применимость пары ПД/РД не согласована.',APPLICABILITY_DECISION_UNVERIFIED:'Согласование применимости не подтверждено.',AMBIGUOUS_APPLICABILITY_DECISION:'Есть конкурирующие согласования применимости.',AMBIGUOUS_DECLARATION_SCOPE:'Есть конкурирующие декларации.',UNSUPPORTED_CATEGORY_TRANSITION:'Эта замена класса стали не поддержана правилом.',NEGATIVE_SCOPE_UNVERIFIED:'Одинаковая запись класса не доказывает отсутствие нарушения.'};
/** Display only after exact immutable reference and original frame checks. Server authenticates original bytes and journals. */
export function steelFragmentEvidence(row:Result,item:SteelComparisonExecutionEvidence):InspectorEvidence|null {
 if(!row||row.kind!=='SCOPED_COMPARISON'||row.comparison.status!=='CANDIDATE'||row.comparison.calibratedProbability!==null
   ||!item||item.resultId!==row.id||!['EXPECTED','ACTUAL'].includes(item.role)||!Object.hasOwn(fragmentLabels,item.fragmentRole))return null;
 const c=row.comparison.comparison,ref=item.role==='EXPECTED'?c.expected:c.actual;
 for(const key of ['sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash'] as const)if(item[key]!==ref[key])return null;
 if(!same(item.target,ref.target)||item.applicabilityDecisionId!==c.applicabilityDecisionId||item.applicabilityDecisionContentHash!==c.applicabilityDecisionContentHash)return null;
 const f=item.fragment,w=item.pageFrame?.widthMilliPoints,h=item.pageFrame?.heightMilliPoints,b=f?.bboxMilliPoints;
 if(!f||!Number.isSafeInteger(item.pageNumber)||item.pageNumber<1||item.pageNumber>512||f.pageNumber!==item.pageNumber
   ||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0||!Number.isSafeInteger(f.blockIndex)||f.blockIndex<0||!Number.isSafeInteger(f.lineIndex)||f.lineIndex<0
   ||typeof f.rawText!=='string'||!f.rawText||!Array.isArray(b)||b.length!==4||[0,1,2,3].some(i=>!Object.hasOwn(b,i)||!Number.isSafeInteger(b[i])||b[i]<0)||b[0]>=b[2]||b[1]>=b[3]||b[2]>w||b[3]>h)return null;
 return {id:`steel:${row.id.slice(0,24)}:${item.role}:${item.fragmentRole}:${f.blockIndex}:${f.lineIndex}`.slice(0,80),sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,stage:item.role==='EXPECTED'?'PD':'RD',pageNumber:item.pageNumber,sheet:null,revision:null,bbox:[b[0]/w,1-b[3]/h,b[2]/w,1-b[1]/h],value:f.rawText,unit:null,element:`${row.identity.entityKey} · ${row.identity.buildingKey} · ${row.identity.zoneKey} · ${row.identity.memberKey}`};
}
export function SteelComparisonsPanel({comparisons,evidence,snapshot,files,onSelect}:{comparisons?:SteelComparisonExecutionComparisons;evidence?:SteelComparisonExecutionEvidence[];snapshot?:SteelApplicabilityRunSnapshot;files:SourceFileSummary[];onSelect:(evidence:InspectorEvidence)=>void}) {
 if(!comparisons)return null;
 const candidates=comparisons.results.filter(row=>row.kind==='SCOPED_COMPARISON'&&row.comparison.status==='CANDIDATE'&&row.comparison.calibratedProbability===null);
 const abstentions=comparisons.results.filter(row=>!candidates.includes(row));
 return <section aria-label="Сопоставление деклараций стали" style={{overflowWrap:'anywhere'}}><h3>Класс стали · KR-056</h3>
 <p>Проверяется буквальная запись С345 в ПД и С245 в РД для одного сопоставленного человеком элемента распределительного пояса.</p>
 <p role="status">Кандидатов: {candidates.length} · Областей без вывода: {abstentions.length}</p>
 {candidates.map(row=>{if(row.kind!=='SCOPED_COMPARISON'||row.comparison.status!=='CANDIDATE')return null;const c=row.comparison.comparison;
  return <article key={row.id} style={{border:'1px solid var(--border-subtle)',padding:12,marginBottom:12}}><strong>KR-056 · Кандидат</strong><p>{row.identity.entityKey} · {row.identity.buildingKey} · {row.identity.zoneKey} · {row.identity.memberKey}</p>
  <p>ПД: {c.expectedValue}. РД: {c.actualValue}. Уверенность не измерена.</p>
  <p>Согласование пары подтверждает только выбранную область сравнения. Различия стандартов и профилей сохранены; эквивалентность, несущая способность и фактическая установка не установлены.</p>
  {(['EXPECTED','ACTUAL'] as const).map(role=>{const ref=role==='EXPECTED'?c.expected:c.actual,parts=(evidence??[]).filter(item=>item.resultId===row.id&&item.role===role);return <div key={role}><h4>{role==='EXPECTED'?'ПД':'РД'}: исходник и основания</h4>
   <p>{files.find(f=>f.id===ref.sourceFileId&&f.sha256===ref.sourceSha256)?.name??ref.sourceFileId}</p><p>{ref.productScope.productStandard}; {ref.productScope.gradeStandard}. Профиль: {ref.productScope.profile??'не указан'}.</p>
   <small>SHA {ref.sourceSha256} · Решение {ref.reviewDecisionId} · Декларация {ref.target.declarationId}</small>
   {!parts.length&&<p role="alert">Исходные фрагменты недоступны.</p>}{parts.map((item,i)=>{const original=steelFragmentEvidence(row,item);return <div key={`${item.fragmentRole}:${i}`}><p><strong>{fragmentLabels[item.fragmentRole]}</strong></p><pre style={{whiteSpace:'pre-wrap'}}>PDF {item.pageNumber} · {item.fragment.rawText}</pre>{original?<button type="button" onClick={()=>onSelect(original)}>Открыть оригинал · {role==='EXPECTED'?'ПД':'РД'} · PDF {item.pageNumber}</button>:<p role="alert">Фрагмент не совпадает с сохранёнными ссылками или границами листа; открытие недоступно.</p>}</div>;})}
  </div>;})}</article>;})}
 {!!abstentions.length&&<details><summary>Причины отсутствия вывода: {abstentions.length}</summary>{abstentions.map(row=><p key={row.id}>{row.kind==='SCOPED_COMPARISON'&&`${row.identity.entityKey} · `}{reasons[row.kind==='UNBOUND_ATOM_ABSTENTION'?row.reasonCode:row.comparison.reasonCode]??'Подтверждённых данных недостаточно; вывод не установлен.'}</p>)}</details>}
 {snapshot&&<details><summary>Снимок согласований этого запуска · {snapshot.entries.length}</summary><p>Запуск хранит выбранные на тот момент решения. Новые согласования и отзывы учитываются в следующей проверке.</p><small>SHA снимка {snapshot.contentHash}</small>{snapshot.entries.map(entry=><p key={entry.pairKey}>{entry.included?'Источники совпали со снимком':'Решение сохранено, источники не совпали со снимком'} · Решение {entry.decisionId} · Номер {entry.sequenceNo} · SHA журнала {entry.journalContentHash}</p>)}</details>}
 <p>Другие классы, элементы, прочность и остальные условия KR-056 этим правилом не покрываются.</p>
 </section>;
}
