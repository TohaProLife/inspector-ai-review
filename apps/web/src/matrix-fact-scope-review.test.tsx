import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { MatrixFactScope, MatrixFactScopeTarget, MatrixObservation, SourceReviewDecision } from "@inspector-ai/contracts";
import { api } from "./api";
import { loadMatrixFactScopeReview, prepareMatrixFactScopeReviewInput, saveMatrixFactScopeReview } from "./MatrixFactScopeReview";

const hash = (c:string) => c.repeat(64);
const fact:MatrixObservation = { id:hash("1"), sourceFileId:"source-PD", sourceSha256:hash("a"), stage:"PD",
  pageNumber:2, blockId:"1:0", bbox:{x:.1,y:.2,width:.3,height:.1}, rawText:"Класс бетона: В40",
  value:"В40", unit:"B_CLASS", attribute:"CONCRETE_CLASS", entityKey:null, method:"TEXT_LAYER",
  extractorVersion:"matrix-text-facts-v1", parameterCodes:["KR-055"], sourceFlags:["SOURCE_APPROVAL_UNKNOWN"] };
const target:MatrixFactScopeTarget = {checkId:"check-1",executionContentHash:hash("b"),observationId:fact.id,
  evidenceHash:hash("c"),textArtifactHash:hash("d")};
const scope:MatrixFactScope = {schemaVersion:"matrix-fact-scopes-v1",bindings:[{
  ruleId:"matrix-kr-055-concrete_class",ruleVersion:"1",parameterCode:"KR-055",entityKey:"slab-1",
  reference:"Позиция и оси плиты проверены по исходному листу",target,contexts:{},
}]};
const prior:SourceReviewDecision = {id:"review-1",objectId:"object-1",sourceFileId:fact.sourceFileId,
  sourceSha256:fact.sourceSha256,revisionStatus:"SUPERSEDED",approvalStatus:"UNAPPROVED",linkGroupId:"set-17",
  sectionCode:"KR",pageStages:{"1":"PD","2":"PD"},basis:{reference:"Ранее сохранённое решение по источнику"},
  matrixScope:scope,actorId:"reviewer",createdAt:"2026-10-17T00:00:00Z",contentHash:hash("e")};
