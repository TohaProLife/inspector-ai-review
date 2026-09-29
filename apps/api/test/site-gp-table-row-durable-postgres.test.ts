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
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { visualProposalConfigHash, visualProposalProfileId,
  visualProposalProfile } from "../src/visual-proposal.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const flags = ["INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE",
  "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "INSPECTOR_OCR_HEAT_ROW_PROFILE",
  "INSPECTOR_FACT_FAMILY_PROFILE", "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
  "INSPECTOR_OCR_TABLE_ROWS_PROFILE", "INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE"];
const workerJson = (value: any): string => Array.isArray(value)
  ? `[${value.map(workerJson).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);

function workerSidecar(objectId: string, manifestHash: string,
  source: Record<string, unknown>, artifact: Record<string, unknown>): Record<string, any> {
  const script = `import json,sys
from inspector_worker.site_gp_table_row_proposals import evaluate_site_gp_table_row_proposals
data=json.load(sys.stdin)
json.dump(evaluate_site_gp_table_row_proposals(data["objectId"],data["manifestHash"],
  [data["source"]],[data["artifact"]]),sys.stdout,ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const python = pythonExecutable;
  const child = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, source, artifact }), encoding: "utf8",
    env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Synthetic site GP table worker failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

suite("site GP table row durable review", () => {
  it("pins release and lease; saves, seals and reads PD/GP row proposals; rejects tamper", async () => {
    const name = `inspector_site_gp_table_${randomUUID().replaceAll("-", "")}`;
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
      process.env.INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE = "v1";
      const organizationSlug = `site-gp-table-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic PD/GP table", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "synthetic-gp.pdf", size: 100,
        stage: "PD" as const, mimeType: "application/pdf", sha256: "d".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"d".repeat(64)}/synthetic-gp.pdf` };
      expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
      const password = "Synthetic-GP-Table-2026!";
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `site-gp-table-${randomUUID()}`, displayName: "Synthetic reviewer",
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
      expect(ruleSlot).toMatchObject({ profileId: "typed-pz002-pz017-site-gp-table-row-review-v1",
        adapterVersion: "14" });
      expect(release.rules.definitions.siteGpTableRowReview).toEqual({
        ruleId: "pilot-site-gp-table-row-review", version: "1",
        extractionProfile: "site-gp-table-row-review-v1", codeCount: 2,
        disposition: "REVIEW_AID_ONLY" });
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
          payload: { workerId: "synthetic-site-gp-table", capabilities: [type] } });
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
      const box = (text: string, x0: number, y0: number, x1: number, y1: number) =>
        ({ text, bboxMilliPoints: [x0, y0, x1, y1] });
      const blocks = [
        box("КОНСТРУКЦИИ ДОРОЖНЫХ ОДЕЖД (ПРОЕЗДЫ)", 20_000, 900_000, 500_000, 914_000),
        box("Тип", 100_000, 870_000, 140_000, 880_000),
        box("Конструкция", 200_000, 870_000, 340_000, 880_000),
        box("Толщина\nслоя, м", 400_000, 870_000, 470_000, 880_000),
        box("Асфальтобетон слой 0", 205_000, 850_000, 350_000, 855_000),
        box("0,05", 410_000, 850_000, 450_000, 855_000),
        box("Устройство проезда из асфальтобетона", 10_000, 830_000, 80_000, 835_000),
        box("тип 1", 100_000, 830_000, 135_000, 835_000),
        box("ВЕДОМОСТЬ МАЛЫХ АРХИТЕКТУРНЫХ ФОРМ", 100_000, 500_000, 400_000, 514_000),
        box("Поз.", 110_000, 470_000, 145_000, 480_000),
        box("Наименование", 200_000, 470_000, 320_000, 480_000),
        box("Кол. Примечание", 360_000, 470_000, 460_000, 480_000),
        box("1", 110_000, 430_000, 130_000, 435_000),
        box("Кашпо тип 1 инд. изг.", 205_000, 430_000, 315_000, 435_000),
      ];
      const pageText = blocks.map((block) => block.text).join("\n");
      const nonWhitespace = Array.from(pageText).filter((character) =>
        !/[\t\n\v\f\r\u001c-\u001f\u0085\p{Zs}\p{Zl}\p{Zp}]/u.test(character)).length;
      const alphanumeric = Array.from(pageText).filter((character) =>
        /[\p{L}\p{N}]/u.test(character)).length;
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 1, qualityPolicyVersion: "text-layer-quality-v2",
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
        pages: [{ pageNumber: 1, widthMilliPoints: 800_000, heightMilliPoints: 1_000_000,
          blocks,
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
            blockCount: blocks.length, nonWhitespaceCharacterCount: nonWhitespace,
            alphanumericCharacterCount: alphanumeric,
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
      expect(sidecar.codeRows.map((row: any) => row.proposalCount)).toEqual([1, 2]);
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
        siteGpTableRowReview: sidecar };
      const absent = structuredClone(result);
      delete (absent as Record<string, unknown>).siteGpTableRowReview;
      expect((await complete("RULE_EVALUATION", rules, absent)).statusCode).toBe(409);
      const forged = structuredClone(result);
      forged.siteGpTableRowReview.codeRows[0].proposals[0].roles.name.blockText =
        "Подменённое название МАФ";
      expect((await complete("RULE_EVALUATION", rules, forged)).statusCode).toBe(409);
      expect((await complete("RULE_EVALUATION", rules, result)).statusCode).toBe(200);
      const ruleArtifact = (await database.query<{ id: string; content_json: Record<string, any> }>(
        `SELECT id, content_json FROM analysis_stage_artifacts
         WHERE run_id = $1 AND job_type = 'RULE_EVALUATION'`, [run.id])).rows[0];
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
      const tamperedProposal = tamperedRule.siteGpTableRowReview.codeRows[0].proposals[0];
      tamperedProposal.roles.name.blockText = "Подменённое название МАФ";
      const { adjacencyEvidenceSha256: _oldEvidenceHash,
        scopedSha256: _oldScopedDigest, sourceFileId: _sourceFileId,
        sourceSha256: _sourceSha256, textArtifactSha256: _textArtifactSha256,
        pageNumber: _pageNumber, sourceRole: _sourceRole,
        ...adjacencyBody } = tamperedProposal;
      tamperedProposal.adjacencyEvidenceSha256 = sha256(workerJson(adjacencyBody));
      const { scopedSha256: _oldScopedHash, ...scopedBody } = tamperedProposal;
      tamperedProposal.scopedSha256 = sha256(workerJson(scopedBody));
      const { contentHash: _oldSidecarHash, ...sidecarBody } =
        tamperedRule.siteGpTableRowReview;
      tamperedRule.siteGpTableRowReview.contentHash = sha256(workerJson(sidecarBody));
      await replaceRule(tamperedRule);
      const sealClient = await database.connect();
      try {
        await expect((repository as any).sealPilotPz002Run(sealClient,
          { ...run, api_id: check!.id })).rejects.toThrow(/site GP table row review aid/);
      } finally { sealClient.release(); }
      await replaceRule(ruleArtifact.content_json);
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
      expect(read.json().siteGpTableRowReview.codeRows.map((row: any) => row.proposalCount))
        .toEqual([1, 2]);
      expect(read.json().siteGpTableRowReview.codeRows.every((row: any) =>
        row.status === "ABSTAIN")).toBe(true);
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
