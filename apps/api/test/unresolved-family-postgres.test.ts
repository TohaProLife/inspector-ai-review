import { pythonExecutable, pythonEnv } from "./python.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresIdentityService } from "../src/identity.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { visualProposalConfigHash, visualProposalProfileId,
  visualProposalProfile } from "../src/visual-proposal.js";
import { provisionLocalUser } from "../src/user-provisioning.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const databaseSuite = adminUrl ? describe : describe.skip;
const settings = ["INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE",
  "INSPECTOR_OCR_HEAT_ROW_PROFILE", "INSPECTOR_FACT_FAMILY_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
  "INSPECTOR_OCR_TABLE_ROWS_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE"];
const fixture = JSON.parse(readFileSync(new URL(
  "./fixtures/unresolved-family-run-review-cross-language.json", import.meta.url), "utf8"));

function sourceSettings(unresolved: boolean): void {
  Object.assign(process.env, {
    INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE: "v5",
    INSPECTOR_OCR_HEAT_ROW_PROFILE: "v1",
    INSPECTOR_FACT_FAMILY_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE: "v1",
    INSPECTOR_OCR_TABLE_ROWS_PROFILE: "v3",
  });
  if (unresolved) process.env.INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE = "v1";
  else delete process.env.INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE;
}

