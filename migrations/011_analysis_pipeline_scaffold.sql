-- Forward-only expand migration for the provider-neutral analysis pipeline scaffold.
-- Rollback reference: migrations/rollback/011_analysis_pipeline_scaffold.sql

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN (
    'ANALYSIS_INVENTORY',
    'DOCUMENT_TEXT_LAYER',
    'DOCUMENT_RENDER',
    'DOCUMENT_OCR_LAYOUT',
    'DOCUMENT_METADATA',
    'DOCUMENT_LINKING',
    'ENTITY_EXTRACTION',
    'RULE_EVALUATION',
    'EVIDENCE_VALIDATION',
    'ANALYSIS_SEAL_UNSUPPORTED'
  ));

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_id_run_type_unique UNIQUE (id, run_id, job_type);

CREATE TABLE analysis_stage_artifacts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL,
  run_id UUID NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'DOCUMENT_RENDER',
    'DOCUMENT_OCR_LAYOUT',
    'DOCUMENT_METADATA',
    'DOCUMENT_LINKING',
    'ENTITY_EXTRACTION',
    'RULE_EVALUATION',
    'EVIDENCE_VALIDATION'
  )),
  schema_version TEXT NOT NULL CHECK (schema_version = 'analysis-stage-result-v1'),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED',
    'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET',
    'NO_MACHINE_RESULTS'
  )),
  reason_code TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  provider_profile_id TEXT,
  provider_config_hash CHAR(64),
  output_count INTEGER NOT NULL CHECK (output_count >= 0),
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 65536),
  content_json JSONB NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, run_id, job_type) REFERENCES analysis_jobs(id, run_id, job_type),
  CHECK (
    (provider_profile_id IS NULL AND provider_config_hash IS NULL)
    OR (provider_profile_id IS NOT NULL AND provider_config_hash ~ '^[a-f0-9]{64}$')
  ),
  UNIQUE (job_id),
  UNIQUE (run_id, job_type)
);

CREATE TRIGGER analysis_stage_artifacts_immutable
  BEFORE UPDATE OR DELETE ON analysis_stage_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX analysis_stage_artifacts_run_stage_idx
  ON analysis_stage_artifacts (run_id, job_type, created_at, id);
