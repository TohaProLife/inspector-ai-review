import {readFileSync} from "node:fs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {SourceFileSummary,MatrixInventorySourcePagesRead,MatrixWaterNodeInventorySelection} from "@inspector-ai/contracts";
import {api} from "./api";
import {inventoryPages} from "./SourceInventoryReviewFields";
import {waterNodeSourceIdentity,waterNodeLocators,waterNodeSelection,loadWaterNodeSource,previewWaterNodeSource,SourceWaterNodeSourcePreview} from "./SourceWaterNodeSourcePreview";
const manual=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-water-node-ui-v1/qa-manual-ui-expectations.json",import.meta.url),"utf8"));
function fixture(stage:"PD"|"RD"="PD") {
 const f=structuredClone(manual.cases.find((c:any)=>c.name===stage+"-whole-authenticated-source-preview")),identity=f.sourceIdentity,origin=f.origin as MatrixInventorySourcePagesRead;
 const file:SourceFileSummary={id:identity.sourceFileId,sha256:identity.sourceSha256,name:"SYNTHETIC ONLY "+stage+".pdf",size:12345,stages:[stage],pageCount:1,registeredAt:"2026-10-18T00:00:00Z",review:null};
 const {selection,...response}=f.preview;return {identity,origin,file,response,selection:selection as MatrixWaterNodeInventorySelection,page:inventoryPages(origin.textArtifact)[selection.pageNumber-1],expected:f.expected};
}
const scopes=(loc:ReturnType<typeof waterNodeLocators>)=>[loc.buildings[0],loc.nodes[0],loc.services[0],loc.accountingScopes[0]] as Parameters<typeof waterNodeSelection>[2];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("full original ZU129 source selection and stale response guards",()=>{
 for(const stage of ["PD","RD"] as const)it("retains complete "+stage+" original pages, six locators and exact prescribed band",async()=>{
  const f=fixture(stage),before=structuredClone(f.origin),loc=waterNodeLocators(f.page);expect(Object.keys(loc).sort()).toEqual(["accountingScopes","buildings","ends","headers","nodes","services"]);
  for(const rows of Object.values(loc))expect(rows).toHaveLength(1);expect(waterNodeSelection(f.page,loc.headers[0],scopes(loc),loc.ends[0])).toEqual(f.selection);
  expect(f.selection.scopeFragments.map(x=>x.rawText)).toEqual(f.expected.scopeRawLines);expect(f.selection.regionBoxMilliPoints).toEqual([0,loc.ends[0].bboxMilliPoints[1],f.page.widthMilliPoints,loc.headers[0].bboxMilliPoints[3]]);
  const get=vi.spyOn(api,"getSourceWaterNodePages").mockResolvedValue(f.origin),post=vi.spyOn(api,"previewSourceWaterNode").mockResolvedValue(f.response),signal=new AbortController().signal;
  expect(await loadWaterNodeSource(f.identity,signal)).toEqual(f.origin);expect(await previewWaterNodeSource(f.identity,f.origin,f.selection,signal)).toEqual({...f.response,selection:f.selection});
  expect(get).toHaveBeenCalledWith(f.identity.checkId,f.file.id,signal);expect(post).toHaveBeenCalledWith(f.identity.checkId,f.file.id,f.selection,signal);expect(f.origin).toEqual(before);
 });
 for(const key of ["buildings","nodes","services","accountingScopes"] as const)it("missing "+key+" cannot borrow another scope category",()=>{
  const f=fixture(),loc=waterNodeLocators(f.page),deleted=loc[key][0];f.page.fragments=f.page.fragments.filter(x=>x.blockIndex!==deleted.blockIndex||x.lineIndex!==deleted.lineIndex);
  const missing=waterNodeLocators(f.page);expect(missing[key]).toHaveLength(0);expect(()=>waterNodeSelection(f.page,missing.headers[0],scopes(missing),missing.ends[0])).toThrow();
 });
 it("prefix competitors stay visible; malformed or duplicate source cannot be silently selected",()=>{
  const f=fixture(),bad={...structuredClone(f.selection.scopeFragments[0]),blockIndex:99,rawText:"Здание: ???"};f.page.fragments.push(bad);
  const loc=waterNodeLocators(f.page);expect(loc.buildings).toContainEqual(bad);expect(loc.buildings).toHaveLength(2);
  expect(()=>waterNodeSelection(f.page,loc.headers[0],scopes(loc),loc.ends[0])).toThrow();
 });
 it("source text is literal: no trim, token aliases, collapsed scopes or synthetic unit",()=>{
  const f=fixture();f.page.fragments.push({...f.page.fragments[0],blockIndex:99,rawText:" Состав общедомового вводного узла холодной воды"});
  const loc=waterNodeLocators(f.page);expect(loc.headers).toHaveLength(1);expect(f.selection.scopeFragments).toHaveLength(4);expect(Object.keys(f.selection)).toEqual(["pageNumber","regionBoxMilliPoints","headerFragments","scopeFragments","endFragments"]);
 });
 it.each(["reorder","wrongRaw","wrongBox","wrongPage","missingEnd","cutBand"])("rejects altered original scope %s before preview POST",async kind=>{
  const f=fixture();if(kind==="reorder")[f.selection.scopeFragments[0],f.selection.scopeFragments[1]]=[f.selection.scopeFragments[1],f.selection.scopeFragments[0]];
  else if(kind==="wrongRaw")f.selection.scopeFragments[2].rawText="Система: ГВС";else if(kind==="wrongBox")f.selection.scopeFragments[0].bboxMilliPoints[0]++;
  else if(kind==="wrongPage")f.selection.scopeFragments[0].pageNumber++;else if(kind==="missingEnd")(f.selection as any).endFragments=[];else f.selection.regionBoxMilliPoints[0]=1;
  const spy=vi.spyOn(api,"previewSourceWaterNode");await expect(previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();expect(spy).not.toHaveBeenCalled();
 });
 it("whole-block bbox cannot replace missing individual line geometry",()=>{
  const f=fixture(),a=structuredClone(f.origin.textArtifact) as any;for(const block of a.pages[0].blocks)delete block.lineBboxesMilliPoints;
  const loc=waterNodeLocators(inventoryPages(a)[0]);for(const rows of Object.values(loc))expect(rows).toHaveLength(0);
 });
 for(const key of ["checkId","sourceFileId","sourceSha256","latestReviewHash","inputManifestHash","textStageContentHash","textArtifactHash"] as const)it("rejects detached GET "+key,async()=>{
  const f=fixture();(f.origin as any)[key]="foreign";vi.spyOn(api,"getSourceWaterNodePages").mockResolvedValue(f.origin);await expect(loadWaterNodeSource(f.identity,new AbortController().signal)).rejects.toThrow();
 });
 it.each(["artifactSource","artifactSHA","pageCount","pageOrder","frame"])("rejects incomplete full original %s",async kind=>{
  const f=fixture(),a=f.origin.textArtifact as any;if(kind==="artifactSource")a.sourceFileId="foreign";else if(kind==="artifactSHA")a.inputSha256="f".repeat(64);else if(kind==="pageCount")a.pageCount++;else if(kind==="pageOrder")a.pages[0].pageNumber=2;else a.pages[0].widthMilliPoints=0;
  vi.spyOn(api,"getSourceWaterNodePages").mockResolvedValue(f.origin);await expect(loadWaterNodeSource(f.identity,new AbortController().signal)).rejects.toThrow();
 });
 for(const key of ["checkId","sourceFileId","sourceSha256","latestReviewHash"] as const)it("rejects detached preview "+key,async()=>{
  const f=fixture();f.response[key]="foreign";vi.spyOn(api,"previewSourceWaterNode").mockResolvedValue(f.response);await expect(previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
 });
 for(const key of ["checkId","inputManifestHash","textStageContentHash","textArtifactHash"] as const)it("preview target authentic origin binding "+key,async()=>{
  const f=fixture();f.response.target[key]=key==="checkId"?"foreign":"f".repeat(64);vi.spyOn(api,"previewSourceWaterNode").mockResolvedValue(f.response);await expect(previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
 });
 it.each(["stage","frame","scope","schema","missingTarget"])("rejects invalid reconstruction %s",async kind=>{
  const f=fixture();if(kind==="stage")f.response.result.inventory.stage="RD";else if(kind==="frame")f.response.result.inventory.heightMilliPoints++;
  else if(kind==="scope")f.response.result.inventory.scopeFragments[3].rawText+=" changed";else if(kind==="schema")f.response.result.schemaVersion="wrong";else delete f.response.target;
  vi.spyOn(api,"previewSourceWaterNode").mockResolvedValue(f.response);await expect(previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
 });
 it("ABSTAIN is display-only and must never carry authoritative target",async()=>{
  const f=fixture(),r={...f.response,target:undefined,result:{schemaVersion:"matrix-zu129-water-node-source-result-v1" as const,status:"ABSTAIN" as const,reasonCode:"SCOPE_UNVERIFIED"}};
  const post=vi.spyOn(api,"previewSourceWaterNode").mockResolvedValue(r);expect((await previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).result).toEqual(r.result);
  post.mockResolvedValue({...r,target:f.response.target});await expect(previewWaterNodeSource(f.identity,f.origin,f.selection,new AbortController().signal)).rejects.toThrow();
 });
 it.each(["load","preview"])("abort before %s invokes no API",async kind=>{
  const f=fixture(),c=new AbortController();c.abort();const get=vi.spyOn(api,"getSourceWaterNodePages"),post=vi.spyOn(api,"previewSourceWaterNode");
  await expect(kind==="load"?loadWaterNodeSource(f.identity,c.signal):previewWaterNodeSource(f.identity,f.origin,f.selection,c.signal)).rejects.toThrow();expect(get).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
 });
 it.each(["load","preview"])("late resolved %s after abort cannot restore stale result",async kind=>{
  const f=fixture(),c=new AbortController();let done!:(x:any)=>void;const deferred=new Promise<any>(resolve=>{done=resolve;});
  if(kind==="load")vi.spyOn(api,"getSourceWaterNodePages").mockReturnValue(deferred);else vi.spyOn(api,"previewSourceWaterNode").mockReturnValue(deferred);
  const pending=kind==="load"?loadWaterNodeSource(f.identity,c.signal):previewWaterNodeSource(f.identity,f.origin,f.selection,c.signal);c.abort();done(kind==="load"?f.origin:f.response);await expect(pending).rejects.toThrow();
 });
 it("wrapper key resets identity without claiming mounted lifecycle; SSR stays idle",()=>{
  const f=fixture(),onChange=vi.fn(),fetch=vi.fn(),props={objectId:"SYNTHETIC-OBJECT",checkId:f.identity.checkId,file:f.file,reviewHash:f.identity.reviewHash,disabled:false,onChange};vi.stubGlobal("fetch",fetch);
  const key=SourceWaterNodeSourcePreview(props).key;for(const p of [{...props,objectId:"other"},{...props,checkId:"other"},{...props,reviewHash:null},{...props,file:{...f.file,id:"other"}},{...props,file:{...f.file,sha256:"f".repeat(64)}}])expect(SourceWaterNodeSourcePreview(p).key).not.toBe(key);
  expect(waterNodeSourceIdentity(props)).toEqual(f.identity);const text=renderToStaticMarkup(createElement(SourceWaterNodeSourcePreview,{...props,disabled:true}));expect(text).toContain('disabled=""');expect(text).not.toContain('type="submit"');expect(fetch).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();
 });
});