const selection = {objectId:"object-1",checkId:"check-1",executionContentHash:hash("b"),fact};
const input = (overrides:Partial<Parameters<typeof prepareMatrixFactScopeReviewInput>[0]>={}) =>
  ({objectId:selection.objectId,fact,prior,scope,basisReference:"",canReview:true,replaceLegacyConfirmed:false,...overrides});

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("selected immutable matrix fact review",()=>{
  it("loads exact target and current source review with the same cancellation signal",async()=>{
    const signal=new AbortController().signal;
    const targets=vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue({checkId:"check-1",executionContentHash:hash("b"),
      items:[{sourceFileId:fact.sourceFileId,target,fragmentsHash:hash("f")}]});
    const review=vi.spyOn(api,"getSourceReview").mockResolvedValue(prior);
    const loaded=await loadMatrixFactScopeReview({...selection,signal});
    expect(targets).toHaveBeenCalledWith("check-1",signal);
    expect(review).toHaveBeenCalledWith("object-1",fact.sourceFileId,signal);
    expect(loaded).toMatchObject({target,fragmentsHash:hash("f"),prior,scope,legacy:false});
  });

  it.each(["top_hash","target_hash","source","observation","duplicate","check"])("rejects mismatched target %s",async field=>{
    const response={checkId:"check-1",executionContentHash:hash("b"),items:[{sourceFileId:fact.sourceFileId,target:{...target}}]};
    if(field==="top_hash")response.executionContentHash=hash("0");
    if(field==="target_hash")response.items[0].target.executionContentHash=hash("0");
    if(field==="source")response.items[0].sourceFileId="other";
    if(field==="observation")response.items[0].target.observationId=hash("2");
    if(field==="duplicate")response.items.push(response.items[0]);
    if(field==="check")response.items[0].target.checkId="other-check";
    vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue(response);
    vi.spyOn(api,"getSourceReview").mockResolvedValue(prior);
    await expect(loadMatrixFactScopeReview(selection)).rejects.toThrow(/исходного факта|запуска/u);
  });

  it("cancels delayed source/target replies when selection is no longer active",async()=>{
    let resolve!:(value:SourceReviewDecision|null)=>void;
    vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue({checkId:"check-1",executionContentHash:hash("b"),
      items:[{sourceFileId:fact.sourceFileId,target}]});
    vi.spyOn(api,"getSourceReview").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const controller=new AbortController();
    const pending=loadMatrixFactScopeReview({...selection,signal:controller.signal});
    controller.abort();resolve(prior);
    await expect(pending).rejects.toMatchObject({name:"AbortError"});
  });

  it.each(["objectId","sourceFileId","sourceSha256"] as const)("rejects foreign source review %s",async key=>{
    vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue({checkId:"check-1",executionContentHash:hash("b"),
      items:[{sourceFileId:fact.sourceFileId,target}]});
    vi.spyOn(api,"getSourceReview").mockResolvedValue({...prior,[key]:"foreign"});
    await expect(loadMatrixFactScopeReview(selection)).rejects.toThrow(/источника/u);
  });

  it("preserves source trust decisions and exact CAS hash while saving a new scope",()=>{
    const before=structuredClone(prior);
    expect(prepareMatrixFactScopeReviewInput(input())).toEqual({sourceSha256:fact.sourceSha256,
      revisionStatus:"SUPERSEDED",approvalStatus:"UNAPPROVED",linkGroupId:"set-17",sectionCode:"KR",
      pageStages:{"1":"PD","2":"PD"},basis:{reference:scope.bindings[0].reference},matrixScope:scope,
      expectedReviewHash:hash("e")});
    expect(prior).toEqual(before);
  });

  it("uses UNKNOWN and null defaults with explicit null CAS for a first source review",()=>{
    expect(prepareMatrixFactScopeReviewInput(input({prior:null}))).toMatchObject({revisionStatus:"UNKNOWN",
      approvalStatus:"UNKNOWN",sectionCode:null,linkGroupId:null,pageStages:{},expectedReviewHash:null});
  });

  it("preserves sibling inventory claims while changing a scalar fact binding and strips server snapshots",()=>{
    const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json",import.meta.url),"utf8")).fixtures[0];
    const inventoryScope={schemaVersion:"matrix-inventory-review-v1" as const,claims:[{
      target:{checkId:"inventory-origin",inputManifestHash:hash("2"),textStageContentHash:hash("3"),textArtifactHash:fixture.expected.inventory.textArtifactHash,inventoryContentHash:fixture.expectedInventoryContentHash},
      selection:fixture.input.selection,entityKey:"building-A",componentRole:"PARTITION_SLAB_JOINT" as const,componentKey:"joint-1",zoneKey:"axes-A1",
      operatingModeKey:"DECLARED_NOISE_PROTECTION_MEASURES" as const,measurementBasisKey:"SOURCE_AUTHORED_MEASURE_MEMBERSHIP" as const,
      assertion:"HUMAN_ASSERTED_COMPLETE" as const,reference:"Исходный перечень и область проверены человеком",inventorySnapshot:fixture.expected.inventory,
    }]};
    const saved={...prior,inventoryScope},before=JSON.stringify(saved),prepared=prepareMatrixFactScopeReviewInput(input({prior:saved}));
    expect(prepared.inventoryScope!.claims[0]).not.toHaveProperty("inventorySnapshot");
    expect(prepared.inventoryScope!.claims[0]).toMatchObject({target:inventoryScope.claims[0].target,assertion:"HUMAN_ASSERTED_COMPLETE"});
    expect(prepared.expectedReviewHash).toBe(saved.contentHash);expect(prepared.matrixScope).toEqual(scope);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("does not inherit legacy scope and requires explicit replacement confirmation",async()=>{
    const legacy={...prior,matrixScope:{entityKey:"whole-building",reference:"Whole-file legacy review",contexts:{}}};
    vi.spyOn(api,"getMatrixFactTargets").mockResolvedValue({checkId:"check-1",executionContentHash:hash("b"),
      items:[{sourceFileId:fact.sourceFileId,target}]});
    vi.spyOn(api,"getSourceReview").mockResolvedValue(legacy);
    const loaded=await loadMatrixFactScopeReview(selection);
    expect(loaded.legacy).toBe(true);
    expect(loaded.scope.bindings).toEqual([]);
    expect(()=>prepareMatrixFactScopeReviewInput(input({prior:legacy}))).toThrow(/замену/u);
    expect(prepareMatrixFactScopeReviewInput(input({prior:legacy,replaceLegacyConfirmed:true})).matrixScope).toEqual(scope);
  });

  it("empty v2 explicitly removes bindings and requires its own user basis",()=>{
    const empty:MatrixFactScope={schemaVersion:"matrix-fact-scopes-v1",bindings:[]};
    expect(()=>prepareMatrixFactScopeReviewInput(input({scope:empty}))).toThrow(/основание/u);
    const prepared=prepareMatrixFactScopeReviewInput(input({scope:empty,basisReference:"Ошибочная привязка удалена после сверки"}));
    expect(prepared.matrixScope).toEqual(empty);
    expect(prepared.expectedReviewHash).toBe(prior.contentHash);
  });

  it("does not save without review permission or use another fact binding as user basis",async()=>{
    const save=vi.spyOn(api,"recordSourceReview");
    await expect(saveMatrixFactScopeReview(input({canReview:false}))).rejects.toThrow(/прав/u);
    expect(save).not.toHaveBeenCalled();
    const another={...scope,bindings:scope.bindings.map(b=>({...b,target:{...b.target,observationId:hash("2")}}))};
    expect(()=>prepareMatrixFactScopeReviewInput(input({scope:another}))).toThrow(/основание/u);
  });

  it("forwards exact CAS payload; stale rejection never causes a second write",async()=>{
    const save=vi.spyOn(api,"recordSourceReview").mockRejectedValue(new Error("SOURCE_REVIEW_STALE"));
    const before=structuredClone(prior);
    await expect(saveMatrixFactScopeReview(input({basisReference:"Строка проверена по исходному листу"}))).rejects.toThrow("SOURCE_REVIEW_STALE");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("object-1",fact.sourceFileId,expect.objectContaining({expectedReviewHash:prior.contentHash,
      basis:{reference:"Строка проверена по исходному листу"},revisionStatus:"SUPERSEDED",approvalStatus:"UNAPPROVED"}));
    expect(prior).toEqual(before);
  });

  it("saves explicit empty v2 through the existing session/CSRF/idempotent API command",async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(prior),{status:201}));
    vi.stubGlobal("fetch",fetch);
    vi.stubGlobal("document",{cookie:"inspector_csrf=fact-scope-csrf"});
    const empty:MatrixFactScope={schemaVersion:"matrix-fact-scopes-v1",bindings:[]};
    await saveMatrixFactScopeReview(input({scope:empty,basisReference:"Удалена неверная привязка после сверки"}));
    const [url,request]=fetch.mock.calls[0] as [string,RequestInit];
    expect(url).toBe("/api/objects/object-1/files/source-PD/source-review");
    expect(request.credentials).toBe("include");
    expect((request.headers as Headers).get("X-CSRF-Token")).toBe("fact-scope-csrf");
    expect((request.headers as Headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u);
    expect(JSON.parse(request.body as string)).toMatchObject({matrixScope:empty,expectedReviewHash:prior.contentHash,
      revisionStatus:"SUPERSEDED",approvalStatus:"UNAPPROVED"});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("encodes the new target endpoint and passes cancellation to the actual fetch client",async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[]}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    const signal=new AbortController().signal;
    await api.getMatrixFactTargets("check / #",signal);
    expect(fetch).toHaveBeenCalledWith("/api/checks/check%20%2F%20%23/matrix-fact-targets",
      expect.objectContaining({signal,credentials:"include"}));
  });

  it("rejects OCR without loading targets or source decisions",async()=>{
    const targets=vi.spyOn(api,"getMatrixFactTargets");
    const review=vi.spyOn(api,"getSourceReview");
    const ocr={...fact,method:"OCR" as "TEXT_LAYER"};
    await expect(loadMatrixFactScopeReview({...selection,fact:ocr})).rejects.toThrow(/текстового слоя/u);
    expect(()=>prepareMatrixFactScopeReviewInput(input({fact:ocr}))).toThrow(/текстового слоя/u);
    expect(targets).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
  });
});
