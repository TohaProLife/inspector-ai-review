/** Compare immutable machine artifacts and saved local reviews across a stand restart.
 * Usage: node scripts/smoke-matrix-persistence.cjs capture|verify checkpoint.json state.json [...]
 * State files contain local auth cookies, must be private and are never copied into checkpoints.
 */
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [mode,checkpoint,...states]=process.argv.slice(2);
if(!['capture','verify'].includes(mode)||!checkpoint||states.length<1||states.length>8)throw Error('capture|verify checkpoint.json state.json [...] required');
const base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('loopback stand required');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const expected=mode==='verify'?JSON.parse(fs.readFileSync(checkpoint,'utf8')):null;
const includeSourceReviews=mode==='capture'||expected?.schemaVersion==='matrix-persistence-check-v2';
(async()=>{const snapshots=[];
 for(const file of states){if(fs.statSync(file).mode&0o077)throw Error('auth state must have mode 0600');
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  const headers={cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};
  const read=async endpoint=>{const response=await fetch(`${base}/api/${endpoint}`,{headers,signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,`GET ${endpoint}: ${response.status}`);return response;};
  const run=await(await read(`checks/${state.checkId}`)).json();assert.equal(run.progress,100);assert.ok(['PARTIAL','COMPLETED'].includes(run.status));
  const matrix=await(await read(`checks/${state.checkId}/matrix-execution`)).json();
  const submission=await read(`checks/${state.checkId}/submission`),bytes=Buffer.from(await submission.arrayBuffer());
  assert.equal(sha(bytes),matrix.submission.contentHash);assert.equal(submission.headers.get('x-content-sha256'),matrix.submission.contentHash);
  const reviews=await(await read(`objects/${state.objectId}/local-registrations`)).json();
  const history=await(await read(`objects/${state.objectId}/checks`)).json();
  let sourceReviews;
  if(includeSourceReviews){
    const files=await(await read(`objects/${state.objectId}/files`)).json();sourceReviews=[];
    for(const source of files.items){
      const response=await fetch(`${base}/api/objects/${state.objectId}/files/${source.id}/source-review`,{headers,signal:AbortSignal.timeout(20000)});
      assert.ok([200,404].includes(response.status),`source-review HTTP ${response.status}`);
      const review=response.status===200?await response.json():null;
      sourceReviews.push({sourceFileId:source.id,sourceSha256:source.sha256,reviewHash:review?.contentHash??null,
        bindings:review?.matrixScope?.schemaVersion==='matrix-fact-scopes-v1'?review.matrixScope.bindings.length:null});
    }
    sourceReviews.sort((a,b)=>a.sourceFileId.localeCompare(b.sourceFileId));
  }
  snapshots.push({...(includeSourceReviews?{sourceReviews}:{}),objectId:state.objectId,checkId:state.checkId,status:run.status,machineHash:matrix.contentHash,
   submissionHash:sha(bytes),submissionBytes:bytes.length,reviewId:reviews.latest?.reviewId??null,
   reviewHash:reviews.latest?.contentHash??null,registrationHash:reviews.latest?.registrationSha256??null,
   reviewHistory:reviews.history.map(({reviewId,contentHash})=>({reviewId,contentHash})),
   runHistory:history.items.map(({id,status})=>({id,status})).sort((a,b)=>a.id.localeCompare(b.id))});
 }
 if(mode==='capture')fs.writeFileSync(checkpoint,JSON.stringify({schemaVersion:'matrix-persistence-check-v2',snapshots},null,2));
 else assert.deepEqual(snapshots,expected.snapshots);
 console.log(JSON.stringify({status:'PASS',mode,checks:snapshots.length,savedLocalReviews:snapshots.filter(value=>value.reviewId).length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
