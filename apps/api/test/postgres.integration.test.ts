import { pythonExecutable, pythonEnv } from "./python.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Finding, ProtocolExport, ProtocolVersion } from "@inspector-ai/contracts";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { PostgresIdentityService, type AuthenticatedActor } from "../src/identity.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { pilotFactFamilyRules } from "../src/pilot-rules.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { OutboxRelay } from "../src/outbox-relay.js";
import { visualProposalProfile, visualProposalProfileId, v5VisualProposalConfigHash,
  v5VisualProposalProfileId, v6VisualProposalConfigHash, v6VisualProposalProfileId } from "../src/visual-proposal.js";
import { boundedOcrProfile, boundedOcrProfileId, boundedOcrConfigHash,
  boundedOcrProfileIdV2, boundedOcrConfigHashV2, boundedOcrProfileV2,
  boundedOcrProfileIdV3, boundedOcrConfigHashV3, boundedOcrProfileV3 } from "../src/ocr-layout.js";
import { boundedOcrProfileIdV5, boundedOcrConfigHashV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const databaseSuite = adminUrl ? describe : describe.skip;
const TEXT_QUALITY_POLICY_VERSION = "text-layer-quality-v2";

function emptyFactFamily(objectId: string, inputManifestHash: string) {
  const comparisons = pilotFactFamilyRules.map((rule) => {
    const comparison = {
      schemaVersion: "fact-comparison-result-v1", ruleId: rule.ruleId,
      ruleVersion: rule.version, objectId, parameterCode: rule.parameterCode,
      attribute: rule.attribute, expectedStage: rule.expectedStage, actualStage: rule.actualStage,
      canonicalUnit: rule.canonicalUnit, status: "ABSTAIN",
      reasonCodes: ["REQUIRED_FACT_MISSING"], expectedFactId: null, actualFactId: null,
      normalizedExpected: null, normalizedActual: null, comparison: null,
    };
    return { ...comparison, contentHash: sha256(canonicalJson(comparison)) };
  });
  const result = { schemaVersion: "fact-family-proposals-v1", inputManifestHash, objectId,
    facts: [], comparisons, outputCount: comparisons.length, findingCount: 0 };
  return { ...result, contentHash: sha256(canonicalJson(result)) };
}

function pythonFactFamilyFixture(objectId: string, manifestHash: string,
  sources: Array<Record<string, unknown>>, reviewedEntityLinks: unknown[] = []) {
  const script = `import json, sys
from inspector_worker.fact_family_pipeline import evaluate_fact_family_bundle
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
data = json.load(sys.stdin)
sources = [{key: value for key, value in source.items() if key != "text"} for source in data["sources"]]
artifacts = []
for source in data["sources"]:
    text = source["text"]
    artifacts.append({"schemaVersion": "document-text-v2", "sourceFileId": source["sourceFileId"],
        "inputSha256": source["sha256"], "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
        "pageCount": 1, "textPageCount": 1, "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
        "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
        "pages": [{"pageNumber": 1, "widthMilliPoints": 600000, "heightMilliPoints": 800000,
            "blocks": [{"text": text, "bboxMilliPoints": [1000, 1000, 300000, 3000]}],
            "quality": qualify_page_text([text])}]})
family = evaluate_fact_family_bundle(data["objectId"], data["manifestHash"],
                                     sources, artifacts,
                                     reviewed_entity_links=data["reviewedEntityLinks"])
json.dump({"artifacts": artifacts, "family": family}, sys.stdout, ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const child = spawnSync(pythonExecutable, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, sources, reviewedEntityLinks }),
    encoding: "utf8", env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Python fact-family fixture failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as { artifacts: Array<Record<string, unknown>>;
    family: Record<string, any> };
}
function pythonCandidatePreviewFixture(objectId: string, manifestHash: string,
  sourceFileId: string, sourceSha256: string, withObservations = false) {
  const script = `import json, sys
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.text_layer import TEXT_QUALITY_POLICY_VERSION, qualify_page_text
data = json.load(sys.stdin)
source = {"sourceFileId": data["sourceFileId"], "sha256": data["sourceSha256"],
  "objectId": data["objectId"], "stages": ["RD"], "sectionCode": "AR",
  "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "pageStages": {}}
text = 'Общая площадь здания: 42 м²'
artifact = {"schemaVersion": "document-text-v2", "sourceFileId": data["sourceFileId"],
  "inputSha256": data["sourceSha256"], "coordinateSystem": "PDF_BOTTOM_LEFT_MILLI_POINTS",
  "pageCount": 1, "textPageCount": 1, "qualityPolicyVersion": TEXT_QUALITY_POLICY_VERSION,
  "qualitySummary": {"textLayerCandidatePageCount": 1, "ocrRequiredPageCount": 0},
  "pages": [{"pageNumber": 1, "widthMilliPoints": 595000, "heightMilliPoints": 842000,
    "blocks": [{"bboxMilliPoints": [10000, 20000, 300000, 40000], "text": text}],
    "quality": qualify_page_text([text])}]}
preview = evaluate_run_candidate_family_preview(data["objectId"], data["manifestHash"],
                                                [source], [artifact])
observations = extract_candidate_family_observations(preview, [source], [artifact]) if data["withObservations"] else None
json.dump({"artifact": artifact, "preview": preview, "observations": observations}, sys.stdout, ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const child = spawnSync(pythonExecutable, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, sourceFileId, sourceSha256, withObservations }),
    encoding: "utf8", env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Python candidate fixture failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as { artifact: Record<string, unknown>;
    preview: Record<string, any>; observations: Record<string, any> | null };
}
function pythonCandidateOcrObservationsFixture(objectId: string, manifestHash: string,
  sourceFileId: string, sourceSha256: string, artifact: Record<string, unknown>,
  ocrStage: Record<string, unknown>): Record<string, unknown> {
  const script = `import json, sys
from inspector_worker.candidate_family_ocr_observations import evaluate_run_candidate_family_ocr_observations
data = json.load(sys.stdin)
source = {"sourceFileId": data["sourceFileId"], "sha256": data["sourceSha256"],
  "objectId": data["objectId"], "stages": ["RD"], "sectionCode": "AR",
  "revisionStatus": "CURRENT", "approvalStatus": "APPROVED", "pageStages": {}}
json.dump(evaluate_run_candidate_family_ocr_observations(
  data["objectId"], data["manifestHash"], [source], [data["artifact"]],
  data["ocrStage"]), sys.stdout, ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const child = spawnSync(pythonExecutable, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, sourceFileId, sourceSha256,
      artifact, ocrStage }),
    encoding: "utf8", env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Python candidate OCR fixture failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as Record<string, unknown>;
}
function pythonOcrTableRowsFixture(ocrStage: Record<string, unknown>,
  profile: "v1" | "v2" | "v3" = "v1"): Record<string, unknown> {
  const script = `import json, sys
from inspector_worker.ocr_table_rows import extract_ocr_table_rows, PROFILE_ID_V2, PROFILE_ID_V3
from inspector_worker.ocr_pilot import canonical_hash
payload = json.load(sys.stdin)
stage = payload["stage"]
kwargs = ({"profile_id": PROFILE_ID_V3} if payload["profile"] == "v3" else
          {"profile_id": PROFILE_ID_V2} if payload["profile"] == "v2" else {})
json.dump(extract_ocr_table_rows(stage, stage_sha256=canonical_hash(stage), **kwargs),
          sys.stdout, ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const child = spawnSync(pythonExecutable, ["-c", script], {
    input: JSON.stringify({ stage: ocrStage, profile }), encoding: "utf8",
    env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Python OCR table fixture failed: ${child.stderr}`);
  return JSON.parse(child.stdout) as Record<string, unknown>;
}
function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sessionCookies(response: { headers: Record<string, string | string[] | number | undefined> }): {
  cookie: string;
  csrf: string;
} {
  const values = response.headers["set-cookie"];
  const cookies = (Array.isArray(values) ? values : typeof values === "string" ? [values] : [])
    .map((value) => value.split(";", 1)[0]);
  const csrfCookie = cookies.find((value) => value.startsWith("inspector_csrf="));
  if (!csrfCookie) throw new Error("Login response did not set the CSRF cookie");
  return {
    cookie: cookies.join("; "),
    csrf: decodeURIComponent(csrfCookie.slice("inspector_csrf=".length)),
  };
}

const scaffoldStageContracts = {
  DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
  DOCUMENT_OCR_LAYOUT: ["PROVIDER_NOT_CONFIGURED", "OCR_LAYOUT_PROFILE_NOT_SELECTED", "OCR_LAYOUT"],
  DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
  DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
  ENTITY_EXTRACTION: [
    "PROVIDER_NOT_CONFIGURED",
    "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED",
    "ENTITY_EXTRACTION_MODEL",
  ],
  RULE_EVALUATION: ["UNSUPPORTED_RULESET", "EXECUTABLE_RULES_NOT_CONFIGURED", "RULE_ENGINE"],
  EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
} as const;

function visualProposalResult(lease: Record<string, any>, proposalCount = 1): Record<string, unknown> {
  const sources = (lease.inputs.sourceFiles as Array<Record<string, string>>)
    .filter((source) => source.mediaType === "application/pdf")
    .sort((left, right) => left.sourceFileId.localeCompare(right.sourceFileId))
    .map((source, index) => ({
      sourceFileId: source.sourceFileId,
      sourceSha256: source.sha256,
      pageCount: 1,
      scannedPageCount: 1,
      scannedPageNumbers: [1],
      skippedPageCount: 0,
      documentContext: {
        schemaVersion: "document-context-v1",
        methodId: "first-two-pdf-cover-text-pages-v1",
        status: "UNKNOWN",
        reasonCode: "NO_TITLE_KEYWORD_MATCH",
        inspectedPages: [{ pageNumber: 1, textSha256: "c".repeat(64), titleWindow: null }],
      },
      status: "SCANNED",
      proposals: index === 0 && proposalCount > 0 ? [{
        pageNumber: 1, bboxNormalized: [0.1, 0.2, 0.3, 0.4],
        status: "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED",
      }] : [],
      proposalLimitReached: false,
      unretainedProposalCount: 0,
    }));
  return {
    schemaVersion: "analysis-stage-result-v2", jobType: "ENTITY_EXTRACTION",
    inputManifestHash: lease.inputManifestHash,
    disposition: "VISUAL_PROPOSAL_SCAN", reasonCode: "PROPOSAL_ONLY_UNVERIFIED",
    providerKind: "ENTITY_EXTRACTION_MODEL",
    providerProfileId: lease.release.providerSlot.profileId,
    providerConfigHash: lease.release.providerSlot.configHash,
    outputCount: proposalCount,
    analysis: {
      schemaVersion: "visual-proposal-analysis-v4",
      objectId: lease.objectId, inputManifestHash: lease.inputManifestHash,
      profile: visualProposalProfile, sources,
    },
  };
}

async function completeScaffoldStages(
  app: FastifyInstance,
  database: Pool,
  runId: string,
  workerToken: string,
  textArtifactProbe?: { sourceFileId: string; inputSha256: string; artifact: Record<string, unknown> },
): Promise<string[]> {
  const completedJobIds: string[] = [];
  for (const [jobType, contract] of Object.entries(scaffoldStageContracts)) {
    const job = await database.query<{ id: string; state: string }>(
      `SELECT id, state FROM analysis_jobs WHERE run_id = $1 AND job_type = $2`,
      [runId, jobType],
    );
    if (jobType === "DOCUMENT_OCR_LAYOUT" && job.rows.length === 0) continue;
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0].state, jobType).toBe("READY");

    const claim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${job.rows[0].id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: `integration-${jobType.toLowerCase()}`, capabilities: [jobType] },
    });
    expect(claim.statusCode, jobType).toBe(200);
    expect(claim.json().status, jobType).toBe("ACQUIRED");
    const [disposition, reasonCode, providerKind] = contract;
    expect(claim.json().lease.release).toMatchObject({
      lifecycle: "SCAFFOLD",
      externalNetworkAllowed: false,
      providerSlot: {
        stageJobType: jobType,
        providerKind,
        status: "UNCONFIGURED",
        profileId: null,
        adapterVersion: null,
        artifactHash: null,
        configHash: null,
        licenseId: null,
        resourceProfile: null,
      },
    });
    if (jobType === "DOCUMENT_RENDER" && textArtifactProbe) {
      const { sourceFileId, inputSha256, artifact } = textArtifactProbe;
      const attemptId = claim.json().lease.attemptId as string;
      const fencingToken = claim.json().lease.fencingToken as number;
      const artifactUrl = `/api/internal/v1/jobs/${job.rows[0].id}/text-artifacts/${sourceFileId}`;
      const query = `?attemptId=${attemptId}&fencingToken=${fencingToken}`;
      expect((await app.inject({ method: "GET", url: `${artifactUrl}${query}` })).statusCode).toBe(401);
      const downloaded = await app.inject({
        method: "GET",
        url: `${artifactUrl}${query}`,
        headers: { "x-worker-token": workerToken },
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["x-input-sha256"]).toBe(inputSha256);
      expect(downloaded.headers["x-content-sha256"]).toBe(sha256(canonicalJson(artifact)));
      expect(downloaded.headers["x-artifact-schema-version"]).toBe("document-text-v2");
      expect(downloaded.rawPayload).toEqual(Buffer.from(canonicalJson(artifact)));
      expect((await app.inject({
        method: "GET",
        url: `${artifactUrl}?attemptId=${attemptId}&fencingToken=${fencingToken + 1}`,
        headers: { "x-worker-token": workerToken },
      })).statusCode).toBe(409);
      expect((await app.inject({
        method: "GET",
        url: `/api/internal/v1/jobs/${job.rows[0].id}/text-artifacts/not-in-manifest${query}`,
        headers: { "x-worker-token": workerToken },
      })).statusCode).toBe(404);
    }
    const result = {
      schemaVersion: "analysis-stage-result-v1",
      jobType,
      inputManifestHash: claim.json().lease.inputManifestHash,
      disposition,
      reasonCode,
      providerKind,
      providerProfileId: null,
      providerConfigHash: null,
      outputCount: 0,
    };
    if (jobType === "DOCUMENT_RENDER") {
      const forgedComplete = await app.inject({
        method: "POST",
        url: `/api/internal/v1/jobs/${job.rows[0].id}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: {
          attemptId: claim.json().lease.attemptId,
          fencingToken: claim.json().lease.fencingToken,
          result: { ...result, outputCount: 1 },
        },
      });
      expect(forgedComplete.statusCode).toBe(409);
      expect(forgedComplete.json().error).toBe("INVALID_JOB_RESULT");
    }
    const complete = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${job.rows[0].id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: claim.json().lease.attemptId,
        fencingToken: claim.json().lease.fencingToken,
        result,
      },
    });
    expect(complete.statusCode, jobType).toBe(200);
    if (jobType === "DOCUMENT_RENDER" && textArtifactProbe) {
      expect((await app.inject({
        method: "GET",
        url: `/api/internal/v1/jobs/${job.rows[0].id}/text-artifacts/${textArtifactProbe.sourceFileId}`
          + `?attemptId=${claim.json().lease.attemptId}&fencingToken=${claim.json().lease.fencingToken}`,
        headers: { "x-worker-token": workerToken },
      })).statusCode).toBe(409);
    }
    expect(complete.json()).toMatchObject({ status: "COMPLETED", check: { status: "PROCESSING" } });
    const artifact = await database.query<{
      content_hash: string;
      output_count: number;
      content_json: Record<string, unknown>;
    }>(
      `SELECT content_hash, output_count, content_json
       FROM analysis_stage_artifacts
       WHERE job_id = $1`,
      [job.rows[0].id],
    );
    expect(artifact.rows).toHaveLength(1);
    expect(artifact.rows[0].content_hash.trim()).toBe(sha256(canonicalJson(result)));
    expect(artifact.rows[0].output_count).toBe(0);
    expect(artifact.rows[0].content_json).toEqual(result);
    completedJobIds.push(job.rows[0].id);
  }
  return completedJobIds;
}

