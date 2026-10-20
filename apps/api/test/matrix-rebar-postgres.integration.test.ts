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
const rule = matrixRegistry.entries.find(entry => entry.parameterCode === "KR-057")!.atomicRules[0];

type TextFamily = "REBAR";
type Source = { id: string; name: string; size: number; stage: "PD" | "RD"; mimeType: string;
  sha256: string; scanStatus: "CLEAN"; status: "STORED"; storageKey: string };
type Fixture = { objectId: string; actor: AuthenticatedActor; files: Source[] };
const command = (actor: AuthenticatedActor, idempotencyKey = randomUUID()) => ({
  actor, idempotencyKey, requestId: randomUUID(), traceId: randomUUID(),
});

/** Controlled synthetic text only: two separately addressed rows in each source. */
const textScript = `import json,sys
sys.path.insert(0,'../../services/worker/tests')
from test_matrix_rebar import fixture_args
x=json.load(sys.stdin);args=fixture_args(full=False,actual=x['actualFirst']);out=[]
for source in x['sources']:
 artifact=args['text_artifacts'][0 if source['stages']==['PD'] else 1]
 artifact.update(sourceFileId=source['sourceFileId'],inputSha256=source['sha256'])
 out.append(artifact)
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

(adminUrl ? describe : describe.skip)("working reinforcement exact catalog durable PostgreSQL", { timeout: 60_000 }, () => {
  const databaseName = `rebar_scope_it_${randomUUID().replaceAll("-", "")}`;
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
      parameters: reference.parameters, analysisProfile: "MATRIX_V1", organizationSlug: "rebar-scope-it" });
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
    const object = await repository.createObject({ name: "Controlled synthetic working reinforcement", address: "Москва" });
    const user = await provisionLocalUser(database, { organizationSlug: "rebar-scope-it",
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

  async function run(fixture: Fixture, actualFirst = "А400", family: TextFamily = "REBAR"):
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
      const claimed = await repository.claimJob(job.id, { workerId: "rebar-scope-it", capabilities: [job.job_type] });
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
        result = { disposition: "UNSUPPORTED_COVERAGE_SEALED", workerId: "rebar-scope-it" };
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
    expect(read.execution.observations.filter(f=>f.attribute==="WORKING_REINFORCEMENT_CLASS")).toHaveLength(2);
    expect(await repository.getCheck(checkId, fixture.actor)).toMatchObject({ status: "PARTIAL" });
    return { checkId, read };
  }

  async function targets(checkId: string, actor: AuthenticatedActor, expectedCount = 2): Promise<MatrixFactTargetsRead> {
    const result = await repository.getMatrixFactTargets(checkId, actor);
    if (!result || typeof result === "string") throw new Error("Immutable fact targets missing");
    const read=await repository.getMatrixExecution(checkId,actor);if(!read||typeof read==="string")throw Error("Execution missing");
    const ids=new Set(read.execution.observations.filter(f=>f.attribute==="WORKING_REINFORCEMENT_CLASS").map(f=>f.id));
    expect(result.items.filter(item=>ids.has(item.target.observationId))).toHaveLength(expectedCount);
    return result;
  }

  function review(fixture: Fixture, source: Source, scope: MatrixFactScope,
    expectedReviewHash: string | null = null): SourceReviewInput {
    return { sourceSha256: source.sha256, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: fixture.objectId, sectionCode: "KR", pageStages: {},
      basis: { reference: "Controlled source bytes and current approved project identity verified" },
      matrixScope: scope, expectedReviewHash };
  }

  function binding(target: MatrixFactTargetsRead["items"][number]["target"]): MatrixFactScope["bindings"][number] {
    return {ruleId:rule.ruleId,ruleVersion:rule.version,parameterCode:"KR-057",entityKey:"stair-working-member",
      reference:"Synthetic original working reinforcement member explicitly reviewed",target,contexts:{
        APPROVED_CHANGE_STATUS:{reference:"Synthetic approved change register checked for working reinforcement",approvedChangePresent:false},
        REINFORCEMENT_APPLICATION_SCOPE:{reference:"Synthetic original common working stair member excludes guide wall and embedded bars"},
        [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`]:{reference:"Synthetic matching working member and application explicitly reviewed",
          parameterCode:"KR-057",attribute:"WORKING_REINFORCEMENT_CLASS",canonicalUnit:"rebar_catalog_example",componentRole:"WORKING_REINFORCEMENT_POSITION",
          componentKey:"stair-working-member",zoneKey:"same-underground-stair-flight",operatingModeKey:"WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED",
          measurementBasisKey:"DECLARED_REINFORCEMENT_CLASS"},
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

  async function setup(actual="А400"){
    const value=await fixture(),baseline=await run(value,actual),origin=await targets(baseline.checkId,value.actor);
    const pd=value.files.find(f=>f.stage==="PD")!,rd=value.files.find(f=>f.stage==="RD")!;
    const targetFor=(source:Source)=>origin.items.find(item=>item.sourceFileId===source.id&&baseline.read.execution.observations.some(f=>f.id===item.target.observationId&&f.attribute==="WORKING_REINFORCEMENT_CLASS"))!.target;
    return {value,baseline,pd,rd,targetFor};
  }
  async function save(s:Awaited<ReturnType<typeof setup>>,source:Source,prior:string|null=null,withdraw=false){
    const b=binding(s.targetFor(source));if(withdraw)delete b.contexts.REINFORCEMENT_APPLICATION_SCOPE;
    return repository.recordSourceReviewCommand(s.value.objectId,source.id,
      review(s.value,source,{schemaVersion:"matrix-fact-scopes-v1",bindings:[b]},prior),command(s.value.actor));
  }
  const count=(read:MatrixExecutionRead)=>read.execution.results.filter(r=>r.parameterCode==="KR-057"&&r.qualified).length;
  it("qualifies only after both reviews, withdraws/restores application and preserves immutable snapshots",async()=>{
    const s=await setup(),before=await frozen(s.baseline.checkId);expect(count(s.baseline.read)).toBe(0);
    const pd=await save(s,s.pd);expect(pd.kind).toBe("success");
    const half=await run(s.value);expect(count(half.read)).toBe(0);
    const rd=await save(s,s.rd);expect(rd.kind).toBe("success");if(rd.kind!=="success")throw Error("RD save failed");
    const accepted=await run(s.value);expect(count(accepted.read)).toBe(1);
    expect(accepted.read.execution.results.find(r=>r.parameterCode==="KR-057")).toMatchObject({machineStatus:"CANDIDATE",qualified:true,delta:null});
    expect(accepted.read.presentation.every(p=>p.confidence.calibratedProbability===null)).toBe(true);
    const acceptedSnapshot=await frozen(accepted.checkId);
    const withdrawn=await save(s,s.rd,rd.value.contentHash,true);expect(withdrawn.kind).toBe("success");if(withdrawn.kind!=="success")throw Error("Withdraw failed");
    const unknown=await run(s.value);expect(count(unknown.read)).toBe(0);
    expect(unknown.read.execution.results.find(r=>r.parameterCode==="KR-057")).toMatchObject({reasonCode:"CONTEXT_UNVERIFIED:REINFORCEMENT_APPLICATION_SCOPE",qualified:false});
    const restored=await save(s,s.rd,withdrawn.value.contentHash);expect(restored.kind).toBe("success");
    expect(count((await run(s.value)).read)).toBe(1);
    expect(await frozen(s.baseline.checkId)).toEqual(before);expect(await frozen(accepted.checkId)).toEqual(acceptedSnapshot);
  });
  it("equal declarations retain negative-scope UNKNOWN despite authenticated working identity",async()=>{
    const s=await setup("А500С");expect((await save(s,s.pd)).kind).toBe("success");expect((await save(s,s.rd)).kind).toBe("success");
    const equal=await run(s.value,"А500С");expect(count(equal.read)).toBe(0);
    expect(equal.read.execution.results.find(r=>r.parameterCode==="KR-057")).toMatchObject({machineStatus:"CLARIFICATION_REQUIRED",reasonCode:"NEGATIVE_SCOPE_UNVERIFIED",qualified:false,delta:null});
  });
  it("server rejects invented target bytes before source review write",async()=>{
    const s=await setup();
    const b=binding({...s.targetFor(s.rd),textArtifactHash:"0".repeat(64)});
    const result=await repository.recordSourceReviewCommand(s.value.objectId,s.rd.id,
      review(s.value,s.rd,{schemaVersion:"matrix-fact-scopes-v1",bindings:[b]}),command(s.value.actor));
    expect(result.kind).toBe("invalid_state");expect(await repository.getSourceReview(s.value.objectId,s.rd.id,s.value.actor)).toBeUndefined();
  });
});
