import type {ColumnPylonSectionExecutionComparisons,ColumnPylonSectionExecutionEvidence,ColumnPylonSectionRunSnapshot,InspectorEvidence,SourceFileSummary} from '@inspector-ai/contracts';
import {columnPylonSectionSavedResultMatches,columnPylonSectionResultEvidence,columnPylonSectionFragmentLabels,type SavedColumnPylonSectionContext} from './column-pylon-section-result-evidence';
const reasonLabels:Record<string,string>={PAIR_REVIEW_UNAPPROVED:'Рассмотрение пары не согласовано.',SOURCE_REVIEW_UNVERIFIED:'Редакция или согласование источника не подтверждены.',SOURCE_SECTION_UNVERIFIED:'Раздел КР не подтверждён.',SOURCE_STAGE_UNVERIFIED:'Стадия исходника не подтверждена.',SOURCE_LINK_UNVERIFIED:'Общий комплект не подтверждён.',PHYSICAL_MEMBER_UNVERIFIED:'Физический элемент и плоскость сечения не подтверждены.',SECTION_SHAPE_UNVERIFIED:'Прямоугольная форма не подтверждена.',DIMENSION_MEANING_UNVERIFIED:'Габаритное бетонное сечение не подтверждено.',UNIT_UNVERIFIED:'Буквальная единица мм не подтверждена.',PAIR_APPLICABILITY_UNVERIFIED:'Применимость выбранной пары не подтверждена.'};
type Props=SavedColumnPylonSectionContext&{comparisons?:ColumnPylonSectionExecutionComparisons;snapshot?:ColumnPylonSectionRunSnapshot;evidence?:ColumnPylonSectionExecutionEvidence[];files:SourceFileSummary[];onSelect:(evidence:InspectorEvidence)=>void};
/** Pure saved-run presenter. No latest journal reads, requests, arithmetic or review mutations. */
export function ColumnPylonSectionComparisonsPanel({objectId,inputManifestHash,comparisons,snapshot,evidence,files,onSelect}:Props){
  if(!comparisons)return null;
  const context={objectId,inputManifestHash};
  if(!snapshot||!columnPylonSectionSavedResultMatches(context,comparisons,snapshot))return <section aria-label="Сечение колонны / пилона"><p role="alert">Сохранённый результат не подтверждён: ссылки запуска и снимка не совпадают.</p></section>;
  return <section aria-label="Сечение колонны / пилона" style={{overflowWrap:'anywhere'}}><h3>Колонна / пилон · KR-060</h3>
    <p>Только одна явно рассмотренная пара прямоугольного габаритного бетонного сечения ПД–РД. Уверенность не измерена.</p>
    {comparisons.results.map(row=>{
      if(row.kind==='UNBOUND_ATOM_ABSTENTION')return <article key={row.id}><h4>Нет включённой рассмотренной пары для этого запуска</h4><p>{row.reasonCode}</p></article>;
      const c=row.comparison;
      return <article key={row.id} style={{border:'1px solid var(--border-subtle)',padding:12,marginBottom:12}}>
        <h4>{c.status==='CANDIDATE'?'Кандидат: уменьшение одного рассмотренного сечения':c.status==='NO_DECREASE_IN_REVIEWED_PAIR'?'Уменьшение в рассмотренной паре не выявлено':'Сравнение невозможно'}</h4>
        <p>{c.status} · {c.reasonCode}</p>
        <dl>{Object.entries(row.identity).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        <small>Пара {row.pairKey} · Решение {row.pairDecisionId} · SHA журнала {row.pairJournalContentHash} · SHA проекции {row.pairProjectionContentHash}</small>
        {c.status==='CANDIDATE'&&<p><strong>HIGH — экспертная проверка обязательна.</strong> Это кандидат в пределах рассмотренной пары.</p>}
        {c.status==='NO_DECREASE_IN_REVIEWED_PAIR'&&<p>Не подтверждает отсутствие других нарушений KR-060.</p>}
        {c.status==='ABSTAIN'?<p>{reasonLabels[c.reasonCode]}</p>:<>
          <p>ПД: {c.comparison.expectedAreaMm2} мм²; РД: {c.comparison.actualAreaMm2} мм²; разность РД − ПД: {c.comparison.deltaAreaMm2} мм².</p>
          {(['EXPECTED','ACTUAL'] as const).map(role=>{
            const ref=role==='EXPECTED'?c.comparison.expected:c.comparison.actual,items=(evidence??[]).filter(item=>item.resultId===row.id&&item.role===role);
            return <div key={role}><h5>{role==='EXPECTED'?'ПД':'РД'} · исходные размеры и основания</h5>
              <p>{files.find(file=>file.id===ref.sourceFileId&&file.sha256===ref.sourceSha256)?.name??ref.sourceFileId}</p><small>SHA {ref.sourceSha256} · Решение исходника {ref.sourceReviewDecisionId} · SHA решения {ref.sourceReviewContentHash}</small>
              {!items.length&&<p role="alert">Оригинальный фрагмент недоступен.</p>}
              {items.map((item,index)=>{const target=columnPylonSectionResultEvidence(context,comparisons,snapshot,row,item);
                if(!target)return <p role="alert" key={index}>Оригинальный фрагмент недоступен: ссылка или границы не совпадают.</p>;
                return <div key={`${item.fragmentRole}:${index}`}><p><strong>{columnPylonSectionFragmentLabels[item.fragmentRole]}</strong> · PDF {item.fragment.pageNumber} · путь {JSON.stringify(item.fragment.sourcePath)} · диапазон CP {item.fragment.usedTextRangeCodePoints.join('..')}</p>
                  <pre style={{whiteSpace:'pre-wrap'}}>{item.fragment.rawText}</pre><button type="button" onClick={()=>onSelect(target)}>Открыть оригинал · {role==='EXPECTED'?'ПД':'РД'} · PDF {item.fragment.pageNumber}</button></div>;
              })}</div>;
          })}</>}
      </article>;
    })}
    <details><summary>Снимок рассмотрений этого запуска · {snapshot.entries.length}</summary><small>SHA снимка {snapshot.contentHash}</small><p>Показаны решения на момент запуска. Новые согласования и отзывы учитываются в следующей проверке.</p>
      {snapshot.entries.map(e=><p key={e.pairKey}>Пара {e.pairKey} · Решение {e.decisionId} · Номер {e.sequenceNo} · {e.included?'Включено':`Исключено: ${e.exclusionReason}`} · SHA журнала {e.journalContentHash} · SHA проекции {e.projectionContentHash}</p>)}
    </details>
    <p>Другие формы, значения размеров, все элементы, физическая геометрия, видимость и нормативное соответствие не установлены. Показ исходной строки и её рамки не подтверждает геодезические измерения или видимость каждого символа.</p>
  </section>;
}
