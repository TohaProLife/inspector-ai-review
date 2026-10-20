import { useEffect, useRef, useState } from 'react';
import type { CheckRun, SourceFileSummary, ColumnPylonSectionV2Request as Request, ColumnPylonSectionV2SideRequest as Side,
  ColumnPylonSectionV2Journal as Journal, ColumnPylonSectionV2Result as Result, ColumnPylonSectionV2TokenSelection as Token,
  ColumnPylonSectionV2BasisRole as BasisRole, ColumnPylonSectionV2BasisSelection as Basis } from '@inspector-ai/contracts';
import { api } from './api';
import { listSourceAuditV3Large } from './SourceAuditV3LargeWorkspace';
import { InspectorEvidenceViewer } from './InspectorEvidenceViewer';
import { columnToken, columnSelectionDisjoint, columnLiteralSelection, columnPrior, columnSide,
  loadColumnPylonSource, withdrawColumnPylonReview, columnCanonical, type LoadedColumnSource } from './column-pylon-section-v2-ui';
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
const unknown=():Side['assertions']=>({physicalMember:'UNKNOWN',shape:'UNKNOWN',dimensionMeaning:'UNKNOWN',unit:'UNKNOWN'});
const identities=['entityKey','buildingKey','zoneKey','levelKey','memberKey','sectionKey'] as const;
const identityLabels=['Идентификатор элемента','Корпус','Зона / оси','Уровень','Марка физического элемента','Сечение / плоскость'];
const roles:BasisRole[]=['PHYSICAL_MEMBER','SECTION_SHAPE','GROSS_SECTION','UNIT','UNIT_SCOPE'];
const roleLabels=['Физический элемент и сечение','Прямоугольная форма','Габаритное бетонное сечение','Буквальная единица мм','Применимость единицы к обоим размерам'];
const initialIdentity=():Request['identity']=>({entityKey:'',buildingKey:'',zoneKey:'',levelKey:'',memberKey:'',sectionKey:'',componentRole:'BEARING_VERTICAL_MEMBER_SECTION'});

/** Shows only a scoped comparison; never a whole-parameter certificate. */
export function ColumnPylonSectionV2Result({value}:{value:Result}){
  if(value.schemaVersion!=='matrix-kr060-column-pylon-comparison-v2'||value.calibratedProbability!==null||(value.status==='CANDIDATE'&&value.expertReviewRequired!==true)||!['CANDIDATE','ABSTAIN','NO_DECREASE_IN_REVIEWED_PAIR'].includes(value.status))return <p role="alert">Ответ сравнения не подтверждён.</p>;
  return <section aria-label="Сравнение выбранного сечения"><h3>{value.status==='CANDIDATE'?'Кандидат: уменьшение выбранного сечения':value.status==='ABSTAIN'?'Сравнение невозможно':'Уменьшение в рассмотренной паре не выявлено'}</h3>
    <p>{value.status} · {value.reasonCode}</p><p>Уверенность не измерена. Только одна явно рассмотренная пара; покрытие параметра не меняется.</p>
    {value.identity&&<dl>{identities.map(k=><div key={k}><dt>{k}</dt><dd>{value.identity![k]}</dd></div>)}</dl>}
    {value.comparison&&<><p>ПД: {value.comparison.expectedAreaMm2} мм²; РД: {value.comparison.actualAreaMm2} мм²; разность РД − ПД: {value.comparison.deltaAreaMm2} мм².</p><p>Решение {value.comparison.pairDecisionId}; журнал {value.comparison.pairJournalContentHash}</p></>}
    {value.status==='CANDIDATE'&&<p><strong>HIGH — требуется экспертная проверка. Это не установленное нарушение и не заключение о прочности.</strong></p>}
  </section>;
}

