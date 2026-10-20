/** T50 independent historical-real-data oracle plus production PURE SSR presentation check.
 * Run: TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx scripts/smoke-matrix-review-priority.ts --self-test
 * HTTP: ... verify PRIVATE_STATE_0600 (parent deploy GO required).
 * No served-bundle execution, browser/DOM, source review, or domain commands.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import type {MatrixExecutionRead,SourceFileSummary} from "@inspector-ai/contracts";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const script=fileURLToPath(import.meta.url);
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const oraclePin=["output/matrix-t50-20261018/http-expectations.json","15e4b8cf54f8c1d82ab873e29cdce2feb39c4c4110a66ff5852a9ef717bb5819"] as const;
const planPin=["output/matrix-t50-20261018/http-plan.json","1665aae88069eef45245d0d7868e84aa54947d8ea5a789d26c8502abcfdaeaee"] as const;
function pinned(pin:readonly[string,string]):any {const bytes=fs.readFileSync(path.join(root,pin[0]));assert.equal(sha(bytes),pin[1],`Frozen oracle ${pin[0]}`);return JSON.parse(bytes.toString("utf8"));}
const oracle=pinned(oraclePin);pinned(planPin);
// Production modules are imported ONLY after the independent immutable expectations are checked.
async function production(){
 const previous=globalThis.fetch;globalThis.fetch=(()=>{throw Error("PURE SSR IMPORT MUST NOT FETCH");}) as typeof fetch;
 try{
 const React=await import("react"),server=await import("react-dom/server");
 const helper=await import("../apps/web/src/matrix-review-worklist.ts");
 const component=await import("../apps/web/src/MatrixReviewWorklist.tsx");
 return {React,server,helper,component};
 }finally{globalThis.fetch=previous;}
}
function original(){return pinned(oracle.rawPins.matrix);}
function validateData(data:any){
 assert.equal(data.checkId,oracle.checkId);assert.equal(sha(JSON.stringify(data)),oracle.dataByteHash,"Whole saved matrix DTO unchanged");
 assert.equal(data.execution.results.length,63);assert.equal(data.execution.observations.length,15);
 assert.equal(sha(JSON.stringify(data.execution.results)),oracle.resultArrayByteHash);
 assert.ok(data.execution.results.every((r:any)=>!r.qualified&&r.executionStatus!=="FAILED"));
 assert.ok(data.execution.observations.every((f:any)=>f.sourceFlags.includes("SOURCE_APPROVAL_UNKNOWN")&&f.sourceFlags.includes("SOURCE_REVISION_UNKNOWN")));
 assert.ok(data.presentation.every((p:any)=>p.confidence.calibratedProbability===null));
}
function filesOffline():SourceFileSummary[]{return oracle.sources.map((s:any)=>({id:s.id,name:`PUBLIC ${s.originalSourceFileId} ${s.stage}.pdf`,sha256:s.sha256,size:s.bytes,
 stages:[s.stage],pageCount:s.pages,registeredAt:"2026-10-18T00:00:00.000Z",review:null}));}
function validateFiles(files:any){
 assert.ok(Array.isArray(files));assert.equal(files.length,2);
 assert.equal(new Set(files.map((f:any)=>f.id)).size,2);
 for(const s of oracle.sources){const f:SourceFileSummary|undefined=files.find((candidate:any)=>candidate.id===s.id);assert.ok(f);assert.equal(f.sha256,s.sha256);assert.equal(f.size,s.bytes);assert.equal(f.pageCount,s.pages);assert.deepEqual(f.stages,[s.stage]);assert.equal(f.review,null);assert.equal(typeof f.name,"string");}
}
const escaped=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#x27;");
async function ssr(data:MatrixExecutionRead,files:SourceFileSummary[],out:string){
 validateData(data);validateFiles(files);
 const p=await production(),inputBytes=JSON.stringify([data,files]);
 const items=p.helper.buildMatrixReviewWorklist(data,files);
 assert.equal(items.length,oracle.counts.total);
 const counts={BOTH_STAGES:0,ONE_STAGE:0,NO_FACTS:0,INVALID:0};
 for(let i=0;i<items.length;i++){
  const item=items[i];assert.equal(item.resultIndex,i);assert.equal(item.key,oracle.resultKeys[i]);assert.equal(item.result,data.execution.results[i]);
  assert.equal(sha(JSON.stringify(item.result)),oracle.resultByteHashes[i]);assert.equal(item.invalidRule,false);counts[p.helper.matrixReviewAvailability(item)]++;
  for(const group of item.groups)for(const fact of group.facts){const f=p.helper.matrixReviewFactSource(fact,files);assert.ok(f);assert.equal(f.id,fact.sourceFileId);assert.equal(f.sha256,fact.sourceSha256);}
 }
 assert.deepEqual(counts,{BOTH_STAGES:2,ONE_STAGE:4,NO_FACTS:57,INVALID:0});
 let onSelectCalls=0,onSourceCalls=0,onViewCalls=0,fetchCalls=0;
 const onSelect=()=>{onSelectCalls++;},onSource=()=>{onSourceCalls++;},onViewChange=()=>{onViewCalls++;};
 const previousFetch=globalThis.fetch;
 const renders=[];
 try{
  globalThis.fetch=(()=>{fetchCalls++;throw Error("PURE SSR MUST NOT FETCH");}) as typeof fetch;
  for(const filter of ["ALL","BOTH_STAGES","ONE_STAGE","NO_FACTS"] as const)for(const factsFirst of [false,true]){
   const view={filter,factsFirst};const visible=p.helper.selectMatrixReviewWork(items,view);
   const expected=(factsFirst?oracle.factsFirst:oracle.indices.ALL).filter((i:number)=>oracle.indices[filter].includes(i));
   assert.deepEqual(visible.map(item=>item.resultIndex),expected,"Independent exact original result indices/order");
   for(const item of visible)assert.equal(item,items[item.resultIndex],"Sorting/filter keeps original item/key/result");
   const html=p.server.renderToStaticMarkup(p.React.createElement(p.component.MatrixReviewWorklist,{data,files,onSelect,onSource,onViewChange,view}));
   const codes=[...html.matchAll(/<summary>([A-Z][A-Z0-9]*-\d{3}) ·/gu)].map(m=>m[1]);
   assert.deepEqual(codes,expected.map((i:number)=>data.execution.results[i].parameterCode));
   assert.ok(html.includes(`Показано: ${expected.length} / 63.`));
   assert.ok(html.includes("Факты обеих стадий: 2. Одной: 4. Без фактов: 57. Неподтверждённые ссылки или правила: 0."));
   assert.ok(html.includes("Не хватает данных или подтверждений: 63 результатов. Исходные факты доступны для 6."));
   assert.equal((html.match(/<summary>Искать в исходных файлах<\/summary>/gu)||[]).length,1);
   assert.equal((html.match(/Проверить источник: /gu)||[]).length,2);
   for(const file of files){assert.ok(html.includes(`Проверить источник: ${escaped(file.name)}`));assert.ok(html.includes(`${file.id} · SHA ${file.sha256}`));}
   const buttons=html.match(/<button\b[^>]*>/gu)||[];assert.ok(buttons.length>=2);assert.ok(buttons.every(b=>b.includes('type="button"')&&!b.includes("disabled")));
   const options=[...html.matchAll(/<option\b([^>]*)value="([A-Z_]+)"([^>]*)>/gu)];
   assert.equal(options.filter(m=>(m[1]+m[3]).includes("selected")).length,1);
   assert.ok(options.some(m=>m[2]===filter&&(m[1]+m[3]).includes("selected")));
   const checkbox=html.match(/<input\b[^>]*type="checkbox"[^>]*>/u);assert.ok(checkbox);assert.equal(checkbox[0].includes("checked"),factsFirst);
   assert.doesNotMatch(html,/<form\b|<img\b|<iframe\b|Высокая уверенность|Готово к сравнению|Сопоставимая пара|Нарушений нет/u);
   const name=`SSR-${filter}-${factsFirst?"facts-first":"original-order"}.html`;fs.writeFileSync(path.join(out,name),html,{flag:"wx"});
   renders.push({filter,factsFirst,visible:expected.length,resultIndices:expected,htmlFile:name,htmlSha256:sha(html),sharedSourceChoosers:1,explicitSourceButtons:2});
  }
 }finally{globalThis.fetch=previousFetch;}
 assert.equal(JSON.stringify([data,files]),inputBytes,"Pure projection and SSR leave full original DTO/files unchanged");
 assert.equal(onSelectCalls,0);assert.equal(onSourceCalls,0);assert.equal(onViewCalls,0);assert.equal(fetchCalls,0);
 return {counts:{total:63,...counts},renders,onSelectCalls,onSourceCalls,onViewCalls,ssrFetchCalls:fetchCalls,originalResultKeysIndicesAndBytesPreserved:true,inputImmutable:true};
}
function readState(filename:string){
 const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,0o600);
 const state=JSON.parse(fs.readFileSync(filename,"utf8"));assert.equal(state.schemaVersion,"matrix-real-public-v7-state-v1");assert.equal(state.checkId,oracle.checkId);assert.equal(state.objectId,oracle.publicObjectId);
 assert.ok(state.cookies&&Object.getPrototypeOf(state.cookies)===Object.prototype&&Object.keys(state.cookies).length>0);
 for(const [key,value]of Object.entries(state.cookies)){assert.match(key,/^[A-Za-z0-9_-]+$/u);assert.equal(typeof value,"string");assert.ok(!/[\r\n;]/u.test(value as string));}
 assert.equal(state.sources.length,2);for(const spec of oracle.sources){const source=state.sources.find((s:any)=>s.sourceFileId===spec.id);assert.ok(source);assert.equal(source.originalSourceFileId,spec.originalSourceFileId);assert.equal(source.sha256,spec.sha256);}
 return state;
}
async function offline(out:string){
 const data=original(),files=filesOffline();let rejects=0;
 for(const mutate of [(d:any)=>{d.execution.results[32].qualified=true;},(d:any)=>{d.execution.results.reverse();},(d:any)=>{d.execution.observations[0].rawText+=" forged";}]){const bad=structuredClone(data);mutate(bad);assert.throws(()=>validateData(bad));rejects++;}
 const badFiles=structuredClone(files);badFiles[0].sha256="a".repeat(64);assert.throws(()=>validateFiles(badFiles));rejects++;
 return {status:"PASS_OFFLINE_REAL_MATRIX_PRIORITY_PURE_SSR",...await ssr(data,files,out),rejectedOracleForgeries:rejects,httpRequests:0};
}
async function verify(filename:string,out:string,step:(s:string)=>void){
 const state=readState(filename),address=new URL(process.env.FEEDBACK_WEB_URL||"http://127.0.0.1:28082");
 assert.ok(address.protocol==="http:"&&["127.0.0.1","localhost"].includes(address.hostname)&&address.pathname==="/"&&!address.search&&!address.hash&&!address.username&&!address.password);
 const requests:any[]=[];
 async function get(endpoint:string,expected=200){
  assert.match(endpoint,/^\/api\/[A-Za-z0-9_/.?-]+$/u);
  const response=await fetch(address.origin+endpoint,{method:"GET",redirect:"error",signal:AbortSignal.timeout(60000),headers:{Cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join("; ")}});
  const reader=response.body?.getReader();assert.ok(reader);const chunks:Buffer[]=[];let bytes=0,done=false;
  try{for(;;){const part=await reader.read();if(part.done){done=true;break;}bytes+=part.value.length;assert.ok(bytes<=2*1024*1024,"Bounded response2MiB");chunks.push(Buffer.from(part.value));}}
  finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
  const body=Buffer.concat(chunks),entry={endpoint,status:response.status,bytes:body.length,sha256:sha(body)};requests.push(entry);fs.appendFileSync(path.join(out,"get-journal.jsonl"),JSON.stringify(entry)+"\n");
  assert.equal(response.status,expected,`GET ${endpoint}: HTTP${response.status}`);return body;
 }
 const prefix=`/api/checks/${state.checkId}`;step("same-object-terminal-check");const check=JSON.parse((await get(prefix)).toString("utf8"));
 assert.equal(check.objectId,state.objectId);assert.equal(check.progress,100);assert.equal(check.mode,"NORMAL");assert.ok(["PARTIAL","COMPLETED"].includes(check.status));
 const before=new Map<string,{endpoint:string;bytes:Buffer;status:number}>();
 for(const [key,suffix]of [["matrix","matrix-execution"],["submission","submission"],["targets","matrix-fact-targets"]]){
  step(`pinned-${key}`);const endpoint=`${prefix}/${suffix}`,bytes=await get(endpoint);assert.equal(sha(bytes),oracle.rawPins[key][1]);before.set(key,{endpoint,bytes,status:200});fs.writeFileSync(path.join(out,`${key}-before.json`),bytes,{flag:"wx"});
 }
 step("actual-current-object-files");const filesEndpoint=`/api/objects/${state.objectId}/files`,filesBytes=await get(filesEndpoint);assert.equal(sha(filesBytes),oracle.filesRawSha256);const files=JSON.parse(filesBytes.toString("utf8")).items;validateFiles(files);before.set("files",{endpoint:filesEndpoint,bytes:filesBytes,status:200});fs.writeFileSync(path.join(out,"files-before.json"),filesBytes,{flag:"wx"});
 for(const spec of oracle.sources){step("unknown-source-review-"+spec.originalSourceFileId);const endpoint=`/api/objects/${state.objectId}/files/${spec.id}/source-review`,bytes=await get(endpoint,404);assert.equal(JSON.parse(bytes.toString("utf8")).error,"NOT_FOUND");before.set(`review-${spec.originalSourceFileId}`,{endpoint,bytes,status:404});}
 step("production-pure-SSR-on-actual-immutable-DTO");const data=JSON.parse(before.get("matrix")!.bytes.toString("utf8"));const rendered=await ssr(data,files,out);
 step("all-GET-raw-byte-readback");for(const[key,entry]of before){assert.ok((await get(entry.endpoint,entry.status)).equals(entry.bytes),`Readback ${key} raw bytes unchanged`);}
 return {status:"PASS_GET_ONLY_REAL_MATRIX_REVIEW_PRIORITY_PURE_SSR_BROWSER_PENDING",checkId:state.checkId,objectId:state.objectId,...rendered,requests,httpRequests:requests.length,httpMethods:["GET"],rawReadback:Object.fromEntries([...before].map(([key,v])=>[key,{status:v.status,bytes:v.bytes.length,sha256:sha(v.bytes),unchanged:true}]))};
}
async function main(){
 const[mode,filename]=process.argv.slice(2);assert.ok(mode==="--self-test"&&!filename||mode==="verify"&&!!filename,"Use --self-test | verify PRIVATE_STATE_0600");
 const out=path.resolve(process.env.FEEDBACK_QA_OUTPUT||path.join(root,"output/matrix-t50-20261018",mode==="--self-test"?"http-self-test-attempt1":"http-attempt1"));fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,"attempt-start.json"),JSON.stringify({at:new Date().toISOString(),mode,harnessSha256:sha(fs.readFileSync(script)),planSha256:planPin[1],oracleSha256:oraclePin[1]})+"\n",{flag:"wx"});
 let stage="frozen-inputs";
 try{const result=mode==="--self-test"?await offline(out):await verify(filename!,out,s=>{stage=s;});
  const final={...result,harnessSha256:sha(fs.readFileSync(script)),oracleSha256:oraclePin[1],planSha256:planPin[1],productionModules:{helper:sha(fs.readFileSync(path.join(root,"apps/web/src/matrix-review-worklist.ts"))),component:sha(fs.readFileSync(path.join(root,"apps/web/src/MatrixReviewWorklist.tsx")))},sourceReviewsCreated:0,qualifiedComparisonsCreated:0,confidencePromotions:0,domainWrites:0,browserCalls:0,limits:oracle.limits,at:new Date().toISOString()};
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify(final,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,ssrRenders:result.renders.length,counts:result.counts,httpRequests:result.httpRequests,domainWrites:0,browserCalls:0}));
 }catch(error){const e=error as Error,red={status:"RED_PRESERVED",stage,errorName:e.name,reason:e.message.split("\n")[0].slice(0,700),harnessSha256:sha(fs.readFileSync(script)),oracleSha256:oraclePin[1],domainWrites:0,browserCalls:0,at:new Date().toISOString()};fs.writeFileSync(path.join(out,"red-result.json"),JSON.stringify(red,null,2)+"\n",{flag:"wx"});console.error(JSON.stringify(red));process.exitCode=1;}
}
main().catch((error:Error)=>{console.error(error.message.split("\n")[0]);process.exitCode=1;});
