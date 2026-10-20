import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,describe,expect,it,vi} from "vitest";
import {waterNodeScopeDecisionToInput,sourceReviewSchema,type MatrixWaterNodeScopeInput} from "@inspector-ai/contracts";
import {appendWaterNodePreview,reviseWaterNodeClaim,withdrawWaterNodeClaim,validateWaterNodePreview,
 SourceWaterNodeReviewFields,type WaterNodeHumanInput,type WaterNodePreview} from "./SourceWaterNodeReviewFields";

const manual=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-water-node-ui-v1/qa-manual-ui-expectations.json",import.meta.url),"utf8"));
const prior=manual.cases.find((c:any)=>c.name==="full-review-CAS-and-all-sibling-preservation").prior;
const source={sourceFileId:prior.sourceFileId,sourceSha256:prior.sourceSha256,review:prior},saved=prior.waterNodeScope;
const scope=():MatrixWaterNodeScopeInput=>waterNodeScopeDecisionToInput(saved),claim=scope().claims[0],inventory=saved.claims[0].inventorySnapshot;
const identity={checkId:claim.target.checkId,sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,reviewHash:source.review.contentHash};
const preview:WaterNodePreview={checkId:identity.checkId,sourceFileId:identity.sourceFileId,sourceSha256:identity.sourceSha256,latestReviewHash:identity.reviewHash,
 selection:claim.selection,target:claim.target,result:{schemaVersion:"matrix-zu129-water-node-source-result-v1",status:"RECONSTRUCTED",inventory}};
