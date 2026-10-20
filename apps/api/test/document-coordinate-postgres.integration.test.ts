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
(adminUrl ? describe : describe.skip)("printed coordinates authenticated stateless PostgreSQL slice", { timeout: 30_000 }, () => {
  const databaseName = `coordinate_preview_it_${randomUUID().replaceAll("-", "")}`;
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

  it("previews authenticated active-manifest originals without writing machine or registration rows", async () => {
    const file = files[0];
    const path = `/api/objects/${objectId}/files/${file.id}/pages/1/document-coordinate-frame?checkId=${checkId}`;
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);
    const frameRead = await app.inject({ method: "GET", url: path, headers: reader });
    expect(frameRead.statusCode, frameRead.body).toBe(200);
    const frame = frameRead.json();
    expect(frame).toMatchObject({ sourceFileId: file.id, sourceSha256: file.sha256, rotate: 0, visibleWidthPt: 160, visibleHeightPt: 140 });
    const packet = { schemaVersion: "document-coordinate-preview-v1", checkId, sourceFrame: frame,
      target: { label: "Explicit analyst hypothesis", unit: "m", yAxis: "UP", minScale: 90, maxScale: 110, maxHoldoutResidual: .01 },
      points: [[.1,.1], [.8,.1], [.1,.8], [.8,.8]].map(([x,y],i) => ({ id: `P${i}`, page: [x,y], printed: [100*x,100*(1-y)],
        role: i < 3 ? "FIT" : "HOLDOUT", reference: `Original manually associated point ${i}` })), queryPoints: [] };
    const previewPath = `/api/objects/${objectId}/document-coordinates/preview`;
    const snapshot = async () => (await database.query(`SELECT jsonb_build_object(
      'runs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM analysis_runs r),
      'coverage',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM parameter_coverage r),
      'findings',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM findings r),
      'localReviews',(SELECT count(*) FROM local_document_registration_reviews)) AS value`)).rows[0].value;
    const before = await snapshot();
    expect((await app.inject({ method: "POST", url: previewPath, headers: { cookie: reader.cookie }, payload: packet })).statusCode).toBe(403);
    const preview = await app.inject({ method: "POST", url: previewPath, headers: reader, payload: packet });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "PREVIEW_ONLY", coordinateAuthority: "USER_DECLARED_UNVERIFIED",
      absoluteGeoreference: false, physicalPositionValidated: false, calibratedProbability: null, facts: [], result: { status: "CALCULATED" } });
    expect(await snapshot()).toEqual(before);
    expect((await app.inject({ method: "GET", url: path.replace(objectId, otherObjectId), headers: reader })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: path.replace(checkId, "CHK-stale"), headers: reader })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: previewPath, headers: reader, payload: { ...packet, checkId: "CHK-stale" } })).statusCode).toBe(409);
    expect(await snapshot()).toEqual(before);
    const changed = structuredClone(packet); changed.sourceFrame.sourceSha256 = "f".repeat(64);
    const mismatch = await app.inject({ method: "POST", url: previewPath, headers: reader, payload: changed });
    expect(mismatch.statusCode, mismatch.body).toBe(200);
    expect(mismatch.json()).toMatchObject({ result: { status: "ABSTAIN", reasonCode: "PAGE_FRAME_MISMATCH" } });
    expect(await snapshot()).toEqual(before);
  });
  it("requires exact source SHA membership rather than accepting any object file", async () => {
    // Normal append-only ingest after the run: readable file, absent from its immutable manifest.
    const pdf = localRegistrationPdf("after-active-run"); const storageKey = "synthetic/later.pdf";
    bytes.set(storageKey, pdf);
    const file = { id: `FIL-${randomUUID()}`, name: "later.pdf", stage: "PD" as const, mimeType: "application/pdf",
      scanStatus: "CLEAN" as const, status: "STORED" as const, storageKey, size: pdf.length, sha256: sha256(pdf) };
    await repository.registerIngestedFiles(objectId, [file]);
    const response = await app.inject({ method: "GET", headers: reader,
      url: `/api/objects/${objectId}/files/${file.id}/pages/1/document-coordinate-frame?checkId=${checkId}` });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error).toBe("SOURCE_NOT_IN_ACTIVE_MANIFEST");
  });
});
