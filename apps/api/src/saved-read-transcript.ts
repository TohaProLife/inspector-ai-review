/** Invocation-local equality proof for an already validated saved read.
 * Both clients must belong to separate REPEATABLE READ READ ONLY transactions.
 * Internal SELECTs only: this module is not a SQL parser or an authorization cache.
 */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import type {PoolClient} from 'pg';

const LIMITS = Object.freeze({uniqueQueries:2048, queryCalls:8192, sqlBytes:65536,
  paramsBytes:65536, responseBytes:134217728, responseNodes:8000000,
  depth:128, container:32768, totalBytes:536870912});
type FailureCode = 'SAVED_READ_TRANSCRIPT_INTEGRITY'|'SAVED_READ_TRANSCRIPT_LIMIT';
function fail(code:FailureCode='SAVED_READ_TRANSCRIPT_INTEGRITY'):never {
  throw Object.assign(new Error(code), {code});
}
function mismatch(phase:'capture'|'replay',ordinal:number,sql:string,expectedDigest:string,actualDigest:string,rowCount:unknown):never {
  throw Object.assign(new Error('SAVED_READ_TRANSCRIPT_INTEGRITY'), {code:'SAVED_READ_TRANSCRIPT_INTEGRITY',
    savedReadTranscriptMismatch:Object.freeze({phase,ordinal,sqlSha256:createHash('sha256').update(sql).digest('hex'),expectedDigest,actualDigest,rowCount})});
}
const own = (value:object,key:PropertyKey):unknown => {
  const property=Object.getOwnPropertyDescriptor(value,key);
  if(!property || !Object.hasOwn(property,'value')) fail();
  return property.value;
};
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const byteLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength')!.get!;
const byteOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset')!.get!;
const arrayBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer')!.get!;
function denseLength(value:unknown):number {
  if(!value || typeof value!=='object' || isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value)!==Array.prototype) fail();
  const length=own(value,'length');
  if(typeof length!=='number' || !Number.isSafeInteger(length) || length<0) fail();
  if(length>LIMITS.container) fail('SAVED_READ_TRANSCRIPT_LIMIT');
  if(Reflect.ownKeys(value).length!==length+1) fail();
  return length;
}

/** Length-framed, typed stream. No toJSON/getter calls or retained raw clone.
 * SQL rows and JSON arrays retain order; harmless unordered SQL permutations
 * may therefore conservatively fail equality.
 */
function fingerprint(input:unknown,maxBytes:number,copy=false,chargeTotal?:(n:number)=>void) {
  const hash=createHash('sha256'),active=new Set<object>();
  let bytes=0,nodes=0,chunks:string[]=[],chunkLength=0;
  const charge=(count:number)=>{
    bytes+=count;
    if(bytes>maxBytes) fail('SAVED_READ_TRANSCRIPT_LIMIT');
    chargeTotal?.(count);
  };
  const flush=()=>{if(chunks.length){hash.update(chunks.join(''),'utf8');chunks=[];chunkLength=0;}};
  const put=(value:string)=>{
    charge(Buffer.byteLength(value,'utf8'));
    if(value.length>=65536){flush();hash.update(value,'utf8');}
    else {chunks.push(value);chunkLength+=value.length;if(chunkLength>=65536)flush();}
  };
  const visit=(value:unknown,depth:number):unknown=>{
    if(++nodes>LIMITS.responseNodes || depth>LIMITS.depth) fail('SAVED_READ_TRANSCRIPT_LIMIT');
    if(value===null){put('z;');return null;}
    if(typeof value==='boolean'){put(value?'t;':'f;');return value;}
    if(typeof value==='number'){
      if(!Number.isFinite(value) || Number.isInteger(value)&&!Number.isSafeInteger(value)) fail();
      put(`n${Object.is(value,-0)?'-0':String(value)};`);return value;
    }
    if(typeof value==='string'){
      if(/[\uD800-\uDFFF]/u.test(value)) fail();
      put(`s${Buffer.byteLength(value,'utf8')}:`);put(value);return value;
    }
    if(!value || typeof value!=='object' || isProxy(value) || active.has(value)) fail();
    const prototype=Object.getPrototypeOf(value);
    if(prototype===Date.prototype){
      if(Reflect.ownKeys(value).length) fail();
      const time=Date.prototype.getTime.call(value);
      if(!Number.isFinite(time)) fail();
      const iso=Date.prototype.toISOString.call(value);put(`d${iso.length}:${iso}`);
      return copy?new Date(time):undefined;
    }
    if(Buffer.isBuffer(value)){
      if(prototype!==Buffer.prototype) fail();
      // Intrinsics inspect bytes, never an overridden length/buffer/toJSON.
      const length=byteLength.call(value) as number;
      put(`b${length}:`);charge(length);flush();hash.update(value);
      if(!copy)return undefined;
      const detached=Buffer.alloc(length);
      // Buffer.from(ArrayBuffer) reads a shadowable .byteLength property.
      // Native typed-array construction/set use backing-store internal slots.
      Uint8Array.prototype.set.call(detached,new Uint8Array(arrayBuffer.call(value),byteOffset.call(value),length));
      return detached;
    }
    const array=Array.isArray(value);
    if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null) fail();
    let keys:string[];
    if(array){const length=denseLength(value);keys=Array.from({length},(_,i)=>String(i));put(`a${length}[`);}
    else {
      const names=Reflect.ownKeys(value);
      if(names.length>LIMITS.container) fail('SAVED_READ_TRANSCRIPT_LIMIT');
      if(names.some(key=>typeof key!=='string')) fail();
      keys=(names as string[]).sort();put(`${prototype===null?'p':'o'}${keys.length}{`);
    }
    const detached=copy?(array?[]:Object.create(prototype)):undefined;
    active.add(value);
    for(const key of keys){
      const property=Object.getOwnPropertyDescriptor(value,key);
      if(!property?.enumerable || !Object.hasOwn(property,'value')) fail();
      if(!array)visit(key,depth+1);
      const child=visit(property.value,depth+1);
      if(copy)Object.defineProperty(detached,key,{value:child,enumerable:true,writable:true,configurable:true});
    }
    active.delete(value);put(array?']':'}');return detached;
  };
  const detached=visit(input,0);flush();
  return {digest:hash.digest('hex'),bytes,nodes,detached};
}

