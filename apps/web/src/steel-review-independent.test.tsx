/** Independent T74: original authored manual; pure callbacks/SSR, no mounted DOM. */
import {readFileSync} from 'node:fs';
import React,{isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
import type {CheckRun,MatrixExecutionRead} from '@inspector-ai/contracts';
import {api} from './api';
import {loadSteelSource,steelJsonEqual,steelApplicabilityInput,withdrawSteelApplicability,withSteelReviewScope} from './SteelReview';
import {SteelComparisonsPanel,steelFragmentEvidence} from './SteelComparisonsPanel';
import {SteelSourceReviewWorkspace,SteelApplicabilityWorkspace} from './SteelReviewWorkspace';
const original=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-ui-v1/manual-before-code.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(original);
const selection=(s:any)=>({file:s.file,review:s.decision,claim:s.claim});
function sourceFixture(){const f=fixture(),s=f.sources[0];return{f,s,identity:{objectId:f.objectId,checkId:s.origin.checkId,file:s.file,reviewHash:s.decision.contentHash},check:{id:s.origin.checkId,objectId:f.objectId,mode:'NORMAL',status:'PARTIAL',progress:100,completedAt:'2026-10-18T00:01:00.000Z'}as CheckRun,read:{checkId:s.origin.checkId,execution:{objectId:f.objectId,inputManifestHash:s.origin.inputManifestHash},sourceDeclarations:{schemaVersion:'matrix-source-declarations-v2',purpose:'EVIDENCE_ONLY',objectId:f.objectId,inputManifestHash:s.origin.inputManifestHash,declarations:[s.claim.declarationSnapshot]}}as MatrixExecutionRead};}
function mockSource(f:ReturnType<typeof sourceFixture>){vi.spyOn(api,'getCheck').mockResolvedValue(f.check);vi.spyOn(api,'getMatrixExecution').mockResolvedValue(f.read);vi.spyOn(api,'getSourceInventoryPages').mockResolvedValue(f.s.origin);}
function buttons(node:any,out:React.ReactElement<any>[]=[]):React.ReactElement<any>[]{if(!isValidElement(node))return out;const el=node as React.ReactElement<any>;if(el.type==='button')out.push(el);React.Children.forEach(el.props.children,c=>buttons(c,out));return out;}
afterEach(()=>vi.restoreAllMocks());

it('structural JSON equality ignores object insertion order but keeps array order and cardinality',()=>{
 expect(steelJsonEqual({b:[1,2],a:'строка'},{a:'строка',b:[1,2]})).toBe(true);
 expect(steelJsonEqual([1,2],[2,1])).toBe(false);
 expect(steelJsonEqual([],[,])).toBe(false);
 expect(steelJsonEqual([1],[1,,])).toBe(false);
});
it('sparse original bbox never yields a clickable NaN locator',()=>{
 const f=fixture(),e=f.evidence[0];e.fragment.bboxMilliPoints=[60000,,607200,469600];
 expect(steelFragmentEvidence(f.comparisons.results[0],e)).toBeNull();
 const tree=SteelComparisonsPanel({comparisons:f.comparisons,evidence:[e],files:f.sources.map((s:any)=>s.file),onSelect:()=>{throw Error('must not open');}});
 expect(buttons(tree)).toHaveLength(0);
});
it('all thirteen original callbacks preserve raw lines, exact PD/RD identity and bottom-left conversion without alias',()=>{
 const f=fixture(),before=structuredClone(f),selected:any[]=[];
 const tree=SteelComparisonsPanel({comparisons:f.comparisons,evidence:f.evidence,files:f.sources.map((s:any)=>s.file),snapshot:f.snapshot,onSelect:e=>selected.push(e)});
 const actions=buttons(tree);expect(actions).toHaveLength(13);actions.forEach(b=>b.props.onClick());
 expect(selected).toHaveLength(13);selected.forEach((e,i)=>{const v=f.evidence[i],b=v.fragment.bboxMilliPoints,{widthMilliPoints:w,heightMilliPoints:h}=v.pageFrame;expect(e).toMatchObject({sourceFileId:v.sourceFileId,sourceSha256:v.sourceSha256,pageNumber:v.pageNumber,value:v.fragment.rawText,stage:v.role==='EXPECTED'?'PD':'RD',bbox:[b[0]/w,1-b[3]/h,b[2]/w,1-b[1]/h]});});
 selected[0].bbox[0]=.99;expect(f).toEqual(before);
});
it.each(['reviewDecisionId','sourceFileId','applicabilityDecisionId']as const)('rejects different saved %s despite otherwise exact original evidence',key=>{
 const f=fixture(),item=f.evidence[0];item[key]='FOREIGN-SAVED-REF';expect(steelFragmentEvidence(f.comparisons.results[0],item)).toBeNull();
});
it('withdrawal uses previous exact pair, identity, original basis and journal CAS after current source edit',()=>{
 const f=fixture(),before=structuredClone(f.journal);f.sources[1].decision.contentHash='f'.repeat(64);f.sources[1].decision.steelComparisonScope.claims=[];
 const input=withdrawSteelApplicability(f.journal);expect(input).toEqual({schemaVersion:'matrix-kr056-steel-applicability-review-v1',status:'WITHDRAWN',identity:before.projection.identity,expected:before.projection.expected,actual:before.projection.actual,basis:before.projection.basis,expectedReviewHash:before.contentHash});
 input.basis.reference='changed local return';expect(f.journal).toEqual(before);
});
it('cross-object or non-current source cannot approve an otherwise matching pair; UNKNOWN default is explicit',()=>{
 const f=fixture(),basis={...f.journal.projection.basis,approved:false};
 expect(steelApplicabilityInput(selection(f.sources[0]),selection(f.sources[1]),basis).status).toBe('UNKNOWN');
 for(const change of [(s:any)=>s.review.objectId='OTHER-OBJECT',(s:any)=>s.review.revisionStatus='SUPERSEDED',(s:any)=>s.review.pageStages={'1':'ID'}]){const s=selection(structuredClone(f.sources[1]));change(s);expect(()=>steelApplicabilityInput(selection(f.sources[0]),s,{...basis,approved:true})).toThrow();}
});
it('no source reads or mutation occur in unloaded/disabled workspaces SSR; remount keys retain exact source and journal revision',()=>{
 const f=sourceFixture(),fetch=vi.spyOn(api,'getCheck'),write=vi.spyOn(api,'recordSteelApplicabilityReview');
 const source=SteelSourceReviewWorkspace({identity:f.identity,value:undefined,onChange:()=>{throw Error('no auto claim');},disabled:true});
 const pair=SteelApplicabilityWorkspace({objectId:f.f.objectId,refreshKey:f.identity.reviewHash,disabled:true});
 expect(source.key).toBe(JSON.stringify(f.identity));expect(pair.key).toBe(JSON.stringify([f.f.objectId,f.identity.reviewHash]));
 const html=renderToStaticMarkup(<>{source}{pair}</>);expect(html).toContain('disabled');expect(html).not.toContain('checked=""');expect(fetch).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
it('pre-aborted source load performs zero reads',async()=>{
 const f=sourceFixture();mockSource(f);const c=new AbortController();c.abort();await expect(loadSteelSource(f.identity,c.signal)).rejects.toThrow();expect(api.getCheck).not.toHaveBeenCalled();expect(api.getMatrixExecution).not.toHaveBeenCalled();expect(api.getSourceInventoryPages).not.toHaveBeenCalled();
});
it('source cancellation after check prevents child reads; a foreign object also prevents child reads',async()=>{
 const f=sourceFixture();mockSource(f);const c=new AbortController();vi.mocked(api.getCheck).mockImplementation(async()=>{c.abort();return f.check;});await expect(loadSteelSource(f.identity,c.signal)).rejects.toThrow();expect(api.getMatrixExecution).not.toHaveBeenCalled();expect(api.getSourceInventoryPages).not.toHaveBeenCalled();
 vi.mocked(api.getCheck).mockResolvedValue({...f.check,objectId:'FOREIGN'});await expect(loadSteelSource(f.identity,new AbortController().signal)).rejects.toThrow();expect(api.getMatrixExecution).not.toHaveBeenCalled();
});
it('abort after pending children rejects response and signal reaches both original reads',async()=>{
 const f=sourceFixture();mockSource(f);const c=new AbortController();vi.mocked(api.getMatrixExecution).mockImplementation(async()=>{c.abort();return f.read;});await expect(loadSteelSource(f.identity,c.signal)).rejects.toThrow();expect(api.getMatrixExecution).toHaveBeenCalledWith(f.identity.checkId,c.signal);expect(api.getSourceInventoryPages).toHaveBeenCalledWith(f.identity.checkId,f.identity.file.id,c.signal);
});
it('null-confidence candidate remains narrowly labeled; numeric confidence and ABSTAIN have no source actions',()=>{
 const f=fixture(),html=renderToStaticMarkup(<SteelComparisonsPanel comparisons={f.comparisons} evidence={f.evidence} snapshot={f.snapshot} files={[]} onSelect={()=>{}}/>);
 expect(html).toContain('Кандидат');expect(html).toContain('Уверенность не измерена');expect(html).toContain('Другие классы, элементы, прочность');expect(html).not.toMatch(/99%|NO_VIOLATION|Машинное предупреждение/);
 f.comparisons.results[0].comparison.calibratedProbability=.99;expect(buttons(SteelComparisonsPanel({comparisons:f.comparisons,evidence:f.evidence,files:[],onSelect:()=>{}}))).toHaveLength(0);
});
it('parent save wrapper retains all sibling scopes and CAS; explicit [] means withdrawal, omission does not create steel',()=>{
 const f=fixture(),input:any={sourceSha256:f.sources[0].file.sha256,revisionStatus:'CURRENT',approvalStatus:'APPROVED',sectionCode:'KR',linkGroupId:'group',pageStages:{},basis:{reference:'independent explicit source review'},expectedReviewHash:'a'.repeat(64),inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]},callInventoryScope:{schemaVersion:'matrix-call-inventory-review-v1',claims:[]},railInventoryScope:{schemaVersion:'matrix-rail-inventory-review-v1',claims:[]},waterNodeScope:{schemaVersion:'matrix-water-node-review-v1',claims:[]},lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[]}};
 const before=structuredClone(input);expect(withSteelReviewScope(input)).toEqual(before);expect(withSteelReviewScope(input)).not.toHaveProperty('steelComparisonScope');expect(withSteelReviewScope(input,{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]})).toEqual({...before,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}});expect(input).toEqual(before);
});
