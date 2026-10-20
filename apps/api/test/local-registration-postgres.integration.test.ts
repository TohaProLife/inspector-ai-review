import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalDocumentFrame, LocalDocumentRegistrationPacket, LocalDocumentRegistrationSaveInput } from "../../../packages/contracts/src/local-document-registration.js";
import { buildApp } from "../src/app.js";
import { sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresIdentityService } from "../src/identity.js";
import { PostgresLocalRegistrationService } from "../src/postgres-local-registration.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { ObjectStorage } from "../src/storage.js";
import { localRegistrationPdf } from "./local-registration-fixture.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("local registration authenticated durable HTTP slice", { timeout: 30_000 }, () => {
  const databaseName = `local_registration_it_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool; let database: Pool; let repository: PostgresInspectionRepository; let app: FastifyInstance;
  let objectId: string; let otherObjectId: string; let checkId: string; let actorId: string;
  let reviewer: Record<string, string>; let reader: Record<string, string>;
  const bytes = new Map<string, Buffer>();
  const files = ["PD", "RD"].map(stage => ({ id: `FIL-${randomUUID()}`, name: `${stage}-synthetic-axes.pdf`,
    stage: stage as "PD" | "RD", mimeType: "application/pdf", scanStatus: "CLEAN" as const, status: "STORED" as const,
    storageKey: `synthetic/${stage}.pdf`, size: 0, sha256: "" }));
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 }); await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`; const connectionString = url.toString();
    await runDatabaseMigrations(connectionString); database = new Pool({ connectionString });
    repository = await PostgresInspectionRepository.create({ connectionString, parameters: (await loadReferenceData()).parameters,
      analysisProfile: "MATRIX_V1", organizationSlug: "local-registration-it" });
    objectId = (await repository.createObject({ name: "Synthetic relative axes", address: "Тестовый стенд" })).id;
    otherObjectId = (await repository.createObject({ name: "Out of scope synthetic object", address: "Тестовый стенд" })).id;
    for (const file of files) {
      const pdf = localRegistrationPdf(file.stage); bytes.set(file.storageKey, pdf); file.size = pdf.length; file.sha256 = sha256(pdf);
    }
    await repository.registerIngestedFiles(objectId, files);
    checkId = (await repository.startCheck(objectId))!.id;
    const password = "Local-Registration-2026!";
    const createUser = (name: string, permissions: string[]) => provisionLocalUser(database, {
      organizationSlug: "local-registration-it", login: `${name}-${randomUUID()}`, displayName: name, password,
      role: "INSPECTOR", capabilities: permissions.includes("REVIEW_DECIDE") ? ["REVIEW_DECIDE"] : [],
      objectApiIds: [objectId], objectPermissions: permissions as Array<"READ" | "REVIEW_DECIDE"> });
    const user = await createUser("reviewer", ["READ", "REVIEW_DECIDE"]); actorId = user.id;
    const readUser = await createUser("reader", ["READ"]);
    const storage: ObjectStorage = { putFile: async () => { throw Error("fixture storage read only"); }, getFile: async key => {
      const value = bytes.get(key); if (!value) throw Error("missing fixture");
      return { body: Readable.from([value]), size: value.length, contentType: "application/pdf" };
    } };
    app = await buildApp({ repository, storage, identityService: PostgresIdentityService.create({ connectionString,
      organizationSlug: "local-registration-it" }), localRegistrationService: new PostgresLocalRegistrationService(connectionString) });
    async function login(login: string) {
      const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login, password } });
      expect(response.statusCode, response.body).toBe(200);
      const setCookie = response.headers["set-cookie"] as string[];
      const cookie = setCookie.map(value => value.split(";", 1)[0]).join("; ");
      const csrf = decodeURIComponent(setCookie.find(value => value.startsWith("inspector_csrf="))!.split(";", 1)[0].slice("inspector_csrf=".length));
      return { cookie, "x-csrf-token": csrf };
    }
    reviewer = await login(user.login); reader = await login(readUser.login);
  });
  afterAll(async () => {
    if (app) await app.close(); else await repository?.close();
    await database?.end();
    if (admin) { await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", [databaseName]);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`); await admin.end(); }
  });

  it("previews real stored PDF bytes, appends reviewed registration, reloads and rejects stale/unauthorized mutations", async () => {
    const path = `/api/objects/${objectId}/local-registrations`;
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/objects/${otherObjectId}/local-registrations`, headers: reviewer })).statusCode).toBe(404);
    const read = await app.inject({ method: "GET", url: path, headers: reviewer });
    expect(read.json()).toMatchObject({ checkId, latest: null, expectedReviewHash: null, canReview: true });
    const frames: LocalDocumentFrame[] = [];
    for (const file of files) {
      const response = await app.inject({ method: "GET", headers: reviewer,
        url: `/api/objects/${objectId}/files/${file.id}/pages/1/local-registration-frame?floorKey=1&phaseKey=A` });
      expect(response.statusCode, response.body).toBe(200); frames.push(response.json());
      expect(response.json()).toMatchObject({ sourceSha256: file.sha256, visibleWidthPt: 160, visibleHeightPt: 140 });
      const rendered = await app.inject({ method: "GET", headers: reviewer,
        url: `/api/objects/${objectId}/files/${file.id}/pages/1/preview` });
      expect(rendered.statusCode, rendered.body.slice(0, 200)).toBe(200);
      expect(rendered.headers["content-type"]).toContain("image/png");
    }
    const packet: LocalDocumentRegistrationPacket = {
      schemaVersion: "local-document-registration-v1", sourceFrame: frames[0], targetFrame: frames[1], method: "SIMILARITY",
      basis: { kind: "DOCUMENT_AXES", evidenceRefs: ["synthetic originals: axes 1/A, 2/A, 1/B; held-out 2/B"] },
      anchors: [[0.1, 0.1], [0.8, 0.1], [0.1, 0.8], [0.8, 0.8]].map(([x, y], i) => ({
        id: `axis-${i}`, source: [x, y], target: [x, y], role: i < 3 ? "FIT" : "HOLDOUT", referenceKind: "DOCUMENT_AXIS",
        sourceLocator: `PD:1:synthetic-axis-${i}`, targetLocator: `RD:1:synthetic-axis-${i}` })),
      minScale: 0.9, maxScale: 1.1, maxAnisotropy: 1.01, maxResidualTargetPoints: 0.1,
      sourceLocalizationUncertaintyPt: 0.5, targetLocalizationUncertaintyPt: 0.5, targetScale: null,
    };
    const previewInput = { checkId, packet };
    expect((await app.inject({ method: "POST", url: `${path}/preview`, headers: { cookie: reviewer.cookie }, payload: previewInput })).statusCode).toBe(403);
    const preview = await app.inject({ method: "POST", url: `${path}/preview`, headers: reader, payload: previewInput });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "PREVIEW_ONLY", result: { status: "REGISTERED_RELATIVE", absoluteGeoreference: false } });
    expect((await database.query("SELECT count(*)::int n FROM local_document_registration_reviews")).rows[0].n).toBe(0);
    const before = await database.query("SELECT (SELECT count(*) FROM findings)::int findings, (SELECT count(*) FROM parameter_coverage)::int coverage");
    const input: LocalDocumentRegistrationSaveInput = { schemaVersion: "local-document-registration-review-command-v1", checkId,
      packet, expectedReviewHash: null, originalsReviewed: true, stableReferencesConfirmed: true, scopeConfirmed: true,
      reason: "Synthetic original axes and held-out control reviewed" };
    const key = `local-review-${randomUUID()}`;
    expect((await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reader, "idempotency-key": key }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `${path}/reviews`, headers: reviewer, payload: input })).statusCode).toBe(428);
    const saved = await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": key }, payload: input });
    expect(saved.statusCode, saved.body).toBe(201); const receipt = saved.json();
    expect(receipt).toMatchObject({ objectId, checkId, actorId, packet, previousReviewHash: null,
      registrationSha256: preview.json().result.registrationSha256 });
    const replay = await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": key }, payload: input });
    expect(replay.statusCode, replay.body).toBe(201); expect(replay.json()).toEqual(receipt);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": key },
      payload: { ...input, reason: "different decision" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": randomUUID() }, payload: input })).statusCode).toBe(412);
    const latest = (await app.inject({ method: "GET", url: path, headers: reviewer })).json();
    expect(latest).toMatchObject({ expectedReviewHash: receipt.contentHash, latest: receipt, history: [{ reviewId: receipt.reviewId }] });
    expect((await database.query("SELECT count(*)::int n FROM local_document_registration_reviews")).rows[0].n).toBe(1);
    expect((await database.query("SELECT actor_user_id FROM audit_events WHERE action='LOCAL_DOCUMENT_REGISTRATION_REVIEW'")).rows).toEqual([{ actor_user_id: actorId }]);
    const after = await database.query("SELECT (SELECT count(*) FROM findings)::int findings, (SELECT count(*) FROM parameter_coverage)::int coverage");
    expect(after.rows).toEqual(before.rows);
    await expect(database.query("UPDATE local_document_registration_reviews SET reason='tampered'")).rejects.toThrow();
    const tampered = structuredClone(packet); tampered.sourceFrame.pageFrameSha256 = "f".repeat(64);
    const denied = await app.inject({ method: "POST", url: `${path}/preview`, headers: reviewer, payload: { checkId, packet: tampered } });
    expect(denied.json()).toMatchObject({ status: "PREVIEW_ONLY", result: { status: "ABSTAIN", reasonCode: "PAGE_FRAME_MISMATCH" } });
    const oldBytes = bytes.get(files[0].storageKey)!; bytes.set(files[0].storageKey, localRegistrationPdf("corrupt"));
    expect((await app.inject({ method: "POST", url: `${path}/preview`, headers: reviewer, payload: previewInput })).statusCode).toBe(503);
    bytes.set(files[0].storageKey, oldBytes);
    expect((await app.inject({ method: "POST", url: `${path}/preview`, headers: reviewer,
      payload: { ...previewInput, checkId: "old-run" } })).statusCode).toBe(409);
    await database.query("UPDATE inspections SET lifecycle='FINALIZED' WHERE object_id=(SELECT id FROM objects WHERE api_id=$1)", [objectId]);
    expect((await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": randomUUID() },
      payload: { ...input, expectedReviewHash: receipt.contentHash } })).statusCode).toBe(409);
    const finalReplay = await app.inject({ method: "POST", url: `${path}/reviews`, headers: { ...reviewer, "idempotency-key": key }, payload: input });
    expect(finalReplay.statusCode, finalReplay.body).toBe(201); expect(finalReplay.json()).toEqual(receipt);
  });
});
