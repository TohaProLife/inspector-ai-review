/** T53: fresh FULL v8 run from two complete real public PDFs, UNKNOWN sources.
 * AUTH0600 STATE0600 [--resume] | --self-test. No source judgement commands.
 * A durable command journal precedes every write; retries retain exact key/body.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function specs(){return [
 {originalSourceFileId:'F0106',stage:'PD',pages:139,bytes:23871472,sha256:'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655',file:'output/matrix-t31-20261018/F0106-original.pdf'},
 {originalSourceFileId:'F0139',stage:'RD',pages:22,bytes:2298875,sha256:'d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f',file:'output/matrix-t30-20261018/F0139-original.pdf'},
 ].map(s=>{const file=path.join(root,s.file),body=fs.readFileSync(file);assert.equal(body.length,s.bytes);assert.equal(sha(body),s.sha256);
 const info=execFileSync('pdfinfo',[file],{encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C'}});
 assert.match(info,new RegExp(`^Pages:\\s+${s.pages}\\s*$`,'m'));return{...s,body};});}
function privateRead(file){assert.equal(fs.statSync(file).mode&0o777,0o600,'private state must be 0600');return JSON.parse(fs.readFileSync(file));}
function atomicPrivate(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp-'+process.pid;
 fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);fs.chmodSync(file,0o600);}
function checkpoint(file,state){atomicPrivate(file,state);const dir=path.join(os.homedir(),'.local/state/inspector-feedback-20261017');
 atomicPrivate(path.join(dir,`T53-${state.journalId}.json`),state);if(state.checkId)atomicPrivate(path.join(dir,`${state.checkId}.json`),state);}
function acquire(file){const lock=file+'.lock';fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 if(fs.existsSync(lock)){const old=privateRead(lock);assert.ok(Number.isSafeInteger(old.pid)&&old.pid>0);let active=true;
  try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')active=false;else throw e;}
  assert.equal(active,false,'another process owns this journal');fs.unlinkSync(lock);}
 fs.writeFileSync(lock,JSON.stringify({pid:process.pid})+'\n',{flag:'wx',mode:0o600});
 return()=>{if(fs.existsSync(lock)&&privateRead(lock).pid===process.pid)fs.unlinkSync(lock);};}
function baseUrl(){const base=process.env.FEEDBACK_API_URL||'http://127.0.0.1:24101/api',u=new URL(base);
 assert.ok(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname));return base.replace(/\/$/,'');}
async function request(state,endpoint,{method,body,contentType,key}={}){
 const headers={Cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};
 if(method){headers['X-CSRF-Token']=decodeURIComponent(state.cookies.inspector_csrf||'');headers['Idempotency-Key']=key;headers['Content-Type']=contentType;}
 const r=await fetch(baseUrl()+'/'+endpoint,{method,body,headers,signal:AbortSignal.timeout(60000)});
 for(const c of r.headers.getSetCookie()){const[kv]=c.split(';'),[k,...v]=kv.split('=');state.cookies[k]=v.join('=');}
 const bytes=Buffer.from(await r.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{data=null;}
 return{status:r.status,data,bytes,replayed:r.headers.get('Idempotency-Replayed')==='true'};}
async function get(state,endpoint){const r=await request(state,endpoint);assert.equal(r.status,200,`GET ${endpoint}: HTTP ${r.status}`);return r.data;}
async function command(file,state,label,endpoint,input,contentType='application/json'){
 const bytes=Buffer.isBuffer(input)?input:Buffer.from(JSON.stringify(input));let op=state.operations[label];
 if(!op){op=state.operations[label]={key:crypto.randomUUID(),endpoint,contentType,bodySha256:sha(bytes),createdAt:new Date().toISOString(),status:'PENDING'};checkpoint(file,state);}
 assert.equal(op.endpoint,endpoint);assert.equal(op.contentType,contentType);assert.equal(op.bodySha256,sha(bytes));
 if(op.status==='DONE')return structuredClone(op.response);assert.equal(op.status,'PENDING');
 assert.ok(Date.now()-Date.parse(op.createdAt)<15*60*1000,'pending command older than 15 minutes: reconcile existing result before retry');
 const r=await request(state,endpoint,{method:'POST',body:bytes,contentType,key:op.key});checkpoint(file,state);
 assert.equal(r.status,201,`${label}: HTTP ${r.status}`);op.status='DONE';op.response=r.data;op.responseSha256=sha(r.bytes);op.replayed=r.replayed;
 checkpoint(file,state);return structuredClone(r.data);}
function multipart(spec,boundary){return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${spec.originalSourceFileId}-${spec.stage}-original-full.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),spec.body,Buffer.from(`\r\n--${boundary}--\r\n`)]);}
function selfTest(){const sources=specs();for(const s of sources){const boundary='----inspector-t53-offline-'+s.stage,body=multipart(s,boundary);
 assert.deepEqual(body,multipart(s,boundary));assert.ok(body.includes(s.body));assert.ok(body.length>s.bytes);assert.notEqual(sha(body),s.sha256);}
 return{status:'PASS_LOCAL_PREFLIGHT',originalPages:161,originals:sources.map(({body,file,...s})=>s),domainWrites:0,networkCalls:0,browserCalls:0};}
async function main(){if(process.argv[2]==='--self-test'){console.log(JSON.stringify(selfTest()));return;}
 const[authPath,statePath,...flags]=process.argv.slice(2);assert.ok(authPath&&statePath);assert.ok(flags.every(x=>x==='--resume'));baseUrl();
 const ready=JSON.parse(fs.readFileSync(path.join(root,'output/matrix-t53-20261018/deploy-result.json')));
 assert.equal(ready.status,'PASS','T53 coherent deployment required before seeding');
 const pins=JSON.parse(fs.readFileSync(path.join(root,'output/matrix-t53-20261018/runtime-pins-after-deploy.json')));
 assert.equal(pins.status,'PASS');assert.equal(pins.roles.api.waterNodeEnabled,true);
 const release=acquire(statePath);process.once('exit',release);let state;
 if(fs.existsSync(statePath)){assert.ok(flags.includes('--resume'),'existing journal requires --resume');state=privateRead(statePath);assert.equal(state.schemaVersion,'matrix-real-public-v8-state-v1');}
 else{assert.ok(!flags.includes('--resume'));const auth=privateRead(authPath);assert.ok(auth.cookies&&typeof auth.cookies==='object');
  state={schemaVersion:'matrix-real-public-v8-state-v1',journalId:crypto.randomUUID(),cookies:auth.cookies,objectId:null,checkId:null,sources:[],operations:{},sourceReviews:0};checkpoint(statePath,state);}
 const sources=specs(),object=await command(statePath,state,'create-object','objects',{
  name:'T53 F0106 / F0139 — полный реальный пакет, v8, источники UNKNOWN',address:'Новослободская; открытые материалы кейса, без подтверждения геопривязки'});
 assert.match(object.id,/^OBJ-[A-Z0-9]+$/u);state.objectId=object.id;checkpoint(statePath,state);
 assert.match((await get(state,`objects/${state.objectId}`)).name,/^T53 F0106 \/ F0139/u);
 for(const spec of sources){const boundary='----inspector-t53-'+state.journalId+'-'+spec.stage;
  await command(statePath,state,'upload-'+spec.stage,`objects/${state.objectId}/files?stage=${spec.stage}`,multipart(spec,boundary),'multipart/form-data; boundary='+boundary);
  const rows=(await get(state,`objects/${state.objectId}/files`)).items,matching=rows.filter(f=>f.sha256===spec.sha256);
  assert.equal(matching.length,1);const f=matching[0];assert.equal(f.review,null);assert.equal(f.size,spec.bytes);assert.deepEqual(f.stages,[spec.stage]);
  const entry={originalSourceFileId:spec.originalSourceFileId,sourceFileId:f.id,sha256:spec.sha256,bytes:spec.bytes,pages:spec.pages,stage:spec.stage};
  const previous=state.sources.find(s=>s.stage===spec.stage);if(previous)assert.deepEqual(previous,entry);else state.sources.push(entry);checkpoint(statePath,state);}
 const files=(await get(state,`objects/${state.objectId}/files`)).items;assert.equal(files.length,2);assert.ok(files.every(f=>f.review===null));
 const check=await command(statePath,state,'full-check',`objects/${state.objectId}/checks`,{analysisMode:'FULL'});
 state.checkId=check.id;state.seedComplete=true;assert.equal(Object.keys(state.operations).length,4);checkpoint(statePath,state);
 console.log(JSON.stringify({status:'SEEDED_PENDING_TERMINAL_CHECK',objectId:state.objectId,checkId:state.checkId,sources:state.sources,uniqueDomainCommands:4,sourceReviews:0,browserCalls:0}));}
module.exports={specs,sha,multipart,selfTest};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
