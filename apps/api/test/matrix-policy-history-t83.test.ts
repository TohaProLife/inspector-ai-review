/** Independent finite historical-data selector. No archived execution authority. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {historicalMatrixPolicyDefinitionsV2} from '../src/matrix-policy-history-v2.js';
import {historicalMatrixPolicyDefinitions} from '../src/matrix-policy-history.js';
const read=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/matrix-policy-t80/${name}`,import.meta.url),'utf8'));
const old=read('root-history-capture-readonly.json'),current=read('python-v11-policy-proposal.json');
const ids=['matrix-text-facts-lighting-technology-v9','matrix-text-facts-steel-comparison-v10','matrix-text-facts-steel-comparison-v11'] as const;
const hashes=['c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84','ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6','3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7'] as const;
const expected=[old.rows.find((r:any)=>r.profileId===ids[0]).definitions,old.rows.find((r:any)=>r.profileId===ids[1]).definitions,current.definitions];
function canonical(v:any):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
describe('independent T83 finite historical policies v2',()=>{
 it('returns exact complete accepted v9/v10/v11 definitions from pre-T83 whole fixtures',()=>{
  expect(current.profileId).toBe(ids[2]);expect(current.configHash).toBe(hashes[2]);
  for(let i=0;i<3;i++){expect(hash(expected[i])).toBe(hashes[i]);const v=historicalMatrixPolicyDefinitionsV2(ids[i],hashes[i]);expect(v).toEqual(expected[i]);expect(hash(v)).toBe(hashes[i]);}
 });
 it('rejects unknown, altered, cross-profile and non-exact primitive selectors',()=>{
  for(let i=0;i<3;i++){
   for(const id of [ids[i]+'\n',' '+ids[i],ids[i]+' ',ids[i].toUpperCase(),'matrix-text-facts-steel-comparison-v12','__proto__',''])expect(historicalMatrixPolicyDefinitionsV2(id,hashes[i])).toBeNull();
   for(const h of [hashes[i]+'\n',hashes[i].toUpperCase(),' '+hashes[i],'0'.repeat(64),'',...hashes.filter((_,j)=>j!==i)])expect(historicalMatrixPolicyDefinitionsV2(ids[i],h)).toBeNull();
  }
 });
 it('never coerces, enumerates or invokes user objects/proxies/functions',()=>{
  let calls=0;const trip=()=>{calls++;throw Error('User callback reached');};
  const hostile=Object.create(null);for(const key of ['toString','valueOf'])Object.defineProperty(hostile,key,{get:trip});Object.defineProperty(hostile,Symbol.toPrimitive,{get:trip});
  const proxy=new Proxy({}, {get:trip,getPrototypeOf:trip,ownKeys:trip,getOwnPropertyDescriptor:trip,has:trip});
  const revocable=Proxy.revocable({},{});revocable.revoke();
  const values=[undefined,null,true,false,0,9,NaN,Infinity,1n,Symbol('selector'),new String(ids[0]),hostile,proxy,revocable.proxy,trip,[],{}];
  for(const v of values){expect(historicalMatrixPolicyDefinitionsV2(v,hashes[0])).toBeNull();expect(historicalMatrixPolicyDefinitionsV2(ids[0],v)).toBeNull();}expect(calls).toBe(0);
 });
 it('deep-freezes every complete definition and prevents one caller changing later lookups',()=>{
  for(let i=0;i<3;i++){
   const v:any=historicalMatrixPolicyDefinitionsV2(ids[i],hashes[i]);const stack=[v];let count=0;
   while(stack.length){const x=stack.pop();if(x&&typeof x==='object'){expect(Object.isFrozen(x)).toBe(true);count++;for(const child of Object.values(x))stack.push(child);}}
   expect(count).toBeGreaterThan(100);expect(Reflect.set(v,'registry',{})).toBe(false);expect(Reflect.set(v.registry.entries[0],'name','MUTATED')).toBe(false);
   expect(()=>v.registry.entries.push({})).toThrow();expect(()=>Object.defineProperty(v,'extra',{value:true})).toThrow();
   expect(historicalMatrixPolicyDefinitionsV2(ids[i],hashes[i])).toEqual(expected[i]);expect(hash(historicalMatrixPolicyDefinitionsV2(ids[i],hashes[i]))).toBe(hashes[i]);
  }
 });
 it('keeps old v1 finite to exact9/10, while only new v2 adds accepted11',()=>{
  for(let i=0;i<2;i++)expect(historicalMatrixPolicyDefinitions(ids[i],hashes[i])).toEqual(expected[i]);
  expect(historicalMatrixPolicyDefinitions(ids[2],hashes[2])).toBeNull();expect(historicalMatrixPolicyDefinitionsV2(ids[2],hashes[2])).toEqual(expected[2]);
 });
});
