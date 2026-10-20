/** Standalone snapshot integrity. Authentication and all source/package links belong to the loader. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import type {ColumnPylonSectionRunSnapshot} from '@inspector-ai/contracts';

type Code='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_SNAPSHOT';
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
export class ColumnPylonSectionRunSnapshotValidationError extends TypeError {
 constructor(public readonly code:Code){super(code);this.name='ColumnPylonSectionRunSnapshotValidationError';}
}
function fail(code:Code):never{throw new ColumnPylonSectionRunSnapshotValidationError(code);}
const DOMAIN='matrix-kr060-column-pylon-run-snapshot-json-v1';
const VERSION='matrix-kr060-column-pylon-run-snapshot-v1';
function canonical(value:unknown):string{
 let nodes=0,bytes=0;const ancestors=new Set<object>();
 const charge=(n:number)=>{bytes+=n;if(bytes>524288)fail('INPUT_LIMIT');};
 function visit(v:unknown,depth:number):string{
  if(++nodes>200000||depth>64)fail('INPUT_LIMIT');
  if(v===null){charge(4);return 'null';}
  if(typeof v==='boolean'){const s=String(v);charge(s.length);return s;}
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('INVALID_INPUT');const s=JSON.stringify(v);charge(s.length);return s;}
  if(typeof v==='string'){
   if(v.length>4000000)fail('INPUT_LIMIT');let count=0;
   for(const c of v){if(++count>2000000)fail('INPUT_LIMIT');const cp=c.codePointAt(0)!;if(cp>=0xd800&&cp<=0xdfff)fail('INVALID_INPUT');}
   const s=JSON.stringify(v);charge(Buffer.byteLength(s));return s;
  }
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))fail('INVALID_INPUT');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)fail('INVALID_INPUT');
  const desc=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(desc);
  if(names.some(k=>typeof k!=='string'))fail('INVALID_INPUT');let keys:string[];
  if(array){const size=desc.length?.value;if(!Number.isSafeInteger(size)||size<0)fail('INVALID_INPUT');if(size>32768)fail('INPUT_LIMIT');if(names.length!==size+1)fail('INVALID_INPUT');keys=Array.from({length:size},(_,i)=>String(i));}
  else{if(names.length>32768)fail('INPUT_LIMIT');keys=(names as string[]).sort();if(keys.some(k=>/[^\x00-\x7f]/u.test(k)))fail('INVALID_INPUT');}
  ancestors.add(v);charge(2+Math.max(0,keys.length-1)+(array?0:keys.length));const parts:string[]=[];
  for(const k of keys){const d=desc[k];if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_INPUT');parts.push(array?visit(d.value,depth+1):visit(k,depth+1)+':'+visit(d.value,depth+1));}
  ancestors.delete(v);return (array?'[':'{')+parts.join(',')+(array?']':'}');
 }
 return visit(value,0);
}
const detach=(raw:unknown):Json=>JSON.parse(canonical(raw)) as Json;
const object=(v:Json):v is {[key:string]:Json}=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Json,keys:string[]):v is {[key:string]:Json}=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const sha=(v:Json):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
const uuid=(v:Json):boolean=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/iu.test(v);
const whitespace=(cp:number)=>cp>=9&&cp<=13||cp>=28&&cp<=32||[0x85,0xa0,0x1680,0x2028,0x2029,0x202f,0x205f,0x3000].includes(cp)||cp>=0x2000&&cp<=0x200a;
function key(v:Json):boolean{if(typeof v!=='string')return false;const chars=Array.from(v);return chars.length>0&&chars.length<=200&&!whitespace(chars[0]!.codePointAt(0)!)&&!whitespace(chars.at(-1)!.codePointAt(0)!)&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufffd]/u.test(v);}
function body(v:Json):v is {[key:string]:Json}{
 if(!object(v)||!uuid(v.objectId!)||!key(v.objectApiId!)||!sha(v.inputManifestHash!)||!Array.isArray(v.entries)||v.entries.length>16)return false;
 const ids=new Set<string>();let previous='';
 for(const e of v.entries){
  if(!exact(e,['pairKey','decisionId','sequenceNo','journalContentHash','projectionContentHash','included','exclusionReason'])||!sha(e.pairKey!)||!uuid(e.decisionId!)||!sha(e.journalContentHash!)||!sha(e.projectionContentHash!)||typeof e.included!=='boolean')return false;
  const n=e.sequenceNo;if(typeof n!=='string'||! /^[1-9][0-9]{0,18}(?![\s\S])/u.test(n)||n.length===19&&n>'9223372036854775807')return false;
  if(e.included?e.exclusionReason!==null:!['SOURCE_NOT_IN_MANIFEST','SOURCE_REVIEW_REFERENCE_CHANGED'].includes(e.exclusionReason as string))return false;
  if(e.pairKey<=previous||ids.has(e.decisionId as string))return false;previous=e.pairKey;ids.add(e.decisionId as string);
 }
 return true;
}
function validate(value:Json):ColumnPylonSectionRunSnapshot{
 if(!exact(value,['schemaVersion','objectId','objectApiId','inputManifestHash','entries','contentHash'])||value.schemaVersion!==VERSION||!sha(value.contentHash!)||!body(value))fail('INVALID_SNAPSHOT');
 const {contentHash,...snapshot}=value;
 if(hash({hashDomain:DOMAIN,snapshot})!==contentHash)fail('INVALID_SNAPSHOT');
 return value as unknown as ColumnPylonSectionRunSnapshot;
}
export function validateColumnPylonSectionRunSnapshot(raw:unknown):ColumnPylonSectionRunSnapshot{return validate(detach(raw));}
export function buildColumnPylonSectionRunSnapshot(raw:unknown):ColumnPylonSectionRunSnapshot{
 const value=detach(raw);if(!exact(value,['objectId','objectApiId','inputManifestHash','entries'])||!body(value))fail('INVALID_SNAPSHOT');
 const snapshot={schemaVersion:VERSION,...value};return validate({...snapshot,contentHash:hash({hashDomain:DOMAIN,snapshot})});
}
