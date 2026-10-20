/** T34: two complete allowlisted originals, no source reviews or synthetic substitution.
 * Run ONLY after coherent T34 deployment is declared READY.
 * node scripts/seed-matrix-steel-public.cjs private-auth.json new-private-state.json
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const [statePath,outputPath]=process.argv.slice(2);
const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(!statePath||!outputPath||![ '127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private auth, new state path and loopback stand required');
for(const p of [outputPath,outputPath+'.upload-receipt'])if(fs.existsSync(p))throw Error('New output paths required; inspect prior receipt before any retry');
assert.equal(fs.statSync(statePath).mode&0o777,0o600,'Auth input must be 0600');
const cookies=JSON.parse(fs.readFileSync(statePath)).cookies;
assert.ok(cookies&&typeof cookies==='object'&&!Array.isArray(cookies));
const specs=[
 {id:'F0105',stage:'PD',section:'KR',pages:29,bytes:3831452,sha256:'8156fe22033fa94ba65ccc063e934b90168de8d0614a4bbecfde5def1e8b4a89'},
 {id:'F0145',stage:'RD',section:'OTHER',pages:14,bytes:2902999,sha256:'0be3a646cc793b86257e3ce4aeb9d0f15326369aa8a37a9205670e82635eaa05'}];
for(const spec of specs){
 spec.path=path.join(__dirname,`../output/matrix-t34-20261018/research-${spec.id}-original.pdf`);
 spec.body=fs.readFileSync(spec.path);assert.equal(spec.body.length,spec.bytes);assert.equal(sha(spec.body),spec.sha256);
 const info=execFileSync('pdfinfo',[spec.path],{encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C'}});
 assert.match(info,new RegExp(`^Pages:\\s+${spec.pages}\\s*$`,'m'));
}
let mutations=0;
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('Cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){mutations++;headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers,signal:AbortSignal.timeout(60000)});
 for(const c of response.headers.getSetCookie()){const[kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${typeof data.error==='string'?data.error:'request failed'}`);return data;
}
function privateWrite(p,value){fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});assert.equal(fs.statSync(p).mode&0o777,0o600);}
(async()=>{
 const object=await call('/objects',{method:'POST',body:JSON.stringify({name:'F0105 / F0145 — декларации стали, полный публичный пакет',address:'Новослободская; полный публичный пакет участникам'})});
 const journal={objectId:object.id,cookies,sources:[]};privateWrite(outputPath+'.upload-receipt',journal);
 const backupDir=path.join(os.homedir(),'.local/state/inspector-feedback-20261017');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
 const interruptedBackup=path.join(backupDir,`T34-${object.id}-upload.json`);privateWrite(interruptedBackup,journal);
 for(const spec of specs){
  const form=new FormData();form.append('file',new Blob([spec.body],{type:'application/pdf'}),`${spec.id}-${spec.stage}-${spec.section}-steel-original.pdf`);
  await call(`/objects/${object.id}/files?stage=${spec.stage}`,{method:'POST',body:form});
  let match;
  for(let i=0;i<30;i++){
   const files=(await call(`/objects/${object.id}/files`)).items;
   match=files.find(file=>file.sha256===spec.sha256);if(match)break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.ok(match,'Committed exact source required');assert.deepEqual(match.stages,[spec.stage]);assert.equal(match.size,spec.bytes);assert.equal(match.review,null);
  journal.sources.push({originalSourceFileId:spec.id,sourceFileId:match.id,sha256:spec.sha256,bytes:spec.bytes,pages:spec.pages,stage:spec.stage,manifestSection:spec.section});
  for(const file of [outputPath+'.upload-receipt',interruptedBackup])fs.writeFileSync(file,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
 }
 const files=(await call(`/objects/${object.id}/files`)).items;assert.equal(files.length,2);assert.ok(files.every(file=>file.review===null));
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'FULL'})});
 journal.checkId=check.id;
 for(const file of [outputPath+'.upload-receipt',interruptedBackup])fs.writeFileSync(file,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
 assert.equal(mutations,4,'Only object creation, two uploads and one check start');
 const state={objectId:object.id,checkId:check.id,cookies,sources:journal.sources};privateWrite(outputPath,state);
 const backup=path.join(backupDir,`${check.id}.json`);privateWrite(backup,state);
 console.log(JSON.stringify({objectId:object.id,checkId:check.id,sources:journal.sources,sourceReviews:0,qualifiedExpected:0,domainMutations:mutations,privateState:outputPath,durablePrivateBackup:backup}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
