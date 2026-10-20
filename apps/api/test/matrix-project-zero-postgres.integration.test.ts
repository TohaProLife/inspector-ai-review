import { extractSourceDeclarationsV2 as extractSourceDeclarations } from "../src/matrix-source-declarations-v2.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MatrixExecutionRead, MatrixFactScope, MatrixFactTargetsRead,
  SourceReviewInput } from "@inspector-ai/contracts";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixConfigHash, MATRIX_PROFILE, matrixRegistry } from "../src/matrix-execution.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const rule = matrixRegistry.entries.find(entry => entry.parameterCode === "PZ-009")!.atomicRules[0];

type TextFamily = "PROJECT_ZERO";
type Source = { id: string; name: string; size: number; stage: "PD" | "RD"; mimeType: string;
  sha256: string; scanStatus: "CLEAN"; status: "STORED"; storageKey: string };
type Fixture = { objectId: string; actor: AuthenticatedActor; files: Source[] };
const command = (actor: AuthenticatedActor, idempotencyKey = randomUUID()) => ({
  actor, idempotencyKey, requestId: randomUUID(), traceId: randomUUID(),
});

/** Controlled synthetic text only: two separately addressed rows in each source. */
const textScript = `import json,sys
from inspector_worker.text_layer import qualify_page_text,TEXT_QUALITY_POLICY_VERSION
x=json.load(sys.stdin);out=[]
for source in x['sources']:
 pd=source['stages']==['PD'];value='159.95' if pd else str(x['actualFirst'])
 blocks=([{'text':'За относительную отметку 0,000 принята абсолютная отметка 159,95 м., что соответствует \\nотметке чистого пола входного вестибюля на 1-м этаже.',
  'bboxMilliPoints':[1000,66000,550000,92000],
  'lineBboxesMilliPoints':[[1000,80000,550000,92000],[1000,66000,350000,78000]]}] if pd else [
 {'text':'За относительную отметку ±0.000 принята отметка чистого пола первого этажа, соответствующая абсолютной отметке '+value+'.',
  'bboxMilliPoints':[1000,200000,290000,212000],'lineBboxesMilliPoints':[[1000,200000,290000,212000]]},
 {'text':'Все размеры даны в миллиметрах,\\nотметки - в метрах.','bboxMilliPoints':[1000,66000,250000,92000],
  'lineBboxesMilliPoints':[[1000,80000,250000,92000],[1000,66000,100000,78000]]}])
 quality=qualify_page_text([b['text'] for b in blocks])
 out.append({'schemaVersion':'document-text-v2','sourceFileId':source['sourceFileId'],
 'inputSha256':source['sha256'],'coordinateSystem':'PDF_BOTTOM_LEFT_MILLI_POINTS','pageCount':1,'textPageCount':1,
 'qualityPolicyVersion':TEXT_QUALITY_POLICY_VERSION,
 'qualitySummary':{'textLayerCandidatePageCount':1,'ocrRequiredPageCount':0},
 'pages':[{'pageNumber':1,'widthMilliPoints':600000,'heightMilliPoints':800000,'blocks':blocks,'quality':quality}]})
json.dump(out,sys.stdout,ensure_ascii=False)`;

const executionScript = `import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.project_constraints import extract_project_constraints
x=json.load(sys.stdin)
sources=[{**source,**x['lease']['inputs']['sourceDecisions'].get(source['sourceFileId'],{})} for source in x['lease']['inputs']['sourceFiles']]
json.dump({'execution':build_matrix_execution(object_id=x['lease']['objectId'],
 input_manifest_hash=x['lease']['inputManifestHash'],
 sources=sources,text_artifacts=x['artifacts']),
 'projectConstraints':extract_project_constraints(x['lease']['objectId'],x['lease']['inputManifestHash'],sources,x['artifacts'])},
 sys.stdout,ensure_ascii=False)`;