function TokenPicker({loaded,label,kind,onPick,disabled=false}:{loaded:LoadedColumnSource;label:string;kind:'number'|'unit'|'basis';onPick:(t:Token)=>void;disabled?:boolean}){
  const [page,setPage]=useState(''),[record,setRecord]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false);
  const p=loaded.source.textArtifact.pages.find(p=>String(p.pageNumber)===page),line=p?.locatedLines[Number(record)];
  const eligible=!!p&&p.quality.disposition==='TEXT_LAYER_CANDIDATE'&&p.unlocatedLines.length===0;
  const evidence=p&&line?{id:`kr060:${loaded.file.id}:${p.pageNumber}:${line.sourcePath.join('.')}`,sourceFileId:loaded.file.id,sourceSha256:loaded.file.sha256,stage:loaded.preview.stage,pageNumber:p.pageNumber,sheet:null,revision:null,value:line.rawText,unit:null,element:`Исходная строка ${JSON.stringify(line.sourcePath)}; видимость не подтверждена`,bbox:[line.bboxMilliPoints[0]/p.widthMilliPoints,1-line.bboxMilliPoints[3]/p.heightMilliPoints,line.bboxMilliPoints[2]/p.widthMilliPoints,1-line.bboxMilliPoints[1]/p.heightMilliPoints] as [number,number,number,number]}:undefined;
  function choose(){try{if(!p||!line||record===''||!eligible)throw new Error('Нужна исходная расположенная строка страницы без неопределённых строк');onPick(columnToken(line.rawText,p.pageNumber,line.sourcePath,start,end,kind));setError('');}catch(e){setError(message(e));}}
  return <fieldset disabled={disabled} style={{minWidth:0}}><legend>{label}</legend>
    <label>Страница <select value={page} onChange={e=>{setPage(e.target.value);setRecord('');setStart('');setEnd('');setOpen(false);}}><option value="">Выберите страницу</option>{loaded.source.textArtifact.pages.map(p=><option key={p.pageNumber} value={p.pageNumber}>{p.pageNumber} · {p.quality.disposition} · нерасположенных {p.unlocatedLines.length}</option>)}</select></label>
    {p&&<><label>Полная исходная строка <select value={record} onChange={e=>{setRecord(e.target.value);setStart('');setEnd('');setOpen(false);}}><option value="">Выберите строку</option>{p.locatedLines.map((l,i)=><option key={i} value={i}>{JSON.stringify(l.sourcePath)} · {l.rawText.slice(0,130)}</option>)}</select></label>
    {!eligible&&<p>Выбор недоступен: {p.quality.disposition}; нерасположенных строк: {p.unlocatedLines.length}. Эти строки не становятся размерами.</p>}
    {p.unlocatedLines.length>0&&<details><summary>Нерасположенные исходные строки</summary>{p.unlocatedLines.map(l=><pre key={JSON.stringify(l.sourcePath)}>{JSON.stringify(l.sourcePath)} · {l.reasonCode}{'\n'}{l.rawText}</pre>)}</details>}</>}
    {record!==''&&line&&<><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{line.rawText}</pre><p>Путь {JSON.stringify(line.sourcePath)}; длина {Array.from(line.rawText).length} кодовых точек. Исходный LF сохранён. Координаты {JSON.stringify(line.bboxMilliPoints)}.</p>
      <label>Начало (включая) <input inputMode="numeric" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Конец (не включая) <input inputMode="numeric" value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <p>Выделено: «{Array.from(line.rawText).slice(Number(start),Number(end)).join('')}»</p>
      <button type="button" disabled={!eligible} onClick={choose}>Использовать диапазон</button>{' '}<button type="button" onClick={()=>setOpen(v=>!v)}>Исходная страница и рамка</button>{' '}
      <a href={`${api.sourceFileUrl(loaded.review.objectId,loaded.file.id)}#page=${page}`} target="_blank" rel="noreferrer">Оригинал PDF, страница {page}</a>
      {open&&evidence&&<InspectorEvidenceViewer objectId={loaded.review.objectId} file={loaded.file} evidence={evidence} stage={loaded.preview.stage} onOpened={()=>undefined}/>}</>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}

