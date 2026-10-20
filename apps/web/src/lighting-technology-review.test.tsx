import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,it,vi} from "vitest";
import type {CheckRun,DocumentTextV3AuditSourceRead,MatrixLightingTechnologyPreviewRead,MatrixLightingTechnologyScopeInput} from "@inspector-ai/contracts";
import {lightingTechnologyScopeDecisionToInput} from "@inspector-ai/contracts";
import {api} from "./api";
import {buildSourceTextV3Index} from "./source-text-explorer";
import {lightingSelection,loadLightingSource,previewLightingSource,appendLightingPreview,withdrawLightingClaim,withLightingReviewScope,LightingTechnologyReviewFields} from "./LightingTechnologyReview";
import {selectLightingSourceAudit,LightingTechnologyAuditStatus} from "./LightingTechnologyReviewWorkspace";
import {LightingTechnologyComparisonsPanel,lightingFragmentEvidence} from "./LightingTechnologyComparisonsPanel";
const manual=JSON.parse(readFileSync(new URL("../../../fixtures/portable-historical-tests-v1/manual-before-code.json",import.meta.url),"utf8"));
function fixture(i=0){const f=structuredClone(manual.sources[i]);return {...f,origin:f.origin as DocumentTextV3AuditSourceRead,preview:f.preview as MatrixLightingTechnologyPreviewRead,index:buildSourceTextV3Index(f.identity,f.origin)};}
const human=(f:ReturnType<typeof fixture>,samePosition=true)=>({identity:f.expectedRequestClaim.identity,reference:f.expectedRequestClaim.reference,samePosition});
const check=(f:ReturnType<typeof fixture>,change:Partial<CheckRun>={}):CheckRun=>({id:f.identity.checkId,objectId:f.identity.objectId,mode:"NORMAL",purpose:"SOURCE_AUDIT_ONLY",progress:100,status:"PARTIAL",startedAt:"2026-10-18T00:00:00Z",completedAt:"2026-10-18T00:01:00Z",currentStage:"Готово",modelVersion:null,rulesVersion:"test",stats:{} as CheckRun["stats"],...change});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("selects latest actual completed audit only, keeps queued/foreign/normal checks out",()=>{
 const f=fixture(),old=check(f),latest=check(f,{id:"CHK-LATEST",startedAt:"2026-10-18T00:02:00Z"});
 const rows=[old,check(f,{id:"CHK-QUEUED",progress:0,completedAt:null,startedAt:"2026-10-18T00:04:00Z"}),check(f,{id:"CHK-NORMAL",purpose:undefined,startedAt:"2026-10-18T00:05:00Z"}),check(f,{objectId:"OTHER",startedAt:"2026-10-18T00:06:00Z"}),latest];
 expect(selectLightingSourceAudit(rows,f.identity.objectId)?.id).toBe("CHK-LATEST");expect(selectLightingSourceAudit(rows.slice(1,4),f.identity.objectId)).toBeNull();
 const html=renderToStaticMarkup(<LightingTechnologyAuditStatus check={check(f,{progress:22,completedAt:null,currentStage:"Очередь"})}/>);
 expect(html).toContain("22%");expect(html).toContain("Очередь");expect(html).not.toContain("Исходный текст готов");
});
it.each([0,1])("uses full original source%d with exact path/raw LF and no v2 facade",async i=>{
 const f=fixture(i);vi.spyOn(api,"getCheck").mockResolvedValue(check(f));const get=vi.spyOn(api,"getDocumentTextV3Source").mockResolvedValue(f.origin);
 expect(await loadLightingSource(f.identity,new AbortController().signal)).toEqual(f.origin);expect(get).toHaveBeenCalledOnce();
 const selection=lightingSelection(f.index,1,f.expectedRequestClaim.selection.fragments.map((x:any)=>x.sourcePath));expect(selection).toEqual(f.expectedRequestClaim.selection);
 expect(selection.fragments[0].rawText.endsWith("\n")).toBe(true);expect(Object.keys(selection.fragments[0])).toEqual(["sourcePath","rawText"]);
});
it.each(["empty","three","duplicate","missing","unlocated"])("rejects invalid exact original selection %s",kind=>{
 const f=fixture(),path=f.expectedRequestClaim.selection.fragments[0].sourcePath;
 if(kind==="unlocated")f.index.lines[0].bboxMilliPoints=null;
 const paths=kind==="empty"?[]:kind==="three"?[path,path,path]:kind==="duplicate"?[path,path]:kind==="missing"?[[9999]]:[path];
 expect(()=>lightingSelection(f.index,1,paths)).toThrow();
});
it("two rows remain ordered exactly as explicitly selected, no concatenation or synthetic geometry",()=>{
 const f=fixture();f.index.lines.push({...structuredClone(f.index.lines[0]),key:"second",sourcePath:[9,0],rawText:"Источник света: LED.\n"});
 const result=lightingSelection(f.index,1,[[9,0],f.index.lines[0].sourcePath]);expect(result.fragments).toEqual([{sourcePath:[9,0],rawText:"Источник света: LED.\n"},{sourcePath:f.index.lines[0].sourcePath,rawText:f.index.lines[0].rawText}]);
});
it.each(["checkId","sourceFileId","sourceSha256","latestReviewHash","extractorProfileHash","textArtifactByteSha256"])("rejects detached full source %s",async key=>{
 const f=fixture();(f.origin as any)[key]="foreign";vi.spyOn(api,"getCheck").mockResolvedValue(check(f));vi.spyOn(api,"getDocumentTextV3Source").mockResolvedValue(f.origin);await expect(loadLightingSource(f.identity,new AbortController().signal)).rejects.toThrow();
});
it.each(["ordinary","queued","foreign"])("does not load source for %s check",async kind=>{
 const f=fixture();vi.spyOn(api,"getCheck").mockResolvedValue(check(f,kind==="ordinary"?{purpose:undefined}:kind==="queued"?{completedAt:null,progress:25}:{objectId:"OTHER"}));const get=vi.spyOn(api,"getDocumentTextV3Source");
 await expect(loadLightingSource(f.identity,new AbortController().signal)).rejects.toThrow();expect(get).not.toHaveBeenCalled();
});
it("previews exact native rows and appends only canonical request fields, without source snapshot",async()=>{
 const f=fixture(),selection=f.expectedRequestClaim.selection;const post=vi.spyOn(api,"previewSourceLightingTechnology").mockResolvedValue(f.preview),signal=new AbortController().signal;
 const preview=await previewLightingSource(f.identity,f.origin,selection,signal);expect(post).toHaveBeenCalledWith(f.identity.checkId,f.identity.file.id,selection,signal);
 const scope=appendLightingPreview(undefined,f.identity,preview,human(f));expect(scope).toEqual({schemaVersion:"matrix-zu130-lighting-technology-review-v1",claims:[f.expectedRequestClaim]});expect(JSON.stringify(scope)).not.toContain("declarationSnapshot");
 expect(appendLightingPreview(undefined,f.identity,preview,human(f,false)).claims[0].positionMapping.assertion).toBe("UNKNOWN");
 expect(()=>appendLightingPreview(scope,f.identity,preview,human(f))).toThrow();expect(withdrawLightingClaim(scope,0)).toEqual({schemaVersion:scope.schemaVersion,claims:[]});
 expect(lightingTechnologyScopeDecisionToInput(f.decision)).toEqual(scope);
});
it.each(["target","frame","box","raw","path","page","review","probability"])("rejects detached preview %s",async kind=>{
 const f=fixture(),p=f.preview as any,d=p.result.declaration;
 if(kind==="target")p.target.textArtifactHash="f".repeat(64);else if(kind==="frame")d.nativeFrame.visibleBoxPointStrings[2]="999";else if(kind==="box")d.primaryFragments[0].bboxMilliPoints[0]++;else if(kind==="raw")d.primaryFragments[0].rawText+="x";else if(kind==="path")d.primaryFragments[0].sourcePath=[999];else if(kind==="page")d.pageNumber++;else if(kind==="review")p.latestReviewHash=null;else d.calibratedProbability=.99;
 vi.spyOn(api,"previewSourceLightingTechnology").mockResolvedValue(p);await expect(previewLightingSource(f.identity,f.origin,f.expectedRequestClaim.selection,new AbortController().signal)).rejects.toThrow();
});
it("abstention is display only and unbound groups cannot become physical position mappings",async()=>{
 const f=fixture(),p={...f.preview,target:undefined,result:{schemaVersion:"matrix-zu130-lighting-technology-source-v3-result-v1" as const,status:"ABSTAIN" as const,reasonCode:"DECLARATION_UNVERIFIED" as const}};
 vi.spyOn(api,"previewSourceLightingTechnology").mockResolvedValue(p);const preview=await previewLightingSource(f.identity,f.origin,f.expectedRequestClaim.selection,new AbortController().signal);expect(preview.result.status).toBe("ABSTAIN");expect(()=>appendLightingPreview(undefined,f.identity,preview,human(f))).toThrow();
 const group={...f.preview,selection:f.expectedRequestClaim.selection} as any;group.result.declaration.scopeStatus="UNBOUND_GROUP_DECLARATION";group.result.declaration.positionLabel=null;expect(()=>appendLightingPreview(undefined,f.identity,group,human(f))).toThrow();
});
it("invalid human identity/reference is rejected; withdrawal preserves other claims and input immutability",()=>{
 const f=fixture(),p={...f.preview,selection:f.expectedRequestClaim.selection},scope=appendLightingPreview(undefined,f.identity,p,human(f)),before=JSON.stringify(scope);
 expect(()=>appendLightingPreview(undefined,f.identity,p,{...human(f),reference:"short"})).toThrow();expect(()=>appendLightingPreview(undefined,f.identity,p,{...human(f),identity:{...human(f).identity,systemKey:""}})).toThrow();
 const other=structuredClone(scope.claims[0]);other.target.declarationContentHash="e".repeat(64);const two:MatrixLightingTechnologyScopeInput={...scope,claims:[...scope.claims,other]};expect(withdrawLightingClaim(two,0).claims).toEqual([other]);expect(JSON.stringify(scope)).toBe(before);expect(()=>withdrawLightingClaim(scope,9)).toThrow();
});
it("aborted load and preview cannot issue API calls",async()=>{
 const f=fixture(),c=new AbortController();c.abort();const get=vi.spyOn(api,"getCheck"),post=vi.spyOn(api,"previewSourceLightingTechnology");await expect(loadLightingSource(f.identity,c.signal)).rejects.toThrow();await expect(previewLightingSource(f.identity,f.origin,f.expectedRequestClaim.selection,c.signal)).rejects.toThrow();expect(get).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
});
it("SSR starts mapping unconfirmed and keeps declaration/reference readable with no nested form",()=>{
 const f=fixture(),html=renderToStaticMarkup(<LightingTechnologyReviewFields identity={f.identity} preview={{...f.preview,selection:f.expectedRequestClaim.selection}} disabled={false} onChange={()=>{}}/>);
 expect(html).toContain("Сопоставление позиции освещения");expect(html).toContain("Уверенность не измерена");expect(html).toContain("LED");expect(html).toContain("L1");expect(html).not.toContain("checked");expect(html).not.toContain("<form");
});
it("typed lighting result stays candidate/null confidence and original evidence opens only exact frozen reference",()=>{
 const comparisons=structuredClone(manual.comparisons),evidence=structuredClone(manual.evidence),row=comparisons.results.find((x:any)=>x.kind==="SCOPED_COMPARISON"&&x.comparison.status==="CANDIDATE");
 const item=evidence.find((x:any)=>x.resultId===row.id),original=lightingFragmentEvidence(row,item);expect(original).toMatchObject({sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,pageNumber:item.pageNumber,value:item.fragment.rawText});
 for(const key of ["sourceSha256","reviewContentHash","declarationContentHash","resultId"]){const altered=structuredClone(item);altered[key]="foreign";expect(lightingFragmentEvidence(row,altered)).toBeNull();}
 const malformed=structuredClone(item);malformed.nativeFrame.coordinateSystem="OTHER";expect(lightingFragmentEvidence(row,malformed)).toBeNull();
 const html=renderToStaticMarkup(<LightingTechnologyComparisonsPanel comparisons={comparisons} evidence={evidence} files={[]} onSelect={()=>{}}/>);expect(html).toContain("ZU-130 · Кандидат");expect(html).toContain("Уверенность не измерена");expect(html).toContain("Открыть оригинал");expect(html).not.toContain("Машинное предупреждение");expect(html.replace(/<[^>]*>/gu," ")).not.toMatch(/99%|100%|80%/);
});
it("authenticated transport uses exact additive public routes and no client materialization",async()=>{
 const f=fixture(),fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(f.preview)));vi.stubGlobal("fetch",fetch);vi.stubGlobal("document",{cookie:"inspector_csrf=lighting%20csrf"});const signal=new AbortController().signal;
 await api.previewSourceLightingTechnology("CHK /?","FIL /?",f.expectedRequestClaim.selection,signal);let [url,init]=fetch.mock.calls[0] as [string,RequestInit];expect(url).toBe("/api/checks/CHK%20%2F%3F/source-files/FIL%20%2F%3F/lighting-technology-preview");expect(JSON.parse(init.body as string)).toEqual({selection:f.expectedRequestClaim.selection});expect((init.headers as Headers).get("X-CSRF-Token")).toBe("lighting csrf");expect((init.headers as Headers).has("Idempotency-Key")).toBe(false);expect(init.signal).toBe(signal);
 await api.startSourceAuditV3("OBJ /?");[url,init]=fetch.mock.calls[1] as [string,RequestInit];expect(url).toBe("/api/objects/OBJ%20%2F%3F/source-audit-v3");expect(init.method).toBe("POST");expect(init.credentials).toBe("include");expect(JSON.parse(init.body as string)).toEqual({});expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/u);expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([401,403,409])("surfaces HTTP%s once without automatic retry or stale rebasing",async status=>{
 const f=fixture(),fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message:"SOURCE_REVIEW_STALE"}),{status}));vi.stubGlobal("fetch",fetch);await expect(api.previewSourceLightingTechnology("CHK","FIL",f.expectedRequestClaim.selection)).rejects.toThrow("SOURCE_REVIEW_STALE");expect(fetch).toHaveBeenCalledOnce();
});
it("parent request preserves exact CAS and all historical scopes; explicit empty lighting differs from omission",async()=>{
 const f=fixture(),water=JSON.parse(readFileSync(new URL("../../../fixtures/matrix-water-node-ui-v1/qa-manual-ui-expectations.json",import.meta.url),"utf8"));
 const input=water.cases.find((c:any)=>c.name==="full-review-CAS-and-all-sibling-preservation").expectedRequest;
 const scope=lightingTechnologyScopeDecisionToInput(f.decision),before=JSON.stringify(input);
 const combined=withLightingReviewScope(input,scope);expect(combined).toEqual({...input,lightingTechnologyScope:scope});
 for(const key of ["matrixScope","inventoryScope","callInventoryScope","railInventoryScope","waterNodeScope","expectedReviewHash"] as const)expect(combined[key]).toEqual(input[key]);
 expect(withLightingReviewScope(input)).toEqual(input);expect(withLightingReviewScope(input)).not.toHaveProperty("lightingTechnologyScope");
 expect(withLightingReviewScope(input,{schemaVersion:scope.schemaVersion,claims:[]}).lightingTechnologyScope?.claims).toEqual([]);
 expect(()=>withLightingReviewScope(input,f.decision)).toThrow();expect(JSON.stringify(input)).toBe(before);
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({contentHash:"f".repeat(64)})));vi.stubGlobal("fetch",fetch);
 await api.recordSourceReview("OBJ","FIL",combined);const [,init]=fetch.mock.calls[0] as [string,RequestInit];expect(JSON.parse(init.body as string)).toEqual(combined);expect(init.body).not.toContain("declarationSnapshot");
});
it("SSR preserves existing claims and explicit withdrawal without requiring an active source audit",()=>{
 const f=fixture(),value=lightingTechnologyScopeDecisionToInput(f.decision),html=renderToStaticMarkup(<LightingTechnologyReviewFields identity={{...f.identity,checkId:"NO-AUDIT"}} value={value} disabled={true} onChange={()=>{}}/>);
 expect(html).toContain("disabled");expect(html).toContain(f.expectedRequestClaim.reference);expect(html).toContain("Отозвать привязку освещения 1");expect(html).not.toContain("<form");
 const empty=renderToStaticMarkup(<LightingTechnologyReviewFields identity={f.identity} value={{schemaVersion:value.schemaVersion,claims:[]}} disabled={false} onChange={()=>{}}/>);expect(empty).toContain("Все привязки освещения отозваны");
});
it("escaping source-authored text never creates executable markup",()=>{
 const f=fixture();f.preview.result.status==="RECONSTRUCTED"&&(f.preview.result.declaration.primaryFragments[0].rawText="<script>alert(1)</script>\n");
 const selection={pageNumber:1,fragments:[{sourcePath:[0,0],rawText:"<script>alert(1)</script>\n"}]} as any;
 const html=renderToStaticMarkup(<LightingTechnologyReviewFields identity={f.identity} preview={{...f.preview,selection}} disabled={false} onChange={()=>{}}/>);
 expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");
});
it("rejects malformed native frame from full source before allowing display",async()=>{
 const f=fixture();(f.origin.textArtifact.pages[0].nativeFrame as any).coordinateSystem="OTHER";vi.spyOn(api,"getCheck").mockResolvedValue(check(f));vi.spyOn(api,"getDocumentTextV3Source").mockResolvedValue(f.origin);
 await expect(loadLightingSource(f.identity,new AbortController().signal)).rejects.toThrow();
});
it.each([{stages:["PD","RD"]},{stages:["RD","ID"]},{stages:["ID"]}])("mixed or ID source $stages cannot create a physical position mapping",({stages})=>{
 const f=fixture();f.identity.file.stages=stages;const preview={...f.preview,selection:f.expectedRequestClaim.selection};expect(()=>appendLightingPreview(undefined,f.identity,preview,human(f))).toThrow();
 const scope=lightingTechnologyScopeDecisionToInput(f.decision);expect(withdrawLightingClaim(scope,0).claims).toEqual([]);
});
it("a17th distinct source claim cannot discard or overwrite16 earlier claims",()=>{
 const f=fixture(),scope=lightingTechnologyScopeDecisionToInput(f.decision),prior:MatrixLightingTechnologyScopeInput={...scope,claims:Array.from({length:16},(_,i)=>({...structuredClone(scope.claims[0]),target:{...scope.claims[0].target,declarationContentHash:i.toString(16).padStart(64,"0")}}))};
 const before=JSON.stringify(prior);expect(()=>appendLightingPreview(prior,f.identity,{...f.preview,selection:f.expectedRequestClaim.selection},human(f))).toThrow();expect(JSON.stringify(prior)).toBe(before);
});
it("out-of-bounds source text range cannot open original evidence",()=>{
 const row=manual.comparisons.results[0],item=structuredClone(manual.evidence[0]);item.fragment.usedTextRange.end=9999999;expect(lightingFragmentEvidence(row,item)).toBeNull();
});
const geometry=JSON.parse(readFileSync(new URL("../../../fixtures/portable-historical-tests-v1/native-geometry-manual-before-final-fix.json",import.meta.url),"utf8"));
for(const expected of geometry.cases)it("normalizes already crop-relative canonical coordinates once: "+expected.name,()=>{
 const source=JSON.parse(readFileSync(new URL("../../../fixtures/document-text-v3-v1/qa-rotation-manual-goldens.json",import.meta.url),"utf8")).cases.find((c:any)=>c.name===expected.name),page=source.artifact.pages[0];
 const row=structuredClone(manual.comparisons.results[0]),item=structuredClone(manual.evidence[0]);
 row.comparison.expected.sourceFileId=source.artifact.sourceFileId;row.comparison.expected.sourceSha256=source.artifact.inputSha256;
 item.sourceFileId=source.artifact.sourceFileId;item.sourceSha256=source.artifact.inputSha256;item.pageFrame={widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints};item.nativeFrame=page.nativeFrame;
 item.fragment={...page.locatedLines[0],pageNumber:1,usedTextRange:{start:0,end:1}};
 expect(item.nativeFrame.visibleBoxPointStrings).toEqual(expected.nativeFrame);const original=lightingFragmentEvidence(row,item);expect(original).not.toBeNull();
 original!.bbox!.forEach((edge,i)=>expect(edge).toBeCloseTo(expected.expectedNormalizedBbox[i],12));
 expect(original?.value).toBe("A\n");expect(item.nativeFrame).toEqual(page.nativeFrame);
});