function pythonAids(objectId: string, manifestHash: string,
  ocrStage: Record<string, unknown>): Record<string, any> {
  const script = `import json, sys
from inspector_worker.fact_family_pipeline import evaluate_fact_family_bundle
from inspector_worker.candidate_family_ocr_observations import evaluate_run_candidate_family_ocr_observations
from inspector_worker.run_candidate_family_preview import evaluate_run_candidate_family_preview
from inspector_worker.candidate_family_observations import extract_candidate_family_observations
from inspector_worker.ocr_table_rows import extract_ocr_table_rows, PROFILE_ID_V3
from inspector_worker.ocr_pilot import canonical_hash
from inspector_worker.candidate_family_ocr_observations import _PROFILES
data=json.load(sys.stdin)
stage=data["ocrStage"]
selected=_PROFILES.get(stage["providerProfileId"])
assert selected is not None, "OCR fixture profile absent"
assert stage["providerConfigHash"] == selected[0], "OCR fixture config differs"
assert stage["analysis"]["profile"] == selected[1], "OCR fixture profile body differs"
assert stage["analysis"]["schemaVersion"] == selected[2], "OCR fixture schema differs"
assert stage["analysis"]["sourceCount"] == len(data["sources"]), "OCR fixture source count differs"
assert stage["schemaVersion"] == "analysis-stage-result-v2", "OCR fixture outer schema differs"
assert stage["jobType"] == "DOCUMENT_OCR_LAYOUT", "OCR fixture type differs"
assert stage["inputManifestHash"] == data["manifestHash"], "OCR fixture manifest differs"
assert stage["disposition"] == "OCR_LAYOUT_BOUNDED", "OCR fixture disposition differs"
assert stage["reasonCode"] == "BOUNDED_OCR_ONLY", "OCR fixture reason differs"
assert stage["providerKind"] == "OCR_LAYOUT", "OCR fixture provider differs"
assert stage["analysis"]["inputManifestHash"] == data["manifestHash"], "OCR fixture analysis manifest differs"
assert stage["analysis"]["objectId"] == data["objectId"], "OCR fixture object differs"
assert type(stage["analysis"]["processedPageCount"]) is int, "OCR fixture processed type differs"
assert 0 <= stage["analysis"]["processedPageCount"] <= selected[1]["maxPagesPerRun"], "OCR fixture processed bounds differ"
assert stage["outputCount"] == stage["analysis"]["processedPageCount"], "OCR fixture output differs"
family=evaluate_fact_family_bundle(data["objectId"],data["manifestHash"],data["sources"],data["artifacts"])
preview=evaluate_run_candidate_family_preview(data["objectId"],data["manifestHash"],data["sources"],data["artifacts"])
observations=extract_candidate_family_observations(preview,data["sources"],data["artifacts"])
ocr_observations=evaluate_run_candidate_family_ocr_observations(data["objectId"],data["manifestHash"],data["sources"],data["artifacts"],data["ocrStage"])
rows=extract_ocr_table_rows(data["ocrStage"],stage_sha256=canonical_hash(data["ocrStage"]),profile_id=PROFILE_ID_V3)
json.dump({"family":family,"preview":preview,"observations":observations,"ocrObservations":ocr_observations,"rows":rows},sys.stdout,ensure_ascii=False)
`;
  const sources = fixture.sourceFiles.map((source: Record<string, unknown>) => ({
    sourceFileId: source.sourceFileId, sha256: source.sha256, objectId,
    stages: source.stages, sectionCode: source.sectionCode,
    revisionStatus: "CURRENT", approvalStatus: "APPROVED", pageStages: {},
  }));
  const artifacts = Object.values(fixture.textArtifacts).map((item: any) => item.content_json);
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const python = pythonExecutable;
  const child = spawnSync(python, ["-c", script], { input: JSON.stringify({ objectId,
    manifestHash, sources, artifacts, ocrStage }), encoding: "utf8",
    env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath } });
  if (child.status !== 0) throw new Error(`Synthetic worker aid failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

const scaffoldContracts = {
  DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
  DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
  DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
  EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
} as const;

databaseSuite("synthetic unresolved family run profile", () => {
  it("leases, saves, seals and reads three lexical leads; rejects tamper; keeps legacy v3", async () => {
    const name = `inspector_unresolved_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    const previous = Object.fromEntries(settings.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 3 });
      const organizationSlug = `unresolved-${randomUUID()}`;
      sourceSettings(false);
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017", visualProfile: "V4",
      });
      const object = await repository.createObject({ name: "Synthetic lexical fixture", address: "Test" });
      const originalFiles = fixture.sourceFiles.map((source: any) => ({
        id: source.sourceFileId, name: `${source.sourceFileId}.pdf`, size: 1024,
        stage: source.stages[0], mimeType: "application/pdf", sha256: source.sha256,
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${source.sha256}/${source.sourceFileId}.pdf`,
      }));
      expect(await repository.registerIngestedFiles(object.id, originalFiles)).toBeDefined();
      const password = "Synthetic-Test-Only-2026!";
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `unresolved-${randomUUID()}`, displayName: "Synthetic reviewer",
        password, role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"],
        objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const workerToken = `worker-${randomUUID()}`;
      const identity = PostgresIdentityService.create({ connectionString: url.toString(),
        organizationSlug });
      app = await buildApp({ repository, workerToken, identityService: identity });
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reviewer.login, password } });
      expect(login.statusCode).toBe(200);
      const cookies = (login.headers["set-cookie"] as string[]).map((part) => part.split(";", 1)[0]);
      const csrf = decodeURIComponent(cookies.find((part) => part.startsWith("inspector_csrf="))!
        .slice("inspector_csrf=".length));
      const cookie = cookies.join("; ");
      for (const file of originalFiles) {
        const response = await app.inject({ method: "POST",
          url: `/api/objects/${object.id}/files/${file.id}/source-review`,
          headers: { cookie, "x-csrf-token": csrf,
            "idempotency-key": `synthetic-source-${randomUUID()}` },
          payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
            approvalStatus: "APPROVED", linkGroupId: "synthetic-group",
            sectionCode: file.id === "F-AR" ? "AR" : "VK", pageStages: {},
            basis: { reference: "Synthetic fixture only; no real source approved." } } });
        expect(response.statusCode, JSON.stringify(response.json())).toBe(201);
      }
      const run = async (unresolved: boolean) => {
        sourceSettings(unresolved);
        const check = await repository!.startCheck(object.id);
        expect(check).toBeDefined();
        const checkId = check!.id;
        const release = (await database!.query<{ content_json: any }>(
          `SELECT release.content_json FROM analysis_releases release
           JOIN analysis_runs run ON run.release_id = release.release_id
           WHERE run.api_id = $1`, [checkId])).rows[0].content_json;
        const ruleSlot = release.providerSlots.find((slot: any) => slot.stageJobType === "RULE_EVALUATION");
        expect(ruleSlot.profileId).toBe(unresolved
          ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1"
          : "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3");
        if (unresolved) expect(release.rules.definitions.unresolvedFamilyReview).toMatchObject({
          codeCount: 3, disposition: "REVIEW_AID_ONLY" });
        const jobId = async (type: string) => (await database!.query<{ id: string }>(
          `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
           WHERE run.api_id = $1 AND job.job_type = $2`, [checkId, type])).rows[0].id;
        const claim = async (type: string) => {
          const response = await app!.inject({ method: "POST",
            url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
            headers: { "x-worker-token": workerToken },
            payload: { workerId: "synthetic-unresolved", capabilities: [type] } });
          expect(response.statusCode, `${type}: ${response.body}`).toBe(200);
          return response.json().lease as Record<string, any>;
        };
        const complete = async (type: string, lease: Record<string, any>, result: unknown) =>
          app!.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
            headers: { "x-worker-token": workerToken },
            payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
        const scaffold = (type: keyof typeof scaffoldContracts, lease: Record<string, any>) => {
          const [disposition, reasonCode, providerKind] = scaffoldContracts[type];
          return { schemaVersion: "analysis-stage-result-v1", jobType: type,
            inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind,
            providerProfileId: null, providerConfigHash: null, outputCount: 0 };
        };
        const inventory = await claim("ANALYSIS_INVENTORY");
        expect((await complete("ANALYSIS_INVENTORY", inventory, { disposition: "MANIFEST_INVENTORIED",
          sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } })).statusCode).toBe(200);
        const text = await claim("DOCUMENT_TEXT_LAYER");
        expect((await complete("DOCUMENT_TEXT_LAYER", text, {
          disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
          sources: originalFiles.map((file: any) => ({ sourceFileId: file.id,
            inputSha256: file.sha256, status: "EXTRACTED",
            artifact: fixture.textArtifacts[file.id].content_json })),
        })).statusCode).toBe(200);
        const render = await claim("DOCUMENT_RENDER");
        expect((await complete("DOCUMENT_RENDER", render, scaffold("DOCUMENT_RENDER", render))).statusCode)
          .toBe(200);
        const ocr = await claim("DOCUMENT_OCR_LAYOUT");
        const ocrStage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
          inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
          reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
          providerProfileId: boundedOcrProfileIdV5, providerConfigHash: boundedOcrConfigHashV5,
          outputCount: 0, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v5",
            objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
            profile: boundedOcrProfileV5, sourceCount: 2, ocrRequiredPageCount: 0,
            processedPageCount: 0, deferredPageCount: 0, skippedOversizePageCount: 0,
            skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
            subjectCandidatePageCount: 0, titleRecoveryCandidatePageCount: 0,
            sources: originalFiles.map((file: any) => ({ sourceFileId: file.id,
              sourceSha256: file.sha256, mediaType: "application/pdf", pageCount: 1,
              status: "NO_OCR_REQUIRED_PAGES", ocrRequiredPageCount: 0,
              processedPageCount: 0, deferredPageCount: 0, skippedRenderPixelPageCount: 0,
              subjectCandidatePageCount: 0, titleRecoveryCandidatePageCount: 0, pages: [] })) } };
        expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, ocrStage)).statusCode).toBe(200);
        for (const type of ["DOCUMENT_METADATA", "DOCUMENT_LINKING"] as const) {
          const lease = await claim(type);
          expect((await complete(type, lease, scaffold(type, lease))).statusCode).toBe(200);
        }
        const entity = await claim("ENTITY_EXTRACTION");
        const visual = { schemaVersion: "analysis-stage-result-v2", jobType: "ENTITY_EXTRACTION",
          inputManifestHash: entity.inputManifestHash,
          disposition: "VISUAL_PROPOSAL_SCAN", reasonCode: "PROPOSAL_ONLY_UNVERIFIED",
          providerKind: "ENTITY_EXTRACTION_MODEL",
          providerProfileId: visualProposalProfileId,
          providerConfigHash: visualProposalConfigHash, outputCount: 0,
          analysis: { schemaVersion: "visual-proposal-analysis-v4", objectId: entity.objectId,
            inputManifestHash: entity.inputManifestHash, profile: visualProposalProfile,
            sources: originalFiles.map((file: any) => ({ sourceFileId: file.id,
              sourceSha256: file.sha256, pageCount: 1, scannedPageCount: 1,
              scannedPageNumbers: [1], skippedPageCount: 0,
              documentContext: { schemaVersion: "document-context-v1",
                methodId: "first-two-pdf-cover-text-pages-v1", status: "UNKNOWN",
                reasonCode: "NO_TITLE_KEYWORD_MATCH",
                inspectedPages: [{ pageNumber: 1, textSha256: "c".repeat(64), titleWindow: null }] },
              status: "SCANNED", proposals: [], proposalLimitReached: false,
              unretainedProposalCount: 0 })) } };
        const visualCompletion = await complete("ENTITY_EXTRACTION", entity, visual);
        expect(visualCompletion.statusCode, visualCompletion.body).toBe(200);
        const rules = await claim("RULE_EVALUATION");
        expect(rules.release.providerSlot.profileId).toBe(ruleSlot.profileId);
        if (unresolved) expect(rules.release.rules.definitions.unresolvedFamilyReview)
          .toEqual(release.rules.definitions.unresolvedFamilyReview);
        const aids = pythonAids(rules.objectId, rules.inputManifestHash, ocrStage);
        const raw = structuredClone(fixture.result);
        raw.objectId = rules.objectId;
        raw.inputManifestHash = rules.inputManifestHash;
        const { contentHash: _old, ...body } = raw;
        raw.contentHash = sha256(canonicalJson(body));
        const result = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
          inputManifestHash: rules.inputManifestHash, disposition: "RULES_EVALUATED",
          providerKind: "RULE_ENGINE", providerProfileId: ruleSlot.profileId,
          providerConfigHash: ruleSlot.configHash, outputCount: unresolved ? 9 : 8,
          analysis: { schemaVersion: "pz-002-analysis-v1", objectId: rules.objectId,
            selectedManifestHash: rules.inputManifestHash,
            selectedFileIds: originalFiles.map((file: any) => file.id),
            route: { schemaVersion: "parameter-route-v1", stages: [] },
            extractedFacts: [], ocrArtifacts: [], evaluation: {
              schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-002-area",
              ruleVersion: "1", parameterCode: "PZ-002", objectId: rules.objectId,
              executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
              reasonCode: "MISSING_PD", evidence: [] } },
          heatLoad: { schemaVersion: "pz-017-analysis-v1", objectId: rules.objectId,
            selectedManifestHash: rules.inputManifestHash,
            selectedFileIds: originalFiles.map((file: any) => file.id),
            extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
            scannedPages: { PD: 1, RD: 1 }, ocrRequiredPageCount: 0,
            comparison: { schemaVersion: "pz-017-component-comparison-v1",
              parameterCode: "PZ-017", disposition: "ABSTAIN",
              reasonCode: "MISSING_COMPONENT_EVIDENCE", totalComparable: false, finding: null },
            evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
              ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
              executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
              reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null } },
          ocrHeatRows: { schemaVersion: "ocr-heat-row-proposals-v1",
            profileId: "conservative-ocr-heat-rows-v1",
            inputManifestHash: rules.inputManifestHash,
            proposals: [], abstentions: [], findingCount: 0 },
          factFamily: aids.family,
          candidateFamilyPreview: aids.preview,
          candidateFamilyObservations: aids.observations,
          candidateFamilyOcrObservations: aids.ocrObservations,
          ocrTableRows: aids.rows,
          ...(unresolved ? { unresolvedFamilyReview: raw } : {}) };
        if (unresolved) {
          const forged = structuredClone(result);
          forged.unresolvedFamilyReview.codeRows[0].leads[0].lineText = "Forged height";
          const { contentHash: _forged, ...forgedBody } = forged.unresolvedFamilyReview;
          forged.unresolvedFamilyReview.contentHash = sha256(canonicalJson(forgedBody));
          expect((await complete("RULE_EVALUATION", rules, forged)).statusCode).toBe(409);
          const badSha = structuredClone(result);
          badSha.unresolvedFamilyReview.sourceStageArtifacts[0].textArtifactSha256 = "f".repeat(64);
          const { contentHash: _oldSha, ...badShaBody } = badSha.unresolvedFamilyReview;
          badSha.unresolvedFamilyReview.contentHash = sha256(canonicalJson(badShaBody));
          expect((await complete("RULE_EVALUATION", rules, badSha)).statusCode).toBe(409);
        }
        const completed = await complete("RULE_EVALUATION", rules, result);
        expect(completed.statusCode, JSON.stringify(completed.json())).toBe(200);
        const evidence = await claim("EVIDENCE_VALIDATION");
        expect((await complete("EVIDENCE_VALIDATION", evidence,
          scaffold("EVIDENCE_VALIDATION", evidence))).statusCode).toBe(200);
        const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
        expect((await complete("ANALYSIS_SEAL_UNSUPPORTED", seal,
          { disposition: "UNSUPPORTED_COVERAGE_SEALED" })).statusCode).toBe(200);
        const response = await app!.inject({ method: "GET",
          url: `/api/checks/${checkId}/pilot-results`, headers: { cookie } });
        expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
        expect(response.json()).toMatchObject({ checkId, status: "READY" });
        if (unresolved) {
          expect(response.json().unresolvedFamilyReview.codeRows.map((row: any) =>
            row.leads.length)).toEqual([1, 1, 1]);
          expect(response.json().unresolvedFamilyReview.codeRows.every((row: any) =>
            row.status === "ABSTAIN")).toBe(true);
        } else expect(response.json().unresolvedFamilyReview).toBeUndefined();
        return { checkId, result };
      };
      const legacy = await run(false);
      expect(legacy.result.unresolvedFamilyReview).toBeUndefined();
      const current = await run(true);
      expect((await database.query<{ findings: string; unresolved: string; non_unsupported: string }>(
        `SELECT (SELECT count(*)::text FROM findings) AS findings,
                (SELECT count(*)::text FROM parameter_coverage
                 WHERE parameter_code = ANY($1::text[])) AS unresolved,
                (SELECT count(*)::text FROM parameter_coverage
                 WHERE parameter_code = ANY($1::text[]) AND execution_rollup <> 'UNSUPPORTED') AS non_unsupported`,
        [["AR-042", "IOS2-072", "IOS3-075"]])).rows[0])
        .toEqual({ findings: "0", unresolved: "6", non_unsupported: "0" });
      const tamperedStage = await database.query<{ id: string; content_json: Record<string, any> }>(
        `SELECT stage.id, stage.content_json FROM analysis_stage_artifacts stage
         JOIN analysis_runs run ON run.id = stage.run_id
         WHERE run.api_id = $1 AND stage.job_type = 'RULE_EVALUATION'`, [current.checkId]);
      const row = tamperedStage.rows[0];
      row.content_json.unresolvedFamilyReview.codeRows[0].leads[0].lineText = "Tampered after seal";
      const tamperConnection = await database.connect();
      try {
        await tamperConnection.query("BEGIN");
        await tamperConnection.query("SET LOCAL session_replication_role = replica");
        await tamperConnection.query(
          `UPDATE analysis_stage_artifacts SET content_json = $2::jsonb WHERE id = $1`,
          [row.id, canonicalJson(row.content_json)]);
        await tamperConnection.query("COMMIT");
      } finally {
        tamperConnection.release();
      }
      await expect(repository.getPilotResults(current.checkId, {
        sessionId: randomUUID(), userId: reviewer.id, displayName: "Synthetic reviewer",
        organizationId: reviewer.organizationId, roles: ["INSPECTOR"], capabilities: [],
        csrfHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })).rejects.toThrow();
    } finally {
      for (const key of settings) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      if (app) await app.close();
      else await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes database creation, migrations, Python extraction and durable replay.
});
