/** Fixed aggregate transport boundary for the13-field T83 parent.
 * This is native validation only; every frozen child validator and all identity,
 * history, hash and snapshot linkage checks remain mandatory afterward. */
import {isProxy} from 'node:util/types';
export class MatrixReviewedLoaderV7ValidationError extends TypeError {
 constructor(readonly code:'INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_PACKAGE'){
  super(code);this.name='MatrixReviewedLoaderV7ValidationError';
 }
}
const MAX_BYTES=67108864,MAX_NODES=4500018,MAX_DEPTH=69;
function fail(code:'INVALID_INPUT'|'INPUT_LIMIT'):never{throw new MatrixReviewedLoaderV7ValidationError(code);}
function compareCodePoints(a:string,b:string):number{
 const x=Array.from(a),y=Array.from(b);
 for(let i=0;i<Math.min(x.length,y.length);i++){
  const delta=x[i]!.codePointAt(0)!-y[i]!.codePointAt(0)!;if(delta)return delta;
 }
 return x.length-y.length;
}
/** No caller budget/options; reject proxies/getters before any property read. */
export function canonicalMatrixReviewedLoaderV7(input:unknown):string{
 let nodes=0,bytes=0;const active=new Set<object>();
 const charge=(n:number)=>{bytes+=n;if(bytes>MAX_BYTES)fail('INPUT_LIMIT');};
 const visit=(value:unknown,depth:number):string=>{
  if(++nodes>MAX_NODES||depth>MAX_DEPTH)fail('INPUT_LIMIT');
  if(value===null){charge(4);return'null';}
  if(typeof value==='boolean'){charge(value?4:5);return String(value);}
  if(typeof value==='number'){
   if(!Number.isSafeInteger(value))fail('INVALID_INPUT');const result=String(value);charge(result.length);return result;
  }
  if(typeof value==='string'){
   if(value.length>4000000)fail('INPUT_LIMIT');let length=0;
   for(const char of value){if(++length>2000000)fail('INPUT_LIMIT');const point=char.codePointAt(0)!;if(point>=0xd800&&point<=0xdfff)fail('INVALID_INPUT');}
   const result=JSON.stringify(value);charge(Buffer.byteLength(result,'utf8'));return result;
  }
  if(typeof value!=='object'||!value||isProxy(value)||active.has(value))fail('INVALID_INPUT');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail('INVALID_INPUT');
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  if(names.some(key=>typeof key!=='string'||/[^\x00-\x7f]/u.test(key)))fail('INVALID_INPUT');
  let keys:string[];
  if(array){
   const length=descriptors.length?.value;
   if(!Number.isSafeInteger(length)||length<0)fail('INVALID_INPUT');
   if(length>32768)fail('INPUT_LIMIT');if(names.length!==length+1)fail('INVALID_INPUT');
   keys=Array.from({length},(_,i)=>String(i));
  }else{if(names.length>32768)fail('INPUT_LIMIT');keys=(names as string[]).sort(compareCodePoints);}
  active.add(value);charge(2+Math.max(0,keys.length-1)+(array?0:keys.length));const parts:string[]=[];
  for(const key of keys){
   const property=descriptors[key];if(!property?.enumerable||!Object.hasOwn(property,'value'))fail('INVALID_INPUT');
   parts.push(array?visit(property.value,depth+1):visit(key,depth+1)+':'+visit(property.value,depth+1));
  }
  active.delete(value);return(array?'[':'{')+parts.join(',')+(array?']':'}');
 };
 return visit(input,0);
}
export function detachMatrixReviewedLoaderV7(input:unknown):unknown{return JSON.parse(canonicalMatrixReviewedLoaderV7(input));}
