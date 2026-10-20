/** SQL-only synthetic fixtures. These do not qualify a real member or measured section. */
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHistoricalMigrationRunner } from "./historical-migration-runner.js";

const root = new URL("../../../", import.meta.url);
const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const migration = "045_run_column_pylon_section_snapshots.sql";
const forward = readFileSync(new URL(`migrations/${migration}`, root), "utf8");
const rollback = readFileSync(new URL(`migrations/rollback/${migration}`, root), "utf8");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const historical = readdirSync(new URL("migrations/", root)).filter(name => /^\d{3}_.+\.sql$/.test(name) && name < migration).sort();
expect(historical).toHaveLength(44);

(adminUrl ? describe : describe.skip)("T83 immutable per-run column/pylon snapshot SQL", { timeout: 90_000 }, () => {
  const name = `root_kr060_snapshot_sql_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, url: string;
  let organization: string, object: string, apiId: string, actor: string, run: string;
  let expectedSource: string, actualSource: string, expectedReview: string, actualReview: string;
  let oldRows: unknown, oldLedger: unknown;
  let historicalRunner: Awaited<ReturnType<typeof createHistoricalMigrationRunner>>;
  const manifestHash = "a".repeat(64), pair = "b".repeat(64), journalHash = "c".repeat(64), projectionHash = "d".repeat(64);
  let decision: string, sequence: string;

  async function reject(client: PoolClient, operation: () => Promise<unknown>, code: string) {
    await client.query("SAVEPOINT rejected_operation");
    let error: unknown;
    try { await operation(); } catch (value) { error = value; }
    await client.query("ROLLBACK TO SAVEPOINT rejected_operation");
    await client.query("RELEASE SAVEPOINT rejected_operation");
    expect(error).toMatchObject({ code });
  }
  async function transaction(body: (client: PoolClient) => Promise<void>) {
    const client = await pool.connect(); await client.query("BEGIN");
    try { await body(client); } finally { await client.query("ROLLBACK"); client.release(); }
  }
  async function source() {
    const id = randomUUID(), blob = randomUUID(), review = randomUUID(), sha = digest(id);
    await pool.query("INSERT INTO blobs(id,object_id,sha256,byte_size,storage_key,media_type,scan_status) VALUES($1,$2,$3,5,$4,'application/pdf','CLEAN')", [blob,object,sha,blob]);
    await pool.query("INSERT INTO source_files(id,api_id,object_id,blob_id,canonical_name,original_format) VALUES($1,$2,$3,$4,'SQL-only.pdf','pdf')", [id,id,object,blob]);
    await pool.query("INSERT INTO source_review_decisions(id,object_id,source_file_id,source_sha256,revision_status,approval_status,basis_reference,actor_id,content_hash) VALUES($1,$2,$3,$4,'UNKNOWN','UNKNOWN','SQL-only synthetic parent',$5,$6)", [review,object,id,sha,actor,digest(review)]);
    return { id, review };
  }
  function entry(included = true, reason: string | null = null) {
    return { pairKey:pair,decisionId:decision,sequenceNo:sequence,journalContentHash:journalHash,projectionContentHash:projectionHash,included,exclusionReason:reason };
  }
  function snapshot(entries: unknown[] = []) {
    return { schemaVersion:"matrix-kr060-column-pylon-run-snapshot-v1",objectId:object,objectApiId:apiId,inputManifestHash:manifestHash,entries,contentHash:"e".repeat(64) };
  }
  async function header(client: PoolClient, body: unknown = snapshot(), overrides: { object?: string; api?: string; manifest?: string; run?: string } = {}) {
    return client.query(`INSERT INTO run_column_pylon_section_snapshot_states(run_id,object_id,object_api_id,input_manifest_hash,content_hash,snapshot_json)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[overrides.run ?? run,overrides.object ?? object,overrides.api ?? apiId,overrides.manifest ?? manifestHash,"e".repeat(64),JSON.stringify(body)]);
  }
  async function binding(client: PoolClient, options: Record<string,unknown> = {}) {
    const body:Record<string,unknown> = { ...entry(),...options };
    return client.query(`INSERT INTO run_column_pylon_section_snapshot_entries(run_id,object_id,pair_key,decision_id,sequence_no,journal_content_hash,projection_content_hash,included,exclusion_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[run,body.objectId ?? object,body.pairKey,body.decisionId,body.sequenceNo,body.journalContentHash,body.projectionContentHash,body.included,body.exclusionReason]);
  }
  beforeAll(async () => {
    historicalRunner = await createHistoricalMigrationRunner(migration);
    expect(historicalRunner.migrationNames).toEqual([...historical, migration]);
    admin = new Pool({ connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:30000 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(adminUrl!); target.pathname = `/${name}`; url = target.toString();
    pool = new Pool({ connectionString:url,max:1,connectionTimeoutMillis:5000,statement_timeout:20000 });
    await pool.query("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    for (const file of historical) {
      const sql = readFileSync(new URL(`migrations/${file}`,root),"utf8");
      await pool.query("BEGIN");
      try { await pool.query(sql); await pool.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",[file,digest(sql)]); await pool.query("COMMIT"); }
      catch (error) { await pool.query("ROLLBACK"); throw error; }
    }
    organization=randomUUID(); object=randomUUID(); actor=randomUUID(); apiId=`OBJ-SQL-${randomUUID()}`; run=randomUUID();
    await pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'SQL test')",[organization,organization]);
    await pool.query("INSERT INTO objects(id,organization_id,api_id,name,address,display_status,stats) VALUES($1,$2,$3,'SQL test','Disposable','DRAFT','{}')",[object,organization,apiId]);
    await pool.query("INSERT INTO inspector_users(id,login,provider_subject,display_name) VALUES($1,$2,$3,'SQL actor')",[actor,`${actor}@example.test`,actor]);
    const first=await source(),second=await source(); expectedSource=first.id; expectedReview=first.review; actualSource=second.id; actualReview=second.review;
    decision=randomUUID();
    sequence=(await pool.query(`INSERT INTO matrix_column_pylon_section_v2_decisions(id,object_id,pair_key,expected_source_file_id,actual_source_file_id,expected_review_decision_id,actual_review_decision_id,projection_json,actor_id,content_hash,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'2026-10-18T12:00:00.000Z') RETURNING sequence_no::text`,[decision,object,pair,expectedSource,actualSource,expectedReview,actualReview,JSON.stringify({schemaVersion:"matrix-kr060-column-pylon-pair-projection-v2",status:"UNKNOWN",contentHash:projectionHash}),actor,journalHash])).rows[0].sequence_no;
    await pool.query("INSERT INTO analysis_releases(release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed) VALUES('SQL_ONLY','analysis-release-legacy-v1','LEGACY',$1,2,'{}',false)",[digest("SQL_ONLY")]);
    const inspection=randomUUID(),manifest=randomUUID();
    await pool.query("INSERT INTO inspections(id,organization_id,object_id,lifecycle,mode) VALUES($1,$2,$3,'OPEN','NORMAL')",[inspection,organization,object]);
    await pool.query("INSERT INTO input_manifests(id,inspection_id,sequence,canonical_json,sha256) VALUES($1,$2,1,'{}',$3)",[manifest,inspection,manifestHash]);
    await pool.query(`INSERT INTO analysis_runs(id,api_id,inspection_id,object_id,manifest_id,release_id,run_state,display_status,mode,progress,current_stage,rules_version,stats)
      VALUES($1::uuid,$1::text,$2,$3,$4,'SQL_ONLY','QUEUED','PROCESSING','NORMAL',0,'QUEUED','SQL_ONLY','{}')`,[run,inspection,object,manifest]);
    oldLedger=(await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    oldRows=(await pool.query("SELECT id,xmin::text,ctid::text,to_jsonb(journal) AS body FROM matrix_column_pylon_section_v2_decisions journal ORDER BY id")).rows;
    const summary = await historicalRunner.runDatabaseMigrations(url);
    expect(summary.applied).toEqual([migration]); expect(summary.baselined).toEqual([]); expect(summary.skipped).toEqual(historical);
  });
  afterAll(async () => {
    await pool?.end();
    await historicalRunner?.dispose();
    if (admin) try {
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",[name])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally { await admin.end(); }
  });

  it("adds only045, preserves44 historical checksums and physical journal rows; second migration run is a no-op",async () => {
    const ledger=(await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    expect(ledger.slice(0,44)).toEqual(oldLedger); expect(ledger).toHaveLength(45);
    expect(ledger[44]).toEqual({ name:migration,checksum:digest(forward) });
    expect((await pool.query("SELECT id,xmin::text,ctid::text,to_jsonb(journal) AS body FROM matrix_column_pylon_section_v2_decisions journal ORDER BY id")).rows).toEqual(oldRows);
    const repeated = await historicalRunner.runDatabaseMigrations(url);
    expect(repeated.applied).toEqual([]); expect(repeated.baselined).toEqual([]);
    expect(repeated.skipped).toEqual([...historical, migration]);
    expect((await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows).toEqual(ledger);
  });
  it("accepts empty snapshot and exact included binding; immutable rows and populated rollback reject",async () => transaction(async client => {
    await header(client,snapshot([entry()])); await binding(client);
    for(const table of ["run_column_pylon_section_snapshot_states","run_column_pylon_section_snapshot_entries"]){
      await reject(client,()=>client.query(`UPDATE ${table} SET object_id=object_id WHERE run_id=$1`,[run]),"55000");
      await reject(client,()=>client.query(`DELETE FROM ${table} WHERE run_id=$1`,[run]),"55000");
    }
    await reject(client,()=>client.query(rollback),"P0001");
    await reject(client,()=>binding(client),"23505");
  }));
  it("accepts each excluded reason with exact JSON null/boolean semantics",async () => {
    for(const reason of ["SOURCE_NOT_IN_MANIFEST","SOURCE_REVIEW_REFERENCE_CHANGED"]){
      await transaction(async client=>{ await header(client,snapshot([entry(false,reason)])); await binding(client,{included:false,exclusionReason:reason}); });
    }
  });
  it("rejects malformed/null header fields, over16 entries and wrong authenticated manifest/public ID",async () => transaction(async client=>{
    const good=snapshot();
    for(const body of [null,{}, {...good,contentHash:null},{...good,objectId:null},{...good,objectApiId:null},{...good,entries:null},{...good,entries:{}},{...good,extra:true},{...good,entries:Array(17).fill(entry())}]){
      await reject(client,()=>header(client,body),"23514");
    }
    await reject(client,()=>header(client,{...good,inputManifestHash:"f".repeat(64)},{manifest:"f".repeat(64)}),"23514");
    await reject(client,()=>header(client,{...good,objectApiId:"OBJ-WRONG"},{api:"OBJ-WRONG"}),"23514");
    await reject(client,()=>header(client,good,{object:randomUUID()}),"23514");
    await reject(client,()=>header(client,good,{run:randomUUID()}),"23514");
  }));
  it("rejects unlisted entries, sequence/projection/journal/key/object mismatches and invalid include reasons",async () => transaction(async client=>{
    await header(client,snapshot([entry()]));
    for(const options of [{sequenceNo:"0"},{sequenceNo:String(BigInt(sequence)+1n)},{projectionContentHash:"f".repeat(64)},{journalContentHash:"f".repeat(64)},{pairKey:"f".repeat(64)},{objectId:randomUUID()},{included:false,exclusionReason:null},{included:true,exclusionReason:"SOURCE_NOT_IN_MANIFEST"},{included:false,exclusionReason:"OTHER"}]){
      await reject(client,()=>binding(client,options),"23514");
    }
  }));
  it("rejects valid journal binding absent from header, and rehearses rollback only with empty new tables",async () => {
    await transaction(async client=>{ await header(client); await reject(client,()=>binding(client),"23514"); });
    await transaction(async client=>{ await client.query(rollback); expect((await client.query("SELECT to_regclass('run_column_pylon_section_snapshot_states') name")).rows[0].name).toBeNull(); });
  });
});
