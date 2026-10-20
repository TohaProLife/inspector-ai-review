/** Native stage output boundary. Legacy normalized PDF geometry uses finite
 * fractions; the separate v7 input and KR060 child/snapshot remain integer JSON. */
import {isProxy} from 'node:util/types';

export function assertColumnPylonSectionStageNative(input:unknown):void {
 let nodes=0,bytes=0;const active=new Set<object>();
 function invalid():never{throw new TypeError('Invalid column/pylon stage native JSON');}
 function limit():never{throw new RangeError('Column/pylon stage exceeds fixed native limits');}
 const charge=(count:number)=>{bytes+=count;if(bytes>8_388_608)limit();};
 const visit=(value:unknown,depth:number):void=>{
  if(++nodes>1_000_000||depth>69)limit();
  if(value===null){charge(4);return;}
  if(typeof value==='boolean'){charge(value?4:5);return;}
  if(typeof value==='number'){
   if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))invalid();
   charge(JSON.stringify(value).length);return;
  }
  if(typeof value==='string'){
   if(value.length>4_000_000)limit();let length=0;
   for(const character of value){if(++length>2_000_000)limit();const point=character.codePointAt(0)!;if(point>=0xd800&&point<=0xdfff)invalid();}
   charge(Buffer.byteLength(JSON.stringify(value),'utf8'));return;
  }
  if(!value||typeof value!=='object'||isProxy(value)||active.has(value))invalid();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  if(names.some(key=>typeof key!=='string'||/[^\x00-\x7f]/u.test(key)))invalid();
  let keys:string[];
  if(array){
   const length=descriptors.length?.value;if(!Number.isSafeInteger(length)||length<0)invalid();
   if(length>32768)limit();if(names.length!==length+1)invalid();
   keys=Array.from({length},(_,index)=>String(index));
  }else{if(names.length>32768)limit();keys=names as string[];}
  active.add(value);charge(2+Math.max(0,keys.length-1)+(array?0:keys.length));
  for(const key of keys){
   const property=descriptors[key];if(!property?.enumerable||!Object.hasOwn(property,'value'))invalid();
   if(!array)visit(key,depth+1);visit(property.value,depth+1);
  }
  active.delete(value);
 };
 visit(input,0);
}