function SideEditor({label,objectId,identityKey,files,checks,disabled,onChange}:{label:string;objectId:string;identityKey:string;files:SourceFileSummary[];checks:CheckRun[];disabled:boolean;onChange:(s:Side|null)=>void}){
  const [fileId,setFileId]=useState(''),[checkId,setCheckId]=useState(''),[loaded,setLoaded]=useState<LoadedColumnSource|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState<'NATIVE_SECTION_SELECTION_V1'|'LITERAL_T77_V1'>('NATIVE_SECTION_SELECTION_V1'),[literal,setLiteral]=useState('');
  const [first,setFirst]=useState<Token|null>(null),[second,setSecond]=useState<Token|null>(null),[unit,setUnit]=useState<Token|null>(null),[assertions,setAssertions]=useState(unknown),[unitScope,setUnitScope]=useState<Side['unitScopeAssertion']>('UNKNOWN'),[reference,setReference]=useState(''),[basis,setBasis]=useState<Basis[]>([]),[basisRole,setBasisRole]=useState<BasisRole>('PHYSICAL_MEMBER');
  const controller=useRef<AbortController|null>(null),generation=useRef(0);
  function invalidate(){generation.current++;onChange(null);setAssertions(unknown());setUnitScope('UNKNOWN');}
  function reset(){controller.current?.abort();generation.current++;setLoaded(null);setBusy(false);setError('');setFirst(null);setSecond(null);setUnit(null);setLiteral('');setBasis([]);setReference('');invalidate();}
  useEffect(()=>{reset();return()=>controller.current?.abort();},[objectId,fileId,checkId,files.find(f=>f.id===fileId)?.sha256,files.find(f=>f.id===fileId)?.review?.contentHash,disabled]);
  useEffect(()=>{controller.current?.abort();setBusy(false);invalidate();},[identityKey]);
  async function load(){reset();const file=files.find(f=>f.id===fileId);if(!file||!checkId||disabled)return;const c=new AbortController();controller.current=c;const g=++generation.current;setBusy(true);try{const result=await loadColumnPylonSource(objectId,file,checkId,c.signal);if(g===generation.current&&!c.signal.aborted)setLoaded(result);}catch(e){if(g===generation.current&&!c.signal.aborted)setError(message(e));}finally{if(g===generation.current)setBusy(false);}}
  async function apply(){if(!loaded||disabled)return;const g=++generation.current;setError('');try{let selection:Side['selection'];
    if(mode==='LITERAL_T77_V1'){const ex=loaded.preview.extraction;if(ex.status!=='SOURCE_LITERALS'||literal===''||!ex.literals[Number(literal)])throw new Error('Выберите исходный буквальный размер');selection=await columnLiteralSelection(loaded,ex.literals[Number(literal)]);}
    else{if(!first||!second||!columnSelectionDisjoint([first,second,unit]))throw new Error('Выберите два непересекающихся размера и при необходимости единицу');selection={mode,first,second,unit};}
    if(!reference.trim())throw new Error('Укажите основание рассмотрения стороны');
    if(g===generation.current)onChange(columnSide(loaded,selection,assertions,unitScope,reference,basis));
  }catch(e){if(g===generation.current)setError(message(e));}}
  return <fieldset disabled={disabled||busy} style={{minWidth:0}}><legend>{label}</legend>
    <label>Исходный PDF <select value={fileId} onChange={e=>{reset();setFileId(e.target.value);}}><option value="">Выберите источник явно</option>{files.map(f=><option key={f.id} value={f.id}>{f.name} · {f.id} · {f.sha256}</option>)}</select></label>
    <label>Большой аудит текста <select value={checkId} onChange={e=>{reset();setCheckId(e.target.value);}}><option value="">Выберите завершённый запуск</option>{checks.map(c=><option key={c.id} value={c.id}>{c.id} · {c.completedAt}</option>)}</select></label>
    <button type="button" disabled={!fileId||!checkId} onClick={()=>void load()}>Прочитать полный источник</button>{busy&&<p role="status">Чтение и проверка полного текста…</p>}
    {loaded&&<><p>SHA {loaded.file.sha256}; этап {loaded.preview.stage}; решение источника {loaded.review.id} / {loaded.review.contentHash}.</p><p>Полный текст: {loaded.source.textArtifact.pageCount} страниц; хеш {loaded.preview.origin.textArtifactContentHash}. Видимость исходной строки не подтверждена.</p>
    <label>Способ выбора <select value={mode} onChange={e=>{setMode(e.target.value as typeof mode);invalidate();}}><option value="NATIVE_SECTION_SELECTION_V1">Диапазоны исходных строк</option><option value="LITERAL_T77_V1">Буквальная запись T77</option></select></label>
    {mode==='LITERAL_T77_V1'?<label>Исходная буквальная запись <select value={literal} onChange={e=>{setLiteral(e.target.value);invalidate();}}><option value="">Выберите запись</option>{loaded.preview.extraction.status==='SOURCE_LITERALS'&&loaded.preview.extraction.literals.map((l,i)=><option key={i} value={i}>Стр. {l.pageNumber} {JSON.stringify(l.sourcePath)} · {l.rawText}</option>)}</select>{loaded.preview.extraction.status==='ABSTAIN'&&<p>{loaded.preview.extraction.reasonCode}. Независимый выбор диапазонов доступен.</p>}</label>:<>
      <TokenPicker loaded={loaded} label="Первый размер" kind="number" onPick={t=>{setFirst(t);invalidate();}}/><p>{first?JSON.stringify(first.usedTextRangeCodePoints)+' «'+Array.from(first.rawText).slice(...first.usedTextRangeCodePoints).join('')+'»':'Первый размер не выбран'}</p>
      <TokenPicker loaded={loaded} label="Второй размер" kind="number" onPick={t=>{setSecond(t);invalidate();}}/><p>{second?JSON.stringify(second.usedTextRangeCodePoints)+' «'+Array.from(second.rawText).slice(...second.usedTextRangeCodePoints).join('')+'»':'Второй размер не выбран'}</p>
      <TokenPicker loaded={loaded} label="Буквальная единица мм (может отсутствовать в UNKNOWN)" kind="unit" onPick={t=>{setUnit(t);invalidate();}}/>{unit&&<><p>Единица выбрана: {Array.from(unit.rawText).slice(...unit.usedTextRangeCodePoints).join('')}</p><button type="button" onClick={()=>{setUnit(null);invalidate();}}>Убрать единицу</button></>}
    </>}
    <h4>Исходные основания стороны</h4><label>Роль основания <select value={basisRole} onChange={e=>setBasisRole(e.target.value as BasisRole)}>{roles.map((r,i)=><option key={r} value={r}>{roleLabels[i]} · {r}</option>)}</select></label>
    <TokenPicker loaded={loaded} label="Фрагмент основания из этого PDF" kind="basis" onPick={t=>{const b={role:basisRole,...t};if(basis.length>=16){setError('Не более 16 оснований стороны');return;}if(basis.some(x=>x.role===b.role&&x.pageNumber===b.pageNumber&&JSON.stringify(x.sourcePath)===JSON.stringify(b.sourcePath)&&JSON.stringify(x.usedTextRangeCodePoints)===JSON.stringify(b.usedTextRangeCodePoints))){setError('Такой фрагмент уже выбран');return;}setBasis([...basis,b]);invalidate();}}/>
    <ul>{basis.map((b,i)=><li key={i}>{b.role} · стр. {b.pageNumber} {JSON.stringify(b.sourcePath)} {JSON.stringify(b.usedTextRangeCodePoints)} «{Array.from(b.rawText).slice(...b.usedTextRangeCodePoints).join('')}» <button type="button" onClick={()=>{setBasis(basis.filter((_,n)=>n!==i));invalidate();}}>Удалить основание</button></li>)}</ul>
    {(['physicalMember','shape','dimensionMeaning','unit'] as const).map((k,i)=>{const values=['HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER_AND_SECTION','HUMAN_REVIEWED_RECTANGLE','HUMAN_REVIEWED_GROSS_EXTERNAL_SECTION','HUMAN_REVIEWED_EXPLICIT_MM'] as const;return <label key={k}>{roleLabels[i]} <select value={assertions[k]} onChange={e=>{generation.current++;onChange(null);setAssertions({...assertions,[k]:e.target.value});}}><option value="UNKNOWN">UNKNOWN — не подтверждено</option><option value={values[i]}>Явно подтверждено человеком по выбранным основаниям</option></select></label>;})}
    <label>Единица относится к обоим размерам <select value={unitScope} onChange={e=>{generation.current++;onChange(null);setUnitScope(e.target.value as typeof unitScope);}}><option value="UNKNOWN">UNKNOWN — не подтверждено</option><option value="HUMAN_REVIEWED_UNIT_APPLIES_TO_BOTH_SELECTED_DIMENSIONS">Явно рассмотрена применимость единицы к обоим размерам</option></select></label>
    <label>Ссылка / основание рассмотрения стороны <textarea value={reference} maxLength={1000} onChange={e=>{generation.current++;onChange(null);setReference(e.target.value);}}/></label>
    <button type="button" onClick={()=>void apply()}>Использовать сторону в черновике</button></>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}

export function ColumnPylonSectionV2Workspace({objectId,disabled=false}:{objectId:string;disabled?:boolean}){return <Workspace key={objectId} objectId={objectId} disabled={disabled}/>;}
function Workspace({objectId,disabled}:{objectId:string;disabled:boolean}){
  const [files,setFiles]=useState<SourceFileSummary[]>([]),[checks,setChecks]=useState<CheckRun[]>([]),[items,setItems]=useState<Journal[]>([]),[canReview,setCanReview]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [identity,setIdentity]=useState(initialIdentity),[expected,setExpected]=useState<Side|null>(null),[actual,setActual]=useState<Side|null>(null),[pairAssertion,setPairAssertion]=useState<Request['pairAssertion']>('UNKNOWN'),[reference,setReference]=useState(''),[result,setResult]=useState<Result|null>(null),[saved,setSaved]=useState<Journal|null>(null);
  const request=useRef<AbortController|null>(null),gen=useRef(0),retry=useRef<{body:string;key:string}|null>(null);
  useEffect(()=>{if(disabled){gen.current++;request.current?.abort();setBusy(false);setResult(null);setExpected(null);setActual(null);}return()=>{gen.current++;request.current?.abort();};},[objectId,disabled]);
  function changed(){setResult(null);setSaved(null);setPairAssertion('UNKNOWN');}
  async function load(){const g=++gen.current;request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setLoaded(false);setExpected(null);setActual(null);setResult(null);setSaved(null);setCanReview(false);setError('');setRevision(n=>n+1);try{const f=await api.listSourceFiles(objectId);c.signal.throwIfAborted();const cs=await listSourceAuditV3Large(objectId,c.signal);const js=await api.getColumnPylonSectionV2Reviews(objectId,c.signal);c.signal.throwIfAborted();if(g!==gen.current)return;
    if(!Array.isArray(js.items)||js.items.length>16||typeof js.canReview!=='boolean'||js.items.some(j=>j.objectId!==objectId))throw new Error('Некорректный журнал объекта');
    setFiles(f.items);setChecks(cs.filter(c=>c.progress===100&&!!c.completedAt&&['PARTIAL','REVIEW_REQUIRED','CLARIFICATION_REQUIRED','READY_TO_FINALIZE','FINALIZED'].includes(c.status)));setItems(js.items);setCanReview(js.canReview&&f.permissions.review);setLoaded(true);
  }catch(e){if(g===gen.current&&!c.signal.aborted)setError(message(e));}finally{if(g===gen.current)setBusy(false);}}
  async function write(input:Request){if(!canReview||disabled||busy)return;const body=JSON.stringify(input);if(!retry.current||retry.current.body!==body)retry.current={body,key:crypto.randomUUID()};const g=++gen.current,c=new AbortController();request.current?.abort();request.current=c;setBusy(true);setError('');setResult(null);try{const j=await api.recordColumnPylonSectionV2Review(objectId,input,c.signal,retry.current.key);c.signal.throwIfAborted();if(g!==gen.current)return;if(j.objectId!==objectId||j.previousReviewHash!==input.expectedReviewHash||j.projection.status!==input.status)throw new Error('Ответ журнала не соответствует запросу');setSaved(j);retry.current=null;setItems(rows=>[j,...rows.filter(x=>!(columnCanonical(x.projection.identity)===columnCanonical(j.projection.identity)&&x.projection.expected.sourceFileId===j.projection.expected.sourceFileId&&x.projection.actual.sourceFileId===j.projection.actual.sourceFileId))]);}catch(e){if(g===gen.current&&!c.signal.aborted)setError(message(e)+' При конфликте CAS обновите список; решение автоматически не переназначается.');}finally{if(g===gen.current)setBusy(false);}}
  async function save(status:'UNKNOWN'|'APPROVED'){try{if(!expected||!actual)throw new Error('Явно выберите обе стороны');if(expected.sourceFileId===actual.sourceFileId||expected.sourceSha256===actual.sourceSha256)throw new Error('Нужны разные оригиналы ПД и РД');if(identities.some(k=>!identity[k].trim())||!reference.trim())throw new Error('Заполните идентичность и основание пары');const prior=columnPrior(items,identity,expected.sourceFileId,actual.sourceFileId);await write({schemaVersion:'matrix-kr060-column-pylon-pair-review-input-v2',status,identity,expected,actual,pairAssertion,reference,expectedReviewHash:prior?.contentHash??null});}catch(e){setError(message(e));}}
  async function compare(j:Journal){const g=++gen.current;request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError('');setResult(null);try{const r=await api.previewColumnPylonSectionV2Comparison(objectId,{reviewDecisionId:j.id},c.signal);c.signal.throwIfAborted();if(g===gen.current){if(r.comparison&&r.comparison.pairDecisionId!==j.id)throw new Error('Ответ относится к другому решению');setResult(r);}}catch(e){if(g===gen.current&&!c.signal.aborted)setError(message(e));}finally{if(g===gen.current)setBusy(false);}}
  return <section className="surface" aria-label="Рассмотрение сечения колонны или пилона" style={{padding:20,marginBlock:20,minWidth:0,overflowWrap:'anywhere'}}><h2>Колонна / пилон: рассмотрение одного сечения ПД–РД</h2>
    <p>Ручная привязка исходных размеров к одному физическому элементу. Форма, габаритное бетонное сечение и единицы не выводятся автоматически. UNKNOWN не даёт права сравнения. Это отдельный журнал; машинное покрытие не повышается.</p>
    <button type="button" disabled={disabled||busy} onClick={()=>void load()}>Загрузить источники, запуски и последние решения</button>
    {busy&&<p role="status">Запрос выполняется…</p>}{error&&<p role="alert">{error}</p>}
    {loaded&&<><fieldset disabled={disabled||busy||!canReview}><legend>Явная идентичность пары</legend>{identities.map((k,i)=><label key={k}>{identityLabels[i]} <input value={identity[k]} maxLength={200} onChange={e=>{setIdentity({...identity,[k]:e.target.value});setExpected(null);setActual(null);changed();}}/></label>)}</fieldset>
      <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}><SideEditor key={`pd:${revision}`} label="Ожидаемое — ПД" objectId={objectId} identityKey={columnCanonical(identity)} files={files} checks={checks} disabled={disabled||!canReview} onChange={s=>{setExpected(s);changed();}}/>
      <SideEditor key={`rd:${revision}`} label="Фактическое — РД" objectId={objectId} identityKey={columnCanonical(identity)} files={files} checks={checks} disabled={disabled||!canReview} onChange={s=>{setActual(s);changed();}}/></fieldset>
      <p>Черновик сторон: ПД {expected?'явно выбрана':'не выбрана'}; РД {actual?'явно выбрана':'не выбрана'}.</p>
      <fieldset disabled={disabled||busy||!canReview}><legend>Применимость пары</legend><label>Один физический элемент и одно сечение ПД–РД <select value={pairAssertion} onChange={e=>{setPairAssertion(e.target.value as typeof pairAssertion);setResult(null);setSaved(null);}}><option value="UNKNOWN">UNKNOWN — не подтверждено</option><option value="HUMAN_REVIEWED_SAME_MEMBER_SECTION_PD_RD">Явно рассмотрена одна и та же пара элемента и сечения</option></select></label>
      <label>Основание / ссылка для пары <textarea value={reference} maxLength={1000} onChange={e=>{setReference(e.target.value);setResult(null);setSaved(null);}}/></label>
      <button type="button" disabled={!expected||!actual} onClick={()=>void save('UNKNOWN')}>Сохранить UNKNOWN</button>{' '}<button type="button" disabled={!expected||!actual} onClick={()=>void save('APPROVED')}>Явно утвердить рассмотренную пару</button></fieldset>
      {!canReview&&<p>Только чтение. Сервер не предоставил право рассмотрения.</p>}
      <h3>Последние решения по парам</h3>{items.length===0&&<p>Решений нет.</p>}{items.map(j=><article key={j.id}><h4>{j.projection.identity.entityKey} · {j.projection.status}</h4><p>{j.id} · {j.createdAt}; хеш {j.contentHash}</p><p>ПД {j.projection.expected.sourceFileId}; РД {j.projection.actual.sourceFileId}; {j.projection.reference}</p><details><summary>Точные сохранённые поля, основания и исходные указатели</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(j.projection,null,2)}</pre></details>
        <button type="button" disabled={disabled||busy} onClick={()=>void compare(j)}>Сравнить по этому решению</button>{' '}<button type="button" disabled={disabled||busy||!canReview||j.projection.status==='WITHDRAWN'} onClick={()=>void write(withdrawColumnPylonReview(j))}>Отозвать точно это решение</button></article>)}
      {saved&&<p role="status">Сохранён {saved.projection.status}: {saved.id}. Хеш журнала {saved.contentHash}.</p>}
      {result&&<ColumnPylonSectionV2Result value={result}/>}</>}
  </section>;
}
