/** T40 controlled originals, explicitly SYNTHETIC ONLY. No real-project or completeness claim.
 * Run once after coherent T40 deployment: node script private-auth.json new-private-state.json
 * This command creates one test object, uploads two authored original PDFs and starts one check.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [authPath,statePath]=process.argv.slice(2),base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.ok(authPath&&statePath&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.equal(fs.statSync(authPath).mode&0o777,0o600);assert.ok(!fs.existsSync(statePath)&&!fs.existsSync(statePath+'.journal'));
const cookies=JSON.parse(fs.readFileSync(authPath)).cookies;assert.ok(cookies&&typeof cookies==='object'&&!Array.isArray(cookies));
const fixtures=path.join(__dirname,'../services/worker/tests/fixtures/matrix-inventory-v1');
const golden=JSON.parse(fs.readFileSync(path.join(fixtures,'portable-goldens.json')));
const specs=['pd-both','rd-gasket'].map(name=>{const f=golden.fixtures.find(f=>f.name===name);assert.ok(f);const body=fs.readFileSync(path.join(fixtures,f.provenance.pdf));
 assert.equal(sha(body),f.provenance.sourceSha256);assert.equal(body.length,f.provenance.originalBytes);assert.equal(f.provenance.kind,'SYNTHETIC_ORIGINAL_PDF');
 return{name,body,sha256:f.provenance.sourceSha256,bytes:body.length,pages:2,stage:f.input.stage};});
let mutations=0;const journal={syntheticOnly:true,notPublicProjectData:true,objectId:null,checkId:null,sources:[],cookies};
const backupDir=path.join(os.homedir(),'.local/state/inspector-feedback-20261017');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});let backup;
function save(){fs.writeFileSync(statePath+'.journal',JSON.stringify(journal,null,2)+'\n',{mode:0o600});if(backup)fs.writeFileSync(backup,JSON.stringify(journal,null,2)+'\n',{mode:0o600});}
async function call(endpoint,options={}){
 const headers=new Headers(options.headers);headers.set('Cookie',Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(options.method){mutations++;headers.set('X-CSRF-Token',decodeURIComponent(cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());if(!(options.body instanceof FormData))headers.set('Content-Type','application/json');}
 const response=await fetch(base+endpoint,{...options,headers,signal:AbortSignal.timeout(60000)});
 for(const c of response.headers.getSetCookie()){const[kv]=c.split(';'),[k,...v]=kv.split('=');cookies[k]=v.join('=');}
 const data=await response.json();if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status} ${typeof data.error==='string'?data.error:'request failed'}`);return data;
}
(async()=>{
 const object=await call('/objects',{method:'POST',body:JSON.stringify({name:'T40 SYNTHETIC ONLY — контроль областей перечня AR-053',address:'Синтетические PDF для тестового стенда; не данные объекта'})});
 journal.objectId=object.id;backup=path.join(backupDir,`T40-${object.id}-upload.json`);save();
 for(const spec of specs){
  const form=new FormData();form.append('file',new Blob([spec.body],{type:'application/pdf'}),`SYNTHETIC-ONLY-${spec.name}.pdf`);
  await call(`/objects/${object.id}/files?stage=${spec.stage}`,{method:'POST',body:form});
  let match;for(let i=0;i<30;i++){match=(await call(`/objects/${object.id}/files`)).items.find(f=>f.sha256===spec.sha256);if(match)break;await new Promise(resolve=>setTimeout(resolve,500));}
  assert.ok(match);assert.equal(match.review,null);assert.deepEqual(match.stages,[spec.stage]);assert.equal(match.size,spec.bytes);
  journal.sources.push({fixtureName:spec.name,sourceFileId:match.id,sha256:spec.sha256,bytes:spec.bytes,pages:spec.pages,stage:spec.stage});save();
 }
 assert.equal((await call(`/objects/${object.id}/files`)).items.length,2);
 const check=await call(`/objects/${object.id}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'FULL'})});journal.checkId=check.id;save();
 assert.equal(mutations,4);fs.writeFileSync(statePath,JSON.stringify(journal,null,2)+'\n',{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(backupDir,`${check.id}.json`),JSON.stringify(journal,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:'SEEDED_PENDING_TERMINAL_CHECK',syntheticOnly:true,objectId:object.id,checkId:check.id,sources:journal.sources,domainMutations:mutations,sourceReviews:0,realPublicPair:false}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
