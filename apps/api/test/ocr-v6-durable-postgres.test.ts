import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyUnresolvedFamilyOcrReview } from "../src/unresolved-family-ocr-review.js";
import { verifyPilotHeatAnalysis } from "../src/pilot-heat.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresIdentityService } from "../src/identity.js";
import { boundedOcrConfigHashV6, boundedOcrProfileIdV6,
  boundedOcrProfileV6 } from "../src/ocr-layout.js";
import { visualProposalConfigHash, visualProposalProfileId,
  visualProposalProfile } from "../src/visual-proposal.js";
import { buildPilotPz002Pz017ReleaseManifest,
  PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const databaseSuite = adminUrl ? describe : describe.skip;
const settings = ["INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "INSPECTOR_OCR_HEAT_ROW_PROFILE",
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

databaseSuite("OCR v6 immutable run integration", () => {
  it("pins separate release, accepts reviewed stage, rejects forged stage and changed snapshot", async () => {
    const dbName = `inspector_ocrv6_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    const previous = Object.fromEntries(settings.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${dbName}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 3 });
      for (const key of settings) delete process.env[key];
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v6";
      process.env.INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE = "v1";
      const reference = await loadReferenceData();
      const organizationSlug = `ocr-v6-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: reference.parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic OCR v6", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "synthetic.pdf", size: 100,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "e".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"e".repeat(64)}/synthetic.pdf` };
      expect(await repository.registerIngestedFiles(object.id, [file])).toBeDefined();
      const password = "Synthetic-OCR-Only-2026!";
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `ocr-v6-${randomUUID()}`, displayName: "Synthetic reviewer",
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
      const review = await app.inject({ method: "POST",
        url: `/api/objects/${object.id}/files/${file.id}/source-review`,
        headers: { cookie, "x-csrf-token": csrf, "idempotency-key": `synthetic-${randomUUID()}` },
        payload: { sourceSha256: file.sha256, revisionStatus: "CURRENT",
          approvalStatus: "APPROVED", linkGroupId: "synthetic-only", sectionCode: "AR",
          pageStages: {}, basis: { reference: "Synthetic fixture, no real source approval." } } });
      expect(review.statusCode, review.body).toBe(201);
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const release = (await database.query<{ content_json: Record<string, any> }>(
        `SELECT release.content_json FROM analysis_releases release
         JOIN analysis_runs run ON run.release_id = release.release_id
         WHERE run.api_id = $1`, [check!.id])).rows[0].content_json;
      expect(release.providerSlots.find((slot: any) => slot.stageJobType === "DOCUMENT_OCR_LAYOUT"))
        .toMatchObject({ profileId: boundedOcrProfileIdV6,
          adapterVersion: "6", configHash: boundedOcrConfigHashV6 });
      const ruleSlot = release.providerSlots.find((slot: any) => slot.stageJobType === "RULE_EVALUATION");
      expect(ruleSlot).toMatchObject({
        profileId: "typed-pz002-pz017-ocr-v6-unresolved-family-review-v1",
        adapterVersion: "11" });
      expect(release.rules.definitions.unresolvedFamilyOcrReview).toEqual({
        ruleId: "pilot-unresolved-family-ocr-review", version: "1",
        extractionProfile: "unresolved-family-ocr-review-v1", codeCount: 3,
        disposition: "REVIEW_AID_ONLY" });
      const jobId = async (type: string) => (await database!.query<{ id: string }>(
        `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
         WHERE run.api_id = $1 AND job.job_type = $2`, [check!.id, type])).rows[0].id;
      const claim = async (type: string) => {
        const response = await app!.inject({ method: "POST",
          url: `/api/internal/v1/jobs/${await jobId(type)}/claim`,
          headers: { "x-worker-token": workerToken },
          payload: { workerId: "synthetic-ocr-v6", capabilities: [type] } });
        expect(response.statusCode, `${type}: ${response.body}`).toBe(200);
        return response.json().lease as Record<string, any>;
      };
      const complete = async (type: string, lease: Record<string, any>, result: unknown) =>
        app!.inject({ method: "POST", url: `/api/internal/v1/jobs/${await jobId(type)}/complete`,
          headers: { "x-worker-token": workerToken },
          payload: { attemptId: lease.attemptId, fencingToken: lease.fencingToken, result } });
      const inventory = await claim("ANALYSIS_INVENTORY");
      expect((await complete("ANALYSIS_INVENTORY", inventory, { disposition: "MANIFEST_INVENTORIED",
        sourceCount: 1, stageCounts: { PD: 0, RD: 1, ID: 0 } })).statusCode).toBe(200);
      const text = await claim("DOCUMENT_TEXT_LAYER");
      const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: file.id,
        inputSha256: file.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 0, qualityPolicyVersion: "text-layer-quality-v2",
        qualitySummary: { textLayerCandidatePageCount: 0, ocrRequiredPageCount: 1 },
        pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: [], quality: { disposition: "OCR_REQUIRED", reasonCodes: ["EMPTY_TEXT_LAYER"],
            metrics: { blockCount: 0, nonWhitespaceCharacterCount: 0,
              alphanumericCharacterCount: 0, replacementCharacterCount: 0,
              disallowedControlCharacterCount: 0 } } }] };
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
      const page: Record<string, unknown> = { schemaVersion: "document-ocr-page-v1",
        sourceFileId: file.id, inputSha256: file.sha256, pageNumber: 1,
        render: { sha256: "f".repeat(64), widthPx: 992, heightPx: 1404,
          dpi: 120, rendererProfileId: boundedOcrProfileV6.rendererProfileId },
        provider: { profileId: boundedOcrProfileV6.ocrProviderProfileIds[0], script: "eslav" },
        lines: [{ text: "высота коридора", score: 0.98, bboxPx: [20, 30, 260, 70] }] };
      page.contentHash = sha256(canonicalJson(page));
      const stage: Record<string, any> = { schemaVersion: "analysis-stage-result-v2",
        jobType: "DOCUMENT_OCR_LAYOUT", inputManifestHash: ocr.inputManifestHash,
        disposition: "OCR_LAYOUT_BOUNDED", reasonCode: "BOUNDED_OCR_ONLY",
        providerKind: "OCR_LAYOUT", providerProfileId: boundedOcrProfileIdV6,
        providerConfigHash: boundedOcrConfigHashV6, outputCount: 1,
        analysis: { schemaVersion: "bounded-ocr-layout-analysis-v6", objectId: ocr.objectId,
          inputManifestHash: ocr.inputManifestHash, profile: boundedOcrProfileV6,
          sourceCount: 1, ocrRequiredPageCount: 1, processedPageCount: 1,
          deferredPageCount: 0, skippedOversizePageCount: 0,
          skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
          reviewEligiblePageCount: 1, stageUnresolvedPageCount: 0,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            mediaType: "application/pdf", pageCount: 1, status: "SCANNED",
            ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
            skippedRenderPixelPageCount: 0, reviewEligiblePageCount: 1,
            stageUnresolvedPageCount: 0, selectionReasonCodes: [], pages: [page] }] } };
      const forged = structuredClone(stage);
      forged.analysis.sources[0].pages[0].pageNumber = 2;
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, forged)).statusCode).toBe(409);
      const runRow = (await database.query<{ id: string; object_id: string;
        inspection_id: string }>(
          `SELECT id, object_id, inspection_id FROM analysis_runs WHERE api_id = $1`,
          [check!.id])).rows[0];
      const snapshotHash = (await database.query<{ decision_hash: string }>(
        `SELECT decision_hash FROM run_source_review_snapshots WHERE run_id = $1`,
        [runRow.id])).rows[0].decision_hash;
      const setSnapshotHash = async (value: string) => {
        const connection = await database!.connect();
        try {
          await connection.query("BEGIN");
          await connection.query("SET LOCAL session_replication_role = replica");
          await connection.query(
            `UPDATE run_source_review_snapshots SET decision_hash = $2 WHERE run_id = $1`,
            [runRow.id, value]);
          await connection.query("COMMIT");
        } finally { connection.release(); }
      };
      await setSnapshotHash("0".repeat(64));
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, stage)).statusCode).toBe(409);
      await setSnapshotHash(snapshotHash);
      expect((await complete("DOCUMENT_OCR_LAYOUT", ocr, stage)).statusCode).toBe(200);
      const read = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/ocr-layout`, headers: { cookie } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ schemaVersion: "bounded-ocr-layout-analysis-v6",
        processedPageCount: 1, reviewEligiblePageCount: 1,
        sources: [{ reviewEligiblePageCount: 1, selectionReasonCodes: [] }] });
      const pageRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/ocr-layout/pages/${file.id}/1`, headers: { cookie } });
      expect(pageRead.statusCode, pageRead.body).toBe(200);
      const scaffold = (type: string, lease: Record<string, any>,
        disposition: string, reasonCode: string, providerKind: string) => ({
        schemaVersion: "analysis-stage-result-v1", jobType: type,
        inputManifestHash: lease.inputManifestHash, disposition, reasonCode,
        providerKind, providerProfileId: null, providerConfigHash: null, outputCount: 0,
      });
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
        providerProfileId: visualProposalProfileId,
        providerConfigHash: visualProposalConfigHash, outputCount: 0,
        analysis: { schemaVersion: "visual-proposal-analysis-v4", objectId: entity.objectId,
          inputManifestHash: entity.inputManifestHash, profile: visualProposalProfile,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256, pageCount: 1,
            scannedPageCount: 1, scannedPageNumbers: [1], skippedPageCount: 0,
            documentContext: { schemaVersion: "document-context-v1",
              methodId: "first-two-pdf-cover-text-pages-v1", status: "UNKNOWN",
              reasonCode: "NO_TITLE_KEYWORD_MATCH",
              inspectedPages: [{ pageNumber: 1, textSha256: "c".repeat(64),
                titleWindow: null }] },
            status: "SCANNED", proposals: [], proposalLimitReached: false,
            unretainedProposalCount: 0 }] } };
      expect((await complete("ENTITY_EXTRACTION", entity, visual)).statusCode).toBe(200);
      const rules = await claim("RULE_EVALUATION");
      expect(rules.release.rules.definitions.unresolvedFamilyOcrReview).toEqual(
        release.rules.definitions.unresolvedFamilyOcrReview);
      const fencedOcr = await app.inject({ method: "GET",
        url: `/api/internal/v1/jobs/${await jobId("RULE_EVALUATION")}/ocr-layout-artifact`
          + `?attemptId=${rules.attemptId}&fencingToken=${rules.fencingToken}`,
        headers: { "x-worker-token": workerToken } });
      expect(fencedOcr.statusCode, fencedOcr.body).toBe(200);
      expect(fencedOcr.json()).toMatchObject({ providerProfileId: boundedOcrProfileIdV6,
        providerConfigHash: boundedOcrConfigHashV6 });
      const stageHash = sha256(canonicalJson(stage));
      const textHash = sha256(canonicalJson(textArtifact));
      const line = (page.lines as Array<Record<string, unknown>>)[0];
      const lead = { sourceFileId: file.id, sourceSha256: file.sha256,
        textArtifactSha256: textHash, ocrStageSha256: stageHash,
        ocrPageSha256: page.contentHash, pageNumber: 1, stage: "RD",
        sectionCode: "AR", coordinateSystem: "IMAGE_TOP_LEFT_PIXELS",
        lineIndex: 0, lineText: line.text, score: line.score, bboxPx: line.bboxPx,
        renderSha256: (page.render as Record<string, unknown>).sha256,
        rendererProfileId: (page.render as Record<string, unknown>).rendererProfileId,
        providerProfileId: (page.provider as Record<string, unknown>).profileId,
        providerScript: (page.provider as Record<string, unknown>).script,
        dpi: (page.render as Record<string, unknown>).dpi,
        widthPx: (page.render as Record<string, unknown>).widthPx,
        heightPx: (page.render as Record<string, unknown>).heightPx };
      const sourceStageArtifacts = [{ sourceFileId: file.id, sourceSha256: file.sha256,
        textArtifactSha256: textHash }];
      const reviewBody = { schemaVersion: "unresolved-family-ocr-review-v1",
        profileId: "unresolved-family-ocr-review-v1", purpose: "REVIEW_ONLY",
        objectId: rules.objectId, inputManifestHash: rules.inputManifestHash,
        ocrStageSha256: stageHash, sourceStageArtifacts,
        codeRows: [
          { parameterCode: "AR-042", status: "ABSTAIN",
            reasonCodes: ["LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"],
            leads: [{ ...lead, leadSha256: sha256(workerJson(lead)) }] },
          ...["IOS2-072", "IOS3-075"].map((parameterCode) => ({
            parameterCode, status: "ABSTAIN",
            reasonCodes: ["LEAD_NOT_VERIFIED_FACT", "NO_ELIGIBLE_REVIEWED_SOURCE",
              "NO_EXACT_LINE_LEAD", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"], leads: [],
          })),
        ], findingCount: null, parameterCoverage: null };
      const sidecar = { ...reviewBody, contentHash: sha256(workerJson(reviewBody)) };
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
            reasonCode: "MISSING_PD", evidence: [] } },
        heatLoad: { schemaVersion: "pz-017-analysis-v1", objectId: rules.objectId,
          selectedManifestHash: rules.inputManifestHash, selectedFileIds: [file.id],
          extractionProfile: "pz-017-heat-components-v1", pdFacts: [], rdFacts: [],
          scannedPages: { PD: 0, RD: 1 }, ocrRequiredPageCount: 1,
          comparison: { schemaVersion: "pz-017-component-comparison-v1",
            parameterCode: "PZ-017", disposition: "ABSTAIN",
            reasonCode: "MISSING_COMPONENT_EVIDENCE", totalComparable: false,
            finding: null },
          evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat",
            ruleVersion: "1", parameterCode: "PZ-017", objectId: rules.objectId,
            executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE",
            reasonCode: "MISSING_PD_OR_RD_HEAT_COMPONENT", evidence: [], finding: null } },
        unresolvedFamilyOcrReview: sidecar };
      const verificationClient = await database.connect();
      try {
        const context = await (repository as any).loadVerifiedOcrV6Artifact(
          verificationClient, runRow.id, runRow.object_id);
        expect(context).not.toBeNull();
        expect(verifyUnresolvedFamilyOcrReview({ objectId: rules.objectId,
          inputManifestHash: rules.inputManifestHash, expectedSources: context.sources,
          stage: context.stage, stageHash: context.stageHash, result: sidecar })).toBe(true);
        const pilotSources = await (repository as any).loadPilotCandidateSources(
          verificationClient, runRow.id);
        expect(verifyPilotHeatAnalysis(result.heatLoad, rules.objectId,
          rules.inputManifestHash, pilotSources)).toBe(true);
      } finally { verificationClient.release(); }
      const missing = structuredClone(result);
      delete (missing as Record<string, unknown>).unresolvedFamilyOcrReview;
      expect((await complete("RULE_EVALUATION", rules, missing)).statusCode).toBe(409);
      const forgedLead = structuredClone(result);
      forgedLead.unresolvedFamilyOcrReview.codeRows[0].leads[0].lineText = "подменённая высота коридора";
      const { contentHash: _oldLeadHash, ...forgedLeadBody } = forgedLead.unresolvedFamilyOcrReview;
      forgedLead.unresolvedFamilyOcrReview.contentHash = sha256(workerJson(forgedLeadBody));
      expect((await complete("RULE_EVALUATION", rules, forgedLead)).statusCode).toBe(409);
      expect((await complete("RULE_EVALUATION", rules, result)).statusCode).toBe(200);
      const ruleArtifact = (await database.query<{ id: string; content_json: Record<string, any> }>(
        `SELECT stage.id, stage.content_json FROM analysis_stage_artifacts stage
         WHERE stage.run_id = $1 AND stage.job_type = 'RULE_EVALUATION'`,
        [runRow.id])).rows[0];
      const tamperedRule = structuredClone(ruleArtifact.content_json);
      const tamperedOcrLead = tamperedRule.unresolvedFamilyOcrReview.codeRows[0].leads[0];
      tamperedOcrLead.lineText = "ложная высота коридора";
      const { leadSha256: _oldHash, ...tamperedLeadBody } = tamperedOcrLead;
      tamperedOcrLead.leadSha256 = sha256(workerJson(tamperedLeadBody));
      const { contentHash: _oldSidecarHash, ...tamperedSidecarBody } =
        tamperedRule.unresolvedFamilyOcrReview;
      tamperedRule.unresolvedFamilyOcrReview.contentHash = sha256(workerJson(tamperedSidecarBody));
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
      await replaceRule(tamperedRule);
      const sealClient = await database.connect();
      try {
        await expect((repository as any).sealPilotPz002Run(sealClient,
          { ...runRow, api_id: check!.id })).rejects.toThrow(/OCR review aid/);
      } finally { sealClient.release(); }
      await replaceRule(ruleArtifact.content_json);
      const evidence = await claim("EVIDENCE_VALIDATION");
      expect((await complete("EVIDENCE_VALIDATION", evidence,
        scaffold("EVIDENCE_VALIDATION", evidence, "NO_MACHINE_RESULTS",
          "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"))).statusCode).toBe(200);
      const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
      expect((await complete("ANALYSIS_SEAL_UNSUPPORTED", seal,
        { disposition: "UNSUPPORTED_COVERAGE_SEALED" })).statusCode).toBe(200);
      const pilotRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(pilotRead.statusCode, pilotRead.body).toBe(200);
      expect(pilotRead.json().unresolvedFamilyOcrReview.codeRows.map((row: any) =>
        row.leads.length)).toEqual([1, 0, 0]);
      await replaceRule(tamperedRule);
      const tamperedRead = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/pilot-results`, headers: { cookie } });
      expect(tamperedRead.statusCode).toBe(500);
      await replaceRule(ruleArtifact.content_json);
      const tamper = await database.connect();
      try {
        await tamper.query("BEGIN");
        await tamper.query("SET LOCAL session_replication_role = replica");
        await tamper.query(
          `UPDATE source_review_decisions SET approval_status = 'UNAPPROVED'
           WHERE id = (SELECT decision_id FROM run_source_review_snapshots WHERE run_id = $1)`,
          [runRow.id]);
        await tamper.query("COMMIT");
      } finally { tamper.release(); }
      await expect(repository.getOcrLayout(check!.id, {
        sessionId: randomUUID(), userId: reviewer.id, displayName: "Synthetic reviewer",
        organizationId: reviewer.organizationId, roles: ["INSPECTOR"], capabilities: [],
        csrfHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })).rejects.toThrow(/immutable stage integrity/);
      const transaction = await database.connect();
      try {
      await expect((repository as unknown as { sealUnsupportedRun:
          (client: typeof transaction, run: { id: string; api_id: string;
            inspection_id: string; object_id: string }) => Promise<number> }).sealUnsupportedRun(
              transaction, { ...runRow, api_id: check!.id },
            )).rejects.toThrow(/immutable stage integrity/);
      } finally { transaction.release(); }
      const textRow = (await database.query<{ id: string; content_json: Record<string, any> }>(
        `SELECT text.id, text.content_json FROM analysis_text_artifacts text
         WHERE text.run_id = $1 AND text.schema_version = 'document-text-v2'`,
        [runRow.id])).rows[0];
      textRow.content_json.pages[0].widthMilliPoints = 600_000;
      const textCanonical = canonicalJson(textRow.content_json);
      const secondTamper = await database.connect();
      try {
        await secondTamper.query("BEGIN");
        await secondTamper.query("SET LOCAL session_replication_role = replica");
        await secondTamper.query(
          `UPDATE source_review_decisions SET approval_status = 'APPROVED'
           WHERE id = (SELECT decision_id FROM run_source_review_snapshots WHERE run_id = $1)`,
          [runRow.id]);
        await secondTamper.query(
          `UPDATE analysis_text_artifacts SET content_json = $2::jsonb,
             content_hash = $3, byte_size = $4 WHERE id = $1`,
          [textRow.id, textCanonical, sha256(textCanonical),
            Buffer.byteLength(textCanonical, "utf8")]);
        await secondTamper.query("COMMIT");
      } finally { secondTamper.release(); }
      const reread = await app.inject({ method: "GET",
        url: `/api/checks/${check!.id}/ocr-layout`, headers: { cookie } });
      expect(reread.statusCode).toBe(500);
    } finally {
      for (const key of settings) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      if (app) await app.close();
      else await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes isolated database setup and a complete durable lifecycle.
});

describe("OCR v6 opt-in release isolation", () => {
  it("keeps legacy v5 slot and rejects v6 with OCR heat consumer", () => {
    const legacy = buildPilotPz002Pz017ReleaseManifest(125, "V4", "V5").manifest;
    expect(legacy.providerSlots.find((slot) => slot.stageJobType === "DOCUMENT_OCR_LAYOUT")?.profileId)
      .not.toBe(boundedOcrProfileIdV6);
    const standalone = buildPilotPz002Pz017ReleaseManifest(125, "V4", "V6").manifest;
    expect(standalone.providerSlots.find((slot) => slot.stageJobType === "RULE_EVALUATION")?.profileId)
      .toBe("typed-pz002-pz017-v1");
    expect("unresolvedFamilyOcrReview" in (standalone.rules.definitions ?? {})).toBe(false);
    expect(() => buildPilotPz002Pz017ReleaseManifest(125, "V4", "V6", true))
      .toThrow(/separate release/);
    expect(() => buildPilotPz002Pz017ReleaseManifest(125, "V4", "V5", false,
      false, false, false, false, false, false, false, true))
      .toThrow(/requires OCR v6/);
  });
});
