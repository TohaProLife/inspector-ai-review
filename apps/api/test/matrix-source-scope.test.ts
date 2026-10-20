import {describe,it,expect} from "vitest";
import {matrixSourceScopeSchema,bindMatrixSourceScope} from "@inspector-ai/contracts";
describe("human matrix source scope boundary",()=>{
 const scope={entityKey:"building-A",reference:"Original building identity checked",contexts:{
  BUILDING_SCOPE:{reference:"Original building area context checked"},
  "RULE_SCOPE_COMPLETE:matrix-pz-002-building_total_area":{reference:"Original complete scope checked"},
  "PARAMETER_SCOPE_COMPLETE:PZ-002":{reference:"Original parameter complete scope checked"}}};
 it("accepts actual registry rule IDs and binds provenance only on server",()=>{
  const parsed=matrixSourceScopeSchema.parse(scope);
  const binding={sourceFileId:"source",sourceSha256:"a".repeat(64),objectId:"internal-object",inputManifestHash:"b".repeat(64)};
  expect(bindMatrixSourceScope(parsed,binding)["RULE_SCOPE_COMPLETE:matrix-pz-002-building_total_area"])
   .toMatchObject({...binding,entityKey:"building-A",status:"VERIFIED"});
 });
 it("rejects client provenance/status and malformed context names",()=>{
  for(const bad of [{...scope,objectId:"foreign"},{...scope,contexts:{BUILDING_SCOPE:{reference:"Original checked",status:"VERIFIED"}}},
   {...scope,contexts:{"unknown key":{reference:"Original checked"}}}])expect(matrixSourceScopeSchema.safeParse(bad).success).toBe(false);
 });
 it("does not create proof for missing human scope",()=>expect(bindMatrixSourceScope(null,{sourceFileId:"source",sourceSha256:"a".repeat(64),objectId:"object",inputManifestHash:"b".repeat(64)})).toEqual({}));
 it("preserves reviewed equipment context without accepting provenance from client",()=>{
  const context={reference:"Original pump duty point and zone checked",parameterCode:"IOS2-073",attribute:"PUMP_FLOW_RATE",
   canonicalUnit:"m3/h",componentRole:"POTABLE_WATER_PUMP",componentKey:"pump:P1",zoneKey:"zone-A",
   operatingModeKey:"normal:design-point-1",measurementBasisKey:"volumetric-design-flow"};
  const payload={...scope,contexts:{"ATOMIC_SUBRULE_SCOPE:matrix-ios2-073-pump_flow_rate":context}};
  const parsed=matrixSourceScopeSchema.parse(payload);expect("contexts" in parsed&&parsed.contexts).toEqual(payload.contexts);
  expect(matrixSourceScopeSchema.safeParse({...payload,contexts:{...payload.contexts,
   "ATOMIC_SUBRULE_SCOPE:matrix-ios2-073-pump_flow_rate":{...context,operatingModeKey:" "}}}).success).toBe(false);
 });
});
