import { pythonExecutable, pythonEnv } from "./python.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresIdentityService } from "../src/identity.js";
import { buildPilotPz002Pz017ReleaseManifest,
  PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { unresolvedReviewConfigV2Sha256 } from "../src/unresolved-config-review-v2.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { visualProposalConfigHash, visualProposalProfileId,
  visualProposalProfile } from "../src/visual-proposal.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const flags = ["INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE",
  "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "INSPECTOR_OCR_HEAT_ROW_PROFILE",
  "INSPECTOR_FACT_FAMILY_PROFILE", "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
  "INSPECTOR_OCR_TABLE_ROWS_PROFILE", "INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE",
  "INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE", "INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE",
  "INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE", "INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE",
  "INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE"];
const workerJson = (value: any): string => Array.isArray(value)
  ? `[${value.map(workerJson).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);

function workerSidecar(objectId: string, manifestHash: string,
  source: Record<string, unknown>, artifact: Record<string, unknown>): Record<string, any> {
  const script = `import json,sys
from inspector_worker.unresolved_config_review_v2 import evaluate_unresolved_config_review_v2
data=json.load(sys.stdin)
json.dump(evaluate_unresolved_config_review_v2(data["objectId"],data["manifestHash"],
  [data["source"]],[data["artifact"]]),sys.stdout,ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const python = pythonExecutable;
  const child = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, source, artifact }), encoding: "utf8",
    env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Synthetic unresolved config worker failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

