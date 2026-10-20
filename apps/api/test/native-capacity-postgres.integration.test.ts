/** Opt-in real PG + production HTTP + fresh Python native extraction of authored PDFs. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NativeCapacityRecord, NativeCapacityWorkspace } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { nativeCapacityWorkspace } from "../src/postgres-native-capacity.js";
import { LocalObjectStorage } from "../src/storage.js";
// Browser harness exports a JS-only disposable fixture, with no main() side effects on import.
// @ts-expect-error The opt-in .mjs QA harness has no declaration file.
import { seedNativeCapacityFixture } from "../../../scripts/smoke-native-capacity-app.mjs";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("NativeCapacity real PG/authenticated HTTP source-only capture", { timeout: 180000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedNativeCapacityFixture>>, record: NativeCapacityRecord;
  let initialDomain: unknown;
  const key = randomUUID();
  const input = () => ({ schemaVersion: "native-capacity-command-v1", pdSourceFileId: fixture.files[0].id, rdSourceFileId: fixture.files[1].id });
  const route = () => `/api/checks/${fixture.checkId}/native-capacity-comparisons`;
  const post = (payload = input(), idempotency = key, headers = fixture.headers) => fixture.app.inject({ method: "POST", url: route(),
    headers: { ...headers, "idempotency-key": idempotency }, payload });
  async function count() { return (await fixture.db.query("SELECT count(*)::int n FROM native_capacity_comparisons")).rows[0].n; }
  async function domain() {
    const rows = await fixture.db.query(`SELECT
      (SELECT count(*)::int FROM rule_results) AS rule_results,
      (SELECT count(*)::int FROM source_review_decisions) AS source_reviews,
      (SELECT count(*)::int FROM inspection_protocol_versions) AS protocols`);
    return { rows: rows.rows, coverage: await fixture.repo.getCoverage(fixture.checkId, fixture.actor) };
  }
  beforeAll(async () => { fixture = await seedNativeCapacityFixture(adminUrl, { seal: false }); });
  afterAll(async () => { await fixture?.close(); });

  it("authenticates before existence, requires CSRF/key/strict input, refuses unsealed V4 without mutation", async () => {
    for (const path of [route(), "/api/checks/FOREIGN/native-capacity-comparisons"]) {
      expect((await fixture.app.inject(path)).statusCode).toBe(401);
      expect((await fixture.app.inject({ method: "POST", url: path, payload: input() })).statusCode).toBe(401);
    }
    expect((await post(input(), key, { cookie: fixture.headers.cookie })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: "POST", url: route(), headers: fixture.headers, payload: input() })).statusCode).toBe(428);
    for (const payload of [{ ...input(), schemaVersion: "unknown" }, { ...input(), findingId: "forged" }, { ...input(), pdSourceFileId: "" }])
      expect((await post(payload)).statusCode).toBe(400);
    const workspace = await fixture.app.inject({ url: route(), headers: fixture.headers });
    expect(workspace.statusCode, workspace.body).toBe(200);
    expect(workspace.json()).toMatchObject({ availability: "SEALED_SOURCE_AUDIT_V4_REQUIRED", canCompare: false, items: [] });
    const refused = await post(); expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toBe("NATIVE_CAPACITY_SOURCE_AUDIT_REQUIRED"); expect(await count()).toBe(0);
  });

  it("seals actual V4 extraction and captures all four native quotes with independent 600 expectations", async () => {
    await fixture.finish(); initialDomain = await domain();
    expect(fixture.results.sources).toHaveLength(2);
    expect(await count()).toBe(0);
    const [response, concurrent] = await Promise.all([post(), post(input(), randomUUID())]);
    expect(response.statusCode, response.body).toBe(201); expect(concurrent.statusCode, concurrent.body).toBe(201);
    expect([response.headers["idempotency-replayed"], concurrent.headers["idempotency-replayed"]].sort()).toEqual(["false", "true"]);
    record = response.json<NativeCapacityRecord>(); expect(concurrent.json()).toEqual(record);
    expect(response.headers["x-content-sha256"]).toBe(record.contentHash);
    expect(record).toMatchObject({ schemaVersion: "native-capacity-record-v1", objectId: fixture.objectId, checkId: fixture.checkId,
      input: input(), createdBy: fixture.actor.userId, comparison: { status: "COMPARED", comparison: "EQUAL", pdValue: "600", rdValue: "600",
        deltaRdMinusPd: "0", p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false } });
    if (record.comparison.status !== "COMPARED") throw Error(record.comparison.reasonCode);
    for (const [index, role] of [[0, "PD"], [1, "RD"]] as const) {
      expect(record.comparison.quotes[role]).toHaveLength(2);
      expect(record.comparison.quotes[role].map(quote => quote.physicalPage)).toEqual([1, 3]);
      for (const quote of record.comparison.quotes[role]) {
        expect(quote.rawText).toContain("Школа на 600 мест"); expect(quote.sourceSha256).toBe(fixture.files[index].sha256);
        expect(quote.bboxMilliPoints[2]).toBeGreaterThan(quote.bboxMilliPoints[0]);
        expect(quote.evidenceKind).toBe("NATIVE");
      }
    }
    const { contentHash, ...body } = record; expect(sha256(canonicalJson(body))).toBe(contentHash);
    expect(await count()).toBe(1); expect(await domain()).toEqual(initialDomain);
    const stored = (await fixture.db.query("SELECT content_text,content_hash FROM native_capacity_comparisons")).rows[0];
    expect(stored.content_text).toBe(canonicalJson(body)); expect(stored.content_hash.trim()).toBe(contentHash);
  });

  it("replays same key, refuses changed input and converges eight parallel captures on persisted identity", async () => {
    const replay = await post(); expect(replay.statusCode).toBe(201); expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(record);
    const conflict = await post({ ...input(), rdSourceFileId: fixture.files[2].id }); expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("IDEMPOTENCY_CONFLICT");
    const parallel = await Promise.all(Array.from({ length: 8 }, () => post(input(), randomUUID())));
    for (const response of parallel) { expect(response.statusCode, response.body).toBe(201); expect(response.json()).toEqual(record); }
    expect(await count()).toBe(1); expect(await domain()).toEqual(initialDomain);
    expect((await fixture.db.query("SELECT count(*)::int n FROM audit_events WHERE action='NATIVE_CAPACITY_SOURCE_COMPARE'")).rows[0].n).toBe(1);
    const listed = await fixture.app.inject({ url: route(), headers: fixture.headers });
    expect(listed.json()).toMatchObject({ canCompare: true, availability: "READY", items: [record] });
  });

  it("refuses foreign user/org/missing source and same source; revoked READ blocks both methods", async () => {
    const foreign = { cookie: `inspector_session=${fixture.foreignToken}; inspector_csrf=native-qa-csrf`, "x-csrf-token": "native-qa-csrf" };
    expect((await fixture.app.inject({ url: route(), headers: foreign })).statusCode).toBe(404);
    expect((await post(input(), randomUUID(), foreign)).statusCode).toBe(404);
    const wrongOrg = { ...fixture.actor, organizationId: randomUUID() };
    expect(await fixture.repo.getNativeCapacityComparisons(fixture.checkId, wrongOrg)).toBeUndefined();
    for (const source of [fixture.files[2].id, "FIL-MISSING"]) {
      const response = await post({ ...input(), rdSourceFileId: source }, randomUUID()); expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error).toBe("NATIVE_CAPACITY_ARTIFACT_UNAVAILABLE");
    }
    const identical = await post({ ...input(), rdSourceFileId: fixture.files[0].id }, randomUUID());
    expect(identical.statusCode).toBe(422); expect(identical.json().error).toBe("NATIVE_CAPACITY_IDENTICAL_SOURCE");
    await fixture.db.query("UPDATE object_memberships SET revoked_at=now() WHERE user_id=$1", [fixture.actor.userId]);
    try {
      expect((await fixture.app.inject({ url: route(), headers: fixture.headers })).statusCode).toBe(404);
      expect((await post(input(), randomUUID())).statusCode).toBe(404);
    } finally { await fixture.db.query("UPDATE object_memberships SET revoked_at=NULL WHERE user_id=$1", [fixture.actor.userId]); }
    expect(await count()).toBe(1); expect(await domain()).toEqual(initialDomain);
  });

  it("enforces append-only DB rows and validates nested comparison integrity on stored read", async () => {
    await expect(fixture.db.query("UPDATE native_capacity_comparisons SET policy_version=policy_version WHERE id=$1", [record.id])).rejects.toMatchObject({ code: "55000" });
    await expect(fixture.db.query("DELETE FROM native_capacity_comparisons WHERE id=$1", [record.id])).rejects.toMatchObject({ code: "55000" });
    const client = await fixture.db.connect();
    try {
      await client.query("BEGIN"); await client.query("ALTER TABLE native_capacity_comparisons DISABLE TRIGGER native_capacity_comparisons_immutable");
      const body = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
      delete body.contentHash;
      const comparison = body.comparison as Record<string, unknown>;
      if (comparison.status !== "COMPARED") throw Error("Compared fixture required");
      comparison.pdValue = "601"; const json = canonicalJson(body);
      await client.query("UPDATE native_capacity_comparisons SET content_text=$2::text,content_json=($2::text)::jsonb,content_hash=$3 WHERE id=$1", [record.id, json, sha256(json)]);
      await expect(nativeCapacityWorkspace(client, fixture.checkId, fixture.actor)).rejects.toMatchObject({ code: "NATIVE_CAPACITY_IDENTITY_MISMATCH" });
    } finally { await client.query("ROLLBACK"); client.release(); }
    expect((await fixture.app.inject({ url: route(), headers: fixture.headers })).json().items).toEqual([record]);
  });

  it("rejects missing/null protected JSON fields and substituted native artifact hashes at DB insertion", async () => {
    const client = await fixture.db.connect();
    try {
      await client.query("BEGIN");
      for (const mutation of ["missing-p", "null-factEligible", "missing-comparison", "missing-schema", "wrong-artifact-hash"]) {
        const body = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
        delete body.contentHash; body.id = randomUUID();
        const comparison = body.comparison as Record<string, unknown>;
        if (mutation === "missing-p") delete comparison.p;
        if (mutation === "null-factEligible") comparison.factEligible = null;
        if (mutation === "missing-comparison") delete body.comparison;
        if (mutation === "missing-schema") delete body.schemaVersion;
        if (mutation === "wrong-artifact-hash") (body.bindings as Record<string, unknown>).pdTextArtifactHash = "0".repeat(64);
        const json = canonicalJson(body);
        await client.query("SAVEPOINT protected_json");
        await expect(client.query(`INSERT INTO native_capacity_comparisons(id,organization_id,object_id,run_id,pd_source_file_id,rd_source_file_id,
          policy_version,content_hash,content_text,content_json,actor_user_id,created_at)
          SELECT $1::uuid,organization_id,object_id,run_id,pd_source_file_id,rd_source_file_id,policy_version,
          $2,$3::text,($3::text)::jsonb,actor_user_id,created_at FROM native_capacity_comparisons WHERE id=$4`,
          [body.id, sha256(json), json, record.id]), mutation).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT protected_json");
      }
    } finally { await client.query("ROLLBACK"); client.release(); }
    expect(await count()).toBe(1);
  });

  it("reconnects and preserves historical immutable record after a newer old-profile run", async () => {
    const reopened = await PostgresInspectionRepository.create({ connectionString: fixture.connectionString, parameters: fixture.parameters,
      analysisProfile: "MATRIX_V1", organizationSlug: fixture.organizationSlug, storage: new LocalObjectStorage(fixture.directory) });
    try {
      const workspace = await reopened.getNativeCapacityComparisons(fixture.checkId, fixture.actor) as NativeCapacityWorkspace;
      expect(workspace.items).toEqual([record]);
    } finally { await reopened.close(); }
    const newer = await fixture.repo.startCheckCommand(fixture.objectId, { actor: fixture.actor, idempotencyKey: randomUUID(),
      requestId: randomUUID(), traceId: randomUUID() }, { sourceAuditV3: true });
    expect(newer.kind).toBe("success"); if (newer.kind !== "success") throw Error("New old-profile audit required");
    const oldProfile = await fixture.app.inject({ method: "POST", url: `/api/checks/${newer.value.id}/native-capacity-comparisons`,
      headers: { ...fixture.headers, "idempotency-key": randomUUID() }, payload: input() });
    expect(oldProfile.statusCode, oldProfile.body).toBe(409);
    expect((await fixture.app.inject({ url: route(), headers: fixture.headers })).json().items).toEqual([record]);
    expect(await count()).toBe(1); expect(await domain()).toEqual(initialDomain);
  });
});
