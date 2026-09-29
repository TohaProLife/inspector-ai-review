-- Forward-only expand migration for bounded immutable PDF text-layer artifacts.
-- Rollback reference: migrations/rollback/009_document_text_layer.sql

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN (
    'ANALYSIS_INVENTORY', 'DOCUMENT_TEXT_LAYER', 'ANALYSIS_SEAL_UNSUPPORTED'
  ));

CREATE TABLE analysis_text_artifacts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL,
  run_id UUID NOT NULL,
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'document-text-v1'),
  input_sha256 CHAR(64) NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  text_page_count INTEGER NOT NULL CHECK (text_page_count BETWEEN 0 AND page_count),
  content_json JSONB NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, run_id) REFERENCES analysis_jobs(id, run_id),
  UNIQUE (run_id, source_file_id, schema_version)
);

CREATE TRIGGER analysis_text_artifacts_immutable
  BEFORE UPDATE OR DELETE ON analysis_text_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX analysis_text_artifacts_run_source_idx
  ON analysis_text_artifacts (run_id, source_file_id, created_at, id);
