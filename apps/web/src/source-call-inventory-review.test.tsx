import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { callInventoryScopeDecisionToInput, sourceReviewSchema, type MatrixCallInventoryScopeDecision,
  type MatrixCallInventoryScopeInput, type MatrixFactScope, type MatrixObservation,
  type SourceReviewDecision } from "@inspector-ai/contracts";
import { appendCallInventoryPreview, reviseCallInventoryClaim, withdrawCallInventoryClaim,
  validateCallInventoryPreview, SourceCallInventoryReviewFields,
  type CallInventoryHumanInput, type CallInventoryPreview } from "./SourceCallInventoryReviewFields";
import { prepareMatrixFactScopeReviewInput } from "./MatrixFactScopeReview";

const manual=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-call-comparison-v1/research-call-comparison-manual-goldens-v2.json",import.meta.url),"utf8"));
const source=manual.cases[0].input.sources[0];
const saved:MatrixCallInventoryScopeDecision=source.review.callInventoryScope;
const scope=()=>callInventoryScopeDecisionToInput(saved);
const claim=scope().claims[0],inventory=saved.claims[0].inventorySnapshot;
const identity={checkId:claim.target.checkId,sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,reviewHash:source.review.contentHash};
const preview:CallInventoryPreview={checkId:identity.checkId,sourceFileId:identity.sourceFileId,sourceSha256:identity.sourceSha256,
  latestReviewHash:identity.reviewHash,selection:claim.selection,target:claim.target,result:{status:"RECONSTRUCTED",inventory}};
const human=():CallInventoryHumanInput=>({identity:{...claim.identity},reference:claim.reference,sameRoom:false,complete:false});
const props={...identity,value:scope(),onChange:vi.fn(),disabled:false};
const html=(extra:Partial<Parameters<typeof SourceCallInventoryReviewFields>[0]>={})=>renderToStaticMarkup(createElement(SourceCallInventoryReviewFields,{...props,...extra}));
const sha=(s:string)=>s.repeat(64);

