-- Forward migration. Apply through the deployment migration gate; do not edit after deployment.
-- Rollback reference: migrations/rollback/002_domain_core.sql

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  api_id TEXT NOT NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  display_status TEXT NOT NULL CHECK (display_status IN (
    'DRAFT', 'UPLOADING', 'VALIDATING', 'PROCESSING', 'PARTIAL',
    'REVIEW_REQUIRED', 'CLARIFICATION_REQUIRED', 'READY_TO_FINALIZE', 'FINALIZED', 'FAILED'
  )),
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  stats JSONB NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, api_id),
  UNIQUE (organization_id, external_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  object_id UUID NOT NULL UNIQUE,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('OPEN', 'FINALIZED')),
  mode TEXT NOT NULL CHECK (mode IN ('NORMAL', 'DEMO_SEED')),
  active_run_id UUID,
  working_manifest_id UUID,
  row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (object_id, organization_id) REFERENCES objects(id, organization_id),
  UNIQUE (id, object_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS object_stage_summaries (
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('PD', 'RD', 'ID', 'RD_ID_MIXED', 'UNKNOWN')),
  file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  completeness TEXT NOT NULL CHECK (completeness IN ('COMPLETE', 'MISSING', 'MIXED', 'UNKNOWN')),
  PRIMARY KEY (object_id, stage)
);

CREATE TABLE IF NOT EXISTS blobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  storage_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status IN ('CLEAN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (object_id, sha256),
  UNIQUE (id, object_id)
);

CREATE TABLE IF NOT EXISTS source_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  object_id UUID NOT NULL REFERENCES objects(id),
  blob_id UUID NOT NULL,
  canonical_name TEXT NOT NULL,
  original_format TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (blob_id, object_id) REFERENCES blobs(id, object_id),
  UNIQUE (id, object_id),
  UNIQUE (object_id, blob_id)
);

CREATE TABLE IF NOT EXISTS source_file_stages (
  source_file_id UUID NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('PD', 'RD', 'ID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file_id, stage)
);

CREATE TABLE IF NOT EXISTS upload_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  object_id UUID NOT NULL REFERENCES objects(id),
  state TEXT NOT NULL CHECK (state IN ('COMMITTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, object_id)
);

CREATE TABLE IF NOT EXISTS upload_receipt_files (
  receipt_id UUID NOT NULL,
  object_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  api_file_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  supplied_stage TEXT NOT NULL CHECK (supplied_stage IN ('PD', 'RD', 'ID')),
  ingest_status TEXT NOT NULL CHECK (ingest_status IN ('STORED', 'DUPLICATE')),
  PRIMARY KEY (receipt_id, api_file_id),
  UNIQUE (receipt_id, ordinal),
  FOREIGN KEY (receipt_id, object_id) REFERENCES upload_receipts(id, object_id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id)
);

CREATE TABLE IF NOT EXISTS input_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  canonical_json JSONB NOT NULL CHECK (jsonb_typeof(canonical_json) = 'object'),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  parent_id UUID REFERENCES input_manifests(id),
  dataset_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, sequence),
  UNIQUE (inspection_id, sha256),
  UNIQUE (id, inspection_id)
);

