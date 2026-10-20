import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixCallInventorySelection, MatrixInventorySourcePagesRead, SourceFileSummary } from "@inspector-ai/contracts";
import { api, type MatrixCallInventoryPreviewRead } from "./api";
import { inventoryPages } from "./SourceInventoryReviewFields";
import { callSourceIdentity, callInventoryLocators, callInventorySelection, loadCallInventorySource,
  previewCallInventorySource, SourceCallInventorySourcePreview } from "./SourceCallInventorySourcePreview";

const base=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-call-comparison-v1/research-call-comparison-manual-goldens-v2.json",import.meta.url),"utf8")).cases[0].input;
const sha=(s:string)=>s.repeat(64);
function fixture(stage:"PD"|"RD"="PD") {
  const source=structuredClone(base.sources.find((s:any)=>s.stages[0]===stage)),claim=source.review.callInventoryScope.claims[0];
  const rawOrigin=structuredClone(base.origins.find((o:any)=>o.sourceFileId===source.sourceFileId));
  const file:SourceFileSummary={id:source.sourceFileId,sha256:source.sourceSha256,name:`SYNTHETIC ONLY ${stage}.pdf`,size:12345,
    stages:[stage],pageCount:rawOrigin.textArtifact.pageCount,registeredAt:"2026-10-18T00:00:00Z",review:null};
  const identity={checkId:rawOrigin.checkId,sourceFileId:file.id,sourceSha256:file.sha256,reviewHash:source.review.contentHash};
  const origin:MatrixInventorySourcePagesRead={checkId:identity.checkId,sourceFileId:file.id,sourceSha256:file.sha256,
    inputManifestHash:rawOrigin.inputManifestHash,textStageContentHash:rawOrigin.textStageContentHash,textArtifactHash:rawOrigin.textArtifactHash,
    stage,pageStages:source.review.pageStages,latestReviewHash:identity.reviewHash,textArtifact:rawOrigin.textArtifact};
  const response:MatrixCallInventoryPreviewRead={checkId:identity.checkId,sourceFileId:file.id,sourceSha256:file.sha256,latestReviewHash:identity.reviewHash,
    target:claim.target,result:{schemaVersion:"matrix-odi123-call-inventory-source-result-v1",status:"RECONSTRUCTED",inventory:claim.inventorySnapshot}};
  const page=inventoryPages(origin.textArtifact).find(p=>p.pageNumber===claim.selection.pageNumber)!;
  return {file,identity,origin,response,page,claim,selection:claim.selection as MatrixCallInventorySelection};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("authenticated ODI123 source preview",()=>{
  for(const stage of ["PD","RD"] as const) {
    it("retains complete original "+stage+" artifact and derives only exact closed full-width band",async()=>{
      const f=fixture(stage),before=JSON.stringify(f.origin),loc=callInventoryLocators(f.page);
      expect(inventoryPages(f.origin.textArtifact)).toHaveLength(f.file.pageCount!);
      expect(callInventorySelection(f.page,loc.headers[0],loc.scopes[0],loc.ends[0])).toEqual(f.selection);
      expect(f.selection.regionBoxMilliPoints).toEqual([0,loc.ends[0].bboxMilliPoints[1],f.page.widthMilliPoints,loc.headers[0].bboxMilliPoints[3]]);
      const get=vi.spyOn(api,"getSourceCallInventoryPages").mockResolvedValue(f.origin),post=vi.spyOn(api,"previewSourceCallInventory").mockResolvedValue(f.response);
      const signal=new AbortController().signal;
      expect(await loadCallInventorySource(f.identity,signal)).toEqual(f.origin);
      const out=await previewCallInventorySource(f.identity,f.origin,f.selection,signal);
      expect(out.selection).toEqual(f.selection);expect(out.target).toEqual(f.claim.target);expect(out.result).toEqual(f.response.result);
      expect(get).toHaveBeenCalledWith(f.identity.checkId,f.file.id,signal);expect(post).toHaveBeenCalledWith(f.identity.checkId,f.file.id,f.selection,signal);
      expect(JSON.stringify(f.origin)).toBe(before);expect("identity" in out).toBe(false);
    });
  }
  it("literal selectors never trim, alias, join lines or infer room identity",()=>{
    const f=fixture(),p=structuredClone(f.page);p.fragments.push({...p.fragments[0],blockIndex:50,rawText:" Перечень оборудования системы вызова персонала"});
    p.fragments.push({...p.fragments[0],blockIndex:51,rawText:"Санузел МГН: СУ-101 "});
    p.fragments.push({...p.fragments[0],blockIndex:52,rawText:"Конец перечня оборудования системы вызова персонала\nещё строка"});
    const rows=callInventoryLocators(p);expect(rows.headers).toHaveLength(1);expect(rows.scopes).toHaveLength(1);expect(rows.ends).toHaveLength(1);
    expect(Object.keys(callInventorySelection(f.page,rows.headers[0],rows.scopes[0],rows.ends[0]))).toEqual(["pageNumber","regionBoxMilliPoints","headerFragments","scopeFragments","endFragments"]);
  });
  it("source DTO object key ordering does not change valid original fragment identity",()=>{
    const f=fixture(),loc=callInventoryLocators(f.page),reverse=(x:any)=>Object.fromEntries(Object.entries(x).reverse()) as any;
    expect(callInventorySelection(f.page,reverse(loc.headers[0]),reverse(loc.scopes[0]),reverse(loc.ends[0]))).toEqual(f.selection);
  });
  for(const kind of ["missingEnd","foreignPage","changedRaw","changedBox","reversedBand"])it("rejects unsupported selection "+kind,()=>{
    const f=fixture(),loc=callInventoryLocators(f.page),header=structuredClone(loc.headers[0]),scope=structuredClone(loc.scopes[0]),end=structuredClone(loc.ends[0]);
    if(kind==="missingEnd")expect(()=>callInventorySelection(f.page,header,scope,undefined as any)).toThrow();
    else {if(kind==="foreignPage")end.pageNumber++;else if(kind==="changedRaw")scope.rawText+=" changed";
      else if(kind==="changedBox")end.bboxMilliPoints[1]++;else {end.bboxMilliPoints=[...header.bboxMilliPoints];f.page.fragments.push(end);}
      expect(()=>callInventorySelection(f.page,header,scope,end)).toThrow();}
  });
  it("keeps duplicate full-page locator candidates visible rather than choosing a first match",()=>{
    const f=fixture(),p=structuredClone(f.page);p.fragments.push({...p.fragments[0],blockIndex:99});expect(callInventoryLocators(p).headers).toHaveLength(2);
  });
  it("does not use coarse whole-block geometry as source line proof",()=>{
    const f=fixture(),artifact=structuredClone(f.origin.textArtifact) as any;
    for(const block of artifact.pages[f.page.pageNumber-1].blocks)delete block.lineBboxesMilliPoints;
    const page=inventoryPages(artifact)[f.page.pageNumber-1];expect(callInventoryLocators(page)).toEqual({headers:[],scopes:[],ends:[]});
  });
  for(const key of ["checkId","sourceFileId","sourceSha256","latestReviewHash","inputManifestHash","textStageContentHash","textArtifactHash"] as const)
    it("rejects stale origin identity or malformed hash "+key,async()=>{
      const f=fixture();const data={...f.origin,[key]:"foreign"};vi.spyOn(api,"getSourceCallInventoryPages").mockResolvedValue(data);
      await expect(loadCallInventorySource(f.identity,new AbortController().signal)).rejects.toThrow();
    });
  for(const key of ["sourceFileId","inputSha256"] as const)it("rejects detached artifact "+key,async()=>{
    const f=fixture();f.origin.textArtifact[key]="foreign";vi.spyOn(api,"getSourceCallInventoryPages").mockResolvedValue(f.origin);
    await expect(loadCallInventorySource(f.identity,new AbortController().signal)).rejects.toThrow();
  });
  it.each(["pageCount","pageNumber","width"])("rejects incomplete or malformed original frame %s",async kind=>{
    const f=fixture(),artifact=f.origin.textArtifact as any;if(kind==="pageCount")artifact.pageCount++;else if(kind==="pageNumber")artifact.pages[0].pageNumber=10;else artifact.pages[0].widthMilliPoints=0;
    vi.spyOn(api,"getSourceCallInventoryPages").mockResolvedValue(f.origin);await expect(loadCallInventorySource(f.identity,new AbortController().signal)).rejects.toThrow();
  });
  it("aborted-before-load performs no request",async()=>{
    const f=fixture(),spy=vi.spyOn(api,"getSourceCallInventoryPages"),controller=new AbortController();controller.abort();
    await expect(loadCallInventorySource(f.identity,controller.signal)).rejects.toThrow();expect(spy).not.toHaveBeenCalled();
  });
  it("late successful GET after abort cannot restore a stale source",async()=>{
    const f=fixture(),controller=new AbortController();let resolve!:(value:MatrixInventorySourcePagesRead)=>void;
    vi.spyOn(api,"getSourceCallInventoryPages").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const pending=loadCallInventorySource(f.identity,controller.signal);controller.abort();resolve(f.origin);await expect(pending).rejects.toThrow();
  });
  it("late successful preview after abort cannot restore a stale claim",async()=>{
    const f=fixture(),controller=new AbortController();let resolve!:(value:MatrixCallInventoryPreviewRead)=>void;
    vi.spyOn(api,"previewSourceCallInventory").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const pending=previewCallInventorySource(f.identity,f.origin,f.selection,controller.signal);controller.abort();resolve(f.response);await expect(pending).rejects.toThrow();
  });
  for(const key of ["checkId","sourceFileId","sourceSha256","latestReviewHash"] as const)it("rejects wrong preview source/CAS "+key,async()=>{
    const f=fixture();(f.response as any)[key]="foreign";vi.spyOn(api,"previewSourceCallInventory").mockResolvedValue(f.response);
    await expect(previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
  });
  for(const key of ["checkId","inputManifestHash","textStageContentHash","textArtifactHash"] as const)it("rejects detached originating run/hash "+key,async()=>{
    const f=fixture();f.response.target![key]=key==="checkId"?"foreign":sha("f");vi.spyOn(api,"previewSourceCallInventory").mockResolvedValue(f.response);
    await expect(previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
  });
  it.each(["frame","stage","end","missingTarget","schema"])("rejects incorrect reconstruction %s",async kind=>{
    const f=fixture();if(f.response.result.status!=="RECONSTRUCTED")throw Error("fixture");
    if(kind==="frame")f.response.result.inventory.widthMilliPoints++;
    else if(kind==="stage")f.response.result.inventory.stage="RD";
    else if(kind==="end")f.response.result.inventory.endFragments[0].rawText+=" changed";
    else if(kind==="missingTarget")delete f.response.target;
    else (f.response.result as any).schemaVersion="wrong";
    vi.spyOn(api,"previewSourceCallInventory").mockResolvedValue(f.response);
    await expect(previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
  });
  it("rejects cropped band before any preview request",async()=>{
    const f=fixture();f.selection.regionBoxMilliPoints[0]=1;const spy=vi.spyOn(api,"previewSourceCallInventory");
    await expect(previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow(/всю ширину/u);expect(spy).not.toHaveBeenCalled();
  });
  it("ABSTAIN stays explicit and must not contain a trusted target",async()=>{
    const f=fixture(),result={schemaVersion:"matrix-odi123-call-inventory-source-result-v1" as const,status:"ABSTAIN" as const,reasonCode:"SCOPE_UNVERIFIED"};
    const spy=vi.spyOn(api,"previewSourceCallInventory").mockResolvedValue({...f.response,target:undefined,result});
    expect((await previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).result).toEqual(result);
    spy.mockResolvedValue({...f.response,result});await expect(previewCallInventorySource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
  });
  it("URL encoding, exact selection-only POST, cancellation and CSRF preserve read-only API shape",async()=>{
    const f=fixture(),fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(f.origin),{status:200})).mockResolvedValueOnce(new Response(JSON.stringify(f.response),{status:200}));
    vi.stubGlobal("fetch",fetch);vi.stubGlobal("document",{cookie:"inspector_csrf=call-csrf"});const signal=new AbortController().signal;
    await api.getSourceCallInventoryPages("check / #","source / #",signal);await api.previewSourceCallInventory("check / #","source / #",f.selection,signal);
    expect(fetch.mock.calls[0][0]).toBe("/api/checks/check%20%2F%20%23/source-files/source%20%2F%20%23/call-inventory-pages");
    const [url,request]=fetch.mock.calls[1] as [string,RequestInit];expect(url).toBe("/api/checks/check%20%2F%20%23/source-files/source%20%2F%20%23/call-inventory-preview");
    expect(request.method).toBe("POST");expect(request.credentials).toBe("include");expect(request.signal).toBe(signal);
    expect((request.headers as Headers).get("X-CSRF-Token")).toBe("call-csrf");expect((request.headers as Headers).has("Idempotency-Key")).toBe(false);
    expect(JSON.parse(request.body as string)).toEqual({selection:f.selection});
  });
  it("remounts all pending source/preview state on source/check/CAS changes",()=>{
    const f=fixture(),props={objectId:"OBJ",checkId:f.identity.checkId,file:f.file,reviewHash:f.identity.reviewHash,disabled:false,onChange:vi.fn()};
    const key=SourceCallInventorySourcePreview(props).key;
    for(const next of [{...props,checkId:"different"},{...props,objectId:"different"},{...props,reviewHash:null},
      {...props,file:{...f.file,id:"different"}},{...props,file:{...f.file,sha256:sha("f")}}])expect(SourceCallInventorySourcePreview(next).key).not.toBe(key);
    expect(callSourceIdentity(props)).toEqual(f.identity);
  });
  it("SSR is idle: native form controls and preservation editor, no automatic network",()=>{
    const f=fixture(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    const text=renderToStaticMarkup(createElement(SourceCallInventorySourcePreview,{objectId:"OBJ",checkId:f.identity.checkId,file:f.file,
      reviewHash:f.identity.reviewHash,value:base.sources[0].review.callInventoryScope?{schemaVersion:"matrix-odi123-call-inventory-review-v1",claims:[]}:undefined,onChange:vi.fn(),disabled:true}));
    expect(text).toContain('disabled=""');expect(text).toContain("Загрузить исходные листы вызова");expect(text).toContain("Все области вызова отозваны");
    expect(text).not.toContain('type="submit"');expect(fetch).not.toHaveBeenCalled();
  });
});
