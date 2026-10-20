import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor } from "../src/identity.js";
import type { ProtocolRenderedArtifactContent } from "../src/repository.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("rendered protocol immutable scoped PostgreSQL cache", { timeout: 30000 }, () => {
  const databaseName = `protocol_render_${randomUUID().replaceAll("-", "")}`;
  const organizationSlug = `render-${randomUUID()}`;
  let admin: Pool, db: Pool, repo: PostgresInspectionRepository, connectionString: string;
  let actor: AuthenticatedActor, foreignUser: AuthenticatedActor;
  let content: ProtocolRenderedArtifactContent, foreign: ProtocolRenderedArtifactContent;
  let missingCanonical: ProtocolRenderedArtifactContent, corruptCanonical: ProtocolRenderedArtifactContent;

  async function createProtocol(objectId: string, canonical: "valid" | "missing" | "corrupt" = "valid") {
    const source = Buffer.from("source registration metadata only; not a document-render test");
    await repo.registerIngestedFiles(objectId, [{ id: `FIL-${randomUUID()}`, name: "synthetic-source.pdf", stage: "PD", size: source.length,
      mimeType: "application/pdf", sha256: sha256(source), scanStatus: "CLEAN", status: "STORED", storageKey: "unused-fixture" }]);
    const check = await repo.startCheck(objectId);
    if (!check) throw Error("Fixture run not created");
    const run = (await db.query("SELECT id,inspection_id FROM analysis_runs WHERE api_id=$1", [check.id])).rows[0];
    const protocolId = `PRT-${randomUUID()}`;
    // Hand-authored saved DRAFT; no renderer or mutable finding lookup constructs this expectation.
    const snapshot = { schemaVersion: "1.0", protocol: { id: protocolId, checkId: check.id, version: 1,
      status: "DRAFT", createdAt: "2026-10-20T00:00:00.000Z", createdBy: "Frozen fixture", stats: {
        total: 0, unsupported: 0, candidates: 0, confirmed: 0, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0,
      } }, findings: [] };
    const bytes = Buffer.from(canonicalJson(snapshot));
    const hash = sha256(bytes);
    const row = (await db.query(`INSERT INTO inspection_protocol_versions
      (api_id,inspection_id,run_id,version,kind,snapshot_json,snapshot_hash,decision_set_hash,created_by)
      VALUES ($1,$2,$3,1,'DRAFT',$4,$5,$6,'Frozen fixture') RETURNING id`,
    [protocolId, run.inspection_id, run.id, JSON.stringify(snapshot), hash, "0".repeat(64)])).rows[0];
    if (canonical !== "missing") {
      const storedBytes = canonical === "corrupt" ? Buffer.from("corrupted historical JSON bytes") : bytes;
      await db.query(`INSERT INTO protocol_artifacts (api_id,protocol_id,format,media_type,canonicalization_version,byte_size,content_hash,content_bytes)
        VALUES ($1,$2,'JSON','application/json','inspector-c14n-v1',$3,$4,$5)`,
      [`ART-${randomUUID()}`, row.id, storedBytes.length, hash, storedBytes]);
    }
    const rendered = Buffer.from("%PDF-1.4\nhand-authored cache bytes\n");
    return { protocolId, format: "pdf" as const, templateVersion: "protocol-report-v1", snapshotHash: hash,
      bytes: rendered, contentHash: sha256(rendered), mediaType: "application/pdf" };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`; connectionString = url.toString();
    const migrations = await runDatabaseMigrations(connectionString);
    expect(migrations.applied).toContain("047_protocol_rendered_artifacts.sql");
    db = new Pool({ connectionString, max: 4 });
    repo = await PostgresInspectionRepository.create({ connectionString, parameters: [], organizationSlug });
    const org = (await db.query("SELECT id FROM organizations WHERE slug=$1", [organizationSlug])).rows[0].id;
    async function user() {
      const id = (await db.query("INSERT INTO inspector_users(login,provider_subject,display_name) VALUES($1,$2,'Read-only fixture') RETURNING id",
        [`reader-${randomUUID()}`, randomUUID()])).rows[0].id;
      return { sessionId: randomUUID(), userId: id, displayName: "Reader", organizationId: org,
        roles: ["INSPECTOR"], capabilities: [], csrfHash: "unused", expiresAt: "2030-01-01T00:00:00Z" };
    }
    actor = await user(); foreignUser = await user();
    async function object(read: boolean) {
      const item = await repo.createObject({ name: "Synthetic protocol storage", address: "Disposable fixture" });
      if (read) await db.query("INSERT INTO object_memberships(object_id,user_id,permission_set) SELECT id,$2,ARRAY['READ']::text[] FROM objects WHERE api_id=$1", [item.id, actor.userId]);
      return item.id;
    }
    content = await createProtocol(await object(true)); foreign = await createProtocol(await object(false));
    missingCanonical = await createProtocol(await object(true), "missing");
    corruptCanonical = await createProtocol(await object(true), "corrupt");
  });

  afterAll(async () => {
    await repo?.close(); await db?.end();
    if (admin) {
      try { await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`); } finally { await admin.end(); }
    }
  });

  it("requires actor/object READ and exact intact canonical source before read or insert", async () => {
    expect(await repo.getRenderedProtocolArtifact(content)).toBe("AUTH_REQUIRED");
    expect(await repo.saveRenderedProtocolArtifact(content)).toBe("AUTH_REQUIRED");
    for (const [item, reader] of [
      [content, foreignUser], [content, { ...actor, organizationId: randomUUID() }], [foreign, actor],
      [missingCanonical, actor], [corruptCanonical, actor], [{ ...content, snapshotHash: "0".repeat(64) }, actor],
      [{ ...content, protocolId: "missing" }, actor],
    ] as const) {
      expect(await repo.getRenderedProtocolArtifact(item, reader)).toBeUndefined();
      expect(await repo.saveRenderedProtocolArtifact(item, reader)).toBeUndefined();
    }
    expect((await db.query("SELECT count(*)::int n FROM protocol_rendered_artifacts")).rows[0].n).toBe(0);
  });

  it("rejects invalid bytes/MIME/hash/bounds without inserting", async () => {
    const oversized = Buffer.alloc(16777217);
    for (const mutation of [
      { bytes: Buffer.alloc(0), contentHash: sha256(Buffer.alloc(0)) }, { bytes: oversized, contentHash: sha256(oversized) },
      { contentHash: "0".repeat(64) }, { mediaType: "text/html" }, { templateVersion: "../bad" }, { format: "html" },
    ]) expect(await repo.saveRenderedProtocolArtifact({ ...content, ...mutation } as ProtocolRenderedArtifactContent, actor)).toBeUndefined();
    expect((await db.query("SELECT count(*)::int n FROM protocol_rendered_artifacts")).rows[0].n).toBe(0);
  });

  it("parallel differing renders return one persisted winner; revision and format stay independent", async () => {
    const other = Buffer.from("%PDF-1.4\ndifferent concurrent renderer bytes\n");
    const contender = { ...content, bytes: other, contentHash: sha256(other) };
    const saved = await Promise.all(Array.from({ length: 12 }, (_, index) => repo.saveRenderedProtocolArtifact(index % 2 ? content : contender, actor)));
    expect(saved[0]).toBeTruthy(); expect(saved.every(item => item && item !== "AUTH_REQUIRED" && item.contentHash === (saved[0] as ProtocolRenderedArtifactContent).contentHash)).toBe(true);
    expect([content.contentHash, contender.contentHash]).toContain((saved[0] as ProtocolRenderedArtifactContent).contentHash);
    expect((await db.query("SELECT count(*)::int n FROM protocol_rendered_artifacts")).rows[0].n).toBe(1);
    expect(await repo.getRenderedProtocolArtifact(content, actor)).toEqual(saved[0]);
    const revision = { ...content, templateVersion: "protocol-report-v2" };
    expect(await repo.saveRenderedProtocolArtifact(revision, actor)).toEqual(revision);
    const xml = { ...content, format: "xml" as const, mediaType: "application/xml", bytes: Buffer.from("<report/>") };
    xml.contentHash = sha256(xml.bytes);
    expect(await repo.saveRenderedProtocolArtifact(xml, actor)).toEqual(xml);
    if (!saved[0] || saved[0] === "AUTH_REQUIRED") throw Error("Missing winner");
    const expected = Buffer.from(saved[0].bytes); saved[0].bytes.fill(0);
    await repo.close(); repo = await PostgresInspectionRepository.create({ connectionString, parameters: [], organizationSlug });
    const afterReconnect = await repo.getRenderedProtocolArtifact(content, actor);
    expect(afterReconnect && afterReconnect !== "AUTH_REQUIRED" ? afterReconnect.bytes : undefined).toEqual(expected);
  });

  it("database rejects mutation, forged source and wrong output digest", async () => {
    await expect(db.query("UPDATE protocol_rendered_artifacts SET media_type=media_type")).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("DELETE FROM protocol_rendered_artifacts")).rejects.toMatchObject({ code: "55000" });
    await expect(db.query(`INSERT INTO protocol_rendered_artifacts
      (protocol_id,source_artifact_id,format,template_version,snapshot_hash,media_type,byte_size,content_hash,content_bytes)
      SELECT rendered.protocol_id, artifact.id, 'xml', 'forged-source', rendered.snapshot_hash, 'application/xml', 1, $1, $2
      FROM protocol_rendered_artifacts rendered JOIN protocol_artifacts artifact ON artifact.protocol_id <> rendered.protocol_id LIMIT 1`,
    [sha256(Buffer.from("x")), Buffer.from("x")])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`INSERT INTO protocol_rendered_artifacts
      (protocol_id,source_artifact_id,format,template_version,snapshot_hash,media_type,byte_size,content_hash,content_bytes)
      SELECT protocol_id,source_artifact_id,'xml','bad-output',snapshot_hash,'application/xml',1,$1,$2 FROM protocol_rendered_artifacts LIMIT 1`,
    ["0".repeat(64), Buffer.from("x")])).rejects.toMatchObject({ code: "23514" });
    const rollback = await readFile(new URL("../../../migrations/rollback/047_protocol_rendered_artifacts.sql", import.meta.url), "utf8");
    await expect(db.query(rollback)).rejects.toThrow("Refusing rollback of populated protocol rendered artifacts");
  });

  it("revoked READ refuses saved bytes and cache writes without deleting historical artifacts", async () => {
    await db.query("UPDATE object_memberships SET revoked_at=now() WHERE user_id=$1", [actor.userId]);
    expect(await repo.getRenderedProtocolArtifact(content, actor)).toBeUndefined();
    expect(await repo.saveRenderedProtocolArtifact(content, actor)).toBeUndefined();
    expect((await db.query("SELECT count(*)::int n FROM protocol_rendered_artifacts")).rows[0].n).toBe(3);
  });
});
