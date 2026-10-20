/** Independent T79 transport only. Semantic source/release admission belongs elsewhere. */
import {expect,it} from 'vitest';
import {normalizeDocumentTextV3LargeCompletion as normalize,parseDocumentTextV3LargeCompletion as parse} from '../src/document-text-v3-large-wire.js';
const RAW=33554432,RESULT=32000000;
const rejected=(reasonCode:'INVALID_INPUT'|'INPUT_LIMIT')=>({status:'ABSTAIN',reasonCode});
const dto=(result:Record<string,unknown>={})=>({attemptId:'attempt-1',fencingToken:7,result});
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort((a,b)=>{const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]!-bb[i]!;return aa.length-bb.length;}).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function valid(input:Record<string,unknown>){const result=normalize(input);expect(result).toEqual({status:'VALID',value:input,canonical:canonical(input)});return result;}
// Count every native value and object key. Root1 + three keys/values6 + result key1 + treeN = N+8.
function nodeTree(n:number):unknown[]{let remaining=n-1;const root:unknown[]=[];while(remaining>0){remaining--;const count=Math.min(32768,remaining);root.push(Array(count).fill(0));remaining-=count;}return root;}
// Whole result object byte size includes key, braces, array brackets, quotes, commas and escapes.
function resultBytes(n:number,escaped=false):Record<string,unknown>{const result={chunks:Array(20).fill('') as string[]};const overhead=Buffer.byteLength(JSON.stringify(result));let left=n-overhead;for(let i=0;i<20;i++){const take=Math.min(escaped?Math.floor(left/2):left,1999999);result.chunks[i]=(escaped?'\n':'x').repeat(take);left-=take*(escaped?2:1);}if(left===1){result.chunks[19]+='x';left--;}expect(left).toBe(0);expect(Buffer.byteLength(JSON.stringify(result))).toBe(n);expect(result.chunks.every(x=>Array.from(x).length<=2000000)).toBe(true);return result;}
function deep(depth:number){let end:unknown=null;for(let i=0;i<depth-2;i++)end=[end];return dto({deep:end});}
it('closed request roundtrip is detached, canonical codepoint ordered, integer and Unicode preserving',()=>{
 const input=dto(JSON.parse('{"2":2,"10":10,"😀":"астрал","\ue000":"BMP","__proto__":{"raw":"не authority"},"null":null,"array":[true,false,0,-7]}'));const before=structuredClone(input);const a=valid(input);expect(input).toEqual(before);
 expect(a.status).toBe('VALID');if(a.status!=='VALID')throw Error('valid expected');expect(a.value).not.toBe(input);expect(a.value.result).not.toBe(input.result);expect(a.canonical.indexOf('"\ue000"')).toBeLessThan(a.canonical.indexOf('"😀"'));expect(a.canonical.indexOf('"10"')).toBeLessThan(a.canonical.indexOf('"2"'));
 (a.value.result as any).array.push('detached');expect(input).toEqual(before);expect(parse(Buffer.from(canonical(input)))).toEqual({status:'VALID',value:input,canonical:canonical(input)});expect(Object.getPrototypeOf((input.result as any).__proto__)).toBe(Object.prototype);
});
it('mandatory exact DTO shape, positive safe fence, attempt length, plain result only',()=>{
 for(const input of [null,[],{},'json',dto() as any]){if(input&&typeof input==='object'&&!Array.isArray(input)&&'attemptId'in input)continue;expect(normalize(input)).toEqual(rejected('INVALID_INPUT'));}
 const base=dto();for(const key of ['attemptId','fencingToken','result']){const input:any={...base};delete input[key];expect(normalize(input)).toEqual(rejected('INVALID_INPUT'));}
 for(const attemptId of ['',null,7,'a'.repeat(201)])expect(normalize({...base,attemptId})).toEqual(rejected('INVALID_INPUT'));
 valid({...base,attemptId:'a'.repeat(200)});valid({...base,attemptId:'😀'.repeat(200)});expect(normalize({...base,attemptId:'😀'.repeat(201)})).toEqual(rejected('INVALID_INPUT'));
 for(const fencingToken of [0,-1,1.1,NaN,Infinity,9007199254740992,'7',true,null])expect(normalize({...base,fencingToken})).toEqual(rejected('INVALID_INPUT'));
 valid({...base,fencingToken:Number.MAX_SAFE_INTEGER});for(const result of [null,[],1,'x',Object.create(null)])expect(normalize({...base,result})).toEqual(rejected('INVALID_INPUT'));expect(normalize({...base,extra:1})).toEqual(rejected('INVALID_INPUT'));valid(dto());
});
it('strict raw JSON refuses duplicate decoded keys, float lexemes, unsafe numbers and malformed UTF8',()=>{
 const rawBad=['{"attemptId":"x","attemptId":"y","fencingToken":1,"result":{}}','{"attemptId":"x","fencingToken":1,"result":{"a":1,"\\u0061":2}}','{"attemptId":"x","fencingToken":1.0,"result":{}}','{"attemptId":"x","fencingToken":1,"result":{"x":1e0}}','{"attemptId":"x","fencingToken":1,"result":{"x":9007199254740992}}','{"attemptId":"x","fencingToken":1,"result":{"x":NaN}}','{"attemptId":"x","fencingToken":1,"result":{"x":"\\ud800"}}','{"attemptId":"x","fencingToken":1,"result":{}} null','\ufeff'+JSON.stringify(dto()),'{"attemptId":"x",}'];
 for(const raw of rawBad)expect(parse(Buffer.from(raw))).toEqual(rejected('INVALID_INPUT'));
 for(const bytes of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xe2,0x82]])expect(parse(Buffer.from(bytes))).toEqual(rejected('INVALID_INPUT'));
 for(const raw of [JSON.stringify(dto()),'\n\t'+JSON.stringify(dto({raw:'Светильник 😀\n'}))+' \r\n']){const input=JSON.parse(raw);expect(parse(Buffer.from(raw))).toEqual({status:'VALID',value:input,canonical:canonical(input)});}
 expect(parse('not Buffer' as any)).toEqual(rejected('INVALID_INPUT'));expect(parse(new Uint8Array([123,125]) as any)).toEqual(rejected('INVALID_INPUT'));
});
it('raw wire exact33554432 bytes includes whitespace, independent of compact canonical',()=>{
 const input=dto();const small=Buffer.from(JSON.stringify(input));const at=Buffer.alloc(RAW,32);small.copy(at);expect(parse(at)).toEqual({status:'VALID',value:input,canonical:canonical(input)});const over=Buffer.alloc(RAW+1,32);small.copy(over);expect(parse(over)).toEqual(rejected('INPUT_LIMIT'));
},30000);
it('result exact32000000 canonical UTF8 bytes includes every quote/comma/escape; no single oversized string',()=>{
 for(const escaped of [false,true]){const at=dto(resultBytes(RESULT,escaped));const before=JSON.stringify(at);const actual=normalize(at);expect(actual.status).toBe('VALID');if(actual.status==='VALID'){expect(actual.canonical).toBe(canonical(at));expect(Buffer.byteLength(canonical(actual.value.result))).toBe(RESULT);}expect(JSON.stringify(at)).toBe(before);expect(parse(Buffer.from(JSON.stringify(at))).status).toBe('VALID');expect(normalize(dto(resultBytes(RESULT+1,escaped)))).toEqual(rejected('INPUT_LIMIT'));expect(parse(Buffer.from(JSON.stringify(dto(resultBytes(RESULT+1,escaped)))))).toEqual(rejected('INPUT_LIMIT'));}
},30000);
it('whole request exact1500000 nodes counts values plus keys, no per-result reset',()=>{
 valid(dto({items:nodeTree(1500000-8)}));expect(normalize(dto({items:nodeTree(1500001-8)}))).toEqual(rejected('INPUT_LIMIT'));
},30000);
it('root0 depth68 valid and69 limited; container32768 and Unicode string2000000 exact',()=>{
 valid(deep(68));expect(normalize(deep(69))).toEqual(rejected('INPUT_LIMIT'));
 valid(dto({items:Array(32768).fill(null)}));expect(normalize(dto({items:Array(32769).fill(null)}))).toEqual(rejected('INPUT_LIMIT'));
 const object=Object.fromEntries(Array.from({length:32768},(_,i)=>['k'+i,0]));valid(dto({object}));object.extra=0;expect(normalize(dto({object}))).toEqual(rejected('INPUT_LIMIT'));
 valid(dto({raw:'😀'.repeat(2000000)}));expect(normalize(dto({raw:'😀'.repeat(2000001)}))).toEqual(rejected('INPUT_LIMIT'));
},30000);
it('descriptor-first rejects nested getters proxies hidden symbols sparse aliases cycles floats and surrogates; callbacks zero',()=>{
 let calls=0;const getter=Object.defineProperty({},'x',{enumerable:true,get(){calls++;throw Error('getter');}}),proxy=new Proxy({},{getPrototypeOf(){calls++;throw Error('proxy');},ownKeys(){calls++;throw Error('proxy');}}),hidden=Object.defineProperty({},'x',{value:1}),toJSON={toJSON(){calls++;throw Error('toJSON');}},cycle:any={};cycle.x=cycle;const sparse=Array(3);const sparseWithHidden=Object.defineProperty([1],'x',{value:2});
 for(const result of [getter,proxy,hidden,toJSON,{[Symbol('x')]:1},cycle,{deep:[sparse]},sparseWithHidden,{raw:'\udfff'},{'\ud800':'key'}, {number:.1},{number:Infinity},{number:NaN},{number:9007199254740992},{date:new Date(0)},new (class extends Object {})()])expect(normalize(dto(result as any))).toEqual(rejected('INVALID_INPUT'));
 const rootGetter=Object.defineProperty({fencingToken:1,result:{}},'attemptId',{enumerable:true,get(){calls++;throw Error('root getter');}});expect(normalize(rootGetter)).toEqual(rejected('INVALID_INPUT'));expect(calls).toBe(0);
 // Shared acyclic children are legitimate parsed-value-equivalent data; only ancestor cycles fail.
 const shared={raw:'same'};valid(dto({a:shared,b:shared}));
});