(adminUrl ? describe : describe.skip)("project zero typed authority durable PostgreSQL", { timeout: 60_000 }, () => {
  const databaseName = `zero_scope_it_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let database: Pool;
  let repository: PostgresInspectionRepository;
  const previousOcr = process.env.INSPECTOR_MATRIX_OCR_LAYOUT;

  beforeAll(async () => {
    process.env.INSPECTOR_MATRIX_OCR_LAYOUT = "1";
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const connection = new URL(adminUrl!);
    connection.pathname = `/${databaseName}`;
    await runDatabaseMigrations(connection.toString());
    database = new Pool({ connectionString: connection.toString() });
    const reference = await loadReferenceData();
    repository = await PostgresInspectionRepository.create({ connectionString: connection.toString(),
      parameters: reference.parameters, analysisProfile: "MATRIX_V1", organizationSlug: "zero-scope-it" });
  });

  afterAll(async () => {
    if (previousOcr === undefined) delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
    else process.env.INSPECTOR_MATRIX_OCR_LAYOUT = previousOcr;
    await repository?.close();
    await database?.end();
    if (admin) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  async function fixture(): Promise<Fixture> {
    const object = await repository.createObject({ name: "Controlled two-row buildings", address: "Москва" });
    const user = await provisionLocalUser(database, { organizationSlug: "zero-scope-it",
      login: `fact-${randomUUID()}`, displayName: "Fact reviewer", password: "Fact-Scope-Test-2026!",
      objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"] });
    const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id,
      organizationId: user.organizationId, displayName: "Fact reviewer", roles: ["INSPECTOR"],
      capabilities: ["SOURCE_REVIEW"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" };
    const files: Source[] = (["PD", "RD"] as const).map((stage, index) => ({ id: `FIL-${randomUUID()}`,
      name: `${stage}.pdf`, size: 43, stage, mimeType: "application/pdf", sha256: String(index + 1).repeat(64),
      scanStatus: "CLEAN", status: "STORED", storageKey: `objects/${object.id}/${stage}.pdf` }));
    await repository.registerIngestedFiles(object.id, files);
    return { objectId: object.id, actor, files };
  }

  async function run(fixture: Fixture, actualFirst = 159.96, family: TextFamily = "PROJECT_ZERO"):
    Promise<{ checkId: string; read: MatrixExecutionRead }> {
    const check = await repository.startCheck(fixture.objectId);
    expect(check).toBeDefined();
    const checkId = check!.id;
    let artifacts: Record<string, unknown>[] = [];
    const scaffold: Record<string, string[]> = {
      DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
      DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
      DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
      ENTITY_EXTRACTION: ["PROVIDER_NOT_CONFIGURED", "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED", "ENTITY_EXTRACTION_MODEL"],
      EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
    };
    for (let step = 0; step < 14; step++) {
      const ready = await database.query<{ id: string; job_type: string }>(`SELECT job.id,job.job_type
        FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
        WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`, [checkId]);
      if (!ready.rows.length) break;
      const job = ready.rows[0];
      const claimed = await repository.claimJob(job.id, { workerId: "zero-scope-it", capabilities: [job.job_type] });
      expect(claimed.kind, job.job_type).toBe("acquired");
      if (claimed.kind !== "acquired") throw new Error(`Cannot claim ${job.job_type}`);
      const lease = claimed.lease;
      let result: Record<string, unknown>;
      if (job.job_type === "ANALYSIS_INVENTORY") {
        result = { disposition: "MANIFEST_INVENTORIED", sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } };
      } else if (job.job_type === "DOCUMENT_TEXT_LAYER") {
        const process = spawnSync(pythonExecutable, ["-c", textScript], {
          input: JSON.stringify({ sources: lease.inputs.sourceFiles, actualFirst, family }), encoding: "utf8",
          env: { ...globalThis.process.env, ...pythonEnv }, timeout: 15_000,
        });
        expect(process.status, process.stderr).toBe(0);
        artifacts = JSON.parse(process.stdout);
        result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", sources: artifacts.map(artifact => ({
          sourceFileId: artifact.sourceFileId, inputSha256: artifact.inputSha256, status: "EXTRACTED", artifact,
        })) };
      } else if (job.job_type === "RULE_EVALUATION") {
        const process = spawnSync(pythonExecutable, ["-c", executionScript], {
          input: JSON.stringify({ lease, artifacts }), encoding: "utf8",
          env: { ...globalThis.process.env, ...pythonEnv }, timeout: 15_000,
        });
        expect(process.status, process.stderr).toBe(0);
        const { execution, projectConstraints } = JSON.parse(process.stdout);
        const sourceDeclarations = extractSourceDeclarations({objectId:lease.objectId,inputManifestHash:lease.inputManifestHash,
          sources:lease.inputs.sourceFiles.map(source=>({...source,pageStages:lease.inputs.sourceDecisions[source.sourceFileId]?.pageStages??{}})),
          textArtifacts:artifacts});
        result = { schemaVersion: "analysis-stage-result-v2", jobType: job.job_type,
          inputManifestHash: lease.inputManifestHash, disposition: "RULES_EVALUATED", providerKind: "RULE_ENGINE",
          providerProfileId: MATRIX_PROFILE, providerConfigHash: matrixConfigHash,
          outputCount: execution.results.length, execution, projectConstraints, sourceDeclarations };
      } else if (job.job_type === "ANALYSIS_SEAL_UNSUPPORTED") {
        result = { disposition: "UNSUPPORTED_COVERAGE_SEALED", workerId: "zero-scope-it" };
      } else {
        const settings = scaffold[job.job_type];
        if (!settings) throw new Error(`Unexpected synthetic pipeline job ${job.job_type}`);
        const [disposition, reasonCode, providerKind] = settings;
        result = { schemaVersion: "analysis-stage-result-v1", jobType: job.job_type,
          inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0 };
      }
      const completed = await repository.completeJob(job.id, {
        attemptId: lease.attemptId, fencingToken: lease.fencingToken, result,
      });
      expect(completed.kind, JSON.stringify(completed)).toBe("completed");
    }
    const read = await repository.getMatrixExecution(checkId, fixture.actor);
    if (!read || typeof read === "string") throw new Error("Immutable matrix execution missing");
    expect(read.execution.observations).toHaveLength(2);
    expect(await repository.getCheck(checkId, fixture.actor)).toMatchObject({ status: "PARTIAL" });
    return { checkId, read };
  }

  async function targets(checkId: string, actor: AuthenticatedActor, expectedCount = 2): Promise<MatrixFactTargetsRead> {
    const result = await repository.getMatrixFactTargets(checkId, actor);
    if (!result || typeof result === "string") throw new Error("Immutable fact targets missing");
    expect(result.items).toHaveLength(expectedCount);
    return result;
  }

  function review(fixture: Fixture, source: Source, scope: MatrixFactScope,
    expectedReviewHash: string | null = null): SourceReviewInput {
    return { sourceSha256: source.sha256, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: fixture.objectId, sectionCode: source.stage === "PD" ? "PZ" : "AR", pageStages: {},
      basis: { reference: "Controlled source bytes and current approved project identity verified" },
      matrixScope: scope, expectedReviewHash };
  }

  function binding(target: MatrixFactTargetsRead["items"][number]["target"], authority?:any): MatrixFactScope["bindings"][number] {
    return {ruleId:rule.ruleId,ruleVersion:rule.version,parameterCode:"PZ-009",entityKey:"building-zero",
      reference:"Synthetic original zero declaration explicitly reviewed",target,contexts:{
        APPROVED_CHANGE_STATUS:{reference:"Synthetic approved change register checked for project zero",approvedChangePresent:false},
        ...(authority?{PROJECT_ZERO_GEODETIC_AUTHORITY:{reference:"Synthetic inspector classified actual approved PD geodetic basis",projectZeroAuthority:authority}}:{}),
        [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`]:{reference:"Synthetic matching building floor zero and reviewed vertical datum",
          parameterCode:"PZ-009",attribute:"PROJECT_ZERO_ABSOLUTE_ELEVATION",canonicalUnit:"m",componentRole:"PROJECT_ZERO_DATUM",
          componentKey:"building-zero",zoneKey:"same-local-finished-floor-zero",operatingModeKey:"synthetic-reviewed-vertical-datum",
          measurementBasisKey:"FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM"},
      }};
  }

  async function frozen(checkId: string) {
    const saved = await database.query<{ content_json: Record<string, unknown>; content_hash: string;
      submission_bytes: Buffer; submission_hash: string }>(`SELECT stage.content_json,stage.content_hash,
        snapshot.submission_bytes,snapshot.submission_hash FROM analysis_runs run
      JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION'
      JOIN machine_prediction_snapshots snapshot ON snapshot.run_id=run.id WHERE run.api_id=$1`, [checkId]);
    expect(saved.rows).toHaveLength(1);
    const row = saved.rows[0];
    expect(sha256(canonicalJson(row.content_json))).toBe(row.content_hash.trim());
    expect(sha256(row.submission_bytes)).toBe(row.submission_hash.trim());
    return { content: canonicalJson(row.content_json), contentHash: row.content_hash.trim(),
      bytes: Buffer.from(row.submission_bytes), submissionHash: row.submission_hash.trim() };
  }

  async function setup(actual=159.96){
    const value=await fixture(),baseline=await run(value,actual),origin=await targets(baseline.checkId,value.actor);
    const pd=value.files.find(f=>f.stage==="PD")!,rd=value.files.find(f=>f.stage==="RD")!;
    const targetFor=(source:Source)=>origin.items.find(item=>item.sourceFileId===source.id)!.target;
    const claim={kind:"APPROVED_PD_GEODETIC_BASIS" as const,sourceFileId:pd.id,sourceSha256:pd.sha256,pageNumber:1,target:targetFor(pd)};
    return {value,baseline,pd,rd,targetFor,claim};
  }
  async function save(s:Awaited<ReturnType<typeof setup>>,source:Source,authority:any,prior:string|null=null,reference?:string){
    const input=review(s.value,source,{schemaVersion:"matrix-fact-scopes-v1",bindings:[binding(s.targetFor(source),authority)]},prior);
    if(reference)input.basis.reference=reference;
    return repository.recordSourceReviewCommand(s.value.objectId,source.id,input,command(s.value.actor));
  }
  const count=(read:MatrixExecutionRead)=>read.execution.results.filter(r=>r.parameterCode==="PZ-009"&&r.qualified).length;

  it("rejects forged PD claims and RD pointers before writing an authenticated decision",async()=>{
    const s=await setup();
    for(const patch of [{sourceFileId:s.rd.id},{sourceSha256:"0".repeat(64)},{pageNumber:2},
      {target:s.targetFor(s.rd)},{reviewContentHash:"e".repeat(64)},{kind:"PZ_FILENAME"}]){
      expect(await save(s,s.pd,{...s.claim,...patch})).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
      expect(await repository.getSourceReview(s.value.objectId,s.pd.id,s.value.actor)).toBeUndefined();
    }
    expect(await save(s,s.rd,{...s.claim,reviewContentHash:"e".repeat(64)})).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
    expect(await repository.getSourceReview(s.value.objectId,s.rd.id,s.value.actor)).toBeUndefined();
    const pd=await save(s,s.pd,s.claim);expect(pd.kind).toBe("success");if(pd.kind!=="success")throw Error("PD review failed");
    for(const patch of [{reviewContentHash:"0".repeat(64)},{sourceSha256:"0".repeat(64)},{pageNumber:2},
      {target:{...s.claim.target,evidenceHash:"0".repeat(64)}},{sourceFileId:s.rd.id}]){
      expect(await save(s,s.rd,{...s.claim,reviewContentHash:pd.value.contentHash,...patch})).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
    }
    expect(await repository.getSourceReview(s.value.objectId,s.rd.id,s.value.actor)).toBeUndefined();
    // Source in another object remains inaccessible as authority even with an authentic target/hash.
    const other=await setup(),otherPd=await save(other,other.pd,other.claim);
    expect(otherPd.kind).toBe("success");if(otherPd.kind!=="success")throw Error("Other PD review failed");
    expect(await save(s,s.rd,{...other.claim,reviewContentHash:otherPd.value.contentHash})).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
  });

  it("qualifies changed datum only after both exact reviews, invalidates stale PD hash, and freezes old exports",async()=>{
    const s=await setup(),original=await frozen(s.baseline.checkId);
    expect(count(s.baseline.read)).toBe(0);
    const pd=await save(s,s.pd,s.claim);expect(pd.kind).toBe("success");if(pd.kind!=="success")throw Error("PD review failed");
    const rd=await save(s,s.rd,{...s.claim,reviewContentHash:pd.value.contentHash});expect(rd.kind).toBe("success");if(rd.kind!=="success")throw Error("RD review failed");
    const candidate=await run(s.value);expect(count(candidate.read)).toBe(1);
    expect(candidate.read.execution.results.find(r=>r.parameterCode==="PZ-009")).toMatchObject({machineStatus:"CANDIDATE",qualified:true,delta:"0.01"});
    expect(candidate.read.presentation.every(p=>p.confidence.calibratedProbability===null)).toBe(true);
    expect(await frozen(s.baseline.checkId)).toEqual(original);
    const accepted=await frozen(candidate.checkId);
    const updatedPd=await save(s,s.pd,s.claim,pd.value.contentHash,"Synthetic later approved PD review preserves same original datum but has a new authenticated decision");
    expect(updatedPd.kind).toBe("success");if(updatedPd.kind!=="success")throw Error("PD update failed");
    expect(updatedPd.value.contentHash).not.toBe(pd.value.contentHash);
    const stale=await run(s.value);expect(count(stale.read)).toBe(0);
    expect(stale.read.execution.results.find(r=>r.parameterCode==="PZ-009")).toMatchObject({reasonCode:"CONTEXT_UNVERIFIED:PROJECT_ZERO_GEODETIC_AUTHORITY",qualified:false});
    expect(await frozen(candidate.checkId)).toEqual(accepted);
    expect(await save(s,s.rd,{...s.claim,reviewContentHash:pd.value.contentHash},rd.value.contentHash)).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
    const restoredRd=await save(s,s.rd,{...s.claim,reviewContentHash:updatedPd.value.contentHash},rd.value.contentHash);
    expect(restoredRd.kind).toBe("success");if(restoredRd.kind!=="success")throw Error("RD restore failed");
    const restored=await run(s.value);expect(count(restored.read)).toBe(1);
    expect(await frozen(candidate.checkId)).toEqual(accepted);expect(await frozen(s.baseline.checkId)).toEqual(original);
    // Explicit authority withdrawal leaves the source review intact but never qualifies its old pointer.
    const withdrawn=await save(s,s.pd,undefined,updatedPd.value.contentHash);expect(withdrawn.kind).toBe("success");
    const unknown=await run(s.value);expect(count(unknown.read)).toBe(0);
    expect(await frozen(candidate.checkId)).toEqual(accepted);
  });

  it("stores UNKNOWN PD classification without approving it or accepting an RD authority reference",async()=>{
    const s=await setup(),before=await frozen(s.baseline.checkId);
    const input=review(s.value,s.pd,{schemaVersion:"matrix-fact-scopes-v1",bindings:[binding(s.targetFor(s.pd),s.claim)]});
    input.revisionStatus="UNKNOWN";input.approvalStatus="UNKNOWN";
    const saved=await repository.recordSourceReviewCommand(s.value.objectId,s.pd.id,input,command(s.value.actor));
    expect(saved.kind).toBe("success");if(saved.kind!=="success")throw Error("UNKNOWN classification failed");
    expect(saved.value).toMatchObject({revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",matrixScope:input.matrixScope});
    expect(await save(s,s.rd,{...s.claim,reviewContentHash:saved.value.contentHash})).toMatchObject({kind:"invalid_state",code:"MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH"});
    expect(await repository.getSourceReview(s.value.objectId,s.rd.id,s.value.actor)).toBeUndefined();
    const next=await run(s.value);expect(count(next.read)).toBe(0);
    expect(next.read.execution.observations.filter(f=>f.sourceFileId===s.pd.id).every(f=>(f.sourceFlags as string[]).includes("SOURCE_APPROVAL_UNKNOWN"))).toBe(true);
    expect(await frozen(s.baseline.checkId)).toEqual(before);
  });

  it("equal declared zero never gains a negative without complete rule inventory",async()=>{
    const s=await setup(159.95),pd=await save(s,s.pd,s.claim);expect(pd.kind).toBe("success");if(pd.kind!=="success")throw Error("PD review failed");
    expect((await save(s,s.rd,{...s.claim,reviewContentHash:pd.value.contentHash})).kind).toBe("success");
    const equal=await run(s.value,159.95);expect(count(equal.read)).toBe(0);
    expect(equal.read.execution.results.find(r=>r.parameterCode==="PZ-009")).toMatchObject({machineStatus:"CLARIFICATION_REQUIRED",reasonCode:"NEGATIVE_SCOPE_UNVERIFIED",qualified:false});
    expect(equal.read.execution.coverage.find(r=>r.parameterCode==="PZ-009")?.executionStatus).toBe("PARTIAL");
  });
});
