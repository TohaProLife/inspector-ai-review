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
const areaRule = matrixRegistry.entries.find(entry => entry.parameterCode === "PZ-002")!.atomicRules[0];
const sidewalkRule = matrixRegistry.entries.find(entry => entry.parameterCode === "SPZU-026")!.atomicRules[0];
type TextFamily = "BUILDING_AREA" | "SIDEWALK_TILE_AREA" | "SIDEWALK_TABLE" | "EGRESS_HEIGHT" | "STAIR_DIMENSIONS" | "FENCE_HEIGHT";
type Source = { id: string; name: string; size: number; stage: "PD" | "RD"; mimeType: string;
  sha256: string; scanStatus: "CLEAN"; status: "STORED"; storageKey: string };
type Fixture = { objectId: string; actor: AuthenticatedActor; files: Source[] };
const command = (actor: AuthenticatedActor, idempotencyKey = randomUUID()) => ({
  actor, idempotencyKey, requestId: randomUUID(), traceId: randomUUID(),
});

/** Controlled synthetic text only: two separately addressed rows in each source. */
const textScript = `import json,sys
from inspector_worker.text_layer import qualify_page_text,TEXT_QUALITY_POLICY_VERSION
x=json.load(sys.stdin); out=[]
for source in x['sources']:
 if x['family']=='SIDEWALK_TABLE' and source['stages']==['PD']:
  from services.worker.tests.test_matrix_engine import pd_sidewalk_table_artifact,refresh_artifact_quality
  table=pd_sidewalk_table_artifact(source)
  table['pages'][0]['blocks'].append({'text':'Площадь тротуаров из бетонной плитки: 99 м²',
   'bboxMilliPoints':[800000,800000,1400000,812000]})
  out.append(refresh_artifact_quality(table));continue
 values=[100,200] if source['stages']==['PD'] else [x['actualFirst'],205]
 label=('Площадь тротуарного плиточного покрытия' if source['stages']==['PD']
  else 'Площадь тротуаров из бетонной плитки') if x['family'] in ['SIDEWALK_TILE_AREA','SIDEWALK_TABLE'] else 'Общая площадь здания'
 lines=[label+': '+str(value)+' м²' for value in values]
 if x['family']=='EGRESS_HEIGHT':
  values=['2.1','2.1'] if source['stages']==['PD'] else ['1.99','1.89']
  lines=[label+': '+value+' м' for label,value in zip([
   'Высота эвакуационного коридора в свету','Высота эвакуационной двери в свету'],values)]
 if x['family']=='STAIR_DIMENSIONS':
  values=['310','149'] if source['stages']==['PD'] else ['299','151']
  lines=[label+': '+value+' мм' for label,value in zip([
   'Глубина проступи лестницы в свету','Высота подступенка лестницы после отделки'],values)]
 if x['family']=='FENCE_HEIGHT':
  lines=['Высота ограждения территории: '+('2.5' if source['stages']==['PD'] else '2.4')+' м']
 quality=qualify_page_text(lines)
 out.append({'schemaVersion':'document-text-v2','sourceFileId':source['sourceFileId'],
  'inputSha256':source['sha256'],'coordinateSystem':'PDF_BOTTOM_LEFT_MILLI_POINTS',
  'pageCount':1,'textPageCount':1,'qualityPolicyVersion':TEXT_QUALITY_POLICY_VERSION,
  'qualitySummary':{'textLayerCandidatePageCount':int(quality['disposition']=='TEXT_LAYER_CANDIDATE'),
   'ocrRequiredPageCount':int(quality['disposition']=='OCR_REQUIRED')},
  'pages':[{'pageNumber':1,'widthMilliPoints':600000,'heightMilliPoints':800000,
   'blocks':[{'bboxMilliPoints':[1000,20000+index*30000,550000,30000+index*30000],'text':line}
    for index,line in enumerate(lines)],'quality':quality}]})
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

(adminUrl ? describe : describe.skip)("per-fact bindings durable PostgreSQL", { timeout: 60_000 }, () => {
  const databaseName = `fact_scope_it_${randomUUID().replaceAll("-", "")}`;
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
      parameters: reference.parameters, analysisProfile: "MATRIX_V1", organizationSlug: "fact-scope-it" });
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
    const user = await provisionLocalUser(database, { organizationSlug: "fact-scope-it",
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

  async function run(fixture: Fixture, actualFirst = 103, family: TextFamily = "BUILDING_AREA"):
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
      const claimed = await repository.claimJob(job.id, { workerId: "fact-scope-it", capabilities: [job.job_type] });
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
        result = { disposition: "UNSUPPORTED_COVERAGE_SEALED", workerId: "fact-scope-it" };
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
    expect(read.execution.observations).toHaveLength(family === "FENCE_HEIGHT" ? 2 : 4);
    expect(await repository.getCheck(checkId, fixture.actor)).toMatchObject({ status: "PARTIAL" });
    return { checkId, read };
  }

  async function targets(checkId: string, actor: AuthenticatedActor, expectedCount = 4): Promise<MatrixFactTargetsRead> {
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

  function binding(target: MatrixFactTargetsRead["items"][number]["target"]): MatrixFactScope["bindings"][number] {
    return { ruleId: areaRule.ruleId, ruleVersion: areaRule.version, parameterCode: "PZ-002",
      entityKey: "building-east", reference: "Controlled first-row building identity explicitly reviewed",
      target, contexts: Object.fromEntries(areaRule.requiredContext.map(key => [key, {
        reference: "Controlled original row belongs to the east building and this comparison",
      }])) };
  }

  function sidewalkBinding(target: MatrixFactTargetsRead["items"][number]["target"]): MatrixFactScope["bindings"][number] {
    return { ruleId: sidewalkRule.ruleId, ruleVersion: sidewalkRule.version, parameterCode: "SPZU-026",
      entityKey: "sidewalk-east", reference: "Controlled first-row sidewalk surface explicitly reviewed",
      target, contexts: {
        APPROVED_CHANGE_STATUS: { reference: "Customer change register checked for this exact surface", approvedChangePresent: false },
        SURFACE_TYPE_IDENTITY: { reference: "Original rows describe the same concrete tile surface type" },
        ZONE_IDENTITY: { reference: "Original rows describe the same east courtyard boundaries" },
        [`ATOMIC_SUBRULE_SCOPE:${sidewalkRule.ruleId}`]: {
          reference: "Tile construction, courtyard, ground placement and area basis separately checked",
          parameterCode: "SPZU-026", attribute: "SIDEWALK_TILE_AREA", canonicalUnit: "m2",
          componentRole: "SIDEWALK_TILE_PAVING", componentKey: "concrete-tile-type-3",
          zoneKey: "east-courtyard-gpzu", operatingModeKey: "GROUND", measurementBasisKey: "AREA_WITHIN_GPZU_M2",
        },
      } };
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

  it.each([103, 100])("binds only first-row facts (RD=%s), keeps unbound evidence and frozen old export", async actualFirst => {
    const setup = await fixture();
    const baseline = await run(setup, actualFirst);
    expect(baseline.read.execution.observations.every(fact => fact.entityKey === null)).toBe(true);
    const original = await frozen(baseline.checkId);
    const originalSubmission = await repository.getSubmission(baseline.checkId, setup.actor);
    const originTargets = await targets(baseline.checkId, setup.actor);
    expect(originTargets.executionContentHash).toBe(original.contentHash);
    expect(await repository.getMatrixFactTargets(baseline.checkId)).toBe("AUTH_REQUIRED");
    expect(await repository.getMatrixFactTargets(baseline.checkId,
      { ...setup.actor, userId: randomUUID() })).toBeUndefined();

    for (const source of setup.files) {
      const fact = baseline.read.execution.observations.find(fact => fact.sourceFileId === source.id
        && fact.value === String(source.stage === "PD" ? 100 : actualFirst))!;
      const target = originTargets.items.find(item => item.target.observationId === fact.id)!.target;
      const input = review(setup, source, { schemaVersion: "matrix-fact-scopes-v1", bindings: [binding(target)] });
      const saved = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(saved.kind, JSON.stringify(saved)).toBe("success");
      expect(await repository.getSourceReview(setup.objectId, source.id, setup.actor)).toMatchObject({ matrixScope: input.matrixScope });
    }
    expect(await frozen(baseline.checkId)).toEqual(original);
    expect(await repository.getSubmission(baseline.checkId, setup.actor)).toEqual(originalSubmission);

    const next = await run(setup, actualFirst);
    expect(next.read.execution.inputManifestHash).not.toBe(baseline.read.execution.inputManifestHash);
    expect(next.read.execution.observations.filter(fact => fact.entityKey === "building-east")).toHaveLength(2);
    expect(next.read.execution.observations.filter(fact => fact.entityKey === null)).toHaveLength(2);
    const rows = next.read.execution.results.filter(row => row.parameterCode === "PZ-002" && row.comparisonVariant === "PD_RD");
    const selected = rows.find(row => row.entityKey === "building-east");
    if (actualFirst === 103) {
      expect(selected).toMatchObject({ qualified: true, machineStatus: "CANDIDATE", delta: "3" });
      expect(rows.filter(row => row.qualified)).toHaveLength(1);
    } else {
      expect(selected).toMatchObject({ qualified: false, machineStatus: "CLARIFICATION_REQUIRED",
        reasonCode: "NEGATIVE_SCOPE_UNVERIFIED" });
      expect(rows.some(row => row.qualified)).toBe(false);
    }
    expect(rows.find(row => row.entityKey === null)).toMatchObject({ qualified: false });
    expect(next.read.execution.coverage.find(row => row.parameterCode === "PZ-002")).toMatchObject({ executionStatus: "PARTIAL" });
    expect(next.read.presentation.every(row => row.confidence.calibratedProbability === null)).toBe(true);
    expect(await frozen(baseline.checkId)).toEqual(original);
    expect(await repository.getSubmission(baseline.checkId, setup.actor)).toEqual(originalSubmission);
  });

  it("qualifies only reviewed sidewalk rows and abstains for an approved change or ground/roof mismatch", async () => {
    const setup = await fixture();
    const baseline = await run(setup, 110, "SIDEWALK_TILE_AREA");
    expect(baseline.read.execution.observations.every(fact => fact.attribute === "SIDEWALK_TILE_AREA"
      && fact.entityKey === null)).toBe(true);
    expect(baseline.read.execution.results.filter(row => row.parameterCode === "SPZU-026")
      .every(row => !row.qualified)).toBe(true);
    const snapshots = [{ checkId: baseline.checkId, frozen: await frozen(baseline.checkId),
      submission: await repository.getSubmission(baseline.checkId, setup.actor) }];
    const originTargets = await targets(baseline.checkId, setup.actor);
    const sourceBindings = new Map<string, MatrixFactScope["bindings"][number]>();
    const reviewHashes = new Map<string, string>();

    async function save(source: Source, selected: MatrixFactScope["bindings"][number]) {
      const input: SourceReviewInput = { ...review(setup, source, { schemaVersion: "matrix-fact-scopes-v1", bindings: [selected] },
        reviewHashes.get(source.id) ?? null), sectionCode: source.stage === "PD" ? "SPZU" : "PP" };
      const result = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(result.kind, JSON.stringify(result)).toBe("success");
      if (result.kind !== "success") throw new Error("Sidewalk source review was not saved");
      reviewHashes.set(source.id, result.value.contentHash);
      sourceBindings.set(source.id, structuredClone(selected));
      expect(await repository.getSourceReview(setup.objectId, source.id, setup.actor)).toMatchObject({ matrixScope: input.matrixScope });
    }
    async function expectSnapshotsUnchanged() {
      for (const snapshot of snapshots) {
        expect(await frozen(snapshot.checkId)).toEqual(snapshot.frozen);
        expect(await repository.getSubmission(snapshot.checkId, setup.actor)).toEqual(snapshot.submission);
      }
    }
    function sidewalkRows(read: MatrixExecutionRead) {
      return read.execution.results.filter(row => row.parameterCode === "SPZU-026" && row.comparisonVariant === "PD_RD");
    }
    function expectPartial(read: MatrixExecutionRead) {
      expect(read.execution.coverage.find(row => row.parameterCode === "SPZU-026")).toMatchObject({
        executionStatus: "PARTIAL",
        reason: "PARTIAL_SUBRULES_ONLY:SIDEWALK_TILE_AREA_ONLY;OTHER_PAVING_QUANTITIES_AND_FULL_SCOPE_UNSUPPORTED",
      });
      expect(read.presentation.every(row => row.confidence.calibratedProbability === null)).toBe(true);
      expect(read.execution.observations.filter(fact => fact.entityKey === null)).toHaveLength(2);
    }

    for (const source of setup.files) {
      const fact = baseline.read.execution.observations.find(fact => fact.sourceFileId === source.id
        && fact.value === String(source.stage === "PD" ? 100 : 110))!;
      const target = originTargets.items.find(item => item.target.observationId === fact.id)!.target;
      const selected = sidewalkBinding(target);
      expect(Object.keys(selected.contexts)).toEqual(sidewalkRule.requiredContext);
      await save(source, selected);
    }
    await expectSnapshotsUnchanged();

    const qualified = await run(setup, 110, "SIDEWALK_TILE_AREA");
    expect(qualified.read.execution.inputManifestHash).not.toBe(baseline.read.execution.inputManifestHash);
    expect(qualified.read.execution.observations.filter(fact => fact.entityKey === "sidewalk-east")).toHaveLength(2);
    const qualifiedRows = sidewalkRows(qualified.read);
    expect(qualifiedRows.find(row => row.entityKey === "sidewalk-east")).toMatchObject({
      ruleId: sidewalkRule.ruleId, qualified: true, machineStatus: "CANDIDATE", delta: "10",
      expectedValue: "100", actualValue: "110", reasonCode: "CATALOG_TRIGGER_MATCHED",
    });
    expect(qualifiedRows.filter(row => row.qualified)).toHaveLength(1);
    expect(qualifiedRows.find(row => row.entityKey === null)).toMatchObject({ qualified: false });
    expectPartial(qualified.read);
    await expectSnapshotsUnchanged();
    snapshots.push({ checkId: qualified.checkId, frozen: await frozen(qualified.checkId),
      submission: await repository.getSubmission(qualified.checkId, setup.actor) });

    const rd = setup.files.find(source => source.stage === "RD")!;
    const approvedChange = structuredClone(sourceBindings.get(rd.id)!);
    approvedChange.contexts.APPROVED_CHANGE_STATUS.approvedChangePresent = true;
    await save(rd, approvedChange);
    const approved = await run(setup, 110, "SIDEWALK_TILE_AREA");
    expect(approved.read.execution.inputManifestHash).not.toBe(qualified.read.execution.inputManifestHash);
    expect(sidewalkRows(approved.read).find(row => row.entityKey === "sidewalk-east")).toMatchObject({
      qualified: false, machineStatus: "CLARIFICATION_REQUIRED", reasonCode: "CONTEXT_UNVERIFIED:APPROVED_CHANGE_STATUS",
    });
    expect(sidewalkRows(approved.read).some(row => row.qualified)).toBe(false);
    expectPartial(approved.read);
    await expectSnapshotsUnchanged();
    snapshots.push({ checkId: approved.checkId, frozen: await frozen(approved.checkId),
      submission: await repository.getSubmission(approved.checkId, setup.actor) });

    const roof = structuredClone(sourceBindings.get(rd.id)!);
    roof.contexts.APPROVED_CHANGE_STATUS.approvedChangePresent = false;
    roof.contexts[`ATOMIC_SUBRULE_SCOPE:${sidewalkRule.ruleId}`].operatingModeKey = "PARKING_ROOF";
    await save(rd, roof);
    const mismatched = await run(setup, 110, "SIDEWALK_TILE_AREA");
    expect(mismatched.read.execution.inputManifestHash).not.toBe(approved.read.execution.inputManifestHash);
    expect(sidewalkRows(mismatched.read).find(row => row.entityKey === "sidewalk-east")).toMatchObject({
      qualified: false, machineStatus: "CLARIFICATION_REQUIRED",
      reasonCode: `CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:${sidewalkRule.ruleId}`,
    });
    expect(sidewalkRows(mismatched.read).some(row => row.qualified)).toBe(false);
    expectPartial(mismatched.read);
    await expectSnapshotsUnchanged();
  });

  it("persists six-context table targets and requires an exact selected-table review before qualifying", async () => {
    const setup = await fixture(), baseline = await run(setup, 110, "SIDEWALK_TABLE");
    const original = await frozen(baseline.checkId), originTargets = await targets(baseline.checkId, setup.actor);
    const selectedBindings = new Map<string, MatrixFactScope["bindings"][number]>();
    const reviewHashes = new Map<string, string>();
    for (const source of setup.files) {
      const selected = baseline.read.execution.observations.find(fact => fact.sourceFileId === source.id
        && fact.value === (source.stage === "PD" ? "112" : "110"))!;
      if (source.stage === "PD") {
        expect(selected.contextFragments).toHaveLength(6);
        expect(selected.sourceFlags).toContain("TABLE_CONTEXT_UNVERIFIED");
      }
      const target = originTargets.items.find(item => item.target.observationId === selected.id)!.target;
      const binding = sidewalkBinding(target);
      const input: SourceReviewInput = { ...review(setup, source, { schemaVersion: "matrix-fact-scopes-v1", bindings: [binding] }),
        sectionCode: source.stage === "PD" ? "GP" : "PP" };
      const saved = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(saved.kind, JSON.stringify(saved)).toBe("success");
      if (saved.kind !== "success") throw new Error("Table fact review missing");
      reviewHashes.set(source.id, saved.value.contentHash); selectedBindings.set(source.id, binding);
    }
    const unreviewed = await run(setup, 110, "SIDEWALK_TABLE");
    expect(unreviewed.read.execution.results.find(row => row.parameterCode === "SPZU-026"
      && row.entityKey === "sidewalk-east")).toMatchObject({ qualified: false,
      reasonCode: "TEXT_OR_STAGE_QUALITY_UNVERIFIED" });
    const beforeTableReview = await frozen(unreviewed.checkId);
    const pd = setup.files.find(source => source.stage === "PD")!;
    const targetItem = originTargets.items.find(item => item.target.observationId === selectedBindings.get(pd.id)!.target.observationId)!;
    expect(targetItem.fragmentsHash).toMatch(/^[a-f0-9]{64}$/u);
    const selected = structuredClone(selectedBindings.get(pd.id)!);
    selected.tableContextReview = { fragmentsHash: targetItem.fragmentsHash!,
      reference: "Controlled table caption, GPZU scope, three column lines and ground row checked" };
    const input: SourceReviewInput = { ...review(setup, pd, { schemaVersion: "matrix-fact-scopes-v1", bindings: [selected] },
      reviewHashes.get(pd.id)!), sectionCode: "GP" };
    const forgedBinding = structuredClone(selected); forgedBinding.tableContextReview!.fragmentsHash = "f".repeat(64);
    const forged: SourceReviewInput = { ...input, matrixScope: { schemaVersion: "matrix-fact-scopes-v1", bindings: [forgedBinding] } };
    expect((await repository.recordSourceReviewCommand(setup.objectId, pd.id, forged, command(setup.actor))).kind).toBe("invalid_state");
    const saved = await repository.recordSourceReviewCommand(setup.objectId, pd.id, input, command(setup.actor));
    expect(saved.kind, JSON.stringify(saved)).toBe("success");
    const qualified = await run(setup, 110, "SIDEWALK_TABLE");
    expect(qualified.read.execution.results.find(row => row.parameterCode === "SPZU-026"
      && row.entityKey === "sidewalk-east")).toMatchObject({ qualified: true, machineStatus: "CANDIDATE",
      expectedValue: "112", actualValue: "110", delta: "-2" });
    expect(qualified.read.execution.observations.filter(fact => fact.entityKey === null)).toHaveLength(2);
    expect(qualified.read.execution.observations.find(fact => fact.contextFragments)?.sourceFlags).toContain("TABLE_CONTEXT_UNVERIFIED");
    expect(qualified.read.execution.coverage.find(row => row.parameterCode === "SPZU-026")).toMatchObject({ executionStatus: "PARTIAL" });
    expect(await frozen(baseline.checkId)).toEqual(original);
    expect(await frozen(unreviewed.checkId)).toEqual(beforeTableReview);
  });

  it("persists separate corridor and door norm/basis bindings without rewriting previous runs", async () => {
    const setup = await fixture(), baseline = await run(setup, 0, "EGRESS_HEIGHT");
    const snapshots = [{ checkId: baseline.checkId, frozen: await frozen(baseline.checkId) }];
    const originTargets = await targets(baseline.checkId, setup.actor);
    const bindings = new Map<string, MatrixFactScope["bindings"]>(), reviewHashes = new Map<string, string>();
    const rules = matrixRegistry.entries.find(entry => entry.parameterCode === "AR-042")!.atomicRules;
    const rows = (read: MatrixExecutionRead) => read.execution.results.filter(row => row.parameterCode === "AR-042");
    expect(rows(baseline.read).every(row => !row.qualified)).toBe(true);
    expect(baseline.read.execution.observations.every(fact => fact.entityKey === null)).toBe(true);
    async function save(source: Source, selected: MatrixFactScope["bindings"]) {
      const input: SourceReviewInput = { ...review(setup, source,
        { schemaVersion: "matrix-fact-scopes-v1", bindings: selected }, reviewHashes.get(source.id) ?? null), sectionCode: "AR" };
      const result = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(result.kind, JSON.stringify(result)).toBe("success");
      if (result.kind !== "success") throw new Error("Egress source review missing");
      reviewHashes.set(source.id, result.value.contentHash); bindings.set(source.id, structuredClone(selected));
    }
    for (const source of setup.files) {
      const selected = baseline.read.execution.observations.filter(fact => fact.sourceFileId === source.id).map(fact => {
        const rule = rules.find(rule => rule.attribute === fact.attribute)!;
        const door = fact.attribute === "EVACUATION_DOOR_CLEAR_HEIGHT";
        return { ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: "AR-042",
          entityKey: door ? "route-A-door-1" : "route-A-corridor-1",
          reference: "Controlled original clear-height row and exact route component verified",
          target: originTargets.items.find(item => item.target.observationId === fact.id)!.target,
          contexts: {
            NORM_APPLICABILITY_VERIFIED: { reference: "Controlled independent applicability review for this route component",
              applicable: true, parameterCode: "AR-042", attribute: fact.attribute,
              threshold: (rule.threshold as { value: string }).value, canonicalUnit: "m" },
            EVACUATION_ROUTE_IDENTITY: { reference: "Controlled same evacuation route on floor one verified" },
            [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`]: {
              reference: "Finished floor to free opening head or lowest obstruction measured independently",
              parameterCode: "AR-042", attribute: fact.attribute, canonicalUnit: "m",
              componentRole: (rule.subruleContext as { componentRole: string }).componentRole, componentKey: door ? "door-1" : "corridor-1",
              zoneKey: "floor-1-route-A", operatingModeKey: "EVACUATION",
              measurementBasisKey: door ? "CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD" : "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION",
            },
          } };
      });
      expect(selected).toHaveLength(2); await save(source, selected);
    }
    const qualified = await run(setup, 0, "EGRESS_HEIGHT");
    expect(rows(qualified.read).filter(row => row.qualified)).toHaveLength(2);
    expect(rows(qualified.read).filter(row => row.qualified).every(row => row.machineStatus === "CANDIDATE")).toBe(true);
    expect(qualified.read.execution.coverage.find(row => row.parameterCode === "AR-042"))
      .toMatchObject({ executionStatus: "PARTIAL", implementedAtomicRules: 2 });
    expect(qualified.read.presentation.every(row => row.confidence.calibratedProbability === null)).toBe(true);
    snapshots.push({ checkId: qualified.checkId, frozen: await frozen(qualified.checkId) });
    const rd = setup.files.find(source => source.stage === "RD")!;
    const withoutDoorNorm = structuredClone(bindings.get(rd.id)!);
    const door = withoutDoorNorm.find(binding => binding.entityKey === "route-A-door-1")!;
    delete door.contexts.NORM_APPLICABILITY_VERIFIED;
    await save(rd, withoutDoorNorm);
    const partlyReviewed = await run(setup, 0, "EGRESS_HEIGHT");
    expect(rows(partlyReviewed.read).filter(row => row.qualified)).toHaveLength(1);
    expect(rows(partlyReviewed.read).find(row => row.entityKey === "route-A-corridor-1")).toMatchObject({ qualified: true });
    expect(rows(partlyReviewed.read).find(row => row.entityKey === "route-A-door-1")).toMatchObject({
      qualified: false, reasonCode: "CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED" });
    snapshots.push({ checkId: partlyReviewed.checkId, frozen: await frozen(partlyReviewed.checkId) });
    // Equal, but incorrect, measurement bases on both sides must not become a matched proof.
    for (const source of setup.files) {
      const nominal = structuredClone(bindings.get(source.id)!);
      for (const selected of nominal) {
        selected.contexts[`ATOMIC_SUBRULE_SCOPE:${selected.ruleId}`].measurementBasisKey = "NOMINAL_OPENING";
        if (selected.entityKey === "route-A-door-1") selected.contexts.NORM_APPLICABILITY_VERIFIED = {
          reference: "Independent norm applicability restored for this exact door",
          applicable: true, parameterCode: "AR-042", attribute: "EVACUATION_DOOR_CLEAR_HEIGHT", threshold: "1.9", canonicalUnit: "m" };
      }
      await save(source, nominal);
    }
    const nominal = await run(setup, 0, "EGRESS_HEIGHT");
    expect(rows(nominal.read).some(row => row.qualified)).toBe(false);
    expect(rows(nominal.read).filter(row => row.entityKey !== null).every(row =>
      row.reasonCode === `CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:${row.ruleId}`)).toBe(true);
    for (const snapshot of snapshots) expect(await frozen(snapshot.checkId)).toEqual(snapshot.frozen);
  });

  it("persists separate tread and riser norm/basis bindings without rewriting previous runs", async () => {
    const setup = await fixture(), baseline = await run(setup, 0, "STAIR_DIMENSIONS");
    const snapshots = [{ checkId: baseline.checkId, frozen: await frozen(baseline.checkId) }];
    const originTargets = await targets(baseline.checkId, setup.actor);
    const bindings = new Map<string, MatrixFactScope["bindings"]>(), reviewHashes = new Map<string, string>();
    const rules = matrixRegistry.entries.find(entry => entry.parameterCode === "AR-048")!.atomicRules;
    const rows = (read: MatrixExecutionRead) => read.execution.results.filter(row => row.parameterCode === "AR-048");
    expect(rows(baseline.read).every(row => !row.qualified)).toBe(true);
    expect(baseline.read.execution.observations.every(fact => fact.entityKey === null)).toBe(true);
    async function save(source: Source, selected: MatrixFactScope["bindings"]) {
      const input: SourceReviewInput = { ...review(setup, source,
        { schemaVersion: "matrix-fact-scopes-v1", bindings: selected }, reviewHashes.get(source.id) ?? null), sectionCode: "AR" };
      const result = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(result.kind, JSON.stringify(result)).toBe("success");
      if (result.kind !== "success") throw new Error("Stair source review missing");
      reviewHashes.set(source.id, result.value.contentHash); bindings.set(source.id, structuredClone(selected));
    }
    for (const source of setup.files) {
      const selected = baseline.read.execution.observations.filter(fact => fact.sourceFileId === source.id).map(fact => {
        const rule = rules.find(rule => rule.attribute === fact.attribute)!;
        const riser = fact.attribute === "STAIR_RISER_HEIGHT";
        return { ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: "AR-048",
          entityKey: riser ? "route-A-riser-1" : "route-A-tread-1",
          reference: "Controlled original finished-step row and exact route component verified",
          target: originTargets.items.find(item => item.target.observationId === fact.id)!.target,
          contexts: {
            NORM_APPLICABILITY_VERIFIED: { reference: "Controlled independent applicability review for this route component",
              applicable: true, parameterCode: "AR-048", attribute: fact.attribute,
              threshold: (rule.threshold as { value: string }).value, canonicalUnit: "mm" },
            STAIR_FLIGHT_STEP_IDENTITY: { reference: "Controlled same evacuation route on floor one verified" },
            [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`]: {
              reference: "Finished floor to free opening head or lowest obstruction measured independently",
              parameterCode: "AR-048", attribute: fact.attribute, canonicalUnit: "mm",
              componentRole: (rule.subruleContext as { componentRole: string }).componentRole, componentKey: riser ? "riser-1" : "tread-1",
              zoneKey: "floor-1-route-A", operatingModeKey: "EVACUATION",
              measurementBasisKey: riser ? "FINISHED_VERTICAL_RISER_HEIGHT" : "FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH",
            },
          } };
      });
      expect(selected).toHaveLength(2); await save(source, selected);
    }
    const qualified = await run(setup, 0, "STAIR_DIMENSIONS");
    expect(rows(qualified.read).filter(row => row.qualified)).toHaveLength(2);
    expect(rows(qualified.read).filter(row => row.qualified).every(row => row.machineStatus === "CANDIDATE")).toBe(true);
    expect(qualified.read.execution.coverage.find(row => row.parameterCode === "AR-048"))
      .toMatchObject({ executionStatus: "PARTIAL", implementedAtomicRules: 2 });
    expect(qualified.read.presentation.every(row => row.confidence.calibratedProbability === null)).toBe(true);
    snapshots.push({ checkId: qualified.checkId, frozen: await frozen(qualified.checkId) });
    const rd = setup.files.find(source => source.stage === "RD")!;
    const withoutRiserNorm = structuredClone(bindings.get(rd.id)!);
    const riser = withoutRiserNorm.find(binding => binding.entityKey === "route-A-riser-1")!;
    delete riser.contexts.NORM_APPLICABILITY_VERIFIED;
    await save(rd, withoutRiserNorm);
    const partlyReviewed = await run(setup, 0, "STAIR_DIMENSIONS");
    expect(rows(partlyReviewed.read).filter(row => row.qualified)).toHaveLength(1);
    expect(rows(partlyReviewed.read).find(row => row.entityKey === "route-A-tread-1")).toMatchObject({ qualified: true });
    expect(rows(partlyReviewed.read).find(row => row.entityKey === "route-A-riser-1")).toMatchObject({
      qualified: false, reasonCode: "CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED" });
    snapshots.push({ checkId: partlyReviewed.checkId, frozen: await frozen(partlyReviewed.checkId) });
    // Equal, but incorrect, measurement bases on both sides must not become a matched proof.
    for (const source of setup.files) {
      const nominal = structuredClone(bindings.get(source.id)!);
      for (const selected of nominal) {
        selected.contexts[`ATOMIC_SUBRULE_SCOPE:${selected.ruleId}`].measurementBasisKey = "NOMINAL_STEP";
        if (selected.entityKey === "route-A-riser-1") selected.contexts.NORM_APPLICABILITY_VERIFIED = {
          reference: "Independent norm applicability restored for this exact riser",
          applicable: true, parameterCode: "AR-048", attribute: "STAIR_RISER_HEIGHT", threshold: "150", canonicalUnit: "mm" };
      }
      await save(source, nominal);
    }
    const nominal = await run(setup, 0, "STAIR_DIMENSIONS");
    expect(rows(nominal.read).some(row => row.qualified)).toBe(false);
    expect(rows(nominal.read).filter(row => row.entityKey !== null).every(row =>
      row.reasonCode === `CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:${row.ruleId}`)).toBe(true);
    for (const snapshot of snapshots) expect(await frozen(snapshot.checkId)).toEqual(snapshot.frozen);
  });

  it("persists territory fence type, segment and ground basis independently across immutable runs", async () => {
    const setup = await fixture(), baseline = await run(setup, 0, "FENCE_HEIGHT");
    const snapshots = [{ checkId: baseline.checkId, frozen: await frozen(baseline.checkId) }];
    const originTargets = await targets(baseline.checkId, setup.actor, 2);
    const selectedBySource = new Map<string, MatrixFactScope["bindings"]>(), hashes = new Map<string, string>();
    const rule = matrixRegistry.entries.find(entry => entry.parameterCode === "SPZU-036")!.atomicRules[0];
    const key = `ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`;
    const row = (read: MatrixExecutionRead) => read.execution.results.find(item => item.ruleId === rule.ruleId && item.entityKey === "boundary-A")!;
    expect(baseline.read.execution.results.filter(item => item.parameterCode === "SPZU-036").every(item => !item.qualified)).toBe(true);
    async function save(source: Source, selected: MatrixFactScope["bindings"]) {
      const input: SourceReviewInput = { ...review(setup, source,
        { schemaVersion: "matrix-fact-scopes-v1", bindings: selected }, hashes.get(source.id) ?? null), sectionCode: "GP" };
      const result = await repository.recordSourceReviewCommand(setup.objectId, source.id, input, command(setup.actor));
      expect(result.kind, JSON.stringify(result)).toBe("success");
      if (result.kind !== "success") throw new Error("Fence review missing");
      hashes.set(source.id, result.value.contentHash); selectedBySource.set(source.id, structuredClone(selected));
    }
    for (const source of setup.files) {
      const fact = baseline.read.execution.observations.find(item => item.sourceFileId === source.id)!;
      await save(source, [{ ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: "SPZU-036", entityKey: "boundary-A",
        reference: "Controlled same territory fence segment checked against original sources",
        target: originTargets.items.find(item => item.target.observationId === fact.id)!.target,
        contexts: {
          APPROVED_CHANGE_STATUS: { reference: "Controlled change register reviewed for this segment", approvedChangePresent: false },
          FENCE_TYPE_IDENTITY: { reference: "Controlled same fence type and protective function checked independently" },
          ZONE_IDENTITY: { reference: "Controlled same site boundary and segment limits checked" },
          [key]: { reference: "Controlled finished-ground to top measurement for this physical segment",
            parameterCode: "SPZU-036", attribute: "TERRITORY_FENCE_HEIGHT", canonicalUnit: "m", componentRole: "TERRITORY_FENCE_SEGMENT",
            componentKey: "segment-A", zoneKey: "site-boundary-A", operatingModeKey: "TERRITORY_BOUNDARY", measurementBasisKey: "FINISHED_GROUND_TO_FENCE_TOP" },
        } }]);
    }
    const qualified = await run(setup, 0, "FENCE_HEIGHT");
    expect(row(qualified.read)).toMatchObject({ qualified: true, machineStatus: "CANDIDATE", expectedValue: "2.5", actualValue: "2.4", delta: "-0.1" });
    expect(qualified.read.execution.coverage.find(item => item.parameterCode === "SPZU-036"))
      .toMatchObject({ executionStatus: "PARTIAL", implementedAtomicRules: 1 });
    expect(qualified.read.presentation.every(item => item.confidence.calibratedProbability === null)).toBe(true);
    snapshots.push({ checkId: qualified.checkId, frozen: await frozen(qualified.checkId) });
    const rd = setup.files.find(source => source.stage === "RD")!, complete = structuredClone(selectedBySource.get(rd.id)!);
    const missingType = structuredClone(complete); delete missingType[0].contexts.FENCE_TYPE_IDENTITY;
    await save(rd, missingType);
    const withdrawn = await run(setup, 0, "FENCE_HEIGHT");
    expect(row(withdrawn.read)).toMatchObject({ qualified: false, reasonCode: "CONTEXT_UNVERIFIED:FENCE_TYPE_IDENTITY" });
    snapshots.push({ checkId: withdrawn.checkId, frozen: await frozen(withdrawn.checkId) });
    await save(rd, complete);
    const restored = await run(setup, 0, "FENCE_HEIGHT"); expect(row(restored.read).qualified).toBe(true);
    snapshots.push({ checkId: restored.checkId, frozen: await frozen(restored.checkId) });
    for (const source of setup.files) {
      const nominal = structuredClone(selectedBySource.get(source.id)!);
      nominal[0].contexts[key].measurementBasisKey = "NOMINAL_PANEL_HEIGHT"; await save(source, nominal);
    }
    const nominal = await run(setup, 0, "FENCE_HEIGHT");
    expect(row(nominal.read)).toMatchObject({ qualified: false, reasonCode: `CONTEXT_UNVERIFIED:${key}` });
    for (const snapshot of snapshots) expect(await frozen(snapshot.checkId)).toEqual(snapshot.frozen);
  });

  it("rejects foreign source/object, mutated evidence/execution and unknown rule without appending reviews", async () => {
    const setup = await fixture();
    const baseline = await run(setup);
    const originTargets = await targets(baseline.checkId, setup.actor);
    const foreign = await fixture();
    const foreignBaseline = await run(foreign);
    const foreignTargets = await targets(foreignBaseline.checkId, foreign.actor);
    const source = setup.files[0];
    const correctTarget = originTargets.items.find(item => item.sourceFileId === source.id)!.target;
    const correct = review(setup, source, { schemaVersion: "matrix-fact-scopes-v1", bindings: [binding(correctTarget)] });
    const cases: Array<[string, (input: SourceReviewInput) => void]> = [
      ["MATRIX_FACT_TARGET_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].target = foreignTargets.items[0].target; }],
      ["MATRIX_FACT_TARGET_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].target = originTargets.items.find(item => item.sourceFileId !== source.id)!.target; }],
      ...(["executionContentHash", "observationId", "evidenceHash", "textArtifactHash"] as const).map(field =>
        ["MATRIX_FACT_TARGET_MISMATCH", (input: SourceReviewInput) => { (input.matrixScope as MatrixFactScope).bindings[0].target[field] = "f".repeat(64); }] as [string, (input: SourceReviewInput) => void]),
      ["SOURCE_HASH_MISMATCH", input => { input.sourceSha256 = "f".repeat(64); }],
      ["MATRIX_FACT_RULE_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].ruleId = "foreign-rule"; }],
      ["MATRIX_FACT_RULE_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].ruleVersion = "999"; }],
      ["MATRIX_FACT_RULE_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].contexts.UNRELATED_CONTEXT = { reference: "Unrelated context must never become a proof" }; }],
      ["MATRIX_FACT_TARGET_MISMATCH", input => { (input.matrixScope as MatrixFactScope).bindings[0].tableContextReview = { fragmentsHash: "f".repeat(64), reference: "Invented context review has no matching fragments" }; }],
      ["SOURCE_REVIEW_STALE", input => { delete input.expectedReviewHash; }],
      ["SOURCE_REVIEW_STALE", input => { input.expectedReviewHash = "e".repeat(64); }],
    ];
    for (const [code, mutate] of cases) {
      const invalid = structuredClone(correct);
      mutate(invalid);
      const result = await repository.recordSourceReviewCommand(setup.objectId, source.id, invalid, command(setup.actor));
      expect(result, code).toMatchObject({ kind: "invalid_state", code });
    }
    expect(await repository.getSourceReview(setup.objectId, source.id, setup.actor)).toBeUndefined();
    expect((await database.query(`SELECT count(*)::int AS count FROM source_review_decisions review
      JOIN source_files source ON source.id=review.source_file_id WHERE source.api_id=$1`, [source.id])).rows[0].count).toBe(0);
  });

  it("serializes competing CAS decisions and replays the winner without a second append", async () => {
    const setup = await fixture();
    const source = setup.files[0];
    const empty: MatrixFactScope = { schemaVersion: "matrix-fact-scopes-v1", bindings: [] };
    const first = review(setup, source, empty);
    const second = { ...structuredClone(first), basis: { reference: "Independent competing reviewer command on the same original state" } };
    const commands = [command(setup.actor), command(setup.actor)];
    const inputs = [first, second];
    const outcomes = await Promise.all(inputs.map((input, index) => repository.recordSourceReviewCommand(
      setup.objectId, source.id, input, commands[index])));
    expect(outcomes.filter(outcome => outcome.kind === "success")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.kind === "invalid_state")).toEqual([
      expect.objectContaining({ code: "SOURCE_REVIEW_STALE" }),
    ]);
    const winnerIndex = outcomes.findIndex(outcome => outcome.kind === "success");
    const winner = outcomes[winnerIndex];
    if (winner.kind !== "success") throw new Error("CAS winner missing");
    const replay = await repository.recordSourceReviewCommand(setup.objectId, source.id,
      inputs[winnerIndex], commands[winnerIndex]);
    expect(replay).toMatchObject({ kind: "success", replayed: true, value: { id: winner.value.id, contentHash: winner.value.contentHash } });
    const reused = await repository.recordSourceReviewCommand(setup.objectId, source.id,
      { ...inputs[winnerIndex], expectedReviewHash: winner.value.contentHash }, commands[winnerIndex]);
    expect(reused.kind).toBe("idempotency_conflict");
    expect((await database.query(`SELECT count(*)::int AS count FROM source_review_decisions review
      JOIN source_files source ON source.id=review.source_file_id WHERE source.api_id=$1`, [source.id])).rows[0].count).toBe(1);
    const changed = await repository.recordSourceReviewCommand(setup.objectId, source.id,
      { ...first, expectedReviewHash: winner.value.contentHash, basis: { reference: "Explicit next decision based on the current review content hash" } }, command(setup.actor));
    expect(changed.kind).toBe("success");
    const stale = await repository.recordSourceReviewCommand(setup.objectId, source.id,
      { ...first, expectedReviewHash: winner.value.contentHash }, command(setup.actor));
    expect(stale).toMatchObject({ kind: "invalid_state", code: "SOURCE_REVIEW_STALE" });
  });
});
