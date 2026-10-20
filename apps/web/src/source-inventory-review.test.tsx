import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryScopeDecisionToInput, type MatrixInventoryPreviewRead, type MatrixInventorySelection,
  type MatrixInventorySourcePagesRead, type MatrixSourceInventory, type SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { addInventoryClaim, InventoryReconstruction, inventoryCanAssertComplete, inventoryPages,
  inventoryRegion, inventoryRegionEvidence, loadSourceInventory, previewSourceInventory, SourceInventoryReviewFields } from "./SourceInventoryReviewFields";

const fixtures=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json",import.meta.url),"utf8")).fixtures;
const fixture=fixtures.find((f:any)=>f.name==="pd-both");
const artifact=fixture.input.textArtifact;
const inventory:MatrixSourceInventory=fixture.expected.inventory;
const selection:MatrixInventorySelection=fixture.input.selection;
const hash=(s:string)=>s.repeat(64);
const file:SourceFileSummary={id:inventory.sourceFileId,sha256:inventory.sourceSha256,name:"Синтетическая ведомость.pdf",size:40536,stages:["PD"],pageCount:2,registeredAt:"2026-10-18T00:00:00Z",review:null};
const identity={objectId:"OBJ-INVENTORY",checkId:"CHK-INVENTORY",file,reviewHash:hash("a")};
const origin:MatrixInventorySourcePagesRead={checkId:identity.checkId,sourceFileId:file.id,sourceSha256:file.sha256,
  inputManifestHash:hash("b"),textStageContentHash:hash("c"),textArtifactHash:inventory.textArtifactHash,
  stage:"PD",pageStages:{},latestReviewHash:identity.reviewHash,textArtifact:artifact};
const preview:MatrixInventoryPreviewRead={checkId:identity.checkId,sourceFileId:file.id,sourceSha256:file.sha256,
  result:fixture.expected,target:{checkId:identity.checkId,inputManifestHash:origin.inputManifestHash,textStageContentHash:origin.textStageContentHash,
    textArtifactHash:origin.textArtifactHash,inventoryContentHash:fixture.expectedInventoryContentHash}};
