import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
import type {MatrixExecutionRead,CheckRun,SourceReviewInput} from '@inspector-ai/contracts';
import {api} from './api';
import {loadSteelSource,appendSteelClaim,withdrawSteelClaim,withSteelReviewScope,steelApplicabilityInput,withdrawSteelApplicability,steelPairFragmentEvidence,SteelSourceReviewFields} from './SteelReview';
import {SteelComparisonsPanel,steelFragmentEvidence} from './SteelComparisonsPanel';
const manual=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-ui-v1/manual-before-code.json',import.meta.url),'utf8'));
function fixture(i=0){const all=structuredClone(manual),s=all.sources[i];return {...all,s,identity:{objectId:all.objectId,checkId:s.origin.checkId,file:s.file,reviewHash:s.decision.contentHash}};}
function check(f:ReturnType<typeof fixture>,change:Partial<CheckRun>={}):CheckRun{return {id:f.identity.checkId,objectId:f.objectId,mode:'NORMAL',status:'PARTIAL',progress:100,completedAt:'2026-10-18T00:01:00.000Z',startedAt:'2026-10-18T00:00:00.000Z',...change} as CheckRun;}
function result(f:ReturnType<typeof fixture>):MatrixExecutionRead{return {checkId:f.identity.checkId,execution:{objectId:f.objectId,inputManifestHash:f.s.origin.inputManifestHash},sourceDeclarations:{schemaVersion:'matrix-source-declarations-v1',purpose:'EVIDENCE_ONLY',objectId:f.objectId,inputManifestHash:f.s.origin.inputManifestHash,extractorVersion:'matrix-source-declarations-v1',declarations:[f.s.claim.declarationSnapshot]}} as MatrixExecutionRead;}
function mockLoad(f:ReturnType<typeof fixture>){vi.spyOn(api,'getCheck').mockResolvedValue(check(f));vi.spyOn(api,'getMatrixExecution').mockResolvedValue(result(f));vi.spyOn(api,'getSourceInventoryPages').mockResolvedValue(f.s.origin);}
const selection=(s:any)=>({file:s.file,review:s.decision,claim:s.claim});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([0,1])('full original source%d binds exact hashes and authored lines; draft omits server snapshot',async i=>{
 const f=fixture(i);mockLoad(f);const origin=await loadSteelSource(f.identity,new AbortController().signal);
 const human={identity:f.s.claim.identity,reference:f.s.claim.memberMapping.reference,sameMember:true,fragments:f.s.claim.memberMapping.scopeFragments};
 const scope=appendSteelClaim(undefined,origin,f.s.claim.target.declarationId,human);expect(scope).toEqual({schemaVersion:'matrix-kr056-steel-review-v1',claims:[f.s.expectedInputClaim]});
 expect(JSON.stringify(scope)).not.toContain('declarationSnapshot');expect(appendSteelClaim(undefined,origin,f.s.claim.target.declarationId,{...human,sameMember:false}).claims[0].memberMapping.assertion).toBe('UNKNOWN');
 expect(()=>appendSteelClaim(scope,origin,f.s.claim.target.declarationId,human)).toThrow();expect(withdrawSteelClaim(scope,0).claims).toEqual([]);
});
it.each(['check','object','unfinished','sha','review','manifest','textHash','fragment','frame'])('rejects detached source %s',async kind=>{
 const f=fixture();mockLoad(f);if(kind==='check')vi.mocked(api.getCheck).mockResolvedValue(check(f,{id:'FOREIGN'}));
 else if(kind==='object')vi.mocked(api.getCheck).mockResolvedValue(check(f,{objectId:'FOREIGN'}));
 else if(kind==='unfinished')vi.mocked(api.getCheck).mockResolvedValue(check(f,{progress:50,completedAt:null}));
 else if(kind==='sha')f.s.origin.sourceSha256='f'.repeat(64);else if(kind==='review')f.s.origin.latestReviewHash=null;
 else if(kind==='manifest')f.s.origin.inputManifestHash='f'.repeat(64);else if(kind==='textHash')f.s.origin.textArtifactHash='f'.repeat(64);
 else {const value=result(f);if(kind==='fragment')value.sourceDeclarations!.declarations[0].primaryFragments[0].rawText+=' altered';else value.sourceDeclarations!.declarations[0].widthMilliPoints++;vi.mocked(api.getMatrixExecution).mockResolvedValue(value);}
 await expect(loadSteelSource(f.identity,new AbortController().signal)).rejects.toThrow();
});
it('mapping requires original fragments and explicit identity; no invented line or auto trimming',async()=>{
 const f=fixture();mockLoad(f);const origin=await loadSteelSource(f.identity,new AbortController().signal),human={identity:f.s.claim.identity,reference:f.s.claim.memberMapping.reference,sameMember:true,fragments:f.s.claim.memberMapping.scopeFragments};
 for(const bad of [{...human,fragments:[]},{...human,fragments:[{...human.fragments[0],rawText:'invented'}]},{...human,identity:{...human.identity,memberKey:''}},{...human,reference:'short'}])expect(()=>appendSteelClaim(undefined,origin,f.s.claim.target.declarationId,bad)).toThrow();
 const html=renderToStaticMarkup(<SteelSourceReviewFields identity={f.identity} loaded={origin} disabled={false} onChange={()=>{}}/>);expect(html).not.toContain('checked');expect(html).not.toContain('<form');expect(html).toContain('Сопоставление элемента');
});
it('source save preserves sibling scopes/CAS and explicit empty withdrawal',()=>{
 const f=fixture(),input:SourceReviewInput={sourceSha256:f.s.file.sha256,revisionStatus:'CURRENT',approvalStatus:'APPROVED',sectionCode:'KR',linkGroupId:'group',pageStages:{},basis:{reference:'manual source basis'},expectedReviewHash:'a'.repeat(64),lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[]}};
 expect(withSteelReviewScope(input)).toEqual(input);expect(withSteelReviewScope(input)).not.toHaveProperty('steelComparisonScope');
 expect(withSteelReviewScope(input,{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]})).toEqual({...input,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}});
 expect(()=>withSteelReviewScope(input,f.s.decision.steelComparisonScope)).toThrow();
});
it('pair approval requires exact current reviewed common member; unknown remains available',()=>{
 const f=fixture(),[pd,rd]=f.sources,basis={reference:f.journal.projection.basis.reference,expectedScopeFragments:f.journal.projection.basis.expectedScopeFragments,actualScopeFragments:f.journal.projection.basis.actualScopeFragments,approved:false};
 const unknown=steelApplicabilityInput(selection(pd),selection(rd),basis);expect(unknown.status).toBe('UNKNOWN');expect(unknown.expectedReviewHash).toBeNull();expect(unknown).not.toHaveProperty('actorId');
 const approved=steelApplicabilityInput(selection(pd),selection(rd),{...basis,approved:true},f.journal);expect(approved.status).toBe('APPROVED');expect(approved.expectedReviewHash).toBe(f.journal.contentHash);
 for(const mutate of [(x:any)=>x.review.contentHash='f'.repeat(64),(x:any)=>x.claim.identity.memberKey='other',(x:any)=>x.file.sha256=pd.file.sha256,(x:any)=>x.review.linkGroupId='other',(x:any)=>x.review.approvalStatus='UNKNOWN',(x:any)=>x.claim.memberMapping.assertion='UNKNOWN']){const altered=selection(structuredClone(rd));mutate(altered);expect(()=>steelApplicabilityInput(selection(pd),altered,{...basis,approved:true})).toThrow();}
});
it('withdrawal uses retained prior refs/basis and journal CAS without current source lookup',()=>{
 const f=fixture(),before=JSON.stringify(f.journal),p=f.journal.projection;expect(withdrawSteelApplicability(f.journal)).toEqual({schemaVersion:'matrix-kr056-steel-applicability-review-v1',status:'WITHDRAWN',identity:p.identity,expected:p.expected,actual:p.actual,basis:p.basis,expectedReviewHash:f.journal.contentHash});expect(JSON.stringify(f.journal)).toBe(before);
});
it('pair PDF navigation uses full original page frame and refuses absent cross-page or detached target',async()=>{
 const f=fixture();mockLoad(f);const loaded=await loadSteelSource(f.identity,new AbortController().signal),s=selection(f.s),fragment=f.s.claim.memberMapping.scopeFragments[0];
 expect(steelPairFragmentEvidence(s,fragment,loaded)).toMatchObject({sourceFileId:s.file.id,sourceSha256:s.file.sha256,pageNumber:fragment.pageNumber,value:fragment.rawText});
 expect(()=>steelPairFragmentEvidence(s,{...fragment,pageNumber:2},loaded)).toThrow();
 const detached=structuredClone(s);detached.claim.target.textStageContentHash='f'.repeat(64);expect(()=>steelPairFragmentEvidence(detached,fragment,loaded)).toThrow();
 const changed=structuredClone(fragment);changed.bboxMilliPoints[0]++;expect(()=>steelPairFragmentEvidence(s,changed,loaded)).toThrow();
});
it('all 13 evidence fragments open only exact saved refs/target/pair/frame; null confidence stays candidate',()=>{
 const f=fixture(),row=f.comparisons.results[0];expect(f.evidence).toHaveLength(13);
 for(const item of f.evidence){expect(steelFragmentEvidence(row,item)).toMatchObject({sourceFileId:item.sourceFileId,pageNumber:item.pageNumber,value:item.fragment.rawText});for(const key of ['resultId','sourceSha256','reviewContentHash','applicabilityDecisionContentHash']){const altered=structuredClone(item);altered[key]='foreign';expect(steelFragmentEvidence(row,altered)).toBeNull();}}
 const item=structuredClone(f.evidence[0]);item.target.declarationId='f'.repeat(64);expect(steelFragmentEvidence(row,item)).toBeNull();item.target=structuredClone(f.evidence[0].target);item.fragment.bboxMilliPoints[2]=item.pageFrame.widthMilliPoints+1;expect(steelFragmentEvidence(row,item)).toBeNull();
 const html=renderToStaticMarkup(<SteelComparisonsPanel comparisons={f.comparisons} evidence={f.evidence} snapshot={f.snapshot} files={[]} onSelect={()=>{}}/>);expect(html).toContain('KR-056 · Кандидат');expect(html).toContain('Уверенность не измерена');expect(html).toContain('Снимок согласований этого запуска');expect(html).not.toContain('Машинное предупреждение');
});
it('journal transport encodes route, retains exact body/CAS and command headers; no retry/rebase',async()=>{
 const f=fixture(),fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[f.journal],canReview:true})));vi.stubGlobal('fetch',fetch);vi.stubGlobal('document',{cookie:'inspector_csrf=steel%20csrf'});const signal=new AbortController().signal;
 await api.getSteelApplicabilityReviews('OBJ /?',signal);expect(fetch.mock.calls[0][0]).toBe('/api/objects/OBJ%20%2F%3F/steel-applicability-reviews');expect(fetch.mock.calls[0][1].signal).toBe(signal);
 const input=withdrawSteelApplicability(f.journal);await api.recordSteelApplicabilityReview('OBJ /?',input,signal);const init=fetch.mock.calls[1][1];expect(JSON.parse(init.body)).toEqual(input);expect(init.method).toBe('POST');expect(init.headers.get('X-CSRF-Token')).toBe('steel csrf');expect(init.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
 fetch.mockResolvedValue(new Response(JSON.stringify({message:'STEEL_APPLICABILITY_STALE'}),{status:409}));await expect(api.recordSteelApplicabilityReview('OBJ',input)).rejects.toThrow('STEEL_APPLICABILITY_STALE');expect(fetch).toHaveBeenCalledTimes(3);
});
