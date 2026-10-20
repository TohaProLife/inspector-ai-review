/** Independent T53 review expectations frozen before new boundary implementation. */
import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseWaterNodeScopeInput,parseWaterNodeScopeDecision,assertWaterNodeSnapshotAssociations,
 assertWaterNodeReviewNative,assertWaterNodeMaterializedSourceReviewEnvelope,validateWaterNodeReviewJsonBytes,
 waterNodeScopeHashFields,WaterNodeReviewValidationError} from '../src/matrix-water-node-review.js';
import {matrixWaterNodeScopeInputSchema,matrixWaterNodeScopeDecisionSchema,matrixWaterNodeSourceInventorySchema,
 waterNodeScopeDecisionToInput} from '../../../packages/contracts/src/matrix-water-node-review.js';

const path=new URL('../../../fixtures/matrix-water-node-comparison-v1/research-manual-projection-goldens-final.json',import.meta.url);
const bytes=fs.readFileSync(path);
expect(createHash('sha256').update(bytes).digest('hex')).toBe('302e6fcad47c07352769f8550f4e4ce3713f9a1c39c9f7b34a9a1a14efe61797');
const manual=JSON.parse(bytes.toString('utf8'));
const base=()=>structuredClone(manual.fixtures[0].input);
const scope=()=>base().sources[0].review.waterNodeScope;
const assoc=()=>({sourceFileId:base().sources[0].sourceFileId,sourceSha256:base().sources[0].sourceSha256});
const request=(saved:any)=>({schemaVersion:saved.schemaVersion,claims:saved.claims.map((c:any)=>{const {inventorySnapshot,...input}=c;return input;})});
function rejects(code:string,fn:()=>unknown){expect(fn).toThrowError(WaterNodeReviewValidationError);try{fn();}catch(e){expect((e as WaterNodeReviewValidationError).code).toBe(code);}}