const FIELD_KEYS=['name','tableID','columnID','dataTypeID','dataTypeSize','dataTypeModifier','format'] as const;
function resultFingerprint(result:unknown,charge:(n:number)=>void){
  if(!result || typeof result!=='object' || isProxy(result) || Array.isArray(result)) fail();
  const command=own(result,'command'),rowCount=own(result,'rowCount'),oid=own(result,'oid');
  const rows=own(result,'rows'),fields=own(result,'fields'),length=denseLength(rows);
  if(command!=='SELECT' || rowCount!==length || oid!==null&&
    (typeof oid!=='number'||!Number.isSafeInteger(oid)||oid<0)) fail();
  const fieldCount=denseLength(fields),projectedFields:Record<string,unknown>[]=[];
  for(let i=0;i<fieldCount;i++){
    const field=own(fields as object,String(i));
    if(!field || typeof field!=='object' || isProxy(field)) fail();
    const projection:Record<string,unknown>={};
    for(const key of FIELD_KEYS){
      const value=own(field,key);
      if(key==='name'?typeof value!=='string':key==='format'?value!=='text'&&value!=='binary'
        :typeof value!=='number'||!Number.isSafeInteger(value)) fail();
      projection[key]=value;
    }
    projectedFields.push(projection);
  }
  return fingerprint({command,rowCount,oid,fields:projectedFields,rows},LIMITS.responseBytes,false,charge);
}

export interface CapturedSavedRead<T> {
  readonly value:T;
  readonly statistics:Readonly<{queryCalls:number;uniqueQueries:number;responseBytes:number;responseNodes:number;largestResponseBytes:number}>;
  readonly replay:(freshClient:PoolClient)=>Promise<void>;
}