databaseSuite("PostgreSQL repository", { timeout: 30_000 }, () => {
  const databaseName = `inspector_it_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let connectionString: string;
  let openRepositories: PostgresInspectionRepository[] = [];
  let openPools: Pool[] = [];
  let openApps: FastifyInstance[] = [];

  beforeAll(async () => {
    if (!adminUrl) return;
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    connectionString = url.toString();
    const firstRun = await runDatabaseMigrations(connectionString);
    expect(firstRun.applied).toEqual([
      "001_initial.sql",
      "002_domain_core.sql",
      "003_identity_scope_audit.sql",
      "004_protocol_revocations.sql",
      "005_protocol_canonical_artifacts.sql",
      "006_durable_jobs_outbox.sql",
      "007_job_attempt_cancellation.sql",
      "008_analysis_job_dag.sql",
      "009_document_text_layer.sql",
      "010_document_text_quality.sql",
      "011_analysis_pipeline_scaffold.sql",
      "012_analysis_release_manifests.sql",
      "013_pilot_rule_results.sql",
      "014_source_review_snapshots.sql",
      "015_visual_proposal_stage.sql",
      "016_visual_proposal_reviews.sql",
      "017_bounded_ocr_layout_stage.sql",
      "018_source_review_section_code.sql",
      "019_fact_entity_link_reviews.sql",
      "020_ocr_row_transcription_reviews.sql",
      "021_run_ocr_transcription_snapshots.sql",
      "022_source_review_working_sections.sql",
      "023_ocr_row_applicability_reviews.sql",
      "024_run_ocr_applicability_snapshots.sql",
      "025_run_ocr_typed_fact_candidate_artifacts.sql",
      "026_ocr_fact_pair_reviews.sql",
      "027_run_ocr_fact_pair_snapshots.sql",
      "028_ocr_fact_pair_quantity_reviews.sql",
      "029_review_candidate_decisions.sql",
    ]);
    expect(firstRun.backfilledArtifacts).toBe(0);
    const secondRun = await runDatabaseMigrations(connectionString);
    expect(secondRun.skipped).toHaveLength(29);
    expect(secondRun.backfilledArtifacts).toBe(0);
  }, 30_000);

  afterAll(async () => {
    if (!adminUrl) return;
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await admin.end();
  });

  afterEach(async () => {
    await Promise.allSettled(openApps.map((app) => app.close()));
    await Promise.allSettled(openPools.map((pool) => pool.end()));
    await Promise.allSettled(openRepositories.map((repository) => repository.close()));
    openApps = [];
    openPools = [];
    openRepositories = [];
  });

  it("opens concurrent passwordless workspace sessions with existing and new objects", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `open-workspace-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
    });
    openRepositories.push(repository);
    const existing = await repository.createObject({ name: "Existing public test", address: "Москва" });
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, identityService: identity, openWorkspace: true });
    openApps.push(app);

    const admissions = await Promise.all([
      app.inject({ method: "POST", url: "/api/auth/open-workspace" }),
      app.inject({ method: "POST", url: "/api/auth/open-workspace" }),
    ]);
    expect(admissions.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(admissions[0].json().user.id).toBe(admissions[1].json().user.id);
    const sessionCookies = admissions.map((response) =>
      (response.headers["set-cookie"] as string[]).find((item) => item.startsWith("inspector_session="))!);
    expect(sessionCookies[0]).not.toBe(sessionCookies[1]);
    for (const response of admissions) {
      const cookie = (response.headers["set-cookie"] as string[])
        .map((item) => item.split(";", 1)[0]).join("; ");
      const resolved = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.json().user.id).toBe(response.json().user.id);
    }
    const admitted = admissions[0];
    const cookies = (admitted.headers["set-cookie"] as string[]).map((item) => item.split(";", 1)[0]);
    const csrf = cookies.find((item) => item.startsWith("inspector_csrf="))?.split("=", 2)[1];
    expect(csrf).toBeTruthy();
    const session = await app.inject({ method: "GET", url: "/api/auth/session",
      headers: { cookie: cookies.join("; ") } });
    expect(session.statusCode).toBe(200);
    const listed = await app.inject({ method: "GET", url: "/api/objects",
      headers: { cookie: cookies.join("; ") } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.some((item: { id: string }) => item.id === existing.id)).toBe(true);

    const created = await app.inject({ method: "POST", url: "/api/objects",
      headers: { cookie: cookies.join("; "), "x-csrf-token": csrf!,
        "idempotency-key": randomUUID() },
      payload: { name: "New public test", address: "Москва" } });
    expect(created.statusCode).toBe(201);
    const visible = await app.inject({ method: "GET", url: `/api/objects/${created.json().id}`,
      headers: { cookie: cookies.join("; ") } });
    expect(visible.statusCode).toBe(200);
  });

  it("pins a human fact link to reviewed sources and reuses it only through the next run snapshot", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `fact-link-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 2 });
    openPools.push(database);
    const previousOcr = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
    const previousHeat = process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
    const previousFactFamily = process.env.INSPECTOR_FACT_FAMILY_PROFILE;
    try {
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v3";
      process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = "v1";
      process.env.INSPECTOR_FACT_FAMILY_PROFILE = "v1";
      const object = await repository.createObject({ name: "Fact link review", address: "Москва" });
      const files = [
        { id: `FIL-${randomUUID()}`, name: "project.pdf", size: 43,
          stage: "PD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
          scanStatus: "CLEAN" as const, status: "STORED" as const,
          storageKey: `objects/${object.id}/project.pdf` },
        { id: `FIL-${randomUUID()}`, name: "actual.pdf", size: 43,
          stage: "RD" as const, mimeType: "application/pdf", sha256: "b".repeat(64),
          scanStatus: "CLEAN" as const, status: "STORED" as const,
          storageKey: `objects/${object.id}/actual.pdf` },
      ];
      await repository.registerIngestedFiles(object.id, files);
      const password = "Fact-Link-Review-2026!";
      const reviewer = await provisionLocalUser(database, {
        organizationSlug, login: `fact-link-reviewer-${randomUUID()}`,
        displayName: "Fact Link Reviewer", password, role: "INSPECTOR",
        capabilities: ["SOURCE_REVIEW", "REVIEW_DECIDE"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE", "RUN"],
      });
      const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
      const app = await buildApp({ repository, identityService: identity });
      openApps.push(app);
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reviewer.login, password } });
      expect(login.statusCode).toBe(200);
      const session = sessionCookies(login);
      const headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
      for (const [index, file] of files.entries()) {
        const review = await app.inject({ method: "POST",
          url: `/api/objects/${object.id}/files/${file.id}/source-review`,
          headers: { ...headers, "idempotency-key": `source-${randomUUID()}` },
          payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
            approvalStatus: "APPROVED", linkGroupId: "building-1",
            sectionCode: index === 0 ? "PZ" : "AR", pageStages: {},
            basis: { reference: "Исходник и редакция проверены инспектором" } },
        });
        expect(review.statusCode).toBe(201);
      }
      const first = await repository.startCheck(object.id);
      expect(first).toBeDefined();
      const runScope = async (checkId: string) => {
        const result = await database.query<{
          run_id: string; object_id: string; manifest_hash: string;
          release_content: Record<string, any>;
        }>(
          `SELECT run.id AS run_id, run.object_id, manifest.sha256 AS manifest_hash,
                  release.content_json AS release_content
           FROM analysis_runs run
           JOIN input_manifests manifest ON manifest.id = run.manifest_id
           JOIN analysis_releases release ON release.release_id = run.release_id
           WHERE run.api_id = $1`, [checkId],
        );
        return result.rows[0];
      };
      const firstScope = await runScope(first!.id);
      const sourceDefs = files.map((file, index) => ({
        sourceFileId: file.id, objectId: firstScope.object_id, sha256: file.sha256,
        stages: [file.stage], sectionCode: index === 0 ? "PZ" : "AR",
        revisionStatus: "CURRENT", approvalStatus: "APPROVED",
        linkGroupId: "building-1", pageStages: {},
        text: index === 0 ? "Строительный объем здания 60000 м3\nЭтажность 3+подвал"
          : "Строительный объем здания 61000 м3\nЭтажность 4+подвал",
      }));
      const seedReadArtifact = async (checkId: string,
        fixture: ReturnType<typeof pythonFactFamilyFixture>) => {
        const scope = await runScope(checkId);
        const jobs = await database.query<{ id: string; job_type: string }>(
          `SELECT job.id, job.job_type FROM analysis_jobs job WHERE job.run_id = $1
             AND job.job_type IN ('DOCUMENT_TEXT_LAYER', 'RULE_EVALUATION')`, [scope.run_id],
        );
        const textJob = jobs.rows.find((job) => job.job_type === "DOCUMENT_TEXT_LAYER")!;
        const ruleJob = jobs.rows.find((job) => job.job_type === "RULE_EVALUATION")!;
        for (const artifact of fixture.artifacts) {
          const source = await database.query<{ id: string }>(
            `SELECT id FROM source_files WHERE api_id = $1`, [artifact.sourceFileId],
          );
          const canonical = canonicalJson(artifact);
          await database.query(
            `INSERT INTO analysis_text_artifacts (
               id, job_id, run_id, source_file_id, schema_version, input_sha256,
               content_hash, byte_size, page_count, text_page_count, content_json
             ) VALUES ($1, $2, $3, $4, 'document-text-v2', $5, $6, $7, 1, 1, $8::jsonb)`,
            [randomUUID(), textJob.id, scope.run_id, source.rows[0].id,
              artifact.inputSha256, sha256(canonical), Buffer.byteLength(canonical, "utf8"), canonical],
          );
        }
        const ruleSlot = scope.release_content.providerSlots.find(
          (slot: Record<string, unknown>) => slot.stageJobType === "RULE_EVALUATION");
        const stage = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
          inputManifestHash: scope.manifest_hash.trim(), disposition: "RULES_EVALUATED",
          providerKind: "RULE_ENGINE", providerProfileId: ruleSlot.profileId,
          providerConfigHash: ruleSlot.configHash, outputCount: 4,
          ocrHeatRows: { schemaVersion: "ocr-heat-row-proposals-v1",
            profileId: "conservative-ocr-heat-rows-v1",
            inputManifestHash: scope.manifest_hash.trim(), proposals: [], abstentions: [], findingCount: 0 },
          factFamily: fixture.family };
        const canonical = canonicalJson(stage);
        await database.query(`UPDATE analysis_jobs SET state = 'SUCCEEDED' WHERE id = $1`, [ruleJob.id]);
        await database.query(
          `INSERT INTO analysis_stage_artifacts (
             id, job_id, run_id, job_type, schema_version, disposition, reason_code,
             provider_kind, provider_profile_id, provider_config_hash, output_count,
             input_manifest_hash, content_hash, byte_size, content_json
           ) VALUES ($1, $2, $3, 'RULE_EVALUATION', 'analysis-stage-result-v2',
             'RULES_EVALUATED', 'FACT_FAMILY_REVIEW_AID', 'RULE_ENGINE', $4, $5, 4,
             $6, $7, $8, $9::jsonb)`,
          [randomUUID(), ruleJob.id, scope.run_id, ruleSlot.profileId, ruleSlot.configHash,
            scope.manifest_hash.trim(), sha256(canonical), Buffer.byteLength(canonical, "utf8"), canonical],
        );
        await database.query(
          `UPDATE analysis_runs SET run_state = 'PARTIAL', display_status = 'PARTIAL'
           WHERE id = $1`, [scope.run_id],
        );
      };
      const firstFixture = pythonFactFamilyFixture(firstScope.object_id,
        firstScope.manifest_hash.trim(), sourceDefs);
      const pd = firstFixture.family.facts.find((fact: Record<string, unknown>) =>
        fact.parameterCode === "PZ-004" && fact.stage === "PD");
      const rd = firstFixture.family.facts.find((fact: Record<string, unknown>) =>
        fact.parameterCode === "PZ-004" && fact.stage === "RD");
      expect(pd).toBeDefined();
      expect(rd).toBeDefined();
      expect(firstFixture.family.comparisons.find((item: Record<string, unknown>) =>
        item.parameterCode === "PZ-004")).toMatchObject({
        status: "ABSTAIN", reasonCodes: ["ENTITY_LINK_MISSING"],
      });
      await seedReadArtifact(first!.id, firstFixture);
      const proposed = await app.inject({ method: "GET",
        url: `/api/checks/${first!.id}/pilot-results`, headers });
      expect(proposed.statusCode).toBe(200);
      expect(proposed.json().factFamily.facts.length).toBeGreaterThanOrEqual(2);
      const body = { factFamilyContentHash: firstFixture.family.contentHash,
        pdFactId: pd.factId, actualFactId: rd.factId,
        basis: { reference: "Один объект по проверенной ведомости объёмов" } };
      const idempotencyKey = `fact-link-${randomUUID()}`;
      const post = await app.inject({ method: "POST", url: `/api/checks/${first!.id}/fact-links`,
        headers: { ...headers, "idempotency-key": idempotencyKey }, payload: body });
      expect(post.statusCode, post.body).toBe(201);
      const saved = post.json();
      expect(saved.link).toMatchObject({ pdFactId: pd.factId,
        actualFactId: rd.factId, basis: body.basis });
      const replay = await app.inject({ method: "POST", url: `/api/checks/${first!.id}/fact-links`,
        headers: { ...headers, "idempotency-key": idempotencyKey }, payload: body });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      const listed = await app.inject({ method: "GET",
        url: `/api/checks/${first!.id}/fact-links`, headers });
      expect(listed.json()).toMatchObject({ canReview: true, canRun: true,
        items: [expect.objectContaining({ id: saved.id,
          link: expect.objectContaining({ pdFactId: pd.factId, actualFactId: rd.factId,
            basis: body.basis, evidence: expect.arrayContaining([
              expect.objectContaining({ factId: pd.factId, sourceFileId: files[0].id }),
              expect.objectContaining({ factId: rd.factId, sourceFileId: files[1].id }),
            ]) }) })] });
      const second = await repository.startCheck(object.id);
      expect(second).toBeDefined();
      expect(second!.id).not.toBe(first!.id);
      const secondScope = await runScope(second!.id);
      const snapshots = await database.query<{ decision_id: string; decision_hash: string }>(
        `SELECT decision_id, decision_hash FROM run_fact_entity_link_snapshots WHERE run_id = $1`,
        [secondScope.run_id],
      );
      expect(snapshots.rows).toHaveLength(1);
      expect(snapshots.rows[0]).toMatchObject({ decision_id: saved.id,
        decision_hash: saved.contentHash });
      const changedReview = await app.inject({ method: "POST",
        url: `/api/objects/${object.id}/files/${files[1].id}/source-review`,
        headers: { ...headers, "idempotency-key": `source-${randomUUID()}` },
        payload: { sourceSha256: files[1].sha256, revisionStatus: "UNKNOWN",
          approvalStatus: "UNKNOWN", linkGroupId: null, sectionCode: null,
          pageStages: {}, basis: { reference: "После запуска ожидается повторная проверка" } },
      });
      expect(changedReview.statusCode).toBe(201);
      const ruleJob = await database.query<{ id: string }>(
        `SELECT id FROM analysis_jobs WHERE run_id = $1 AND job_type = 'RULE_EVALUATION'`,
        [secondScope.run_id],
      );
      await database.query(`UPDATE analysis_jobs SET state = 'READY' WHERE id = $1`,
        [ruleJob.rows[0].id]);
      const claim = await repository.claimJob(ruleJob.rows[0].id,
        { workerId: "fact-link-test", capabilities: ["RULE_EVALUATION"] });
      expect(claim.kind).toBe("acquired");
      if (claim.kind !== "acquired") throw new Error("Expected fact-family lease");
      expect(claim.lease.inputs.reviewedEntityLinks).toEqual([{
        schemaVersion: "reviewed-fact-entity-link-v1", link: saved.link,
        actorId: saved.actorId, contentHash: saved.contentHash,
        decisionHash: saved.contentHash,
      }]);
      expect(claim.lease.inputs.sourceDecisions[files[1].id]).toMatchObject({
        revisionStatus: "CURRENT", approvalStatus: "APPROVED", sectionCode: "AR",
      });
      const secondFixture = pythonFactFamilyFixture(secondScope.object_id,
        secondScope.manifest_hash.trim(), sourceDefs, claim.lease.inputs.reviewedEntityLinks);
      expect(secondFixture.family.comparisons.find((item: Record<string, unknown>) =>
        item.parameterCode === "PZ-004")).toMatchObject({ status: "REVIEW_REQUIRED" });
      await seedReadArtifact(second!.id, secondFixture);
      const verifiedRead = await app.inject({ method: "GET",
        url: `/api/checks/${second!.id}/pilot-results`, headers });
      expect(verifiedRead.statusCode, verifiedRead.body).toBe(200);
      expect(verifiedRead.json().factFamily.comparisons.find(
        (item: Record<string, unknown>) => item.parameterCode === "PZ-004"))
        .toMatchObject({ status: "REVIEW_REQUIRED" });
      await expect(database.query(
        `UPDATE fact_entity_link_decisions SET content_hash = $2 WHERE id = $1`,
        [saved.id, "0".repeat(64)],
      )).rejects.toThrow();
    } finally {
      if (previousOcr === undefined) delete process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
      else process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = previousOcr;
      if (previousHeat === undefined) delete process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
      else process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = previousHeat;
      if (previousFactFamily === undefined) delete process.env.INSPECTOR_FACT_FAMILY_PROFILE;
      else process.env.INSPECTOR_FACT_FAMILY_PROFILE = previousFactFamily;
    }
  }, 60_000);

  it("persists a release-pinned PZ-017 abstention without a finding", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `heat-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const workerToken = `worker-${randomUUID()}`;
    const object = await repository.createObject({ name: "Heat pilot", address: "Москва" });
    const password = "Heat-Pilot-Read-2026!";
    const reader = await provisionLocalUser(database, {
      organizationSlug, login: `heat-reader-${randomUUID()}`, displayName: "Heat Reader",
      password, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
      objectPermissions: ["READ"],
    });
    const denied = await provisionLocalUser(database, {
      organizationSlug, login: `heat-denied-${randomUUID()}`, displayName: "Heat Denied",
      password, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
      objectPermissions: ["UPLOAD"],
    });
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, workerToken, identityService: identity });
    openApps.push(app);
    const login = async (user: { login: string }) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: user.login, password } });
      expect(response.statusCode).toBe(200);
      return sessionCookies(response).cookie;
    };
    const readerCookie = await login(reader);
    const deniedCookie = await login(denied);
    const file = { id: `FIL-${randomUUID()}`, name: "heat.pdf", size: 43,
      stage: "PD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
      scanStatus: "CLEAN" as const, status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/heat.pdf` };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const check = await repository.startCheck(object.id);
    expect(check).toBeDefined();
    const resultsUrl = `/api/checks/${check!.id}/pilot-results`;
    expect((await app.inject({ method: "GET", url: resultsUrl })).statusCode).toBe(401);
    const deniedRead = await app.inject({ method: "GET", url: resultsUrl,
      headers: { cookie: deniedCookie } });
    expect(deniedRead.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/checks/CHK-missing/pilot-results",
      headers: { cookie: readerCookie } })).statusCode).toBe(404);
    const beforeSeal = await app.inject({ method: "GET", url: resultsUrl,
      headers: { cookie: readerCookie } });
    expect(beforeSeal.statusCode).toBe(200);
    expect(beforeSeal.json()).toEqual({ checkId: check!.id, status: "PROCESSING", items: [],
      ocrHeatRows: null });
    const jobs = await database.query<{ id: string; job_type: string; run_id: string }>(
      `SELECT id, job_type, run_id FROM analysis_jobs
       WHERE run_id = (SELECT id FROM analysis_runs WHERE api_id = $1)`, [check!.id],
    );
    const jobId = (type: string) => jobs.rows.find((row) => row.job_type === type)!.id;
    const claim = async (type: string) => {
      const response = await app.inject({ method: "POST", url: `/api/internal/v1/jobs/${jobId(type)}/claim`,
        headers: { "x-worker-token": workerToken },
        payload: { workerId: "heat-integration", capabilities: [type] } });
      expect(response.statusCode, type).toBe(200);
      expect(response.json().status, type).toBe("ACQUIRED");
      return response.json().lease;
    };
    const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) => {
      const response = await app.inject({ method: "POST", url: `/api/internal/v1/jobs/${jobId(type)}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      expect(response.statusCode, type).toBe(200);
      return response;
    };
    const inventory = await claim("ANALYSIS_INVENTORY");
    await complete("ANALYSIS_INVENTORY", inventory, {
      disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 },
    });
    const textLease = await claim("DOCUMENT_TEXT_LAYER");
    const content = "Проектная документация";
    const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
      inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, textPageCount: 1, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
      qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
      pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: content }],
        quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
          blockCount: 1, nonWhitespaceCharacterCount: 21, alphanumericCharacterCount: 21,
          replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
        } } }],
    };
    await complete("DOCUMENT_TEXT_LAYER", textLease, {
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
        status: "EXTRACTED", artifact: textArtifact }],
    });
    for (const [type, contract] of Object.entries(scaffoldStageContracts)) {
      if (["DOCUMENT_OCR_LAYOUT", "RULE_EVALUATION", "EVIDENCE_VALIDATION"].includes(type)) continue;
      const lease = await claim(type);
      if (type === "ENTITY_EXTRACTION") {
        await complete(type, lease, visualProposalResult(lease, 0));
      } else {
        const [disposition, reasonCode, providerKind] = contract;
        await complete(type, lease, { schemaVersion: "analysis-stage-result-v1", jobType: type,
          inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0 });
      }
    }
    const rulesLease = await claim("RULE_EVALUATION");
    expect(rulesLease.release).toMatchObject({ providerSlot: { profileId: "typed-pz002-pz017-v1" },
      rules: { definitions: { heat: { parameterCode: "PZ-017" } } } });
    const heatLoad = { schemaVersion: "pz-017-analysis-v1", objectId: rulesLease.objectId,
      selectedManifestHash: rulesLease.inputManifestHash, selectedFileIds: [file.id],
      extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
      scannedPages: { PD: 1, RD: 0 }, ocrRequiredPageCount: 0,
      comparison: { schemaVersion: "pz-017-component-comparison-v1", parameterCode: "PZ-017",
        disposition: "ABSTAIN", reasonCode: "MISSING_COMPONENT_EVIDENCE", totalComparable: false, finding: null },
      evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
        ruleVersion: "1", parameterCode: "PZ-017", objectId: rulesLease.objectId,
        executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
        reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null },
    };
    const result = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
      inputManifestHash: rulesLease.inputManifestHash, disposition: "RULES_EVALUATED",
      providerKind: "RULE_ENGINE", providerProfileId: "typed-pz002-pz017-v1",
      providerConfigHash: rulesLease.release.providerSlot.configHash, outputCount: 2,
      analysis: { schemaVersion: "pz-002-analysis-v1", objectId: rulesLease.objectId,
        selectedManifestHash: rulesLease.inputManifestHash, selectedFileIds: [file.id],
        route: { schemaVersion: "parameter-route-v1", stages: [] }, extractedFacts: [], ocrArtifacts: [],
        evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-002-area",
          ruleVersion: "1", parameterCode: "PZ-002", objectId: rulesLease.objectId,
          executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
          reasonCode: "MISSING_RD", evidence: [] } },
      heatLoad,
    };
    const forged = await app.inject({ method: "POST",
      url: `/api/internal/v1/jobs/${jobId("RULE_EVALUATION")}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: { attemptId: rulesLease.attemptId, fencingToken: rulesLease.fencingToken,
        result: { ...result, heatLoad: { ...heatLoad, scannedPages: { PD: 2, RD: 0 } } } } });
    expect(forged.statusCode).toBe(409);
    expect(forged.json().error).toBe("INVALID_JOB_RESULT");
    await complete("RULE_EVALUATION", rulesLease, result);
    const stage = await database.query<{ content_hash: string; output_count: number }>(
      "SELECT content_hash, output_count FROM analysis_stage_artifacts WHERE job_id = $1",
      [jobId("RULE_EVALUATION")],
    );
    expect(stage.rows).toMatchObject([{ content_hash: sha256(canonicalJson(result)), output_count: 2 }]);
    const evidenceLease = await claim("EVIDENCE_VALIDATION");
    const [disposition, reasonCode, providerKind] = scaffoldStageContracts.EVIDENCE_VALIDATION;
    await complete("EVIDENCE_VALIDATION", evidenceLease, { schemaVersion: "analysis-stage-result-v1",
      jobType: "EVIDENCE_VALIDATION", inputManifestHash: evidenceLease.inputManifestHash,
      disposition, reasonCode, providerKind, providerProfileId: null, providerConfigHash: null, outputCount: 0 });
    const sealLease = await claim("ANALYSIS_SEAL_UNSUPPORTED");
    const sealed = await complete("ANALYSIS_SEAL_UNSUPPORTED", sealLease,
      { disposition: "UNSUPPORTED_COVERAGE_SEALED" });
    expect(sealed.json()).toMatchObject({ status: "COMPLETED", check: { status: "PARTIAL",
      stats: { unsupported: 130 } } });
    const coverage = await database.query<{ parameter_code: string; execution_rollup: string }>(
      `SELECT parameter_code, execution_rollup FROM parameter_coverage WHERE run_id = $1
       AND parameter_code IN ('PZ-002','PZ-017') ORDER BY parameter_code`, [jobs.rows[0].run_id]);
    expect(coverage.rows).toEqual([{ parameter_code: "PZ-002", execution_rollup: "PARTIAL" },
      { parameter_code: "PZ-017", execution_rollup: "PARTIAL" }]);
    const heatResult = await database.query<{ machine_status: string; result_payload: Record<string, unknown> }>(
      "SELECT machine_status, result_payload FROM rule_results WHERE run_id = $1 AND parameter_code = 'PZ-017'",
      [jobs.rows[0].run_id]);
    expect(heatResult.rows).toMatchObject([{ machine_status: "MISSING_EVIDENCE", result_payload: heatLoad }]);
    const pilotRead = await app.inject({ method: "GET", url: resultsUrl,
      headers: { cookie: readerCookie } });
    expect(pilotRead.statusCode).toBe(200);
    expect(pilotRead.headers["cache-control"]).toBe("private, no-store");
    expect(pilotRead.json()).toEqual({ checkId: check!.id, status: "READY", items: [
      { resultId: expect.any(String), parameterCode: "PZ-002", ruleKey: "pilot-pz-002-area",
        ruleVersion: "1", executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
        reasonCode: "MISSING_RD", comparison: null, facts: [] },
      { resultId: expect.any(String), parameterCode: "PZ-017", ruleKey: "pilot-pz-017-heat",
        ruleVersion: "1", executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
        reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT",
        comparison: { disposition: "ABSTAIN", reasonCode: "MISSING_COMPONENT_EVIDENCE" }, facts: [] },
    ], ocrHeatRows: null });
    expect(JSON.stringify(pilotRead.json())).not.toContain("selectedManifestHash");
    expect(await repository.getPilotResults(check!.id, {
      organizationId: randomUUID(), userId: reader.id,
    } as AuthenticatedActor)).toBeUndefined();
    expect((await database.query<{ count: string }>(
      "SELECT count(*) FROM review_items WHERE run_id = $1", [jobs.rows[0].run_id],
    )).rows[0].count).toBe("0");
    const replacement = await repository.reprocess(check!.id);
    expect(replacement?.id).not.toBe(check!.id);
    expect((await app.inject({ method: "GET", url: resultsUrl,
      headers: { cookie: readerCookie } })).statusCode).toBe(404);
    const activeRead = await app.inject({ method: "GET",
      url: `/api/checks/${replacement!.id}/pilot-results`, headers: { cookie: readerCookie } });
    expect(activeRead.json()).toEqual({ checkId: replacement!.id, status: "PROCESSING", items: [],
      ocrHeatRows: null });
  }, 30_000);

  it("persists only bounded OCR_REQUIRED pages with a fenced immutable result", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `bounded-ocr-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const workerToken = `worker-${randomUUID()}`;
    const object = await repository.createObject({ name: "Bounded OCR", address: "Москва" });
    const password = "Bounded-OCR-Read-2026!";
    const reader = await provisionLocalUser(database, {
      organizationSlug, login: `ocr-reader-${randomUUID()}`, displayName: "OCR Reader",
      password, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
      objectPermissions: ["READ"],
    });
    const denied = await provisionLocalUser(database, {
      organizationSlug, login: `ocr-denied-${randomUUID()}`, displayName: "OCR Denied",
      password, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
      objectPermissions: ["UPLOAD"],
    });
    const file = { id: `FIL-${randomUUID()}`, name: "scan.pdf", size: 43,
      stage: "PD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
      scanStatus: "CLEAN" as const, status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/scan.pdf` };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const check = await repository.startCheck(object.id);
    expect(check).toBeDefined();
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, workerToken, identityService: identity });
    openApps.push(app);
    const login = async (loginName: string) => {
      const response = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: loginName, password } });
      expect(response.statusCode).toBe(200);
      return sessionCookies(response).cookie;
    };
    const readerCookie = await login(reader.login);
    const deniedCookie = await login(denied.login);
    const jobId = async (type: string) => {
      const row = await database.query<{ id: string }>(
        `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
         WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type]);
      expect(row.rows, type).toHaveLength(1);
      return row.rows[0].id;
    };
    const claim = async (type: string) => {
      const response = await app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
        headers: { "x-worker-token": workerToken },
        payload: { workerId: "bounded-ocr-test", capabilities: [type] } });
      expect(response.statusCode, type).toBe(200);
      expect(response.json().status, type).toBe("ACQUIRED");
      return response.json().lease;
    };
    const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });

    const inventory = await claim("ANALYSIS_INVENTORY");
    expect((await complete("ANALYSIS_INVENTORY", inventory, {
      disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 },
    })).statusCode).toBe(200);
    const text = await claim("DOCUMENT_TEXT_LAYER");
    const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
      inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, textPageCount: 0, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
      qualitySummary: { textLayerCandidatePageCount: 0, ocrRequiredPageCount: 1 },
      pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        blocks: [], quality: { disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"],
          metrics: { blockCount: 0, nonWhitespaceCharacterCount: 0, alphanumericCharacterCount: 0,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0 } } }],
    };
    expect((await complete("DOCUMENT_TEXT_LAYER", text, {
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
        status: "EXTRACTED", artifact: textArtifact }],
    })).statusCode).toBe(200);
    const render = await claim("DOCUMENT_RENDER");
    expect((await complete("DOCUMENT_RENDER", render, {
      schemaVersion: "analysis-stage-result-v1", jobType: "DOCUMENT_RENDER",
      inputManifestHash: render.inputManifestHash,
      disposition: "PROVIDER_NOT_CONFIGURED", reasonCode: "RENDERER_PROFILE_NOT_SELECTED",
      providerKind: "RENDERER", providerProfileId: null, providerConfigHash: null, outputCount: 0,
    })).statusCode).toBe(200);
    const lease = await claim("DOCUMENT_OCR_LAYOUT");
    expect(lease.release.providerSlot).toMatchObject({ status: "CONFIGURED",
      profileId: boundedOcrProfileId, adapterVersion: "1", configHash: boundedOcrConfigHash });
    const page: Record<string, unknown> = {
      schemaVersion: "document-ocr-page-v1", sourceFileId: file.id,
      inputSha256: file.sha256, pageNumber: 1,
      render: { sha256: "b".repeat(64), widthPx: 1000, heightPx: 1000,
        dpi: 120, rendererProfileId: "pdfium-test" },
      provider: { profileId: "local-paddle-test", script: "eslav" },
      lines: [{ text: "Отопление", score: 0.98, bboxPx: [10, 20, 200, 50] }],
    };
    page.contentHash = sha256(canonicalJson(page));
    const stage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
      inputManifestHash: lease.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
      reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
      providerProfileId: boundedOcrProfileId, providerConfigHash: boundedOcrConfigHash,
      outputCount: 1, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v1",
        objectId: lease.objectId, inputManifestHash: lease.inputManifestHash,
        profile: boundedOcrProfile, sourceCount: 1, ocrRequiredPageCount: 1,
        processedPageCount: 1, deferredPageCount: 0,
        skippedOversizePageCount: 0, skippedUnsupportedSourceCount: 0,
        sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
          mediaType: "application/pdf", pageCount: 1, status: "SCANNED",
          ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
          pages: [page] }],
      },
    };
    const forged = await complete("DOCUMENT_OCR_LAYOUT", lease, { ...stage, finding: { severity: "HIGH" } });
    expect(forged.statusCode).toBe(409);
    expect(forged.json().error).toBe("INVALID_JOB_RESULT");
    const accepted = await complete("DOCUMENT_OCR_LAYOUT", lease, stage);
    expect(accepted.statusCode).toBe(200);
    const persisted = await database.query<{ content_hash: string; disposition: string; output_count: number }>(
      `SELECT content_hash, disposition, output_count FROM analysis_stage_artifacts WHERE job_id = $1`,
      [await jobId("DOCUMENT_OCR_LAYOUT")]);
    expect(persisted.rows).toMatchObject([{ content_hash: sha256(canonicalJson(stage)),
      disposition: "OCR_LAYOUT_BOUNDED", output_count: 1 }]);
    const layoutUrl = `/api/checks/${check!.id}/ocr-layout`;
    expect((await app.inject({ method: "GET", url: layoutUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: layoutUrl,
      headers: { cookie: deniedCookie } })).statusCode).toBe(404);
    const readable = await app.inject({ method: "GET", url: layoutUrl,
      headers: { cookie: readerCookie } });
    expect(readable.statusCode).toBe(200);
    expect(readable.headers["cache-control"]).toBe("private, no-store");
    expect(readable.json()).toMatchObject({
      status: "OCR_UNVERIFIED_BOUNDED", processedPageCount: 1,
      sources: [{ sourceFileId: file.id, pages: [{ pageNumber: 1, lineCount: 1 }] }],
    });
    expect(readable.body).not.toContain("Отопление");
    const pageUrl = `${layoutUrl}/pages/${file.id}/1`;
    expect((await app.inject({ method: "GET", url: pageUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: pageUrl,
      headers: { cookie: deniedCookie } })).statusCode).toBe(404);
    const pageRead = await app.inject({ method: "GET", url: pageUrl,
      headers: { cookie: readerCookie } });
    expect(pageRead.statusCode).toBe(200);
    expect(pageRead.json()).toMatchObject({
      status: "OCR_UNVERIFIED_BOUNDED", sourceFileId: file.id, pageNumber: 1,
      lines: [{ ordinal: 0, text: "Отопление", confidence: 0.98 }],
    });
    expect((await app.inject({ method: "GET", url: `${pageUrl}?offset=5001`,
      headers: { cookie: readerCookie } })).statusCode).toBe(400);
    expect((await complete("DOCUMENT_OCR_LAYOUT", lease, stage)).statusCode).toBe(200);
    expect((await database.query<{ count: string }>(
      `SELECT count(*) FROM analysis_stage_artifacts WHERE job_id = $1`,
      [await jobId("DOCUMENT_OCR_LAYOUT")])).rows[0].count).toBe("1");
    await expect(database.query(`UPDATE analysis_stage_artifacts SET output_count = 0 WHERE job_id = $1`,
      [await jobId("DOCUMENT_OCR_LAYOUT")])).rejects.toThrow(/append-only/i);
  });

  it("pins optional OCR v2 in a new release and rejects unknown selection", async () => {
    const reference = await loadReferenceData();
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters,
      organizationSlug: `ocr-v2-${randomUUID()}`,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const object = await repository.createObject({ name: "OCR v2 release", address: "Москва" });
    const file = { id: `FIL-${randomUUID()}`, name: "v2.pdf", size: 43,
      stage: "PD" as const, mimeType: "application/pdf", sha256: "d".repeat(64),
      scanStatus: "CLEAN" as const, status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"d".repeat(64)}/v2.pdf` };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const original = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
    try {
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "invalid";
      await expect(repository.startCheck(object.id)).rejects.toThrow(
        /INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE/);
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v2";
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const release = await database.query<{ content_json: Record<string, any> }>(
        `SELECT release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id]);
      expect(release.rows).toHaveLength(1);
      const slot = release.rows[0].content_json.providerSlots.find(
        (candidate: Record<string, unknown>) => candidate.stageJobType === "DOCUMENT_OCR_LAYOUT");
      expect(slot).toMatchObject({ profileId: boundedOcrProfileIdV2,
        adapterVersion: "2", configHash: boundedOcrConfigHashV2 });
      const workerToken = `worker-${randomUUID()}`;
      const app = await buildApp({ repository, workerToken });
      openApps.push(app);
      const jobId = async (type: string) => {
        const row = await database.query<{ id: string }>(
          `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
           WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type]);
        expect(row.rows).toHaveLength(1);
        return row.rows[0].id;
      };
      const claim = async (type: string) => {
        const response = await app.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "ocr-v2-test", capabilities: [type] } });
        expect(response.statusCode, type).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) =>
        app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const inventory = await claim("ANALYSIS_INVENTORY");
      expect((await complete("ANALYSIS_INVENTORY", inventory, {
        disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 },
      })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 0, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        qualitySummary: { textLayerCandidatePageCount: 0, ocrRequiredPageCount: 1 },
        pages: [{ pageNumber: 1, widthMilliPoints: 1_200_000, heightMilliPoints: 800_000,
          blocks: [], quality: { disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"],
            metrics: { blockCount: 0, nonWhitespaceCharacterCount: 0, alphanumericCharacterCount: 0,
              replacementCharacterCount: 0, disallowedControlCharacterCount: 0 } } }],
      };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, {
        disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
          status: "EXTRACTED", artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      expect((await complete("DOCUMENT_RENDER", render, {
        schemaVersion: "analysis-stage-result-v1", jobType: "DOCUMENT_RENDER",
        inputManifestHash: render.inputManifestHash, disposition: "PROVIDER_NOT_CONFIGURED",
        reasonCode: "RENDERER_PROFILE_NOT_SELECTED", providerKind: "RENDERER",
        providerProfileId: null, providerConfigHash: null, outputCount: 0,
      })).statusCode).toBe(200);
      const ocr = await claim("DOCUMENT_OCR_LAYOUT");
      expect(ocr.release.providerSlot).toMatchObject({ profileId: boundedOcrProfileIdV2,
        adapterVersion: "2", configHash: boundedOcrConfigHashV2 });
      const page: Record<string, unknown> = {
        schemaVersion: "document-ocr-page-v1", sourceFileId: file.id,
        inputSha256: file.sha256, pageNumber: 1,
        render: { sha256: "b".repeat(64), widthPx: 2000, heightPx: 1334,
          dpi: 120, rendererProfileId: boundedOcrProfileV2.rendererProfileId },
        provider: { profileId: boundedOcrProfileV2.ocrProviderProfileIds[0], script: "eslav" }, lines: [],
      };
      page.contentHash = sha256(canonicalJson(page));
      const stage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: boundedOcrProfileIdV2, providerConfigHash: boundedOcrConfigHashV2,
        outputCount: 1, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v2",
          objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
          profile: boundedOcrProfileV2, sourceCount: 1, ocrRequiredPageCount: 1,
          processedPageCount: 1, deferredPageCount: 0,
          skippedOversizePageCount: 0, skippedUnsupportedSourceCount: 0,
          skippedRenderPixelPageCount: 0,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 1, status: "SCANNED",
            ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
            skippedRenderPixelPageCount: 0, pages: [page] }],
        },
      };
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, stage)).statusCode).toBe(200);
      const persisted = await database.query<{ content_hash: string; output_count: number }>(
        `SELECT content_hash, output_count FROM analysis_stage_artifacts WHERE job_id = $1`,
        [await jobId("DOCUMENT_OCR_LAYOUT")]);
      expect(persisted.rows).toMatchObject([{ content_hash: sha256(canonicalJson(stage)), output_count: 1 }]);
    } finally {
      if (original === undefined) delete process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
      else process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = original;
    }
  });

  it("pins OCR v3 and accepts only the committed heating-context pages", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `ocr-v3-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const object = await repository.createObject({ name: "OCR v3 release", address: "Москва" });
    const readerPassword = "OCR-v3-read-2026!";
    const reader = await provisionLocalUser(database, {
      organizationSlug, login: `ocr-v3-reader-${randomUUID()}`, displayName: "OCR v3 Reader",
      password: readerPassword, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
      objectPermissions: ["READ"],
    });
    const file = { id: `FIL-${randomUUID()}`, name: "heating.pdf", size: 43,
      stage: "RD" as const, mimeType: "application/pdf", sha256: "e".repeat(64),
      scanStatus: "CLEAN" as const, status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"e".repeat(64)}/heating.pdf` };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const previous = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
    try {
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v3";
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const release = await database.query<{ content_json: Record<string, any> }>(
        `SELECT release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id]);
      const slot = release.rows[0].content_json.providerSlots.find(
        (candidate: Record<string, unknown>) => candidate.stageJobType === "DOCUMENT_OCR_LAYOUT");
      expect(slot).toMatchObject({ profileId: boundedOcrProfileIdV3,
        adapterVersion: "3", configHash: boundedOcrConfigHashV3 });
      const workerToken = `worker-${randomUUID()}`;
      const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
      const app = await buildApp({ repository, workerToken, identityService: identity });
      openApps.push(app);
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reader.login, password: readerPassword } });
      expect(login.statusCode).toBe(200);
      const readerCookie = sessionCookies(login).cookie;
      const jobId = async (type: string) => {
        const row = await database.query<{ id: string }>(
          `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
           WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type]);
        expect(row.rows).toHaveLength(1);
        return row.rows[0].id;
      };
      const claim = async (type: string) => {
        const response = await app.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "ocr-v3-test", capabilities: [type] } });
        expect(response.statusCode, type).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) =>
        app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const inventory = await claim("ANALYSIS_INVENTORY");
      expect((await complete("ANALYSIS_INVENTORY", inventory, {
        disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 0, RD: 1, ID: 0 },
      })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const candidate = (number: number, content: string) => ({
        pageNumber: number, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        blocks: [{ bboxMilliPoints: [10_000, 20_000, 500_000, 40_000], text: content }],
        quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
          blockCount: 1, nonWhitespaceCharacterCount: [...content].filter((ch) => !/\s/u.test(ch)).length,
          alphanumericCharacterCount: [...content].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length,
          replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
        } },
      });
      const required = (number: number) => ({ pageNumber: number,
        widthMilliPoints: 595_000, heightMilliPoints: 842_000, blocks: [],
        quality: { disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"], metrics: {
          blockCount: 0, nonWhitespaceCharacterCount: 0, alphanumericCharacterCount: 0,
          replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
        } },
      });
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 4, textPageCount: 2, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        qualitySummary: { textLayerCandidatePageCount: 2, ocrRequiredPageCount: 2 },
        pages: [candidate(1, "Разрешение. Обозначение АНО/1-РД-ОВ1"), required(2), required(3),
          candidate(4, "Основные показатели по рабочим чертежам марки ОВ. Тепловой поток на отопление")],
      };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, {
        disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
          status: "EXTRACTED", artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      expect((await complete("DOCUMENT_RENDER", render, {
        schemaVersion: "analysis-stage-result-v1", jobType: "DOCUMENT_RENDER",
        inputManifestHash: render.inputManifestHash, disposition: "PROVIDER_NOT_CONFIGURED",
        reasonCode: "RENDERER_PROFILE_NOT_SELECTED", providerKind: "RENDERER",
        providerProfileId: null, providerConfigHash: null, outputCount: 0,
      })).statusCode).toBe(200);
      const ocr = await claim("DOCUMENT_OCR_LAYOUT");
      expect(ocr.release.providerSlot).toMatchObject({ profileId: boundedOcrProfileIdV3,
        adapterVersion: "3", configHash: boundedOcrConfigHashV3 });
      const page = (number: number) => {
        const value: Record<string, unknown> = { schemaVersion: "document-ocr-page-v1",
          sourceFileId: file.id, inputSha256: file.sha256, pageNumber: number,
          render: { sha256: "b".repeat(64), widthPx: 992, heightPx: 1404,
            dpi: 120, rendererProfileId: boundedOcrProfileV3.rendererProfileId },
          provider: { profileId: boundedOcrProfileV3.ocrProviderProfileIds[0], script: "eslav" },
          lines: [],
        };
        value.contentHash = sha256(canonicalJson(value));
        return value;
      };
      const stage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: boundedOcrProfileIdV3, providerConfigHash: boundedOcrConfigHashV3,
        outputCount: 2, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v3",
          objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
          profile: boundedOcrProfileV3, sourceCount: 1, ocrRequiredPageCount: 2,
          processedPageCount: 2, deferredPageCount: 0, skippedOversizePageCount: 0,
          skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
          subjectCandidatePageCount: 2,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 4, status: "SCANNED",
            ocrRequiredPageCount: 2, processedPageCount: 2, deferredPageCount: 0,
            skippedRenderPixelPageCount: 0, subjectCandidatePageCount: 2,
            pages: [page(2), page(3)] }],
        },
      };
      const forged = structuredClone(stage);
      forged.analysis.sources[0].pages.reverse();
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, forged)).statusCode).toBe(409);
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, stage)).statusCode).toBe(200);
      const persisted = await database.query<{ content_hash: string; output_count: number }>(
        `SELECT content_hash, output_count FROM analysis_stage_artifacts WHERE job_id = $1`,
        [await jobId("DOCUMENT_OCR_LAYOUT")]);
      expect(persisted.rows).toMatchObject([{ content_hash: sha256(canonicalJson(stage)), output_count: 2 }]);
      const readable = await app.inject({ method: "GET", url: `/api/checks/${check!.id}/ocr-layout`,
        headers: { cookie: readerCookie } });
      expect(readable.statusCode).toBe(200);
      expect(readable.json()).toMatchObject({ status: "OCR_UNVERIFIED_BOUNDED",
        schemaVersion: "bounded-ocr-layout-analysis-v3", providerProfileId: boundedOcrProfileIdV3,
        processedPageCount: 2, sources: [{ pages: [{ pageNumber: 2 }, { pageNumber: 3 }] }] });
      expect((await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/ocr-layout/pages/${file.id}/2`,
        headers: { cookie: readerCookie } })).statusCode).toBe(200);

      // Continue through the real DAG before granting a rule worker access to the immutable OCR stage.
      for (const type of ["DOCUMENT_METADATA", "DOCUMENT_LINKING"] as const) {
        const lease = await claim(type);
        const [disposition, reasonCode, providerKind] = scaffoldStageContracts[type];
        expect((await complete(type, lease, {
          schemaVersion: "analysis-stage-result-v1", jobType: type,
          inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0,
        })).statusCode).toBe(200);
      }
      const entity = await claim("ENTITY_EXTRACTION");
      const visual = visualProposalResult(entity, 0) as Record<string, any>;
      const visualSource = visual.analysis.sources[0];
      visualSource.pageCount = 4;
      visualSource.scannedPageCount = 4;
      visualSource.scannedPageNumbers = [1, 2, 3, 4];
      visualSource.documentContext.inspectedPages.push({
        pageNumber: 2, textSha256: "c".repeat(64), titleWindow: null,
      });
      expect((await complete("ENTITY_EXTRACTION", entity, visual)).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      const ocrArtifactUrl = `/api/internal/v1/jobs/${await jobId("RULE_EVALUATION")}/ocr-layout-artifact`;
      const query = `?attemptId=${rules.attemptId}&fencingToken=${rules.fencingToken}`;
      expect((await app.inject({ method: "GET", url: `${ocrArtifactUrl}${query}` })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: ocrArtifactUrl,
        headers: { "x-worker-token": workerToken } })).statusCode).toBe(400);
      const downloaded = await app.inject({ method: "GET", url: `${ocrArtifactUrl}${query}`,
        headers: { "x-worker-token": workerToken } });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.rawPayload).toEqual(Buffer.from(canonicalJson(stage), "utf8"));
      expect(downloaded.headers["x-content-sha256"]).toBe(sha256(canonicalJson(stage)));
      expect(downloaded.headers["x-input-manifest-sha256"]).toBe(ocr.inputManifestHash);
      expect(downloaded.headers["x-artifact-schema-version"]).toBe("bounded-ocr-layout-analysis-v3");
      expect(downloaded.headers["x-provider-profile-id"]).toBe(boundedOcrProfileIdV3);
      expect(downloaded.headers["x-provider-config-sha256"]).toBe(boundedOcrConfigHashV3);
      expect(Number(downloaded.headers["content-length"])).toBe(Buffer.byteLength(canonicalJson(stage)));
      expect(downloaded.headers["cache-control"]).toBe("private, no-store");
      expect((await app.inject({ method: "GET",
        url: `${ocrArtifactUrl}?attemptId=${rules.attemptId}&fencingToken=${rules.fencingToken + 1}`,
        headers: { "x-worker-token": workerToken } })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET",
        url: `${ocrArtifactUrl}?attemptId=${ocr.attemptId}&fencingToken=${rules.fencingToken}`,
        headers: { "x-worker-token": workerToken } })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET",
        url: `/api/internal/v1/jobs/${await jobId("DOCUMENT_OCR_LAYOUT")}/ocr-layout-artifact${query}`,
        headers: { "x-worker-token": workerToken } })).statusCode).toBe(404);

      // A different active run with a valid rule lease cannot resolve this run's OCR stage.
      const otherObject = await repository.createObject({ name: "Other OCR run", address: "Москва" });
      const otherFile = { ...file, id: `FIL-${randomUUID()}`,
        storageKey: `objects/${otherObject.id}/originals/${file.sha256}/heating.pdf` };
      expect(await repository.registerIngestedFiles(otherObject.id, [otherFile])).toBeDefined();
      const otherCheck = await repository.startCheck(otherObject.id);
      expect(otherCheck).toBeDefined();
      const otherRule = await database.query<{ id: string }>(
        `UPDATE analysis_jobs job SET state = 'READY'
         FROM analysis_runs run WHERE job.run_id = run.id AND run.api_id = $1
           AND job.job_type = 'RULE_EVALUATION' RETURNING job.id`, [otherCheck!.id]);
      expect(otherRule.rows).toHaveLength(1);
      const otherClaim = await app.inject({ method: "POST",
        url: `/api/internal/v1/jobs/${otherRule.rows[0].id}/claim`,
        headers: { "x-worker-token": workerToken },
        payload: { workerId: "ocr-v3-other-run", capabilities: ["RULE_EVALUATION"] } });
      expect(otherClaim.statusCode).toBe(200);
      const otherLease = otherClaim.json().lease;
      expect((await app.inject({ method: "GET",
        url: `/api/internal/v1/jobs/${otherRule.rows[0].id}/ocr-layout-artifact`
          + `?attemptId=${otherLease.attemptId}&fencingToken=${otherLease.fencingToken}`,
        headers: { "x-worker-token": workerToken } })).statusCode).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
      else process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = previous;
    }
  });

  it.each([
    { factProfile: "", previewProfile: "", observationsProfile: "", ocrCandidateProfile: "", tableProfile: "" },
    { factProfile: "v1", previewProfile: "", observationsProfile: "", ocrCandidateProfile: "", tableProfile: "" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "", ocrCandidateProfile: "", tableProfile: "" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "v1", ocrCandidateProfile: "", tableProfile: "" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "v1", ocrCandidateProfile: "v1", tableProfile: "" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "v1", ocrCandidateProfile: "v1", tableProfile: "v1" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "v1", ocrCandidateProfile: "v1", tableProfile: "v2" },
    { factProfile: "v1", previewProfile: "v1", observationsProfile: "v1", ocrCandidateProfile: "v1", tableProfile: "v3" },
  ])("pins OCR heat, fact family, candidate preview and observations $factProfile/$previewProfile/$observationsProfile/$ocrCandidateProfile/$tableProfile", async (
    { factProfile, previewProfile, observationsProfile, ocrCandidateProfile, tableProfile },
  ) => {
    const reference = await loadReferenceData();
    const organizationSlug = `ocr-heat-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const previousOcr = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
    const previousHeat = process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
    const previousFactFamily = process.env.INSPECTOR_FACT_FAMILY_PROFILE;
    const previousCandidatePreview = process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE;
    const previousObservations = process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE;
    const previousOcrCandidate = process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE;
    const previousTable = process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE;
    try {
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v2";
      process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = "v1";
      if (factProfile) process.env.INSPECTOR_FACT_FAMILY_PROFILE = factProfile;
      else delete process.env.INSPECTOR_FACT_FAMILY_PROFILE;
      if (previewProfile) process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE = previewProfile;
      else delete process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE;
      if (observationsProfile) process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE = observationsProfile;
      else delete process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE;
      if (ocrCandidateProfile) process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE = ocrCandidateProfile;
      else delete process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE;
      if (tableProfile) process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE = tableProfile;
      else delete process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE;
      const invalidObject = await repository.createObject({ name: "Invalid OCR heat", address: "Москва" });
      const invalidFile = { id: `FIL-${randomUUID()}`, name: "invalid.pdf", size: 43,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${invalidObject.id}/originals/${"a".repeat(64)}/invalid.pdf` };
      await repository.registerIngestedFiles(invalidObject.id, [invalidFile]);
      await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires.*OCR v3/);

      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v3";
      if (factProfile) {
        delete process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires OCR heat review v1/);
        process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = "v1";
      }
      if (previewProfile) {
        delete process.env.INSPECTOR_FACT_FAMILY_PROFILE;
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires fact family review v1/);
        process.env.INSPECTOR_FACT_FAMILY_PROFILE = "v1";
      }
      if (observationsProfile) {
        delete process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE;
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires candidate preview v1/);
        process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE = "v1";
      }
      if (ocrCandidateProfile) {
        delete process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE;
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires candidate observations v1/);
        process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE = "v1";
      }
      if (tableProfile) {
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires.*OCR v4\/v5/);
        process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v5";
        delete process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE;
        await expect(repository.startCheck(invalidObject.id)).rejects.toThrow(/requires candidate family OCR observations/);
        process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE = "v1";
      }
      const object = await repository.createObject({ name: "OCR heat pilot", address: "Москва" });
      const readerPassword = "OCR-Heat-Read-2026!";
      const reader = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-heat-reader-${randomUUID()}`, displayName: "OCR Heat Reader",
        password: readerPassword, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
        objectPermissions: ["READ"],
      });
      const denied = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-heat-denied-${randomUUID()}`, displayName: "OCR Heat Denied",
        password: readerPassword, role: "INSPECTOR", capabilities: [], objectApiIds: [object.id],
        objectPermissions: ["UPLOAD"],
      });
      const file = { ...invalidFile, id: `FIL-${randomUUID()}`, name: "heat.pdf",
        storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/heat.pdf` };
      await repository.registerIngestedFiles(object.id, [file]);
      const reviewer = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-heat-reviewer-${randomUUID()}`, displayName: "OCR Heat Reviewer",
        password: readerPassword, role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"],
        objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const workerToken = `worker-${randomUUID()}`;
      const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
      const app = await buildApp({ repository, workerToken, identityService: identity });
      openApps.push(app);
      const login = async (user: { login: string }) => {
        const response = await app.inject({ method: "POST", url: "/api/auth/login",
          payload: { login: user.login, password: readerPassword } });
        expect(response.statusCode).toBe(200);
        return sessionCookies(response).cookie;
      };
      const reviewerLogin = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reviewer.login, password: readerPassword } });
      const reviewerSession = sessionCookies(reviewerLogin);
      const sourceReview = await app.inject({ method: "POST",
        url: `/api/objects/${object.id}/files/${file.id}/source-review`,
        headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf,
          "idempotency-key": `source-review-${randomUUID()}` },
        payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
          approvalStatus: "APPROVED", linkGroupId: "building-1", sectionCode: "AR",
          pageStages: {}, basis: { reference: "Раздел АР проверен по титульному листу" } },
      });
      expect(sourceReview.statusCode).toBe(201);
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const readerCookie = await login(reader);
      const deniedCookie = await login(denied);
      const pilotUrl = `/api/checks/${check!.id}/pilot-results`;
      expect((await app.inject({ method: "GET", url: pilotUrl })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: pilotUrl,
        headers: { cookie: deniedCookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: pilotUrl,
        headers: { cookie: readerCookie } })).json()).toEqual({
        checkId: check!.id, status: "PROCESSING", items: [], ocrHeatRows: null,
      });
      const release = await database.query<{ release_id: string; content_json: Record<string, any> }>(
        `SELECT release.release_id, release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id WHERE run.api_id = $1`,
        [check!.id],
      );
      const rulesSlot = release.rows[0].content_json.providerSlots.find(
        (slot: Record<string, unknown>) => slot.stageJobType === "RULE_EVALUATION");
      const expectedProfile = tableProfile
        ? `typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-${tableProfile}`
        : ocrCandidateProfile
        ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
        : observationsProfile
        ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
        : previewProfile ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
        : factProfile ? "typed-pz002-pz017-ocr-heat-fact-family-v1"
        : "typed-pz002-pz017-ocr-heat-v1";
      expect(rulesSlot).toMatchObject({ profileId: expectedProfile,
        adapterVersion: tableProfile === "v3" ? "9" : tableProfile === "v2" ? "8" : tableProfile ? "7"
          : ocrCandidateProfile ? "6" : observationsProfile ? "5" : previewProfile ? "4"
          : factProfile ? "3" : "2", status: "CONFIGURED" });
      expect(release.rows[0].content_json.rules.definitions.ocrHeatRows).toMatchObject({
        disposition: "REVIEW_AID_ONLY", extractionProfile: "conservative-ocr-heat-rows-v1",
      });
      if (factProfile) {
        expect(release.rows[0].content_json.rules.definitions.factFamily).toMatchObject({
          disposition: "REVIEW_AID_ONLY", rules: pilotFactFamilyRules,
        });
      }
      if (previewProfile) {
        expect(release.rows[0].content_json.rules.definitions.candidateFamilyPreview).toMatchObject({
          disposition: "REVIEW_AID_ONLY", extractionProfile: "candidate-family-preview-v1",
          codeCount: 47,
        });
      }
      if (observationsProfile) {
        expect(release.rows[0].content_json.rules.definitions.candidateFamilyObservations).toMatchObject({
          disposition: "REVIEW_AID_ONLY", extractionProfile: "candidate-family-observations-v1",
          codeCount: 47,
        });
      }
      if (ocrCandidateProfile) {
        expect(release.rows[0].content_json.rules.definitions.candidateFamilyOcrObservations).toMatchObject({
          disposition: "REVIEW_AID_ONLY", extractionProfile: "candidate-family-ocr-observations-v1",
          codeCount: 47,
        });
      }
      if (tableProfile) {
        expect(release.rows[0].content_json.rules.definitions.ocrTableRows).toEqual({
          ruleId: "pilot-ocr-table-rows-review", version: tableProfile.slice(-1),
          extractionProfile: `conservative-ocr-table-rows-${tableProfile}`, disposition: "REVIEW_AID_ONLY",
        });
      }
      const jobId = async (type: string) => {
        const selected = await database.query<{ id: string }>(
          `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
           WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type]);
        expect(selected.rows).toHaveLength(1);
        return selected.rows[0].id;
      };
      const claim = async (type: string) => {
        const response = await app.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "ocr-heat-test", capabilities: [type] } });
        expect(response.statusCode, type).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) =>
        app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const inventory = await claim("ANALYSIS_INVENTORY");
      const candidateFixture = previewProfile
        ? pythonCandidatePreviewFixture(inventory.objectId, inventory.inputManifestHash,
            file.id, file.sha256, Boolean(observationsProfile))
        : null;
      expect((await complete("ANALYSIS_INVENTORY", inventory, {
        disposition: "MANIFEST_INVENTORIED", sourceCount: 1,
        stageCounts: { PD: 0, RD: 1, ID: 0 },
      })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const content = "Проектная документация";
      const textArtifact = candidateFixture?.artifact ?? { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 1, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
        pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: content }],
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
            blockCount: 1, nonWhitespaceCharacterCount: 21, alphanumericCharacterCount: 21,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          } } }],
      };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: [{ sourceFileId: file.id, inputSha256: file.sha256, status: "EXTRACTED",
          artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      const scaffold = (type: keyof typeof scaffoldStageContracts, lease: Record<string, any>) => {
        const [disposition, reasonCode, providerKind] = scaffoldStageContracts[type];
        return { schemaVersion: "analysis-stage-result-v1", jobType: type,
          inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0 };
      };
      expect((await complete("DOCUMENT_RENDER", render, scaffold("DOCUMENT_RENDER", render))).statusCode).toBe(200);
      const ocr = await claim("DOCUMENT_OCR_LAYOUT");
      const ocrStage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: tableProfile ? boundedOcrProfileIdV5 : boundedOcrProfileIdV3,
        providerConfigHash: tableProfile ? boundedOcrConfigHashV5 : boundedOcrConfigHashV3,
        outputCount: 0, analysis: { schemaVersion: tableProfile
          ? "bounded-ocr-layout-analysis-v5" : "bounded-ocr-layout-analysis-v3",
          objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
          profile: tableProfile ? boundedOcrProfileV5 : boundedOcrProfileV3,
          sourceCount: 1, ocrRequiredPageCount: 0,
          processedPageCount: 0, deferredPageCount: 0, skippedOversizePageCount: 0,
          skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
          subjectCandidatePageCount: 0,
          ...(tableProfile ? { titleRecoveryCandidatePageCount: 0 } : {}),
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 1, status: "NO_OCR_REQUIRED_PAGES",
            ocrRequiredPageCount: 0, processedPageCount: 0, deferredPageCount: 0,
            skippedRenderPixelPageCount: 0, subjectCandidatePageCount: 0,
            ...(tableProfile ? { titleRecoveryCandidatePageCount: 0 } : {}), pages: [] }],
        } };
      const candidateOcrObservations = ocrCandidateProfile && candidateFixture
        ? pythonCandidateOcrObservationsFixture(ocr.objectId, ocr.inputManifestHash,
          file.id, file.sha256, candidateFixture.artifact, ocrStage)
        : null;
      const ocrTableRows = tableProfile
        ? pythonOcrTableRowsFixture(ocrStage, tableProfile as "v1" | "v2" | "v3") : null;
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, ocrStage)).statusCode).toBe(200);
      for (const type of ["DOCUMENT_METADATA", "DOCUMENT_LINKING"] as const) {
        const lease = await claim(type);
        expect((await complete(type, lease, scaffold(type, lease))).statusCode).toBe(200);
      }
      const entity = await claim("ENTITY_EXTRACTION");
      expect((await complete("ENTITY_EXTRACTION", entity, visualProposalResult(entity, 0))).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      expect(rules.release.providerSlot).toMatchObject({ profileId: expectedProfile });
      expect(rules.release.rules.definitions).toEqual(
        release.rows[0].content_json.rules.definitions);
      expect(rules.inputs.sourceFiles[0].sectionCode).toBe("AR");
      expect(rules.inputs.sourceDecisions[file.id].sectionCode).toBe("AR");
      const heatLoad = { schemaVersion: "pz-017-analysis-v1", objectId: rules.objectId,
        selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
        extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
        scannedPages: { PD: 0, RD: 1 }, ocrRequiredPageCount: 0,
        comparison: { schemaVersion: "pz-017-component-comparison-v1", parameterCode: "PZ-017",
          disposition: "ABSTAIN", reasonCode: "MISSING_COMPONENT_EVIDENCE",
          totalComparable: false, finding: null },
        evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
          ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
          executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
          reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null },
      };
      const ocrHeatRows = { schemaVersion: "ocr-heat-row-proposals-v1",
        profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: rules.inputManifestHash,
        proposals: [], abstentions: [], findingCount: 0 };
      const ruleResult = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
        inputManifestHash: rules.inputManifestHash, disposition: "RULES_EVALUATED",
        providerKind: "RULE_ENGINE", providerProfileId: expectedProfile,
        providerConfigHash: rules.release.providerSlot.configHash,
        outputCount: tableProfile ? 8 : ocrCandidateProfile ? 7 : observationsProfile ? 6
          : previewProfile ? 5 : factProfile ? 4 : 3,
        analysis: { schemaVersion: "pz-002-analysis-v1", objectId: rules.objectId,
          selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
          route: { schemaVersion: "parameter-route-v1", stages: [] }, extractedFacts: [],
          ocrArtifacts: [], evaluation: { schemaVersion: "typed-rule-result-v1",
            ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
            objectId: rules.objectId, executionStatus: "SUCCEEDED",
            machineStatus: "MISSING_EVIDENCE", reasonCode: "MISSING_PD", evidence: [] } },
        heatLoad, ocrHeatRows,
        ...(factProfile ? { factFamily: emptyFactFamily(rules.objectId, rules.inputManifestHash) } : {}),
        ...(candidateFixture ? { candidateFamilyPreview: candidateFixture.preview } : {}),
        ...(candidateFixture?.observations
          ? { candidateFamilyObservations: candidateFixture.observations } : {}),
        ...(candidateOcrObservations
          ? { candidateFamilyOcrObservations: candidateOcrObservations } : {}),
        ...(ocrTableRows ? { ocrTableRows } : {}) };
      expect((await complete("RULE_EVALUATION", rules, {
        ...ruleResult, ocrHeatRows: { ...ocrHeatRows, findingCount: 1 },
      })).statusCode).toBe(409);
      expect((await complete("RULE_EVALUATION", rules, {
        ...ruleResult, ocrHeatRows: { ...ocrHeatRows, proposals: [{ component: "HEATING" }] },
      })).statusCode).toBe(409);
      if (factProfile) {
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, factFamily: { ...ruleResult.factFamily as Record<string, unknown>, findingCount: 1 },
        })).statusCode).toBe(409);
      }
      if (tableProfile) {
        const wrongVersion = tableProfile === "v1" ? "v2" : "v1";
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, ocrTableRows: pythonOcrTableRowsFixture(
            ocrStage, wrongVersion),
        })).statusCode).toBe(409);
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, ocrTableRows: { ...ocrTableRows, findingCount: 1 },
        })).statusCode).toBe(409);
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, ocrTableRows: { ...ocrTableRows, proposals: [{ parameterCode: "PZ-002" }] },
        })).statusCode).toBe(409);
        const { ocrTableRows: _removed, ...missingTable } = ruleResult;
        expect((await complete("RULE_EVALUATION", rules, missingTable)).statusCode).toBe(409);
      } else {
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, ocrTableRows: { schemaVersion: "ocr-table-row-proposals-v1" },
        })).statusCode).toBe(409);
      }
      if (previewProfile) {
        const original = candidateFixture!.preview;
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyPreview: { ...original, findingCount: 1 },
        })).statusCode).toBe(409);
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyPreview: { ...original, inputManifestHash: "f".repeat(64) },
        })).statusCode).toBe(409);
      }
      if (observationsProfile) {
        const original = candidateFixture!.observations!;
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyObservations: { ...original, findingCount: 1 },
        })).statusCode).toBe(409);
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyObservations: {
            ...original, observations: original.observations.map((item: Record<string, any>, index: number) =>
              index === 0 ? { ...item, rawValue: "43" } : item),
          },
        })).statusCode).toBe(409);
      }
      if (ocrCandidateProfile) {
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyOcrObservations: {
            ...candidateOcrObservations, findingCount: 1,
          },
        })).statusCode).toBe(409);
        const changed = structuredClone(candidateOcrObservations!) as Record<string, any>;
        const row = changed.codeRows.find((item: Record<string, unknown>) => item.parameterCode === "PZ-002");
        row.ocrDeferredPageCount = 1;
        expect((await complete("RULE_EVALUATION", rules, {
          ...ruleResult, candidateFamilyOcrObservations: changed,
        })).statusCode).toBe(409);
      }
      const validRuleCompletion = await complete("RULE_EVALUATION", rules, ruleResult);
      expect(validRuleCompletion.statusCode, JSON.stringify(validRuleCompletion.json())).toBe(200);
      const evidence = await claim("EVIDENCE_VALIDATION");
      expect((await complete("EVIDENCE_VALIDATION", evidence,
        scaffold("EVIDENCE_VALIDATION", evidence))).statusCode).toBe(200);
      const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
      const sealed = await complete("ANALYSIS_SEAL_UNSUPPORTED", seal,
        { disposition: "UNSUPPORTED_COVERAGE_SEALED" });
      expect(sealed.statusCode).toBe(200);
      expect(sealed.json()).toMatchObject({ check: { status: "PARTIAL",
        stats: { unsupported: factProfile ? 125 : 130 } } });
      const pilotRead = await app.inject({ method: "GET", url: pilotUrl,
        headers: { cookie: readerCookie } });
      expect(pilotRead.statusCode, JSON.stringify(pilotRead.json())).toBe(200);
      expect(pilotRead.headers["cache-control"]).toBe("private, no-store");
      expect(pilotRead.json()).toMatchObject({ checkId: check!.id, status: "READY",
        ocrHeatRows: { profileId: "conservative-ocr-heat-rows-v1",
          inputManifestHash: rules.inputManifestHash, proposals: [], abstentions: [],
          findingCount: 0, proposalCount: 0, abstentionCount: 0, truncated: false } });
      expect(pilotRead.json().items).toHaveLength(2);
      if (factProfile) {
        expect(pilotRead.json().factFamily).toMatchObject({
          findingCount: 0, outputCount: 5, comparisons: expect.arrayContaining([
            expect.objectContaining({ parameterCode: "KR-055", status: "ABSTAIN" }),
          ]),
        });
        const partialCoverage = await database.query<{ parameter_code: string; execution_rollup: string }>(
          `SELECT coverage.parameter_code, coverage.execution_rollup FROM parameter_coverage coverage
           JOIN analysis_runs run ON run.id = coverage.run_id WHERE run.api_id = $1
             AND coverage.parameter_code IN ('PZ-004', 'PZ-007', 'KR-055', 'KR-058', 'KR-059')`,
          [check!.id],
        );
        expect(partialCoverage.rows).toHaveLength(5);
        expect(partialCoverage.rows.every((row) => row.execution_rollup === "PARTIAL")).toBe(true);
      } else expect(pilotRead.json().factFamily).toBeUndefined();
      if (previewProfile) {
        const preview = pilotRead.json().candidateFamilyPreview;
        expect(preview).toMatchObject({ schemaVersion: "candidate-family-preview-v1",
          inputManifestHash: rules.inputManifestHash, scope: "RUN_COMMITTED_SOURCES",
          purpose: "REVIEW_ONLY", outputCount: 47, findingCount: null,
          parameterCoverage: null });
        expect(preview.codeRows).toHaveLength(47);
        expect(preview.codeRows.find((row: Record<string, any>) => row.parameterCode === "PZ-002")
          .candidateLeads).toHaveLength(1);
      } else expect(pilotRead.json().candidateFamilyPreview).toBeUndefined();
      if (observationsProfile) {
        const observations = pilotRead.json().candidateFamilyObservations;
        expect(observations).toMatchObject({ schemaVersion: "candidate-family-observations-v1",
          purpose: "REVIEW_ONLY", inputManifestHash: rules.inputManifestHash,
          findingCount: null, parameterCoverage: null, outputCount: 1 });
        expect(observations.codeRows).toHaveLength(47);
        expect(observations.observations).toHaveLength(1);
        expect(observations.observations[0].typedFact).toMatchObject({
          schemaVersion: "typed-fact-v1", rawValue: "42", canonicalUnit: "m2",
        });
      } else expect(pilotRead.json().candidateFamilyObservations).toBeUndefined();
      if (ocrCandidateProfile) {
        const ocrReview = pilotRead.json().candidateFamilyOcrObservations;
        expect(ocrReview).toMatchObject({ schemaVersion: "candidate-family-ocr-observations-v1",
          inputManifestHash: rules.inputManifestHash, purpose: "REVIEW_ONLY",
          scope: "RUN_COMMITTED_OCR", outputCount: 47,
          findingCount: null, parameterCoverage: null });
        expect(ocrReview.codeRows).toHaveLength(47);
        expect(ocrReview.codeRows.every((row: Record<string, any>) => row.status === "ABSTAIN")).toBe(true);
      } else expect(pilotRead.json().candidateFamilyOcrObservations).toBeUndefined();
      if (tableProfile) {
        expect(pilotRead.json().ocrTableRows).toEqual({
          profileId: `conservative-ocr-table-rows-${tableProfile}`,
          inputManifestHash: rules.inputManifestHash,
          proposals: [], abstentions: [], findingCount: 0,
          proposalCount: 0, abstentionCount: 0, truncated: false,
        });
      } else expect(pilotRead.json().ocrTableRows).toBeUndefined();
      const findings = await database.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM review_items item JOIN analysis_runs run ON run.id = item.run_id
         WHERE run.api_id = $1`, [check!.id]);
      expect(findings.rows[0].count).toBe("0");

      delete process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
      delete process.env.INSPECTOR_FACT_FAMILY_PROFILE;
      delete process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE;
      delete process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE;
      delete process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE;
      delete process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE;
      const legacyObject = await repository.createObject({ name: "Legacy OCR v3", address: "Москва" });
      const legacyFile = { ...file, id: `FIL-${randomUUID()}`,
        storageKey: `objects/${legacyObject.id}/originals/${file.sha256}/heat.pdf` };
      await repository.registerIngestedFiles(legacyObject.id, [legacyFile]);
      const legacy = await repository.startCheck(legacyObject.id);
      const legacyRelease = await database.query<{ release_id: string; content_json: Record<string, any> }>(
        `SELECT release.release_id, release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id WHERE run.api_id = $1`,
        [legacy!.id],
      );
      expect(legacyRelease.rows[0].release_id).not.toBe(release.rows[0].release_id);
      expect(legacyRelease.rows[0].content_json.providerSlots.find(
        (slot: Record<string, unknown>) => slot.stageJobType === "RULE_EVALUATION"))
        .toMatchObject({ profileId: "typed-pz002-pz017-v1", adapterVersion: "1" });
    } finally {
      if (previousOcr === undefined) delete process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
      else process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = previousOcr;
      if (previousHeat === undefined) delete process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
      else process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = previousHeat;
      if (previousFactFamily === undefined) delete process.env.INSPECTOR_FACT_FAMILY_PROFILE;
      else process.env.INSPECTOR_FACT_FAMILY_PROFILE = previousFactFamily;
      if (previousCandidatePreview === undefined) delete process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE;
      else process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE = previousCandidatePreview;
      if (previousObservations === undefined) delete process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE;
      else process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE = previousObservations;
      if (previousOcrCandidate === undefined) delete process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE;
      else process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE = previousOcrCandidate;
      if (previousTable === undefined) delete process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE;
      else process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE = previousTable;
    }
  }, 30_000); // Replays every durable stage and Python artifact for each profile combination.

  it.each([
    { sourceKind: "mixed PD/RD", mixedStages: true, pageStages: { "3": "RD" },
      scannedPages: { PD: 0, RD: 1 }, ocrRequiredPageCount: 1 },
    { sourceKind: "single-stage RD", mixedStages: false, pageStages: {},
      scannedPages: { PD: 0, RD: 4 }, ocrRequiredPageCount: 2 },
  ])("persists two $sourceKind OCR heat rows through complete, seal, and scoped read", async (
    { mixedStages, pageStages, scannedPages, ocrRequiredPageCount },
  ) => {
    const reference = await loadReferenceData();
    const organizationSlug = `ocr-heat-positive-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002_PZ017",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const previousOcr = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
    const previousHeat = process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
    try {
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v3";
      process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = "v1";
      const object = await repository.createObject({ name: "Reviewed OCR heat", address: "Москва" });
      const file = { id: `FIL-${randomUUID()}`, name: "heating.pdf", size: 43,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "e".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"e".repeat(64)}/heating.pdf` };
      expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
      if (mixedStages) {
        // Explicit page-stage decisions are valid only for a mixed-stage source.
        expect(await repository.registerIngestedFiles(object.id, [{
          ...file, id: `FIL-${randomUUID()}`, stage: "PD" as const,
        }])).toBeDefined();
      }
      const password = "OCR-Heat-Positive-2026!";
      const reviewer = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-heat-positive-${randomUUID()}`,
        displayName: "OCR Heat Reviewer", password, role: "INSPECTOR",
        capabilities: ["SOURCE_REVIEW"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const workerToken = `worker-${randomUUID()}`;
      const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
      const app = await buildApp({ repository, workerToken, identityService: identity });
      openApps.push(app);
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reviewer.login, password } });
      expect(login.statusCode).toBe(200);
      const session = sessionCookies(login);
      const reviewed = await app.inject({ method: "POST",
        url: `/api/objects/${object.id}/files/${file.id}/source-review`,
        headers: { cookie: session.cookie, "x-csrf-token": session.csrf,
          "idempotency-key": `ocr-heat-review-${randomUUID()}` },
        payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
          approvalStatus: "APPROVED", linkGroupId: "building-1",
          pageStages, basis: { reference: "Лист ОВ с тепловыми нагрузками" } },
      });
      expect(reviewed.statusCode).toBe(201);
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const jobId = async (type: string) => {
        const selected = await database.query<{ id: string }>(
          `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
           WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type]);
        expect(selected.rows).toHaveLength(1);
        return selected.rows[0].id;
      };
      const claim = async (type: string) => {
        const response = await app.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "ocr-heat-positive-test", capabilities: [type] } });
        expect(response.statusCode, type).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: Record<string, unknown>) =>
        app.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const scaffold = (type: keyof typeof scaffoldStageContracts, lease: Record<string, any>) => {
        const [disposition, reasonCode, providerKind] = scaffoldStageContracts[type];
        return { schemaVersion: "analysis-stage-result-v1", jobType: type,
          inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0 };
      };
      const inventory = await claim("ANALYSIS_INVENTORY");
      expect((await complete("ANALYSIS_INVENTORY", inventory, {
        disposition: "MANIFEST_INVENTORIED", sourceCount: 1,
        stageCounts: { PD: mixedStages ? 1 : 0, RD: 1, ID: 0 },
      })).statusCode).toBe(200);
      const candidate = (pageNumber: number, content: string) => ({
        pageNumber, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        blocks: [{ bboxMilliPoints: [10_000, 20_000, 500_000, 40_000], text: content }],
        quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
          blockCount: 1, nonWhitespaceCharacterCount: [...content].filter((ch) => !/\s/u.test(ch)).length,
          alphanumericCharacterCount: [...content].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length,
          replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
        } },
      });
      const required = (pageNumber: number) => ({ pageNumber,
        widthMilliPoints: 595_000, heightMilliPoints: 842_000, blocks: [],
        quality: { disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"], metrics: {
          blockCount: 0, nonWhitespaceCharacterCount: 0, alphanumericCharacterCount: 0,
          replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
        } },
      });
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 4, textPageCount: 2, qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        qualitySummary: { textLayerCandidatePageCount: 2, ocrRequiredPageCount: 2 },
        pages: [candidate(1, "Разрешение. Обозначение АНО/1-РД-ОВ1"), required(2), required(3),
          candidate(4, "Основные показатели по рабочим чертежам марки ОВ. Тепловой поток на отопление")],
      };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, {
        disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", sources: [{ sourceFileId: file.id,
          inputSha256: file.sha256, status: "EXTRACTED", artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      expect((await complete("DOCUMENT_RENDER", render, scaffold("DOCUMENT_RENDER", render))).statusCode).toBe(200);
      const ocr = await claim("DOCUMENT_OCR_LAYOUT");
      const lines = [
        { text: "Система горячего водоснабжения", bboxPx: [215, 561, 476, 589], score: 0.98 },
        { text: "Максимальный расчетный расход тепла с учетом", bboxPx: [213, 599, 567, 626], score: 0.98 },
        { text: "722,64 кВт. (0,621 Гкал/час)", bboxPx: [595, 607, 799, 639], score: 0.84 },
        { text: "циркуляции", bboxPx: [214, 623, 304, 648], score: 0.98 },
        { text: "Средний расчетный расход тепла", bboxPx: [214, 666, 460, 696], score: 0.98 },
        { text: "225,11 кВт. (0,194 Гкал/час)", bboxPx: [594, 665, 798, 696], score: 0.85 },
      ];
      const page = (pageNumber: number, pageLines: typeof lines): Record<string, unknown> => {
        const value: Record<string, unknown> = { schemaVersion: "document-ocr-page-v1",
          sourceFileId: file.id, inputSha256: file.sha256, pageNumber,
          render: { sha256: "b".repeat(64), widthPx: 992, heightPx: 1404,
            dpi: 120, rendererProfileId: boundedOcrProfileV3.rendererProfileId },
          provider: { profileId: boundedOcrProfileV3.ocrProviderProfileIds[0], script: "eslav" },
          lines: pageLines };
        value.contentHash = sha256(canonicalJson(value));
        return value;
      };
      const ocrPage = page(3, lines);
      const ocrStage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: boundedOcrProfileIdV3, providerConfigHash: boundedOcrConfigHashV3,
        outputCount: 2, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v3",
          objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
          profile: boundedOcrProfileV3, sourceCount: 1, ocrRequiredPageCount: 2,
          processedPageCount: 2, deferredPageCount: 0, skippedOversizePageCount: 0,
          skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
          subjectCandidatePageCount: 2,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 4, status: "SCANNED",
            ocrRequiredPageCount: 2, processedPageCount: 2, deferredPageCount: 0,
            skippedRenderPixelPageCount: 0, subjectCandidatePageCount: 2,
            pages: [page(2, []), ocrPage] }],
        },
      };
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, ocrStage)).statusCode).toBe(200);
      for (const type of ["DOCUMENT_METADATA", "DOCUMENT_LINKING"] as const) {
        const lease = await claim(type);
        expect((await complete(type, lease, scaffold(type, lease))).statusCode).toBe(200);
      }
      const entity = await claim("ENTITY_EXTRACTION");
      const visual = visualProposalResult(entity, 0) as Record<string, any>;
      const visualSource = visual.analysis.sources[0];
      visualSource.pageCount = 4;
      visualSource.scannedPageCount = 4;
      visualSource.scannedPageNumbers = [1, 2, 3, 4];
      visualSource.documentContext.inspectedPages.push({ pageNumber: 2,
        textSha256: "c".repeat(64), titleWindow: null });
      expect((await complete("ENTITY_EXTRACTION", entity, visual)).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      expect(rules.inputs.sourceDecisions[file.id]).toMatchObject({
        sourceSha256: file.sha256, pageStages,
      });
      const evidence = (index: number, role: string) => ({ role, lineIndex: index, ...lines[index] });
      const basis = { sourceFileId: file.id, inputSha256: file.sha256, pageNumber: 3,
        stage: "RD", component: "DHW", ocrPageContentHash: ocrPage.contentHash,
        renderSha256: "b".repeat(64) };
      const ocrHeatRows = { schemaVersion: "ocr-heat-row-proposals-v1",
        profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: rules.inputManifestHash,
        proposals: [
          { ...basis, basis: "MAX_INCLUDING_CIRCULATION",
            values: { kW: "722.64", "Gcal/h": "0.621" },
            evidence: [evidence(0, "section"), evidence(1, "rowLabel"),
              evidence(3, "basisContinuation"), evidence(2, "value")] },
          { ...basis, basis: "MEAN", values: { kW: "225.11", "Gcal/h": "0.194" },
            evidence: [evidence(0, "section"), evidence(4, "rowLabel"), evidence(5, "value")] },
        ], abstentions: [], findingCount: 0,
      };
      const heatLoad = { schemaVersion: "pz-017-analysis-v1", objectId: rules.objectId,
        selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
        extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
        scannedPages, ocrRequiredPageCount,
        comparison: { schemaVersion: "pz-017-component-comparison-v1", parameterCode: "PZ-017",
          disposition: "ABSTAIN", reasonCode: "MISSING_COMPONENT_EVIDENCE",
          totalComparable: false, finding: null },
        evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
          ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
          executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
          reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null },
      };
      const ruleResult = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
        inputManifestHash: rules.inputManifestHash, disposition: "RULES_EVALUATED",
        providerKind: "RULE_ENGINE", providerProfileId: "typed-pz002-pz017-ocr-heat-v1",
        providerConfigHash: rules.release.providerSlot.configHash, outputCount: 3,
        analysis: { schemaVersion: "pz-002-analysis-v1", objectId: rules.objectId,
          selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
          route: { schemaVersion: "parameter-route-v1", stages: [] }, extractedFacts: [],
          ocrArtifacts: [], evaluation: { schemaVersion: "typed-rule-result-v1",
            ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
            objectId: rules.objectId, executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
            reasonCode: "MISSING_PD", evidence: [] } },
        heatLoad, ocrHeatRows };
      const stale = await app.inject({ method: "POST",
        url: `/api/internal/v1/jobs/${await jobId("RULE_EVALUATION")}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: { attemptId: rules.attemptId, fencingToken: rules.fencingToken + 1,
          result: ruleResult } });
      expect(stale.statusCode).toBe(409);
      expect((await complete("RULE_EVALUATION", rules, ruleResult)).statusCode).toBe(200);
      const replay = await complete("RULE_EVALUATION", rules, ruleResult);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ status: "COMPLETED", replayed: true });
      const validated = await claim("EVIDENCE_VALIDATION");
      expect((await complete("EVIDENCE_VALIDATION", validated,
        scaffold("EVIDENCE_VALIDATION", validated))).statusCode).toBe(200);
      const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
      expect((await complete("ANALYSIS_SEAL_UNSUPPORTED", seal,
        { disposition: "UNSUPPORTED_COVERAGE_SEALED" })).statusCode).toBe(200);
      const read = await app.inject({ method: "GET", url: `/api/checks/${check!.id}/pilot-results`,
        headers: { cookie: session.cookie } });
      expect(read.statusCode).toBe(200);
      expect(read.json().ocrHeatRows).toMatchObject({ profileId: "conservative-ocr-heat-rows-v1",
        proposalCount: 2, abstentionCount: 0, findingCount: 0, truncated: false });
      expect(read.json().ocrHeatRows.proposals).toEqual(ocrHeatRows.proposals);
      const persisted = await database.query<{ content_json: Record<string, any> }>(
        `SELECT stage.content_json FROM analysis_stage_artifacts stage
         JOIN analysis_runs run ON run.id = stage.run_id
         WHERE run.api_id = $1 AND stage.job_type = 'RULE_EVALUATION'`, [check!.id]);
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0].content_json.ocrHeatRows.proposals).toHaveLength(2);
      const findings = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM review_items item
         JOIN analysis_runs run ON run.id = item.run_id WHERE run.api_id = $1`, [check!.id]);
      expect(findings.rows[0].count).toBe("0");
    } finally {
      if (previousOcr === undefined) delete process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE;
      else process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = previousOcr;
      if (previousHeat === undefined) delete process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE;
      else process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = previousHeat;
    }
  });

  it("persists deduplicated input, one concurrent run and sealed coverage across reconnect", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `integration-${randomUUID()}`;
    const poolErrors: Error[] = [];
    const first = await PostgresInspectionRepository.create({
      connectionString,
      parameters: reference.parameters,
      organizationSlug,
      organizationName: "PostgreSQL integration",
      onPoolError: (error) => poolErrors.push(error),
    });
    openRepositories.push(first);

    const object = await first.createObject({ name: "Объект persistence", address: "г. Москва" });
    const fixtureDatabase = new Pool({ connectionString, max: 1 });
    openPools.push(fixtureDatabase);
    const objectScope = await fixtureDatabase.query<{ object_id: string; organization_id: string }>(
      `SELECT id AS object_id, organization_id FROM objects WHERE api_id = $1`,
      [object.id],
    );
    const reader = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO inspector_users (login, provider_subject, display_name)
       VALUES ($1, $2, 'Persistence Reader')
       RETURNING id`,
      [`persistence-${randomUUID()}`, `provider:${randomUUID()}`],
    );
    await fixtureDatabase.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, capabilities)
       VALUES ($1, $2, 'INSPECTOR', '{}'::text[])`,
      [objectScope.rows[0].organization_id, reader.rows[0].id],
    );
    await fixtureDatabase.query(
      `INSERT INTO object_memberships (object_id, user_id, permission_set)
       VALUES ($1, $2, ARRAY['READ'])`,
      [objectScope.rows[0].object_id, reader.rows[0].id],
    );
    const scopedReader: AuthenticatedActor = {
      userId: reader.rows[0].id,
      organizationId: objectScope.rows[0].organization_id,
      displayName: "Persistence Reader",
      roles: ["INSPECTOR"],
      capabilities: [],
      sessionId: randomUUID(),
      csrfHash: "0".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const file = {
      id: `FIL-${randomUUID()}`,
      name: "project.pdf",
      size: 42,
      stage: "PD" as const,
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/project.pdf`,
    };
    const [leftUpload, rightUpload] = await Promise.all([
      first.registerIngestedFiles(object.id, [file]),
      first.registerIngestedFiles(object.id, [{ ...file, id: `FIL-${randomUUID()}` }]),
    ]);
    expect([leftUpload?.files[0].status, rightUpload?.files[0].status].sort()).toEqual([
      "DUPLICATE",
      "STORED",
    ]);
    const storedObject = await first.getObject(object.id, scopedReader);
    if (!storedObject || storedObject === "AUTH_REQUIRED") throw new Error("Scoped object was not readable");
    expect(storedObject.fileCount).toBe(1);

    const [leftRun, rightRun] = await Promise.all([
      first.startCheck(object.id),
      first.startCheck(object.id),
    ]);
    expect(leftRun?.id).toBe(rightRun?.id);
    expect(leftRun?.status).toBe("PROCESSING");

    const aggregate = await fixtureDatabase.query<{
      run_id: string;
      inspection_id: string;
      object_id: string;
      organization_id: string;
    }>(
      `SELECT run.id AS run_id, run.inspection_id, run.object_id, object.organization_id
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       WHERE run.api_id = $1`,
      [leftRun!.id],
    );
    const findingApiId = `FND-${randomUUID()}`;
    const protocolApiId = `PRT-${randomUUID()}`;
    const fingerprint = "b".repeat(64);
    const findingPayload: Omit<Finding, "id" | "checkId" | "status" | "decision"> = {
      groupId: "integration-review-group",
      parameterId: 1,
      parameterCode: "IOS4-001",
      title: "Интеграционный кандидат",
      location: "Помещение 1",
      severity: "WARNING",
      criticality: "MEDIUM",
      confidence: null,
      comparisonResult: "VALUE_MISMATCH",
      documentStatus: "COMPARABLE",
      expectedValue: "10",
      actualValue: "12",
      idValue: null,
      rationale: "Фикстура проверяет durable review read model.",
      evidence: [{
        stage: "PD",
        fileId: file.id,
        fileName: file.name,
        pdfPageNumber: 1,
        documentSheetNumber: null,
        imageUrl: null,
        bbox: null,
        sha256: file.sha256,
      }],
    };
    const result = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO rule_results (
         api_id, run_id, rule_key, rule_version, parameter_code, entity_key,
         execution_status, machine_status, result_payload, evidence_fingerprint
       ) VALUES ($1, $2, 'integration.rule', 'v1', $3, '{"room":"1"}'::jsonb,
         'SUCCEEDED', 'CANDIDATE', $4::jsonb, $5)
       RETURNING id`,
      [findingApiId, aggregate.rows[0].run_id, findingPayload.parameterCode, JSON.stringify(findingPayload), fingerprint],
    );
    const completed = await first.completeCheck(leftRun!.id);
    expect(completed).toMatchObject({ status: "PARTIAL", stats: { total: 132, unsupported: 132 } });
    expect(await first.getCoverage(leftRun!.id, scopedReader)).toHaveLength(132);

    const review = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO review_items (
         api_id, inspection_id, run_id, result_id, origin, lifecycle,
         projection_status, evidence_fingerprint
       ) VALUES ($1, $2, $3, $4, 'MACHINE', 'ACTIVE', 'CONFIRMED_VIOLATION', $5)
       RETURNING id`,
      [findingApiId, aggregate.rows[0].inspection_id, aggregate.rows[0].run_id, result.rows[0].id, fingerprint],
    );
    await fixtureDatabase.query(
      `INSERT INTO review_decisions (
         review_item_id, action, reason_code, comment, actor_id, evidence_fingerprint
       ) VALUES ($1, 'CONFIRM', 'VIOLATION_EVIDENCE_VERIFIED', $2, 'actor:integration', $3)`,
      [review.rows[0].id, "Решение сохранено в PostgreSQL", fingerprint],
    );
    const protocolCreatedAt = "2026-09-17T10:00:00.000Z";
    const protocolStats = {
      total: 132,
      unsupported: 131,
      candidates: 0,
      confirmed: 1,
      negativeVerified: 0,
      notComparable: 0,
      clarification: 0,
      suspicion: 0,
    };
    const protocol: ProtocolVersion = {
      id: protocolApiId,
      checkId: leftRun!.id,
      version: 1,
      status: "DRAFT",
      createdAt: protocolCreatedAt,
      createdBy: "actor:integration",
      stats: protocolStats,
    };
    const protocolExport: ProtocolExport = {
      schemaVersion: "1.0",
      protocol,
      findings: [{
        ...findingPayload,
        id: findingApiId,
        checkId: leftRun!.id,
        status: "CONFIRMED_VIOLATION",
        decision: {
          type: "CONFIRM",
          reason: "Решение сохранено в PostgreSQL",
          author: "actor:integration",
          decidedAt: protocolCreatedAt,
        },
      }],
    };
    const historicalSnapshotHash = sha256(canonicalJson(protocolExport));
    await fixtureDatabase.query(
      `INSERT INTO inspection_protocol_versions (
         api_id, inspection_id, run_id, version, kind, snapshot_json,
         snapshot_hash, decision_set_hash, created_by, created_at
       ) VALUES ($1, $2, $3, 1, 'DRAFT', $4::jsonb, $5, $6, $7, $8)`,
      [
        protocolApiId,
        aggregate.rows[0].inspection_id,
        aggregate.rows[0].run_id,
        JSON.stringify(protocolExport),
        historicalSnapshotHash,
        "d".repeat(64),
        protocol.createdBy,
        protocolCreatedAt,
      ],
    );
    const migrationRerun = await runDatabaseMigrations(connectionString);
    expect(migrationRerun.applied).toEqual([]);
    expect(migrationRerun.skipped).toHaveLength(29);
    expect(migrationRerun.backfilledArtifacts).toBe(1);
    const historicalArtifactResult = await fixtureDatabase.query<{
      api_id: string;
      byte_size: string | number;
      content_hash: string;
      content_bytes: Buffer;
      created_at: Date | string;
    }>(
      `SELECT artifact.api_id, artifact.byte_size, artifact.content_hash,
              artifact.content_bytes, artifact.created_at
       FROM protocol_artifacts artifact
       JOIN inspection_protocol_versions protocol ON protocol.id = artifact.protocol_id
       WHERE protocol.api_id = $1`,
      [protocolApiId],
    );
    expect(historicalArtifactResult.rows[0].content_bytes.toString("utf8")).toBe(canonicalJson(protocolExport));
    const historicalArtifact = {
      id: historicalArtifactResult.rows[0].api_id,
      protocolId: protocolApiId,
      format: "JSON" as const,
      mediaType: "application/json",
      canonicalizationVersion: "inspector-c14n-v1",
      byteSize: Number(historicalArtifactResult.rows[0].byte_size),
      contentHash: historicalArtifactResult.rows[0].content_hash,
      createdAt: new Date(historicalArtifactResult.rows[0].created_at).toISOString(),
    };
    const actor = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO inspector_users (login, provider_subject, display_name)
       VALUES ($1, $2, 'Integration Inspector')
       RETURNING id`,
      [`integration-${randomUUID()}`, `provider:${randomUUID()}`],
    );
    await fixtureDatabase.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, capabilities)
       VALUES ($1, $2, 'INSPECTOR', ARRAY['REVIEW_DECIDE'])`,
      [aggregate.rows[0].organization_id, actor.rows[0].id],
    );
    await fixtureDatabase.query(
      `INSERT INTO object_memberships (object_id, user_id, permission_set)
       VALUES ($1, $2, ARRAY['READ', 'REVIEW_DECIDE'])`,
      [aggregate.rows[0].object_id, actor.rows[0].id],
    );
    await fixtureDatabase.query(
      `INSERT INTO user_sessions (user_id, token_hash, csrf_hash, auth_version, expires_at)
       VALUES ($1, $2, $3, 1, now() + interval '1 hour')`,
      [actor.rows[0].id, "e".repeat(64), "f".repeat(64)],
    );
    const receipt = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO command_receipts (
         actor_user_id, operation, target_type, target_id, idempotency_key,
         request_hash, response_status, response_json, expires_at
       ) VALUES ($1, 'REVIEW_DECIDE', 'REVIEW_ITEM', $2, $3, $4, 200, $5::jsonb, now() + interval '30 days')
       RETURNING id`,
      [actor.rows[0].id, findingApiId, `idem-${randomUUID()}`, "1".repeat(64), JSON.stringify({ findingId: findingApiId })],
    );
    const audit = await fixtureDatabase.query<{ id: string }>(
      `INSERT INTO audit_events (
         organization_id, object_id, inspection_id, actor_user_id,
         action, target_type, target_id, after_ref, request_id, trace_id, event_hash
       ) VALUES ($1, $2, $3, $4, 'REVIEW_DECIDE', 'REVIEW_ITEM', $5,
         $6::jsonb, $7, $8, $9)
       RETURNING id`,
      [
        aggregate.rows[0].organization_id,
        aggregate.rows[0].object_id,
        aggregate.rows[0].inspection_id,
        actor.rows[0].id,
        findingApiId,
        JSON.stringify({ status: "CONFIRMED_VIOLATION" }),
        `request-${randomUUID()}`,
        `trace-${randomUUID()}`,
        "2".repeat(64),
      ],
    );
    await fixtureDatabase.end();
    openPools = openPools.filter((pool) => pool !== fixtureDatabase);

    expect(await first.getFindings(leftRun!.id, scopedReader)).toMatchObject([{
      id: findingApiId,
      status: "CONFIRMED_VIOLATION",
      decision: { author: "actor:integration" },
    }]);
    expect(await first.decideFinding(findingApiId, {
      type: "REJECT",
      reason: "Клиент не должен задавать личность",
      author: "spoofed-client-actor",
    })).toBe("IDENTITY_REQUIRED");
    expect(await first.getProtocols(leftRun!.id, scopedReader)).toEqual([{
      ...protocol,
      snapshotHash: historicalSnapshotHash,
      validity: "DRAFT",
      revocation: null,
      canonicalArtifact: historicalArtifact,
    }]);
    expect(await first.getProtocolExport(protocolApiId, scopedReader)).toEqual({
      ...protocolExport,
      snapshotHash: historicalSnapshotHash,
      validity: "DRAFT",
      revocation: null,
    });

    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    expect(await first.getObject(object.id, scopedReader)).toMatchObject({ id: object.id, activeCheckId: leftRun!.id });
    expect(poolErrors.some((error) => (error as Error & { code?: string }).code === "57P01")).toBe(true);
    await first.close();
    openRepositories = openRepositories.filter((repository) => repository !== first);

    const second = await PostgresInspectionRepository.create({
      connectionString,
      parameters: reference.parameters,
      organizationSlug,
      organizationName: "PostgreSQL integration",
    });
    openRepositories.push(second);
    expect(await second.getObject(object.id, scopedReader)).toMatchObject({
      id: object.id,
      fileCount: 1,
      activeCheckId: leftRun!.id,
    });
    expect(await second.getCheck(leftRun!.id, scopedReader)).toMatchObject({ id: leftRun!.id, status: "PARTIAL" });
    expect(await second.getCoverage(leftRun!.id, scopedReader)).toHaveLength(132);
    expect(await second.getFindings(leftRun!.id, scopedReader)).toMatchObject([{
      id: findingApiId,
      status: "CONFIRMED_VIOLATION",
      decision: { author: "actor:integration" },
    }]);
    expect(await second.getProtocols(leftRun!.id, scopedReader)).toEqual([{
      ...protocol,
      snapshotHash: historicalSnapshotHash,
      validity: "DRAFT",
      revocation: null,
      canonicalArtifact: historicalArtifact,
    }]);
    expect(await second.getProtocolExport(protocolApiId, scopedReader)).toEqual({
      ...protocolExport,
      snapshotHash: historicalSnapshotHash,
      validity: "DRAFT",
      revocation: null,
    });

    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    await expect(database.query(
      "UPDATE analysis_runs SET current_stage = 'mutated' WHERE api_id = $1",
      [leftRun!.id],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(database.query(
      "UPDATE review_decisions SET comment = 'mutated' WHERE review_item_id = $1",
      [review.rows[0].id],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(database.query(
      "UPDATE inspection_protocol_versions SET created_by = 'mutated' WHERE api_id = $1",
      [protocolApiId],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(database.query(
      "UPDATE command_receipts SET response_status = 201 WHERE id = $1",
      [receipt.rows[0].id],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(database.query(
      "DELETE FROM audit_events WHERE id = $1",
      [audit.rows[0].id],
    )).rejects.toMatchObject({ code: "55000" });
    await database.end();
    openPools = openPools.filter((pool) => pool !== database);
    await second.close();
    openRepositories = openRepositories.filter((repository) => repository !== second);
  }, 30_000);

  it("fails closed when an applied migration checksum drifts", async () => {
    const database = new Pool({ connectionString, max: 1 });
    const tracked = await database.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE name = '001_initial.sql'",
    );
    const originalChecksum = tracked.rows[0].checksum.trim();
    await database.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE name = '001_initial.sql'",
      ["0".repeat(64)],
    );
    try {
      await expect(runDatabaseMigrations(connectionString)).rejects.toThrow(
        "Migration checksum mismatch for 001_initial.sql",
      );
    } finally {
      await database.query(
        "UPDATE schema_migrations SET checksum = $1 WHERE name = '001_initial.sql'",
        [originalChecksum],
      );
      await database.end();
    }
  });

  it("authenticates a server session and commits scoped review decisions exactly once", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `review-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString,
      parameters: reference.parameters,
      organizationSlug,
      organizationName: "Review command integration",
    });
    const object = await repository.createObject({ name: "Объект review command", address: "г. Москва" });
    const file = {
      id: `FIL-${randomUUID()}`,
      name: "review.pdf",
      size: 43,
      stage: "PD" as const,
      mimeType: "application/pdf",
      sha256: "7".repeat(64),
      scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"7".repeat(64)}/review.pdf`,
    };
    const upload = await repository.registerIngestedFiles(object.id, [file]);
    expect(upload).toBeDefined();
    const run = await repository.startCheck(object.id);
    expect(run).toBeDefined();

    const database = new Pool({ connectionString, max: 3 });
    openPools.push(database);
    const aggregate = await database.query<{
      run_id: string;
      inspection_id: string;
      object_id: string;
      organization_id: string;
    }>(
      `SELECT run.id AS run_id, run.inspection_id, run.object_id, object.organization_id
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       WHERE run.api_id = $1`,
      [run!.id],
    );
    const scope = aggregate.rows[0];
    const findingApiId = `FND-${randomUUID()}`;
    const evidenceFingerprint = "8".repeat(64);
    const findingPayload: Omit<Finding, "id" | "checkId" | "status" | "decision"> = {
      groupId: "review-command-group",
      parameterId: 1,
      parameterCode: "IOS4-001",
      title: "Кандидат для server-side решения",
      location: "Помещение 2",
      severity: "WARNING",
      criticality: "MEDIUM",
      confidence: null,
      comparisonResult: "VALUE_MISMATCH",
      documentStatus: "COMPARABLE",
      expectedValue: "10",
      actualValue: "12",
      idValue: null,
      rationale: "Фикстура проверяет identity, scope, concurrency и audit.",
      evidence: [{
        stage: "PD",
        fileId: file.id,
        fileName: file.name,
        pdfPageNumber: 1,
        documentSheetNumber: null,
        imageUrl: null,
        bbox: null,
        sha256: file.sha256,
      }],
    };
    const result = await database.query<{ id: string }>(
      `INSERT INTO rule_results (
         api_id, run_id, rule_key, rule_version, parameter_code, entity_key,
         execution_status, machine_status, result_payload, evidence_fingerprint
       ) VALUES ($1, $2, 'integration.review-command', 'v1', $3, '{"room":"2"}'::jsonb,
         'SUCCEEDED', 'CANDIDATE', $4::jsonb, $5)
       RETURNING id`,
      [findingApiId, scope.run_id, findingPayload.parameterCode, JSON.stringify(findingPayload), evidenceFingerprint],
    );
    const completedRun = await repository.completeCheck(run!.id);
    expect(completedRun).toBeDefined();
    await database.query(
      `INSERT INTO review_items (
         api_id, inspection_id, run_id, result_id, origin, lifecycle,
         projection_status, evidence_fingerprint
       ) VALUES ($1, $2, $3, $4, 'MACHINE', 'ACTIVE', 'PENDING', $5)`,
      [findingApiId, scope.inspection_id, scope.run_id, result.rows[0].id, evidenceFingerprint],
    );
    const protocolApiId = `PRT-${randomUUID()}`;
    const protocol: ProtocolVersion = {
      id: protocolApiId,
      checkId: run!.id,
      version: 1,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      createdBy: "Integration fixture",
      stats: completedRun!.stats,
    };
    const protocolExport: ProtocolExport = {
      schemaVersion: "1.0",
      protocol,
      findings: [],
    };
    await database.query(
      `INSERT INTO inspection_protocol_versions (
         api_id, inspection_id, run_id, version, kind, snapshot_json,
         snapshot_hash, decision_set_hash, created_by, created_at
       ) VALUES ($1, $2, $3, 1, 'DRAFT', $4::jsonb, $5, $6, $7, $8)`,
      [
        protocolApiId,
        scope.inspection_id,
        scope.run_id,
        JSON.stringify(protocolExport),
        "9".repeat(64),
        "a".repeat(64),
        protocol.createdBy,
        protocol.createdAt,
      ],
    );

    const password = "Integration-Password-2026!";
    const createActor = async (
      label: string,
      capabilities: string[],
      permissions?: string[],
      role = "INSPECTOR",
    ): Promise<{ id: string; login: string }> => {
      const login = `${label.replaceAll(" ", "-")}-${randomUUID()}`.toLowerCase();
      const user = await provisionLocalUser(database, {
        organizationSlug,
        login,
        displayName: label,
        password,
        role,
        capabilities,
        objectApiIds: permissions ? [object.id] : [],
        objectPermissions: permissions,
      });
      return { id: user.id, login };
    };

    const reviewer = await createActor("Integration Reviewer", ["REVIEW_DECIDE"], ["READ", "REVIEW_DECIDE"]);
    const competingReviewer = await createActor(
      "Competing Reviewer",
      ["REVIEW_DECIDE"],
      ["READ", "REVIEW_DECIDE"],
    );
    const readOnly = await createActor("Read Only", [], ["READ", "REVIEW_DECIDE"]);
    const outOfScope = await createActor("Out Of Scope", ["REVIEW_DECIDE"]);
    const mlEngineer = await createActor(
      "ML Engineer",
      [],
      ["READ", "UPLOAD", "RUN", "FINALIZE"],
      "ML_ENGINEER",
    );

    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const workerToken = `worker-${randomUUID()}-${randomUUID()}`;
    const app = await buildApp({
      repository,
      identityService: identity,
      workerToken,
      storage: {
        async putFile() {},
        async getFile() {
          return { body: Readable.from(Buffer.alloc(43, 1)), size: 43, contentType: "application/pdf" };
        },
      },
    });
    openApps.push(app);

    const scopedReadUrls = [
      `/api/objects/${object.id}`,
      `/api/objects/${object.id}/files`,
      `/api/objects/${object.id}/files/${file.id}/content`,
      `/api/uploads/${upload!.id}`,
      `/api/checks/${run!.id}`,
      `/api/checks/${run!.id}/findings`,
      `/api/checks/${run!.id}/coverage`,
      `/api/checks/${run!.id}/protocols`,
      `/api/checks/${run!.id}/submission`,
      `/api/findings/${findingApiId}`,
      `/api/protocols/${protocolApiId}/export`,
    ];
    const publicList = await app.inject({ method: "GET", url: "/api/objects" });
    expect(publicList.statusCode).toBe(200);
    expect(publicList.json().items).toEqual([]);
    expect((await app.inject({
      method: "GET",
      url: "/api/objects",
      headers: { cookie: "inspector_session=invalid" },
    })).statusCode).toBe(401);
    for (const url of scopedReadUrls) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    expect((await app.inject({
      method: "POST",
      url: "/api/objects",
      payload: { name: "Без сессии", address: "г. Москва" },
    })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/objects/${object.id}/checks` })).statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: reviewer.login, password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({
      id: reviewer.id,
      displayName: "Integration Reviewer",
      capabilities: ["REVIEW_DECIDE"],
    });
    expect(login.headers["cache-control"]).toBe("no-store");
    const reviewerSession = sessionCookies(login);

    const reviewerList = await app.inject({
      method: "GET",
      url: "/api/objects",
      headers: { cookie: reviewerSession.cookie },
    });
    expect(reviewerList.statusCode).toBe(200);
    expect(reviewerList.json().items.map((item: { id: string }) => item.id)).toContain(object.id);
    const expectedReadableStatuses = new Map([
      [`/api/objects/${object.id}`, 200],
      [`/api/objects/${object.id}/files`, 200],
      [`/api/objects/${object.id}/files/${file.id}/content`, 200],
      [`/api/uploads/${upload!.id}`, 200],
      [`/api/checks/${run!.id}`, 200],
      [`/api/checks/${run!.id}/findings`, 200],
      [`/api/checks/${run!.id}/coverage`, 200],
      [`/api/checks/${run!.id}/protocols`, 200],
      [`/api/checks/${run!.id}/submission`, 409],
      [`/api/findings/${findingApiId}`, 200],
      [`/api/protocols/${protocolApiId}/export`, 200],
    ]);
    for (const [url, status] of expectedReadableStatuses) {
      expect((await app.inject({
        method: "GET",
        url,
        headers: { cookie: reviewerSession.cookie },
      })).statusCode, url).toBe(status);
    }
    const sourceList = await app.inject({
      method: "GET", url: `/api/objects/${object.id}/files`,
      headers: { cookie: reviewerSession.cookie },
    });
    expect(sourceList.json()).toMatchObject({ permissions: { upload: false, review: false, run: false }, items: [{
      id: file.id, name: file.name, sha256: file.sha256, size: file.size,
      stages: ["PD"], review: null,
    }] });
    const sourceContent = await app.inject({
      method: "GET", url: `/api/objects/${object.id}/files/${file.id}/content`,
      headers: { cookie: reviewerSession.cookie },
    });
    expect(sourceContent.statusCode).toBe(200);
    expect(sourceContent.rawPayload).toEqual(Buffer.alloc(file.size, 1));
    expect(sourceContent.headers["x-content-sha256"]).toBe(file.sha256);
    expect(sourceContent.headers["content-disposition"]).toContain("review.pdf");
    expect((await app.inject({
      method: "POST",
      url: "/api/objects",
      headers: { cookie: reviewerSession.cookie },
      payload: { name: "Без CSRF", address: "г. Москва" },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST",
      url: "/api/objects",
      headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
      payload: { name: "Без ключа команды", address: "г. Москва" },
    })).statusCode).toBe(428);
    const createKey = `object-${randomUUID()}`;
    const createHeaders = {
      cookie: reviewerSession.cookie,
      "x-csrf-token": reviewerSession.csrf,
      "idempotency-key": createKey,
    };
    const createdObject = await app.inject({
      method: "POST",
      url: "/api/objects",
      headers: createHeaders,
      payload: { name: "Объект с назначенным создателем", address: "г. Москва" },
    });
    expect(createdObject.statusCode).toBe(201);
    const replayedObject = await app.inject({
      method: "POST",
      url: "/api/objects",
      headers: createHeaders,
      payload: { name: "Объект с назначенным создателем", address: "г. Москва" },
    });
    expect(replayedObject.statusCode).toBe(201);
    expect(replayedObject.headers["idempotency-replayed"]).toBe("true");
    expect(replayedObject.json()).toEqual(createdObject.json());
    const conflictingObject = await app.inject({
      method: "POST",
      url: "/api/objects",
      headers: createHeaders,
      payload: { name: "Другой объект с тем же ключом", address: "г. Москва" },
    });
    expect(conflictingObject.statusCode).toBe(409);
    expect(conflictingObject.json().error).toBe("IDEMPOTENCY_CONFLICT");
    expect((await app.inject({
      method: "GET",
      url: `/api/objects/${createdObject.json().id}`,
      headers: { cookie: reviewerSession.cookie },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/objects/${createdObject.json().id}/files?stage=PD`,
      headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
    })).statusCode).toBe(428);
    expect((await app.inject({
      method: "POST",
      url: `/api/objects/${createdObject.json().id}/files?stage=PD`,
      headers: {
        cookie: reviewerSession.cookie,
        "x-csrf-token": reviewerSession.csrf,
        "idempotency-key": `upload-${randomUUID()}`,
      },
    })).statusCode).toBe(415);
    expect((await app.inject({
      method: "POST",
      url: `/api/objects/${createdObject.json().id}/checks`,
      headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
    })).statusCode).toBe(428);

    const commandFile = {
      id: `FIL-${randomUUID()}`,
      name: "command.pdf",
      size: 43,
      stage: "PD" as const,
      mimeType: "application/pdf",
      sha256: "6".repeat(64),
      scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${createdObject.json().id}/originals/${"6".repeat(64)}/command.pdf`,
    };
    const sessionToken = reviewerSession.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("inspector_session="))
      ?.slice("inspector_session=".length);
    const reviewerActor = sessionToken ? await identity.resolveSession(decodeURIComponent(sessionToken)) : undefined;
    expect(reviewerActor).toBeDefined();
    const uploadKey = `upload-${randomUUID()}`;
    const uploadCommand = {
      actor: reviewerActor!,
      idempotencyKey: uploadKey,
      requestId: `request-${randomUUID()}`,
      traceId: `trace-${randomUUID()}`,
    };
    const commandUpload = await repository.registerIngestedFilesCommand(
      createdObject.json().id,
      [commandFile],
      uploadCommand,
    );
    expect(commandUpload).toMatchObject({ kind: "success", replayed: false });
    const replayedUpload = await repository.registerIngestedFilesCommand(
      createdObject.json().id,
      [commandFile],
      uploadCommand,
    );
    expect(replayedUpload).toEqual({ ...commandUpload, replayed: true });
    const conflictingUpload = await repository.registerIngestedFilesCommand(
      createdObject.json().id,
      [{ ...commandFile, name: "different.pdf" }],
      uploadCommand,
    );
    expect(conflictingUpload).toEqual({ kind: "idempotency_conflict" });
    const startKey = `start-${randomUUID()}`;
    const startHeaders = {
      cookie: reviewerSession.cookie,
      "x-csrf-token": reviewerSession.csrf,
      "idempotency-key": startKey,
    };
    const started = await app.inject({
      method: "POST",
      url: `/api/objects/${createdObject.json().id}/checks`,
      headers: startHeaders,
    });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ objectId: createdObject.json().id, status: "PROCESSING", progress: 0 });
    const replayedStart = await app.inject({
      method: "POST",
      url: `/api/objects/${createdObject.json().id}/checks`,
      headers: startHeaders,
    });
    expect(replayedStart.statusCode).toBe(201);
    expect(replayedStart.headers["idempotency-replayed"]).toBe("true");
    expect(replayedStart.json()).toEqual(started.json());

    const durableJobs = await database.query<{ id: string; run_id: string; job_type: string; state: string }>(
      `SELECT job.id, run.id AS run_id, job.job_type, job.state
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1
       ORDER BY job.job_type`,
      [started.json().id],
    );
    expect(durableJobs.rows).toHaveLength(9);
    const inventoryJob = durableJobs.rows.find((job) => job.job_type === "ANALYSIS_INVENTORY")!;
    const textLayerJob = durableJobs.rows.find((job) => job.job_type === "DOCUMENT_TEXT_LAYER")!;
    const sealJob = durableJobs.rows.find((job) => job.job_type === "ANALYSIS_SEAL_UNSUPPORTED")!;
    expect(inventoryJob.state).toBe("READY");
    expect(textLayerJob.state).toBe("BLOCKED");
    expect(sealJob.state).toBe("BLOCKED");
    const releaseManifest = await database.query<{
      release_id: string;
      lifecycle: string;
      content_hash: string;
      byte_size: number;
      content_json: Record<string, unknown>;
      external_network_allowed: boolean;
    }>(
      `SELECT release.release_id, release.lifecycle, release.content_hash,
              release.byte_size, release.content_json, release.external_network_allowed
       FROM analysis_releases release
       JOIN analysis_runs run ON run.release_id = release.release_id
       WHERE run.id = $1`,
      [inventoryJob.run_id],
    );
    expect(releaseManifest.rows).toHaveLength(1);
    expect(releaseManifest.rows[0]).toMatchObject({
      release_id: expect.stringMatching(/^release:scaffold:[a-f0-9]{24}$/),
      lifecycle: "SCAFFOLD",
      external_network_allowed: false,
      content_json: {
        schemaVersion: "analysis-release-v1",
        lifecycle: "SCAFFOLD",
        externalNetworkAllowed: false,
        rules: { catalogVersion: "matrix-132-v1", parameterCount: 132, executionStatus: "UNCONFIGURED" },
        providerSlots: expect.arrayContaining([
          expect.objectContaining({ stageJobType: "DOCUMENT_OCR_LAYOUT", status: "UNCONFIGURED" }),
          expect.objectContaining({ stageJobType: "ENTITY_EXTRACTION", status: "UNCONFIGURED" }),
        ]),
      },
    });
    expect(releaseManifest.rows[0].content_hash.trim()).toBe(
      sha256(canonicalJson(releaseManifest.rows[0].content_json)),
    );
    expect(Number(releaseManifest.rows[0].byte_size)).toBe(
      Buffer.byteLength(canonicalJson(releaseManifest.rows[0].content_json)),
    );
    await expect(database.query(
      `UPDATE analysis_releases SET lifecycle = 'DRAFT' WHERE release_id = $1`,
      [releaseManifest.rows[0].release_id],
    )).rejects.toThrow(/append-only/i);
    const dependency = await database.query<{ job_type: string; prerequisite_job_type: string }>(
      `SELECT child.job_type, prerequisite.job_type AS prerequisite_job_type
       FROM analysis_job_dependencies dependency
       JOIN analysis_jobs child ON child.id = dependency.job_id
       JOIN analysis_jobs prerequisite ON prerequisite.id = dependency.prerequisite_job_id
       WHERE dependency.run_id = $1`,
      [inventoryJob.run_id],
    );
    expect(dependency.rows).toEqual(expect.arrayContaining([
      { job_type: "DOCUMENT_TEXT_LAYER", prerequisite_job_type: "ANALYSIS_INVENTORY" },
      { job_type: "DOCUMENT_RENDER", prerequisite_job_type: "DOCUMENT_TEXT_LAYER" },
      { job_type: "DOCUMENT_METADATA", prerequisite_job_type: "DOCUMENT_RENDER" },
      { job_type: "DOCUMENT_LINKING", prerequisite_job_type: "DOCUMENT_METADATA" },
      { job_type: "ENTITY_EXTRACTION", prerequisite_job_type: "DOCUMENT_LINKING" },
      { job_type: "RULE_EVALUATION", prerequisite_job_type: "ENTITY_EXTRACTION" },
      { job_type: "EVIDENCE_VALIDATION", prerequisite_job_type: "RULE_EVALUATION" },
      { job_type: "ANALYSIS_SEAL_UNSUPPORTED", prerequisite_job_type: "EVIDENCE_VALIDATION" },
    ]));
    expect(dependency.rows).toHaveLength(8);
    const startOutbox = await database.query<{ event_type: string }>(
      `SELECT event_type
       FROM domain_outbox
       WHERE payload ->> 'run_id' = $1
       ORDER BY event_type`,
      [inventoryJob.run_id],
    );
    expect(startOutbox.rows.map((row) => row.event_type)).toEqual(["analysis.started", "job.ready"]);
    expect((await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/claim`,
      payload: { workerId: "integration-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    })).statusCode).toBe(401);
    await database.query(`UPDATE analysis_jobs SET queue_name = $2 WHERE id = $1`,
      [inventoryJob.id, "rules.evaluate.zu127.poppler-v2"]);
    await expect(repository.claimJob(inventoryJob.id,
      { workerId: "integration-worker", capabilities: ["ANALYSIS_INVENTORY"] }))
      .rejects.toThrow("queue mismatch");
    await database.query(`UPDATE analysis_jobs SET queue_name = 'rules.evaluate' WHERE id = $1`,
      [inventoryJob.id]);
    const wrongQueueClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "integration-worker", capabilities: ["ANALYSIS_INVENTORY"],
        queueName: "rules.evaluate.zu127.poppler-v2" },
    });
    expect(wrongQueueClaim.statusCode).toBe(409);
    expect(wrongQueueClaim.json().error).toBe("QUEUE_MISMATCH");
    const incompatibleClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "render-worker", capabilities: ["DOCUMENT_RENDER"] },
    });
    expect(incompatibleClaim.statusCode).toBe(409);
    expect(incompatibleClaim.json().error).toBe("CAPABILITY_MISMATCH");
    const blockedClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${sealJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "seal-worker", capabilities: ["ANALYSIS_SEAL_UNSUPPORTED"] },
    });
    expect(blockedClaim.statusCode).toBe(200);
    expect(blockedClaim.json()).toEqual({ status: "NOT_READY", state: "BLOCKED" });
    const claim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "integration-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({
      status: "ACQUIRED",
      lease: {
        jobId: inventoryJob.id,
        jobType: "ANALYSIS_INVENTORY",
        attemptNumber: 1,
        fencingToken: 1,
        release: {
          lifecycle: "SCAFFOLD",
          externalNetworkAllowed: false,
          providerSlot: null,
        },
        inputs: {
          sourceFiles: [{ sourceFileId: commandFile.id, sha256: commandFile.sha256, stages: ["PD"] }],
        },
      },
    });
    const attempt = {
      attemptId: claim.json().lease.attemptId as string,
      fencingToken: claim.json().lease.fencingToken as number,
    };
    const staleComplete = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: { ...attempt, fencingToken: attempt.fencingToken + 1 },
    });
    expect(staleComplete.statusCode).toBe(409);
    expect(staleComplete.json().error).toBe("STALE_ATTEMPT");
    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/heartbeat`,
      headers: { "x-worker-token": workerToken },
      payload: attempt,
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().status).toBe("LEASE_EXTENDED");
    const completedJob = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...attempt,
        result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 } },
      },
    });
    expect(completedJob.statusCode).toBe(200);
    expect(completedJob.json()).toMatchObject({
      status: "COMPLETED",
      replayed: false,
      check: { id: started.json().id, status: "PROCESSING", progress: 11 },
    });
    const activatedJobs = await database.query<{ job_type: string; state: string }>(
      `SELECT job_type, state FROM analysis_jobs WHERE run_id = $1 ORDER BY job_type`,
      [inventoryJob.run_id],
    );
    expect(activatedJobs.rows).toHaveLength(9);
    expect(activatedJobs.rows.find((job) => job.job_type === "ANALYSIS_INVENTORY")?.state).toBe("SUCCEEDED");
    expect(activatedJobs.rows.find((job) => job.job_type === "DOCUMENT_TEXT_LAYER")?.state).toBe("READY");
    expect(activatedJobs.rows.filter((job) => ![
      "ANALYSIS_INVENTORY",
      "DOCUMENT_TEXT_LAYER",
    ].includes(job.job_type)).every((job) => job.state === "BLOCKED")).toBe(true);
    const textClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "document-worker", capabilities: ["DOCUMENT_TEXT_LAYER"] },
    });
    expect(textClaim.statusCode).toBe(200);
    expect(textClaim.json()).toMatchObject({
      status: "ACQUIRED",
      lease: {
        jobId: textLayerJob.id,
        jobType: "DOCUMENT_TEXT_LAYER",
        release: { textLayer: {
          artifactSchemaVersion: "document-text-v2",
          qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        } },
        inputs: {
          sourceFiles: [{
            sourceFileId: commandFile.id,
            sha256: commandFile.sha256,
            byteSize: commandFile.size,
            mediaType: commandFile.mimeType,
            downloadPath: `/api/internal/v1/jobs/${textLayerJob.id}/inputs/${commandFile.id}`,
          }],
        },
      },
    });
    const textAttempt = {
      attemptId: textClaim.json().lease.attemptId as string,
      fencingToken: textClaim.json().lease.fencingToken as number,
    };
    expect((await app.inject({
      method: "GET",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/inputs/${commandFile.id}?attemptId=${textAttempt.attemptId}&fencingToken=${textAttempt.fencingToken}`,
    })).statusCode).toBe(401);
    const downloadedInput = await app.inject({
      method: "GET",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/inputs/${commandFile.id}?attemptId=${textAttempt.attemptId}&fencingToken=${textAttempt.fencingToken}`,
      headers: { "x-worker-token": workerToken },
    });
    expect(downloadedInput.statusCode).toBe(200);
    expect(downloadedInput.headers["x-content-sha256"]).toBe(commandFile.sha256);
    expect(downloadedInput.rawPayload).toEqual(Buffer.alloc(commandFile.size, 1));
    const textArtifact = {
      schemaVersion: "document-text-v2",
      sourceFileId: commandFile.id,
      inputSha256: commandFile.sha256,
      coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1,
      textPageCount: 1,
      qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
      qualitySummary: {
        textLayerCandidatePageCount: 1,
        ocrRequiredPageCount: 0,
      },
      pages: [{
        pageNumber: 1,
        widthMilliPoints: 595_000,
        heightMilliPoints: 842_000,
        blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: "Проектная документация" }],
        quality: {
          disposition: "TEXT_LAYER_CANDIDATE",
          reasonCodes: [],
          metrics: {
            blockCount: 1,
            nonWhitespaceCharacterCount: 21,
            alphanumericCharacterCount: 21,
            replacementCharacterCount: 0,
            disallowedControlCharacterCount: 0,
          },
        },
      }],
    };
    const ocrRequiredTextArtifact = {
      schemaVersion: "document-text-v2",
      sourceFileId: commandFile.id,
      inputSha256: commandFile.sha256,
      coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1,
      textPageCount: 0,
      qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
      qualitySummary: { textLayerCandidatePageCount: 0, ocrRequiredPageCount: 1 },
      pages: [{
        pageNumber: 1,
        widthMilliPoints: 595_000,
        heightMilliPoints: 842_000,
        blocks: [],
        quality: {
          disposition: "OCR_REQUIRED",
          reasonCodes: ["EMPTY_TEXT_LAYER"],
          metrics: {
            blockCount: 0, nonWhitespaceCharacterCount: 0, alphanumericCharacterCount: 0,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          },
        },
      }],
    };
    const invalidTextPolicy = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...textAttempt,
        result: {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          sources: [{
            sourceFileId: commandFile.id,
            inputSha256: commandFile.sha256,
            status: "EXTRACTED",
            artifact: { ...textArtifact, qualityPolicyVersion: "text-layer-quality-v1" },
          }],
        },
      },
    });
    expect(invalidTextPolicy.statusCode).toBe(409);
    expect(invalidTextPolicy.json().error).toBe("INVALID_JOB_RESULT");
    const invalidTextQuality = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...textAttempt,
        result: {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          sources: [{
            sourceFileId: commandFile.id,
            inputSha256: commandFile.sha256,
            status: "EXTRACTED",
            artifact: {
              ...textArtifact,
              pages: [{
                ...textArtifact.pages[0],
                quality: {
                  ...textArtifact.pages[0].quality,
                  metrics: {
                    ...textArtifact.pages[0].quality.metrics,
                    alphanumericCharacterCount: 20,
                  },
                },
              }],
            },
          }],
        },
      },
    });
    expect(invalidTextQuality.statusCode).toBe(409);
    expect(invalidTextQuality.json().error).toBe("INVALID_JOB_RESULT");
    const invalidText = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...textAttempt,
        result: {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          sources: [{
            sourceFileId: commandFile.id,
            inputSha256: commandFile.sha256,
            status: "EXTRACTED",
            artifact: {
              ...textArtifact,
              pages: [{
                ...textArtifact.pages[0],
                blocks: [{ bboxMilliPoints: [10_000, 20_000, 700_000, 40_000], text: "За границей листа" }],
              }],
            },
          }],
        },
      },
    });
    expect(invalidText.statusCode).toBe(409);
    expect(invalidText.json().error).toBe("INVALID_JOB_RESULT");
    const completedText = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${textLayerJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...textAttempt,
        result: {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          workerId: "document-worker",
          sources: [{
            sourceFileId: commandFile.id,
            inputSha256: commandFile.sha256,
            status: "EXTRACTED",
            artifact: textArtifact,
          }],
        },
      },
    });
    expect(completedText.statusCode).toBe(200);
    expect(completedText.json()).toMatchObject({
      status: "COMPLETED",
      check: { id: started.json().id, status: "PROCESSING", progress: 23 },
    });
    const storedText = await database.query<{
      schema_version: string;
      content_hash: string;
      byte_size: string;
      content_json: Record<string, unknown>;
    }>(
      `SELECT schema_version, content_hash, byte_size, content_json
       FROM analysis_text_artifacts
       WHERE job_id = $1`,
      [textLayerJob.id],
    );
    expect(storedText.rows).toHaveLength(1);
    expect(storedText.rows[0].schema_version).toBe("document-text-v2");
    expect(storedText.rows[0].content_hash.trim()).toBe(sha256(canonicalJson(textArtifact)));
    expect(Number(storedText.rows[0].byte_size)).toBe(Buffer.byteLength(canonicalJson(textArtifact)));
    expect(storedText.rows[0].content_json).toEqual(textArtifact);
    await expect(database.query(
      `UPDATE analysis_text_artifacts SET text_page_count = 0 WHERE job_id = $1`,
      [textLayerJob.id],
    )).rejects.toThrow(/append-only/i);
    const compactTextResult = await database.query<{ result_json: Record<string, unknown> }>(
      `SELECT result_json FROM analysis_jobs WHERE id = $1`,
      [textLayerJob.id],
    );
    expect(compactTextResult.rows[0].result_json).toMatchObject({
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      extractedCount: 1,
      skippedCount: 0,
      ocrRequiredPageCount: 0,
      sources: [{ sourceFileId: commandFile.id, contentHash: sha256(canonicalJson(textArtifact)) }],
    });
    expect((compactTextResult.rows[0].result_json.sources as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      "artifact",
    );
    expect((await database.query(
      `SELECT id FROM analysis_jobs WHERE run_id = $1 AND job_type = 'DOCUMENT_OCR_LAYOUT'`,
      [inventoryJob.run_id],
    )).rows).toHaveLength(0);
    const scaffoldJobIds = await completeScaffoldStages(app, database, inventoryJob.run_id, workerToken, {
      sourceFileId: commandFile.id,
      inputSha256: commandFile.sha256,
      artifact: textArtifact,
    });
    expect(scaffoldJobIds).toHaveLength(6);
    await expect(database.query(
      `UPDATE analysis_stage_artifacts SET output_count = 1 WHERE job_id = $1`,
      [scaffoldJobIds[0]],
    )).rejects.toThrow(/append-only/i);
    const sealClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${sealJob.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "seal-worker", capabilities: ["ANALYSIS_SEAL_UNSUPPORTED"] },
    });
    expect(sealClaim.statusCode).toBe(200);
    expect(sealClaim.json()).toMatchObject({
      status: "ACQUIRED",
      lease: { jobId: sealJob.id, jobType: "ANALYSIS_SEAL_UNSUPPORTED", attemptNumber: 1, fencingToken: 1 },
    });
    const sealAttempt = {
      attemptId: sealClaim.json().lease.attemptId as string,
      fencingToken: sealClaim.json().lease.fencingToken as number,
    };
    const sealedJob = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${sealJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: { ...sealAttempt, result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" } },
    });
    expect(sealedJob.statusCode).toBe(200);
    expect(sealedJob.json()).toMatchObject({
      status: "COMPLETED",
      replayed: false,
      check: { id: started.json().id, status: "PARTIAL", stats: { unsupported: 132 } },
    });
    const completionOutbox = await database.query<{ event_type: string; event_count: string }>(
      `SELECT event_type, count(*) AS event_count
       FROM domain_outbox
       WHERE payload ->> 'run_id' = $1
       GROUP BY event_type
       ORDER BY event_type`,
      [inventoryJob.run_id],
    );
    expect(completionOutbox.rows).toEqual([
      { event_type: "analysis.sealed", event_count: "1" },
      { event_type: "analysis.started", event_count: "1" },
      { event_type: "job.ready", event_count: "9" },
      { event_type: "stage.finished", event_count: "8" },
    ]);
    const replayedComplete = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${inventoryJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        ...attempt,
        result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 } },
      },
    });
    expect(replayedComplete.statusCode).toBe(200);
    expect(replayedComplete.headers["idempotency-replayed"]).toBe("true");
    expect(replayedComplete.json()).toMatchObject({ status: "COMPLETED", replayed: true });
    const replayedSeal = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${sealJob.id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: { ...sealAttempt, result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" } },
    });
    expect(replayedSeal.statusCode).toBe(200);
    expect(replayedSeal.headers["idempotency-replayed"]).toBe("true");

    const reprocessKey = `reprocess-${randomUUID()}`;
    const reprocessHeaders = {
      cookie: reviewerSession.cookie,
      "x-csrf-token": reviewerSession.csrf,
      "idempotency-key": reprocessKey,
    };
    const reprocessed = await app.inject({
      method: "POST",
      url: `/api/checks/${started.json().id}/reprocess`,
      headers: reprocessHeaders,
    });
    expect(reprocessed.statusCode).toBe(200);
    expect(reprocessed.json()).toMatchObject({ objectId: createdObject.json().id, status: "PROCESSING", progress: 0 });
    const replayedReprocess = await app.inject({
      method: "POST",
      url: `/api/checks/${started.json().id}/reprocess`,
      headers: reprocessHeaders,
    });
    expect(replayedReprocess.statusCode).toBe(200);
    expect(replayedReprocess.headers["idempotency-replayed"]).toBe("true");
    expect(replayedReprocess.json()).toEqual(reprocessed.json());

    const retriedJob = await database.query<{ id: string }>(
      `SELECT job.id
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1 AND job.job_type = 'ANALYSIS_INVENTORY'`,
      [reprocessed.json().id],
    );
    const retriedJobId = retriedJob.rows[0].id;
    const firstAttempt = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedJobId}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "expired-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    expect(firstAttempt.statusCode).toBe(200);
    await database.query(
      `UPDATE analysis_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`,
      [retriedJobId],
    );
    const relay = new OutboxRelay(connectionString, "amqp://unused");
    try {
      await relay.recoverDueJobsOnce();
    } finally {
      await relay.close();
    }
    const recoveredJob = await database.query<{ state: string; current_attempt_id: string | null }>(
      `SELECT state, current_attempt_id FROM analysis_jobs WHERE id = $1`,
      [retriedJobId],
    );
    expect(recoveredJob.rows).toEqual([{ state: "READY", current_attempt_id: null }]);
    const expiredAttempt = await database.query<{ state: string; error_code: string }>(
      `SELECT state, error_code FROM job_attempts WHERE id = $1`,
      [firstAttempt.json().lease.attemptId],
    );
    expect(expiredAttempt.rows).toEqual([{ state: "EXPIRED", error_code: "LEASE_EXPIRED" }]);
    const recoveredEvent = await database.query<{
      state: string;
      exchange_name: string;
      routing_key: string;
      job_id: string;
    }>(
      `SELECT state, exchange_name, routing_key, payload ->> 'job_id' AS job_id
       FROM domain_outbox
       WHERE event_type = 'job.ready' AND aggregate_id = $1 AND aggregate_version = 2`,
      [retriedJobId],
    );
    expect(recoveredEvent.rows).toEqual([{
      state: "PENDING",
      exchange_name: "inspector.jobs",
      routing_key: "rules.evaluate",
      job_id: retriedJobId,
    }]);
    const replacementAttempt = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedJobId}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "replacement-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    expect(replacementAttempt.statusCode).toBe(200);
    expect(replacementAttempt.json()).toMatchObject({
      status: "ACQUIRED",
      lease: { attemptNumber: 2, fencingToken: 3 },
    });
    const staleWorkerResult = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedJobId}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: firstAttempt.json().lease.attemptId,
        fencingToken: firstAttempt.json().lease.fencingToken,
      },
    });
    expect(staleWorkerResult.statusCode).toBe(409);
    expect(staleWorkerResult.json().error).toBe("STALE_ATTEMPT");
    const replacementResult = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedJobId}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: replacementAttempt.json().lease.attemptId,
        fencingToken: replacementAttempt.json().lease.fencingToken,
        result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 } },
      },
    });
    expect(replacementResult.statusCode).toBe(200);
    expect(replacementResult.json()).toMatchObject({ status: "COMPLETED", check: { status: "PROCESSING" } });
    const retriedTextJob = await database.query<{ id: string; run_id: string }>(
      `SELECT job.id, job.run_id
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1 AND job.job_type = 'DOCUMENT_TEXT_LAYER'`,
      [reprocessed.json().id],
    );
    const retriedTextClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedTextJob.rows[0].id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "replacement-document-worker", capabilities: ["DOCUMENT_TEXT_LAYER"] },
    });
    const retriedTextResult = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedTextJob.rows[0].id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: retriedTextClaim.json().lease.attemptId,
        fencingToken: retriedTextClaim.json().lease.fencingToken,
        result: {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          sources: [{
            sourceFileId: commandFile.id,
            inputSha256: commandFile.sha256,
            status: "EXTRACTED",
            artifact: ocrRequiredTextArtifact,
          }],
        },
      },
    });
    expect(retriedTextResult.statusCode).toBe(200);
    expect(retriedTextResult.json()).toMatchObject({ status: "COMPLETED", check: { progress: 21 } });
    const retriedTextSchema = await database.query<{ schema_version: string }>(
      `SELECT schema_version FROM analysis_text_artifacts WHERE job_id = $1`,
      [retriedTextJob.rows[0].id],
    );
    expect(retriedTextSchema.rows[0].schema_version).toBe("document-text-v2");
    const insertedOcr = await database.query<{ id: string; state: string }>(
      `SELECT id, state
       FROM analysis_jobs
       WHERE run_id = $1 AND job_type = 'DOCUMENT_OCR_LAYOUT'`,
      [retriedTextJob.rows[0].run_id],
    );
    expect(insertedOcr.rows).toEqual([{ id: expect.any(String), state: "BLOCKED" }]);
    const ocrDependencies = await database.query<{ job_type: string; prerequisite_job_type: string }>(
      `SELECT child.job_type, prerequisite.job_type AS prerequisite_job_type
       FROM analysis_job_dependencies dependency
       JOIN analysis_jobs child ON child.id = dependency.job_id
       JOIN analysis_jobs prerequisite ON prerequisite.id = dependency.prerequisite_job_id
       WHERE dependency.run_id = $1
         AND (child.job_type = 'DOCUMENT_OCR_LAYOUT' OR prerequisite.job_type = 'DOCUMENT_OCR_LAYOUT')`,
      [retriedTextJob.rows[0].run_id],
    );
    expect(ocrDependencies.rows).toEqual(expect.arrayContaining([
      { job_type: "DOCUMENT_OCR_LAYOUT", prerequisite_job_type: "DOCUMENT_RENDER" },
      { job_type: "DOCUMENT_METADATA", prerequisite_job_type: "DOCUMENT_OCR_LAYOUT" },
    ]));
    expect(await completeScaffoldStages(
      app,
      database,
      retriedTextJob.rows[0].run_id,
      workerToken,
    )).toHaveLength(7);
    const retriedSealJob = await database.query<{ id: string }>(
      `SELECT job.id
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1 AND job.job_type = 'ANALYSIS_SEAL_UNSUPPORTED'`,
      [reprocessed.json().id],
    );
    const retriedSealClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedSealJob.rows[0].id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "replacement-worker", capabilities: ["ANALYSIS_SEAL_UNSUPPORTED"] },
    });
    const retriedSealResult = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${retriedSealJob.rows[0].id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: retriedSealClaim.json().lease.attemptId,
        fencingToken: retriedSealClaim.json().lease.fencingToken,
        result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" },
      },
    });
    expect(retriedSealResult.statusCode).toBe(200);
    expect(retriedSealResult.json()).toMatchObject({ status: "COMPLETED", check: { status: "PARTIAL" } });

    const cancellableRun = await repository.reprocess(reprocessed.json().id);
    expect(cancellableRun).toMatchObject({ status: "PROCESSING", progress: 0 });
    const cancellableJob = await database.query<{ id: string; run_id: string }>(
      `SELECT job.id, run.id AS run_id
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1 AND job.job_type = 'ANALYSIS_INVENTORY'`,
      [cancellableRun!.id],
    );
    const cancellableClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${cancellableJob.rows[0].id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "cancelled-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    expect(cancellableClaim.statusCode).toBe(200);
    await database.query(
      `UPDATE analysis_runs SET run_state = 'CANCELLED' WHERE id = $1`,
      [cancellableJob.rows[0].run_id],
    );
    const cancelledHeartbeat = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${cancellableJob.rows[0].id}/heartbeat`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: cancellableClaim.json().lease.attemptId,
        fencingToken: cancellableClaim.json().lease.fencingToken,
      },
    });
    expect(cancelledHeartbeat.statusCode).toBe(200);
    expect(cancelledHeartbeat.json()).toEqual({ status: "ALREADY_TERMINAL", state: "CANCELLED" });
    const cancelledState = await database.query<{ job_state: string; attempt_state: string }>(
      `SELECT job.state AS job_state, attempt.state AS attempt_state
       FROM analysis_jobs job
       JOIN job_attempts attempt ON attempt.job_id = job.id
       WHERE job.id = $1`,
      [cancellableJob.rows[0].id],
    );
    expect(cancelledState.rows[0]).toEqual({ job_state: "CANCELLED", attempt_state: "CANCELLED" });
    const cancelledComplete = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${cancellableJob.rows[0].id}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: cancellableClaim.json().lease.attemptId,
        fencingToken: cancellableClaim.json().lease.fencingToken,
      },
    });
    expect(cancelledComplete.statusCode).toBe(200);
    expect(cancelledComplete.json()).toEqual({ status: "ALREADY_TERMINAL", state: "CANCELLED" });

    const failingRun = await repository.reprocess(cancellableRun!.id);
    expect(failingRun).toMatchObject({ status: "PROCESSING", progress: 0 });
    const failingJobs = await database.query<{ id: string; run_id: string; job_type: string }>(
      `SELECT job.id, job.run_id, job.job_type
       FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id
       WHERE run.api_id = $1
       ORDER BY job.job_type`,
      [failingRun!.id],
    );
    const failingInventory = failingJobs.rows.find((job) => job.job_type === "ANALYSIS_INVENTORY")!;
    const cancelledText = failingJobs.rows.find((job) => job.job_type === "DOCUMENT_TEXT_LAYER")!;
    const cancelledSeal = failingJobs.rows.find((job) => job.job_type === "ANALYSIS_SEAL_UNSUPPORTED")!;
    const retryClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${failingInventory.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "retry-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    const retryFailure = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${failingInventory.id}/fail`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: retryClaim.json().lease.attemptId,
        fencingToken: retryClaim.json().lease.fencingToken,
        errorCode: "TRANSIENT_NETWORK",
        message: "temporary integration failure",
      },
    });
    expect(retryFailure.statusCode).toBe(200);
    expect(retryFailure.json().status).toBe("RETRY_SCHEDULED");
    await database.query(
      `UPDATE analysis_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
      [failingInventory.id],
    );
    const terminalClaim = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${failingInventory.id}/claim`,
      headers: { "x-worker-token": workerToken },
      payload: { workerId: "terminal-worker", capabilities: ["ANALYSIS_INVENTORY"] },
    });
    expect(terminalClaim.json()).toMatchObject({
      status: "ACQUIRED",
      lease: { attemptNumber: 2, fencingToken: 2 },
    });
    const terminalFailure = await app.inject({
      method: "POST",
      url: `/api/internal/v1/jobs/${failingInventory.id}/fail`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: terminalClaim.json().lease.attemptId,
        fencingToken: terminalClaim.json().lease.fencingToken,
        errorCode: "WORKER_EXECUTION_ERROR",
        message: "terminal integration failure",
      },
    });
    expect(terminalFailure.statusCode).toBe(200);
    expect(terminalFailure.json()).toEqual({ status: "FAILED" });
    const failedDag = await database.query<{
      run_state: string;
      event_version: string;
      inventory_state: string;
      text_state: string;
      text_error: string;
      seal_state: string;
      seal_error: string;
    }>(
       `SELECT run.run_state, run.event_version,
              inventory.state AS inventory_state,
              text_layer.state AS text_state,
              text_layer.last_error_code AS text_error,
              seal.state AS seal_state,
              seal.last_error_code AS seal_error
       FROM analysis_runs run
       JOIN analysis_jobs inventory
         ON inventory.run_id = run.id AND inventory.job_type = 'ANALYSIS_INVENTORY'
       JOIN analysis_jobs text_layer
         ON text_layer.run_id = run.id AND text_layer.job_type = 'DOCUMENT_TEXT_LAYER'
       JOIN analysis_jobs seal
         ON seal.run_id = run.id AND seal.job_type = 'ANALYSIS_SEAL_UNSUPPORTED'
       WHERE run.id = $1`,
      [failingInventory.run_id],
    );
    expect(failedDag.rows[0]).toMatchObject({
      run_state: "FAILED",
      inventory_state: "FAILED",
      text_state: "CANCELLED",
      text_error: "PREREQUISITE_FAILED",
      seal_state: "CANCELLED",
      seal_error: "PREREQUISITE_FAILED",
    });
    expect(Number(failedDag.rows[0].event_version)).toBe(2);
    const cancelledDescendants = await database.query<{
      cancelled_count: string;
      all_prerequisite_failed: boolean;
    }>(
      `SELECT
         count(*) FILTER (WHERE state = 'CANCELLED') AS cancelled_count,
         bool_and(last_error_code = 'PREREQUISITE_FAILED') FILTER (WHERE state = 'CANCELLED')
           AS all_prerequisite_failed
       FROM analysis_jobs
       WHERE run_id = $1 AND job_type <> 'ANALYSIS_INVENTORY'`,
      [failingInventory.run_id],
    );
    expect(cancelledDescendants.rows[0]).toEqual({
      cancelled_count: "8",
      all_prerequisite_failed: true,
    });
    const failureEvent = await database.query<{ event_type: string; aggregate_version: string; error_code: string }>(
      `SELECT event_type, aggregate_version, payload ->> 'error_code' AS error_code
       FROM domain_outbox
       WHERE payload ->> 'run_id' = $1 AND payload ->> 'outcome' = 'FAILED'`,
      [failingInventory.run_id],
    );
    expect(failureEvent.rows).toEqual([{
      event_type: "stage.finished",
      aggregate_version: "2",
      error_code: "WORKER_EXECUTION_ERROR",
    }]);
    expect(cancelledSeal.id).toBeDefined();
    expect(cancelledText.id).toBeDefined();

    await database.query(
      `UPDATE object_memberships membership
       SET revoked_at = now()
       FROM objects object
       WHERE membership.object_id = object.id
         AND object.api_id = $1
         AND membership.user_id = $2`,
      [createdObject.json().id, reviewer.id],
    );
    expect(await repository.startCheckCommand(createdObject.json().id, {
      actor: reviewerActor!,
      idempotencyKey: startKey,
      requestId: `request-${randomUUID()}`,
      traceId: `trace-${randomUUID()}`,
    })).toEqual({ kind: "not_found" });
    expect(await repository.registerIngestedFilesCommand(
      createdObject.json().id,
      [commandFile],
      uploadCommand,
    )).toEqual({ kind: "not_found" });

    const commandPersistence = await database.query<{
      objects: string | number;
      receipts: string | number;
      audits: string | number;
    }>(
      `SELECT
         (SELECT count(*) FROM objects WHERE api_id = $1) AS objects,
         (SELECT count(*) FROM command_receipts
          WHERE idempotency_key = ANY($2::text[])) AS receipts,
         (SELECT count(*) FROM audit_events
          WHERE object_id = (SELECT id FROM objects WHERE api_id = $1)
            AND action = ANY(ARRAY['OBJECT_CREATE', 'DOCUMENT_UPLOAD', 'RUN_START', 'RUN_REPROCESS'])) AS audits`,
      [createdObject.json().id, [createKey, uploadKey, startKey, reprocessKey]],
    );
    expect(commandPersistence.rows[0]).toMatchObject({ objects: "1", receipts: "4", audits: "4" });
    for (const url of [
      `/api/objects/${object.id}/files?stage=PD`,
      `/api/objects/${object.id}/checks`,
      `/api/checks/${run!.id}/reprocess`,
      `/api/checks/${run!.id}/finalize`,
    ]) {
      expect((await app.inject({
        method: "POST",
        url,
        headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
      })).statusCode, url).toBe(403);
    }

    const finding = await app.inject({
      method: "GET",
      url: `/api/findings/${findingApiId}`,
      headers: { cookie: reviewerSession.cookie },
    });
    expect(finding.statusCode).toBe(200);
    expect(finding.headers.etag).toBe('"review-1"');

    const withoutCsrf = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: {
        cookie: reviewerSession.cookie,
        "if-match": finding.headers.etag!,
        "idempotency-key": `decision-${randomUUID()}`,
      },
      payload: { type: "CONFIRM", reason: "Подтверждено по исходным документам" },
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const withoutPreconditions = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
      payload: { type: "CONFIRM", reason: "Подтверждено по исходным документам" },
    });
    expect(withoutPreconditions.statusCode).toBe(428);

    const idempotencyKey = `decision-${randomUUID()}`;
    const decisionHeaders = {
      cookie: reviewerSession.cookie,
      "x-csrf-token": reviewerSession.csrf,
      "if-match": finding.headers.etag!,
      "idempotency-key": idempotencyKey,
    };
    const accepted = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: decisionHeaders,
      payload: {
        type: "CONFIRM",
        reason: "Подтверждено по исходным документам",
        author: "Подменённый actor клиента",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers.etag).toBe('"review-2"');
    expect(accepted.json()).toMatchObject({
      status: "CONFIRMED_VIOLATION",
      decision: { author: "Integration Reviewer" },
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: decisionHeaders,
      payload: {
        type: "CONFIRM",
        reason: "Подтверждено по исходным документам",
        author: "Другая клиентская подпись",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(accepted.json());

    const conflict = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: decisionHeaders,
      payload: { type: "REJECT", reason: "Другой смысл команды с тем же ключом" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("IDEMPOTENCY_CONFLICT");

    const stale = await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: { ...decisionHeaders, "idempotency-key": `decision-${randomUUID()}` },
      payload: { type: "REJECT", reason: "Версия уже устарела после первого решения" },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.headers.etag).toBe('"review-2"');

    const readOnlyLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: readOnly.login, password },
    });
    const readOnlySession = sessionCookies(readOnlyLogin);
    expect((await app.inject({
      method: "GET",
      url: `/api/findings/${findingApiId}`,
      headers: { cookie: readOnlySession.cookie },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/findings/${findingApiId}/decision`,
      headers: {
        cookie: readOnlySession.cookie,
        "x-csrf-token": readOnlySession.csrf,
        "if-match": '"review-2"',
        "idempotency-key": `decision-${randomUUID()}`,
      },
      payload: { type: "REJECT", reason: "У пользователя нет capability для решения" },
    })).statusCode).toBe(403);

    const outOfScopeLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: outOfScope.login, password },
    });
    const outOfScopeSession = sessionCookies(outOfScopeLogin);
    const outOfScopeList = await app.inject({
      method: "GET",
      url: "/api/objects",
      headers: { cookie: outOfScopeSession.cookie },
    });
    expect(outOfScopeList.statusCode).toBe(200);
    expect(outOfScopeList.json().items).toEqual([]);
    for (const url of scopedReadUrls) {
      expect((await app.inject({
        method: "GET",
        url,
        headers: { cookie: outOfScopeSession.cookie },
      })).statusCode, url).toBe(404);
    }

    const mlLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "127.0.0.2",
      payload: { login: mlEngineer.login, password },
    });
    const mlSession = sessionCookies(mlLogin);
    expect((await app.inject({
      method: "GET",
      url: `/api/objects/${object.id}`,
      headers: { cookie: mlSession.cookie },
    })).statusCode).toBe(200);
    for (const url of [
      `/api/objects/${object.id}/files?stage=PD`,
      `/api/objects/${object.id}/checks`,
      `/api/checks/${run!.id}/reprocess`,
      `/api/checks/${run!.id}/finalize`,
    ]) {
      expect((await app.inject({
        method: "POST",
        url,
        headers: { cookie: mlSession.cookie, "x-csrf-token": mlSession.csrf },
      })).statusCode, url).toBe(403);
    }

    const competitorLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: competingReviewer.login, password },
    });
    const competitorSession = sessionCookies(competitorLogin);
    const race = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/findings/${findingApiId}/decision`,
        headers: {
          cookie: reviewerSession.cookie,
          "x-csrf-token": reviewerSession.csrf,
          "if-match": '"review-2"',
          "idempotency-key": `decision-${randomUUID()}`,
        },
        payload: { type: "REJECT", reason: "Первое конкурирующее решение инспектора" },
      }),
      app.inject({
        method: "POST",
        url: `/api/findings/${findingApiId}/decision`,
        headers: {
          cookie: competitorSession.cookie,
          "x-csrf-token": competitorSession.csrf,
          "if-match": '"review-2"',
          "idempotency-key": `decision-${randomUUID()}`,
        },
        payload: { type: "CLARIFY", reason: "Второе конкурирующее решение инспектора" },
      }),
    ]);
    expect(race.map((response) => response.statusCode).sort()).toEqual([200, 412]);

    const persisted = await database.query<{
      decisions: string | number;
      receipts: string | number;
      audits: string | number;
      chained: string | number;
    }>(
      `SELECT
         (SELECT count(*) FROM review_decisions decision
          JOIN review_items item ON item.id = decision.review_item_id
          WHERE item.api_id = $1) AS decisions,
         (SELECT count(*) FROM command_receipts WHERE target_id = $1) AS receipts,
         (SELECT count(*) FROM audit_events WHERE target_id = $1) AS audits,
         (SELECT count(*) FROM audit_events WHERE target_id = $1 AND previous_event_hash IS NOT NULL) AS chained`,
      [findingApiId],
    );
    expect(persisted.rows[0]).toMatchObject({
      decisions: "2",
      receipts: "2",
      audits: "2",
      chained: "2",
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: reviewerSession.cookie, "x-csrf-token": reviewerSession.csrf },
    });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: reviewerSession.cookie },
    })).statusCode).toBe(401);

    const rotatedPassword = "Rotated-Integration-Password-2026!";
    await provisionLocalUser(database, {
      organizationSlug,
      login: reviewer.login,
      displayName: "Integration Reviewer",
      password: rotatedPassword,
      capabilities: ["REVIEW_DECIDE"],
      objectApiIds: [],
    });
    const rotatedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "127.0.0.3",
      payload: { login: reviewer.login, password: rotatedPassword },
    });
    expect(rotatedLogin.statusCode).toBe(200);
    const rotatedSession = sessionCookies(rotatedLogin);
    expect((await app.inject({
      method: "GET",
      url: `/api/findings/${findingApiId}`,
      headers: { cookie: rotatedSession.cookie },
    })).statusCode).toBe(404);
  }, 30_000);

  it("finalizes a partial run atomically with optimistic concurrency and durable replay", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `finalize-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString,
      parameters: reference.parameters,
      organizationSlug,
      organizationName: "Finalize command integration",
    });
    const object = await repository.createObject({ name: "Объект финализации", address: "г. Москва" });
    const file = {
      id: `FIL-${randomUUID()}`,
      name: "finalize.pdf",
      size: 48,
      stage: "PD" as const,
      mimeType: "application/pdf",
      sha256: "4".repeat(64),
      scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"4".repeat(64)}/finalize.pdf`,
    };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const run = await repository.startCheck(object.id);
    expect(run).toBeDefined();
    expect(await repository.completeCheck(run!.id)).toMatchObject({ status: "PARTIAL" });

    const database = new Pool({ connectionString, max: 3 });
    openPools.push(database);
    const finalizer = await provisionLocalUser(database, {
      organizationSlug,
      login: `finalizer-${randomUUID()}`,
      displayName: "Integration Finalizer",
      password: "Finalize-Password-2026!",
      role: "INSPECTOR",
      capabilities: ["FINALIZE"],
      objectApiIds: [object.id],
      objectPermissions: ["READ", "FINALIZE"],
    });
    const revoker = await provisionLocalUser(database, {
      organizationSlug,
      login: `revoker-${randomUUID()}`,
      displayName: "Integration Supervisor",
      password: "Revoke-Password-2026!",
      role: "SUPERVISOR",
      capabilities: [],
      objectApiIds: [object.id],
      objectPermissions: ["READ", "REVOKE"],
    });
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, identityService: identity });
    openApps.push(app);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: finalizer.login, password: "Finalize-Password-2026!" },
    });
    expect(login.statusCode).toBe(200);
    const session = sessionCookies(login);
    const current = await app.inject({
      method: "GET",
      url: `/api/checks/${run!.id}`,
      headers: { cookie: session.cookie },
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers.etag).toMatch(/^"inspection-[1-9][0-9]*"$/);
    expect(current.json()).toMatchObject({
      id: run!.id,
      status: "PARTIAL",
      decisionSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      gapsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const currentBody = current.json();
    const payload = {
      runId: run!.id,
      decisionSetHash: currentBody.decisionSetHash,
      acknowledgedGapsHash: currentBody.gapsHash,
      acknowledgementReason: "Разрешён выпуск неполного протокола для пилотной проверки",
    };
    const baseHeaders = {
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
    };

    const withoutPreconditions = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: baseHeaders,
      payload,
    });
    expect(withoutPreconditions.statusCode).toBe(428);

    const currentVersion = Number(/inspection-(\d+)/.exec(current.headers.etag!)![1]);
    const stale = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: {
        ...baseHeaders,
        "if-match": `"inspection-${currentVersion + 99}"`,
        "idempotency-key": `finalize-${randomUUID()}`,
      },
      payload,
    });
    expect(stale.statusCode).toBe(412);

    const changedGaps = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: {
        ...baseHeaders,
        "if-match": current.headers.etag!,
        "idempotency-key": `finalize-${randomUUID()}`,
      },
      payload: { ...payload, acknowledgedGapsHash: "5".repeat(64) },
    });
    expect(changedGaps.statusCode).toBe(409);
    expect(changedGaps.json().error).toBe("GAPS_CHANGED");

    const idempotencyKey = `finalize-${randomUUID()}`;
    const commandHeaders = {
      ...baseHeaders,
      "if-match": current.headers.etag!,
      "idempotency-key": idempotencyKey,
    };
    const finalized = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: commandHeaders,
      payload,
    });
    expect(finalized.statusCode).toBe(201);
    expect(finalized.headers.etag).toMatch(/^"inspection-[1-9][0-9]*"$/);
    expect(finalized.json()).toMatchObject({
      checkId: run!.id,
      version: 1,
      status: "FINAL",
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      canonicalArtifact: {
        format: "JSON",
        mediaType: "application/json",
        canonicalizationVersion: "inspector-c14n-v1",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });

    const replay = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: commandHeaders,
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(finalized.json());

    const conflict = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: commandHeaders,
      payload: { ...payload, acknowledgementReason: "Другое основание с тем же ключом команды" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("IDEMPOTENCY_CONFLICT");

    const secondFinalize = await app.inject({
      method: "POST",
      url: `/api/checks/${run!.id}/finalize`,
      headers: {
        ...baseHeaders,
        "if-match": finalized.headers.etag!,
        "idempotency-key": `finalize-${randomUUID()}`,
      },
      payload,
    });
    expect(secondFinalize.statusCode).toBe(409);
    expect(secondFinalize.json().error).toBe("INVALID_TRANSITION");

    const after = await app.inject({
      method: "GET",
      url: `/api/checks/${run!.id}`,
      headers: { cookie: session.cookie },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().status).toBe("FINALIZED");
    expect(after.headers.etag).toBe(finalized.headers.etag);

    const exported = await app.inject({
      method: "GET",
      url: `/api/protocols/${finalized.json().id}/export`,
      headers: { cookie: session.cookie },
    });
    expect(exported.statusCode).toBe(200);
    const exportedBody = exported.json();
    const { snapshotHash, validity, revocation, ...snapshot } = exportedBody;
    expect(snapshotHash).toBe(finalized.json().snapshotHash);
    expect(validity).toBe("VALID");
    expect(revocation).toBeNull();
    expect(sha256(canonicalJson(snapshot))).toBe(snapshotHash);
    expect(exported.json()).toMatchObject({
      snapshotHash,
      protocol: {
        id: finalized.json().id,
        checkId: run!.id,
        version: 1,
        status: "FINAL",
      },
      scope: {
        object: { id: object.id },
        inspection: { lifecycle: "FINALIZED" },
        run: { id: run!.id, state: "PARTIAL" },
      },
      integrity: {
        decisionSetHash: payload.decisionSetHash,
      },
      coverage: {
        gapsHash: payload.acknowledgedGapsHash,
        unsupportedParameters: 132,
        acknowledgement: {
          actorId: finalizer.id,
          actorName: "Integration Finalizer",
          reason: payload.acknowledgementReason,
        },
      },
    });
    expect(exportedBody.protocol).not.toHaveProperty("snapshotHash");
    expect(exported.json().sources).toHaveLength(1);
    expect(exported.json().coverage.gaps).toHaveLength(132);

    const canonicalBeforeRevocation = await app.inject({
      method: "GET",
      url: `/api/protocols/${finalized.json().id}/artifacts/canonical-json`,
      headers: { cookie: session.cookie },
    });
    expect(canonicalBeforeRevocation.statusCode).toBe(200);
    expect(canonicalBeforeRevocation.headers["content-type"]).toContain("application/octet-stream");
    expect(canonicalBeforeRevocation.headers["x-content-sha256"]).toBe(snapshotHash);
    expect(canonicalBeforeRevocation.headers.etag).toBe(`"sha256-${snapshotHash}"`);
    expect(canonicalBeforeRevocation.body).toBe(canonicalJson(snapshot));
    expect(Buffer.byteLength(canonicalBeforeRevocation.body)).toBe(finalized.json().canonicalArtifact.byteSize);

    const persisted = await database.query<{
      lifecycle: string;
      protocols: string | number;
      receipts: string | number;
      audits: string | number;
      durable_receipts: string | number;
      artifacts: string | number;
    }>(
      `SELECT
         inspection.lifecycle,
         (SELECT count(*) FROM inspection_protocol_versions protocol
          WHERE protocol.inspection_id = inspection.id AND protocol.kind = 'FINAL') AS protocols,
         (SELECT count(*) FROM command_receipts receipt
          WHERE receipt.operation = 'INSPECTION_FINALIZE' AND receipt.target_id = $1) AS receipts,
         (SELECT count(*) FROM audit_events audit
          WHERE audit.action = 'INSPECTION_FINALIZE' AND audit.inspection_id = inspection.id) AS audits,
         (SELECT count(*) FROM command_receipts receipt
          WHERE receipt.operation = 'INSPECTION_FINALIZE'
            AND receipt.target_id = $1
            AND receipt.expires_at = 'infinity'::timestamptz) AS durable_receipts,
         (SELECT count(*) FROM protocol_artifacts artifact
          JOIN inspection_protocol_versions protocol ON protocol.id = artifact.protocol_id
          WHERE protocol.inspection_id = inspection.id) AS artifacts
       FROM inspections inspection
       JOIN analysis_runs run ON run.inspection_id = inspection.id
       WHERE run.api_id = $1`,
      [run!.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      lifecycle: "FINALIZED",
      protocols: "1",
      receipts: "1",
      audits: "1",
      durable_receipts: "1",
      artifacts: "1",
    });

    const finalProtocolId = finalized.json().id as string;
    const revokePayload = {
      reasonCode: "PROTOCOL_CONTENT_ERROR",
      comment: "В итоговом протоколе требуется исправить содержание параметра",
    };
    const forbiddenForInspector = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: {
        ...baseHeaders,
        "if-match": finalized.headers.etag!,
        "idempotency-key": `revoke-${randomUUID()}`,
      },
      payload: revokePayload,
    });
    expect(forbiddenForInspector.statusCode).toBe(403);

    const revokeLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { login: revoker.login, password: "Revoke-Password-2026!" },
    });
    expect(revokeLogin.statusCode).toBe(200);
    const revokeSession = sessionCookies(revokeLogin);
    const revokeBaseHeaders = {
      cookie: revokeSession.cookie,
      "x-csrf-token": revokeSession.csrf,
    };

    const revokeWithoutIfMatch = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: {
        ...revokeBaseHeaders,
        "idempotency-key": `revoke-${randomUUID()}`,
      },
      payload: revokePayload,
    });
    expect(revokeWithoutIfMatch.statusCode).toBe(428);

    const finalizedVersion = Number(/inspection-(\d+)/.exec(finalized.headers.etag!)![1]);
    const staleRevoke = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: {
        ...revokeBaseHeaders,
        "if-match": `"inspection-${finalizedVersion + 99}"`,
        "idempotency-key": `revoke-${randomUUID()}`,
      },
      payload: revokePayload,
    });
    expect(staleRevoke.statusCode).toBe(412);

    const revokeIdempotencyKey = `revoke-${randomUUID()}`;
    const revokeHeaders = {
      ...revokeBaseHeaders,
      "if-match": finalized.headers.etag!,
      "idempotency-key": revokeIdempotencyKey,
    };
    const revoked = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: revokeHeaders,
      payload: revokePayload,
    });
    expect(revoked.statusCode).toBe(201);
    expect(revoked.headers.etag).toMatch(/^"inspection-[1-9][0-9]*"$/);
    expect(revoked.json()).toMatchObject({
      protocolId: finalProtocolId,
      checkId: run!.id,
      reasonCode: revokePayload.reasonCode,
      comment: revokePayload.comment,
      revokedBy: "Integration Supervisor",
      replacementProtocolId: expect.stringMatching(/^PRT-/),
      draftProtocol: {
        checkId: run!.id,
        version: 2,
        status: "DRAFT",
        validity: "DRAFT",
        snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        canonicalArtifact: {
          format: "JSON",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });

    const revokeReplay = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: revokeHeaders,
      payload: revokePayload,
    });
    expect(revokeReplay.statusCode).toBe(201);
    expect(revokeReplay.headers["idempotency-replayed"]).toBe("true");
    expect(revokeReplay.json()).toEqual(revoked.json());

    const revokeConflict = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: revokeHeaders,
      payload: { ...revokePayload, comment: "Тот же ключ нельзя использовать для другого исправления" },
    });
    expect(revokeConflict.statusCode).toBe(409);
    expect(revokeConflict.json().error).toBe("IDEMPOTENCY_CONFLICT");

    const secondRevoke = await app.inject({
      method: "POST",
      url: `/api/protocols/${finalProtocolId}/revoke`,
      headers: {
        ...revokeBaseHeaders,
        "if-match": revoked.headers.etag!,
        "idempotency-key": `revoke-${randomUUID()}`,
      },
      payload: revokePayload,
    });
    expect(secondRevoke.statusCode).toBe(409);
    expect(secondRevoke.json().error).toBe("INVALID_TRANSITION");

    const reopened = await app.inject({
      method: "GET",
      url: `/api/checks/${run!.id}`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().status).toBe("PARTIAL");
    expect(reopened.headers.etag).toBe(revoked.headers.etag);

    const protocolHistory = await app.inject({
      method: "GET",
      url: `/api/checks/${run!.id}/protocols`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(protocolHistory.statusCode).toBe(200);
    expect(protocolHistory.json().items).toHaveLength(2);
    expect(protocolHistory.json().items[0]).toMatchObject({
      id: finalProtocolId,
      version: 1,
      status: "FINAL",
      validity: "REVOKED",
      snapshotHash,
      revocation: {
        id: revoked.json().id,
        reasonCode: revokePayload.reasonCode,
        comment: revokePayload.comment,
        replacementProtocolId: revoked.json().replacementProtocolId,
      },
      canonicalArtifact: {
        format: "JSON",
        contentHash: snapshotHash,
      },
    });
    expect(protocolHistory.json().items[1]).toMatchObject({
      id: revoked.json().replacementProtocolId,
      version: 2,
      status: "DRAFT",
      validity: "DRAFT",
      revocation: null,
      canonicalArtifact: {
        format: "JSON",
        contentHash: revoked.json().draftProtocol.snapshotHash,
      },
    });

    const revokedExport = await app.inject({
      method: "GET",
      url: `/api/protocols/${finalProtocolId}/export`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(revokedExport.statusCode).toBe(200);
    const {
      snapshotHash: revokedSnapshotHash,
      validity: revokedValidity,
      revocation: revocationSummary,
      ...revokedSnapshot
    } = revokedExport.json();
    expect(revokedSnapshotHash).toBe(snapshotHash);
    expect(revokedValidity).toBe("REVOKED");
    expect(revocationSummary).toMatchObject({
      id: revoked.json().id,
      replacementProtocolId: revoked.json().replacementProtocolId,
    });
    expect(revokedSnapshot).toEqual(snapshot);
    expect(sha256(canonicalJson(revokedSnapshot))).toBe(snapshotHash);

    const canonicalAfterRevocation = await app.inject({
      method: "GET",
      url: `/api/protocols/${finalProtocolId}/artifacts/canonical-json`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(canonicalAfterRevocation.statusCode).toBe(200);
    expect(canonicalAfterRevocation.body).toBe(canonicalBeforeRevocation.body);
    expect(canonicalAfterRevocation.headers["x-content-sha256"]).toBe(snapshotHash);

    const draftExport = await app.inject({
      method: "GET",
      url: `/api/protocols/${revoked.json().replacementProtocolId}/export`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(draftExport.statusCode).toBe(200);
    const {
      snapshotHash: draftSnapshotHash,
      validity: draftValidity,
      revocation: draftRevocation,
      ...draftSnapshot
    } = draftExport.json();
    expect(draftValidity).toBe("DRAFT");
    expect(draftRevocation).toBeNull();
    expect(sha256(canonicalJson(draftSnapshot))).toBe(draftSnapshotHash);
    expect(draftSnapshot).toMatchObject({
      protocol: {
        id: revoked.json().replacementProtocolId,
        version: 2,
        status: "DRAFT",
      },
      scope: { inspection: { lifecycle: "OPEN", rowVersion: revoked.json().rowVersion } },
      lineage: {
        previousProtocolId: finalProtocolId,
        previousSnapshotHash: snapshotHash,
        basis: "REVOCATION",
        reasonCode: revokePayload.reasonCode,
        comment: revokePayload.comment,
        actorId: revoker.id,
        actorName: "Integration Supervisor",
      },
    });
    const draftCanonical = await app.inject({
      method: "GET",
      url: `/api/protocols/${revoked.json().replacementProtocolId}/artifacts/canonical-json`,
      headers: { cookie: revokeSession.cookie },
    });
    expect(draftCanonical.statusCode).toBe(200);
    expect(draftCanonical.body).toBe(canonicalJson(draftSnapshot));
    expect(draftCanonical.headers["x-content-sha256"]).toBe(draftSnapshotHash);

    const revokedPersisted = await database.query<{
      lifecycle: string;
      final_protocols: string | number;
      draft_protocols: string | number;
      revocations: string | number;
      receipts: string | number;
      audits: string | number;
      durable_receipts: string | number;
      original_snapshot_hash: string;
      artifacts: string | number;
    }>(
      `SELECT
         inspection.lifecycle,
         (SELECT count(*) FROM inspection_protocol_versions protocol
          WHERE protocol.inspection_id = inspection.id AND protocol.kind = 'FINAL') AS final_protocols,
         (SELECT count(*) FROM inspection_protocol_versions protocol
          WHERE protocol.inspection_id = inspection.id AND protocol.kind = 'DRAFT') AS draft_protocols,
         (SELECT count(*) FROM protocol_revocations revocation
          JOIN inspection_protocol_versions protocol ON protocol.id = revocation.protocol_id
          WHERE protocol.inspection_id = inspection.id) AS revocations,
         (SELECT count(*) FROM command_receipts receipt
          WHERE receipt.operation = 'PROTOCOL_REVOKE' AND receipt.target_id = $2) AS receipts,
         (SELECT count(*) FROM audit_events audit
          WHERE audit.action = 'PROTOCOL_REVOKE' AND audit.inspection_id = inspection.id) AS audits,
         (SELECT count(*) FROM command_receipts receipt
          WHERE receipt.operation = 'PROTOCOL_REVOKE'
            AND receipt.target_id = $2
            AND receipt.expires_at = 'infinity'::timestamptz) AS durable_receipts,
         (SELECT protocol.snapshot_hash FROM inspection_protocol_versions protocol
          WHERE protocol.api_id = $2) AS original_snapshot_hash,
         (SELECT count(*) FROM protocol_artifacts artifact
          JOIN inspection_protocol_versions protocol ON protocol.id = artifact.protocol_id
          WHERE protocol.inspection_id = inspection.id) AS artifacts
       FROM inspections inspection
       JOIN analysis_runs run ON run.inspection_id = inspection.id
       WHERE run.api_id = $1`,
      [run!.id, finalProtocolId],
    );
    expect(revokedPersisted.rows[0]).toMatchObject({
      lifecycle: "OPEN",
      final_protocols: "1",
      draft_protocols: "1",
      revocations: "1",
      receipts: "1",
      audits: "1",
      durable_receipts: "1",
      original_snapshot_hash: snapshotHash,
      artifacts: "2",
    });
    await expect(database.query(
      "UPDATE protocol_revocations SET comment = 'Попытка изменить неизменяемую запись' WHERE api_id = $1",
      [revoked.json().id],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(database.query(
      "UPDATE protocol_artifacts SET content_bytes = 'changed'::bytea WHERE api_id = $1",
      [finalized.json().canonicalArtifact.id],
    )).rejects.toMatchObject({ code: "55000" });
  }, 30_000);
  it.each([
    { version: "V5" as const, profileId: v5VisualProposalProfileId,
      adapterVersion: "5", configHash: v5VisualProposalConfigHash },
    { version: "V6" as const, profileId: v6VisualProposalProfileId,
      adapterVersion: "6", configHash: v6VisualProposalConfigHash },
  ])("pins opt-in visual $version without changing the default pilot profile", async ({ version, profileId, adapterVersion, configHash }) => {
    const reference = await loadReferenceData();
    const organizationSlug = `visual-${version.toLowerCase()}-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters, organizationSlug,
      analysisProfile: "PILOT_PZ002", visualProfile: version,
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const object = await repository.createObject({ name: `Visual ${version} pilot`, address: "Moscow" });
    const file = {
      id: `FIL-${randomUUID()}`, name: "drawing.pdf", size: 43, stage: "PD" as const,
      mimeType: "application/pdf", sha256: "c".repeat(64), scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"c".repeat(64)}/drawing.pdf`,
    };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const run = await repository.startCheck(object.id);
    expect(run?.status).toBe("PROCESSING");
    const stored = await database.query<{ content_json: Record<string, any> }>(
      `SELECT release.content_json FROM analysis_releases release
       JOIN analysis_runs run ON run.release_id = release.release_id
       WHERE run.api_id = $1`, [run!.id],
    );
    expect(stored.rows).toHaveLength(1);
    const slot = stored.rows[0].content_json.providerSlots.find(
      (candidate: { stageJobType: string }) => candidate.stageJobType === "ENTITY_EXTRACTION",
    );
    expect(slot).toMatchObject({ profileId, adapterVersion, configHash });
  }, 30_000);

  it("persists a release-gated PZ-002 abstention through the durable DAG", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `pilot-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString,
      parameters: reference.parameters,
      organizationSlug,
      organizationName: "Pilot integration",
      analysisProfile: "PILOT_PZ002",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const workerToken = `worker-${randomUUID()}`;
    const object = await repository.createObject({ name: "Pilot object", address: "Moscow" });
    const password = "Pilot-Inspector-Password-2026!";
    const reviewer = await provisionLocalUser(database, {
      organizationSlug, login: `pilot-${randomUUID()}`, displayName: "Pilot Inspector", password,
      role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"], objectApiIds: [object.id],
      objectPermissions: ["READ", "REVIEW_DECIDE"],
    });
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, identityService: identity, workerToken });
    openApps.push(app);
    const file = {
      id: `FIL-${randomUUID()}`, name: "project.pdf", size: 43, stage: "PD" as const,
      mimeType: "application/pdf", sha256: "c".repeat(64), scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"c".repeat(64)}/project.pdf`,
    };
    expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
    const login = await app.inject({
      method: "POST", url: "/api/auth/login", payload: { login: reviewer.login, password },
    });
    expect(login.statusCode).toBe(200);
    const session = sessionCookies(login);
    const reviewUrl = `/api/objects/${object.id}/files/${file.id}/source-review`;
    const sourceListUrl = `/api/objects/${object.id}/files`;
    const beforeReview = await app.inject({
      method: "GET", url: sourceListUrl, headers: { cookie: session.cookie },
    });
    expect(beforeReview.statusCode).toBe(200);
    expect(beforeReview.json()).toMatchObject({ permissions: { upload: false, review: true, run: false }, items: [{
      id: file.id, stages: ["PD"], review: null,
    }] });
    const fullAccess = await provisionLocalUser(database, {
      organizationSlug, login: `pilot-full-${randomUUID()}`,
      displayName: "Full Access Inspector", password,
      role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"], objectApiIds: [object.id],
      objectPermissions: ["READ", "UPLOAD", "REVIEW_DECIDE", "RUN"],
    });
    const fullAccessLogin = await app.inject({
      method: "POST", url: "/api/auth/login", payload: { login: fullAccess.login, password },
    });
    expect(fullAccessLogin.statusCode).toBe(200);
    expect((await app.inject({
      method: "GET", url: sourceListUrl,
      headers: { cookie: sessionCookies(fullAccessLogin).cookie },
    })).json().permissions).toEqual({ upload: true, review: true, run: true });
    const reviewInput = {
      sourceSha256: file.sha256, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: "building-1", pageStages: {},
      basis: { reference: "Титульный лист, согласованная версия" },
    };
    const reviewHeaders = {
      cookie: session.cookie, "x-csrf-token": session.csrf,
      "idempotency-key": `source-review-${randomUUID()}`,
    };
    const unprivileged = await provisionLocalUser(database, {
      organizationSlug, login: `pilot-readonly-${randomUUID()}`,
      displayName: "Unprivileged Inspector", password,
      role: "INSPECTOR", capabilities: ["REVIEW_DECIDE"], objectApiIds: [object.id],
      objectPermissions: ["READ", "REVIEW_DECIDE"],
    });
    const unprivilegedLogin = await app.inject({
      method: "POST", url: "/api/auth/login", payload: { login: unprivileged.login, password },
    });
    expect(unprivilegedLogin.statusCode).toBe(200);
    const unprivilegedSession = sessionCookies(unprivilegedLogin);
    const forbiddenReview = await app.inject({
      method: "POST", url: reviewUrl,
      headers: { cookie: unprivilegedSession.cookie, "x-csrf-token": unprivilegedSession.csrf,
        "idempotency-key": `source-review-${randomUUID()}` },
      payload: reviewInput,
    });
    expect(forbiddenReview.statusCode).toBe(403);
    const wrongHash = await app.inject({
      method: "POST", url: reviewUrl,
      headers: { ...reviewHeaders, "idempotency-key": `source-review-${randomUUID()}` },
      payload: { ...reviewInput, sourceSha256: "d".repeat(64) },
    });
    expect(wrongHash.statusCode).toBe(409);
    expect(wrongHash.json().error).toBe("SOURCE_HASH_MISMATCH");
    const unknownSection = await app.inject({
      method: "POST", url: reviewUrl,
      headers: { ...reviewHeaders, "idempotency-key": `source-review-${randomUUID()}` },
      payload: { ...reviewInput, sectionCode: "GUESSED" },
    });
    expect(unknownSection.statusCode).toBe(400);
    const reviewed = await app.inject({
      method: "POST", url: reviewUrl, headers: reviewHeaders, payload: reviewInput,
    });
    expect(reviewed.statusCode).toBe(201);
    expect(reviewed.json()).toMatchObject({
      sourceFileId: file.id, sourceSha256: file.sha256,
      revisionStatus: "CURRENT", approvalStatus: "APPROVED", sectionCode: null,
    });
    expect(reviewed.json().contentHash).toBe(sha256(canonicalJson({
      objectApiId: object.id, sourceFileApiId: file.id, ...reviewInput, actorId: reviewer.id,
    })));
    const afterReview = await app.inject({
      method: "GET", url: sourceListUrl, headers: { cookie: session.cookie },
    });
    expect(afterReview.statusCode).toBe(200);
    expect(afterReview.json()).toMatchObject({ items: [{
      id: file.id, review: {
        revisionStatus: "CURRENT", approvalStatus: "APPROVED",
        sectionCode: null,
        contentHash: reviewed.json().contentHash,
      },
    }] });
    const replay = await app.inject({
      method: "POST", url: reviewUrl, headers: reviewHeaders, payload: reviewInput,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(reviewed.json());
    const latest = await app.inject({ method: "GET", url: reviewUrl, headers: { cookie: session.cookie } });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().id).toBe(reviewed.json().id);
    const run = await repository.startCheck(object.id);
    expect(run).toMatchObject({ status: "PROCESSING" });
    const laterReview = await app.inject({
      method: "POST", url: reviewUrl,
      headers: { ...reviewHeaders, "idempotency-key": `source-review-${randomUUID()}` },
      payload: {
        ...reviewInput, revisionStatus: "SUPERSEDED", approvalStatus: "UNAPPROVED",
        linkGroupId: null, sectionCode: "AR",
        basis: { reference: "Новая редакция заменяет исходный лист" },
      },
    });
    expect(laterReview.statusCode).toBe(201);
    expect(laterReview.json().sectionCode).toBe("AR");
    expect(laterReview.json().contentHash).toBe(sha256(canonicalJson({
      objectApiId: object.id, sourceFileApiId: file.id, ...reviewInput,
      revisionStatus: "SUPERSEDED", approvalStatus: "UNAPPROVED", linkGroupId: null,
      sectionCode: "AR", basis: { reference: "Новая редакция заменяет исходный лист" },
      actorId: reviewer.id,
    })));
    expect((await app.inject({
      method: "GET", url: reviewUrl, headers: { cookie: session.cookie },
    })).json().id).toBe(laterReview.json().id);
    expect((await app.inject({
      method: "GET", url: sourceListUrl, headers: { cookie: session.cookie },
    })).json().items[0].review.sectionCode).toBe("AR");
    await expect(database.query(
      `UPDATE source_review_decisions SET revision_status = 'UNKNOWN' WHERE id = $1`,
      [reviewed.json().id],
    )).rejects.toThrow(/append-only/i);
    const jobs = await database.query<{ id: string; job_type: string; run_id: string }>(
      `SELECT job.id, job.job_type, job.run_id FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id WHERE run.api_id = $1`, [run!.id],
    );
    const jobId = (type: string) => {
      const job = jobs.rows.find((row) => row.job_type === type);
      if (!job) throw new Error(`Missing ${type} job`);
      return job.id;
    };
    const claim = async (type: string) => {
      const response = await app.inject({
        method: "POST", url: `/api/internal/v1/jobs/${jobId(type)}/claim`,
        headers: { "x-worker-token": workerToken },
        payload: { workerId: "pilot-integration", capabilities: [type] },
      });
      expect(response.statusCode, type).toBe(200);
      expect(response.json().status, type).toBe("ACQUIRED");
      return response.json().lease;
    };
    const complete = async (type: string, lease: Record<string, unknown>, result: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST", url: `/api/internal/v1/jobs/${jobId(type)}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result },
      });
      expect(response.statusCode, type).toBe(200);
      return response;
    };
    const inventory = await claim("ANALYSIS_INVENTORY");
    expect(inventory.release).toMatchObject({ lifecycle: "DRAFT", rules: { executionStatus: "PILOT" } });
    expect(inventory.inputs.sourceDecisions[file.id]).toMatchObject({
      sourceSha256: file.sha256, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: "building-1", sectionCode: null, basis: reviewInput.basis,
    });
    expect(inventory.inputs.sourceFiles[0].sectionCode).toBeNull();
    await complete("ANALYSIS_INVENTORY", inventory, {
      disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 },
    });
    const textLease = await claim("DOCUMENT_TEXT_LAYER");
    const content = "Проектная документация";
    const textArtifact = {
      schemaVersion: "document-text-v2", sourceFileId: file.id, inputSha256: file.sha256,
      coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 1, textPageCount: 1,
      qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
      qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
      pages: [{
        pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: content }],
        quality: {
          disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [],
          metrics: {
            blockCount: 1, nonWhitespaceCharacterCount: 21, alphanumericCharacterCount: 21,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          },
        },
      }],
    };
    await complete("DOCUMENT_TEXT_LAYER", textLease, {
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      sources: [{ sourceFileId: file.id, inputSha256: file.sha256, status: "EXTRACTED", artifact: textArtifact }],
    });
    for (const [type, contract] of Object.entries(scaffoldStageContracts)) {
      if (type === "RULE_EVALUATION" || type === "DOCUMENT_OCR_LAYOUT") continue;
      if (type === "EVIDENCE_VALIDATION") break;
      const lease = await claim(type);
      if (type === "ENTITY_EXTRACTION") {
        expect(lease.release.providerSlot).toMatchObject({
          status: "CONFIGURED", profileId: visualProposalProfileId, adapterVersion: "4",
        });
        const visual = visualProposalResult(lease);
        const invalidVisual = await app.inject({
          method: "POST", url: `/api/internal/v1/jobs/${jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken,
            result: { ...visual, finding: { severity: "CRITICAL" } } },
        });
        expect(invalidVisual.statusCode).toBe(409);
        await complete(type, lease, visual);
        const storedVisual = await database.query<{ content_hash: string; disposition: string }>(
          `SELECT content_hash, disposition FROM analysis_stage_artifacts WHERE job_id = $1`,
          [jobId(type)],
        );
        expect(storedVisual.rows).toMatchObject([{
          content_hash: sha256(canonicalJson(visual)), disposition: "VISUAL_PROPOSAL_SCAN",
        }]);
        const visualRead = await app.inject({
          method: "GET", url: `/api/checks/${run!.id}/visual-proposals`,
          headers: { cookie: session.cookie },
        });
        expect(visualRead.statusCode).toBe(200);
        expect(visualRead.json()).toMatchObject({
          status: "PROPOSAL_ONLY_UNVERIFIED",
          contentHash: sha256(canonicalJson(visual)),
          sources: [{ sourceFileId: file.id, proposals: [{ pageNumber: 1 }] }],
        });
        const anonymousRead = await app.inject({
          method: "GET", url: `/api/checks/${run!.id}/visual-proposals`,
        });
        expect(anonymousRead.statusCode).toBe(401);
        continue;
      }
      const [disposition, reasonCode, providerKind] = contract;
      await complete(type, lease, {
        schemaVersion: "analysis-stage-result-v1", jobType: type,
        inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
        providerProfileId: null, providerConfigHash: null, outputCount: 0,
      });
    }
    const rulesLease = await claim("RULE_EVALUATION");
    expect(rulesLease.release).toMatchObject({
      lifecycle: "DRAFT", providerSlot: { status: "CONFIGURED", profileId: "typed-pz002-v1" },
    });
    const result = {
      schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
      inputManifestHash: rulesLease.inputManifestHash, disposition: "RULES_EVALUATED",
      providerKind: "RULE_ENGINE", providerProfileId: "typed-pz002-v1",
      providerConfigHash: rulesLease.release.providerSlot.configHash, outputCount: 1,
      analysis: {
        schemaVersion: "pz-002-analysis-v1", objectId: rulesLease.objectId,
        selectedManifestHash: rulesLease.inputManifestHash, selectedFileIds: [file.id],
        route: { schemaVersion: "parameter-route-v1", stages: [] },
        extractedFacts: [], ocrArtifacts: [],
        evaluation: {
          schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-002-area", ruleVersion: "1",
          parameterCode: "PZ-002", objectId: rulesLease.objectId,
          executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
          reasonCode: "MISSING_RD", evidence: [],
        },
      },
    };
    const invalid = await app.inject({
      method: "POST", url: `/api/internal/v1/jobs/${jobId("RULE_EVALUATION")}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: {
        attemptId: rulesLease.attemptId, fencingToken: rulesLease.fencingToken,
        result: { ...result, analysis: { ...result.analysis, evaluation: {
          ...result.analysis.evaluation, machineStatus: "CANDIDATE",
        } } },
      },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error).toBe("INVALID_JOB_RESULT");
    await complete("RULE_EVALUATION", rulesLease, result);
    const storedRule = await database.query<{ content_hash: string; content_json: Record<string, unknown> }>(
      `SELECT content_hash, content_json FROM analysis_stage_artifacts WHERE job_id = $1`,
      [jobId("RULE_EVALUATION")],
    );
    expect(storedRule.rows).toHaveLength(1);
    expect(storedRule.rows[0].content_hash.trim()).toBe(sha256(canonicalJson(result)));
    const evidenceLease = await claim("EVIDENCE_VALIDATION");
    const [disposition, reasonCode, providerKind] = scaffoldStageContracts.EVIDENCE_VALIDATION;
    await complete("EVIDENCE_VALIDATION", evidenceLease, {
      schemaVersion: "analysis-stage-result-v1", jobType: "EVIDENCE_VALIDATION",
      inputManifestHash: evidenceLease.inputManifestHash, disposition, reasonCode, providerKind,
      providerProfileId: null, providerConfigHash: null, outputCount: 0,
    });
    const sealLease = await claim("ANALYSIS_SEAL_UNSUPPORTED");
    const sealed = await complete("ANALYSIS_SEAL_UNSUPPORTED", sealLease, {
      disposition: "UNSUPPORTED_COVERAGE_SEALED",
    });
    expect(sealed.json()).toMatchObject({ status: "COMPLETED", check: {
      status: "PARTIAL", stats: { unsupported: 131 },
    } });
    const coverage = await database.query<{ execution_rollup: string }>(
      `SELECT execution_rollup FROM parameter_coverage WHERE run_id = $1 AND parameter_code = 'PZ-002'`,
      [jobs.rows[0].run_id],
    );
    expect(coverage.rows).toEqual([{ execution_rollup: "PARTIAL" }]);
    const persisted = await database.query<{ machine_status: string; result_payload: Record<string, unknown> }>(
      `SELECT machine_status, result_payload FROM rule_results WHERE run_id = $1 AND parameter_code = 'PZ-002'`,
      [jobs.rows[0].run_id],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].machine_status).toBe("MISSING_EVIDENCE");
    expect(persisted.rows[0].result_payload).toEqual(result.analysis.evaluation);

    const visualReviewer = await provisionLocalUser(database, {
      organizationSlug, login: `visual-${randomUUID()}`,
      displayName: "Visual Reviewer", password,
      role: "INSPECTOR", capabilities: ["REVIEW_DECIDE"], objectApiIds: [object.id],
      objectPermissions: ["READ", "REVIEW_DECIDE"],
    });
    const visualLogin = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { login: visualReviewer.login, password },
    });
    expect(visualLogin.statusCode).toBe(200);
    const visualSession = sessionCookies(visualLogin);
    const visualUrl = `/api/checks/${run!.id}/visual-proposals/reviews`;
    const visualHeaders = {
      cookie: visualSession.cookie, "x-csrf-token": visualSession.csrf,
      "idempotency-key": `visual-review-${randomUUID()}`,
    };
    const artifact = await database.query<{ id: string; content_hash: string }>(
      `SELECT id, content_hash FROM analysis_stage_artifacts
       WHERE job_id = $1`, [jobId("ENTITY_EXTRACTION")],
    );
    const visualInput = {
      artifactId: artifact.rows[0].id,
      contentHash: artifact.rows[0].content_hash.trim(),
      sourceFileId: file.id, sourceSha256: file.sha256,
      proposalOrdinal: 0, action: "KEEP_FOR_REVIEW",
      note: "Граница рассмотрена на исходном листе",
    };
    expect((await app.inject({ method: "GET", url: visualUrl,
      headers: { cookie: visualSession.cookie } })).json()).toEqual({ items: [], canReview: true });
    expect((await app.inject({ method: "GET", url: visualUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: visualUrl,
      headers: { cookie: session.cookie, "x-csrf-token": session.csrf,
        "idempotency-key": `visual-review-${randomUUID()}` },
      payload: visualInput })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: visualUrl,
      headers: { cookie: visualSession.cookie,
        "idempotency-key": `visual-review-${randomUUID()}` },
      payload: visualInput })).statusCode).toBe(403);
    const visualWrongHash = await app.inject({ method: "POST", url: visualUrl,
      headers: { ...visualHeaders, "idempotency-key": `visual-review-${randomUUID()}` },
      payload: { ...visualInput, contentHash: "0".repeat(64) } });
    expect(visualWrongHash.statusCode).toBe(409);
    expect(visualWrongHash.json().error).toBe("STALE_VISUAL_PROPOSAL");
    const invalidOrdinal = await app.inject({ method: "POST", url: visualUrl,
      headers: { ...visualHeaders, "idempotency-key": `visual-review-${randomUUID()}` },
      payload: { ...visualInput, proposalOrdinal: 99 } });
    expect(invalidOrdinal.statusCode).toBe(409);
    expect(invalidOrdinal.json().error).toBe("PROPOSAL_NOT_FOUND");
    const visualReviewed = await app.inject({ method: "POST", url: visualUrl,
      headers: visualHeaders, payload: visualInput });
    expect(visualReviewed.statusCode).toBe(201);
    expect(visualReviewed.json()).toMatchObject({
      checkId: run!.id, objectId: object.id,
      action: "KEEP_FOR_REVIEW", sourceFileId: file.id,
      contentHash: visualInput.contentHash, proposalOrdinal: 0,
      proposalHash: sha256(canonicalJson({ pageNumber: 1,
        bboxNormalized: [0.1, 0.2, 0.3, 0.4], status: "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED" })),
    });
    const visualReplay = await app.inject({ method: "POST", url: visualUrl,
      headers: visualHeaders, payload: visualInput });
    expect(visualReplay.statusCode).toBe(201);
    expect(visualReplay.headers["idempotency-replayed"]).toBe("true");
    expect(visualReplay.json().id).toBe(visualReviewed.json().id);
    const conflict = await app.inject({ method: "POST", url: visualUrl,
      headers: visualHeaders, payload: { ...visualInput, action: "REJECT" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("IDEMPOTENCY_CONFLICT");
    const second = await app.inject({ method: "POST", url: visualUrl,
      headers: { ...visualHeaders, "idempotency-key": `visual-review-${randomUUID()}` },
      payload: { ...visualInput, action: "UNSURE", note: "Источник требует дополнительной проверки" } });
    expect(second.statusCode).toBe(201);
    const history = await app.inject({ method: "GET", url: visualUrl,
      headers: { cookie: visualSession.cookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.map((item: { action: string }) => item.action)).toEqual([
      "KEEP_FOR_REVIEW", "UNSURE",
    ]);
    expect((await database.query<{ count: string }>(
      "SELECT count(*) FROM visual_proposal_reviews WHERE artifact_id = $1", [visualInput.artifactId],
    )).rows[0].count).toBe("2");
    await expect(database.query(
      "UPDATE visual_proposal_reviews SET note = 'changed' WHERE id = $1",
      [visualReviewed.json().id],
    )).rejects.toMatchObject({ code: "55000" });

    // A new run snapshots the renewed PD approval and the linked RD review.
    const rdFile = {
      ...file, id: `FIL-${randomUUID()}`, name: "working.pdf", stage: "RD" as const,
      sha256: "e".repeat(64),
      storageKey: `objects/${object.id}/originals/${"e".repeat(64)}/working.pdf`,
    };
    expect(await repository.registerIngestedFiles(object.id, [rdFile])).toBeDefined();
    for (const source of [file, rdFile]) {
      const response = await app.inject({
        method: "POST", url: `/api/objects/${object.id}/files/${source.id}/source-review`,
        headers: { ...reviewHeaders, "idempotency-key": `source-review-${randomUUID()}` },
        payload: { ...reviewInput, sourceSha256: source.sha256, sectionCode: "AR" },
      });
      expect(response.statusCode).toBe(201);
    }
    const candidateRun = await repository.startCheck(object.id);
    expect(candidateRun).toMatchObject({ status: "PROCESSING" });
    const staleVisual = await app.inject({ method: "POST", url: visualUrl,
      headers: { ...visualHeaders, "idempotency-key": `visual-review-${randomUUID()}` },
      payload: visualInput });
    expect(staleVisual.statusCode).toBe(409);
    expect(staleVisual.json().error).toBe("STALE_VISUAL_PROPOSAL");
    const candidateJobs = await database.query<{ id: string; job_type: string; run_id: string }>(
      `SELECT job.id, job.job_type, job.run_id FROM analysis_jobs job
       JOIN analysis_runs run ON run.id = job.run_id WHERE run.api_id = $1`,
      [candidateRun!.id],
    );
    const candidateJobId = (type: string) => {
      const job = candidateJobs.rows.find((row) => row.job_type === type);
      if (!job) throw new Error(`Missing candidate ${type} job`);
      return job.id;
    };
    const claimCandidate = async (type: string) => {
      const response = await app.inject({
        method: "POST", url: `/api/internal/v1/jobs/${candidateJobId(type)}/claim`,
        headers: { "x-worker-token": workerToken },
        payload: { workerId: "pilot-candidate", capabilities: [type] },
      });
      expect(response.statusCode, type).toBe(200);
      return response.json().lease;
    };
    const completeCandidate = async (type: string, lease: Record<string, unknown>, stageResult: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST", url: `/api/internal/v1/jobs/${candidateJobId(type)}/complete`,
        headers: { "x-worker-token": workerToken },
        payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result: stageResult },
      });
      expect(response.statusCode, type).toBe(200);
      return response;
    };
    const candidateInventory = await claimCandidate("ANALYSIS_INVENTORY");
    expect(candidateInventory.inputs.sourceFiles.map((source: { sectionCode: string | null }) =>
      source.sectionCode)).toEqual(["AR", "AR"]);
    expect(candidateInventory.inputs.sourceDecisions[file.id].sectionCode).toBe("AR");
    expect(candidateInventory.inputs.sourceDecisions[rdFile.id].sectionCode).toBe("AR");
    await completeCandidate("ANALYSIS_INVENTORY", candidateInventory, {
      disposition: "MANIFEST_INVENTORIED", sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 },
    });
    const candidateTextLease = await claimCandidate("DOCUMENT_TEXT_LAYER");
    const makeTextArtifact = (source: typeof file | typeof rdFile, value: string) => {
      const label = `Общая площадь здания: ${value} м2`;
      const characters = [...label];
      return {
        schemaVersion: "document-text-v2", sourceFileId: source.id, inputSha256: source.sha256,
        coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 1, textPageCount: 1,
        qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
        pages: [{
          pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: label }],
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
            blockCount: 1,
            nonWhitespaceCharacterCount: characters.filter((character) => !/\s/u.test(character)).length,
            alphanumericCharacterCount: characters.filter((character) => /[\p{L}\p{N}]/u.test(character)).length,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          } },
        }],
      };
    };
    await completeCandidate("DOCUMENT_TEXT_LAYER", candidateTextLease, {
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      sources: [file, rdFile].sort((left, right) => left.id.localeCompare(right.id)).map((source) => ({
        sourceFileId: source.id, inputSha256: source.sha256, status: "EXTRACTED",
        artifact: makeTextArtifact(source, source.id === file.id ? "100" : "102"),
      })),
    });
    for (const [type, contract] of Object.entries(scaffoldStageContracts)) {
      if (type === "RULE_EVALUATION" || type === "DOCUMENT_OCR_LAYOUT") continue;
      if (type === "EVIDENCE_VALIDATION") break;
      const lease = await claimCandidate(type);
      if (type === "ENTITY_EXTRACTION") {
        await completeCandidate(type, lease, visualProposalResult(lease));
        continue;
      }
      const [stageDisposition, stageReason, providerKind] = contract;
      await completeCandidate(type, lease, {
        schemaVersion: "analysis-stage-result-v1", jobType: type,
        inputManifestHash: lease.inputManifestHash, disposition: stageDisposition,
        reasonCode: stageReason, providerKind, providerProfileId: null,
        providerConfigHash: null, outputCount: 0,
      });
    }
    const candidateRulesLease = await claimCandidate("RULE_EVALUATION");
    const candidateEvidence = [file, rdFile].map((source) => ({
      role: source.id === file.id ? "EXPECTED" : "ACTUAL",
      stage: source.stage, sourceFileId: source.id, inputSha256: source.sha256,
      pageNumber: 1, evidenceKind: "TEXT_LAYER",
      coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", blockIndex: 0,
      bboxMilliPoints: [10_000, 20_000, 300_000, 40_000],
      rawValue: source.id === file.id ? "100" : "102", rawUnit: "м2", sourceUnit: "м2",
      normalizedValue: source.id === file.id ? "100" : "102", canonicalUnit: "m2",
    }));
    const fingerprint = sha256(canonicalJson({
      ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
      objectId: candidateRulesLease.objectId, entityKey: "building-total", evidence: candidateEvidence,
    }));
    const candidateResult = {
      schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
      inputManifestHash: candidateRulesLease.inputManifestHash, disposition: "RULES_EVALUATED",
      providerKind: "RULE_ENGINE", providerProfileId: "typed-pz002-v1",
      providerConfigHash: candidateRulesLease.release.providerSlot.configHash, outputCount: 1,
      analysis: {
        schemaVersion: "pz-002-analysis-v1", objectId: candidateRulesLease.objectId,
        selectedManifestHash: candidateRulesLease.inputManifestHash,
        selectedFileIds: [file.id, rdFile.id].sort(), route: {}, extractedFacts: [],
        ocrArtifacts: [], ocrRequiredPageCount: 0, ocrProcessedPageCount: 0,
        evaluation: {
          schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-002-area", ruleVersion: "1",
          parameterCode: "PZ-002", objectId: candidateRulesLease.objectId,
          executionStatus: "SUCCEEDED", machineStatus: "CANDIDATE",
          reasonCode: "THRESHOLD_EXCEEDED", entityKey: "building-total",
          normalizedExpected: "100", normalizedActual: "102", delta: "0.02",
          canonicalUnit: "m2", evidence: candidateEvidence, evidenceFingerprint: fingerprint,
        },
      },
    };
    const forged = await app.inject({
      method: "POST", url: `/api/internal/v1/jobs/${candidateJobId("RULE_EVALUATION")}/complete`,
      headers: { "x-worker-token": workerToken },
      payload: { attemptId: candidateRulesLease.attemptId, fencingToken: candidateRulesLease.fencingToken,
        result: { ...candidateResult, analysis: { ...candidateResult.analysis,
          evaluation: { ...candidateResult.analysis.evaluation, normalizedActual: "103" } } } },
    });
    expect(forged.statusCode).toBe(409);
    expect(forged.json().error).toBe("INVALID_JOB_RESULT");
    await completeCandidate("RULE_EVALUATION", candidateRulesLease, candidateResult);
    const candidateEvidenceLease = await claimCandidate("EVIDENCE_VALIDATION");
    const [evidenceDisposition, evidenceReason, evidenceProvider] = scaffoldStageContracts.EVIDENCE_VALIDATION;
    await completeCandidate("EVIDENCE_VALIDATION", candidateEvidenceLease, {
      schemaVersion: "analysis-stage-result-v1", jobType: "EVIDENCE_VALIDATION",
      inputManifestHash: candidateEvidenceLease.inputManifestHash,
      disposition: evidenceDisposition, reasonCode: evidenceReason,
      providerKind: evidenceProvider, providerProfileId: null,
      providerConfigHash: null, outputCount: 0,
    });
    const candidateSealLease = await claimCandidate("ANALYSIS_SEAL_UNSUPPORTED");
    const candidateSealed = await completeCandidate("ANALYSIS_SEAL_UNSUPPORTED", candidateSealLease, {
      disposition: "UNSUPPORTED_COVERAGE_SEALED",
    });
    expect(candidateSealed.json()).toMatchObject({ status: "COMPLETED", check: {
      status: "PARTIAL", stats: { candidates: 1, unsupported: 131 },
    } });
    const findings = await app.inject({
      method: "GET", url: `/api/checks/${candidateRun!.id}/findings`,
      headers: { cookie: session.cookie },
    });
    expect(findings.statusCode).toBe(200);
    expect(findings.json()).toMatchObject({ items: [{
      status: "CANDIDATE", parameterCode: "PZ-002",
      expectedValue: "100 м²", actualValue: "102 м²",
      evidence: [{ fileId: file.id }, { fileId: rdFile.id }],
    }] });
    const unresolvedRdSection = await app.inject({
      method: "POST", url: `/api/objects/${object.id}/files/${rdFile.id}/source-review`,
      headers: { ...reviewHeaders, "idempotency-key": `source-review-${randomUUID()}` },
      payload: { ...reviewInput, sourceSha256: rdFile.sha256, sectionCode: "VK",
        revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN", linkGroupId: null,
        basis: { reference: "Раздел ВК проверяется отдельно; редакция и согласование не установлены" } },
    });
    expect(unresolvedRdSection.statusCode).toBe(201);
    expect(unresolvedRdSection.json()).toMatchObject({ sectionCode: "VK",
      revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN" });
    const frozenRdSection = await database.query<{ section_code: string }>(
      `SELECT decision.section_code FROM run_source_review_snapshots snapshot
       JOIN analysis_runs run ON run.id = snapshot.run_id
       JOIN source_files source ON source.id = snapshot.source_file_id
       JOIN source_review_decisions decision ON decision.id = snapshot.decision_id
       WHERE run.api_id = $1 AND source.api_id = $2`, [candidateRun!.id, rdFile.id],
    );
    expect(frozenRdSection.rows).toEqual([{ section_code: "AR" }]);
  }, 30_000);

  it("stores unresolved mixed pages without assigning a false RD or ID stage", async () => {
    const reference = await loadReferenceData();
    const organizationSlug = `stage-review-${randomUUID()}`;
    const repository = await PostgresInspectionRepository.create({
      connectionString, parameters: reference.parameters,
      organizationSlug, organizationName: "Stage review integration",
    });
    openRepositories.push(repository);
    const database = new Pool({ connectionString, max: 1 });
    openPools.push(database);
    const object = await repository.createObject({ name: "Mixed source", address: "Moscow" });
    const sourceId = `FIL-${randomUUID()}`;
    const source = {
      id: sourceId, name: "mixed.pdf", size: 43, stage: "RD" as const,
      mimeType: "application/pdf", sha256: "9".repeat(64), scanStatus: "CLEAN" as const,
      status: "STORED" as const,
      storageKey: `objects/${object.id}/originals/${"9".repeat(64)}/mixed.pdf`,
    };
    expect(await repository.registerIngestedFiles(object.id, [source])).toBeDefined();
    expect(await repository.registerIngestedFiles(object.id, [{
      ...source, id: `FIL-${randomUUID()}`, stage: "ID" as const,
    }])).toBeDefined();
    const password = "Stage-Review-Password-2026!";
    const reviewer = await provisionLocalUser(database, {
      organizationSlug, login: `stage-${randomUUID()}`, displayName: "Stage Reviewer", password,
      role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"], objectApiIds: [object.id],
      objectPermissions: ["READ", "REVIEW_DECIDE"],
    });
    const identity = PostgresIdentityService.create({ connectionString, organizationSlug });
    const app = await buildApp({ repository, identityService: identity });
    openApps.push(app);
    const login = await app.inject({
      method: "POST", url: "/api/auth/login", payload: { login: reviewer.login, password },
    });
    expect(login.statusCode).toBe(200);
    const session = sessionCookies(login);
    const files = await app.inject({
      method: "GET", url: `/api/objects/${object.id}/files`, headers: { cookie: session.cookie },
    });
    expect(files.json().items).toHaveLength(1);
    expect(files.json().items[0].id).toBe(sourceId);
    expect(new Set(files.json().items[0].stages)).toEqual(new Set(["RD", "ID"]));
    const url = `/api/objects/${object.id}/files/${sourceId}/source-review`;
    const input = {
      sourceSha256: source.sha256, revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN",
      linkGroupId: null, pageStages: { "1": "RD", "2": "UNRESOLVED" },
      basis: { reference: "Лист 1: штамп РД; лист 2: стадия не подтверждена" },
    };
    const headers = { cookie: session.cookie, "x-csrf-token": session.csrf,
      "idempotency-key": `stage-review-${randomUUID()}` };
    const invalid = await app.inject({ method: "POST", url, headers,
      payload: { ...input, pageStages: { "1": "PD", "2": "UNRESOLVED" } } });
    expect(invalid.statusCode).toBe(409);
    const accepted = await app.inject({ method: "POST", url,
      headers: { ...headers, "idempotency-key": `stage-review-${randomUUID()}` }, payload: input });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().pageStages).toEqual(input.pageStages);
    const saved = await app.inject({ method: "GET", url, headers: { cookie: session.cookie } });
    expect(saved.json().pageStages).toEqual(input.pageStages);
  }, 30_000);
});
