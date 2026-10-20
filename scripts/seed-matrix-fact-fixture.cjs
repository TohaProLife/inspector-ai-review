/** Upload only controlled T13 originals to the isolated loopback stand. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [statePath,directory='/tmp/matrix-fact-fixture']=process.argv.slice(2);
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Auth state must be private (0600)');
const cookies=JSON.parse(fs.readFileSync(statePath)).cookies,fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
if(!['synthetic-matrix-fact-binding-v1','synthetic-matrix-sidewalk-binding-v1','synthetic-matrix-egress-binding-v1','synthetic-matrix-stairs-binding-v1'].includes(fixture.schemaVersion)||fixture.documents.length!==2)throw Error('Explicit synthetic fixture required');
const sidewalk=fixture.schemaVersion==='synthetic-matrix-sidewalk-binding-v1',stairs=fixture.schemaVersion==='synthetic-matrix-stairs-binding-v1',egress=fixture.schemaVersion==='synthetic-matrix-egress-binding-v1';
const output=path.join(directory,'state.json');if(fs.existsSync(output))throw Error('Preserve previous fixture state');
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers});for(const c of response.headers.getSetCookie()){const [kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${typeof data.error==='string'?data.error:data.error?.code??'request failed'}`);return data;
}
(async()=>{
 const object=await call('/objects',{method:'POST',body:JSON.stringify({name:stairs?'T20 — синтетические размеры ступеней':egress?'T18 — синтетические высоты эвакуации':sidewalk?'T14 — синтетическое плиточное мощение':'T13 — синтетические независимые строки',address:'Контролируемая фикстура; не реальный объект'})});
 for(const descriptor of fixture.documents){
  const allowed=stairs?/^matrix-stairs-binding-(PD|RD)\.pdf$/:egress?/^matrix-egress-binding-(PD|RD)\.pdf$/:sidewalk?/^matrix-sidewalk-binding-(PD|RD)\.pdf$/:/^matrix-fact-binding-(PD|RD)\.pdf$/;
  if(path.basename(descriptor.name)!==descriptor.name||!allowed.test(descriptor.name))throw Error('Invalid fixture path');
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(directory,descriptor.name))],{type:'application/pdf'}),descriptor.name);
  await call(`/objects/${object.id}/files?stage=${descriptor.stage}`,{method:'POST',body:form});
 }
 const files=(await call(`/objects/${object.id}/files`)).items;
 if(files.length!==2||fixture.documents.some(d=>!files.some(f=>f.name===d.name&&f.sha256===crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,d.name))).digest('hex'))))throw Error('Exact original fixture hashes required');
 for(const descriptor of fixture.documents){const file=files.find(f=>f.name===descriptor.name);
  await call(`/objects/${object.id}/files/${file.id}/source-review`,{method:'POST',body:JSON.stringify({sourceSha256:file.sha256,
   revisionStatus:'CURRENT',approvalStatus:'APPROVED',linkGroupId:'synthetic-fact-bindings-20261017',sectionCode:descriptor.sectionCode,
   pageStages:{},basis:{reference:'Explicit synthetic controlled originals; no real project approval'}})});
 }
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'SAMPLE'})});
 fs.writeFileSync(output,JSON.stringify({objectId:object.id,checkId:check.id,cookies}),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({objectId:object.id,checkId:check.id,privateState:output,expected:fixture.expected}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
