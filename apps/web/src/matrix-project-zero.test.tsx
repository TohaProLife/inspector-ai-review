import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixObservation, MatrixFactScopeTarget, SourceFileSummary, SourceReviewDecision } from "@inspector-ai/contracts";
import { MatrixFactScopeEditor, emptyMatrixFactScopeDraft, prepareMatrixFactScope } from "./MatrixFactScopeEditor";
import { MatrixFactContext, matrixFactEvidence } from "./MatrixExecutionPanel";
import { loadMatrixFactScopeReview, prepareMatrixFactScopeReviewInput } from "./MatrixFactScopeReview";
import { api } from "./api";
import { PROJECT_ZERO_AUTHORITY as key, PROJECT_ZERO_RULE as rule, PROJECT_ZERO_BASIS as basis,
  ownProjectZeroAuthority, projectZeroAuthorityOptions } from "./matrix-project-zero-authority";
const h=(c:string)=>c.repeat(64), reference="Исходная строка и геодезическое основание проверены";
const pd:MatrixObservation={id:h("1"),sourceFileId:"PD",sourceSha256:h("a"),stage:"PD",pageNumber:13,
  blockId:"0:8",bbox:{x:.1,y:.2,width:.5,height:.04},rawText:"За относительную отметку 0,000 принята абсолютная отметка 159,95 м.",
  attribute:"PROJECT_ZERO_ABSOLUTE_ELEVATION",value:"159.95",unit:"m",entityKey:null,method:"TEXT_LAYER",
  extractorVersion:"matrix-text-facts-v1",parameterCodes:["PZ-009"],sourceFlags:["SOURCE_APPROVAL_UNKNOWN"]};
const rd:MatrixObservation={...pd,id:h("2"),sourceFileId:"RD",sourceSha256:h("b"),stage:"RD",pageNumber:4,
  blockId:"40:0",rawText:"За относительную отметку ±0.000 принята отметка чистого пола первого этажа, соответствующая абсолютной отметке 159.95.",
  contextFragments:[{pageNumber:4,blockId:"32:18",rawText:"Все размеры даны в миллиметрах,",role:"UNIT_DECLARATION",bbox:{x:.04,y:.62,width:.4,height:.01}},
    {pageNumber:4,blockId:"32:19",rawText:"отметки - в метрах.",role:"UNIT_DECLARATION",bbox:{x:.04,y:.64,width:.04,height:.01}}]};
const target=(fact:MatrixObservation):MatrixFactScopeTarget=>({checkId:"CHK-PZ",executionContentHash:h("c"),
  observationId:fact.id,evidenceHash:h("d"),textArtifactHash:fact.stage==="PD"?h("e"):h("f")});
const file:SourceFileSummary={id:"PD",name:"Пояснительная записка.pdf",sha256:pd.sourceSha256,size:891618,
  stages:["PD"],pageCount:13,registeredAt:"2026-10-18T00:00:00Z",review:null};
const pdAuthority=ownProjectZeroAuthority(pd,target(pd));
const review:SourceReviewDecision={id:"review",objectId:"OBJ",sourceFileId:"PD",sourceSha256:pd.sourceSha256,
  revisionStatus:"CURRENT",approvalStatus:"APPROVED",sectionCode:"PZ",linkGroupId:"building-1",pageStages:{},
  actorId:"reviewer",createdAt:"2026-10-18T00:00:00Z",contentHash:h("0"),basis:{reference},
  matrixScope:{schemaVersion:"matrix-fact-scopes-v1",bindings:[{ruleId:rule,ruleVersion:"1",parameterCode:"PZ-009",
    entityKey:"building-1",reference,target:target(pd),contexts:{[key]:{reference,projectZeroAuthority:pdAuthority}}}]}};
const options=()=>projectZeroAuthorityOptions("OBJ",file,review);
function draft(){return {...emptyMatrixFactScopeDraft(rule),entityKey:"building-1",reference,identityReviewed:true,
  identity:{componentKey:"building-1",zoneKey:"vestibule-floor-1-common-zero",operatingModeKey:"explicit-datum-review",measurementBasisKey:basis},
  contexts:{[key]:{reviewed:true,reference},APPROVED_CHANGE_STATUS:{reviewed:true,reference,approvedChangeStatus:"ABSENT" as const},
    [`ATOMIC_SUBRULE_SCOPE:${rule}`]:{reviewed:true,reference}}};}
