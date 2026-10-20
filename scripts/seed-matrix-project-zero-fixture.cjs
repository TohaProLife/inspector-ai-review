/** Upload only controlled T30 originals to the isolated loopback stand. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const [statePath,directory='/tmp/matrix-project-zero-fixture']=process.argv.slice(2);
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Auth state must be private (0600)');
const cookies=JSON.parse(fs.readFileSync(statePath)).cookies,fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
if(fixture.schemaVersion!=='synthetic-matrix-project-zero-binding-v1'||fixture.documents.length!==2)throw Error('Explicit synthetic project zero fixture required');
const output=path.join(directory,'state.json'),receipt=output+'.upload-receipt';
if(fs.existsSync(output)||fs.existsSync(receipt))throw Error('Preserve previous fixture state or interrupted upload receipt');
for(const descriptor of fixture.documents){
 if(!['PD','RD'].includes(descriptor.stage)||descriptor.name!==`matrix-project-zero-binding-${descriptor.stage}.pdf`||descriptor.sectionCode!==(descriptor.stage==='PD'?'PZ':'KR'))throw Error('Invalid fixture descriptor');
 const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,descriptor.name))).digest('hex');
 if(actual!==descriptor.sha256)throw Error('Controlled original hash mismatch');
}
if(new Set(fixture.documents.map(item=>item.stage)).size!==2)throw Error('One PD and one RD required');
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers});for(const c of response.headers.getSetCookie()){const [kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${typeof data.error==='string'?data.error:data.error?.code??'request failed'}`);return data;
}
(async()=>{
 const object=await call('/objects',{method:'POST',body:JSON.stringify({name:'T30 — синтетический проектный ноль',address:'Контролируемая фикстура; не реальный объект'})});
 fs.writeFileSync(receipt,JSON.stringify({objectId:object.id,cookies,fixtureSchema:fixture.schemaVersion}),{mode:0o600,flag:'wx'});
 for(const descriptor of fixture.documents){
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(path.join(directory,descriptor.name))],{type:'application/pdf'}),descriptor.name);
  await call(`/objects/${object.id}/files?stage=${descriptor.stage}`,{method:'POST',body:form});
 }
 let files;
 for(let attempt=0;attempt<30;attempt++){
  files=(await call(`/objects/${object.id}/files`)).items;
  if(files.length===2)break;await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(files?.length!==2||fixture.documents.some(d=>!files.some(f=>f.name===d.name&&f.sha256===d.sha256&&f.stages?.length===1&&f.stages[0]===d.stage)))throw Error('Exact committed controlled sources required');
 // Initial run deliberately has no source review or matrix scope. Browser reviews both sources explicitly.
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'SAMPLE'})});
 const state={objectId:object.id,checkId:check.id,cookies};
 fs.writeFileSync(output,JSON.stringify(state),{mode:0o600,flag:'wx'});
 const durable=path.join(os.homedir(),'.local/state/inspector-feedback-20261017',`${check.id}.json`);
 fs.writeFileSync(durable,JSON.stringify(state),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({objectId:object.id,checkId:check.id,privateState:output,expected:fixture.expected}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