const human={entityKey:"building-A",componentKey:"joint-P01",zoneKey:"axes-A-1",reference:"Узел и весь перечень сверены по исходному листу",complete:false};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("bounded source inventory review UI",()=>{
  it("retains original page/line indices, text and integer line boxes",()=>{
    const before=JSON.stringify(artifact),pages=inventoryPages(artifact);
    expect(pages).toHaveLength(2);
    expect(pages[1].fragments.slice(0,2)).toEqual([...selection.headerFragments,...selection.scopeFragments]);
    expect(pages[0].fragments[0].rawText).toContain("SYNTHETIC ONLY");
    expect(JSON.stringify(artifact)).toBe(before);
  });
  it("never substitutes a whole-block box for missing, clipped or inconsistent line geometry",()=>{
    const copy=structuredClone(artifact);delete copy.pages[1].blocks[0].lineBboxesMilliPoints;
    copy.pages[1].blocks[1].lineBboxesMilliPoints=[[0,0,9999999,10]];
    copy.pages[1].blocks[2].lineBboxesMilliPoints=[];
    expect(inventoryPages(copy)[1].fragments.some(f=>f.blockIndex<=2)).toBe(false);
    expect(()=>inventoryPages({schemaVersion:"document-text-v1",pages:[]})).toThrow(/недоступен/u);
  });
  it("maps top-left percentages to the entire original bottom-left PDF frame",()=>{
    const page=inventoryPages(artifact)[1];
    expect(inventoryRegion(page,[0,0,100,100])).toEqual([0,0,842000,595000]);
    expect(inventoryRegion(page,[10,20,80,90])).toEqual([84200,59500,673600,476000]);
    const evidence=inventoryRegionEvidence(file,page,selection.regionBoxMilliPoints,"PD");
    expect(evidence).toMatchObject({sourceFileId:file.id,sourceSha256:file.sha256,pageNumber:2,sheet:null,revision:null,stage:"PD"});
    expect(evidence.bbox).toEqual([50000/842000,1-515000/595000,790000/842000,1-370000/595000]);
  });
  it.each([[NaN,0,100,100],[0,-1,100,100],[0,0,101,100],[60,0,50,100],[0,60,100,50],[0,0,0,100]].map(percent=>({percent})))("rejects invalid region $percent",({percent})=>{
    expect(()=>inventoryRegion(inventoryPages(artifact)[1],percent as [number,number,number,number])).toThrow();
  });
  it("UNKNOWN is default; human completeness is explicit and the request contains no server snapshot",()=>{
    const scope=addInventoryClaim(undefined,preview,selection,human);
    expect(scope.claims[0]).toMatchObject({assertion:"UNKNOWN",componentRole:"PARTITION_SLAB_JOINT",entityKey:human.entityKey,target:preview.target,selection});
    expect(scope.claims[0]).not.toHaveProperty("inventorySnapshot");
    expect(scope.claims[0]).not.toHaveProperty("confidence");
    const complete=addInventoryClaim(scope,preview,selection,{...human,complete:true});
    expect(complete.claims).toHaveLength(1);expect(complete.claims[0].assertion).toBe("HUMAN_ASSERTED_COMPLETE");
    expect(scope.claims[0].assertion).toBe("UNKNOWN");
  });
  it.each(["rd-no-rows","rd-explicit-empty","rd-negated","rd-duplicate-feature","rd-compound"])("blocks human completeness for %s and displays each unresolved row",name=>{
    const vector=fixtures.find((f:any)=>f.name===name),result=vector.expected;
    expect(result.status).toBe("RECONSTRUCTED");
    const candidate={...preview,result,target:{...preview.target!,textArtifactHash:result.inventory.textArtifactHash,inventoryContentHash:vector.expectedInventoryContentHash}};
    expect(inventoryCanAssertComplete(result.inventory)).toBe(false);
    expect(()=>addInventoryClaim(undefined,candidate,vector.input.selection,{...human,complete:true})).toThrow(/Полноту нельзя/u);
    const html=renderToStaticMarkup(createElement(InventoryReconstruction,{inventory:result.inventory}));
    expect(html).toContain("Подтверждение полноты недоступно");
    for(const row of result.inventory.unresolvedRows)expect(html).toContain(row.fragments[0].rawText);
  });
  it("rejects stale selection, missing origin target, incomplete identity and claim overflow",()=>{
    expect(()=>addInventoryClaim(undefined,{...preview,target:undefined},selection,human)).toThrow(/Сначала/u);
    expect(()=>addInventoryClaim(undefined,preview,{...selection,regionBoxMilliPoints:[0,0,842000,595000]},human)).toThrow(/изменилась/u);
    expect(()=>addInventoryClaim(undefined,preview,selection,{...human,zoneKey:" "})).toThrow();
    const claim=addInventoryClaim(undefined,preview,selection,human).claims[0];
    const full={schemaVersion:"matrix-inventory-review-v1" as const,claims:Array.from({length:16},(_,i)=>({...claim,target:{...claim.target,inventoryContentHash:i.toString(16).padStart(64,"0")}}))};
    expect(()=>addInventoryClaim(full,preview,selection,human)).toThrow();
  });
  it("projects a saved decision to input without changing exact claim/CAS identity",()=>{
    const input=addInventoryClaim(undefined,preview,selection,human);
    const saved={...input,claims:input.claims.map(c=>({...c,inventorySnapshot:inventory}))};
    expect(inventoryScopeDecisionToInput(saved)).toEqual(input);
    expect(saved.claims[0]).toHaveProperty("inventorySnapshot");
  });
  it("loads original source with cancellation and rejects an older current-review hash",async()=>{
    const spy=vi.spyOn(api,"getSourceInventoryPages").mockResolvedValue(origin),signal=new AbortController().signal;
    expect(await loadSourceInventory(identity,signal)).toEqual(origin);
    expect(spy).toHaveBeenCalledWith(identity.checkId,file.id,signal);
    spy.mockResolvedValue({...origin,latestReviewHash:hash("f")});
    await expect(loadSourceInventory(identity,signal)).rejects.toThrow(/изменились/u);
  });
  it.each(["checkId","sourceFileId","sourceSha256"] as const)("rejects foreign loaded %s",async key=>{
    vi.spyOn(api,"getSourceInventoryPages").mockResolvedValue({...origin,[key]:"foreign"});
    await expect(loadSourceInventory(identity,new AbortController().signal)).rejects.toThrow(/изменились/u);
  });
  it("ignores successful delayed replies after selection cancellation",async()=>{
    let resolve!:(v:MatrixInventorySourcePagesRead)=>void;
    vi.spyOn(api,"getSourceInventoryPages").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const controller=new AbortController(),pending=loadSourceInventory(identity,controller.signal);
    controller.abort();resolve(origin);await expect(pending).rejects.toMatchObject({name:"AbortError"});
  });
  it("validates the exact original preview and propagates its cancellation signal",async()=>{
    const signal=new AbortController().signal,spy=vi.spyOn(api,"previewSourceInventory").mockResolvedValue(preview);
    expect(await previewSourceInventory(identity,origin,selection,signal)).toEqual(preview);
    expect(spy).toHaveBeenCalledWith(identity.checkId,file.id,selection,signal);
  });
  it.each(["inputManifestHash","textStageContentHash","textArtifactHash","checkId"] as const)("rejects foreign preview target %s",async key=>{
    vi.spyOn(api,"previewSourceInventory").mockResolvedValue({...preview,target:{...preview.target!,[key]:hash("f")}});
    await expect(previewSourceInventory(identity,origin,selection,new AbortController().signal)).rejects.toThrow(/совпадает/u);
  });
  it("rejects a changed preview region and cancels delayed preview before use",async()=>{
    const inv={...inventory,regionBoxMilliPoints:[0,0,842000,595000] as [number,number,number,number]};
    const spy=vi.spyOn(api,"previewSourceInventory").mockResolvedValue({...preview,result:{schemaVersion:"matrix-inventory-source-result-v1",status:"RECONSTRUCTED",inventory:inv}});
    await expect(previewSourceInventory(identity,origin,selection,new AbortController().signal)).rejects.toThrow(/совпадает/u);
    let resolve!:(v:MatrixInventoryPreviewRead)=>void;spy.mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const controller=new AbortController(),pending=previewSourceInventory(identity,origin,selection,controller.signal);
    controller.abort();resolve(preview);await expect(pending).rejects.toMatchObject({name:"AbortError"});
  });
  it("remounts pending editor by source/check/review identity and renders explicit withdrawal",()=>{
    const props={...identity,value:undefined,onChange:vi.fn(),disabled:false},first=SourceInventoryReviewFields(props);
    for(const next of [{...props,objectId:"OTHER"},{...props,checkId:"OTHER"},{...props,reviewHash:hash("f")},
      {...props,file:{...file,id:"OTHER"}},{...props,file:{...file,sha256:hash("f")}}])expect(SourceInventoryReviewFields(next).key).not.toBe(first.key);
    const html=renderToStaticMarkup(first);expect(html).toContain("Полнота всего объекта не доказана");expect(html).toContain("Загрузить исходные листы");
    expect(html).not.toContain("<form");expect(html).not.toContain("checked=");
    const empty=renderToStaticMarkup(createElement(SourceInventoryReviewFields,{...props,value:{schemaVersion:"matrix-inventory-review-v1",claims:[]}}));
    expect(empty).toContain("Перечни отозваны в этом черновике");
  });
  it("uses authenticated GET and CSRF-protected read-only preview without serializing trusted snapshots",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(origin),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview),{status:200}));
    vi.stubGlobal("fetch",fetch);vi.stubGlobal("document",{cookie:"inspector_csrf=inventory-csrf"});
    const signal=new AbortController().signal;
    await api.getSourceInventoryPages("check / #","source / #",signal);await api.previewSourceInventory("check / #","source / #",selection,signal);
    expect(fetch.mock.calls[0][0]).toBe("/api/checks/check%20%2F%20%23/source-inventory-pages?sourceFileId=source%20%2F%20%23");
    const [url,request]=fetch.mock.calls[1] as [string,RequestInit];
    expect(url).toBe("/api/checks/check%20%2F%20%23/source-inventory-preview");expect(request.credentials).toBe("include");expect(request.signal).toBe(signal);
    expect((request.headers as Headers).get("X-CSRF-Token")).toBe("inventory-csrf");
    expect(JSON.parse(request.body as string)).toEqual({sourceFileId:"source / #",selection});
  });
});
