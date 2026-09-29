import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { canonicalJson, sha256 } from "./canonical-json.js";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");
const migrationFilePattern = /^\d{3}_.+\.sql$/;
const migrationLockName = "inspector-ai:schema-migrations";

interface MigrationRequirement {
  relations?: string[];
  triggers?: string[];
  functions?: string[];
}

const knownMigrationRequirements: Record<string, MigrationRequirement> = {
  "001_initial.sql": {
    relations: [
      "inspection_objects", "document_files", "document_links", "parameter_catalog",
      "check_runs", "findings", "evidence_fragments", "inspector_decisions",
      "protocol_versions", "processing_jobs", "audit_log", "findings_check_status_idx",
      "files_object_stage_idx", "audit_object_time_idx",
    ],
  },
  "002_domain_core.sql": {
    relations: [
      "organizations", "objects", "inspections", "object_stage_summaries", "blobs",
      "source_files", "source_file_stages", "upload_receipts", "upload_receipt_files",
      "input_manifests", "manifest_items", "analysis_runs", "parameter_coverage",
      "rule_results", "review_items", "review_decisions", "inspection_protocol_versions",
      "objects_organization_created_idx", "source_files_object_registered_idx",
      "upload_receipts_object_created_idx", "analysis_runs_inspection_started_idx",
      "analysis_runs_state_started_idx", "parameter_coverage_run_rollup_idx",
      "rule_results_run_status_idx", "review_items_inspection_status_idx",
      "review_decisions_item_created_idx", "protocol_versions_inspection_created_idx",
    ],
    triggers: [
      "blobs_immutable", "source_files_immutable", "input_manifests_immutable",
      "manifest_items_immutable", "analysis_runs_sealed_immutable", "rule_results_immutable",
      "review_decisions_immutable", "inspection_protocol_versions_immutable",
    ],
    functions: ["reject_immutable_domain_mutation", "reject_sealed_run_mutation"],
  },
  "003_identity_scope_audit.sql": {
    relations: [
      "inspector_users", "organization_memberships", "object_memberships", "user_sessions",
      "command_receipts", "audit_events", "inspector_users_enabled_login_idx",
      "organization_memberships_user_active_idx", "object_memberships_user_active_idx",
      "user_sessions_user_active_idx", "command_receipts_expiry_idx",
      "audit_events_scope_time_idx", "audit_events_target_time_idx",
    ],
    triggers: ["command_receipts_immutable", "audit_events_immutable"],
  },
  "004_protocol_revocations.sql": {
    relations: [
      "protocol_revocations", "protocol_revocations_created_idx",
      "protocol_revocations_replacement_idx",
    ],
    triggers: ["protocol_revocations_immutable"],
  },
  "005_protocol_canonical_artifacts.sql": {
    relations: ["protocol_artifacts", "protocol_artifacts_protocol_created_idx"],
    triggers: ["protocol_artifacts_immutable"],
  },
  "006_durable_jobs_outbox.sql": {
    relations: [
      "analysis_jobs", "job_attempts", "domain_outbox",
      "analysis_jobs_dispatch_idx", "analysis_jobs_run_state_idx",
      "job_attempts_job_started_idx", "domain_outbox_pending_idx",
      "domain_outbox_published_idx",
    ],
  },
  "008_analysis_job_dag.sql": {
    relations: [
      "analysis_job_dependencies", "analysis_job_dependencies_prerequisite_idx",
    ],
  },
  "009_document_text_layer.sql": {
    relations: ["analysis_text_artifacts", "analysis_text_artifacts_run_source_idx"],
    triggers: ["analysis_text_artifacts_immutable"],
  },
  "014_source_review_snapshots.sql": {
    relations: ["source_review_decisions", "source_review_decisions_latest_idx", "run_source_review_snapshots"],
    triggers: ["source_review_decisions_immutable", "run_source_review_snapshots_immutable"],
  },
  "016_visual_proposal_reviews.sql": {
    relations: ["visual_proposal_reviews", "visual_proposal_reviews_history_idx"],
    triggers: ["visual_proposal_reviews_immutable"],
  },
  "019_fact_entity_link_reviews.sql": {
    relations: ["fact_entity_link_decisions", "fact_entity_link_decisions_latest_idx",
      "run_fact_entity_link_snapshots"],
    triggers: ["fact_entity_link_decisions_immutable", "run_fact_entity_link_snapshots_immutable"],
  },
  "020_ocr_row_transcription_reviews.sql": {
    relations: ["ocr_row_transcription_decisions",
      "ocr_row_transcription_decisions_history_idx"],
    triggers: ["ocr_row_transcription_decisions_immutable"],
  },
  "021_run_ocr_transcription_snapshots.sql": {
    relations: ["run_ocr_transcription_snapshots",
      "run_ocr_transcription_snapshots_history_idx",
      "ocr_row_transcription_decisions_origin_key"],
    triggers: ["run_ocr_transcription_snapshots_immutable"],
  },
  "023_ocr_row_applicability_reviews.sql": {
    relations: ["ocr_row_applicability_decisions",
      "ocr_row_applicability_decisions_history_idx"],
    triggers: ["ocr_row_applicability_decisions_immutable"],
  },
  "024_run_ocr_applicability_snapshots.sql": {
    relations: ["run_ocr_applicability_snapshots",
      "run_ocr_applicability_snapshots_decision_idx",
      "ocr_row_applicability_decisions_origin_key"],
    triggers: ["run_ocr_applicability_snapshots_immutable"],
  },
  "025_run_ocr_typed_fact_candidate_artifacts.sql": {
    relations: ["run_ocr_typed_fact_candidate_artifacts"],
    triggers: ["run_ocr_typed_fact_candidate_artifacts_immutable"],
  },
  "026_ocr_fact_pair_reviews.sql": {
    relations: ["ocr_fact_pair_decisions", "ocr_fact_pair_decisions_history_idx"],
    triggers: ["ocr_fact_pair_decisions_immutable"],
  },
  "027_run_ocr_fact_pair_snapshots.sql": {
    relations: ["run_ocr_fact_pair_snapshots",
      "run_ocr_fact_pair_snapshots_decision_idx",
      "ocr_fact_pair_decisions_origin_key"],
    triggers: ["run_ocr_fact_pair_snapshots_immutable"],
  },
  "028_ocr_fact_pair_quantity_reviews.sql": {
    relations: ["ocr_fact_pair_quantity_decisions",
      "ocr_fact_pair_quantity_decisions_history_idx",
      "run_ocr_fact_pair_snapshots_quantity_key"],
    triggers: ["ocr_fact_pair_quantity_decisions_immutable"],
  },
  "029_review_candidate_decisions.sql": {
    relations: ["review_candidate_decisions", "review_candidate_decisions_history_idx"],
    triggers: ["review_candidate_decisions_immutable"],
  },
};

interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationEvent {
  action: "applied" | "baselined" | "skipped" | "backfilled";
  migration?: string;
  count?: number;
}

export interface MigrationSummary {
  applied: string[];
  baselined: string[];
  skipped: string[];
  backfilledArtifacts: number;
}

interface RunMigrationOptions {
  log?: (event: MigrationEvent) => void;
  backfillBatchSize?: number;
}

interface HistoricalProtocolRow {
  id: string;
  api_id: string;
  snapshot_json: unknown;
  snapshot_hash: string;
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(migrationDirectory))
    .filter((name) => migrationFilePattern.test(name))
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(migrationDirectory, name), "utf8");
    return { name, sql, checksum: sha256(sql) };
  }));
}

async function existingRequirementNames(
  client: PoolClient,
  requirement: MigrationRequirement,
): Promise<Set<string>> {
  const existing = new Set<string>();
  const relations = requirement.relations ?? [];
  if (relations.length > 0) {
    const result = await client.query<{ name: string }>(
      `SELECT name
       FROM unnest($1::text[]) AS requested(name)
       WHERE to_regclass(format('%I.%I', 'public', name)) IS NOT NULL`,
      [relations],
    );
    result.rows.forEach((row) => existing.add(row.name));
  }

  const triggers = requirement.triggers ?? [];
  if (triggers.length > 0) {
    const result = await client.query<{ name: string }>(
      `SELECT DISTINCT trigger.tgname AS name
       FROM pg_trigger trigger
       JOIN pg_class relation ON relation.oid = trigger.tgrelid
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND NOT trigger.tgisinternal
         AND trigger.tgname = ANY($1::text[])`,
      [triggers],
    );
    result.rows.forEach((row) => existing.add(row.name));
  }

  const functions = requirement.functions ?? [];
  if (functions.length > 0) {
    const result = await client.query<{ name: string }>(
      `SELECT DISTINCT procedure.proname AS name
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'public'
         AND procedure.proname = ANY($1::text[])`,
      [functions],
    );
    result.rows.forEach((row) => existing.add(row.name));
  }
  return existing;
}

function allRequirementNames(requirement: MigrationRequirement): string[] {
  return [
    ...(requirement.relations ?? []),
    ...(requirement.triggers ?? []),
    ...(requirement.functions ?? []),
  ];
}

async function recordMigration(
  client: PoolClient,
  migration: MigrationFile,
): Promise<void> {
  await client.query(
    `INSERT INTO schema_migrations (name, checksum)
     VALUES ($1, $2)`,
    [migration.name, migration.checksum],
  );
}

