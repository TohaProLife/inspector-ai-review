import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classifyMachineConfidence, NOT_ESTIMABLE_MACHINE_CONFIDENCE, type MatrixExecutionRead, type MatrixObservation } from "@inspector-ai/contracts";
import { MatrixRuleCandidates, MatrixFactContext, matrixFactEvidence, matrixFactMatchesQuery } from "./MatrixExecutionPanel";

function fixture(probability:number|null=null): MatrixExecutionRead {
  const facts:MatrixObservation[]=["PD","RD"].map((stage,index)=>({id:`fact-${index}`,sourceFileId:`FIL-${stage}`,
    sourceSha256:"a".repeat(64),stage:stage as "PD"|"RD",pageNumber:index+1,blockId:"0:0",
    bbox:{x:.1,y:.1,width:.3,height:.1},rawText:`Площадь ${index?103:100} м²`,attribute:"BUILDING_TOTAL_AREA",
    value:String(index?103:100),unit:"m2",entityKey:"building-A",method:"TEXT_LAYER",extractorVersion:"test"}));
  return {checkId:"CHK-TEST",contentHash:"b".repeat(64),submission:null,
    execution:{schemaVersion:"matrix-execution-v1",objectId:"OBJ-TEST",inputManifestHash:"c".repeat(64),registryHash:"d".repeat(64),
      observations:facts,metadata:[],coverage:[],results:[{ruleId:"matrix-pz-002-building_total_area",ruleVersion:"1",parameterCode:"PZ-002",
        entityKey:"building-A",comparisonVariant:"PD_RD",executionStatus:"SUCCEEDED",machineStatus:"CANDIDATE",reasonCode:"CATALOG_TRIGGER_MATCHED",
        expectedObservationId:"fact-0",actualObservationId:"fact-1",expectedValue:"100",actualValue:"103",delta:"3",qualified:true}]},
    presentation:[{resultIndex:0,...classifyMachineConfidence({evidenceQualified:true,expectedCalibrationVersion:"cal-test",
      confidence:probability===null?NOT_ESTIMABLE_MACHINE_CONFIDENCE:{...NOT_ESTIMABLE_MACHINE_CONFIDENCE,confidenceKind:"CALIBRATED",calibrationVersion:"cal-test",calibratedProbability:probability}})}]};
}
const render=(data:MatrixExecutionRead)=>renderToStaticMarkup(createElement(MatrixRuleCandidates,{data,onSelect:()=>{}}));
describe("visible matrix rule candidates",()=>{
  it("keeps a previous-page table header separate from the value locator and searchable",()=>{
    const fact=fixture().execution.observations[0];
    fact.pageNumber=50;fact.contextFragments=[{pageNumber:49,blockId:"10:1",rawText:"классы по прочности на сжатие:",
      bbox:{x:.1,y:.4,width:.8,height:.02},role:"ATTRIBUTE_HEADER"},{pageNumber:50,blockId:"0:0",rawText:"Подземная часть",
      bbox:{x:.2,y:.03,width:.3,height:.02},role:"TABLE_SCOPE"}];
    const html=renderToStaticMarkup(createElement(MatrixFactContext,{fact,onSelect:()=>{}}));
    expect(html).toContain("Связь строки с контекстом таблицы не подтверждена");
    expect(html).toContain("Открыть контекст · PDF 49 · строка 10:1");
    expect(html).toContain("Подземная часть");expect(matrixFactMatchesQuery(fact,"Подземная часть",[])).toBe(true);
    expect(matrixFactEvidence(fact).pageNumber).toBe(50);
    const header=matrixFactEvidence(fact,fact.contextFragments[0]);
    expect(header.pageNumber).toBe(49);expect(header.bbox).toEqual([.1,.4,.9,.42000000000000004]);
    expect(header.value).toBe("классы по прочности на сжатие:");expect(header.unit).toBe("");
  });
  it("shows unknown confidence and both original-value actions with units and stage",()=>{
    const html=render(fixture());
    expect(html).toContain("Кандидаты расхождений: 1");expect(html).toContain("PZ-002 · Кандидат");
    expect(html).toContain("Уверенность не измерена");expect(html).toContain("100 m2");expect(html).toContain("103 m2");
    expect(html).toContain("Исходное значение: открыть оригинал");expect(html).toContain("Сопоставляемое значение: открыть оригинал");
    expect(html).toContain("Отклонение: 3 %");expect(html).not.toContain("Машинное предупреждение");
  });
  it("renders a warning at the exact calibrated cutoff and keeps a rounded 80% candidate below it",()=>{
    expect(render(fixture(.8))).toContain("PZ-002 · Машинное предупреждение");
    const below=render(fixture(.7996));expect(below).toContain("PZ-002 · Кандидат");expect(below).not.toContain("Машинное предупреждение");
  });
  it("keeps a technical failure separate from confidence and does not infer no violation from zero candidates",()=>{
    const failed=fixture(.9);failed.execution.results[0].executionStatus="FAILED";
    expect(render(failed)).toContain("Ошибка обработки");expect(render(failed)).not.toContain("Машинное предупреждение");
    const absent=fixture();absent.execution.results=[];expect(render(absent)).toContain("Проверьте ограничения и недостающие исходные данные");
    expect(render(absent)).not.toContain("Нет нарушений");
  });
});