afterEach(()=>vi.restoreAllMocks());
describe("declared project zero review",()=>{
  it("derives an own original PD target without a circular review hash",()=>{
    const prepared=prepareMatrixFactScope({fact:pd,target:target(pd),draft:draft()});
    expect(prepared.error).toBeNull();
    expect(prepared.scope!.bindings[0].contexts[key].projectZeroAuthority).toEqual(pdAuthority);
    expect(pdAuthority).not.toHaveProperty("reviewContentHash");
    expect(prepared.scope!.bindings[0].contexts[`ATOMIC_SUBRULE_SCOPE:${rule}`]).toMatchObject({componentRole:"PROJECT_ZERO_DATUM",measurementBasisKey:basis});
  });
  it("does not accept a prose reference instead of a selected saved PD authority for RD",()=>{
    expect(prepareMatrixFactScope({fact:rd,target:target(rd),draft:draft()}).scope).toBeNull();
    const selected={...draft(),contexts:{...draft().contexts,[key]:{reviewed:true,reference,projectZeroAuthorityKey:options()[0].key}}};
    const prepared=prepareMatrixFactScope({fact:rd,target:target(rd),draft:selected,projectZeroAuthorities:options()});
    expect(prepared.error).toBeNull();
    expect(prepared.scope!.bindings[0].contexts[key].projectZeroAuthority).toEqual({...pdAuthority,reviewContentHash:review.contentHash});
    expect(prepareMatrixFactScope({fact:rd,target:target(rd),draft:selected,projectZeroAuthorities:[]}).scope).toBeNull();
    const changed=projectZeroAuthorityOptions("OBJ",file,{...review,contentHash:h("9")});
    expect(prepareMatrixFactScope({fact:rd,target:target(rd),draft:selected,projectZeroAuthorities:changed}).scope).toBeNull();
  });
  it("requires the reviewed finished-floor basis and never infers a named vertical datum",()=>{
    expect(prepareMatrixFactScope({fact:pd,target:target(pd),draft:{...draft(),identity:{...draft().identity,measurementBasisKey:"same-number"}}}).scope).toBeNull();
    const html=renderToStaticMarkup(createElement(MatrixFactScopeEditor,{fact:pd,target:target(pd),onChange:()=>{}}));
    expect(html).toContain("Высотная система и datum");expect(html).toContain("автоматически не отождествляются");
    expect(html).toContain("Контрольные точки и независимая геопривязка здесь не подтверждаются");
    expect(html).not.toContain("Балтийская");expect(html).not.toContain('checked=""');
  });
  it("offers only explicit exact original claims from current approved PD reviews",()=>{
    expect(options()).toHaveLength(1);
    for(const invalid of [{...review,revisionStatus:"UNKNOWN" as const},{...review,approvalStatus:"UNKNOWN" as const},
      {...review,objectId:"foreign"},{...review,sourceSha256:h("9")},{...review,matrixScope:undefined},
      {...review,matrixScope:{entityKey:"building-1",reference,contexts:{[key]:{reference}}}}])
      expect(projectZeroAuthorityOptions("OBJ",file,invalid)).toEqual([]);
    for(const field of ["checkId","executionContentHash","observationId","evidenceHash","textArtifactHash"] as const){
      const changed=structuredClone(review);if(!changed.matrixScope||!("bindings" in changed.matrixScope))throw Error("fixture");
      changed.matrixScope.bindings[0].contexts[key].projectZeroAuthority!.target[field]=field==="checkId"?"other":h("8");
      expect(projectZeroAuthorityOptions("OBJ",file,changed)).toEqual([]);
    }
    expect(projectZeroAuthorityOptions("OBJ",{...file,stages:["RD"]},review)).toEqual([]);
    expect(projectZeroAuthorityOptions("OBJ",file,{...review,pageStages:{"13":"RD"}})).toEqual([]);
  });
  it("keeps source UNKNOWN while storing an explicit authority classification",()=>{
    const scope=prepareMatrixFactScope({fact:pd,target:target(pd),draft:draft()}).scope!;
    const prepared=prepareMatrixFactScopeReviewInput({objectId:"OBJ",fact:pd,prior:null,scope,basisReference:reference,
      canReview:true,replaceLegacyConfirmed:false});
    expect(prepared).toMatchObject({revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",expectedReviewHash:null,matrixScope:scope});
  });
  it("opens each original unit note independently without expanding the value frame or claiming table review",()=>{
    const before=structuredClone(rd),primary=matrixFactEvidence(rd);
    const html=renderToStaticMarkup(createElement(MatrixFactContext,{fact:rd,onSelect:()=>{}}));
    expect(html).toContain("Единицы абсолютных отметок");expect(html).not.toContain("Область таблицы");
    for(const fragment of rd.contextFragments!){const evidence=matrixFactEvidence(rd,fragment);
      expect(evidence).toMatchObject({sourceFileId:rd.sourceFileId,sourceSha256:rd.sourceSha256,pageNumber:4,value:fragment.rawText,
        element:"Единицы абсолютных отметок из исходного листа"});expect(evidence.bbox).not.toEqual(primary.bbox);}
    const editor=renderToStaticMarkup(createElement(MatrixFactScopeEditor,{fact:rd,target:target(rd),projectZeroAuthorities:options(),onChange:()=>{}}));
    expect(editor).toContain("Основание ПД");expect(editor).toContain(file.name);
    expect(editor).not.toContain("Связь строки с контекстом таблицы");expect(rd).toEqual(before);
  });
  it("loads PD decisions only for this RD attribute and carries the same abort signal",async()=>{
    const signal=new AbortController().signal;
    vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue({checkId:"CHK-PZ",executionContentHash:h("c"),items:[{sourceFileId:"RD",target:target(rd)}]});
    const read=vi.spyOn(api,"getSourceReview").mockImplementation(async(_object,source)=>source==="PD"?review:null);
    const loaded=await loadMatrixFactScopeReview({objectId:"OBJ",checkId:"CHK-PZ",executionContentHash:h("c"),fact:rd,projectZeroSources:[file],signal});
    expect(loaded.projectZeroAuthorities).toEqual(options());expect(read).toHaveBeenCalledWith("OBJ","PD",signal);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