async function applyOrBaselineMigration(
  client: PoolClient,
  migration: MigrationFile,
): Promise<"applied" | "baselined"> {
  const requirement = knownMigrationRequirements[migration.name];
  if (requirement) {
    const requiredNames = allRequirementNames(requirement);
    const existingNames = await existingRequirementNames(client, requirement);
    if (existingNames.size === requiredNames.length) {
      await client.query("BEGIN");
      try {
        await recordMigration(client, migration);
        await client.query("COMMIT");
        return "baselined";
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (existingNames.size > 0) {
      const missing = requiredNames.filter((name) => !existingNames.has(name));
      throw new Error(
        `Refusing partial migration ${migration.name}; missing schema objects: ${missing.join(", ")}`,
      );
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await recordMigration(client, migration);
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function backfillCanonicalProtocolArtifacts(
  client: PoolClient,
  batchSize = 100,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("Backfill batch size must be an integer between 1 and 1000");
  }

  let inserted = 0;
  while (true) {
    await client.query("BEGIN");
    try {
      const protocols = await client.query<HistoricalProtocolRow>(
        `SELECT protocol.id, protocol.api_id, protocol.snapshot_json, protocol.snapshot_hash
         FROM inspection_protocol_versions protocol
         LEFT JOIN protocol_artifacts artifact
           ON artifact.protocol_id = protocol.id
          AND artifact.format = 'JSON'
          AND artifact.canonicalization_version = 'inspector-c14n-v1'
         WHERE artifact.id IS NULL
         ORDER BY protocol.created_at, protocol.id
         FOR UPDATE OF protocol SKIP LOCKED
         LIMIT $1`,
        [batchSize],
      );
      if (protocols.rowCount === 0) {
        await client.query("COMMIT");
        break;
      }

      const artifacts = protocols.rows.map((protocol) => {
        const snapshot = typeof protocol.snapshot_json === "string"
          ? JSON.parse(protocol.snapshot_json) as unknown
          : protocol.snapshot_json;
        const canonical = canonicalJson(snapshot);
        const bytes = Buffer.from(canonical, "utf8");
        const contentHash = sha256(bytes);
        const expectedHash = protocol.snapshot_hash.trim();
        if (contentHash !== expectedHash) {
          throw new Error(
            `Canonical hash mismatch for historical protocol ${protocol.api_id}: expected ${expectedHash}, calculated ${contentHash}`,
          );
        }
        return {
          protocolId: protocol.id,
          apiId: `ART-${randomUUID().toUpperCase()}`,
          bytes,
          contentHash,
        };
      });

      for (const artifact of artifacts) {
        const result = await client.query(
          `INSERT INTO protocol_artifacts (
             api_id, protocol_id, format, media_type, canonicalization_version,
             byte_size, content_hash, content_bytes
           ) VALUES ($1, $2, 'JSON', 'application/json', 'inspector-c14n-v1', $3, $4, $5)
           ON CONFLICT (protocol_id, format, canonicalization_version) DO NOTHING
           RETURNING id`,
          [
            artifact.apiId,
            artifact.protocolId,
            artifact.bytes.byteLength,
            artifact.contentHash,
            artifact.bytes,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  return inserted;
}

export async function runDatabaseMigrations(
  connectionString: string,
  options: RunMigrationOptions = {},
): Promise<MigrationSummary> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  let lockAcquired = false;
  const summary: MigrationSummary = {
    applied: [],
    baselined: [],
    skipped: [],
    backfilledArtifacts: 0,
  };

  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [migrationLockName]);
    lockAcquired = true;
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    for (const migration of await loadMigrationFiles()) {
      const tracked = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [migration.name],
      );
      if (tracked.rowCount === 1) {
        const trackedChecksum = tracked.rows[0].checksum.trim();
        if (trackedChecksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch for ${migration.name}: recorded ${trackedChecksum}, current ${migration.checksum}`,
          );
        }
        summary.skipped.push(migration.name);
        options.log?.({ action: "skipped", migration: migration.name });
        continue;
      }

      const action = await applyOrBaselineMigration(client, migration);
      summary[action].push(migration.name);
      options.log?.({ action, migration: migration.name });
    }

    summary.backfilledArtifacts = await backfillCanonicalProtocolArtifacts(
      client,
      options.backfillBatchSize,
    );
    options.log?.({ action: "backfilled", count: summary.backfilledArtifacts });
    return summary;
  } finally {
    try {
      if (lockAcquired) {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [migrationLockName]);
      }
    } finally {
      client.release();
      await pool.end();
    }
  }
}
