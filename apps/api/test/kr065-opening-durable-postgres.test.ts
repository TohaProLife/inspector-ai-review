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
import { boundedOcrConfigHash, boundedOcrProfile, boundedOcrProfileId } from "../src/ocr-layout.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { visualProposalConfigHash, visualProposalProfileId,
  visualProposalProfile } from "../src/visual-proposal.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const flags = ["INSPECTOR_KR065_OPENING_REVIEW_PROFILE",
  "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "INSPECTOR_OCR_HEAT_ROW_PROFILE",
  "INSPECTOR_FACT_FAMILY_PROFILE", "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
  "INSPECTOR_OCR_TABLE_ROWS_PROFILE", "INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE",
  "INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE",
  "INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE",
  "INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE",
  "INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE",
  "INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE"];
const workerJson = (value: any): string => Array.isArray(value)
  ? `[${value.map(workerJson).join(",")}]`
  : value !== null && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);

function workerSidecar(objectId: string, manifestHash: string,
  source: Record<string, unknown>, artifact: Record<string, unknown>): Record<string, any> {
  const script = `import json,sys
from inspector_worker.kr065_opening_proposals import evaluate_kr065_opening_proposals
data=json.load(sys.stdin)
json.dump(evaluate_kr065_opening_proposals(data["objectId"],data["manifestHash"],
  [data["source"]],[data["artifact"]]),sys.stdout,ensure_ascii=False)
`;
  const workerPath = fileURLToPath(new URL("../../../services/worker", import.meta.url));
  const python = pythonExecutable;
  const child = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ objectId, manifestHash, source, artifact }), encoding: "utf8",
    env: { ...process.env, ...pythonEnv, PYTHONPATH: workerPath },
  });
  if (child.status !== 0) throw new Error(`Synthetic KR-065 opening worker failed: ${child.stderr}`);
  return JSON.parse(child.stdout);
}

