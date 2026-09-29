import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { InspectionRepository } from "../src/repository.js";
import { InspectorStore } from "../src/store.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function asAsyncRepository(store: InspectorStore): InspectionRepository {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => Promise.resolve(Reflect.apply(value, target, args));
    },
  }) as InspectionRepository;
}

describe("persistence boundary", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("awaits an asynchronous repository instead of depending on the memory store", async () => {
    const repository = asAsyncRepository(await InspectorStore.create());
    app = await buildApp({ repository });

    const created = await app.inject({
      method: "POST",
      url: "/api/objects",
      payload: { name: "Асинхронный объект", address: "г. Москва, тестовый адрес" },
    });
    const loaded = await app.inject({ method: "GET", url: `/api/objects/${created.json().id}` });

    expect(created.statusCode).toBe(201);
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({ name: "Асинхронный объект", status: "DRAFT" });
  });

  it("tracks the B04 core as a forward migration with scoped keys and immutable records", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/002_domain_core.sql"), "utf8");
    const rollback = await readFile(resolve(projectRoot, "migrations/rollback/002_domain_core.sql"), "utf8");

    for (const table of [
      "organizations",
      "objects",
      "inspections",
      "blobs",
      "source_files",
      "input_manifests",
      "manifest_items",
      "analysis_runs",
      "parameter_coverage",
      "rule_results",
      "review_items",
      "review_decisions",
      "inspection_protocol_versions",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    }

    expect(migration).toContain("FOREIGN KEY (object_id, organization_id)");
    expect(migration).toContain("FOREIGN KEY (active_run_id, id) REFERENCES analysis_runs(id, inspection_id)");
    expect(migration).toContain("FOREIGN KEY (result_id, run_id) REFERENCES rule_results(id, run_id)");
    expect(migration).toContain("UNIQUE (inspection_id, sequence)");
    expect(migration).toContain("PRIMARY KEY (run_id, parameter_code)");
    expect(migration).toContain("CHECK (sha256 ~ '^[a-f0-9]{64}$')");
    expect(migration).toContain("reject_immutable_domain_mutation");
    expect(migration).toContain("analysis_runs_sealed_immutable");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+organizations/i);
  });

  it("adds B05 identity, object scope, hashed sessions and append-only audit without seed credentials", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/003_identity_scope_audit.sql"), "utf8");
    const rollback = await readFile(resolve(projectRoot, "migrations/rollback/003_identity_scope_audit.sql"), "utf8");

    for (const table of [
      "inspector_users",
      "organization_memberships",
      "object_memberships",
      "user_sessions",
      "command_receipts",
      "audit_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    }

    expect(migration).toContain("token_hash CHAR(64)");
    expect(migration).toContain("csrf_hash CHAR(64)");
    expect(migration).toContain("num_nonnulls(actor_user_id, service_principal) = 1");
    expect(migration).toContain("audit_events_immutable");
    expect(migration).toContain("command_receipts_immutable");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+inspector_users/i);
  });

  it("adds B15 append-only protocol revocations with an immutable replacement link", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/004_protocol_revocations.sql"), "utf8");
    const rollback = await readFile(resolve(projectRoot, "migrations/rollback/004_protocol_revocations.sql"), "utf8");

    expect(migration).toContain("CREATE TABLE protocol_revocations");
    expect(migration).toContain("protocol_id UUID NOT NULL UNIQUE");
    expect(migration).toContain("replacement_protocol_id UUID NOT NULL");
    expect(migration).toContain("protocol_revocations_immutable");
    expect(migration).toContain("reject_immutable_domain_mutation");
    expect(migration).toContain("CHECK (protocol_id <> replacement_protocol_id)");
    expect(rollback).toContain("DROP TABLE IF EXISTS protocol_revocations");
  });

  it("adds immutable canonical JSON artifacts without mutating protocol snapshots", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/005_protocol_canonical_artifacts.sql"), "utf8");
    const rollback = await readFile(resolve(projectRoot, "migrations/rollback/005_protocol_canonical_artifacts.sql"), "utf8");

    expect(migration).toContain("CREATE TABLE protocol_artifacts");
    expect(migration).toContain("canonicalization_version = 'inspector-c14n-v1'");
    expect(migration).toContain("octet_length(content_bytes) = byte_size");
    expect(migration).toContain("protocol_artifacts_immutable");
    expect(migration).toContain("reject_immutable_domain_mutation");
    expect(rollback).toContain("DROP TABLE IF EXISTS protocol_artifacts");
  });

  it("adds durable jobs, fenced attempts and a transactional outbox", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/006_durable_jobs_outbox.sql"), "utf8");
    const rollback = await readFile(resolve(projectRoot, "migrations/rollback/006_durable_jobs_outbox.sql"), "utf8");

    for (const table of ["analysis_jobs", "job_attempts", "domain_outbox"]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
    expect(migration).toContain("fencing_token BIGINT NOT NULL");
    expect(migration).toContain("UNIQUE (job_id, fencing_token)");
    expect(migration).toContain("state TEXT NOT NULL DEFAULT 'PENDING'");
    expect(migration).toContain("domain_outbox_pending_idx");
  });

  it("records cancelled attempts separately from worker failures", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/007_job_attempt_cancellation.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/007_job_attempt_cancellation.sql"),
      "utf8",
    );

    expect(migration).toContain("'CANCELLED'");
    expect(migration).toContain("job_attempts_state_check");
    expect(rollback).toContain("Cannot rollback 007 while CANCELLED job attempts exist");
  });

  it("persists analysis job dependencies and blocked stages", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/008_analysis_job_dag.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/008_analysis_job_dag.sql"),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE analysis_job_dependencies");
    expect(migration).toContain("'ANALYSIS_INVENTORY'");
    expect(migration).toContain("'BLOCKED'");
    expect(migration).toContain("event_version BIGINT");
    expect(rollback).toContain("Cannot roll back 008 while persisted DAG data exists");
  });

  it("adds immutable bounded document text-layer artifacts", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/009_document_text_layer.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/009_document_text_layer.sql"),
      "utf8",
    );

    expect(migration).toContain("'DOCUMENT_TEXT_LAYER'");
    expect(migration).toContain("CREATE TABLE analysis_text_artifacts");
    expect(migration).toContain("byte_size <= 8388608");
    expect(migration).toContain("analysis_text_artifacts_immutable");
    expect(migration).toContain("reject_immutable_domain_mutation");
    expect(rollback).toContain("Cannot roll back 009 while document text-layer data exists");
  });

  it("expands text artifacts with deterministic page qualification", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/010_document_text_quality.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/010_document_text_quality.sql"),
      "utf8",
    );

    expect(migration).toContain("'document-text-v1', 'document-text-v2'");
    expect(migration).toContain("analysis_text_artifacts_schema_version_check");
    expect(rollback).toContain("Cannot roll back 010 while document-text-v2 artifacts exist");
  });

  it("adds the provider-neutral analysis DAG and immutable stage results", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/011_analysis_pipeline_scaffold.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/011_analysis_pipeline_scaffold.sql"),
      "utf8",
    );

    for (const jobType of [
      "DOCUMENT_RENDER",
      "DOCUMENT_OCR_LAYOUT",
      "DOCUMENT_METADATA",
      "DOCUMENT_LINKING",
      "ENTITY_EXTRACTION",
      "RULE_EVALUATION",
      "EVIDENCE_VALIDATION",
    ]) expect(migration).toContain(`'${jobType}'`);
    expect(migration).toContain("CREATE TABLE analysis_stage_artifacts");
    expect(migration).toContain("schema_version = 'analysis-stage-result-v1'");
    expect(migration).toContain("FOREIGN KEY (job_id, run_id, job_type)");
    expect(migration).toContain("analysis_stage_artifacts_immutable");
    expect(migration).toContain("reject_immutable_domain_mutation");
    expect(rollback).toContain("Cannot roll back 011 while pipeline scaffold data exists");
  });

  it("adds immutable analysis release manifests and binds runs and jobs to them", async () => {
    const migration = await readFile(resolve(projectRoot, "migrations/012_analysis_release_manifests.sql"), "utf8");
    const rollback = await readFile(
      resolve(projectRoot, "migrations/rollback/012_analysis_release_manifests.sql"),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE analysis_releases");
    expect(migration).toContain("analysis_releases_immutable");
    expect(migration).toContain("analysis_runs_release_fk");
    expect(migration).toContain("analysis_jobs_release_fk");
    expect(migration).toContain("analysis-release-legacy-v1");
    expect(migration).toContain("external_network_allowed BOOLEAN NOT NULL CHECK (NOT external_network_allowed)");
    expect(rollback).toContain("Cannot roll back 012 while non-legacy release manifests exist");
  });
});
