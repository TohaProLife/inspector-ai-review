import {readFileSync} from "node:fs";
import React,{createElement,isValidElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
import {WaterNodeComparisonsPanel,waterNodeFragmentEvidence} from "./WaterNodeComparisonsPanel";
const manual=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-water-node-ui-v1/qa-manual-ui-expectations.json",import.meta.url),"utf8"));
const c=manual.cases.find((x:any)=>x.name==="candidate-whole-typed-envelope-and-15-original-actions"),envelope=c.comparisons,row=envelope.results[0];
const render=(extra:any={})=>renderToStaticMarkup(createElement(WaterNodeComparisonsPanel,{comparisons:envelope,evidence:c.evidence,files:[],onSelect:()=>{},...extra}));
function buttons(tree:any):any[]{const out:any[]=[];function walk(n:any){if(!isValidElement(n))return;const e=n as React.ReactElement<any>;if(e.type==="button")out.push(e);React.Children.forEach(e.props.children,walk);}walk(tree);return out;}
describe("ZU129 frozen typed candidate and original evidence",()=>{
 it("renders candidate/null confidence and every original HEADER/SCOPE/END/FEATURE fragment",()=>{
  const text=render();expect(text).toContain("ZU-129 · Кандидат");expect(text).toContain("Уверенность не измерена");expect(c.evidence).toHaveLength(15);
  expect(c.evidence.filter((e:any)=>e.fragmentRole==="SCOPE")).toHaveLength(8);for(const e of c.evidence)expect(text).toContain(e.fragment.rawText);
  expect((text.match(/Открыть оригинал/g)??[])).toHaveLength(15);for(const k of ["entityKey","buildingKey","nodeKey"] as const)expect(text).toContain(row.identity[k]);
  expect(text.replace(/<[^>]*>/g," ")).not.toMatch(/NO_VIOLATION|Нарушений нет|Подтверждённая ошибка|99%|100%/u);
 });
 it("passes all15 exact original actions with source frame and no mutation/scalar facts",()=>{
  const evidence=structuredClone(c.evidence),before=structuredClone(evidence),selected:any[]=[],tree=WaterNodeComparisonsPanel({comparisons:envelope,evidence,files:[],onSelect:e=>selected.push(e)});
  const actions=buttons(tree);expect(actions).toHaveLength(15);expect(selected).toHaveLength(0);actions.forEach(b=>b.props.onClick());expect(selected).toHaveLength(15);
  selected.forEach((out,i)=>{const expected=c.expectedViewerProjections[i];for(const k of ["sourceFileId","sourceSha256","stage","pageNumber","bbox","value","unit"])expect(out[k]).toEqual(expected[k]);expect("observationId" in out).toBe(false);});expect(evidence).toEqual(before);selected[0].bbox[0]=9;expect(evidence).toEqual(before);
 });
 it.each(["UNKNOWN-source-review-no-candidate","unbound-reviewed-node-identity-missing"])("%s never offers candidate or original action",name=>{
  const f=manual.cases.find((x:any)=>x.name===name),text=render({comparisons:f.comparisons,evidence:c.evidence});expect(text).toContain("Кандидатов: 0");expect(text).not.toContain("ZU-129 · Кандидат");expect(text).not.toContain("Открыть оригинал");expect(text).not.toMatch(/Нарушений нет|NO_VIOLATION|99%/u);
 });
 it("forged adjacent confidence cannot promote candidate",()=>{
  const forged=structuredClone(envelope);forged.results[0].comparison.calibratedProbability=.99;forged.results[0].presentation={classification:"ERROR",label:"Подтверждённая ошибка"};const text=render({comparisons:forged});expect(text).toContain("Кандидат");expect(text).toContain("Уверенность не измерена");expect(text).not.toMatch(/99%|ERROR|Подтверждённая ошибка/);
 });
 it("invalid original frame or altered frozen source/review reference provides no viewer target",()=>{
  for(const kind of ["sourceFileId","sourceSha256","reviewDecisionId","reviewContentHash","inventoryContentHash","frame","sparseBox","crossPage"]){const e=structuredClone(c.evidence[0]);if(kind==="frame")e.pageFrame.widthMilliPoints=0;else if(kind==="sparseBox")e.fragment.bboxMilliPoints=[0,,1,2];else if(kind==="crossPage")e.fragment.pageNumber++;else e[kind]="foreign";expect(waterNodeFragmentEvidence(row,e)).toBeNull();const text=render({evidence:[e]});expect(text).not.toContain("Открыть оригинал");}
 });
 it("history without sibling stays absent and SSR triggers no callback",()=>{expect(render({comparisons:undefined})).toBe("");const onSelect=vi.fn();render({onSelect});expect(onSelect).not.toHaveBeenCalled();});
});
