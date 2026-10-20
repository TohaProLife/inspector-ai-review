import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { matrixSourceScopeSchema } from "@inspector-ai/contracts";
import registry from "../../../services/worker/rules/matrix-execution-v1.json";
import { MatrixSourceScopeFields, prepareMatrixSourceScope } from "./MatrixSourceScopeFields";

type Input=Parameters<typeof prepareMatrixSourceScope>[0];
const rules=registry.entries.find(entry=>entry.parameterCode==="IOS2-073")!.atomicRules;
const flow=rules.find(rule=>rule.attribute==="PUMP_FLOW_RATE")!;
const head=rules.find(rule=>rule.attribute==="PUMP_HEAD")!;
const key=(rule:{ruleId:string})=>`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`;
const completeKey=(rule:{ruleId:string})=>`RULE_SCOPE_COMPLETE:${rule.ruleId}`;
const identity={componentKey:"pump:P1",zoneKey:"zone-A",operatingModeKey:"normal:point-1",
  measurementBasisKey:"design-working-point-1"};
const both=()=>({[flow.ruleId]:{...identity},[head.ruleId]:{...identity}});
function input(atomicContexts:Input["atomicContexts"],overrides:Partial<Input>={}):Input {
  return {value:undefined,entityKey:"building-A",reference:"Original pump position and working point checked",
    parameterCode:"IOS2-073",rules,atomicContexts,complete:false,drawingSection:"",limit:"",...overrides};
}

describe("independent atomic source-scope judgments",()=>{
  it("allows one fully reviewed atom without asserting the unreviewed atom",()=>{
    const prepared=prepareMatrixSourceScope(input({[flow.ruleId]:{...identity}}))!;
    expect(matrixSourceScopeSchema.safeParse(prepared).success).toBe(true);
    expect(prepared.contexts[key(flow)]).toMatchObject({...identity,componentRole:"POTABLE_WATER_PUMP",
      parameterCode:"IOS2-073",attribute:"PUMP_FLOW_RATE",canonicalUnit:"m3/h"});
    expect(prepared.contexts[key(head)]).toBeUndefined();
    expect(prepared.contexts[completeKey(flow)]).toBeUndefined();
    expect(prepared.contexts["PARAMETER_SCOPE_COMPLETE:IOS2-073"]).toBeUndefined();
  });

  it("blocks partial identity and an entirely unreviewed parameter",()=>{
    expect(prepareMatrixSourceScope(input({}))).toBeUndefined();
    expect(prepareMatrixSourceScope(input({[flow.ruleId]:{componentKey:"pump:P1"}}))).toBeUndefined();
    expect(prepareMatrixSourceScope(input({[flow.ruleId]:{...identity},
      [head.ruleId]:{componentKey:"pump:P1",zoneKey:" "}}))).toBeUndefined();
  });

  it("grants completeness only to ready atoms; full parameter requires all atoms",()=>{
    const partial=prepareMatrixSourceScope(input({[flow.ruleId]:{...identity}},{complete:true}))!;
    expect(partial.contexts[completeKey(flow)]).toBeDefined();
    expect(partial.contexts[completeKey(head)]).toBeUndefined();
    expect(partial.contexts["PARAMETER_SCOPE_COMPLETE:IOS2-073"]).toBeUndefined();
    const full=prepareMatrixSourceScope(input(both(),{complete:true}))!;
    expect(full.contexts[completeKey(flow)]).toBeDefined();
    expect(full.contexts[completeKey(head)]).toBeDefined();
    expect(full.contexts["PARAMETER_SCOPE_COMPLETE:IOS2-073"]).toBeDefined();
  });

  it("changing component and zone drops old atom proofs and unchecked completeness",()=>{
    const previous=prepareMatrixSourceScope(input(both(),{complete:true}))!;
    previous.contexts["RULE_SCOPE_COMPLETE:another-rule"]={reference:"Another parameter original scope checked"};
    const before=structuredClone(previous);
    const changed={...identity,componentKey:"pump:P2",zoneKey:"zone-B"};
    const prepared=prepareMatrixSourceScope(input({[flow.ruleId]:changed},{value:previous,
      reference:"Original P2 zone B separately checked",complete:false}))!;
    expect(prepared.contexts[key(flow)]).toMatchObject(changed);
    expect(prepared.contexts[key(head)]).toBeUndefined();
    expect(prepared.contexts[completeKey(flow)]).toBeUndefined();
    expect(prepared.contexts[completeKey(head)]).toBeUndefined();
    expect(prepared.contexts["PARAMETER_SCOPE_COMPLETE:IOS2-073"]).toBeUndefined();
    expect(prepared.contexts["RULE_SCOPE_COMPLETE:another-rule"]).toEqual(previous.contexts["RULE_SCOPE_COMPLETE:another-rule"]);
    expect(previous).toEqual(before);
  });

  it("unchecking completeness removes previous decisions even with unchanged identities",()=>{
    const previous=prepareMatrixSourceScope(input(both(),{complete:true}))!;
    const prepared=prepareMatrixSourceScope(input(both(),{value:previous,complete:false}))!;
    expect(prepared.contexts[key(flow)]).toBeDefined();
    expect(prepared.contexts[key(head)]).toBeDefined();
    expect(Object.keys(prepared.contexts).some(key=>key.startsWith("RULE_SCOPE_COMPLETE:"))).toBe(false);
    expect(prepared.contexts["PARAMETER_SCOPE_COMPLETE:IOS2-073"]).toBeUndefined();
  });

  it("clears all old provenance when entity changes and explains partial input in UI",()=>{
    const previous=prepareMatrixSourceScope(input(both(),{complete:true}))!;
    previous.contexts["RULE_SCOPE_COMPLETE:another-rule"]={reference:"Another parameter original scope checked"};
    const prepared=prepareMatrixSourceScope(input({[flow.ruleId]:{...identity}},{value:previous,entityKey:"building-B"}))!;
    expect(prepared.entityKey).toBe("building-B");
    expect(prepared.contexts["RULE_SCOPE_COMPLETE:another-rule"]).toBeUndefined();
    const html=renderToStaticMarkup(createElement(MatrixSourceScopeFields,{value:undefined,onChange:()=>{},disabled:false}));
    expect(html).toContain("условия заполненных правил");
    expect(html).toContain("Полнота параметра подтверждается только при заполнении всех его правил");
  });
});