describe("source-authored ODI123 room inventory review",()=>{
  it("renders UNKNOWN claims candidly without promoting either human assertion",()=>{
    const x=scope();x.claims[0].assertion="UNKNOWN";x.claims[0].roomMapping.assertion="UNKNOWN";
    const text=html({value:x});
    expect(text).toContain("UNKNOWN: полнота области не установлена");
    expect(text).toContain("Сопоставление комнаты не установлено");
    expect(text).toContain(claim.reference);expect(text).toContain(claim.roomMapping.sourceRoomToken);
    expect(text).not.toContain('checked=""');
  });
  it("separates completeness and room mapping, with native labelled checkboxes",()=>{
    const text=html();expect(text.match(/type="checkbox"/g)).toHaveLength(2);
    expect(text).toContain("той же доступной санитарной комнатой");expect(text).toContain("весь перечень оборудования вызова");
    expect(text).toContain('aria-label="Сохранённая область вызова 1"');
    expect(text).toContain("Отсутствие оборудования в реальном помещении этой формой не доказывается");
    expect(text).not.toContain("confidence");expect(text).not.toContain("вероятность");
  });
  it("no preloaded preview offers no manufactured source selector or add action",()=>{
    const text=html();expect(text).not.toContain("Добавить область вызова");expect(text).toContain("только из проверенного сервером");
    expect(text).not.toContain('type="submit"');
  });
  it("valid preloaded preview preserves all header/scope/end and feature full raw lines",()=>{
    const text=html({value:undefined,preview});
    for(const f of [...inventory.headerFragments,...inventory.scopeFragments,...inventory.endFragments,...inventory.featureRows.flatMap(r=>r.fragments)])
      expect(text).toContain(f.rawText);
    expect(text).toContain("Добавить область вызова в черновик");
  });
  it("ABSTAIN cannot add claims or create completeness",()=>{
    const text=html({value:undefined,preview:{...preview,target:undefined,result:{status:"ABSTAIN",reasonCode:"SCOPE_UNVERIFIED"}}});
    expect(text).toContain("SCOPE_UNVERIFIED");expect(text).not.toContain("Добавить область вызова");expect(text).not.toContain('type="checkbox"');
  });
  it("global disabled state prevents all native fields and actions",()=>expect(html({disabled:true})).toContain('<fieldset disabled=""'));
  it("editor remounts for check/source/SHA/latest CAS changes",()=>{
    const first=SourceCallInventoryReviewFields(props).key;
    for(const change of [{checkId:"different"},{sourceFileId:"different"},{sourceSha256:sha("f")},{reviewHash:null}])
      expect(SourceCallInventoryReviewFields({...props,...change}).key).not.toBe(first);
  });
  for(const field of ["checkId","sourceFileId","sourceSha256","latestReviewHash"] as const)
    it("rejects stale/foreign authenticated preview "+field,()=>{
      const p=structuredClone(preview);if(field==="latestReviewHash")p.latestReviewHash=null;else p[field]="different";
      expect(()=>validateCallInventoryPreview(identity,p)).toThrow(/изменились/u);
    });
  for(const field of ["pageNumber","regionBoxMilliPoints","headerFragments","scopeFragments","endFragments"] as const)
    it("rejects changed selected original locator "+field,()=>{
      const p=structuredClone(preview);
      if(field==="pageNumber")p.selection.pageNumber++;
      else if(field==="regionBoxMilliPoints")p.selection.regionBoxMilliPoints[0]++;
      else p.selection[field][0].rawText+=" changed";
      expect(()=>validateCallInventoryPreview(identity,p)).toThrow();
    });
  it("end locator is required even when primary room text matches",()=>{
    const p=structuredClone(preview);delete (p.selection as any).endFragments;
    expect(()=>validateCallInventoryPreview(identity,p)).toThrow();
  });
  for(const mutation of ["targetCheck","textHash","source","sourceSHA","malformedSnapshot"])
    it("rejects detached target or snapshot "+mutation,()=>{
      const p=structuredClone(preview);if(p.result.status!=="RECONSTRUCTED")throw Error("fixture");
      if(mutation==="targetCheck")p.target!.checkId="other";
      else if(mutation==="textHash")p.target!.textArtifactHash=sha("e");
      else if(mutation==="source")p.result.inventory.sourceFileId="other";
      else if(mutation==="sourceSHA")p.result.inventory.sourceSha256=sha("e");
      else p.result.inventory.widthMilliPoints=1;
      expect(()=>validateCallInventoryPreview(identity,p)).toThrow();
    });
  it("adds only an explicit human identity; new assertions remain UNKNOWN by default",()=>{
    const original=JSON.stringify(preview),h=human(),out=appendCallInventoryPreview(undefined,identity,preview,h);
    expect(out.claims[0].assertion).toBe("UNKNOWN");expect(out.claims[0].roomMapping.assertion).toBe("UNKNOWN");
    expect(out.claims[0].identity).toEqual(h.identity);expect(out.claims[0].roomMapping.sourceRoomToken).toBe(inventory.roomToken);
    expect("inventorySnapshot" in out.claims[0]).toBe(false);expect(JSON.stringify(preview)).toBe(original);
    out.claims[0].selection.headerFragments[0].rawText="detached";expect(preview.selection.headerFragments[0].rawText).not.toBe("detached");
  });
  it.each([[false,false],[true,false],[false,true],[true,true]])("human mapping %s and completeness %s stay independent",(sameRoom,complete)=>{
    const out=appendCallInventoryPreview(undefined,identity,preview,{...human(),sameRoom,complete}).claims[0];
    expect(out.assertion).toBe(complete?"HUMAN_ASSERTED_COMPLETE":"UNKNOWN");
    expect(out.roomMapping.assertion).toBe(sameRoom?"HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM":"UNKNOWN");
  });
  it("missing explicit room identity or malformed reference cannot be saved",()=>{
    const h=human();h.identity.roomKey="";expect(()=>appendCallInventoryPreview(undefined,identity,preview,h)).toThrow();
    expect(()=>appendCallInventoryPreview(undefined,identity,preview,{...human(),reference:"short"})).toThrow();
    expect(()=>appendCallInventoryPreview(undefined,identity,preview,{...human(),reference:" leading reference"})).toThrow();
  });
  it("does not silently replace an existing region, identity or reference",()=>{
    const before=JSON.stringify(scope());expect(()=>appendCallInventoryPreview(scope(),identity,preview,human())).toThrow(/уже есть/u);
    expect(JSON.stringify(scope())).toBe(before);
  });
  it("different honest region stays a competitor rather than merged into room",()=>{
    const p=structuredClone(preview);p.target!.inventoryContentHash=sha("e");
    const out=appendCallInventoryPreview(scope(),identity,p,human());expect(out.claims).toHaveLength(2);
    expect(out.claims[0]).toEqual(claim);expect(out.claims[1].identity).toEqual(claim.identity);
  });
  it("claim revision preserves source locators, raw room token and untouched claims",()=>{
    const x=scope();x.claims.push(structuredClone(claim));x.claims[1].target.inventoryContentHash=sha("e");
    const before=JSON.stringify(x),h=human();h.identity.roomKey="reviewed-room-202";h.reference="Основание перенумерации комнаты проверено";
    const out=reviseCallInventoryClaim(x,0,h);
    expect(out.claims[0].target).toEqual(x.claims[0].target);expect(out.claims[0].selection).toEqual(x.claims[0].selection);
    expect(out.claims[0].roomMapping.sourceRoomToken).toBe(x.claims[0].roomMapping.sourceRoomToken);
    expect(out.claims[0].identity.roomKey).toBe(h.identity.roomKey);expect(out.claims[1]).toEqual(x.claims[1]);
    expect(JSON.stringify(x)).toBe(before);out.claims[1].selection.headerFragments[0].rawText="copied";
    expect(x.claims[1].selection.headerFragments[0].rawText).not.toBe("copied");
  });
  it("explicit final withdrawal keeps present empty sibling",()=>{
    const x=scope(),out=withdrawCallInventoryClaim(x,0);
    expect(out).toEqual({schemaVersion:"matrix-odi123-call-inventory-review-v1",claims:[]});expect(x.claims).toHaveLength(1);
    expect(html({value:out})).toContain("Все области вызова отозваны в черновике");
    expect(()=>withdrawCallInventoryClaim(out,0)).toThrow();expect(()=>reviseCallInventoryClaim(out,0,human())).toThrow();
  });
});

