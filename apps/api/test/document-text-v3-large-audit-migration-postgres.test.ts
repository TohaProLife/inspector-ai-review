/** Independent T79 SQL boundary. Disposable databases only; no source-semantic admission claim. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from '../src/database-migrations.js';
import { createHistoricalMigrationRunner } from './historical-migration-runner.js';

const root = new URL('../../../', import.meta.url);
const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const migrationName = '043_document_text_v3_large_audit.sql';
const marker = 'document-text-v3-large-source-bounds-v1';
const digest = (x: string) => createHash('sha256').update(x).digest('hex');
const forward = readFileSync(new URL(`migrations/${migrationName}`, root), 'utf8');
const rollback = readFileSync(new URL(`migrations/rollback/${migrationName}`, root), 'utf8');
// Exact ROOT proposals, independently inspected before any SQL invocation.
expect(digest(forward)).toBe('b2aae21422d1842f4952f33b1c1bb3961d352098996b63cd1745dc1bee4f6d3d');
expect(digest(rollback)).toBe('6cf839b687456de8a3b921ab20749c709c6801978219ee0f42a6fe72b9f27c60');
const historical = readdirSync(new URL('migrations/', root)).filter(n => /^0(?:0[1-9]|[1-3][0-9]|4[0-2])_.+\.sql$/.test(n)).sort();
expect(historical).toHaveLength(42);
expect(digest(readFileSync(new URL('migrations/009_document_text_layer.sql', root), 'utf8'))).toBe('806e52895f20e6e1a484b773876e6b6b9a6a12806f668f3f6ff9a650bc3774f8');
expect(digest(readFileSync(new URL('migrations/038_document_text_v3_audit.sql', root), 'utf8'))).toBe('0f3bb29efbadd66211524b000b7f2aa22e3956d7db94a6d8ff5a58f533cd6674');

type Context = {object: string; run: string; job: string};
(adminUrl ? describe : describe.skip)('T79 isolated PostgreSQL 043 explicit large source boundary', {timeout: 90_000}, () => {
  const names = ['upgrade', 'fresh', 'current'].map(label => `qa_t79_043_${label}_${randomUUID().replaceAll('-', '')}`);
  let admin: Pool, upgrade: Pool, fresh: Pool, current: Pool;
  let upgradeUrl: string, freshUrl: string, currentUrl: string, legacyId: string, before: unknown, ctx: Context;
  let historicalRunner: Awaited<ReturnType<typeof createHistoricalMigrationRunner>>;
  async function open(name: string) {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    return {url: url.toString(), pool: new Pool({connectionString: url.toString(), max: 1, connectionTimeoutMillis: 5000, statement_timeout: 20000, query_timeout: 25000})};
  }
  async function seed(db: Pool): Promise<Context> {
    const org = randomUUID(), object = randomUUID(), inspection = randomUUID(), manifest = randomUUID(), run = randomUUID(), job = randomUUID();
    await db.query('INSERT INTO organizations(id,slug,name) VALUES($1,$2,$3)', [org, org, 'Synthetic SQL boundary, no source authority']);
    await db.query("INSERT INTO objects(id,organization_id,api_id,name,address,display_status,stats) VALUES($1,$2,$3,'SQL-only','Local disposable','DRAFT','{}')", [object,org,object]);
    await db.query("INSERT INTO inspections(id,organization_id,object_id,lifecycle,mode) VALUES($1,$2,$3,'OPEN','NORMAL')", [inspection,org,object]);
    await db.query("INSERT INTO input_manifests(id,inspection_id,sequence,canonical_json,sha256) VALUES($1,$2,1,'{}',$3)", [manifest,inspection,'a'.repeat(64)]);
    const release = `qa-sql-${randomUUID()}`;
    await db.query("INSERT INTO analysis_releases(release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed) VALUES($1,'analysis-release-legacy-v1','LEGACY',$2,2,'{}',false)", [release,'b'.repeat(64)]);
    await db.query("INSERT INTO analysis_runs(id,api_id,inspection_id,object_id,manifest_id,release_id,run_state,display_status,mode,progress,current_stage,rules_version,stats) VALUES($1,$2,$3,$4,$5,$6,'QUEUED','PROCESSING','NORMAL',0,'SQL-only','SQL-only','{}')", [run,run,inspection,object,manifest,release]);
    await db.query("INSERT INTO analysis_jobs(id,organization_id,object_id,inspection_id,run_id,queue_name,job_type,scope_type,state,semantic_key,input_manifest_hash,release_id) VALUES($1,$2,$3,$4,$5,'SQL-only','DOCUMENT_TEXT_LAYER','ANALYSIS','READY',$6,$7,$8)", [job,org,object,inspection,run,'c'.repeat(64),'a'.repeat(64),release]);
    return {object,run,job};
  }
  async function source(db: Pool | PoolClient, context: Context) {
    const blob = randomUUID(), id = randomUUID(), sha = digest(id);
    await db.query("INSERT INTO blobs(id,object_id,sha256,byte_size,storage_key,media_type,scan_status) VALUES($1,$2,$3,1,'SQL-only','application/pdf','CLEAN')", [blob,context.object,sha]);
    await db.query("INSERT INTO source_files(id,api_id,object_id,blob_id,canonical_name,original_format) VALUES($1,$2,$3,$4,'SQL-only.pdf','pdf')", [id,id,context.object,blob]);
    return id;
  }
  // Deliberately small JSON: these tests isolate byte_size CHECK, not application byte/hash authenticity.
  async function insert(db: Pool | PoolClient, context: Context, size: number, schema = 'document-text-v3', policy: string | null | undefined = undefined, sid?: string) {
    const id = randomUUID(), sourceId = sid ?? await source(db, context);
    const columns = policy === undefined ? '' : ',resource_policy_version';
    const values = policy === undefined ? '' : ',$9';
    const args: unknown[] = [id,context.job,context.run,sourceId,schema,'d'.repeat(64),'e'.repeat(64),size];
    if(policy !== undefined) args.push(policy);
    await db.query(`INSERT INTO analysis_text_artifacts(id,job_id,run_id,source_file_id,schema_version,input_sha256,content_hash,byte_size,page_count,text_page_count,content_json${columns}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,1,'{"raw":"SQL boundary only"}'${values})`, args);
    return {id,sourceId};
  }
  async function snapshot(db: Pool | PoolClient, id = legacyId) {
    return (await db.query("SELECT to_jsonb(t)-'resource_policy_version' body,xmin::text xmin,ctid::text ctid FROM analysis_text_artifacts t WHERE id=$1", [id])).rows[0];
  }
  async function rejected(db: PoolClient, operation: () => Promise<unknown>, expected: Record<string, unknown>) {
    await db.query('SAVEPOINT negative_case');
    let thrown: unknown;
    try { await operation(); } catch(error) { thrown = error; }
    finally { await db.query('ROLLBACK TO SAVEPOINT negative_case'); await db.query('RELEASE SAVEPOINT negative_case'); }
    expect(thrown).toMatchObject(expected);
  }
  async function transaction(db: Pool, body: (client: PoolClient) => Promise<void>) {
    const client = await db.connect(); await client.query('BEGIN');
    try { await body(client); } finally { await client.query('ROLLBACK'); client.release(); }
  }
  beforeAll(async () => {
    historicalRunner = await createHistoricalMigrationRunner(migrationName);
    expect(historicalRunner.migrationNames).toEqual([...historical, migrationName]);
    admin = new Pool({connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000, query_timeout: 30000});
    const u = await open(names[0]!); upgrade = u.pool; upgradeUrl = u.url;
    // Authentic frozen 001..042 SQL, with the normal runner's exact checksum ledger shape.
    await upgrade.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum CHAR(64) NOT NULL CHECK(checksum ~ \'^[a-f0-9]{64}$\'),applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for(const name of historical) {
      const sql = readFileSync(new URL(`migrations/${name}`, root), 'utf8');
      await upgrade.query('BEGIN');
      try { await upgrade.query(sql); await upgrade.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,digest(sql)]); await upgrade.query('COMMIT'); }
      catch(error) { await upgrade.query('ROLLBACK'); throw error; }
    }
    ctx = await seed(upgrade);
    // Old schema has no marker: actual pre-upgrade legacy row at the old exact ceiling.
    legacyId = (await insert(upgrade,ctx,8388608,'document-text-v2',undefined)).id;
    before = await snapshot(upgrade);
    const f = await open(names[1]!); fresh = f.pool; freshUrl = f.url;
    const c = await open(names[2]!); current = c.pool; currentUrl = c.url;
  });
  afterAll(async () => {
    await upgrade?.end(); await fresh?.end(); await current?.end();
    await historicalRunner?.dispose();
    if(admin) try {
      await admin.query('SET statement_timeout=10000'); await admin.query('SET lock_timeout=5000');
      for(const name of names) {
        expect((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1', [name])).rows[0].n).toBe(0);
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      }
    } finally { await admin.end(); }
  });
  it('upgrades all42 without rewriting old row bytes/hash/physical identity or historical checksums', async () => {
    const ledger = (await upgrade.query('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name')).rows;
    const applied = await historicalRunner.runDatabaseMigrations(upgradeUrl);
    expect(applied.applied).toEqual([migrationName]); expect(applied.skipped).toHaveLength(42);
    expect(applied.baselined).toEqual([]);
    expect(await snapshot(upgrade)).toEqual(before);
    expect((await upgrade.query('SELECT resource_policy_version FROM analysis_text_artifacts WHERE id=$1',[legacyId])).rows[0]).toEqual({resource_policy_version:null});
    expect((await upgrade.query('SELECT name,checksum,applied_at FROM schema_migrations WHERE name<>$1 ORDER BY name',[migrationName])).rows).toEqual(ledger);
    const column = (await upgrade.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_text_artifacts' AND column_name='resource_policy_version'")).rows;
    expect(column).toEqual([{is_nullable:'YES',column_default:null}]);
  });
  it('enforces exact legacy NULL and new32M ceilings, schema/marker combinations, zero and negative boundaries', async () => transaction(upgrade, async client => {
    for(const schema of ['document-text-v1','document-text-v2','document-text-v3']) {
      expect(await insert(client,ctx,8388608,schema,null)).toHaveProperty('id');
      await rejected(client,()=>insert(client,ctx,8388609,schema,null),{code:'23514',constraint:'analysis_text_artifacts_byte_size_check'});
    }
    expect(await insert(client,ctx,32000000,'document-text-v3',marker)).toHaveProperty('id');
    for(const [size,schema,policy] of [
      [32000001,'document-text-v3',marker],[0,'document-text-v3',marker],[-1,'document-text-v3',marker],
      [8388609,'document-text-v3','UNKNOWN'],[1,'document-text-v3','UNKNOWN'],
      [1,'document-text-v2',marker],[32000000,'document-text-v1',marker],
    ] as const) await rejected(client,()=>insert(client,ctx,size,schema,policy),{code:'23514',constraint:'analysis_text_artifacts_byte_size_check'});
  }));
  it('retains uniqueness and append-only triggers; refuses marked rollback atomically without row loss', async () => transaction(upgrade, async client => {
    const row = await insert(client,ctx,32000000,'document-text-v3',marker);
    const previous = await snapshot(client,row.id);
    await rejected(client,()=>insert(client,ctx,32000000,'document-text-v3',marker,row.sourceId),{code:'23505'});
    await rejected(client,()=>client.query('UPDATE analysis_text_artifacts SET byte_size=1 WHERE id=$1',[row.id]),{code:'55000',message:'analysis_text_artifacts is append-only'});
    await rejected(client,()=>client.query('DELETE FROM analysis_text_artifacts WHERE id=$1',[row.id]),{code:'55000',message:'analysis_text_artifacts is append-only'});
    await rejected(client,()=>client.query(rollback),{code:'P0001',message:'Cannot roll back large source audit while marked artifacts exist'});
    expect(await snapshot(client,row.id)).toEqual(previous);
    expect(await snapshot(client)).toEqual(before);
    expect((await client.query('SELECT resource_policy_version FROM analysis_text_artifacts WHERE id=$1',[row.id])).rows[0].resource_policy_version).toBe(marker);
  }));
  it('permits unmarked rollback without changing historical bytes; restores old CHECK and removes only marker column', async () => transaction(upgrade, async client => {
    await client.query(rollback);
    expect(await snapshot(client)).toEqual(before);
    expect((await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='analysis_text_artifacts' AND column_name='resource_policy_version'")).rows).toHaveLength(0);
    expect(await insert(client,ctx,8388608,'document-text-v3',undefined)).toHaveProperty('id');
    await rejected(client,()=>insert(client,ctx,8388609,'document-text-v3',undefined),{code:'23514',constraint:'analysis_text_artifacts_byte_size_check'});
    await rejected(client,()=>client.query('DELETE FROM analysis_text_artifacts WHERE id=$1',[legacyId]),{code:'55000'});
  }));
  it('applies the fresh001..043 boundary and repeated runner keeps43 checksum/history and exact byte bounds', async () => {
    const first = await historicalRunner.runDatabaseMigrations(freshUrl);
    expect(first.applied).toEqual([...historical, migrationName]); expect(first.baselined).toEqual([]);
    const ledger = (await fresh.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    const second = await historicalRunner.runDatabaseMigrations(freshUrl);
    expect(second.applied).toEqual([]); expect(second.baselined).toEqual([]);
    expect(second.skipped).toEqual([...historical, migrationName]);
    expect((await fresh.query('SELECT * FROM schema_migrations ORDER BY name')).rows).toEqual(ledger);
    expect(ledger.find(r=>r.name===migrationName)?.checksum.trim()).toBe(digest(forward));
    const context = await seed(fresh);
    await transaction(fresh,async client=>{
      expect(await insert(client,context,32000000,'document-text-v3',marker)).toHaveProperty('id');
      await rejected(client,()=>insert(client,context,8388609,'document-text-v3',null),{code:'23514',constraint:'analysis_text_artifacts_byte_size_check'});
      await rejected(client,()=>insert(client,context,32000001,'document-text-v3',marker),{code:'23514',constraint:'analysis_text_artifacts_byte_size_check'});
    });
  });
  it('applies every current migration on a separate fresh database and replays without ledger or checksum changes', async () => {
    const currentNames = readdirSync(new URL('migrations/', root)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
    expect(currentNames).toEqual(expect.arrayContaining([
      migrationName, '044_matrix_column_pylon_section_v2_reviews.sql', '045_run_column_pylon_section_snapshots.sql',
    ]));
    const expected = currentNames.map(name => ({name,checksum:digest(readFileSync(new URL(`migrations/${name}`, root), 'utf8'))}));
    const first = await runDatabaseMigrations(currentUrl);
    expect(first.applied).toEqual(currentNames); expect(first.baselined).toEqual([]); expect(first.skipped).toEqual([]);
    const ledger = (await current.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
    expect(ledger.map(({name,checksum}) => ({name,checksum}))).toEqual(expected);
    const second = await runDatabaseMigrations(currentUrl);
    expect(second.applied).toEqual([]); expect(second.baselined).toEqual([]); expect(second.skipped).toEqual(currentNames);
    expect((await current.query('SELECT * FROM schema_migrations ORDER BY name')).rows).toEqual(ledger);
  });
});
