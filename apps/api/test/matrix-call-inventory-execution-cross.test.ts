import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {buildCallInventoryComparisons,validateCallInventoryComparisonsEnvelope,mergeCallInventoryCoverage,deriveCallInventoryIdentities} from '../src/matrix-call-inventory-execution.js';
const read=(name:string)=>JSON.parse(readFileSync(new URL('../../../fixtures/matrix-call-execution-v1/'+name,import.meta.url),'utf8'));
const oracle=read('root-call-execution-goldens.json');
for(const file of ['research-call-execution-independent-probes.json','root-call-execution-cross-probes.json','research-call-execution-cross-added-probes.json','research-call-execution-duplicate-review-amendment-probes.json'])for(const c of read(file).cases.filter((c:any)=>!(file==='research-call-execution-cross-added-probes.json'&&c.name.includes('duplicate'))))it(file+':'+c.name,()=>{
 const run=()=>c.operation==='derive'?deriveCallInventoryIdentities(c.input):c.operation==='build'?buildCallInventoryComparisons(c.input):c.operation==='validate'?validateCallInventoryComparisonsEnvelope(c.input):c.operation==='merge'?mergeCallInventoryCoverage(c.input.coverage,c.input.envelope):buildCallInventoryComparisons(oracle.cases[0].package,c.input);
 if(c.expected==='VALUE_ERROR')expect(run).toThrow();else expect(run()).toEqual(c.expected);
});

for(const name of ['array-index-getter','review-getter','array-proxy','nested-review-proxy'])it('standalone derive zero traps '+name,()=>{
 let sources:any=structuredClone(oracle.cases[0].package.sources),traps=0;const touched=()=>{traps++;throw Error('untrusted trap');};
 if(name==='array-index-getter')Object.defineProperty(sources,'0',{enumerable:true,get:touched});
 if(name==='review-getter')Object.defineProperty(sources[0],'review',{enumerable:true,get:touched});
 if(name==='array-proxy')sources=new Proxy(sources,{get:touched,ownKeys:touched,getPrototypeOf:touched});
 if(name==='nested-review-proxy')sources[0].review=new Proxy(sources[0].review,{get:touched,ownKeys:touched,getPrototypeOf:touched});
 expect(()=>deriveCallInventoryIdentities(sources)).toThrow();expect(traps).toBe(0);
});
