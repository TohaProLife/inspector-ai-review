/** New call-domain DTO boundary; authored frozen fixtures, no source review store changes. */
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {it,describe} from "vitest";
import {CALL_INVENTORY_REVIEW_VERSION,callInventoryScopeDecisionToInput,
  matrixCallInventoryScopeInputSchema,matrixCallInventoryScopeDecisionSchema,
  type MatrixCallInventoryScopeDecision,type MatrixCallInventoryScopeInput} from "@inspector-ai/contracts";
import {parseCallInventoryScopeInput,parseCallInventoryScopeDecision,assertCallInventoryReviewNative,
  assertCallMaterializedSourceReviewEnvelope,assertCallInventorySnapshotAssociations,
  callInventoryScopeHashFields,validateCallInventoryReviewJsonBytes,CallInventoryReviewValidationError} from "../src/matrix-call-inventory-review.js";
import {callInventoryContentHash} from "../src/matrix-call-inventory-source.js";
import {canonicalJson} from "../src/canonical-json.js";
const D=new URL('../../../fixtures/matrix-call-comparison-v1/',import.meta.url);
const read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,D),'utf8'));
const manual=read('research-call-comparison-manual-goldens-v2.json');
const base=manual.cases[0].input;
const source=(stage='PD')=>structuredClone(base.sources.find((s:any)=>s.stages[0]===stage));
const decision=(stage='PD'):MatrixCallInventoryScopeDecision=>source(stage).review.callInventoryScope;
const association=(stage='PD')=>({sourceFileId:source(stage).sourceFileId,sourceSha256:source(stage).sourceSha256});
const request=()=>callInventoryScopeDecisionToInput(decision());
const code=(wanted:string)=>(error:unknown)=>error instanceof CallInventoryReviewValidationError&&error.code===wanted;
const rejectInput=(mutate:(x:any)=>void,wanted='INVALID_INPUT')=>{const x=request();mutate(x);assert.throws(()=>parseCallInventoryScopeInput(x),code(wanted));};
const rejectDecision=(mutate:(x:any)=>void,wanted='INVALID_INPUT')=>{const x=decision();mutate(x);assert.throws(()=>parseCallInventoryScopeDecision(x,association()),code(wanted));};
for(const stage of ['PD','RD'])it('full original synthetic snapshot internal consistency '+stage,()=>{
  const x=decision(stage),before=structuredClone(x);assert.deepEqual(parseCallInventoryScopeDecision(x,association(stage)),x);assert.deepEqual(x,before);
  const projected=callInventoryScopeDecisionToInput(x);assert.deepEqual(parseCallInventoryScopeInput(projected),projected);assert.equal('inventorySnapshot' in projected.claims[0],false);
});
it('UNKNOWN completeness and room mapping are retained without promotion',()=>{
 const x=decision();x.claims[0].assertion='UNKNOWN';x.claims[0].roomMapping.assertion='UNKNOWN';
 assert.deepEqual(parseCallInventoryScopeDecision(x,association()),x);
 const projected=callInventoryScopeDecisionToInput(x);assert.equal(parseCallInventoryScopeInput(projected).claims[0].assertion,'UNKNOWN');assert.equal(projected.claims[0].roomMapping.assertion,'UNKNOWN');
});
it('explicit empty claims is withdrawal, never fabricated source empty inventory',()=>{
 const x={schemaVersion:CALL_INVENTORY_REVIEW_VERSION,claims:[]};assert.deepEqual(parseCallInventoryScopeInput(x),x);assert.deepEqual(parseCallInventoryScopeDecision(x,association()),x);
});
for(const field of ['inventorySnapshot','actorId','contentHash','reviewContentHash','decisionId','confidence','calibratedProbability','physicalMissing','severity','parameterCode','ruleId','observationId','coverage','delta'])it('request rejects server/invented '+field,()=>rejectInput(x=>{x.claims[0][field]='forged';}));
for(const at of ['scope','target','selection','header','scopeFragment','end','identity','mapping'])it('unknown keys fail '+at,()=>rejectInput(x=>{
 const c=x.claims[0];const target=at==='scope'?x:at==='target'?c.target:at==='selection'?c.selection:at==='header'?c.selection.headerFragments[0]:at==='scopeFragment'?c.selection.scopeFragments[0]:at==='end'?c.selection.endFragments[0]:at==='identity'?c.identity:c.roomMapping;target.extra=true;
}));
it('request schema directly rejects echoed server decision',()=>assert.equal(matrixCallInventoryScopeInputSchema.safeParse(decision()).success,false));
it('server decision requires whole snapshot',()=>assert.equal(matrixCallInventoryScopeDecisionSchema.safeParse(request()).success,false));
it('selection requires all five fields, including end locator',()=>rejectInput(x=>{delete x.claims[0].selection.endFragments;}));
it('16 distinct requests accepted and17 rejected',()=>{
 const x=request();const original=x.claims[0];x.claims=Array.from({length:16},(_,i)=>{const c=structuredClone(original);c.target.inventoryContentHash=i.toString(16).padStart(64,'0');return c;});assert.equal(parseCallInventoryScopeInput(x).claims.length,16);x.claims.push(structuredClone(original));assert.throws(()=>parseCallInventoryScopeInput(x),code('INVALID_INPUT'));
});
it('same inventory cannot gain a second identity/origin',()=>rejectInput(x=>{const c=structuredClone(x.claims[0]);c.identity.entityKey='other-entity';c.target.checkId='other-origin';x.claims.push(c);},'DUPLICATE_INVENTORY'));
for(const value of ['я'.repeat(8),'😀'.repeat(1000),'\ufeffописание','исходные\tстроки'])it('unchanged Unicode reference accepted '+JSON.stringify(value).slice(0,20),()=>{const x=request();x.claims[0].reference=value;assert.equal(parseCallInventoryScopeInput(x).claims[0].reference,value);});
for(const value of ['я'.repeat(7),'😀'.repeat(1001),'        ',' пробелы','пробелы ','\u0085описание','описание\u001c','строка\nописание','строка\u0000описание','строка\u2028описание','строка\ufffdописание','сломано\ud800'])it('invalid reference '+JSON.stringify(value).slice(0,22),()=>rejectInput(x=>{x.claims[0].reference=value;}));
for(const value of ['OTHER',false,0,null])it('wrong role rejected '+String(value),()=>rejectInput(x=>{x.claims[0].identity.componentRole=value;}));
it('room token shape remains generic; no alias or automatic physical identity inference',()=>{
 const x=request();x.claims[0].roomMapping.sourceRoomToken='другое\tпомещение😀';assert.equal(parseCallInventoryScopeInput(x).claims[0].roomMapping.sourceRoomToken,'другое\tпомещение😀');
});
for(const value of [true,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])it('invalid integer geometry '+String(value),()=>rejectInput(x=>{x.claims[0].selection.pageNumber=value;}));
it('snapshot with zero features rejected structurally',()=>rejectDecision(x=>{x.claims[0].inventorySnapshot.featureRows=[];}));
it('snapshot malformed frame rejected structurally',()=>rejectDecision(x=>{x.claims[0].inventorySnapshot.widthMilliPoints=1;}));
for(const key of ['inventoryContentHash','textArtifactHash'])it('stale target '+key,()=>rejectDecision(x=>{x.claims[0].target[key]='0'.repeat(64);},'SNAPSHOT_MISMATCH'));
for(const at of ['headerFragments','scopeFragments','endFragments'])it('selection includes exact full original '+at,()=>rejectDecision(x=>{x.claims[0].selection[at][0].rawText+=' forged';},'SNAPSHOT_MISMATCH'));
it('rehashed source forgery still cannot pass source association',()=>rejectDecision(x=>{x.claims[0].inventorySnapshot.sourceFileId='forged';x.claims[0].target.inventoryContentHash=callInventoryContentHash(x.claims[0].inventorySnapshot);},'SOURCE_PROVENANCE_UNVERIFIED'));
it('internal consistency explicitly does not authenticate source raw text',()=>{
 const x=decision();x.claims[0].inventorySnapshot.featureRows[0].fragments[0].rawText='Измененный исходный текст';x.claims[0].target.inventoryContentHash=callInventoryContentHash(x.claims[0].inventorySnapshot);
 assert.doesNotThrow(()=>parseCallInventoryScopeDecision(x,association())); // Future materializer MUST independently reconstruct originals.
});
for(const c of read('ts-snapshot-association-vectors.json').cases)it('every-claim early snapshot guard: '+c.name,()=>{
 const s=c.input.sources.find((x:any)=>x.stages[0]==='PD');assert.throws(()=>parseCallInventoryScopeDecision(s.review.callInventoryScope,{sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256}),code(c.expected.reasonCode));
});
it('source descriptor required even for withdrawal',()=>{
 for(const sourceIdentity of [undefined,{}, {sourceFileId:'',sourceSha256:'a'.repeat(64)},{sourceFileId:' id',sourceSha256:'a'.repeat(64)},{sourceFileId:'id',sourceSha256:'INVALID'},{...association(),extra:true}])
 assert.throws(()=>parseCallInventoryScopeDecision({schemaVersion:CALL_INVENTORY_REVIEW_VERSION,claims:[]},sourceIdentity as any),code('INVALID_INPUT'));
});
it('projection deep copies all request fields and never leaks server snapshot',()=>{
 const x=decision(),before=structuredClone(x),projected=callInventoryScopeDecisionToInput(x),c=projected.claims[0];
 c.target.checkId='changed';c.selection.regionBoxMilliPoints[0]++;for(const group of [c.selection.headerFragments,c.selection.scopeFragments,c.selection.endFragments]){group[0].bboxMilliPoints[0]++;group[0].rawText='changed';}
 c.identity.roomKey='changed';c.roomMapping.sourceRoomToken='changed';c.reference='changed reference';assert.deepEqual(x,before);
 assert.deepEqual(Object.keys(projected.claims[0]).sort(),['target','selection','identity','roomMapping','assertion','reference'].sort());
});
it('omitted sibling leaves legacy full hash bytes unchanged',()=>{
 const body={objectId:'legacy-object',sourceFileId:'legacy-source',matrixScope:{claims:[]},inventoryScope:{claims:[]}};
 assert.equal(canonicalJson({...body,...callInventoryScopeHashFields(undefined)}),canonicalJson(body));assert.deepEqual(callInventoryScopeHashFields(undefined),{});
 const x=decision();assert.deepEqual(callInventoryScopeHashFields(x),{callInventoryScope:x});assert.notEqual(crypto.createHash('sha256').update(canonicalJson({...body,...callInventoryScopeHashFields(x)})).digest('hex'),crypto.createHash('sha256').update(canonicalJson(body)).digest('hex'));
});
const hostileCases=['rootProxy','snapshotProxy','getter','indexGetter','hole','arrayExtra','prototype','cycle','symbol','nonenumerable','bigint','unsafe','fraction','surrogate','nodes','depth','keyBytes','container'];
for(const operation of hostileCases)it('native guard '+operation+' executes zero user traps',()=>{
 let x:any=decision(),traps=0;const touched=()=>{traps++;throw Error('untrusted user code executed');};
 switch(operation){case'rootProxy':x=new Proxy(x,{get:touched,ownKeys:touched,getOwnPropertyDescriptor:touched,getPrototypeOf:touched});break;
 case'snapshotProxy':x.claims[0].inventorySnapshot=new Proxy(x.claims[0].inventorySnapshot,{get:touched,ownKeys:touched,getOwnPropertyDescriptor:touched,getPrototypeOf:touched});break;
 case'getter':Object.defineProperty(x.claims[0],'inventorySnapshot',{enumerable:true,get:touched});break;
 case'indexGetter':Object.defineProperty(x.claims,'0',{enumerable:true,get:touched});break;
 case'hole':delete x.claims[0];break;case'arrayExtra':x.claims.extra=true;break;case'prototype':Object.setPrototypeOf(x,{extra:true});break;
 case'cycle':x.extra=x;break;case'symbol':x[Symbol('evil')]=true;break;case'nonenumerable':Object.defineProperty(x,'extra',{value:true});break;
 case'bigint':x.extra=1n;break;case'unsafe':x.claims[0].selection.pageNumber=Number.MAX_SAFE_INTEGER+1;break;case'fraction':x.claims[0].selection.pageNumber=1.5;break;case'surrogate':x.extra='\ud800';break;
 case'nodes':x.extra=Array.from({length:20000},()=>({a:null,b:null,c:null,d:null,e:null,f:null}));break;
 case'depth':{let p=x;for(let i=0;i<66;i++){p.extra={};p=p.extra;}break;}
 case'keyBytes':x.extra=Object.fromEntries(Array.from({length:32768},(_,i)=>['界'.repeat(90)+i,null]));break;
 case'container':x.extra=Array.from({length:32769},()=>null);break;}
 assert.throws(()=>parseCallInventoryScopeDecision(x,association()),(e:unknown)=>e instanceof CallInventoryReviewValidationError);assert.equal(traps,0);
});
it('source descriptor getter rejected before execution',()=>{let calls=0;const s:any={sourceSha256:association().sourceSha256};Object.defineProperty(s,'sourceFileId',{enumerable:true,get(){calls++;throw Error('read getter');}});assert.throws(()=>assertCallInventorySnapshotAssociations(decision(),s),code('INVALID_INPUT'));assert.equal(calls,0);});
it('single TOTAL parent request budget, not per sibling',()=>{
 const parent={matrixScope:{reference:'a'.repeat(270000)},inventoryScope:{reference:'b'.repeat(270000)},callInventoryScope:request()};assert.throws(()=>assertCallInventoryReviewNative(parent),code('INPUT_LIMIT'));
});
it('single TOTAL materialized parent budget includes JSON punctuation',()=>{
 const parent={metadata:Array.from({length:8},()=>'x'.repeat(999997))};assert.ok(Buffer.byteLength(JSON.stringify(parent))>8000000);assert.throws(()=>assertCallMaterializedSourceReviewEnvelope(parent),code('INPUT_LIMIT'));
});
it('materialized full envelope is allowed above request cap with total bound',()=>{
 const parent={callInventoryScope:decision(),otherSibling:'x'.repeat(600000)};assert.doesNotThrow(()=>assertCallMaterializedSourceReviewEnvelope(parent));assert.throws(()=>assertCallInventoryReviewNative(parent),code('INPUT_LIMIT'));
});
it('portable string limit2M retained for materialized parent',()=>assert.throws(()=>assertCallMaterializedSourceReviewEnvelope({otherSibling:'x'.repeat(2000001)}),code('INPUT_LIMIT')));
for(const bytes of [Buffer.from('{"claims":[],"claims":[]}'),Buffer.from('{"a":{"x":1,"x":2}}'),Buffer.from([0xff]),Buffer.from('{"n":9007199254740992}')])it('raw JSON guard rejects duplicate/invalid/unsafe '+bytes.toString().slice(0,22),()=>assert.throws(()=>validateCallInventoryReviewJsonBytes(bytes),code('INVALID_INPUT')));
it('valid raw JSON receives no normalization/domain writes',()=>{const bytes=Buffer.from(JSON.stringify(request())),before=Buffer.from(bytes);assert.doesNotThrow(()=>validateCallInventoryReviewJsonBytes(bytes));assert.deepEqual(bytes,before);});
