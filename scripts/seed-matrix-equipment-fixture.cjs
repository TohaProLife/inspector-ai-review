/** Writes only explicitly synthetic T07 documents to an isolated loopback acceptance stand. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const statePath=process.argv[2],directory=process.argv[3]||'/tmp/matrix-equipment-fixture';
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Auth state must be private (0600)');
const cookies=JSON.parse(fs.readFileSync(statePath)).cookies;
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
if(fixture.schemaVersion!=='synthetic-matrix-equipment-v1'||fixture.documents.length!==9)throw Error('Explicit synthetic fixture required');
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers});for(const c of response.headers.getSetCookie()){const [kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: ${response.status} ${JSON.stringify(data)}`);return data;
}
(async()=>{
 const output=path.join(directory,'state.json'),retry=process.argv.includes('--retry');
 const object=retry?{id:JSON.parse(fs.readFileSync(output)).objectId}:await call('/objects',{method:'POST',body:JSON.stringify({name:'T07 — синтетический тест оборудования и слоёв',address:'Контролируемые фикстуры; не реальный объект'})});
 for(const descriptor of fixture.documents){
  if(path.basename(descriptor.name)!==descriptor.name||!descriptor.name.startsWith('matrix-equipment-'))throw Error('Invalid fixture path');
  if(!retry){const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(directory,descriptor.name))],{type:'application/pdf'}),descriptor.name);
   await call(`/objects/${object.id}/files?stage=${descriptor.stage}`,{method:'POST',body:form});}
 }
 const files=(await call(`/objects/${object.id}/files`)).items;
 if(files.length!==9||fixture.documents.some(d=>!files.some(f=>f.name===d.name&&f.sha256===crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,d.name))).digest('hex'))))throw Error('Retry requires the exact nine original synthetic fixture hashes');
 for(const descriptor of fixture.documents){const file=files.find(f=>f.name===descriptor.name);
  await call(`/objects/${object.id}/files/${file.id}/source-review`,{method:'POST',body:JSON.stringify({sourceSha256:file.sha256,
   revisionStatus:'CURRENT',approvalStatus:'APPROVED',linkGroupId:'synthetic-equipment-20261017',sectionCode:descriptor.sectionCode,
   pageStages:{},basis:{reference:'Explicit synthetic controlled fixture; never approval of a real project'},matrixScope:descriptor.matrixScope})});
 }
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'SAMPLE'})});
 fs.writeFileSync(output,JSON.stringify({objectId:object.id,checkId:check.id,cookies}),{mode:0o600});
 console.log(JSON.stringify({objectId:object.id,checkId:check.id,privateState:output,expected:fixture.expected}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
