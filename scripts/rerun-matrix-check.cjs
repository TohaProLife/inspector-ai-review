/** New immutable run on an existing isolated stand object; never changes source reviews. */
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const [statePath,outputPath,mode='SAMPLE']=process.argv.slice(2);
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
if(!statePath||!outputPath||!['SAMPLE','FULL'].includes(mode)
  ||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private input, new output path and loopback stand required');
if(fs.existsSync(outputPath)||path.resolve(statePath)===path.resolve(outputPath))throw Error('Preserve previous run state; output must be new');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Auth state must have mode 0600');
const state=JSON.parse(fs.readFileSync(statePath));
async function call(endpoint,options={}) {
 const headers=new Headers(options.headers);headers.set('cookie',Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(state.cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers});
 for(const c of response.headers.getSetCookie()){const [kv]=c.split(';'),[k,...v]=kv.split('=');state.cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${data.error?.code??data.code??'request failed'}`);
 return data;
}
(async()=>{
 const old=await call(`/checks/${state.checkId}`);
 if(old.objectId!==state.objectId||!['PARTIAL','SUCCEEDED','COMPLETED','FAILED'].includes(old.status))throw Error('Previous run must be terminal on this object');
 const files=(await call(`/objects/${state.objectId}/files`)).items;
 // This endpoint enumerates committed source summaries, not upload/scan job DTOs.
 if(!files.length||files.some(f=>!/^FIL-[A-Z0-9]+$/.test(f.id)||!/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('Committed source identities required');
 const check=await call(`/objects/${state.objectId}/checks`,{method:'POST',body:JSON.stringify({analysisMode:mode})});
 fs.writeFileSync(outputPath,JSON.stringify({...state,previousCheckId:state.checkId,checkId:check.id}),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({objectId:state.objectId,previousCheckId:state.checkId,checkId:check.id,analysisMode:mode,
   sources:files.map(f=>({sourceFileId:f.id,sha256:f.sha256})),privateState:outputPath}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
