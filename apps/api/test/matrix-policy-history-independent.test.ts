/** Independent whole-policy expectations frozen from accepted capture/proposal before T80 code. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {historicalMatrixPolicyDefinitions} from '../src/matrix-policy-history.js';
import {matrixLightingTechnologyDefinitions,matrixLightingTechnologyConfigHash,matrixLightingTechnologyCurrentDefinitions} from '../src/matrix-lighting-technology-profile.js';
import {matrixSteelComparisonDefinitions,matrixSteelComparisonConfigHash} from '../src/matrix-steel-comparison-profile.js';
import {MATRIX_STEEL_COMPARISON_V11_PROFILE,MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION,matrixSteelComparisonV11Definitions,matrixSteelComparisonV11ConfigHash,matrixFullPolicyForProfile,selectMatrixRuntimePolicy,isSteelComparisonProfile,isCurrentMatrixExecutionInstalled} from '../src/matrix-steel-comparison-profile-v11.js';
const root=new URL('../../../',import.meta.url),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const captureBytes=readFileSync(new URL('apps/api/test/fixtures/matrix-policy-t80/root-history-capture-readonly.json',root)),proposalBytes=readFileSync(new URL('apps/api/test/fixtures/matrix-policy-t80/python-v11-policy-proposal.json',root));
expect(sha(captureBytes)).toBe('e1526b6c494bf6a42c2bcc26a132e3e17bad44fb030efebbbd270074988d7a8f');expect(sha(proposalBytes)).toBe('a6abb56adf9c3c0a096680b156c8359dbd2c7dab04832d11b2d481fb9910ec2d');
const capture=JSON.parse(captureBytes.toString()),proposal=JSON.parse(proposalBytes.toString());
const old9='matrix-text-facts-lighting-technology-v9',old10='matrix-text-facts-steel-comparison-v10',current='matrix-text-facts-steel-comparison-v11';
const h9='c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84',h10='ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6',h11='3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7';
it('keeps both complete accepted historical policies exact while current reader has a distinct dependency projection',()=>{
 for(const [id,hash,defs]of[[old9,h9,matrixLightingTechnologyDefinitions],[old10,h10,matrixSteelComparisonDefinitions]]as const){const expected=capture.rows.find((r:any)=>r.profileId===id).definitions;expect(defs).toEqual(expected);expect(historicalMatrixPolicyDefinitions(id,hash)).toEqual(expected);expect(sha(canonical(expected))).toBe(hash);}
 expect(matrixLightingTechnologyConfigHash).toBe(h9);expect(matrixSteelComparisonConfigHash).toBe(h10);expect(sha(canonical(matrixLightingTechnologyCurrentDefinitions))).toBe('a72fec74e2a3a176a23af200d3c4ab59e853c823783af53accbba8df43c4db91');
 expect(sha(readFileSync(new URL('services/worker/inspector_worker/document_text_v3.py',root)))).toBe('034fb41687342fae405e11de4648856fa1e271b0a2178ca9f35d8dd50bb19361');
});
it('matches the entire independently projected current11 policy without silently installing historical9/10',()=>{
 expect(MATRIX_STEEL_COMPARISON_V11_PROFILE).toBe(current);expect(MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION).toBe('11');expect(matrixSteelComparisonV11Definitions).toEqual(proposal.definitions);expect(matrixSteelComparisonV11ConfigHash).toBe(h11);expect(sha(canonical(matrixSteelComparisonV11Definitions))).toBe(h11);
 expect(isCurrentMatrixExecutionInstalled(old9)).toBe(false);expect(isCurrentMatrixExecutionInstalled(old10)).toBe(false);expect(isCurrentMatrixExecutionInstalled(current)).toBe(true);expect(isCurrentMatrixExecutionInstalled('unknown-v12')).toBe(false);for(const id of[old10,current])expect(isSteelComparisonProfile(id)).toBe(true);expect(isSteelComparisonProfile(old9)).toBe(false);
 expect(matrixFullPolicyForProfile(old9)).toMatchObject({profileId:old9,adapterVersion:'9',definitions:matrixLightingTechnologyDefinitions,configHash:h9});expect(matrixFullPolicyForProfile(old10)).toMatchObject({profileId:old10,adapterVersion:'10',definitions:matrixSteelComparisonDefinitions,configHash:h10});expect(matrixFullPolicyForProfile(current)).toMatchObject({profileId:current,adapterVersion:'11',definitions:proposal.definitions,configHash:h11});
 const flags={inventory:true,call:true,rail:true,water:true,lighting:true,steel:true,steelV11:true};const selected:any=selectMatrixRuntimePolicy(flags);expect(selected).toEqual({profileId:current,adapterVersion:'11',definitions:proposal.definitions,configHash:h11});
});
it('rejects unknown/swapped historical tuples without callbacks and exposes deeply immutable policies',()=>{
 let calls=0;const hostile={toString(){calls++;throw Error('callback');}},proxy=new Proxy({}, {get(){calls++;throw Error('proxy');}});
 for(const [id,hash]of[[old9,h10],[old10,h9],[old9,h11],[current,h11],['unknown',h9],[hostile,h9],[old9,proxy],[proxy,h9]]as any[])expect(historicalMatrixPolicyDefinitions(id,hash)).toBeNull();expect(calls).toBe(0);
 for(const [id,hash]of[[old9,h9],[old10,h10]]){const v:any=historicalMatrixPolicyDefinitions(id,hash);expect(Object.isFrozen(v)).toBe(true);expect(Object.isFrozen(v.registry.entries)).toBe(true);expect(()=>{v.registry.entries[0].name='MUTATED';}).toThrow();expect(sha(canonical(historicalMatrixPolicyDefinitions(id,hash)))).toBe(hash);}
});
