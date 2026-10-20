import { readFileSync } from "node:fs";
import React, { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixRailInventoryComparisons, MatrixRailInventoryComparisonEvidence,
  MatrixRailInventoryExecutionResult } from "@inspector-ai/contracts";
import { RailInventoryComparisonsPanel, railInventoryFragmentEvidence } from "./RailInventoryComparisonsPanel";

const fixture=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-rail-execution-v1/ts-rail-execution-wire-manual-goldens.json",import.meta.url),"utf8")).validCases[0];
const envelope:MatrixRailInventoryComparisons=fixture.expectedEnvelope,row=envelope.results[0];
const originalItems:MatrixRailInventoryComparisonEvidence[]=[];
if(row.kind!=="SCOPED_COMPARISON"||row.comparison.status!=="CANDIDATE")throw Error("frozen candidate fixture required");
for(const role of ["EXPECTED","ACTUAL"] as const) {
  const ref=role==="EXPECTED"?row.comparison.expected:row.comparison.actual;
  const source=fixture.package.sources.find((s:any)=>s.sourceFileId===ref.sourceFileId);
  const claim=source.review.railInventoryScope.claims[0],snapshot=claim.inventorySnapshot;
  const origin=fixture.package.origins.find((o:any)=>o.checkId===claim.target.checkId&&o.sourceFileId===source.sourceFileId);
  const page=origin.textArtifact.pages.find((p:any)=>p.pageNumber===snapshot.pageNumber);
  const groups=[['HEADER',snapshot.headerFragments],['SCOPE',snapshot.scopeFragments],['FEATURE',snapshot.featureRows.flatMap((r:any)=>r.fragments)],['END',snapshot.endFragments]] as const;
  for(const [fragmentRole,fragments] of groups)for(const fragment of fragments) {
    expect(fragment.rawText).toBe(page.blocks[fragment.blockIndex].text.split("\n")[fragment.lineIndex]);
    expect(fragment.bboxMilliPoints).toEqual(page.blocks[fragment.blockIndex].lineBboxesMilliPoints[fragment.lineIndex]);
    originalItems.push({resultId:row.id,role,...ref,originCheckId:origin.checkId,pageNumber:fragment.pageNumber,
      pageFrame:{widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints},fragmentRole,fragment:structuredClone(fragment)});
  }
}
const item=()=>structuredClone(originalItems[0]);
const render=(overrides:any={})=>renderToStaticMarkup(createElement(RailInventoryComparisonsPanel,{comparisons:envelope,evidence:originalItems,files:[],onSelect:()=>{},...overrides}));
function buttons(tree:unknown):React.ReactElement<any>[] {
  const found:React.ReactElement<any>[]=[];
  function walk(node:any){if(!isValidElement(node))return;const e=node as React.ReactElement<any>;if(e.type==="button")found.push(e);React.Children.forEach(e.props.children,walk);}
  walk(tree);return found;
}