async function captureSavedReadCore<T>(client:PoolClient,operation:(client:PoolClient)=>Promise<T>):Promise<CapturedSavedRead<T>> {
  type Entry={sql:string;params:unknown[]|undefined;digest:string};
  const entries:Entry[]=[],seen=new Map<string,Map<string,string>>();
  let open=true,inflight=false,pending:Promise<unknown>|undefined,failure:{error:unknown}|undefined;
  let calls=0,totalBytes=0,responseNodes=0,largestResponseBytes=0;
  const charge=(n:number)=>{totalBytes+=n;if(totalBytes>LIMITS.totalBytes)fail('SAVED_READ_TRANSCRIPT_LIMIT');};
  const reject=(error:unknown)=>{failure??={error};const rejected=Promise.reject(error);void rejected.catch(()=>{});return rejected;};
  const checked=new Proxy(client,{get(target,key){
    if(key!=='query')return Reflect.get(target,key,target);
    return (...args:unknown[])=>{
      try{if(!open||inflight||failure)fail();}catch(error){return reject(error);}
      inflight=true;
      const task=(async()=>{
        try {
          if(++calls>LIMITS.queryCalls)fail('SAVED_READ_TRANSCRIPT_LIMIT');
          if(args.length<1||args.length>2||typeof args[0]!=='string')fail();
          const sql=args[0];
          if(Buffer.byteLength(sql,'utf8')>LIMITS.sqlBytes)fail('SAVED_READ_TRANSCRIPT_LIMIT');
          if(!/^\s*(?:SELECT|WITH)\b/i.test(sql)||sql.includes(';')||sql.includes('\0')||/[\uD800-\uDFFF]/u.test(sql))fail();
          const hasParams=args.length===2;
          if(hasParams)denseLength(args[1]);
          const binding=hasParams?fingerprint(args[1],LIMITS.paramsBytes,true):undefined;
          const params=binding?.detached as unknown[]|undefined;
          const paramsKey=binding?.digest??'NO_BIND_ARRAY';
          const previous=seen.get(sql)?.get(paramsKey);
          if(previous===undefined&&entries.length>=LIMITS.uniqueQueries)fail('SAVED_READ_TRANSCRIPT_LIMIT');
          const passed=params===undefined?[]:[fingerprint(params,LIMITS.paramsBytes,true).detached];
          const result=await (target.query as (...args:unknown[])=>Promise<unknown>).apply(target,[sql,...passed]);
          const observed=resultFingerprint(result,charge);
          responseNodes+=observed.nodes;largestResponseBytes=Math.max(largestResponseBytes,observed.bytes);
          if(previous!==undefined){if(previous!==observed.digest)mismatch('capture',calls,sql,previous,observed.digest,own(result as object,'rowCount'));}
          else {
            if(!seen.has(sql))seen.set(sql,new Map());
            seen.get(sql)!.set(paramsKey,observed.digest);entries.push({sql,params,digest:observed.digest});
          }
          return result;
        }catch(error){failure??={error};throw error;}finally{inflight=false;}
      })();
      pending=task;void task.catch(()=>{});return task;
    };
  }});
  let value:T;
  try{value=await operation(checked);}
  catch(error){failure??={error};}
  finally {
    open=false;
    if(inflight){try{await pending;}catch(error){failure??={error};}failure??={error:Object.assign(new Error('SAVED_READ_TRANSCRIPT_INTEGRITY'),{code:'SAVED_READ_TRANSCRIPT_INTEGRITY'})};}
  }
  if(failure)throw failure.error;
  const statistics=Object.freeze({queryCalls:calls,uniqueQueries:entries.length,responseBytes:totalBytes,responseNodes,largestResponseBytes});
  let consumed=false;
  const replay=async(freshClient:PoolClient):Promise<void>=>{
    if(consumed)fail();consumed=true;
    for(const [index,entry] of entries.entries()){
      const passed=entry.params===undefined?[]:[fingerprint(entry.params,LIMITS.paramsBytes,true).detached];
      const result=await(freshClient.query as (...args:unknown[])=>Promise<unknown>).apply(freshClient,[entry.sql,...passed]);
      const observed=resultFingerprint(result,charge);
      if(observed.digest!==entry.digest)mismatch('replay',index+1,entry.sql,entry.digest,observed.digest,own(result as object,'rowCount'));
    }
  };
  return Object.freeze({value:value!,statistics,replay});
}

/** Default saved read: both clients use separate REPEATABLE READ READ ONLY transactions. */
export function captureSavedRead<T>(client:PoolClient,operation:(client:PoolClient)=>Promise<T>):Promise<CapturedSavedRead<T>> {
  return captureSavedReadCore(client,operation);
}

/** Source-review only. A is REPEATABLE READ with existing command/inspection
 * locks and SELECT-only preparation. C is READ COMMITTED with those same locks,
 * a fresh READ+REVIEW_DECIDE membership row FOR SHARE and fresh CAS/source/stage
 * guards before replay. Immutable saved bodies plus fenced mutable rows must be
 * traced by the caller. No INSERT/UPDATE/DELETE may precede successful replay;
 * this equality entry conveys no actor, source or engineering authority.
 * READ COMMITTED preserves appendAuditEvent's latest-row read after org lock.
 */
export function captureFencedSourceReviewRead<T>(client:PoolClient,operation:(client:PoolClient)=>Promise<T>):Promise<CapturedSavedRead<T>> {
  return captureSavedReadCore(client,operation);
}
