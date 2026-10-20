import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, matrixConstraintsDefinitions, matrixRegistry } from "../src/matrix-execution.js";
import { pythonExecutable, pythonEnv } from "./python.js";



const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl?describe:describe.skip)("current-compatible legacy matrix PostgreSQL",{timeout:30000},()=>{
  const databaseName=`matrix_legacy_it_${randomUUID().replaceAll("-","")}`;
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
  const variants = ["compatible", "v2-compatible", "adapter-drift", "config-drift", "engine-drift", "scope-drift", "registry-drift", "definitions-drift", "v2-adapter-drift"] as const;
  it.each(variants)("handles old running v1 after API replacement: %s",async(variant)=>{
    const reviewed = true;
    const { projectConstraints: _boundPolicy, ...legacyDefinitions } = structuredClone(matrixConstraintsDefinitions);
    if (variant === "engine-drift") legacyDefinitions.engineSourceSha256 = "e".repeat(64);
    if (variant === "scope-drift") legacyDefinitions.factScopeSourceSha256 = "d".repeat(64);
    if (variant === "registry-drift") legacyDefinitions.registry.version += "-historical";
    const v2 = variant.startsWith("v2-");
    const pinnedDefinitions = v2 ? matrixConstraintsDefinitions : legacyDefinitions;
    const pinnedProfile = v2 ? MATRIX_CONSTRAINTS_PROFILE : MATRIX_LEGACY_PROFILE;
    const legacyHash = sha256(canonicalJson(pinnedDefinitions));
    // The old API inserted this manifest before start. Never mutate an immutable release.
    const owner = repository as any;
    const original = owner.ensureAnalysisRelease.bind(repository);
    const spy = vi.spyOn(owner, "ensureAnalysisRelease").mockImplementation(async (...args: any[]) => {
      const release = await original(...args);
      const { releaseId: _oldId, ...previous } = release.manifest;
      const identity = { ...previous, rules: { ...previous.rules, matrixDefinitions: pinnedDefinitions },
        providerSlots: previous.providerSlots.map((slot: any) => slot.stageJobType === "RULE_EVALUATION"
          ? { ...slot, profileId: pinnedProfile, adapterVersion: variant === "adapter-drift" || variant === "v2-compatible" ? "2" : "1",
              configHash: variant === "config-drift" ? "f".repeat(64) : legacyHash } : slot) };
      // Definitions can drift independently from a still-current advertised hash.
      if (variant === "definitions-drift") identity.rules.matrixDefinitions = { ...legacyDefinitions, engineSourceSha256: "c".repeat(64) };
      const manifest = { ...identity, releaseId: `release:matrix-v1:${sha256(canonicalJson(identity)).slice(0,24)}` };
      const canonical = canonicalJson(manifest);
      await args[0].query(`INSERT INTO analysis_releases
        (release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed)
        VALUES ($1,'analysis-release-v1','DRAFT',$2,$3,$4::jsonb,false) ON CONFLICT DO NOTHING`,
        [manifest.releaseId, sha256(canonical), Buffer.byteLength(canonical), canonical]);
      return { manifest, canonical, contentHash: sha256(canonical), byteSize: Buffer.byteLength(canonical) };
    });
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
    let check;
    try { check = await repository.startCheck(object.id); } finally { spy.mockRestore(); }
    expect(check).toBeDefined();
    // New process/repository sees only the already-pinned RUNNING legacy release.
    await repository.close();
    const reopened = new URL(adminUrl!); reopened.pathname = `/${databaseName}`;
    const reference = await loadReferenceData();
    repository = await PostgresInspectionRepository.create({ connectionString: reopened.toString(),
      parameters: reference.parameters, analysisProfile: "MATRIX_V1", organizationSlug: "matrix-it" });
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
        result={schemaVersion:"analysis-stage-result-v2",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,
          disposition:"RULES_EVALUATED",providerKind:"RULE_ENGINE",providerProfileId:pinnedProfile,
          providerConfigHash:legacyHash,outputCount:execution.results.length,execution,...(v2 ? {projectConstraints} : {})};
        const forged=structuredClone(result) as any;forged.execution.observations[0].sourceSha256="f".repeat(64);
        expect((await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:forged})).kind).toBe("invalid_state");
        for (const key of ["projectConstraints", "constraints", "sourceDeclarations"]) {
          const changed = { ...result, [key]: key === "projectConstraints" ? (v2 ? undefined : projectConstraints) : [] };
          expect((await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:changed})).kind).toBe("invalid_state");
        }
        if (variant !== "compatible" && variant !== "v2-compatible") {
          const rejected = await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result});
          expect(rejected).toMatchObject({kind:"invalid_state",code:"INVALID_JOB_RESULT"});
          const counts = await database.query(`SELECT count(*)::int n FROM analysis_stage_artifacts WHERE job_id=$1`,[job.id]);
          expect(counts.rows[0].n).toBe(0);
          expect(await repository.getMatrixExecution(check!.id,actor)).toBeUndefined();
          // A genuine old persisted artifact may be readable, yet must not be resealed
          // by a different engine. Insert immutable historical rows; never UPDATE them.
          const runs = await database.query(`SELECT id,api_id,inspection_id,object_id FROM analysis_runs WHERE api_id=$1`,[check!.id]);
          const run = runs.rows[0];
          const canonical = canonicalJson(result);
          await database.query(`INSERT INTO analysis_stage_artifacts
            (id,job_id,run_id,job_type,schema_version,disposition,reason_code,provider_kind,
             provider_profile_id,provider_config_hash,output_count,input_manifest_hash,content_hash,byte_size,content_json)
            VALUES ($1,$2,$3,'RULE_EVALUATION','analysis-stage-result-v2','RULES_EVALUATED',
              'MATRIX_ATOMIC_EXECUTION','RULE_ENGINE',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [randomUUID(),job.id,run.id,pinnedProfile,legacyHash,execution.results.length,
              lease.inputManifestHash,sha256(canonical),Buffer.byteLength(canonical),canonical]);
          await database.query("UPDATE analysis_jobs SET state='SUCCEEDED',completed_at=now() WHERE id=$1",[job.id]);
          const client = await database.connect();
          try {
            await client.query("BEGIN");
            await expect((repository as any).sealMatrixRun(client,run)).rejects.toThrow(/matrix (stage integrity failure|seal verification failed)/u);
          } finally { await client.query("ROLLBACK"); client.release(); }
          const snapshotCount = await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots WHERE run_id=$1",[run.id]);
          expect(snapshotCount.rows[0].n).toBe(0);
          if (!v2) {
            await database.query("UPDATE analysis_runs SET run_state='PARTIAL',display_status='PARTIAL',completed_at=now(),sealed_at=now() WHERE id=$1",[run.id]);
            const historical = await repository.getMatrixExecution(check!.id,actor);
            expect(historical && typeof historical !== "string" && historical.contentHash).toBe(sha256(canonical));
            expect(historical && typeof historical !== "string" && historical.execution).toEqual(execution);
            expect(historical).not.toHaveProperty("projectConstraints");
            const oldTargets = await repository.getMatrixFactTargets(check!.id,actor);
            expect(oldTargets && typeof oldTargets !== "string" && oldTargets.items.length).toBe(2);
            expect(oldTargets && typeof oldTargets !== "string" && oldTargets.executionContentHash).toBe(sha256(canonical));
          }
          return;
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
      if(v2)expect(read.projectConstraints).toMatchObject({purpose:"EVIDENCE_ONLY",constraints:[]});
      else expect(read).not.toHaveProperty("projectConstraints");
      expect(read).not.toHaveProperty("sourceDeclarations");
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
    const bytes=await database.query(`SELECT snapshot.submission_bytes,snapshot.submission_hash,stage.provider_profile_id,stage.provider_config_hash
      FROM machine_prediction_snapshots snapshot JOIN analysis_runs run ON run.id=snapshot.run_id
      JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION' WHERE run.api_id=$1`,[check!.id]);
    expect(bytes.rows[0].provider_profile_id).toBe(pinnedProfile);
    expect(bytes.rows[0].provider_config_hash.trim()).toBe(legacyHash);
    const targets = await repository.getMatrixFactTargets(check!.id,actor);
    expect(targets && typeof targets !== "string" && targets.items.length).toBe(2);
    expect(sha256(bytes.rows[0].submission_bytes)).toBe(bytes.rows[0].submission_hash.trim());
    await expect(database.query("UPDATE machine_prediction_snapshots SET metadata='{}'")).rejects.toThrow();
    expect((await repository.completeJob(ruleJob!,acceptedResult)).kind).toBe("completed");
    expect((await database.query(`SELECT count(*)::int n FROM machine_prediction_snapshots snapshot
      JOIN analysis_runs run ON run.id=snapshot.run_id WHERE run.api_id=$1`,[check!.id])).rows[0].n).toBe(1);
    const readAgain = await repository.getMatrixExecution(check!.id,actor);
    expect(canonicalJson(readAgain)).toBe(canonicalJson(read));
    if (!targets || typeof targets === "string") throw new Error("Legacy targets missing");
    for (const file of files) {
      const previous = await repository.getSourceReview(object.id,file.id,actor);
      if (!previous || typeof previous === "string") throw new Error("Source review missing");
      const rule = matrixRegistry.entries.find(e => e.parameterCode === "PZ-002")!.atomicRules[0];
      const item = targets.items.find(item => item.sourceFileId === file.id)!;
      const reviewed = await repository.recordSourceReviewCommand(object.id,file.id,{
        sourceSha256:file.sha256,revisionStatus:"CURRENT",approvalStatus:"APPROVED",linkGroupId:"fixture-building",
        sectionCode:file.stage === "PD" ? "PZ" : "AR",pageStages:{},
        basis:{reference:"Controlled legacy original sources remain the same building"},
        expectedReviewHash:previous.contentHash,
        matrixScope:{schemaVersion:"matrix-fact-scopes-v1",bindings:[{
          ruleId:rule.ruleId,ruleVersion:rule.version,parameterCode:"PZ-002",entityKey:"fixture-building",
          reference:"Explicit binding to the unchanged legacy observation",target:item.target,
          contexts:Object.fromEntries(rule.requiredContext.map(key => [key,{reference:"Controlled same-building context from original source"}]))
        }]},
      },{actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
      expect(reviewed.kind).toBe("success");
    }
    expect(canonicalJson(await repository.getMatrixExecution(check!.id,actor))).toBe(canonicalJson(read));
    const preserved = await database.query(`SELECT snapshot.submission_bytes,snapshot.submission_hash
      FROM machine_prediction_snapshots snapshot JOIN analysis_runs run ON run.id=snapshot.run_id WHERE run.api_id=$1`,[check!.id]);
    expect(preserved.rows[0].submission_bytes).toEqual(bytes.rows[0].submission_bytes);
    expect(preserved.rows[0].submission_hash).toBe(bytes.rows[0].submission_hash);

    expect(await repository.getMatrixExecution(check!.id,{...actor,userId:randomUUID()})).toBeUndefined();
    expect(await repository.getSubmission(check!.id,{...actor,userId:randomUUID()})).toBeUndefined();
  });
});