const fact:MatrixObservation={id:sha("1"),sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,stage:"PD",pageNumber:1,
  blockId:"1:0",bbox:{x:.1,y:.1,width:.2,height:.2},rawText:"Класс бетона: В30",value:"В30",unit:"B_CLASS",attribute:"CONCRETE_CLASS",
  entityKey:null,method:"TEXT_LAYER",extractorVersion:"matrix-text-facts-v1",parameterCodes:["KR-055"],sourceFlags:[]};
const matrixScope:MatrixFactScope={schemaVersion:"matrix-fact-scopes-v1",bindings:[]};
const prior:SourceReviewDecision={id:"review",objectId:"OBJ",sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,
  revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",sectionCode:null,linkGroupId:null,pageStages:{},basis:{reference:"Original source basis"},
  actorId:"reviewer",contentHash:sha("a"),createdAt:"2026-10-18T00:00:00Z",callInventoryScope:saved,
  inventoryScope:{schemaVersion:"matrix-inventory-review-v1",claims:[]}};
const prepared=(p:SourceReviewDecision)=>prepareMatrixFactScopeReviewInput({objectId:"OBJ",fact,prior:p,scope:matrixScope,
  basisReference:"New explicit fact scope basis",canReview:true,replaceLegacyConfirmed:false});
describe("whole source-review request preservation",()=>{
  it("parent contract accepts call request but rejects server decision echo",()=>{
    const out=prepared(prior);expect(sourceReviewSchema.parse(out).callInventoryScope).toEqual(scope());
    expect(()=>sourceReviewSchema.parse({...out,callInventoryScope:saved})).toThrow();
  });
  it("fact review preserves both siblings, metadata and mandatory CAS with deep request projection",()=>{
    const before=JSON.stringify(prior),out=prepared(prior);
    expect(out.callInventoryScope).toEqual(scope());expect(out.inventoryScope).toEqual(prior.inventoryScope);
    expect(out.expectedReviewHash).toBe(prior.contentHash);expect(out.revisionStatus).toBe("UNKNOWN");expect(out.approvalStatus).toBe("UNKNOWN");
    expect("inventorySnapshot" in out.callInventoryScope!.claims[0]).toBe(false);
    out.callInventoryScope!.claims[0].selection.headerFragments[0].rawText="copy";expect(JSON.stringify(prior)).toBe(before);
  });
  it("explicit empty call scope is preserved through unrelated fact review",()=>{
    const p=structuredClone(prior);p.callInventoryScope={schemaVersion:"matrix-odi123-call-inventory-review-v1",claims:[]};
    expect(prepared(p).callInventoryScope).toEqual(p.callInventoryScope);
  });
  it("omitted call sibling remains absent in legacy request",()=>{
    const p=structuredClone(prior);delete p.callInventoryScope;const out=prepared(p);
    expect(Object.hasOwn(out,"callInventoryScope")).toBe(false);expect(out.expectedReviewHash).toBe(prior.contentHash);
  });
});
