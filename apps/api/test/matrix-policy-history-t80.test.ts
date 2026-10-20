/** T80 independent exact policy expectations frozen before capsule implementation. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {historicalMatrixPolicyDefinitions} from '../src/matrix-policy-history.js';
import {matrixLightingTechnologyDefinitions,matrixLightingTechnologyConfigHash,matrixLightingTechnologyCurrentDefinitions} from '../src/matrix-lighting-technology-profile.js';
import {matrixSteelComparisonDefinitions,matrixSteelComparisonConfigHash} from '../src/matrix-steel-comparison-profile.js';
const entries=[['matrix-text-facts-lighting-technology-v9','c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84'],['matrix-text-facts-steel-comparison-v10','ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6']]as const;
it('recognises only two captured accepted whole policies, retains exact definitions and full hashes',()=>{
 const capture=JSON.parse(readFileSync(new URL('./fixtures/matrix-policy-t80/root-history-capture-readonly.json',import.meta.url),'utf8'));
 for(const [profile,hash]of entries){const value=historicalMatrixPolicyDefinitions(profile,hash);expect(value).toEqual(capture.rows.find((r:any)=>r.profileId===profile).definitions);expect(sha256(canonicalJson(value))).toBe(hash);}
 expect(matrixLightingTechnologyConfigHash).toBe(entries[0][1]);expect(matrixSteelComparisonConfigHash).toBe(entries[1][1]);expect(historicalMatrixPolicyDefinitions(...entries[0])).toEqual(matrixLightingTechnologyDefinitions);expect(historicalMatrixPolicyDefinitions(...entries[1])).toEqual(matrixSteelComparisonDefinitions);
});
it('current producer dependency is explicit and differs from frozen historical profile',()=>{
 expect(createHash('sha256').update(readFileSync(new URL('../../../services/worker/inspector_worker/document_text_v3.py',import.meta.url))).digest('hex')).toBe('034fb41687342fae405e11de4648856fa1e271b0a2178ca9f35d8dd50bb19361');
 expect(sha256(canonicalJson(matrixLightingTechnologyCurrentDefinitions))).toBe('a72fec74e2a3a176a23af200d3c4ab59e853c823783af53accbba8df43c4db91');
 expect(matrixLightingTechnologyCurrentDefinitions).not.toEqual(matrixLightingTechnologyDefinitions);
});
it('unknown/swapped/current hashes never qualify as finite historical policies; native primitive boundary calls no hooks',()=>{
 let callbacks=0;const hostile={toString(){callbacks++;throw Error('callback');},get profileId(){callbacks++;throw Error('getter');}},proxy=new Proxy({}, {get(){callbacks++;throw Error('proxy');}});
 for(const x of [undefined,null,'','v11',hostile,proxy,()=>{callbacks++;},Symbol('profile')])expect(historicalMatrixPolicyDefinitions(x,entries[0][1])).toBeNull();
 for(const x of [undefined,null,'',entries[1][1],'a72fec74e2a3a176a23af200d3c4ab59e853c823783af53accbba8df43c4db91',hostile,proxy])expect(historicalMatrixPolicyDefinitions(entries[0][0],x)).toBeNull();
 expect(callbacks).toBe(0);
});
it('complete archive objects are deeply immutable and independent from current definitions',()=>{
 const value:any=historicalMatrixPolicyDefinitions(...entries[0]);expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.registry.entries)).toBe(true);expect(()=>{value.lightingTechnologyExecution.documentTextV3ReaderSourceSha256='0'.repeat(64);}).toThrow();expect(sha256(canonicalJson(historicalMatrixPolicyDefinitions(...entries[0])))).toBe(entries[0][1]);
});