describe("dedicated ODI120 typed result UI",()=>{
  it("historical runs without sibling produce no invented result",()=>expect(render({comparisons:undefined})).toBe(""));
  it("shows scoped candidate, all four reviewed room keys and literal limitations",()=>{
    const text=render();expect(text).toContain("ODI-120 · Кандидат");expect(text).toContain("Кандидатов: 1 · Областей без вывода: 0");
    if(row.kind!=="SCOPED_COMPARISON")throw Error("fixture");
    for(const k of ["entityKey","buildingKey","floorKey","roomKey"] as const)expect(text).toContain(row.identity[k]);
    expect(text).toContain("только для названной доступной санитарной комнаты");expect(text).toContain("Идентичность комнаты и полноту этих областей подтверждает человек");
    expect(text).toContain("Физическое отсутствие, размеры, крепления, нагрузку и эквивалентность поручней этот вывод не устанавливает");
    expect(text).toContain("Остальные помещения и условия параметра ODI-120 остаются непроверенными");
    expect(text).not.toContain("NO_VIOLATION");expect(text).not.toContain("Нарушений нет");
  });
  it("forged confidence or adjacent presentation never promotes candidate",()=>{
    const forged=structuredClone(envelope) as any;forged.results[0].comparison.calibratedProbability=.99;
    forged.results[0].presentation={classification:"ERROR",probability:.99,label:"Подтверждённая ошибка"};
    const text=render({comparisons:forged,presentations:[{resultId:row.id,classification:"WARNING",probability:.99}]});
    expect(text).toContain("ODI-120 · Кандидат");expect(text).toContain("Уверенность не измерена");
    expect(text).not.toMatch(/99%|80%|ERROR|WARNING|Подтверждённая ошибка|Машинное предупреждение/);
  });
  it("all12 original HEADER/SCOPE/FEATURE/END lines retain raw text and distinct original actions",()=>{
    expect(originalItems).toHaveLength(12);const text=render();
    for(const i of originalItems)expect(text).toContain(i.fragment.rawText);
    expect((text.match(/Открыть оригинал/g)??[])).toHaveLength(12);
    expect((text.match(/Конец перечня · PDF/g)??[])).toHaveLength(2);
    expect(text).toContain("SYNTHETIC-T46-REVIEW-pd-both");expect(text).toContain("SYNTHETIC-T46-REVIEW-rd-basin");
    expect(text).not.toMatch(/Привязать|Подтвердить нарушение|Сохранить решение|type="submit"/);
  });
  it("raw source Unicode and special markup are escaped once, never normalized",()=>{
    const e=item();e.fragment.rawText="Поручень <исходный хвост> &\u202f😀";
    const text=render({evidence:[e]});expect(text).toContain("Поручень &lt;исходный хвост&gt; &amp;\u202f😀");
    expect(text).not.toContain("&amp;lt;");expect(railInventoryFragmentEvidence(row,e)?.value).toBe(e.fragment.rawText);
  });
  const abstentions=["ROOM_IDENTITY_CONFLICT","SOURCE_STAGE_UNVERIFIED","AMBIGUOUS_INVENTORY_SCOPE","MATCHED_INVENTORY_PAIR_UNVERIFIED",
    "SOURCE_REVIEW_UNVERIFIED","SOURCE_SECTION_UNVERIFIED","LINK_SCOPE_UNVERIFIED","ROOM_MAPPING_UNVERIFIED","HUMAN_COMPLETENESS_UNVERIFIED",
    "NONEMPTY_CLOSED_REGION_UNVERIFIED","PD_REQUIREMENT_UNVERIFIED","NEGATIVE_SCOPE_UNVERIFIED","UNKNOWN_FUTURE_REASON"];
  it.each(abstentions)("abstention %s gives no candidate, positive certificate or original actions",reason=>{
    const r={...structuredClone(row),comparison:{schemaVersion:"matrix-odi123-rail-inventory-comparison-v1",status:"ABSTAIN",reasonCode:reason,calibratedProbability:null}};
    const text=render({comparisons:{...envelope,results:[r]}});
    expect(text).toContain("Кандидатов: 0 · Областей без вывода: 1");expect(text).toContain("Почему сравнение ограничено: 1");
    expect(text).not.toContain("ODI-120 · Кандидат");expect(text).not.toContain("Открыть оригинал");expect(text).not.toMatch(/Нарушений нет|NO_VIOLATION|99%/);
  });
  it("unbound atom remains explicit missing reviewed room identity",()=>{
    const unbound:MatrixRailInventoryExecutionResult={schemaVersion:"matrix-rail-inventory-execution-result-v1",id:"f".repeat(64),ruleId:row.ruleId,
      ruleVersion:"1",parameterCode:"ODI-120",comparisonVariant:"PD_RD",kind:"UNBOUND_ATOM_ABSTENTION",reasonCode:"REVIEWED_RAIL_INVENTORY_IDENTITY_MISSING",calibratedProbability:null};
    const text=render({comparisons:{...envelope,results:[unbound]}});expect(text).toContain("нет проверенной идентичности санитарной комнаты");
    expect(text).toContain("Кандидатов: 0 · Областей без вывода: 1");expect(text).not.toContain("Открыть оригинал");
  });
  it("original frozen refs are checked independently of latest filename/source review",()=>{
    const latest=structuredClone(originalItems);latest.forEach(e=>{e.reviewDecisionId="LATEST";e.reviewContentHash="f".repeat(64);e.fragment.rawText="INJECTED LATEST TEXT";});
    const text=render({evidence:latest,files:[{id:originalItems[0].sourceFileId,sha256:"f".repeat(64),name:"LATEST SOURCE FILE"}]});
    expect(text).not.toContain("INJECTED LATEST TEXT");expect(text).not.toContain("LATEST SOURCE FILE");expect(text).not.toContain("Открыть оригинал");
    expect((text.match(/Оригинальные фрагменты для сохранённой ссылки недоступны/g)??[])).toHaveLength(2);
  });
  it("callback selects each exact original once, without mutating typed payloads or adding scalar facts",()=>{
    const input=structuredClone(originalItems),before=structuredClone(input),selected:any[]=[];
    const tree=RailInventoryComparisonsPanel({comparisons:envelope,evidence:input,files:[],onSelect:e=>selected.push(e)}),actions=buttons(tree);
    expect(actions).toHaveLength(12);actions.forEach(button=>button.props.onClick());expect(selected).toHaveLength(12);
    selected.forEach((e,i)=>{expect(e).toEqual(railInventoryFragmentEvidence(row,input[i]));expect(e.value).toBe(input[i].fragment.rawText);expect(e.sourceSha256).toBe(input[i].sourceSha256);expect("observationId" in e).toBe(false);});
    expect(input).toEqual(before);selected[0].bbox[0]=9;expect(input).toEqual(before);
  });
});