suite("unresolved config v2 durable review", () => {
  it("pins release and lease; saves, seals and reads PD/GP text leads; rejects tamper", async () => {
    const name = `inspector_unresolved_config_v2_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    const previous = Object.fromEntries(flags.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 3 });
      for (const key of flags) delete process.env[key];
      process.env.INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE = "v2";
      const organizationSlug = `unresolved-config-v2-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic PD/GP unresolved review", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "synthetic-gp.pdf", size: 100,
        stage: "PD" as const, mimeType: "application/pdf", sha256: "d".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"d".repeat(64)}/synthetic-gp.pdf` };
      expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
      const password = "Synthetic-Unresolved-Config-V2-2026!";
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `unresolved-config-v2-${randomUUID()}`, displayName: "Synthetic reviewer",
        password, role: "INSPECTOR", capabilities: ["SOURCE_REVIEW"],
        objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const workerToken = `worker-${randomUUID()}`;
      app = await buildApp({ repository, workerToken,
        identityService: PostgresIdentityService.create({ connectionString: url.toString(),
          organizationSlug }) });
      const login = await app.inject({ method: "POST", url: "/api/auth/login",
        payload: { login: reviewer.login, password } });
      expect(login.statusCode).toBe(200);
      const cookies = (login.headers["set-cookie"] as string[]).map((part) => part.split(";", 1)[0]);
      const csrf = decodeURIComponent(cookies.find((part) => part.startsWith("inspector_csrf="))!
        .slice("inspector_csrf=".length));
      const cookie = cookies.join("; ");
      const reviewed = await app.inject({ method: "POST",
        url: `/api/objects/${object.id}/files/${file.id}/source-review`,
        headers: { cookie, "x-csrf-token": csrf, "idempotency-key": `synthetic-${randomUUID()}` },
        payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
          approvalStatus: "APPROVED", linkGroupId: "synthetic-only", sectionCode: "GP",
          pageStages: {}, basis: { reference: "Synthetic fixture; no actual PD approval." } } });
      expect(reviewed.statusCode, reviewed.body).toBe(201);
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const release = (await database.query<{ content_json: Record<string, any> }>(
        `SELECT release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id])).rows[0].content_json;
      const ruleSlot = release.providerSlots.find((slot: any) => slot.stageJobType === "RULE_EVALUATION");
      expect(ruleSlot).toMatchObject({ profileId: "typed-pz002-pz017-unresolved-config-review-v2",
        adapterVersion: "18",
        configHash: "58d0eb1afbc63c329a29b4935ad575bd64a72a1934191b5fd56d3f0675272ace" });
      expect(release.rules.definitions.unresolvedConfigReviewV2).toEqual({
        ruleId: "pilot-unresolved-config-review-v2", version: "1",
        extractionProfile: "unresolved-review-config-v2",
        configSha256: unresolvedReviewConfigV2Sha256, codeCount: 10,
        disposition: "REVIEW_AID_ONLY" });
      expect(sha256(workerJson(release.rules.unresolvedConfigV2)))
        .toBe(unresolvedReviewConfigV2Sha256);
      const legacy = buildPilotPz002Pz017ReleaseManifest(
        (await loadReferenceData()).parameters.length).manifest;
      expect(legacy.rules).not.toHaveProperty("unresolvedConfigV2");
      expect(legacy.rules.definitions).not.toHaveProperty("unresolvedConfigReviewV2");
      expect(legacy.providerSlots.find((slot) => slot.stageJobType === "RULE_EVALUATION")
        ?.profileId).toBe("typed-pz002-pz017-v1");
      const run = (await database.query<{ id: string; object_id: string; inspection_id: string }>(
        `SELECT id, object_id, inspection_id FROM analysis_runs WHERE api_id = $1`,
        [check!.id])).rows[0];
      const jobId = async (type: string) => (await database!.query<{ id: string }>(
        `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
         WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type])).rows[0].id;
      const claim = async (type: string) => {
        const response = await app!.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "synthetic-unresolved-config-v2", capabilities: [type] } });
        expect(response.statusCode, `${type}: ${response.body}`).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: unknown) =>
        app!.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const scaffold = (type: string, lease: Record<string, any>,
        disposition: string, reasonCode: string, providerKind: string) => ({
        schemaVersion: "analysis-stage-result-v1", jobType: type,
        inputManifestHash: lease.inputManifestHash, disposition, reasonCode,
        providerKind, providerProfileId: null, providerConfigHash: null, outputCount: 0,
      });
      const inventory = await claim("ANALYSIS_INVENTORY");
      expect((await complete("ANALYSIS_INVENTORY", inventory, {
        disposition: "MANIFEST_INVENTORIED", sourceCount: 1,
        stageCounts: { PD: 1, RD: 0, ID: 0 } })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const labels = ["Ведомость типов покрытий"];
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 1, qualityPolicyVersion: "text-layer-quality-v2",
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
        pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: labels.map((value, index) => ({
            bboxMilliPoints: [10_000, 20_000 + index * 30_000,
              300_000, 40_000 + index * 30_000], text: value })),
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
            blockCount: 1, nonWhitespaceCharacterCount: labels.join("").replaceAll(" ", "").length,
            alphanumericCharacterCount: labels.join("").replaceAll(" ", "").length,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          } } }] };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, {
        disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
          status: "EXTRACTED", artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      expect((await complete("DOCUMENT_RENDER", render, scaffold("DOCUMENT_RENDER", render,
        "PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"))).statusCode).toBe(200);
      const metadata = await claim("DOCUMENT_METADATA");
      expect((await complete("DOCUMENT_METADATA", metadata, scaffold("DOCUMENT_METADATA",
        metadata, "PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED",
        "METADATA_EXTRACTOR"))).statusCode).toBe(200);
      const linking = await claim("DOCUMENT_LINKING");
      expect((await complete("DOCUMENT_LINKING", linking, scaffold("DOCUMENT_LINKING",
        linking, "POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED",
        "LINKING_POLICY"))).statusCode).toBe(200);
      const entity = await claim("ENTITY_EXTRACTION");
      const visual = { schemaVersion: "analysis-stage-result-v2", jobType: "ENTITY_EXTRACTION",
        inputManifestHash: entity.inputManifestHash, disposition: "VISUAL_PROPOSAL_SCAN",
        reasonCode: "PROPOSAL_ONLY_UNVERIFIED", providerKind: "ENTITY_EXTRACTION_MODEL",
        providerProfileId: visualProposalProfileId, providerConfigHash: visualProposalConfigHash,
        outputCount: 0, analysis: { schemaVersion: "visual-proposal-analysis-v4",
          objectId: entity.objectId, inputManifestHash: entity.inputManifestHash,
          profile: visualProposalProfile, sources: [{ sourceFileId: file.id,
            sourceSha256: file.sha256, pageCount: 1, scannedPageCount: 1,
            scannedPageNumbers: [1], skippedPageCount: 0,
            documentContext: { schemaVersion: "document-context-v1",
              methodId: "first-two-pdf-cover-text-pages-v1", status: "UNKNOWN",
              reasonCode: "NO_TITLE_KEYWORD_MATCH",
              inspectedPages: [{ pageNumber: 1, textSha256: "c".repeat(64), titleWindow: null }] },
            status: "SCANNED", proposals: [], proposalLimitReached: false,
            unretainedProposalCount: 0 }] } };
      expect((await complete("ENTITY_EXTRACTION", entity, visual)).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      expect(rules.release.rules.definitions).toEqual(release.rules.definitions);
      const source = { objectId: rules.objectId, ...rules.inputs.sourceFiles[0],
        ...rules.inputs.sourceDecisions[file.id] };
      const sidecar = workerSidecar(rules.objectId, rules.inputManifestHash,
        source, textArtifact);
      expect(sidecar.codeRows).toHaveLength(10);
      expect(sidecar.codeRows.find((row: any) => row.parameterCode === "SPZU-026")?.leads)
        .toHaveLength(1);
      expect(sidecar.codeRows.reduce((sum: number, row: any) => sum + row.leads.length, 0))
        .toBe(1);
      expect(sidecar.codeRows.every((row: any) => row.status === "ABSTAIN")).toBe(true);
      expect(sidecar.findingCount).toBeNull();
      expect(sidecar.parameterCoverage).toBeNull();
      const result = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
        inputManifestHash: rules.inputManifestHash, disposition: "RULES_EVALUATED",
        providerKind: "RULE_ENGINE", providerProfileId: ruleSlot.profileId,
        providerConfigHash: ruleSlot.configHash, outputCount: 3,
        analysis: { schemaVersion: "pz-002-analysis-v1", objectId: rules.objectId,
          selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
          route: { schemaVersion: "parameter-route-v1", stages: [] },
          extractedFacts: [], ocrArtifacts: [], evaluation: {
            schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-002-area",
            ruleVersion: "1", parameterCode: "PZ-002", objectId: rules.objectId,
            executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
            reasonCode: "MISSING_RD", evidence: [] } },
        heatLoad: { schemaVersion: "pz-017-analysis-v1", objectId: rules.objectId,
          selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
          extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
          scannedPages: { PD: 1, RD: 0 }, ocrRequiredPageCount: 0,
          comparison: { schemaVersion: "pz-017-component-comparison-v1",
            parameterCode: "PZ-017", disposition: "ABSTAIN",
            reasonCode: "MISSING_COMPONENT_EVIDENCE", totalComparable: false, finding: null },
          evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
            ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
            executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
            reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null } },
        unresolvedConfigReviewV2: sidecar };
      const absent = structuredClone(result);
      delete (absent as Record<string, unknown>).unresolvedConfigReviewV2;
      expect((await complete("RULE_EVALUATION", rules, absent)).statusCode).toBe(409);
      const forged = structuredClone(result);
      forged.unresolvedConfigReviewV2.codeRows.find((row: any) =>
        row.parameterCode === "SPZU-026").leads[0].lineText = "подменённая площадь";
      expect((await complete("RULE_EVALUATION", rules, forged)).statusCode).toBe(409);
      const completedRules = await complete("RULE_EVALUATION", rules, result);
      expect(completedRules.statusCode, completedRules.body).toBe(200);
      const ruleArtifact = (await database.query<{ id: string; content_json: Record<string, any>;
        content_hash: string; byte_size: number }>(
        `SELECT id, content_json, content_hash, byte_size FROM analysis_stage_artifacts
         WHERE run_id = $1 AND job_type = 'RULE_EVALUATION'`, [run.id])).rows[0];
      expect(ruleArtifact.content_json.unresolvedConfigReviewV2).toEqual(sidecar);
      expect(ruleArtifact.content_json).toEqual(result);
      expect(ruleArtifact.content_hash).toBe(sha256(canonicalJson(result)));
      expect(Number(ruleArtifact.byte_size)).toBe(Buffer.byteLength(canonicalJson(result), "utf8"));
      const replaceRule = async (content: Record<string, unknown>) => {
        const canonical = canonicalJson(content);
        const connection = await database!.connect();
        try {
          await connection.query("BEGIN");
          await connection.query("SET LOCAL session_replication_role = replica");
          await connection.query(`UPDATE analysis_stage_artifacts
            SET content_json = $2::jsonb, content_hash = $3, byte_size = $4 WHERE id = $1`,
          [ruleArtifact.id, canonical, sha256(canonical), Buffer.byteLength(canonical, "utf8")]);
          await connection.query("COMMIT");
        } finally { connection.release(); }
      };
      const tamperedRule = structuredClone(ruleArtifact.content_json);
      const tamperedLead = tamperedRule.unresolvedConfigReviewV2.codeRows.find((row: any) =>
        row.parameterCode === "SPZU-026").leads[0];
      tamperedLead.lineText = "Подмена площади застройки";
      const { leadSha256: _oldLeadHash, ...leadBody } = tamperedLead;
      tamperedLead.leadSha256 = sha256(workerJson(leadBody));
      const { contentHash: _oldSidecarHash, ...sidecarBody } =
        tamperedRule.unresolvedConfigReviewV2;
      tamperedRule.unresolvedConfigReviewV2.contentHash = sha256(workerJson(sidecarBody));
      await replaceRule(tamperedRule);
      const sealClient = await database.connect();
      try {
        await expect((repository as any).sealPilotPz002Run(sealClient,
          { ...run, api_id: check!.id })).rejects.toThrow(/unresolved config v2 review aid/);
      } finally { sealClient.release(); }
      await replaceRule(ruleArtifact.content_json);
      const storedRelease = (await database.query<{
        release_id: string; content_json: Record<string, any> }>(
        `SELECT release.release_id, release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id])).rows[0];
      const replaceRelease = async (content: Record<string, unknown>) => {
        const canonical = canonicalJson(content);
        const connection = await database!.connect();
        try {
          await connection.query("BEGIN");
          await connection.query("SET LOCAL session_replication_role = replica");
          await connection.query(`UPDATE analysis_releases SET content_json = $2::jsonb,
            content_hash = $3, byte_size = $4 WHERE release_id = $1`,
          [storedRelease.release_id, canonical, sha256(canonical),
            Buffer.byteLength(canonical, "utf8")]);
          await connection.query("COMMIT");
        } finally { connection.release(); }
      };
      const tamperedConfig = structuredClone(storedRelease.content_json);
      tamperedConfig.rules.unresolvedConfigV2.entries[0].anchors[0] = "подменённые покрытия";
      await replaceRelease(tamperedConfig);
      const configSealClient = await database.connect();
      try {
        await expect((repository as any).sealPilotPz002Run(configSealClient,
          { ...run, api_id: check!.id })).rejects.toThrow();
      } finally { configSealClient.release(); }
      await replaceRelease(storedRelease.content_json);
      const evidence = await claim("EVIDENCE_VALIDATION");
      expect((await complete("EVIDENCE_VALIDATION", evidence, scaffold("EVIDENCE_VALIDATION",
        evidence, "NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE",
        "EVIDENCE_VALIDATOR"))).statusCode).toBe(200);
      const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
      expect((await complete("ANALYSIS_SEAL_UNSUPPORTED", seal,
        { disposition: "UNSUPPORTED_COVERAGE_SEALED" })).statusCode).toBe(200);
      const read = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().unresolvedConfigReviewV2.codeRows).toHaveLength(10);
      expect(read.json().unresolvedConfigReviewV2.codeRows.find((row: any) =>
        row.parameterCode === "SPZU-026").leads).toHaveLength(1);
      expect(read.json().unresolvedConfigReviewV2.codeRows.every((row: any) =>
        row.status === "ABSTAIN")).toBe(true);
      expect(read.json().unresolvedConfigReviewV2).toEqual(sidecar);
      const crossProfileRule = structuredClone(ruleArtifact.content_json);
      crossProfileRule.unresolvedConfigReview = sidecar;
      await replaceRule(crossProfileRule);
      const crossProfileRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(crossProfileRead.statusCode).toBe(500);
      await replaceRule(ruleArtifact.content_json);
      const textRow = (await database.query<{ id: string; content_json: Record<string, any> }>(
        `SELECT id, content_json FROM analysis_text_artifacts WHERE run_id = $1`,
        [run.id])).rows[0];
      const tampered = structuredClone(textRow.content_json);
      tampered.pages[0].blocks[0].text = "Подмена исходного текста";
      const canonical = canonicalJson(tampered);
      const connection = await database.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SET LOCAL session_replication_role = replica");
        await connection.query(`UPDATE analysis_text_artifacts SET content_json = $2::jsonb,
          content_hash = $3, byte_size = $4 WHERE id = $1`,
        [textRow.id, canonical, sha256(canonical), Buffer.byteLength(canonical, "utf8")]);
        await connection.query("COMMIT");
      } finally { connection.release(); }
      const tamperedRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(tamperedRead.statusCode).toBe(500);
    } finally {
      for (const key of flags) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      if (app) await app.close();
      else await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes isolated database setup and a complete durable lifecycle.
});
