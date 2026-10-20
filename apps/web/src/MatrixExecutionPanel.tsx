import { LocalRegistrationWorkspace } from "./LocalRegistrationWorkspace";
import { DocumentCoordinateWorkspace } from "./DocumentCoordinateWorkspace";
import { useEffect, useMemo, useState } from "react";
import type { InspectorEvidence, MatrixContextFragment, MatrixExecutionRead, MatrixObservation, MatrixOcrCandidate, SourceFileSummary } from "@inspector-ai/contracts";
import { MACHINE_CONFIDENCE_POLICY_V1, parseMachineConfidence, matrixFactScopeTargetSchema } from "@inspector-ai/contracts";
import { MACHINE_CONFIDENCE_POLICY_V2 } from "../../../packages/contracts/src/machine-confidence-v2.js";
import { api } from "./api";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { MatrixFactScopeReview } from "./MatrixFactScopeReview";
import { MatrixProjectConstraints } from "./MatrixProjectConstraints";
import { MatrixSourceDeclarations } from "./MatrixSourceDeclarations";
import { InventoryComparisonsPanel } from "./InventoryComparisonsPanel";
import { WaterNodeComparisonsPanel } from "./WaterNodeComparisonsPanel";
import { LightingTechnologyComparisonsPanel } from "./LightingTechnologyComparisonsPanel";
import { ColumnPylonSectionComparisonsPanel } from "./ColumnPylonSectionComparisonsPanel";
import { SteelComparisonsPanel } from "./SteelComparisonsPanel";
import { RailInventoryComparisonsPanel } from "./RailInventoryComparisonsPanel";
import { CallInventoryComparisonsPanel } from "./CallInventoryComparisonsPanel";
import { MatrixReviewWorklistController as MatrixReviewWorklist } from "./MatrixReviewWorklist";
import { matrixReviewFactSource } from "./matrix-review-worklist";
import matrixRegistry from "../../../services/worker/rules/matrix-execution-v1.json";
const matrixRules=(matrixRegistry.entries as Array<{atomicRules:Array<{ruleId:string;family:string;canonicalUnit:string}>}>)
  .flatMap(entry=>entry.atomicRules);