describe("ODI120 frozen source evidence locators",()=>{
  it("all original coords use source page frame, expected PD and actual RD",()=>{
    for(const e of originalItems){const out=railInventoryFragmentEvidence(row,e);expect(out).not.toBeNull();
      const b=e.fragment.bboxMilliPoints,w=e.pageFrame.widthMilliPoints,h=e.pageFrame.heightMilliPoints;
      expect(out!.bbox).toEqual([b[0]/w,1-b[3]/h,b[2]/w,1-b[1]/h]);expect(out!.stage).toBe(e.role==="EXPECTED"?"PD":"RD");expect(out!.pageNumber).toBe(e.pageNumber);
      expect(out!.bbox!.every(Number.isFinite)).toBe(true);expect(out!.unit).toBeNull();expect(out!.id.length).toBeLessThanOrEqual(80);
    }
  });
  for(const key of ["resultId","sourceFileId","sourceSha256","reviewDecisionId","reviewContentHash","inventoryContentHash"] as const)
    it("rejects mismatched frozen reference "+key,()=>{const e=item();e[key]="wrong";expect(railInventoryFragmentEvidence(row,e)).toBeNull();});
  const changes:Record<string,(e:any)=>void>={
    missingFrame:e=>delete e.pageFrame,missingFragment:e=>delete e.fragment,missingOrigin:e=>e.originCheckId="",foreignRole:e=>e.role="LATEST",foreignFragmentRole:e=>e.fragmentRole="FAKE",
    zeroPage:e=>e.pageNumber=0,tooManyPages:e=>e.pageNumber=513,floatPage:e=>e.pageNumber=1.5,crossPage:e=>e.fragment.pageNumber++,
    zeroWidth:e=>e.pageFrame.widthMilliPoints=0,negativeHeight:e=>e.pageFrame.heightMilliPoints=-1,floatWidth:e=>e.pageFrame.widthMilliPoints=1.2,
    unsafeHeight:e=>e.pageFrame.heightMilliPoints=Number.MAX_SAFE_INTEGER+1,shortBox:e=>e.fragment.bboxMilliPoints=[0,1,2],longBox:e=>e.fragment.bboxMilliPoints=[0,1,2,3,4],
    outsideBox:e=>e.fragment.bboxMilliPoints=[0,0,e.pageFrame.widthMilliPoints+1,2],negativeBox:e=>e.fragment.bboxMilliPoints=[-1,0,1,2],emptyBox:e=>e.fragment.bboxMilliPoints=[0,0,0,2],
    invertedBox:e=>e.fragment.bboxMilliPoints=[0,2,1,1],floatBox:e=>e.fragment.bboxMilliPoints=[0,0,1.5,2],nanBox:e=>e.fragment.bboxMilliPoints=[0,0,NaN,2],
    sparseBox:e=>e.fragment.bboxMilliPoints=[0,,1,2],objectBox:e=>e.fragment.bboxMilliPoints={0:0,1:0,2:1,3:2,length:4},typedBox:e=>e.fragment.bboxMilliPoints=new Int32Array([0,0,1,2]),
    undefinedBox:e=>e.fragment.bboxMilliPoints=[0,undefined,1,2],negativeBlock:e=>e.fragment.blockIndex=-1,floatLine:e=>e.fragment.lineIndex=.5,unsafeLine:e=>e.fragment.lineIndex=Number.MAX_SAFE_INTEGER+1,
    emptyText:e=>e.fragment.rawText="",missingText:e=>delete e.fragment.rawText,
  };
  it.each(Object.entries(changes))("malformed source locator %s produces no viewer target",(_name,change)=>{
    const e=item();change(e);expect(railInventoryFragmentEvidence(row,e)).toBeNull();
  });
  it("noncandidate and unbound typed rows cannot open candidate evidence",()=>{
    expect(railInventoryFragmentEvidence({...row,kind:"UNBOUND_ATOM_ABSTENTION"} as any,item())).toBeNull();
    expect(railInventoryFragmentEvidence({...row,comparison:{status:"ABSTAIN"}} as any,item())).toBeNull();
  });
});
