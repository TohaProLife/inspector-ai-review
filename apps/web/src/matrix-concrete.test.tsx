import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixObservation, MatrixFactScopeTarget } from "@inspector-ai/contracts";
import { MatrixFactScopeEditor, emptyMatrixFactScopeDraft, prepareMatrixFactScope } from "./MatrixFactScopeEditor";
import { MatrixFactContext, matrixFactEvidence } from "./MatrixExecutionPanel";
const h=(c:string)=>c.repeat(64),rule="matrix-kr-055-concrete_class",reference="Проверены одинаковая несущая лестничная конструкция и класс прочности";
const fact:MatrixObservation={id:h("1"),sourceFileId:"RD",sourceSha256:h("a"),stage:"RD",pageNumber:4,blockId:"44:0",
  bbox:{x:.1,y:.3,width:.5,height:.02},rawText:"Класс бетона по прочности для лестничных маршей и площадок - В25, F150, W6, П4.",rawValue:"В25",rawUnit:"B_CLASS",attribute:"CONCRETE_CLASS",value:"В25",unit:"B_CLASS",entityKey:null,
  method:"TEXT_LAYER",extractorVersion:"matrix-text-facts-v1",parameterCodes:["KR-055"],contextFragments:[{pageNumber:4,blockId:"1:3",rawText:"Внутренние монолитные лестницы подземной части",bbox:{x:.05,y:.05,width:.6,height:.02},role:"MATERIAL_SCOPE"}]};
const target:MatrixFactScopeTarget={checkId:"CHK",executionContentHash:h("b"),observationId:fact.id,evidenceHash:h("c"),textArtifactHash:h("d")};
function draft(){return {...emptyMatrixFactScopeDraft(rule),entityKey:"stair-member",reference,identityReviewed:true,
  identity:{componentKey:"stair-member",zoneKey:"corps1-underground-stair",operatingModeKey:"CAST_IN_PLACE_LOAD_BEARING_STAIR",measurementBasisKey:"CONCRETE_COMPRESSIVE_STRENGTH_CLASS"},
  contexts:Object.fromEntries(["ELEMENT_IDENTITY","MATERIAL_CLASS_BASIS"].map(key=>[key,{reviewed:true,reference}]))};}
describe("concrete staircase fact scope",()=>{
  it("records exact structural identity and compressive-strength basis",()=>{
    const prepared=prepareMatrixFactScope({fact,target,draft:draft()});expect(prepared.error).toBeNull();
    const contexts=prepared.scope!.bindings[0].contexts;
    expect(contexts.ELEMENT_IDENTITY).toMatchObject({componentRole:"MONOLITHIC_LOAD_BEARING_STAIR",...draft().identity});
    expect(contexts.MATERIAL_CLASS_BASIS).toMatchObject({attribute:"CONCRETE_CLASS",canonicalUnit:"B_CLASS",measurementBasisKey:"CONCRETE_COMPRESSIVE_STRENGTH_CLASS"});
    for(const change of [{componentKey:""},{zoneKey:""},{operatingModeKey:"ASSEMBLY"},{measurementBasisKey:"REBAR_GRADE"}]){
      const d=draft();expect(prepareMatrixFactScope({fact,target,draft:{...d,identity:{...d.identity,...change}}}).scope).toBeNull();
    }
  });
  it("keeps partial drafts saveable without inventing missing contexts",()=>{const d=draft();d.contexts.ELEMENT_IDENTITY.reviewed=false;
    const s=prepareMatrixFactScope({fact,target,draft:d}).scope!;expect(s.bindings[0].contexts).not.toHaveProperty("ELEMENT_IDENTITY");});
  it("uses concrete source context labels without inferring approval",()=>{
    const contextHtml=renderToStaticMarkup(createElement(MatrixFactContext,{fact,onSelect:()=>{}}));
    expect(contextHtml).toContain("Область применения бетона");expect(contextHtml).not.toContain("арматуры");
    expect(matrixFactEvidence(fact,fact.contextFragments![0]).element).toBe("Применимость класса бетона из исходного листа");
    const html=renderToStaticMarkup(createElement(MatrixFactScopeEditor,{fact,target,onChange:()=>{}}));
    for(const label of ["Лестничная конструкция или согласованная группа","Корпус и зона лестницы","Назначение несущей лестницы","Основание класса бетона"])expect(html).toContain(label);
    expect(html).not.toContain('checked=""');
  });
  it("does not offer table confirmation for prose material headers",()=>{
    const pd={...fact,stage:"PD" as const,contextFragments:[{...fact.contextFragments![0],pageNumber:49,blockId:"10:0",role:"ATTRIBUTE_HEADER" as const},...fact.contextFragments!]};
    const html=renderToStaticMarkup(createElement(MatrixFactScopeEditor,{fact:pd,target,fragmentsHash:h("e"),onChange:()=>{}}));
    expect(html).not.toContain("Связь строки с контекстом таблицы");
    expect(prepareMatrixFactScope({fact:pd,target,fragmentsHash:h("e"),draft:{...draft(),tableContextReviewed:true,tableContextReference:reference}}).scope).toBeNull();
  });
});
