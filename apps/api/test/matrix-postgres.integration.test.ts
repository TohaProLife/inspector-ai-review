import { extractSourceDeclarationsV2 as extractSourceDeclarations } from "../src/matrix-source-declarations-v2.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor, PostgresIdentityService } from "../src/identity.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixConfigHash, MATRIX_PROFILE, matrixRegistry } from "../src/matrix-execution.js";
import { pythonExecutable, pythonEnv } from "./python.js";
import { validateVisualProposalStageResult, v8FullVisualProposalConfigHash, v8SampleVisualProposalConfigHash } from "../src/visual-proposal.js";

import { visualCropFixtureScript } from "./visual-crop-fixture.js";

const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl?describe:describe.skip)("generic matrix durable PostgreSQL",{timeout:30000},()=>{
  const databaseName=`matrix_it_${randomUUID().replaceAll("-","")}`;
  let admin:Pool,database:Pool,repository:PostgresInspectionRepository;
  let actor:AuthenticatedActor;
  const previousOcr=process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
  beforeAll(async()=>{
    process.env.INSPECTOR_MATRIX_OCR_LAYOUT="1";
    admin=new Pool({connectionString:adminUrl,max:1});
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url=new URL(adminUrl!);url.pathname=`/${databaseName}`;
    await runDatabaseMigrations(url.toString());database=new Pool({connectionString:url.toString()});
    const reference=await loadReferenceData();
    repository=await PostgresInspectionRepository.create({connectionString:url.toString(),
      parameters:reference.parameters,analysisProfile:"MATRIX_V1",organizationSlug:"matrix-it"});
  });
  afterAll(async()=>{
    if(previousOcr===undefined)delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;else process.env.INSPECTOR_MATRIX_OCR_LAYOUT=previousOcr;
    await repository?.close();await database?.end();
    if(admin){await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1`,[databaseName]);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);await admin.end();}
  });
  it.each([false,true])("seals verified source context=%s with immutable machine output",async(reviewed)=>{
    const object=await repository.createObject({name:"Matrix synthetic",address:"Москва"});
    const user=await provisionLocalUser(database,{organizationSlug:"matrix-it",login:`matrix-${randomUUID()}`,
      displayName:"Matrix reviewer",password:"Matrix-Test-2026!",objectApiIds:[object.id],objectPermissions:["READ","REVIEW_DECIDE"]});
    actor={sessionId:randomUUID(),userId:user.id,organizationId:user.organizationId,displayName:"Matrix reviewer",
      roles:["INSPECTOR"],capabilities:[],csrfHash:"x",expiresAt:"2030-01-01T00:00:00Z"};
    const files=["PD","RD"].map((stage,index)=>({id:`FIL-${randomUUID()}`,name:`${stage}.pdf`,size:43,
      stage:stage as "PD"|"RD",mimeType:"application/pdf",sha256:String(index+1).repeat(64),
      scanStatus:"CLEAN" as const,status:"STORED" as const,storageKey:`objects/${object.id}/${stage}.pdf`}));
    await repository.registerIngestedFiles(object.id,files);
    if(reviewed)for(const [index,file] of files.entries()) {
      const rule=matrixRegistry.entries.find(e=>e.parameterCode==="PZ-002")!.atomicRules[0];
      const review=await repository.recordSourceReviewCommand(object.id,file.id,{
        sourceSha256:file.sha256,revisionStatus:"CURRENT",approvalStatus:"APPROVED",linkGroupId:"fixture-building",
        sectionCode:index?"AR":"PZ",pageStages:{},basis:{reference:"Synthetic source fixture; original bytes controlled"},
        matrixScope:{entityKey:"fixture-building",reference:"Synthetic same building identity verified",
          contexts:Object.fromEntries([...rule.requiredContext,`RULE_SCOPE_COMPLETE:${rule.ruleId}`,"PARAMETER_SCOPE_COMPLETE:PZ-002"]
            .map(key=>[key,{reference:"Synthetic complete building area context verified"}]))},
      },{actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
      expect(review.kind).toBe("success");
      const read=await repository.getSourceReview(object.id,file.id,actor);
      expect(read&&typeof read!=="string"&&read.matrixScope&&"entityKey" in read.matrixScope&&read.matrixScope.entityKey).toBe("fixture-building");
    }
    const check=await repository.startCheck(object.id);expect(check).toBeDefined();
    expect(await repository.getMatrixExecution(check!.id,actor)).toBeUndefined();
    let artifacts:any[]=[];let ruleJob:string|undefined;let acceptedResult:any;
    for(let step=0;step<12;step++){
      const jobs=await database.query<{id:string;job_type:string}>(`SELECT job.id,job.job_type FROM analysis_jobs job
        JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`,[check!.id]);
      if(!jobs.rows.length)break;
      const job=jobs.rows[0];const claim=await repository.claimJob(job.id,{workerId:"matrix-it",capabilities:[job.job_type]});
      expect(claim.kind,job.job_type).toBe("acquired");if(claim.kind!=="acquired")throw Error("claim failed");
      const lease=claim.lease;let result:Record<string,unknown>;
      if(job.job_type==="ANALYSIS_INVENTORY")result={disposition:"MANIFEST_INVENTORIED",sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
      else if(job.job_type==="DOCUMENT_TEXT_LAYER"){
        const script=`import json,sys
from inspector_worker.text_layer import qualify_page_text,TEXT_QUALITY_POLICY_VERSION
x=json.load(sys.stdin); out=[]
for i,s in enumerate(x):
 text='Общая площадь здания: '+str(100 if s['stages']==['PD'] else 103)+' м²'; q=qualify_page_text([text])
 out.append({'schemaVersion':'document-text-v2','sourceFileId':s['sourceFileId'],'inputSha256':s['sha256'],'coordinateSystem':'PDF_BOTTOM_LEFT_MILLI_POINTS','pageCount':1,'textPageCount':1,'qualityPolicyVersion':TEXT_QUALITY_POLICY_VERSION,'qualitySummary':{'textLayerCandidatePageCount':int(q['disposition']=='TEXT_LAYER_CANDIDATE'),'ocrRequiredPageCount':int(q['disposition']=='OCR_REQUIRED')},'pages':[{'pageNumber':1,'widthMilliPoints':600000,'heightMilliPoints':800000,'blocks':[{'bboxMilliPoints':[1000,20000,550000,30000],'text':text}],'quality':q}]})
json.dump(out,sys.stdout,ensure_ascii=False)`;
        const proc=spawnSync(pythonExecutable,["-c",script],{input:JSON.stringify(lease.inputs.sourceFiles),
          encoding:"utf8",env:{...process.env,...pythonEnv}});expect(proc.status,proc.stderr).toBe(0);artifacts=JSON.parse(proc.stdout);
        result={disposition:"DOCUMENT_TEXT_LAYER_COMPLETED",sources:artifacts.map(a=>({sourceFileId:a.sourceFileId,
          inputSha256:a.inputSha256,status:"EXTRACTED",artifact:a}))};
      }else if(job.job_type==="RULE_EVALUATION"){
        const proc=spawnSync(pythonExecutable,["-c",`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.project_constraints import extract_project_constraints
x=json.load(sys.stdin);sources=[{**s,**x['lease']['inputs']['sourceDecisions'].get(s['sourceFileId'],{})} for s in x['lease']['inputs']['sourceFiles']]
json.dump({'execution':build_matrix_execution(object_id=x['lease']['objectId'],input_manifest_hash=x['lease']['inputManifestHash'],sources=sources,text_artifacts=x['artifacts']),
'projectConstraints':extract_project_constraints(x['lease']['objectId'],x['lease']['inputManifestHash'],sources,x['artifacts'])},sys.stdout,ensure_ascii=False)`],
          {input:JSON.stringify({lease,artifacts}),encoding:"utf8",env:{...process.env,...pythonEnv}});
        expect(proc.status,proc.stderr).toBe(0);const {execution,projectConstraints}=JSON.parse(proc.stdout);
        const sourceDeclarations = extractSourceDeclarations({objectId:lease.objectId,inputManifestHash:lease.inputManifestHash,
          sources:lease.inputs.sourceFiles.map(source=>({...source,pageStages:lease.inputs.sourceDecisions[source.sourceFileId]?.pageStages??{}})),
          textArtifacts:artifacts});
        result={schemaVersion:"analysis-stage-result-v2",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,
          disposition:"RULES_EVALUATED",providerKind:"RULE_ENGINE",providerProfileId:MATRIX_PROFILE,
          providerConfigHash:matrixConfigHash,outputCount:execution.results.length,execution,projectConstraints,sourceDeclarations};
        const forged=structuredClone(result) as any;forged.execution.observations[0].sourceSha256="f".repeat(64);
        expect((await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:forged})).kind).toBe("invalid_state");
        for(const forgedConstraints of [undefined,{...projectConstraints,probability:0.99},
          {...projectConstraints,constraints:[{relation:"GE",limitValue:"0.9",sourceFileId:artifacts[0].sourceFileId}]}]){
          const changed={...result,projectConstraints:forgedConstraints};
          expect((await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:changed})).kind).toBe("invalid_state");
        }
        ruleJob=job.id;acceptedResult={attemptId:lease.attemptId,fencingToken:lease.fencingToken,result};
      }else if(job.job_type==="ANALYSIS_SEAL_UNSUPPORTED")result={disposition:"UNSUPPORTED_COVERAGE_SEALED",workerId:"matrix-it"};
      else {const map:Record<string,string[]>={DOCUMENT_RENDER:["PROVIDER_NOT_CONFIGURED","RENDERER_PROFILE_NOT_SELECTED","RENDERER"],
        DOCUMENT_METADATA:["PROVIDER_NOT_CONFIGURED","METADATA_PROFILE_NOT_SELECTED","METADATA_EXTRACTOR"],
        DOCUMENT_LINKING:["POLICY_NOT_CONFIGURED","LINKING_POLICY_NOT_SELECTED","LINKING_POLICY"],
        ENTITY_EXTRACTION:["PROVIDER_NOT_CONFIGURED","ENTITY_EXTRACTION_PROFILE_NOT_SELECTED","ENTITY_EXTRACTION_MODEL"],
        EVIDENCE_VALIDATION:["NO_MACHINE_RESULTS","RULE_RESULTS_UNAVAILABLE","EVIDENCE_VALIDATOR"]};
        const [disposition,reasonCode,providerKind]=map[job.job_type];result={schemaVersion:"analysis-stage-result-v1",jobType:job.job_type,
          inputManifestHash:lease.inputManifestHash,disposition,reasonCode,providerKind,providerProfileId:null,providerConfigHash:null,outputCount:0};}
      const completed=await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result});
      expect(completed.kind,JSON.stringify(completed)).toBe("completed");
    }
    const read=await repository.getMatrixExecution(check!.id,actor);
    expect(read&&typeof read!=="string"&&read.execution.observations.length).toBe(2);
    if(read&&typeof read!=="string") {
      expect(read.projectConstraints).toMatchObject({schemaVersion:"matrix-project-constraints-v1",purpose:"EVIDENCE_ONLY",constraints:[]});
      expect(read.execution).not.toHaveProperty("projectConstraints");
      const compared=read.execution.results.find(r=>r.parameterCode==="PZ-002")!;
      expect(compared.qualified).toBe(reviewed);
      if(reviewed)expect(compared).toMatchObject({machineStatus:"CANDIDATE",delta:"3"});
      expect(read.presentation.every(p=>p.confidence.calibratedProbability===null)).toBe(true);
    }
    const coverage=await repository.getCoverage(check!.id,actor);
    expect(Array.isArray(coverage)&&coverage.filter(c=>c.atomic?.implementedAtomicRules).length).toBe(matrixRegistry.entries.filter(entry=>entry.atomicRules.some(rule=>rule.enabled)).length);
    expect((await repository.getCheck(check!.id,actor))).toMatchObject({status:"PARTIAL",stats:{unsupported:matrixRegistry.entries.filter(entry=>!entry.atomicRules.some(rule=>rule.enabled)).length}});
    const exported=await repository.getSubmission(check!.id,actor);
    expect(exported&&typeof exported!=="string"&&exported.checks.every(c=>c.violation_label==="COMPARISON_IMPOSSIBLE")).toBe(true);
    const bytes=await database.query("SELECT submission_bytes,submission_hash FROM machine_prediction_snapshots");
    expect(sha256(bytes.rows[0].submission_bytes)).toBe(bytes.rows[0].submission_hash.trim());
    await expect(database.query("UPDATE machine_prediction_snapshots SET metadata='{}'")).rejects.toThrow();
    expect((await repository.completeJob(ruleJob!,acceptedResult)).kind).toBe("completed");
    expect((await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots")).rows[0].n).toBe(reviewed?2:1);
    expect(await repository.getMatrixExecution(check!.id,{...actor,userId:randomUUID()})).toBeUndefined();
    expect(await repository.getSubmission(check!.id,{...actor,userId:randomUUID()})).toBeUndefined();
  });
  it("pins v8 crop policy for explicit SAMPLE/FULL and rejects active mode changes", async () => {
    const previousVisual = process.env.INSPECTOR_MATRIX_VISUAL_PROPOSALS;
    process.env.INSPECTOR_MATRIX_VISUAL_PROPOSALS = "1";
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`;
    const reference = await loadReferenceData();
    const v8 = await PostgresInspectionRepository.create({ connectionString: url.toString(),
      parameters: reference.parameters, analysisProfile: "MATRIX_V1", visualProfile: "V8_SAMPLE", organizationSlug: "matrix-it" });
    const generated = spawnSync(pythonExecutable, ["-c", visualCropFixtureScript], {
      env: { ...process.env, ...pythonEnv }, encoding: "utf8", timeout: 30_000,
    });
    expect(generated.status, generated.stderr).toBe(0);
    const visualFixtures = JSON.parse(generated.stdout) as Array<{ result: any; source: { sha256: string } }>;
    try {
      for (const mode of ["SAMPLE", "FULL"] as const) {
        const object = await v8.createObject({ name: `Controlled v8 ${mode}`, address: "Synthetic crop policy test" });
        const user = await provisionLocalUser(database, { organizationSlug: "matrix-it", login: `crop-${randomUUID()}`,
          displayName: "Crop reviewer", password: "Crop-Test-2026!", objectApiIds: [object.id], objectPermissions: ["READ", "RUN"] });
        const reviewer: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId,
          displayName: "Crop reviewer", roles: ["INSPECTOR"], capabilities: [], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" };
        await v8.registerIngestedFiles(object.id, [{ id: `FIL-${randomUUID()}`, name: "controlled.pdf", size: 43,
          stage: "PD", mimeType: "application/pdf", sha256: visualFixtures[2].source.sha256, scanStatus: "CLEAN", status: "STORED",
          storageKey: `objects/${object.id}/controlled.pdf` }]);
        const command = { actor: reviewer, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() };
        const started = await v8.startCheckCommand(object.id, command, { analysisMode: mode });
        expect(started.kind, JSON.stringify(started)).toBe("success");
        if (started.kind !== "success") throw new Error("V8 check did not start");
        const manifest = await database.query<{ content_json: Record<string, any> }>(`SELECT release.content_json
          FROM analysis_runs run JOIN analysis_releases release ON release.release_id=run.release_id WHERE run.api_id=$1`, [started.value.id]);
        const slot = manifest.rows[0].content_json.providerSlots.find((slot: Record<string, unknown>) => slot.stageJobType === "ENTITY_EXTRACTION");
        expect(slot).toMatchObject({ profileId: `red-vector-proposals-v8-${mode.toLowerCase()}`, adapterVersion: "8",
          configHash: mode === "FULL" ? v8FullVisualProposalConfigHash : v8SampleVisualProposalConfigHash });
        const replay = await v8.startCheckCommand(object.id, command, { analysisMode: mode });
        expect(replay).toMatchObject({ kind: "success", replayed: true, value: { id: started.value.id } });
        const conflict = await v8.startCheckCommand(object.id, { ...command, idempotencyKey: randomUUID() },
          { analysisMode: mode === "FULL" ? "SAMPLE" : "FULL" });
        expect(conflict).toMatchObject({ kind: "invalid_state", code: "ACTIVE_ANALYSIS_MODE_CONFLICT" });
        let persisted = false;
        for (let step = 0; step < 12; step++) {
          const ready = await database.query<{ id: string; job_type: string }>(`SELECT job.id, job.job_type
            FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
            WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`, [started.value.id]);
          expect(ready.rows.length).toBe(1);
          const job = ready.rows[0];
          const claim = await v8.claimJob(job.id, { workerId: "crop-durable-it", capabilities: [job.job_type] });
          expect(claim.kind).toBe("acquired");
          if (claim.kind !== "acquired") throw new Error("Crop lease unavailable");
          const lease = claim.lease;
          let result: Record<string, any>;
          if (job.job_type === "ENTITY_EXTRACTION") {
            result = structuredClone(visualFixtures[mode === "FULL" ? 3 : 2].result);
            result.inputManifestHash = lease.inputManifestHash;
            result.analysis.inputManifestHash = lease.inputManifestHash;
            result.analysis.objectId = lease.objectId;
            result.analysis.sources[0].sourceFileId = lease.inputs.sourceFiles[0].sourceFileId;
            expect(validateVisualProposalStageResult(result, lease.inputManifestHash, lease.objectId,
              [{ apiId: lease.inputs.sourceFiles[0].sourceFileId, sha256: visualFixtures[2].source.sha256, pageCount: 1 }],
              result.providerProfileId)).toBeDefined();
            expect((await database.query(`SELECT page_count FROM analysis_text_artifacts text
              JOIN analysis_runs run ON run.id=text.run_id WHERE run.api_id=$1`, [started.value.id])).rows).toEqual([{page_count:1}]);
            const forged = structuredClone(result);
            forged.analysis.profile.vlmCropMethodId = "normalized-derotated-square-v1";
            expect(await v8.completeJob(job.id, { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result: forged }))
              .toMatchObject({ kind: "invalid_state", code: "INVALID_JOB_RESULT" });
          } else if (job.job_type === "ANALYSIS_INVENTORY") {
            result = { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 } };
          } else if (job.job_type === "DOCUMENT_TEXT_LAYER") {
            const text = spawnSync(pythonExecutable, ["-c", `import json,sys
from inspector_worker.text_layer import qualify_page_text,TEXT_QUALITY_POLICY_VERSION
s=json.load(sys.stdin)[0]; t='Общая площадь здания: 100 м²'; q=qualify_page_text([t])
a={'schemaVersion':'document-text-v2','sourceFileId':s['sourceFileId'],'inputSha256':s['sha256'],'coordinateSystem':'PDF_BOTTOM_LEFT_MILLI_POINTS','pageCount':1,'textPageCount':1,'qualityPolicyVersion':TEXT_QUALITY_POLICY_VERSION,'qualitySummary':{'textLayerCandidatePageCount':int(q['disposition']=='TEXT_LAYER_CANDIDATE'),'ocrRequiredPageCount':int(q['disposition']=='OCR_REQUIRED')},'pages':[{'pageNumber':1,'widthMilliPoints':400000,'heightMilliPoints':600000,'blocks':[{'bboxMilliPoints':[1000,20000,350000,30000],'text':t}],'quality':q}]}
json.dump({'disposition':'DOCUMENT_TEXT_LAYER_COMPLETED','sources':[{'sourceFileId':s['sourceFileId'],'inputSha256':s['sha256'],'status':'EXTRACTED','artifact':a}]},sys.stdout,ensure_ascii=False)`],
              { input: JSON.stringify(lease.inputs.sourceFiles), encoding: "utf8", env: { ...process.env, ...pythonEnv } });
            expect(text.status, text.stderr).toBe(0); result = JSON.parse(text.stdout);
          } else {
            const contracts: Record<string, string[]> = {
              DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
              DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
              DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
            };
            expect(contracts[job.job_type], job.job_type).toBeDefined();
            const [disposition, reasonCode, providerKind] = contracts[job.job_type];
            result = { schemaVersion: "analysis-stage-result-v1", jobType: job.job_type,
              inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
              providerProfileId: null, providerConfigHash: null, outputCount: 0 };
          }
          const completion = { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result };
          const completed = await v8.completeJob(job.id, completion);
          expect(completed.kind, JSON.stringify(completed)).toBe("completed");
          if (job.job_type === "ENTITY_EXTRACTION") {
            expect((await v8.completeJob(job.id, completion)).kind).toBe("completed");
            const stored = await database.query(`SELECT schema_version, provider_profile_id, content_json
              FROM analysis_stage_artifacts WHERE job_id=$1`, [job.id]);
            expect(stored.rows).toHaveLength(1);
            expect(stored.rows[0]).toMatchObject({ schema_version: "analysis-stage-result-v2",
              provider_profile_id: `red-vector-proposals-v8-${mode.toLowerCase()}` });
            expect(stored.rows[0].content_json.analysis.schemaVersion).toBe("visual-proposal-analysis-v8");
            persisted = true; break;
          }
        }
        expect(persisted).toBe(true);
      }
    } finally {
      await v8.close();
      if (previousVisual === undefined) delete process.env.INSPECTOR_MATRIX_VISUAL_PROPOSALS;
      else process.env.INSPECTOR_MATRIX_VISUAL_PROPOSALS = previousVisual;
    }
  });
});
