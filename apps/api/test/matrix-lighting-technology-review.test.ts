/** T66 expectations frozen before the review boundary implementation. */
import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseLightingTechnologyScopeInput,parseLightingTechnologyScopeDecision,assertLightingTechnologySnapshotAssociations,
 assertLightingTechnologyReviewNative,assertLightingTechnologyMaterializedSourceReviewEnvelope,validateLightingTechnologyReviewJsonBytes,
 lightingTechnologyScopeHashFields,LightingTechnologyReviewValidationError} from '../src/matrix-lighting-technology-review.js';
import {matrixLightingTechnologyScopeInputSchema,matrixLightingTechnologyScopeDecisionSchema,matrixLightingTechnologySelectionSchema,
 lightingTechnologyScopeDecisionToInput} from '../../../packages/contracts/src/matrix-lighting-technology-review.js';
const bytes=fs.readFileSync(new URL('../../../fixtures/matrix-lighting-technology-comparison-v1/qa-manual-whole-goldens-v2.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('cb901f74d68fdab8efbc26cfce51d120eeeb3f7f7d9862beeec0c75af75e05fe');
const manual=JSON.parse(bytes.toString('utf8'));
const saved=()=>structuredClone(manual.helperCases.find((v:any)=>v.name==='project-valid-decision-drops-snapshot').input);
const association=()=>({sourceFileId:saved().claims[0].declarationSnapshot.sourceFileId,sourceSha256:saved().claims[0].declarationSnapshot.sourceSha256});
const request=(scope:any)=>({schemaVersion:scope.schemaVersion,claims:scope.claims.map((c:any)=>{const {declarationSnapshot,...r}=c;return r;})});
function rejects(code:string,run:()=>unknown){expect(run).toThrowError(LightingTechnologyReviewValidationError);try{run();}catch(e){expect((e as LightingTechnologyReviewValidationError).code).toBe(code);}}
describe('lighting strict source-local review boundary',()=>{
 for(const vector of manual.helperCases)it(`frozen helper ${vector.name}`,()=>{
  const run=()=>vector.operation==='request'?parseLightingTechnologyScopeInput(vector.input):lightingTechnologyScopeDecisionToInput(parseLightingTechnologyScopeDecision(vector.input,association()));
  if(vector.expected===null)expect(run).toThrowError(LightingTechnologyReviewValidationError);else expect(run()).toEqual(vector.expected);
 });
 it('separates strict request and server snapshots, including nested extra keys',()=>{
  expect(matrixLightingTechnologyScopeInputSchema.safeParse(saved()).success).toBe(false);
  expect(matrixLightingTechnologyScopeDecisionSchema.safeParse(saved()).success).toBe(true);
  for(const key of ['complete','authority','ruleId','calibratedProbability']){const s=request(saved());s.claims[0][key]=true;rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(s));}
  const s=request(saved());s.claims[0].selection.fragments[0].bboxMilliPoints=[0,0,1,1];rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(s));
 });
 it('exact selection schema: page512, one/two raw LF fragments and full native paths',()=>{
  const s=request(saved()).claims[0].selection;s.pageNumber=512;s.fragments[0].sourcePath=Array(64).fill(32767);
  expect(matrixLightingTechnologySelectionSchema.safeParse(s).success).toBe(true);
  for(const change of ['page','path','count','raw']){const v=structuredClone(s);if(change==='page')v.pageNumber=513;else if(change==='path')v.fragments[0].sourcePath.push(0);else if(change==='count')v.fragments=[];else v.fragments[0].rawText='';expect(matrixLightingTechnologySelectionSchema.safeParse(v).success).toBe(false);}
 });
 it('detaches browser projection and parsers without losing UNKNOWN/raw LF',()=>{
  const s=saved();s.claims[0].positionMapping.assertion='UNKNOWN';const before=JSON.stringify(s),parsed=parseLightingTechnologyScopeDecision(s,association());
  const projected=lightingTechnologyScopeDecisionToInput(parsed);expect(projected).toEqual(request(s));expect(projected.claims[0]).not.toHaveProperty('declarationSnapshot');
  projected.claims[0]!.selection.fragments[0]!.sourcePath[0]=99;parsed.claims[0]!.declarationSnapshot.primaryFragments[0]!.rawText='changed';
  expect(JSON.stringify(s)).toBe(before);const r=request(s),copy=parseLightingTechnologyScopeInput(r);copy.claims[0]!.identity.entityKey='changed';expect(copy).not.toEqual(r);
 });
 it('rejects scope-global duplicate hashes across unrelated/UNKNOWN identities',()=>{
  const s=saved();s.claims.push(structuredClone(s.claims[0]));s.claims[1].positionMapping.assertion='UNKNOWN';s.claims[1].identity.positionKey='other';s.claims[1].target.checkId='CHK-OTHER';
  rejects('DUPLICATE_DECLARATION',()=>parseLightingTechnologyScopeInput(request(s)));rejects('DUPLICATE_DECLARATION',()=>parseLightingTechnologyScopeDecision(s,association()));
 });
 it('all snapshots must match the authenticated enclosing ID/SHA',()=>{
  const s=saved();s.claims[0].positionMapping.assertion='UNKNOWN';s.claims[0].identity.positionKey='unrelated';
  rejects('SOURCE_PROVENANCE_UNVERIFIED',()=>parseLightingTechnologyScopeDecision(s,{...association(),sourceFileId:'FOREIGN'}));
  rejects('SOURCE_PROVENANCE_UNVERIFIED',()=>assertLightingTechnologySnapshotAssociations(s,{...association(),sourceSha256:'a'.repeat(64)}));
 });
 it('requires exact full hash/selection and parser-bound literal fields',()=>{
  for(const kind of ['hash','text','path','raw','technology','position','range','geometry']){
   const s=saved(),c=s.claims[0],d=c.declarationSnapshot;
   if(kind==='hash')c.target.declarationContentHash='a'.repeat(64);else if(kind==='text')c.target.textArtifactHash='a'.repeat(64);
   else if(kind==='path')c.selection.fragments[0].sourcePath[0]=99;else if(kind==='raw')c.selection.fragments[0].rawText+=' ';
   else if(kind==='technology')d.rawTechnology='FLUORESCENT';else if(kind==='position')d.positionLabel='OTHER';
   else if(kind==='range')d.primaryFragments[0].usedTextRange.end--;else d.nativeFrame.visibleBoxPointStrings=['0','0','0','0'];
   rejects('SNAPSHOT_MISMATCH',()=>parseLightingTechnologyScopeDecision(s,association()));
  }
 });
 it('follows structural canonical snapshot bounds before semantic hash checks',()=>{
  for(const mutate of [(d:any)=>d.rawTechnology='',(d:any)=>d.positionLabel='a'.repeat(81),(d:any)=>d.pageNumber=513,
   (d:any)=>d.primaryFragments[0].nativeBoxPointStrings[0]='NaN',(d:any)=>d.primaryFragments[0].pageNumber=true]){
   const s=saved();mutate(s.claims[0].declarationSnapshot);rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeDecision(s,association()));
  }
 });
 it('keeps exact Unicode codepoint keys/reference and literal position tokens',()=>{
  const s=request(saved());s.claims[0].identity.entityKey='🙂'.repeat(200);s.claims[0].reference='🙂'.repeat(1000);expect(parseLightingTechnologyScopeInput(s)).toEqual(s);
  for(const key of ['🙂'.repeat(201),' edge','edge\u0085','bad\nkey','bad\ufffdkey','\ud800']){const v=request(saved());v.claims[0].identity.entityKey=key;rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(v));}
  for(const ref of ['a'.repeat(7),'a'.repeat(1001),'        ','bad\nreference']){const v=request(saved());v.claims[0].reference=ref;rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(v));}
  for(const key of ['a\tb','a\u0085b']){const v=request(saved());v.claims[0].identity.entityKey=key;expect(parseLightingTechnologyScopeInput(v)).toEqual(v);}
  const v=request(saved());v.claims[0].positionMapping.sourcePositionLabel='L 1';rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(v));
 });
 it('omission preserves old hash bytes; empty claims is explicit withdrawal',()=>{
  const old={basis:'legacy',sourceSha256:'a'.repeat(64)};expect(JSON.stringify({...old,...lightingTechnologyScopeHashFields(undefined)})).toBe(JSON.stringify(old));
  const empty={schemaVersion:'matrix-zu130-lighting-technology-review-v1' as const,claims:[]};expect(parseLightingTechnologyScopeInput(empty)).toEqual(empty);
  expect(parseLightingTechnologyScopeDecision(empty,association())).toEqual(empty);expect(lightingTechnologyScopeHashFields(empty)).toEqual({lightingTechnologyScope:empty});
 });
 it('descriptor-first native guard invokes zero getter/proxy/toJSON callbacks',()=>{
  let traps=0;const getter:any={};Object.defineProperty(getter,'claims',{enumerable:true,get(){traps++;throw Error('getter');}});
  const proxy=new Proxy({},{get(){traps++;throw Error('get');},ownKeys(){traps++;throw Error('keys');},getPrototypeOf(){traps++;throw Error('prototype');}});
  const callback={toJSON(){traps++;throw Error('toJSON');}};
  for(const raw of [getter,proxy,callback])for(const run of [()=>parseLightingTechnologyScopeInput(raw),()=>assertLightingTechnologyReviewNative({nested:raw},'MATERIALIZED')])rejects('INVALID_INPUT',run);
  const source:any={};Object.defineProperty(source,'sourceFileId',{enumerable:true,get(){traps++;throw Error('source');}});
  rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeDecision(saved(),source));expect(traps).toBe(0);
 });
 it('rejects cycles/holes/custom objects/fractions/unsafe scalars',()=>{
  const cycle:any={};cycle.self=cycle;const extra:any=[];extra.x=1;
  for(const raw of [cycle,Array(2),extra,new Date(),Object.create(null),1n,NaN,Infinity,.5,Number.MAX_SAFE_INTEGER+1,'\ud800'])rejects('INVALID_INPUT',()=>assertLightingTechnologyReviewNative(raw));
 });
 it('caps TOTAL parent512KiB request and8M materialized including sibling bytes',()=>{
  rejects('INPUT_LIMIT',()=>assertLightingTechnologyReviewNative({a:'a'.repeat(524288)}));expect(()=>assertLightingTechnologyReviewNative({a:'a'.repeat(600000)},'MATERIALIZED')).not.toThrow();
  rejects('INPUT_LIMIT',()=>assertLightingTechnologyMaterializedSourceReviewEnvelope({sibling:'x'.repeat(1000000),scope:{a:'x'.repeat(1800000),b:'x'.repeat(1800000),c:'x'.repeat(1800000),d:'x'.repeat(1800000)}}));
 });
 it('caps2M CP/containers/nodes/depth and16 claims',()=>{
  rejects('INPUT_LIMIT',()=>assertLightingTechnologyReviewNative({a:'x'.repeat(2000001)},'MATERIALIZED'));
  rejects('INPUT_LIMIT',()=>assertLightingTechnologyReviewNative({a:Array(32769).fill(null)},'MATERIALIZED'));
  rejects('INPUT_LIMIT',()=>assertLightingTechnologyReviewNative({a:Array.from({length:7},()=>Array(30000).fill(null))},'MATERIALIZED'));
  let deep:any=null;for(let i=0;i<66;i++)deep=[deep];rejects('INPUT_LIMIT',()=>assertLightingTechnologyReviewNative(deep,'MATERIALIZED'));
  const s=request(saved());s.claims=Array.from({length:17},()=>structuredClone(s.claims[0]));rejects('INVALID_INPUT',()=>parseLightingTechnologyScopeInput(s));
 });
 it('raw JSON lexical guard rejects duplicates/invalid UTF8/unsafe numbers before parse',()=>{
  for(const raw of ['{"claims":[],"clai\\u006ds":[]}','{"n":9007199254740992}','{"n":.5}','{"a":"\\ud800"}','{}{}'])rejects('INVALID_INPUT',()=>validateLightingTechnologyReviewJsonBytes(Buffer.from(raw)));
  rejects('INVALID_INPUT',()=>validateLightingTechnologyReviewJsonBytes(Buffer.from([0xc3,0x28])));rejects('INPUT_LIMIT',()=>validateLightingTechnologyReviewJsonBytes(Buffer.alloc(524289,0x20)));
  expect(()=>validateLightingTechnologyReviewJsonBytes(Buffer.from(JSON.stringify(request(saved()))))).not.toThrow();
 });
});