CREATE TABLE IF NOT EXISTS manifest_items (
  manifest_id UUID NOT NULL REFERENCES input_manifests(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  blob_sha256 CHAR(64) NOT NULL CHECK (blob_sha256 ~ '^[a-f0-9]{64}$'),
  inclusion_role TEXT NOT NULL CHECK (inclusion_role IN ('SOURCE')),
  PRIMARY KEY (manifest_id, source_file_id)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  inspection_id UUID NOT NULL,
  object_id UUID NOT NULL,
  manifest_id UUID NOT NULL,
  release_id TEXT NOT NULL,
  run_state TEXT NOT NULL CHECK (run_state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  display_status TEXT NOT NULL CHECK (display_status IN (
    'PROCESSING', 'PARTIAL', 'REVIEW_REQUIRED', 'CLARIFICATION_REQUIRED',
    'READY_TO_FINALIZE', 'FINALIZED', 'FAILED'
  )),
  mode TEXT NOT NULL CHECK (mode IN ('NORMAL', 'DEMO_SEED')),
  progress SMALLINT NOT NULL CHECK (progress BETWEEN 0 AND 100),
  current_stage TEXT NOT NULL,
  model_version TEXT,
  rules_version TEXT NOT NULL,
  stats JSONB NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  output_hash CHAR(64) CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  supersedes_run_id UUID REFERENCES analysis_runs(id),
  FOREIGN KEY (inspection_id, object_id) REFERENCES inspections(id, object_id),
  FOREIGN KEY (manifest_id, inspection_id) REFERENCES input_manifests(id, inspection_id),
  UNIQUE (id, inspection_id),
  UNIQUE (id, object_id)
);

ALTER TABLE inspections
  ADD CONSTRAINT inspections_active_run_fk
  FOREIGN KEY (active_run_id, id) REFERENCES analysis_runs(id, inspection_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE inspections
  ADD CONSTRAINT inspections_working_manifest_fk
  FOREIGN KEY (working_manifest_id, id) REFERENCES input_manifests(id, inspection_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS parameter_coverage (
  run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  parameter_id INTEGER NOT NULL,
  parameter_code TEXT NOT NULL,
  parameter_name TEXT NOT NULL,
  execution_rollup TEXT NOT NULL CHECK (execution_rollup IN ('UNSUPPORTED')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, parameter_code),
  UNIQUE (run_id, parameter_id)
);

CREATE TABLE IF NOT EXISTS rule_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  rule_key TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  parameter_code TEXT,
  entity_key JSONB NOT NULL CHECK (jsonb_typeof(entity_key) = 'object'),
  comparison_variant TEXT NOT NULL DEFAULT 'DEFAULT',
  execution_status TEXT NOT NULL CHECK (execution_status IN (
    'NOT_RUN', 'RUNNING', 'SUCCEEDED', 'UNSUPPORTED', 'FAILED', 'CANCELLED'
  )),
  machine_status TEXT CHECK (machine_status IS NULL OR machine_status IN (
    'CANDIDATE', 'NEGATIVE_VERIFIED', 'MISSING_EVIDENCE', 'NOT_APPLICABLE',
    'NOT_COMPARABLE', 'CLARIFICATION_REQUIRED', 'SUSPICION'
  )),
  result_payload JSONB NOT NULL CHECK (jsonb_typeof(result_payload) = 'object'),
  evidence_fingerprint CHAR(64) CHECK (evidence_fingerprint IS NULL OR evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, run_id),
  UNIQUE (run_id, rule_key, rule_version, entity_key, comparison_variant)
);

CREATE TABLE IF NOT EXISTS review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  inspection_id UUID NOT NULL REFERENCES inspections(id),
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  result_id UUID NOT NULL REFERENCES rule_results(id),
  origin TEXT NOT NULL CHECK (origin IN ('MACHINE', 'HUMAN_SPLIT', 'HUMAN_PROMOTION')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'SUPERSEDED')),
  projection_status TEXT NOT NULL CHECK (projection_status IN (
    'PENDING', 'CONFIRMED_VIOLATION', 'NEGATIVE_VERIFIED', 'CLARIFICATION_REQUIRED', 'SUPERSEDED'
  )),
  evidence_fingerprint CHAR(64) NOT NULL CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, inspection_id) REFERENCES analysis_runs(id, inspection_id),
  FOREIGN KEY (result_id, run_id) REFERENCES rule_results(id, run_id),
  UNIQUE (result_id)
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_item_id UUID NOT NULL REFERENCES review_items(id),
  action TEXT NOT NULL CHECK (action IN ('CONFIRM', 'REJECT', 'CLARIFY', 'VERIFY_NEGATIVE')),
  reason_code TEXT NOT NULL,
  comment TEXT,
  actor_id TEXT NOT NULL,
  supersedes_decision_id UUID REFERENCES review_decisions(id),
  evidence_fingerprint CHAR(64) NOT NULL CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspection_protocol_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  inspection_id UUID NOT NULL REFERENCES inspections(id),
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('DRAFT', 'FINAL')),
  snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  snapshot_hash CHAR(64) NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  decision_set_hash CHAR(64) NOT NULL CHECK (decision_set_hash ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  FOREIGN KEY (run_id, inspection_id) REFERENCES analysis_runs(id, inspection_id),
  UNIQUE (inspection_id, version)
);

CREATE OR REPLACE FUNCTION reject_immutable_domain_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION reject_sealed_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'sealed analysis run is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blobs_immutable
  BEFORE UPDATE OR DELETE ON blobs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER source_files_immutable
  BEFORE UPDATE OR DELETE ON source_files
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER input_manifests_immutable
  BEFORE UPDATE OR DELETE ON input_manifests
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER manifest_items_immutable
  BEFORE UPDATE OR DELETE ON manifest_items
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER analysis_runs_sealed_immutable
  BEFORE UPDATE OR DELETE ON analysis_runs
  FOR EACH ROW EXECUTE FUNCTION reject_sealed_run_mutation();

CREATE TRIGGER rule_results_immutable
  BEFORE UPDATE OR DELETE ON rule_results
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER review_decisions_immutable
  BEFORE UPDATE OR DELETE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER inspection_protocol_versions_immutable
  BEFORE UPDATE OR DELETE ON inspection_protocol_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX objects_organization_created_idx ON objects (organization_id, created_at, id);
CREATE INDEX source_files_object_registered_idx ON source_files (object_id, registered_at, id);
CREATE INDEX upload_receipts_object_created_idx ON upload_receipts (object_id, created_at, id);
CREATE INDEX analysis_runs_inspection_started_idx ON analysis_runs (inspection_id, started_at, id);
CREATE INDEX analysis_runs_state_started_idx ON analysis_runs (run_state, started_at, id);
CREATE INDEX parameter_coverage_run_rollup_idx ON parameter_coverage (run_id, execution_rollup);
CREATE INDEX rule_results_run_status_idx ON rule_results (run_id, execution_status, machine_status);
CREATE INDEX review_items_inspection_status_idx ON review_items (inspection_id, projection_status, created_at, id);
CREATE INDEX review_decisions_item_created_idx ON review_decisions (review_item_id, created_at, id);
CREATE INDEX protocol_versions_inspection_created_idx ON inspection_protocol_versions (inspection_id, created_at, id);