const reasons: Record<string,string> = {
  "PARTIAL_SUBRULES_ONLY:REVIEWED_DECLARED_JOINT_DAMPING_TAPE_MEMBERSHIP_ONLY;GLOBAL_OR_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED":"Частично: состав выбранных ведомостей. Полное отсутствие и замена материала не проверены",
  "CONTEXT_UNVERIFIED:ELEMENT_IDENTITY":"Идентичность сравниваемой конструкции не подтверждена",
  "CONTEXT_UNVERIFIED:MATERIAL_CLASS_BASIS":"Основание проектного класса материала не подтверждено",
  "CONTEXT_UNVERIFIED:REINFORCEMENT_APPLICATION_SCOPE":"Применимость декларации к той же рабочей арматуре не подтверждена",
  "CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:matrix-kr-057-catalog_a500c_to_a400":"Позиция, область и рабочая функция арматуры не подтверждены",
  UNSUPPORTED_CATEGORY_TRANSITION:"Этот переход классов не входит в реализованный пример А500С в А400",
  "CONTEXT_UNVERIFIED:PROJECT_ZERO_GEODETIC_AUTHORITY":"Геодезическое основание ПД не подтверждено либо ссылка РД устарела",
  "CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:matrix-pz-009-declared_project_zero_absolute_elevation":"Общий проектный ноль, пол и высотная система не подтверждены",
  CONCRETE_WALL_SCOPED_NO_DECREASE_V1:"Нет понижения для согласованной стены и этажа",
  CONCRETE_WALL_SCOPED_DECREASE_V1:"Понижение класса для согласованной стены и этажа",
  REQUIRED_STAGE_FACT_MISSING:"Нет значения требуемой стадии",
  SOURCE_REVISION_UNRESOLVED:"Редакция источника не установлена",
  SOURCE_APPROVAL_UNRESOLVED:"Согласование источника не установлено",
  ENTITY_SCOPE_UNVERIFIED:"Нужна проверка объекта сравнения",
  ENTITY_IDENTITY_UNVERIFIED:"Нужна проверка связи элементов",
  SCOPED_EXECUTION_WITH_GAPS:"Правила исполнены в ограниченной области",
  CONFIDENCE_NOT_ESTIMABLE:"Уверенность не измерена",
  REQUIRED_FACT_MISSING:"Нет значения одной из сравниваемых стадий",
  AMBIGUOUS_FACTS:"Найдено несколько значений; выбор требует проверки",
  SOURCE_SECTION_UNVERIFIED:"Раздел листа не подтверждён",
  LINK_GROUP_MISMATCH:"Файлы не связаны в один комплект",
  NEGATIVE_SCOPE_UNVERIFIED:"Полнота области для отрицательного вывода не подтверждена",
  ZERO_BASELINE:"Нельзя вычислить относительное отклонение от нуля",
  PROJECT_BASELINE_OUTSIDE_BOUND:"Проектное значение уже вне заданной границы",
  CLASS_DOMAIN_NOT_COMPARABLE:"Классы относятся к разным шкалам",
  CATALOG_TRIGGER_MATCHED:"Условие отклонения выполнено",
  SCOPED_TRIGGER_NOT_MATCHED:"Условие отклонения не выполнено в проверенной области",
  SOURCE_REVISION_UNKNOWN:"Редакция неизвестна", SOURCE_APPROVAL_UNKNOWN:"Согласование неизвестно",
  PAGE_TEXT_REQUIRES_OCR:"Текст страницы требует OCR",
  TABLE_HEADER_UNIT_SCOPE_UNVERIFIED:"Связь единицы из заголовка таблицы требует проверки",
  TABLE_CONTEXT_UNVERIFIED:"Связь строки с заголовком и областью таблицы требует проверки",
  OCR_TRANSCRIPTION_UNVERIFIED:"OCR-транскрипция не проверена",
  SOURCE_STAGE_UNRESOLVED:"Стадия страницы не установлена",
};
type SourceFact = MatrixObservation | MatrixOcrCandidate;
const wallReasons = new Set(["CONCRETE_WALL_SCOPED_NO_DECREASE_V1","CONCRETE_WALL_SCOPED_DECREASE_V1"]);
/** Presentation only: saved scope is never used to manufacture review authority. */
export function matrixConcreteWallResultScope(result:MatrixExecutionRead["execution"]["results"][number]) {
  if (!wallReasons.has(result.reasonCode)) return null;
  const value=result.wallScope;
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const scope=value as Record<string,unknown>;
  const exactKeys=(raw:Record<string,unknown>,keys:string[])=>Object.keys(raw).length===keys.length
    &&keys.every(key=>Object.hasOwn(raw,key));
  if(!exactKeys(scope,["policyVersion","entityKey","componentKey","zoneKey","floorKey",
    "expectedTarget","actualTarget","expectedReview","actualReview"]))return null;
  const exactTarget=(raw:unknown)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
    const target=raw as Record<string,unknown>;
    return exactKeys(target,["checkId","executionContentHash","observationId","evidenceHash","textArtifactHash"])
      &&typeof target.checkId==="string"&&target.checkId.trim()===target.checkId
      &&[target.executionContentHash,target.observationId,target.evidenceHash,target.textArtifactHash]
        .every(hash=>typeof hash==="string"&&/^[a-f0-9]{64}(?![\s\S])/u.test(hash));
  };
  if(!exactTarget(scope.expectedTarget)||!exactTarget(scope.actualTarget))return null;
  const expected=matrixFactScopeTargetSchema.safeParse(scope.expectedTarget);
  const actual=matrixFactScopeTargetSchema.safeParse(scope.actualTarget);
  const review=(raw:unknown) => {
    if (!raw || typeof raw!=="object" || Array.isArray(raw)) return null;
    const value=raw as Record<string,unknown>;
    return exactKeys(value,["decisionId","contentHash"])
      &&typeof value.decisionId==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/u.test(value.decisionId)
      &&typeof value.contentHash==="string"&&/^[a-f0-9]{64}(?![\s\S])/u.test(value.contentHash)
      ? {decisionId:value.decisionId,contentHash:value.contentHash}:null;
  };
  const expectedReview=review(scope.expectedReview),actualReview=review(scope.actualReview);
  if (scope.policyVersion!=="matrix-concrete-wall-reviewed-pair-v1" || scope.entityKey!==result.entityKey
    || ![scope.entityKey,scope.componentKey,scope.zoneKey].every(value=>typeof value==="string"&&value.trim()===value&&value.length>0&&value.length<=200)
    || typeof scope.floorKey!=="string" || !["-3","-2","-1","0","1"].includes(scope.floorKey)
    || !expected.success || !actual.success || !expectedReview || !actualReview
    || expected.data.observationId!==result.expectedObservationId || actual.data.observationId!==result.actualObservationId
    || expected.data.checkId!==actual.data.checkId || expected.data.executionContentHash!==actual.data.executionContentHash) return null;
  return {componentKey:scope.componentKey as string,zoneKey:scope.zoneKey as string,floor:scope.floorKey,
    expectedTarget:expected.data,actualTarget:actual.data,expectedReview,actualReview};
}
function MatrixConcreteWallScopeNotice({result}:{result:MatrixExecutionRead["execution"]["results"][number]}) {
  if (!wallReasons.has(result.reasonCode)) return null;
  const scope=matrixConcreteWallResultScope(result);
  if (!scope) return <span role="status"> · Область стены и этажа не подтверждена сохранёнными адресами.</span>;
  return <span> · Стена: {scope.componentKey} · зона: {scope.zoneKey} · этаж: {scope.floor}
    {(["expected","actual"] as const).map(side=>{
      const target=side==="expected"?scope.expectedTarget:scope.actualTarget;
      const review=side==="expected"?scope.expectedReview:scope.actualReview;
      return <span key={side}> · {side==="expected"?"ПД":"РД"}: запуск {target.checkId}, факт {target.observationId},
        execution {target.executionContentHash}, evidence {target.evidenceHash}, artifact {target.textArtifactHash}, review {review.decisionId}/{review.contentHash}</span>;
    })} · Вывод ограничен этой стеной и одним этажом; весь параметр не проверен.</span>;
}
/** A reason belongs to the immutable selected result, never to inferred missing facts. */
export function matrixFactSavedReason(data:MatrixExecutionRead|null,fact:SourceFact,ruleId?:string):string|null {
  if(!data||!ruleId||fact.method!=="TEXT_LAYER"||!data.execution.observations.some(value=>
    value.id===fact.id&&value.sourceFileId===fact.sourceFileId&&value.sourceSha256===fact.sourceSha256))return null;
  const matching=data.execution.results.filter(value=>value.ruleId===ruleId
    &&(value.expectedObservationId===fact.id||value.actualObservationId===fact.id));
  const codes=[...new Set(matching.map(value=>value.reasonCode))];
  return codes.length===1?codes[0]:null;
}
export const matrixDisplayUnit = (unit: string) => unit === "rebar_catalog_example" ? "(класс)" : unit;
export function MatrixConfidencePolicyNotice({presentation}:{presentation:MatrixExecutionRead["presentation"]}) {
  const first=presentation[0];
  const onePolicy=first?.warningThreshold===MACHINE_CONFIDENCE_POLICY_V1.warningThreshold
    &&presentation.every(value=>value.policyVersion===first.policyVersion&&value.warningThreshold===first.warningThreshold);
  const threshold=onePolicy&&first.policyVersion===MACHINE_CONFIDENCE_POLICY_V1.policyVersion?"Калиброванная уверенность ≥80%"
    :onePolicy&&first.policyVersion===MACHINE_CONFIDENCE_POLICY_V2.policyVersion?"Калиброванная уверенность строго >80%":null;
  return <p>{threshold?`Машинное предупреждение: ${threshold} и достаточные доказательства.`
    :"Порог машинного предупреждения определяется сохранённой политикой каждого результата. Без подтверждённой политики — кандидат."}
    {" "}Без калибровки — кандидат, уверенность не измерена. Решение инспектора сохраняется отдельно.</p>;
}
export function MatrixRuleCandidates({data,onSelect}: {data:MatrixExecutionRead;onSelect:(fact:MatrixObservation)=>void}) {
  const visible=data.execution.results.map((result,resultIndex)=>({result,resultIndex}))
    .filter(({result})=>result.machineStatus==="CANDIDATE"||result.executionStatus==="FAILED");
  return <section aria-label="Кандидаты расхождений по общим правилам">
    <h3>Кандидаты расхождений: {visible.filter(({result})=>result.executionStatus!=="FAILED").length}</h3>
    {!visible.length&&<p>Квалифицированных кандидатов в этом запуске нет. Проверьте ограничения и недостающие исходные данные.</p>}
    {visible.map(({result:r,resultIndex})=>{
      const p=data.presentation.find(value=>value.resultIndex===resultIndex);
      const failed=r.executionStatus==="FAILED";
      const confidence=parseMachineConfidence(p?.confidence);
      const policyV2=p?.policyVersion===MACHINE_CONFIDENCE_POLICY_V2.policyVersion;
      const supportedPolicy=p?.warningThreshold===MACHINE_CONFIDENCE_POLICY_V1.warningThreshold
        &&(p.policyVersion===MACHINE_CONFIDENCE_POLICY_V1.policyVersion||policyV2);
      const candidateThresholdDescription=policyV2?"не превышает порог":"ниже порога";
      // Keep the saved disposition; apply the selected policy to the raw probability.
      const warning=!failed&&r.qualified&&p?.machineDisposition==="WARNING"
        &&supportedPolicy&&confidence?.confidenceKind==="CALIBRATED"&&confidence.calibratedProbability!==null
        &&(policyV2?confidence.calibratedProbability>MACHINE_CONFIDENCE_POLICY_V2.warningThreshold
          :confidence.calibratedProbability>=MACHINE_CONFIDENCE_POLICY_V1.warningThreshold);
      const rule=matrixRules.find(value=>value.ruleId===r.ruleId);
      const deltaUnit=rule?.family.startsWith("RELATIVE_")?"%":rule?.canonicalUnit??"";
      return <article key={`${r.ruleId}:${r.entityKey}:${r.comparisonVariant}`} style={{border:"1px solid var(--border-subtle)",padding:"12px",marginBottom:12}}>
        <strong>{r.parameterCode} · {failed?"Ошибка обработки":warning?"Машинное предупреждение":"Кандидат"}</strong>
        <p>{r.entityKey??"Элемент не сопоставлен"} · {r.comparisonVariant.replace("_"," / ")}</p>
        <p>{failed?"Технический сбой не является низкой уверенностью.":warning
          ?`Калиброванная уверенность ${(confidence!.calibratedProbability!*100).toFixed(2)}%. Решение инспектора требуется отдельно.`
          :p&&!supportedPolicy?"Политика уверенности не поддерживается. Решение инспектора требуется отдельно."
          :confidence?.confidenceKind==="CALIBRATED"&&confidence.calibratedProbability!==null
            ?`Уверенность ${candidateThresholdDescription} предупреждения либо область калибровки не подтверждена. Вероятность: ${(confidence.calibratedProbability*100).toFixed(2)}%.`
            :"Уверенность не измерена. Решение инспектора требуется отдельно."}</p>
        <p>{wallReasons.has(r.reasonCode)&&!matrixConcreteWallResultScope(r)?"Область стены и этажа не подтверждена":reasons[r.reasonCode]??r.reasonCode}<MatrixConcreteWallScopeNotice result={r}/></p>
        {([['expectedObservationId','Исходное значение'],['actualObservationId','Сопоставляемое значение']] as const).map(([key,label])=>{
          const fact=data.execution.observations.find(value=>value.id===r[key]);
          return fact&&<div key={key}><p>{label}: <strong>{fact.value} {matrixDisplayUnit(fact.unit)}</strong> · {fact.stage} · PDF {fact.pageNumber}</p>
            <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}} onClick={()=>onSelect(fact)}>{label}: открыть оригинал</button></div>;
        })}
        {r.delta!==null&&<p>Отклонение: {r.delta} {deltaUnit}</p>}
      </article>;
    })}
  </section>;
}
export function matrixFactMatchesQuery(fact: SourceFact, query: string, files: SourceFileSummary[]) {
  const file = files.find(value => value.id === fact.sourceFileId);
  const context=fact.method==="TEXT_LAYER"?fact.contextFragments?.map(f=>`${f.rawText} ${f.pageNumber}`).join(" "):"";
  return `${fact.attribute} ${fact.value} ${fact.unit} ${fact.rawText} ${context??""} ${fact.parameterCodes ?? ""} ${fact.sourceFileId} ${file?.name ?? ""} ${fact.stage} ${fact.pageNumber}`
    .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function matrixFactEvidence(fact: SourceFact,context?:MatrixContextFragment|null): Omit<InspectorEvidence,"stage"> & {stage: SourceFact["stage"]} {
  const bbox=context?.bbox??fact.bbox;
  return {id:context?`${fact.id.slice(0,50)}:${context.pageNumber}:${context.blockId}`:fact.id.slice(0,80),sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,stage:fact.stage,
    pageNumber:context?.pageNumber??fact.pageNumber,sheet:null,revision:null,
    bbox:[bbox.x,bbox.y,bbox.x+bbox.width,bbox.y+bbox.height],
    value:context?.rawText??fact.value,unit:context?"":matrixDisplayUnit(fact.unit),element:context?(context.role==="UNIT_DECLARATION"?"Единицы абсолютных отметок из исходного листа":context.role==="MATERIAL_SCOPE"?(fact.attribute==="CONCRETE_CLASS"?"Применимость класса бетона из исходного листа":"Применимость класса арматуры из исходного листа"):context.role==="ATTRIBUTE_HEADER"&&fact.attribute==="CONCRETE_CLASS"&&fact.method==="TEXT_LAYER"&&fact.contextFragments?.some(p=>p.role==="MATERIAL_SCOPE")?"Основание класса бетона из исходного листа":"Контекст таблицы; связь требует проверки"):fact.entityKey??"Область элемента не подтверждена"};
}
export function MatrixFactContext({fact,onSelect}: {fact:MatrixObservation;onSelect:(fragment:MatrixContextFragment)=>void}) {
  if(!fact.contextFragments?.length)return null;
  return <div aria-label="Контекст извлечённого значения"><p>{fact.contextFragments.every(part=>part.role==="UNIT_DECLARATION")?"Единицы абсолютных отметок взяты из примечания исходного листа. Геодезическое основание проверяется отдельно.":fact.extractorVersion==="matrix-concrete-wall-prose-v1"?"Явный класс бетона стены сохранён из исходного листа. Та же физическая стена, зона и один общий этаж требуют отдельной проверки.":fact.attribute==="CONCRETE_CLASS"&&fact.contextFragments.some(part=>part.role==="MATERIAL_SCOPE")?"Явные заголовок материала и область лестничного бетона сохранены из исходных листов. Связь с той же несущей конструкцией требует отдельной проверки.":fact.contextFragments.every(part=>part.role==="MATERIAL_SCOPE")?"Область применения класса сохранена из исходного листа. Связь с той же рабочей арматурой требует отдельной проверки.":"Связь строки с контекстом таблицы не подтверждена."}</p>
    {fact.contextFragments.map((fragment,index)=><div key={`${fragment.pageNumber}:${fragment.blockId}:${index}`}>
      <p>{fragment.role==="UNIT_DECLARATION"?"Единицы абсолютных отметок":fragment.role==="MATERIAL_SCOPE"?(fact.attribute==="CONCRETE_CLASS"?"Область применения бетона":"Область применения арматуры"):fragment.role==="ATTRIBUTE_HEADER"?"Заголовок признака":"Область таблицы"} · PDF {fragment.pageNumber}: {fragment.rawText}</p>
      <button type="button" className="button button--secondary" style={{maxWidth:"100%",whiteSpace:"normal"}}
        onClick={()=>onSelect(fragment)}>Открыть контекст · PDF {fragment.pageNumber} · строка {fragment.blockId}</button>
    </div>)}
  </div>;
}
export function MatrixOcrCandidates({candidates,files,query,onSelect}: {
  candidates:MatrixOcrCandidate[];files:SourceFileSummary[];query:string;onSelect:(candidate:MatrixOcrCandidate)=>void;
}) {
  const visible = candidates.filter(candidate=>matrixFactMatchesQuery(candidate,query,files));
  return <section aria-label="Кандидаты из OCR" style={{marginTop:"var(--space-lg)"}}>
    <h3>Кандидаты из OCR</h3>
    <p>OCR-транскрипция не проверена. Это прочитанные значения для сверки с оригиналом; они не добавляют выполненных правил или успешных сравнений.</p>
    <p role="status">Кандидатов OCR: {visible.length} / {candidates.length}</p>
    <div style={{maxHeight:420,overflow:"auto"}}>{visible.map(candidate=><article key={candidate.id}
      style={{borderBottom:"1px solid var(--border-subtle)",padding:"12px 0"}}>
      <strong>{candidate.value} {candidate.unit}</strong> · Кандидат · OCR-транскрипция не проверена
      <p>{files.find(file=>file.id===candidate.sourceFileId)?.name??candidate.sourceFileId} · {candidate.stage==="UNRESOLVED"?"Стадия не установлена":candidate.stage} · PDF {candidate.pageNumber} · строка OCR {candidate.lineIndex+1}</p>
      <p>{candidate.rawText}</p>
      <small>{candidate.attribute} · {candidate.parameterCodes.join(", ")} · {candidate.sourceFileId} · SHA {candidate.sourceSha256.slice(0,16)}</small>
      <p><small title={`Render SHA ${candidate.renderSha256}; OCR page SHA ${candidate.ocrPageContentHash}`}>Изображение SHA {candidate.renderSha256.slice(0,16)} · OCR-страница SHA {candidate.ocrPageContentHash.slice(0,16)}</small></p>
      <p>Ограничения: {[...new Set(["OCR_TRANSCRIPTION_UNVERIFIED",...candidate.sourceFlags])].map(flag=>reasons[flag]??flag).join("; ")}</p>
      <button type="button" className="button button--secondary" onClick={()=>onSelect(candidate)}>Сверить OCR с исходным фрагментом</button>
    </article>)}</div>
    {!visible.length&&<p>Подходящих OCR-кандидатов в сохранённом результате нет. Это не доказывает отсутствие значений в исходниках.</p>}
  </section>;
}
export function MatrixExecutionPanel({objectId,checkId,onSource}: {objectId:string;checkId:string;
  onSource?:(file:{id:string;sha256:string})=>void}) {
  const [data,setData]=useState<MatrixExecutionRead|null>(null);
  const [files,setFiles]=useState<SourceFileSummary[]>([]);
  const [canReview,setCanReview]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [sourceError,setSourceError]=useState<string|null>(null);
  const [sourceRetry,setSourceRetry]=useState(0);
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<SourceFact|null>(null);
  const [selectedContext,setSelectedContext]=useState<MatrixContextFragment|null>(null);
  const [selectedInventory,setSelectedInventory]=useState<InspectorEvidence|null>(null);
  const [preferredRuleId,setPreferredRuleId]=useState<string|undefined>();
  const selectFact=(fact:SourceFact,ruleId?:string)=>{setSelectedInventory(null);setSelected(fact);setSelectedContext(null);setPreferredRuleId(ruleId);};
  const selectInventory=(fragment:InspectorEvidence)=>{setSelected(null);setSelectedContext(null);setSelectedInventory(fragment);setPreferredRuleId(undefined);};
  useEffect(()=>{ let active=true; setData(null);setFiles([]);setCanReview(false);setError(null);setSelected(null);setSelectedContext(null);setSelectedInventory(null);
    api.getMatrixExecution(checkId).then(value=>{if(active)setData(value);}).catch(e=>{
      // Historical pilot releases have no generic artifact.
      if(active && !String(e.message).includes("Результат отсутствует"))setError(e.message);
    });
    return()=>{active=false;};
  },[checkId,objectId]);
  useEffect(()=>{
    let active=true;
    setSourceError(null);setCanReview(false);
    api.listSourceFiles(objectId).then(value=>{if(active){setFiles(value.items);setCanReview(value.permissions.review);}})
      .catch(cause=>{if(active)setSourceError(cause instanceof Error?cause.message:String(cause));});
    return()=>{active=false;};
  },[checkId,objectId,sourceRetry]);
  const observations=useMemo(()=>data?.execution.observations.filter(o=>matrixFactMatchesQuery(o,query,files))??[],[data,query,files]);
  if(error)return <section className="surface" role="alert">Не удалось прочитать машинные факты: {error}</section>;
  if(!data)return null;
  // Visibility comes from the entire saved execution, independently of the search filter.
  const concreteWallReviewAvailable=data.execution.observations.some(fact=>fact.method==="TEXT_LAYER"
    &&fact.stage==="RD"&&fact.extractorVersion==="matrix-concrete-wall-prose-v1");
  const coverage=data.effectiveCoverage??data.execution.coverage;
  const evidence=selected?matrixFactEvidence(selected,selectedContext):undefined;
  return <section className="surface matrix-execution" aria-label="Общий машинный анализ" style={{padding:"var(--space-lg)",marginTop:"var(--space-lg)",overflowWrap:"anywhere"}}>
    <h2>Машинные факты и правила</h2>
    <p>Наблюдения из оригиналов доступны до согласования редакций. Каждый вывод сохраняет ограничения источников и объекта сравнения.</p>
    <p>Параметров хотя бы с одним узким правилом: <strong>{coverage.filter(c=>c.implementedAtomicRules>0).length}</strong> / 132 ·
      Атомарных правил выполнено: <strong>{coverage.reduce((n,c)=>n+c.evaluatedAtomicRules,0)}</strong> ·
      Успешных сравнений: <strong>{coverage.reduce((n,c)=>n+c.successfulComparisons,0)}</strong> ·
      Параметров без правил: <strong>{coverage.filter(c=>c.executionStatus==="UNSUPPORTED").length}</strong></p>
    <p>Одно узкое правило не означает полной проверки параметра. Счётчик сравнений относится только к проверенной области; пропуски и ограничения приведены в карте покрытия.</p>
    <MatrixConfidencePolicyNotice presentation={data.presentation}/>
    <MatrixRuleCandidates data={data} onSelect={selectFact}/>
    {sourceError&&<p role="alert">Не удалось загрузить исходные файлы: {sourceError}. Привязки недоступны.
      <button type="button" className="button button--secondary" onClick={()=>setSourceRetry(value=>value+1)}>Повторить чтение файлов</button></p>}
    <MatrixReviewWorklist data={data} files={files} onSelect={selectFact} onSource={onSource}/>
    <InventoryComparisonsPanel comparisons={data.inventoryComparisons} evidence={data.inventoryComparisonEvidence} files={files} onSelect={selectInventory}/>
    <CallInventoryComparisonsPanel comparisons={data.callInventoryComparisons} evidence={data.callInventoryComparisonEvidence} files={files} onSelect={selectInventory}/>
    <WaterNodeComparisonsPanel comparisons={data.waterNodeComparisons} evidence={data.waterNodeComparisonEvidence}
        files={files} onSelect={selectInventory}/>
    <RailInventoryComparisonsPanel comparisons={data.railInventoryComparisons} evidence={data.railInventoryComparisonEvidence} files={files} onSelect={selectInventory}/>
    <LightingTechnologyComparisonsPanel comparisons={data.lightingTechnologyComparisons} evidence={data.lightingTechnologyComparisonEvidence} files={files} onSelect={selectInventory}/>
    <SteelComparisonsPanel comparisons={data.steelComparisons} evidence={data.steelComparisonEvidence} snapshot={data.steelApplicabilitySnapshot} files={files} onSelect={selectInventory}/>
    <ColumnPylonSectionComparisonsPanel objectId={objectId} inputManifestHash={data.execution.inputManifestHash} comparisons={data.columnPylonSectionComparisons} snapshot={data.columnPylonSectionSnapshot} evidence={data.columnPylonSectionComparisonEvidence} files={files} onSelect={selectInventory}/>
    <details><summary>Состояние исходников и найденные штампы</summary>
      {data.execution.metadata.map((source,index)=><article key={index}>
        <strong>{files.find(f=>f.id===source.sourceFileId)?.name??String(source.sourceFileId)}</strong>
        <p>Стадия: {String(source.stage)} · Раздел: {String(source.sectionCode??"не установлен")} ·
          Редакция: {String(source.revisionStatus)} · Согласование: {String(source.approvalStatus)}</p>
        <p>Значения из штампов — подсказки для проверки источника.</p>
        {onSource&&typeof source.sourceFileId==="string"&&typeof source.sourceSha256==="string"
          &&files.filter(file=>file.id===source.sourceFileId).length===1
          &&files.some(file=>file.id===source.sourceFileId&&file.sha256===source.sourceSha256)
          &&<button type="button" className="button button--secondary" onClick={()=>onSource({id:String(source.sourceFileId),sha256:String(source.sourceSha256)})}>Проверить этот источник</button>}
        {Array.isArray(source.stampCandidates)&&source.stampCandidates.map((stamp:any,n:number)=><p key={n}>
          PDF {stamp.pageNumber}: {stamp.rawText}</p>)}
      </article>)}
    </details>
    <label>Поиск извлечённых значений<input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label>
    <p role="status">Наблюдений: {observations.length} / {data.execution.observations.length}</p>
    <div style={{maxHeight:420,overflow:"auto"}}>
      {observations.map(o=><article key={o.id} style={{borderBottom:"1px solid var(--border-subtle)",padding:"12px 0"}}>
        <strong>{o.value} {matrixDisplayUnit(o.unit)}</strong> · {o.stage} · PDF {o.pageNumber}
        <p>{o.rawText}</p><small>{o.attribute} · {o.sourceFileId} · SHA {o.sourceSha256.slice(0,16)} · {o.entityKey??"Элемент не сопоставлен"}</small>
        {Array.isArray(o.sourceFlags)&&o.sourceFlags.length>0&&<p>Ограничения: {o.sourceFlags.map(String).map(f=>reasons[f]??f).join("; ")}</p>}
        <p><button type="button" className="button button--secondary" onClick={()=>selectFact(o)}>Открыть исходный фрагмент</button></p>
        <MatrixFactContext fact={o} onSelect={fragment=>{selectFact(o);setSelectedContext(fragment);}} />
      </article>)}
      {!observations.length&&<p>По этому запросу значений нет. Это не доказывает их отсутствие в документах.</p>}
    </div>
    {data.execution.ocrSummary&&<p>OCR: обработано {data.execution.ocrSummary.processedPageCount} из {data.execution.ocrSummary.ocrRequiredPageCount} требующих распознавания страниц; отложено {data.execution.ocrSummary.deferredPageCount}; пропущено по размеру изображения {data.execution.ocrSummary.skippedRenderPixelPageCount}. Лимит этого запуска: {data.execution.ocrSummary.maxPagesPerRun} страницы.</p>}
    <MatrixOcrCandidates candidates={data.execution.ocrCandidates??[]} files={files} query={query} onSelect={selectFact} />
    <MatrixProjectConstraints key={checkId} artifact={data.projectConstraints} objectId={objectId} files={files} query={query} />
    <MatrixSourceDeclarations key={`declarations:${checkId}`} artifact={data.sourceDeclarations} objectId={objectId} files={files} query={query}
      sections={Object.fromEntries(data.execution.metadata.map(source => [String(source.sourceFileId), typeof source.sectionCode === "string" ? source.sectionCode : null]))} />
    {selectedContext&&<p role="status">{selectedContext.role==="UNIT_DECLARATION"?"Выбраны единицы абсолютных отметок":selectedContext.role==="MATERIAL_SCOPE"?(selected?.attribute==="CONCRETE_CLASS"?"Выбрана область применения бетона":"Выбрана область применения арматуры"):"Выбран контекст таблицы"} · PDF {selectedContext.pageNumber}: {selectedContext.rawText}. {selectedContext.role==="UNIT_DECLARATION"?"Геодезическое основание проверяется отдельно.":"Связь со значением требует проверки."}</p>}
    {selected?.method==="OCR"&&<p role="status">Выбран OCR-кандидат: транскрипция не проверена. Сверьте значение и выделенную область на оригинале.</p>}
    {selected&&<div className="inspector-review-viewers"><InspectorEvidenceViewer objectId={objectId} stage={selected.stage}
      evidence={evidence} file={files.find(f=>f.id===selected.sourceFileId)} onOpened={()=>{}} /></div>}
    {selectedInventory&&<div className="inspector-review-viewers"><InspectorEvidenceViewer objectId={objectId} stage={selectedInventory.stage}
      evidence={selectedInventory} file={files.find(f=>f.id===selectedInventory.sourceFileId&&f.sha256===selectedInventory.sourceSha256)} onOpened={()=>{}} /></div>}
    {selected?.method==="TEXT_LAYER"&&<MatrixFactScopeReview objectId={objectId} checkId={checkId}
      executionContentHash={data.contentHash} fact={selected} canReview={canReview&&!!matrixReviewFactSource(selected,files)} projectZeroSources={files} preferredRuleId={preferredRuleId} concreteWallReviewAvailable={concreteWallReviewAvailable}
      currentFile={matrixReviewFactSource(selected,files)??null} onSource={onSource}
      savedReasonCode={matrixFactSavedReason(data,selected,preferredRuleId)}/>}
    <details><summary>Атомарные результаты: {data.execution.results.length}</summary>
      {data.execution.results.map((r,index)=><p key={`${r.ruleId}-${r.entityKey}-${index}`}>
        <strong>{r.parameterCode}</strong> · {r.comparisonVariant.replace("_"," / ")} · {r.machineStatus==="CANDIDATE"?"Кандидат":r.machineStatus==="NEGATIVE_VERIFIED"?(wallReasons.has(r.reasonCode)?matrixConcreteWallResultScope(r)?"Нет понижения для согласованной стены и этажа":"Область стены и этажа не подтверждена":"Нет отклонения в проверенной области"):r.machineStatus==="MISSING_EVIDENCE"?"Не хватает данных":r.executionStatus==="FAILED"?"Ошибка обработки":"Требуется уточнение"} · {wallReasons.has(r.reasonCode)&&!matrixConcreteWallResultScope(r)?"Сохранённая область не подтверждена":reasons[r.reasonCode]??r.reasonCode}<MatrixConcreteWallScopeNotice result={r}/>
        {r.expectedValue!==null&&` · ${r.comparisonVariant.split("_")[0]}: ${r.expectedValue}`}{r.actualValue!==null&&` · ${r.comparisonVariant.split("_")[1]}: ${r.actualValue}`}
        {r.delta!==null&&` · Отклонение: ${r.delta}`}
        {r.machineStatus==="CANDIDATE"&&` · ${reasons[data.presentation[index]?.reasonCode]??"Уверенность не измерена"}`}
      </p>)}
    </details>
    <details><summary>Полная карта покрытия: 132</summary>{coverage.map(c=><p key={c.parameterCode}>
      <strong>{c.parameterCode}</strong> · {c.executionStatus} · {c.successfulComparisons} сравнений · {c.abstentions} отказов · {reasons[c.reason]??c.reason}</p>)}</details>
    <LocalRegistrationWorkspace objectId={objectId} checkId={checkId} />
    <details><summary>Привязка к напечатанным координатам исходного листа</summary>
      <DocumentCoordinateWorkspace objectId={objectId} checkId={checkId} files={files}/>
    </details>
    {data.submission&&<p><a href={api.submissionUrl(checkId)}>Скачать сохранённый машинный JSON</a> · частичный результат ·
      {data.submission.officialIdsVerified?" ID источников проверены":" используются ID приложения; официальное сопоставление не подтверждено"} · SHA {data.submission.contentHash}</p>}
  </section>;
}
