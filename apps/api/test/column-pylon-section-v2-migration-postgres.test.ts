/** KR-060 migration isolation only; small SQL fixtures do not establish engineering applicability. */
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHistoricalMigrationRunner } from "./historical-migration-runner.js";

const root = new URL("../../../", import.meta.url);
const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const migration = "044_matrix_column_pylon_section_v2_reviews.sql";
const forward = readFileSync(new URL(`migrations/${migration}`, root), "utf8");
const rollback = readFileSync(new URL(`migrations/rollback/${migration}`, root), "utf8");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const historical = readdirSync(new URL("migrations/", root)).filter(name => /^\d{3}_.+\.sql$/.test(name)
  && name < migration).sort();
expect(historical).toHaveLength(43);

(adminUrl ? describe : describe.skip)("KR060 v2 additive append-only SQL", { timeout: 90_000 }, () => {
  const name = `root_kr060_v2_sql_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, url: string;
  let organization: string, object: string, actor: string;
  let expectedSource: string, actualSource: string, expectedReview: string, actualReview: string;
  let oldRows: unknown, oldLedger: unknown;
  let historicalRunner: Awaited<ReturnType<typeof createHistoricalMigrationRunner>>;

  async function reject(client: PoolClient, operation: () => Promise<unknown>, code: string) {
    await client.query("SAVEPOINT rejected_operation");
    let error: unknown;
    try { await operation(); } catch (value) { error = value; }
    await client.query("ROLLBACK TO SAVEPOINT rejected_operation");
    await client.query("RELEASE SAVEPOINT rejected_operation");
    expect(error).toMatchObject({ code });
  }
  async function transaction(body: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect();
    await client.query("BEGIN");
    try { await body(client); } finally { await client.query("ROLLBACK"); client.release(); }
  }
  async function source() {
    const id = randomUUID(), blob = randomUUID(), review = randomUUID(), sha = digest(id);
    await pool.query("INSERT INTO blobs(id,object_id,sha256,byte_size,storage_key,media_type,scan_status) VALUES($1,$2,$3,5,$4,'application/pdf','CLEAN')", [blob,object,sha,blob]);
    await pool.query("INSERT INTO source_files(id,api_id,object_id,blob_id,canonical_name,original_format) VALUES($1,$2,$3,$4,'SQL-only.pdf','pdf')", [id,id,object,blob]);
    await pool.query("INSERT INTO source_review_decisions(id,object_id,source_file_id,source_sha256,revision_status,approval_status,basis_reference,actor_id,content_hash) VALUES($1,$2,$3,$4,'UNKNOWN','UNKNOWN','SQL-only synthetic parent',$5,$6)", [review,object,id,sha,actor,digest(review)]);
    return { id, review };
  }
  function insert(client: PoolClient, options: {
    id?: string; pair?: string; previous?: string | null; previousHash?: string | null;
    hash?: string; status?: string; body?: unknown; objectId?: string;
  } = {}) {
    const id = options.id ?? randomUUID();
    return client.query(`INSERT INTO matrix_column_pylon_section_v2_decisions(
      id,object_id,pair_key,expected_source_file_id,actual_source_file_id,
      expected_review_decision_id,actual_review_decision_id,previous_decision_id,
      previous_review_hash,projection_json,actor_id,content_hash,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'2026-10-18T12:00:00.000Z') RETURNING sequence_no`,
    [id,options.objectId ?? object,options.pair ?? "a".repeat(64),expectedSource,actualSource,
      expectedReview,actualReview,options.previous ?? null,options.previousHash ?? null,
      JSON.stringify(options.body ?? { schemaVersion: "matrix-kr060-column-pylon-pair-projection-v2", status: options.status ?? "UNKNOWN" }),
      actor,options.hash ?? digest(id)]);
  }
  beforeAll(async () => {
    historicalRunner = await createHistoricalMigrationRunner(migration);
    expect(historicalRunner.migrationNames).toEqual([...historical, migration]);
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000, query_timeout: 30000 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(adminUrl!); target.pathname = `/${name}`; url = target.toString();
    pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 20000 });
    await pool.query("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    for (const file of historical) {
      const sql = readFileSync(new URL(`migrations/${file}`, root), "utf8");
      await pool.query("BEGIN");
      try { await pool.query(sql); await pool.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [file,digest(sql)]); await pool.query("COMMIT"); }
      catch (error) { await pool.query("ROLLBACK"); throw error; }
    }
    organization = randomUUID(); object = randomUUID(); actor = randomUUID();
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'SQL test')", [organization,organization]);
    await pool.query("INSERT INTO objects(id,organization_id,api_id,name,address,display_status,stats) VALUES($1,$2,$3,'SQL test','Disposable','DRAFT','{}')", [object,organization,object]);
    await pool.query("INSERT INTO inspector_users(id,login,provider_subject,display_name) VALUES($1,$2,$3,'SQL actor')", [actor,`${actor}@example.test`,actor]);
    const first = await source(), second = await source();
    expectedSource = first.id; expectedReview = first.review; actualSource = second.id; actualReview = second.review;
    oldLedger = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    oldRows = (await pool.query("SELECT id,xmin::text,ctid::text,to_jsonb(source) AS body FROM source_review_decisions source ORDER BY id")).rows;
    const summary = await historicalRunner.runDatabaseMigrations(url);
    expect(summary.applied).toEqual([migration]); expect(summary.baselined).toEqual([]); expect(summary.skipped).toEqual(historical);
  });
  afterAll(async () => {
    await pool?.end();
    await historicalRunner?.dispose();
    if (admin) try {
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally { await admin.end(); }
  });

  it("adds only044, preserves43 checksums and old review row bytes/physical identities; replay is a no-op", async () => {
    const ledger = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    expect(ledger.slice(0,43)).toEqual(oldLedger);
    expect(ledger[43]).toEqual({ name: migration, checksum: digest(forward) });
    expect(ledger).toHaveLength(44);
    expect((await pool.query("SELECT id,xmin::text,ctid::text,to_jsonb(source) AS body FROM source_review_decisions source ORDER BY id")).rows).toEqual(oldRows);
    expect((await pool.query("SELECT count(*)::int n FROM matrix_column_pylon_section_v2_decisions")).rows[0].n).toBe(0);
    const repeated = await historicalRunner.runDatabaseMigrations(url);
    expect(repeated.applied).toEqual([]); expect(repeated.baselined).toEqual([]);
    expect(repeated.skipped).toEqual([...historical, migration]);
    expect((await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows).toEqual(ledger);
  });
  it("binds predecessor hash/key/object and prevents forks, double initial rows and mutation", async () => transaction(async client => {
    const id = randomUUID(), hash = digest(id), second = randomUUID();
    const a = await insert(client,{ id,hash });
    const b = await insert(client,{ id: second,previous:id,previousHash:hash,status:"WITHDRAWN" });
    expect(BigInt(b.rows[0].sequence_no)).toBeGreaterThan(BigInt(a.rows[0].sequence_no));
    await reject(client,() => insert(client,{ previous:id,previousHash:hash }),"23505");
    await reject(client,() => insert(client),"23505");
    await reject(client,() => insert(client,{ previous:second,previousHash:"f".repeat(64) }),"23503");
    await reject(client,() => insert(client,{ pair:"b".repeat(64),previous:second,previousHash:digest(second) }),"23503");
    await reject(client,() => client.query("UPDATE matrix_column_pylon_section_v2_decisions SET content_hash=$2 WHERE id=$1",[id,"f".repeat(64)]),"55000");
    await reject(client,() => client.query("DELETE FROM matrix_column_pylon_section_v2_decisions WHERE id=$1",[id]),"55000");
    await reject(client,() => client.query(rollback),"P0001");
  }));
  it("rejects missing projection discriminators, withdrawal without predecessor and foreign sources", async () => transaction(async client => {
    await reject(client,() => insert(client,{ body:{} }),"23514");
    await reject(client,() => insert(client,{ status:"WITHDRAWN" }),"23514");
    const other = randomUUID();
    await client.query("INSERT INTO objects(id,organization_id,api_id,name,address,display_status,stats) VALUES($1,$2,$3,'Other SQL test','Disposable','DRAFT','{}')", [other,organization,other]);
    await reject(client,() => insert(client,{ objectId:other }),"23503");
  }));
  it("can rehearse rollback only while the new journal is empty", async () => transaction(async client => {
    await client.query(rollback);
    expect((await client.query("SELECT to_regclass('matrix_column_pylon_section_v2_decisions') AS name")).rows[0].name).toBeNull();
  }));
});
