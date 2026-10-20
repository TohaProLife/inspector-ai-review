/** T28: new isolated run from the exact allowlisted public F0151 original. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [statePath,outputPath,original='/tmp/matrix-t20-F0151.pdf']=process.argv.slice(2);
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
const expectedSha='afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a';
if(!statePath||!outputPath||(fs.existsSync(outputPath)||fs.existsSync(outputPath+'.upload-receipt'))||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private input, new output and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Private auth state required');
const bytes=fs.readFileSync(original);if(bytes.length!==7666331||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw Error('Exact allowlisted F0151 original required');
const cookies=JSON.parse(fs.readFileSync(statePath)).cookies;
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers});for(const c of response.headers.getSetCookie()){const [kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${typeof data.error==='string'?data.error:'request failed'}`);return data;
}
(async()=>{
 const object=await call('/objects',{method:'POST',body:JSON.stringify({name:'F0151 — проектный минимум дверного проёма',address:'Тюменская; исходный публичный пакет участникам'})});
 // Retain a receipt before upload; an interrupted run must not duplicate the object silently.
 const receipt=outputPath+'.upload-receipt';fs.writeFileSync(receipt,JSON.stringify({objectId:object.id,originalSha256:expectedSha,cookies}),{mode:0o600,flag:'wx'});
 const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),'F0151-PD-ODI-original.pdf');
 await call(`/objects/${object.id}/files?stage=PD`,{method:'POST',body:form});
 let files;for(let i=0;i<30;i++){files=(await call(`/objects/${object.id}/files`)).items;if(files.length===1)break;await new Promise(resolve=>setTimeout(resolve,1000));}
 if(files?.length!==1||files[0].sha256!==expectedSha||files[0].stages?.some(s=>s!=='PD'))throw Error('Committed exact PD source required');
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'SAMPLE'})});
 fs.writeFileSync(outputPath,JSON.stringify({objectId:object.id,checkId:check.id,cookies}),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({objectId:object.id,checkId:check.id,sourceFileId:files[0].id,sourceSha256:expectedSha,originalPages:40,reviewStatus:'UNKNOWN',analysisMode:'SAMPLE',privateState:outputPath}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