const human=():WaterNodeHumanInput=>({identity:{...claim.identity},reference:"SYNTHETIC ONLY: independent reviewed node and declared source region",sameNode:false,complete:false});
const props={...identity,value:scope(),disabled:false,onChange:vi.fn()};
const html=(extra:any={})=>renderToStaticMarkup(createElement(SourceWaterNodeReviewFields,{...props,...extra}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("ZU129 explicit water-node source review",()=>{
 it("uses original complete four-scope preview without inferring any human assertion",()=>{
  const before=JSON.stringify(preview),out=validateWaterNodePreview(identity,preview);
  expect(out).toEqual({inventory,target:claim.target,selection:claim.selection});expect(out.inventory.scopeFragments).toHaveLength(4);
  expect(out.inventory.scopeFragments.map(f=>f.rawText)).toEqual(["Здание: Б-101","Вводной узел: ВУ-101","Система: ХВС","Назначение: общедомовой учёт"]);
  expect(JSON.stringify(preview)).toBe(before);
 });
 it.each([[false,false],[true,false],[false,true],[true,true]])("mapping %s and complete %s are separate explicit choices",(sameNode,complete)=>{
  const h={...human(),sameNode,complete},out=appendWaterNodePreview(undefined,identity,preview,h);
  expect(out).toEqual({schemaVersion:"matrix-zu129-water-node-review-v1",claims:[{target:claim.target,selection:claim.selection,identity:h.identity,
   nodeMapping:{kind:"HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING",sourceBuildingToken:"Б-101",sourceNodeToken:"ВУ-101",assertion:sameNode?"HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE":"UNKNOWN"},
   assertion:complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN",reference:h.reference}]});
  expect("inventorySnapshot" in out.claims[0]).toBe(false);out.claims[0].selection.scopeFragments[0].rawText="detached";expect(preview.selection.scopeFragments[0].rawText).toBe("Здание: Б-101");
 });
 it.each(["entityKey","buildingKey","nodeKey"] as const)("identity edit %s revokes both attestations even with true supplied flags",key=>{
  const original=scope(),before=structuredClone(original),h={...human(),sameNode:true,complete:true};h.identity[key]="Новый-узел-😀-甲";
  const out=reviseWaterNodeClaim(original,0,h),next=out.claims[0];expect(next.identity).toEqual(h.identity);expect(next.assertion).toBe("UNKNOWN");expect(next.nodeMapping.assertion).toBe("UNKNOWN");
  expect(next.target).toEqual(claim.target);expect(next.selection).toEqual(claim.selection);expect(next.nodeMapping.sourceBuildingToken).toBe("Б-101");expect(next.nodeMapping.sourceNodeToken).toBe("ВУ-101");expect(original).toEqual(before);
  const reconfirm=reviseWaterNodeClaim(out,0,h).claims[0];expect(reconfirm.assertion).toBe("HUMAN_ASSERTED_COMPLETE");expect(reconfirm.nodeMapping.assertion).toBe("HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE");
 });
 it("same identity revision retains independent chosen UNKNOWN values and exact Unicode/reference",()=>{
  const h=human();h.reference="Основание & исходная строка\u202f😀 проверены человеком";
  const out=reviseWaterNodeClaim(scope(),0,h).claims[0];expect(out.identity).toEqual(h.identity);expect(out.reference).toBe(h.reference);expect(out.assertion).toBe("UNKNOWN");expect(out.nodeMapping.assertion).toBe("UNKNOWN");
 });
 it("does not replace duplicate inventory or collapse two competing regions",()=>{
  const original=scope(),before=structuredClone(original);expect(()=>appendWaterNodePreview(original,identity,preview,human())).toThrow();expect(original).toEqual(before);
  const other=structuredClone(preview);other.target!.inventoryContentHash="f".repeat(64);
  const out=appendWaterNodePreview(original,identity,other,human());expect(out.claims).toHaveLength(2);expect(out.claims[0]).toEqual(original.claims[0]);expect(out.claims[1].identity).toEqual(claim.identity);
 });
 it("rejects seventeenth claim without truncating previous sixteen",()=>{
  const original=scope();original.claims=Array.from({length:16},(_,i)=>({...structuredClone(claim),target:{...claim.target,inventoryContentHash:i.toString(16).padStart(64,"0")}}));
  const p=structuredClone(preview);p.target!.inventoryContentHash="f".repeat(64);const before=structuredClone(original);
  expect(()=>appendWaterNodePreview(original,identity,p,human())).toThrow();expect(original).toEqual(before);
 });
 it.each(["emptyNode","shortReference","trimmedReference"])("rejects invalid human draft %s",kind=>{
  const h=human();if(kind==="emptyNode")h.identity.nodeKey="";else h.reference=kind==="shortReference"?"short":" leading reference";
  expect(()=>appendWaterNodePreview(undefined,identity,preview,h)).toThrow();
 });
 for(const field of ["checkId","sourceFileId","sourceSha256","latestReviewHash"] as const)it("rejects stale preview "+field,()=>{
  const p=structuredClone(preview);p[field]="foreign";expect(()=>validateWaterNodePreview(identity,p)).toThrow();
 });
 for(const field of ["headerFragments","scopeFragments","endFragments"] as const)it("exact original "+field+" cannot change",()=>{
  const p=structuredClone(preview);p.selection[field][0].rawText+=" changed";expect(()=>validateWaterNodePreview(identity,p)).toThrow();
 });
 it("missing fourth scope cannot become a supported preview",()=>{
  const p=structuredClone(preview);p.selection.scopeFragments.pop();expect(()=>validateWaterNodePreview(identity,p)).toThrow();
 });
 it("explicit final withdrawal is present empty scope; other claims and inputs detached",()=>{
  const original=scope();expect(withdrawWaterNodeClaim(original,0)).toEqual({schemaVersion:"matrix-zu129-water-node-review-v1",claims:[]});expect(original.claims).toHaveLength(1);
  expect(()=>withdrawWaterNodeClaim({schemaVersion:"matrix-zu129-water-node-review-v1",claims:[]},0)).toThrow();
  expect(()=>reviseWaterNodeClaim(original,99,human())).toThrow();
 });
 it("request projection strips only server snapshots and preserves all sibling forms/CAS",()=>{
  const basis={reference:"SYNTHETIC ONLY: original review basis"},waterNodeScope=scope();
  const request={sourceSha256:source.sourceSha256,revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",sectionCode:null,linkGroupId:null,pageStages:{},basis,expectedReviewHash:source.review.contentHash,
   matrixScope:{schemaVersion:"matrix-fact-scopes-v1",bindings:[]},inventoryScope:{schemaVersion:"matrix-inventory-review-v1",claims:[]},callInventoryScope:{schemaVersion:"matrix-odi123-call-inventory-review-v1",claims:[]},railInventoryScope:{schemaVersion:"matrix-odi120-rail-inventory-review-v1",claims:[]},waterNodeScope};
  expect(sourceReviewSchema.parse(request)).toEqual(request);expect(()=>sourceReviewSchema.parse({...request,waterNodeScope:saved})).toThrow();
  expect(JSON.stringify(waterNodeScope)).not.toContain("inventorySnapshot");waterNodeScope.claims[0].selection.scopeFragments[0].rawText="detached";expect(saved.claims[0].inventorySnapshot.scopeFragments[0].rawText).toBe("Здание: Б-101");
 });
 it("new source preview shows all eight literal PD lines and unselected human checkboxes",()=>{
  const text=html({value:undefined,preview});for(const f of [...inventory.headerFragments,...inventory.scopeFragments,...inventory.featureRows.flatMap((r:any)=>r.fragments),...inventory.endFragments])expect(text).toContain(f.rawText);
  expect(text.match(/type="checkbox"/g)).toHaveLength(2);expect(text).not.toContain('checked=""');expect(text).not.toContain('type="submit"');expect(text).not.toContain("99%");
 });
 it("stored UNKNOWN is honest; missing preview and ABSTAIN never offer manufactured add",()=>{
  const unknown=scope();unknown.claims[0].assertion="UNKNOWN";unknown.claims[0].nodeMapping.assertion="UNKNOWN";
  const text=html({value:unknown});expect(text).toContain("UNKNOWN");expect(text).toContain(claim.nodeMapping.sourceBuildingToken);expect(text).toContain(claim.nodeMapping.sourceNodeToken);expect(text).not.toContain('checked=""');
  const abstain=html({value:undefined,preview:{...preview,target:undefined,result:{schemaVersion:"matrix-zu129-water-node-source-result-v1",status:"ABSTAIN",reasonCode:"SCOPE_UNVERIFIED"}}});
  expect(abstain).toContain("SCOPE_UNVERIFIED");expect(abstain).not.toContain('type="checkbox"');
 });
 it("SSR performs no fetch or mutation and native disabled state is explicit",()=>{
  const fetch=vi.fn(),change=vi.fn();vi.stubGlobal("fetch",fetch);const text=html({disabled:true,onChange:change});expect(text).toContain('disabled=""');expect(fetch).not.toHaveBeenCalled();expect(change).not.toHaveBeenCalled();
 });
 it("check/source/SHA/reviewHash changes reset editor key, without claiming mounted DOM",()=>{
  const key=SourceWaterNodeReviewFields(props).key;for(const change of [{checkId:"changed"},{sourceFileId:"changed"},{sourceSha256:"f".repeat(64)},{reviewHash:null}])expect(SourceWaterNodeReviewFields({...props,...change}).key).not.toBe(key);
 });
});
