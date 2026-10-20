/** Finite accepted identities. Data authenticity never authorises execution of archived code. */
import capsules from './matrix-policy-history-v1.json' with {type:'json'};
import {canonicalJson,sha256} from './canonical-json.js';
const expected=[
 ['matrix-text-facts-lighting-technology-v9','9','c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84'],
 ['matrix-text-facts-steel-comparison-v10','10','ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6'],
]as const;
function freeze(value:unknown):void {
 if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
}
if(capsules.schemaVersion!=='matrix-policy-history-v1'||capsules.purpose!=='FINITE_HISTORICAL_MATRIX_IDENTITIES'||capsules.entries.length!==2)
 throw Error('Historical matrix capsule integrity failure');
const entries=new Map<string,{hash:string;definitions:Record<string,unknown>}>();
for(const [profile,adapter,hash]of expected){
 const matches=capsules.entries.filter(row=>row.profileId===profile);
 const row=matches[0];
 if(matches.length!==1||!row||row.adapterVersion!==adapter||row.configHash!==hash||sha256(canonicalJson(row.definitions))!==hash)
  throw Error('Historical matrix capsule integrity failure');
 freeze(row.definitions);entries.set(profile,{hash,definitions:row.definitions});
}
/** Only primitive selectors accepted; no coercion, getters, proxies or caller-supplied definitions. */
export function historicalMatrixPolicyDefinitions(profileId:unknown,configHash:unknown):Record<string,unknown>|null {
 if(typeof profileId!=='string'||typeof configHash!=='string')return null;
 const entry=entries.get(profileId);return entry?.hash===configHash?entry.definitions:null;
}