describe('water-node strict request/materialized review boundary',()=>{
 for(const vector of manual.helperCases)it(`independent helper ${vector.name}`,()=>{
  if(vector.expected===null){expect(()=>vector.operation==='validate'?parseWaterNodeScopeInput(vector.input):parseWaterNodeScopeDecision(vector.input,assoc())).toThrowError(WaterNodeReviewValidationError);return;}
  const out=vector.operation==='validate'?parseWaterNodeScopeInput(vector.input):waterNodeScopeDecisionToInput(parseWaterNodeScopeDecision(vector.input,assoc()));
  expect(out).toEqual(vector.expected);
 });
 it('accepts all8 frozen candidate scopes without authority inference',()=>{
  let scopes=0;
  for(const fixture of manual.fixtures.filter((f:any)=>f.expected.status==='CANDIDATE'))for(const source of fixture.input.sources){
   const saved=source.review.waterNodeScope;
   expect(parseWaterNodeScopeDecision(saved,{sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256})).toEqual(saved);scopes++;
  }
  expect(scopes).toBe(8);
 });
 it('strict schemas distinguish client locator from server snapshot',()=>{
  expect(matrixWaterNodeScopeInputSchema.safeParse(scope()).success).toBe(false);
  expect(matrixWaterNodeScopeInputSchema.safeParse(request(scope())).success).toBe(true);
  expect(matrixWaterNodeScopeDecisionSchema.safeParse(scope()).success).toBe(true);
  expect(matrixWaterNodeSourceInventorySchema.safeParse(scope().claims[0].inventorySnapshot).success).toBe(true);
  for(const extra of ['complete','calibratedProbability','entityKey','attribute','ruleId']){
   const s=request(scope());s.claims[0][extra]=true;rejects('INVALID_INPUT',()=>parseWaterNodeScopeInput(s));
  }
 });
 it('requires exact source/snapshot versions, four scopes and one fragment per feature',()=>{
  const mutations=[(s:any)=>s.claims[0].inventorySnapshot.scopeFragments.pop(),
   (s:any)=>s.claims[0].inventorySnapshot.featureRows[0].fragments.push(structuredClone(s.claims[0].inventorySnapshot.featureRows[0].fragments[0])),
   (s:any)=>s.claims[0].inventorySnapshot.policyVersion='rail-policy',
   (s:any)=>s.claims[0].inventorySnapshot.nodeToken='a'.repeat(81),
   (s:any)=>s.claims[0].inventorySnapshot.buildingToken='Б 101',
   (s:any)=>s.claims[0].inventorySnapshot.service='HOT_WATER'];
  for(const mutate of mutations){const s=scope();mutate(s);rejects('INVALID_INPUT',()=>parseWaterNodeScopeDecision(s,assoc()));}
 });
 it('requires every original fragment own page/frame and positive safe integers',()=>{
  for(const field of ['headerFragments','scopeFragments','endFragments','featureRows'])for(const variant of ['page','frame','unsafe','fraction','bool']){
   const s=scope(),f=field==='featureRows'?s.claims[0].inventorySnapshot.featureRows[0].fragments[0]:s.claims[0].inventorySnapshot[field][0];
   if(variant==='page')f.pageNumber=2;else if(variant==='frame')f.bboxMilliPoints[2]=999999;
   else if(variant==='unsafe')f.blockIndex=Number.MAX_SAFE_INTEGER+1;else if(variant==='fraction')f.lineIndex=0.5;else f.pageNumber=true;
   rejects('INVALID_INPUT',()=>parseWaterNodeScopeDecision(s,assoc()));
  }
 });
 it('detaches parser and browser projection at all original nested lines',()=>{
  const s=scope(),before=JSON.stringify(s),parsed=parseWaterNodeScopeDecision(s,assoc()),projected=waterNodeScopeDecisionToInput(parsed);
  expect(projected).toEqual(request(s));expect(projected.claims[0]).not.toHaveProperty('inventorySnapshot');
  projected.claims[0]!.selection.scopeFragments[0]!.bboxMilliPoints[0]=1;
  parsed.claims[0]!.inventorySnapshot.featureRows[0]!.fragments[0]!.rawText='mutated';
  expect(JSON.stringify(s)).toBe(before);
  const req=request(s),copy=parseWaterNodeScopeInput(req);copy.claims[0]!.nodeMapping.sourceNodeToken='mutated';expect(copy).not.toEqual(req);
 });
 it('checks whole target hash, text hash and full selection including END',()=>{
  for(const change of ['hash','textHash','end','scope','region']){
   const s=scope(),c=s.claims[0];
   if(change==='hash')c.target.inventoryContentHash='a'.repeat(64);
   else if(change==='textHash')c.target.textArtifactHash='a'.repeat(64);
   else if(change==='region')c.selection.regionBoxMilliPoints[0]=1;
   else c.selection[change==='end'?'endFragments':'scopeFragments'][0].rawText+=' ';
   rejects('SNAPSHOT_MISMATCH',()=>parseWaterNodeScopeDecision(s,assoc()));
  }
 });
 it('binds ALL snapshots to authenticated exact source IDs/SHA, UNKNOWN included',()=>{
  const s=scope();s.claims[0].assertion='UNKNOWN';s.claims[0].identity.nodeKey='unrelated';
  rejects('SOURCE_PROVENANCE_UNVERIFIED',()=>parseWaterNodeScopeDecision(s,{...assoc(),sourceFileId:'foreign'}));
  rejects('SOURCE_PROVENANCE_UNVERIFIED',()=>assertWaterNodeSnapshotAssociations(s,{...assoc(),sourceSha256:'a'.repeat(64)}));
  const two=scope();two.claims.push(base().sources[1].review.waterNodeScope.claims[0]);
  rejects('SOURCE_PROVENANCE_UNVERIFIED',()=>parseWaterNodeScopeDecision(two,assoc()));
 });
 it('rejects sibling duplicate hashes irrespective of identity/check or assertion',()=>{
  const s=scope();s.claims.push(structuredClone(s.claims[0]));s.claims[1].identity.nodeKey='other';s.claims[1].assertion='UNKNOWN';s.claims[1].target.checkId='CHK-OTHER';
  rejects('DUPLICATE_INVENTORY',()=>parseWaterNodeScopeInput(request(s)));
  rejects('DUPLICATE_INVENTORY',()=>parseWaterNodeScopeDecision(s,assoc()));
 });
 it('preserves omission hash bytes and explicit empty withdrawal',()=>{
  const legacy={sourceSha256:'a'.repeat(64),basis:'legacy'};
  expect(JSON.stringify({...legacy,...waterNodeScopeHashFields(undefined)})).toBe(JSON.stringify(legacy));
  const empty={schemaVersion:'matrix-zu129-water-node-review-v1' as const,claims:[]};
  expect(parseWaterNodeScopeInput(empty)).toEqual(empty);expect(parseWaterNodeScopeDecision(empty,assoc())).toEqual(empty);
  expect(waterNodeScopeHashFields(empty)).toEqual({waterNodeScope:empty});
 });
 it('preserves raw Unicode and reference/codepoint limits, no trim/aliases',()=>{
  const s=request(scope());s.claims[0].identity.entityKey='🙂'.repeat(200);expect(parseWaterNodeScopeInput(s)).toEqual(s);
  for(const bad of ['🙂'.repeat(201),'\u0085leading','trailing ','bad\nkey','\ud800']){const v=request(scope());v.claims[0].identity.entityKey=bad;rejects('INVALID_INPUT',()=>parseWaterNodeScopeInput(v));}
  for(const bad of ['a'.repeat(7),'a'.repeat(1001),'leading reference ',' '.repeat(8),'bad\nreference']){const v=request(scope());v.claims[0].reference=bad;rejects('INVALID_INPUT',()=>parseWaterNodeScopeInput(v));}
 });
 it('native guard invokes zero getter/proxy/toJSON callbacks, even nested',()=>{
  let traps=0;const getter:any={};Object.defineProperty(getter,'claims',{enumerable:true,get(){traps++;throw Error('getter');}});
  const proxy=new Proxy({},{get(){traps++;throw Error('get');},ownKeys(){traps++;throw Error('ownKeys');},getPrototypeOf(){traps++;throw Error('proto');}});
  const json={toJSON(){traps++;throw Error('toJSON');}};
  for(const value of [getter,proxy,json])for(const run of [()=>parseWaterNodeScopeInput(value),()=>assertWaterNodeReviewNative(value),()=>assertWaterNodeReviewNative({nested:value},'MATERIALIZED')])rejects('INVALID_INPUT',run);
  const source:any={};Object.defineProperty(source,'sourceFileId',{enumerable:true,get(){traps++;throw Error('source');}});
  rejects('INVALID_INPUT',()=>parseWaterNodeScopeDecision(scope(),source));expect(traps).toBe(0);
 });
 it('rejects cycles, sparse/extra arrays, custom native shapes and unsafe scalars',()=>{
  const cyclic:any={};cyclic.self=cyclic;const sparse=Array(2);const extra:any=[];extra.extra=1;
  for(const value of [cyclic,sparse,extra,new Date(),new Set(),Object.create(null),()=>1,Symbol('x'),1n,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1,'\ud800'])rejects('INVALID_INPUT',()=>assertWaterNodeReviewNative(value));
 });
 it('bounds TOTAL parent REQUEST512KiB and MATERIALIZED8M with punctuation',()=>{
  rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative({a:'a'.repeat(524288)}));
  expect(()=>assertWaterNodeReviewNative({a:'a'.repeat(600000)},'MATERIALIZED')).not.toThrow();
  rejects('INPUT_LIMIT',()=>assertWaterNodeMaterializedSourceReviewEnvelope({a:'a'.repeat(2000000),b:'a'.repeat(2000000),c:'a'.repeat(2000000),d:'a'.repeat(2000000)}));
  rejects('INPUT_LIMIT',()=>assertWaterNodeMaterializedSourceReviewEnvelope({scalarSibling:'x'.repeat(1000000),waterNodeScope:{a:'x'.repeat(1800000),b:'x'.repeat(1800000),c:'x'.repeat(1800000),d:'x'.repeat(1800000)}}));
 });
 it('bounds2M codepoints, key UTF8, nodes, containers, depth and16claims',()=>{
  rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative({a:'x'.repeat(2000001)},'MATERIALIZED'));
  rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative({['я'.repeat(270000)]:null}));
  rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative({a:Array(32769).fill(null)},'MATERIALIZED'));
  rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative({a:Array.from({length:7},()=>Array(30000).fill(null))},'MATERIALIZED'));
  let deep:any=null;for(let i=0;i<66;i++)deep=[deep];rejects('INPUT_LIMIT',()=>assertWaterNodeReviewNative(deep,'MATERIALIZED'));
  const many=request(scope());many.claims=Array.from({length:17},()=>structuredClone(many.claims[0]));rejects('INVALID_INPUT',()=>parseWaterNodeScopeInput(many));
 });
 it('preparse bytes reject duplicate escaped keys, invalid UTF8, unsafe JSON and total bytes',()=>{
  for(const value of ['{"claims":[],"clai\\u006ds":[]}','{"n":9007199254740992}','{"n":0.5}','{"a":"\\ud800"}','{}{}'])rejects('INVALID_INPUT',()=>validateWaterNodeReviewJsonBytes(Buffer.from(value)));
  rejects('INVALID_INPUT',()=>validateWaterNodeReviewJsonBytes(Buffer.from([0xc3,0x28])));
  rejects('INPUT_LIMIT',()=>validateWaterNodeReviewJsonBytes(Buffer.alloc(524289,0x20)));
  expect(()=>validateWaterNodeReviewJsonBytes(Buffer.from(JSON.stringify(request(scope()))))).not.toThrow();
 });
});