suite("KR-065 opening durable review", () => {
  it("pins release and lease; saves, seals and reads RD/KR proposals with OCR defer; rejects tamper", async () => {
    const name = `inspector_kr065_opening_${randomUUID().replaceAll("-", "")}`;
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
      process.env.INSPECTOR_KR065_OPENING_REVIEW_PROFILE = "v1";
      const organizationSlug = `kr065-opening-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic RD/KR opening notes", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "synthetic-kr.pdf", size: 100,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "d".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"d".repeat(64)}/synthetic-kr.pdf` };
      expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
      const password = "Synthetic-Kr065-Opening-2026!";
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `kr065-opening-${randomUUID()}`, displayName: "Synthetic reviewer",
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
          approvalStatus: "APPROVED", linkGroupId: "synthetic-only", sectionCode: "KR",
          pageStages: {}, basis: { reference: "Synthetic fixture; no actual RD approval." } } });
      expect(reviewed.statusCode, reviewed.body).toBe(201);
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const release = (await database.query<{ content_json: Record<string, any> }>(
        `SELECT release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id])).rows[0].content_json;
      const ruleSlot = release.providerSlots.find((slot: any) => slot.stageJobType === "RULE_EVALUATION");
      expect(ruleSlot).toMatchObject({ profileId: "typed-pz002-pz017-kr065-opening-review-v1",
        adapterVersion: "21" });
      expect(ruleSlot.configHash)
        .toBe("ab7fbad525ea3d15352d14f0fb56af86068fc0ff25d3a5477fc7eab3f3d6f7e3");
      expect(release.rules.definitions.kr065OpeningReview).toEqual({
        ruleId: "pilot-kr065-opening-review-v1", version: "1",
        extractionProfile: "kr065-opening-review-v1", codeCount: 1,
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
          payload: { workerId: "synthetic-kr065-opening", capabilities: [type] } });
        expect(response.statusCode, `${type}: ${response.body}`).toBe(200);
        expect(response.json().lease, `${type}: ${response.body}`).toBeDefined();
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
        stageCounts: { PD: 0, RD: 1, ID: 0 } })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const labels = ["Обрамление отверстия № 12 200х300 мм"];
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 2, textPageCount: 1, qualityPolicyVersion: "text-layer-quality-v2",
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 1 },
        pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: labels.map((value, index) => ({
            bboxMilliPoints: [10_000, 20_000 + index * 30_000,
              300_000, 40_000 + index * 30_000], text: value })),
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: {
            blockCount: 1, nonWhitespaceCharacterCount: labels.join("").replaceAll(" ", "").length,
            alphanumericCharacterCount: [...labels.join("")].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length,
            replacementCharacterCount: 0, disallowedControlCharacterCount: 0,
          } } }, { pageNumber: 2, widthMilliPoints: 595_000,
          heightMilliPoints: 842_000, blocks: [], quality: {
            disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"], metrics: {
              blockCount: 0, nonWhitespaceCharacterCount: 0,
              alphanumericCharacterCount: 0, replacementCharacterCount: 0,
              disallowedControlCharacterCount: 0,
            },
          } }] };
      expect((await complete("DOCUMENT_TEXT_LAYER", text, {
        disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: [{ sourceFileId: file.id, inputSha256: file.sha256,
          status: "EXTRACTED", artifact: textArtifact }],
      })).statusCode).toBe(200);
      const render = await claim("DOCUMENT_RENDER");
      expect((await complete("DOCUMENT_RENDER", render, scaffold("DOCUMENT_RENDER", render,
        "PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"))).statusCode).toBe(200);
      const ocr = await claim("DOCUMENT_OCR_LAYOUT");
      const ocrPage: Record<string, unknown> = {
        schemaVersion: "document-ocr-page-v1", sourceFileId: file.id,
        inputSha256: file.sha256, pageNumber: 2,
        render: { sha256: "b".repeat(64), widthPx: 1000, heightPx: 1000,
          dpi: 120, rendererProfileId: "pdfium-test" },
        provider: { profileId: "local-paddle-test", script: "eslav" }, lines: [],
      };
      ocrPage.contentHash = sha256(canonicalJson(ocrPage));
      const ocrResult = await complete("DOCUMENT_OCR_LAYOUT", ocr, {
        schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: ocr.inputManifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: boundedOcrProfileId, providerConfigHash: boundedOcrConfigHash,
        outputCount: 1, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v1",
          objectId: ocr.objectId, inputManifestHash: ocr.inputManifestHash,
          profile: boundedOcrProfile, sourceCount: 1, ocrRequiredPageCount: 1,
          processedPageCount: 1, deferredPageCount: 0,
          skippedOversizePageCount: 0, skippedUnsupportedSourceCount: 0,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 2, status: "SCANNED",
            ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
            pages: [ocrPage] }] },
      });
      expect(ocrResult.statusCode, ocrResult.body).toBe(200);
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
            sourceSha256: file.sha256, pageCount: 2, scannedPageCount: 2,
            scannedPageNumbers: [1, 2], skippedPageCount: 0,
            documentContext: { schemaVersion: "document-context-v1",
              methodId: "first-two-pdf-cover-text-pages-v1", status: "UNKNOWN",
              reasonCode: "NO_TITLE_KEYWORD_MATCH",
              inspectedPages: [{ pageNumber: 1, textSha256: "c".repeat(64), titleWindow: null },
                { pageNumber: 2, textSha256: "e".repeat(64), titleWindow: null }] },
            status: "SCANNED", proposals: [], proposalLimitReached: false,
            unretainedProposalCount: 0 }] } };
      expect((await complete("ENTITY_EXTRACTION", entity, visual)).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      expect(rules.release.rules.definitions).toEqual(release.rules.definitions);
      const source = { objectId: rules.objectId, ...rules.inputs.sourceFiles[0],
        ...rules.inputs.sourceDecisions[file.id] };
      const sidecar = workerSidecar(rules.objectId, rules.inputManifestHash,
        source, textArtifact);
      expect(sidecar.codeRows.map((row: any) => row.proposals.length)).toEqual([1]);
      expect(sidecar.codeRows.map((row: any) => row.ocrRequiredPageCount)).toEqual([1]);
      expect(sidecar.codeRows[0].reasonCodes).toContain("OCR_REQUIRED_DEFERRED");
      expect(sidecar.codeRows[0].proposals[0].proposalKind)
        .toBe("OPENING_LABEL_DIMENSION_NAVIGATION");
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
          scannedPages: { PD: 0, RD: 2 }, ocrRequiredPageCount: 1,
          comparison: { schemaVersion: "pz-017-component-comparison-v1",
            parameterCode: "PZ-017", disposition: "ABSTAIN",
            reasonCode: "MISSING_COMPONENT_EVIDENCE", totalComparable: false, finding: null },
          evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
            ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
            executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
            reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null } },
        kr065OpeningReview: sidecar };
      const absent = structuredClone(result);
      delete (absent as Record<string, unknown>).kr065OpeningReview;
      expect((await complete("RULE_EVALUATION", rules, absent)).statusCode).toBe(409);
      const forged = structuredClone(result);
      forged.kr065OpeningReview.codeRows[0].proposals[0].anchor.lineText = "подменённый проём";
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
      const tamperedProposal = tamperedRule.kr065OpeningReview.codeRows[0].proposals[0];
      tamperedProposal.anchor.lineText = "Подмена проёма";
      tamperedProposal.anchor.lineTextSha256 = sha256("Подмена проёма");
      const { scopedSha256: _oldScopedHash, ...proposalBody } = tamperedProposal;
      tamperedProposal.scopedSha256 = sha256(workerJson(proposalBody));
      const { contentHash: _oldSidecarHash, ...sidecarBody } =
        tamperedRule.kr065OpeningReview;
      tamperedRule.kr065OpeningReview.contentHash = sha256(workerJson(sidecarBody));
      await replaceRule(tamperedRule);
      const sealClient = await database.connect();
      try {
        await expect((repository as any).sealPilotPz002Run(sealClient,
          { ...run, api_id: check!.id })).rejects.toThrow(/KR-065 opening review aid/);
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
      expect(read.json().kr065OpeningReview.codeRows.map((row: any) => row.proposals.length))
        .toEqual([1]);
      expect(read.json().kr065OpeningReview.codeRows.every((row: any) =>
        row.status === "ABSTAIN")).toBe(true);
      expect(read.json().kr065OpeningReview.codeRows[0]).toMatchObject({
        ocrRequiredPageCount: 1, absenceConclusion: "NOT_AVAILABLE" });
      const crossProfile = structuredClone(ruleArtifact.content_json);
      crossProfile.unresolvedConfigReview = { schemaVersion: "unresolved-config-run-review-v1" };
      await replaceRule(crossProfile);
      const crossRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(crossRead.statusCode).toBe(500);
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
