/** Production relocation of independent T42 UI assertions; SSR and component events only. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React, {createElement,isValidElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it} from "vitest";
import type {MatrixInventoryComparisons,MatrixInventoryExecutionResult,MatrixInventoryComparisonEvidence} from "@inspector-ai/contracts";
import {InventoryComparisonsPanel,inventoryFragmentEvidence} from "./InventoryComparisonsPanel";

describe("reviewed inventory candidate presentation",()=>{
const clone=<T,>(a:T):T=>structuredClone(a);
const identity={entityKey:'Узел П-01',componentRole:'PARTITION_SLAB_JOINT',componentKey:'Перегородка П-01',zoneKey:'Этаж 2',operatingModeKey:'DECLARED_NOISE_PROTECTION_MEASURES',measurementBasisKey:'SOURCE_AUTHORED_MEASURE_MEMBERSHIP'}as const;
const reference=(role:string)=>({sourceFileId:role==='EXPECTED'?'FROZEN-PD':'FROZEN-RD',sourceSha256:(role==='EXPECTED'?'a':'b').repeat(64),reviewDecisionId:role==='EXPECTED'?'REVIEW-PD-OLD':'REVIEW-RD-OLD',reviewContentHash:(role==='EXPECTED'?'c':'d').repeat(64),inventoryContentHash:(role==='EXPECTED'?'e':'f').repeat(64)});
const row={schemaVersion:'matrix-inventory-execution-result-v1',id:'1'.repeat(64),ruleId:'matrix-ar-053-declared_joint_damping_tape_omission',ruleVersion:'1',parameterCode:'AR-053',comparisonVariant:'PD_RD',kind:'SCOPED_COMPARISON',identity,
 comparison:{schemaVersion:'matrix-ar053-inventory-comparison-v1',status:'CANDIDATE',ruleId:'matrix-ar-053-declared_joint_damping_tape_omission',ruleVersion:'1',parameterCode:'AR-053',reasonCode:'DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION',calibratedProbability:null,comparisonScope:'REVIEWED_DECLARED_REGIONS_ONLY',identity,expected:reference('EXPECTED'),actual:reference('ACTUAL'),missingFeatureKeys:['DAMPING_TAPE']}}as MatrixInventoryExecutionResult;
const artifact={schemaVersion:'matrix-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:'OBJECT-QA',inputManifestHash:'2'.repeat(64),capabilityRegistryHash:'3'.repeat(64),results:[row]}as MatrixInventoryComparisons;
const raw='Демпферная лента <по проекту> & исходный хвост\u202f😀';
const item=(role:'EXPECTED'|'ACTUAL'='EXPECTED',fragmentRole:'FEATURE'|'HEADER'|'SCOPE'='FEATURE'):MatrixInventoryComparisonEvidence=>({resultId:row.id,role,...reference(role),originCheckId:'SEALED-ORIGIN-OLD',pageNumber:2,pageFrame:{widthMilliPoints:100000,heightMilliPoints:100000},fragmentRole,fragment:{pageNumber:2,blockIndex:5,lineIndex:0,rawText:role==='EXPECTED'?raw:'Акустическая прокладка',bboxMilliPoints:[10000,20000,30000,30000]}});
const evidence=[...['EXPECTED','ACTUAL'].flatMap(role=>['HEADER','SCOPE','FEATURE'].map(kind=>item(role as any,kind as any)))];
const render=(props:any={})=>renderToStaticMarkup(createElement(InventoryComparisonsPanel,{comparisons:artifact,evidence,files:[],onSelect:()=>{},...props}));
it('SSR candidate label ignores forged adjacent presentation and forged numeric confidence',()=>{
 const forged=clone(artifact);(forged.results[0]as any).presentation={classification:'WARNING',calibratedProbability:.99};(forged.results[0]as any).comparison.calibratedProbability=.99;
 const html=render({comparisons:forged,presentations:[{resultId:row.id,classification:'WARNING',label:'Подтверждённая ошибка',probability:.99}]});
 assert.match(html,/АР-053 · Кандидат/);assert.match(html,/Уверенность не измерена/);assert.match(html,/Кандидатов: 1 · Областей без вывода: 0/);
 assert.doesNotMatch(html,/99%|80%|Подтверждённая ошибка|Машинное предупреждение|Нарушений нет|NO_VIOLATION/);
 assert.match(html,/Полное отсутствие ленты на объекте и замену материала этот вывод не подтверждает/);
});
it('SSR full exact raw Unicode fragments escaped once; all6 buttons present',()=>{
 const html=render();assert.match(html,/Демпферная лента &lt;по проекту&gt; &amp; исходный хвост\u202f😀/);assert.equal((html.match(/Открыть оригинал/g)||[]).length,6);assert.match(html,/PDF 2/);assert.match(html,/REVIEW-PD-OLD/);assert.match(html,/REVIEW-RD-OLD/);
});
it('SSR historical no sibling yields empty markup',()=>assert.equal(render({comparisons:undefined}),''));
it('SSR unbound UNKNOWN unsupported and negative abstentions never promoted',()=>{
 const names=['HUMAN_COMPLETENESS_UNVERIFIED','SOURCE_STAGE_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED','UNSUPPORTED_FUTURE_GATE'];
 const rows=names.map((reason,i)=>({...clone(row),id:String(i+4).repeat(64),comparison:{schemaVersion:'matrix-ar053-inventory-comparison-v1',status:'ABSTAIN',reasonCode:reason,calibratedProbability:null}}));
 rows.push({...clone(row),kind:'UNBOUND_ATOM_ABSTENTION',id:'9'.repeat(64),reasonCode:'REVIEWED_INVENTORY_IDENTITY_MISSING',calibratedProbability:null}as any);
 const html=render({comparisons:{...artifact,results:rows}});assert.match(html,/Кандидатов: 0 · Областей без вывода: 5/);assert.match(html,/Почему сравнение ограничено: 5/);assert.match(html,/не заключение об отсутствии нарушений/);assert.doesNotMatch(html,/Открыть оригинал|АР-053 · Кандидат|Нарушений нет|NO_VIOLATION/);
});
it('frozen refs mismatches rejected without latest review fallback',()=>{
 for(const key of ['sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','inventoryContentHash','resultId']){
  const e=item();(e as any)[key]='LATEST-OR-FORGED';assert.equal(inventoryFragmentEvidence(row,e),null,key);
 }
 const latest=item();latest.reviewDecisionId='REVIEW-LATEST';latest.reviewContentHash='4'.repeat(64);
 const html=render({evidence:[latest],files:[{id:'FROZEN-PD',sha256:'4'.repeat(64),name:'LATEST FILE SHOULD NOT MATCH'}]});
 assert.match(html,/Оригинальные фрагменты для сохранённой ссылки недоступны/);assert.doesNotMatch(html,/Открыть оригинал|LATEST FILE SHOULD NOT MATCH/);assert.match(html,/REVIEW-PD-OLD/);
});
it('source original PDF bbox uses established bottom-left to top-left conversion',()=>{
 const original=inventoryFragmentEvidence(row,item());assert.ok(original);assert.deepEqual(original.bbox,[.1,.7,.3,.8]);assert.equal(original.stage,'PD');assert.equal(original.pageNumber,2);assert.equal(original.sourceSha256,'a'.repeat(64));
});
it('actual reference gives RD stage and same original coordinate conversion',()=>{
 const original=inventoryFragmentEvidence(row,item('ACTUAL'));assert.ok(original);assert.equal(original.stage,'RD');assert.deepEqual(original.bbox,[.1,.7,.3,.8]);
});
it('page/frame/box numeric and cross-page mismatch rejects',()=>{
 const changes:Array<(e:any)=>void>=[e=>e.pageNumber=0,e=>e.pageNumber=10001,e=>e.pageNumber=2.5,e=>e.fragment.pageNumber=3,e=>e.pageFrame.widthMilliPoints=0,e=>e.pageFrame.heightMilliPoints=-1,e=>e.pageFrame.widthMilliPoints=1.2,e=>e.pageFrame.heightMilliPoints=Number.MAX_SAFE_INTEGER+1,e=>e.fragment.bboxMilliPoints=[1,2,3],e=>e.fragment.bboxMilliPoints=[0,0,1,2,3],e=>e.fragment.bboxMilliPoints=[0,0,100001,1],e=>e.fragment.bboxMilliPoints=[-1,0,1,2],e=>e.fragment.bboxMilliPoints=[0,0,0,2],e=>e.fragment.bboxMilliPoints=[0,2,1,1],e=>e.fragment.bboxMilliPoints=[0,0,1.5,2],e=>e.fragment.bboxMilliPoints=[0,0,NaN,2]];
 for(const change of changes){const e=item();change(e);assert.equal(inventoryFragmentEvidence(row,e),null);}
});
it('native sparse bbox cannot produce NaN viewer locator',()=>{
 const e=item();e.fragment.bboxMilliPoints=[10000,,30000,30000]as any;assert.equal(inventoryFragmentEvidence(row,e),null);
});
it('noncandidate/unbound/role mismatch produce no original locator',()=>{
 for(const modified of [{...clone(row),kind:'UNBOUND_ATOM_ABSTENTION'},{...clone(row),comparison:{status:'ABSTAIN'}}])assert.equal(inventoryFragmentEvidence(modified as any,item()),null);
 const e=item();e.role='LATEST'as any;assert.equal(inventoryFragmentEvidence(row,e),null);
});
it('click forwards exact frozen original evidence once without mutation',()=>{
 const selected:any[]=[];const input=clone(evidence);const before=clone(input);
 const tree=InventoryComparisonsPanel({comparisons:artifact,evidence:input,files:[],onSelect:e=>selected.push(e)});
 const buttons:any[]=[];const walk=(node:any)=>{if(!isValidElement(node))return;const el=node as React.ReactElement<any>;if(el.type==='button')buttons.push(el);React.Children.forEach(el.props.children,walk);};walk(tree);
 assert.equal(buttons.length,6);buttons[0].props.onClick();assert.equal(selected.length,1);assert.deepEqual(selected[0],inventoryFragmentEvidence(row,input[0]));assert.ok(selected[0]);assert.deepEqual(input,before);assert.equal(selected[0].sourceFileId,'FROZEN-PD');
});

});

describe("frozen original inventory fragments",()=>{
const oracle=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-inventory-execution-v1/reviewed-wrapper-goldens.json',import.meta.url),'utf8'));const fixture=oracle.cases[0];const row=fixture.expectedEnvelope.results[0],items:any[]=[];
for(const role of ['EXPECTED','ACTUAL']){
 const reference=role==='EXPECTED'?row.comparison.expected:row.comparison.actual;
 const source=fixture.package.sources.find((s:any)=>s.sourceFileId===reference.sourceFileId);
 const claim=source.review.inventoryScope.claims[0],snapshot=claim.inventorySnapshot;
 const origin=fixture.package.origins.find((o:any)=>o.checkId===claim.target.checkId&&o.sourceFileId===source.sourceFileId);
 const page=origin.textArtifact.pages.find((v:any)=>v.pageNumber===snapshot.pageNumber);
 const groups=[['HEADER',snapshot.headerFragments],['SCOPE',snapshot.scopeFragments],['FEATURE',snapshot.featureRows.flatMap((v:any)=>v.fragments)]];
 for(const[fragmentRole,fragments]of groups)for(const fragment of fragments as any[]){
  assert.equal(fragment.rawText,page.blocks[fragment.blockIndex].text.split('\n')[fragment.lineIndex]);
  assert.deepEqual(fragment.bboxMilliPoints,page.blocks[fragment.blockIndex].lineBboxesMilliPoints[fragment.lineIndex]);
  items.push({resultId:row.id,role,...reference,originCheckId:origin.checkId,pageNumber:fragment.pageNumber,pageFrame:{widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints},fragmentRole,fragment:structuredClone(fragment)});
 }
}
it('all7 authentic original raw/boxes retained in normalized viewer locators',()=>{
 assert.equal(items.length,7);
 for(const item of items){const e=inventoryFragmentEvidence(row,item)!;assert.ok(e);assert.equal(e.value,item.fragment.rawText);assert.equal(e.sourceFileId,item.sourceFileId);assert.equal(e.sourceSha256,item.sourceSha256);assert.equal(e.pageNumber,item.pageNumber);const[b0,b1,b2,b3]=item.fragment.bboxMilliPoints;const{widthMilliPoints:w,heightMilliPoints:h}=item.pageFrame;assert.deepEqual(e.bbox,[b0/w,(h-b3)/h,b2/w,(h-b1)/h].map((v,i)=>i%2===0?v:1-item.fragment.bboxMilliPoints[i===1?3:1]/h));assert.ok(e.bbox!.every(Number.isFinite));}
});
it('all7 buttons dispatch corresponding full frozen original fragment and no alias',()=>{
 const input=structuredClone(items),before=structuredClone(input),selected:any[]=[];
 const tree=InventoryComparisonsPanel({comparisons:fixture.expectedEnvelope,evidence:input,files:[],onSelect:e=>selected.push(e)}),buttons:any[]=[];
 const walk=(node:any)=>{if(!isValidElement(node))return;const e=node as React.ReactElement<any>;if(e.type==='button')buttons.push(e);React.Children.forEach(e.props.children,walk);};walk(tree);
 assert.equal(buttons.length,7);buttons.forEach(b=>b.props.onClick());assert.equal(selected.length,7);
 selected.forEach((e,i)=>{assert.deepEqual(e,inventoryFragmentEvidence(row,input[i]));assert.ok(e);assert.equal(e.value,input[i].fragment.rawText);});assert.deepEqual(input,before);selected[0].bbox[0]=9;assert.deepEqual(input,before);
});
it('canonical frame exact width-height only; no synthetic rotation in evidence',()=>{
 for(const item of items){assert.deepEqual(Object.keys(item.pageFrame).sort(),['heightMilliPoints','widthMilliPoints']);assert.ok(inventoryFragmentEvidence(row,item));}
});
it('malformed native box shapes cannot create viewer locators',()=>{
 for(const box of [{0:1,1:2,2:3,3:4,length:4},new Int32Array([1,2,3,4]),Array(4),[1,undefined,3,4],[1,null,3,4]]){const item=structuredClone(items[0]);item.fragment.bboxMilliPoints=box as any;assert.equal(inventoryFragmentEvidence(row,item),null);}
});
it('latest evidence fragments never replace frozen references even if source bytes unchanged',()=>{
 const latest=structuredClone(items);latest.forEach(i=>{i.reviewDecisionId='LATEST';i.reviewContentHash='0'.repeat(64);i.fragment.rawText='INJECTED LATEST CONTENT';});
 const html=renderToStaticMarkup(createElement(InventoryComparisonsPanel,{comparisons:fixture.expectedEnvelope,evidence:latest,files:[],onSelect:()=>{}}));assert.ok(!html.includes('INJECTED LATEST CONTENT'));assert.equal((html.match(/Оригинальные фрагменты для сохранённой ссылки недоступны/g)||[]).length,2);assert.ok(!html.includes('Открыть оригинал'));
});

});
