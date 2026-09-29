-- Immutable, review-only OCR_ROW typed fact projection from frozen run decisions.
-- It never writes findings, comparisons, or coverage.
-- Rollback reference: migrations/rollback/025_run_ocr_typed_fact_candidate_artifacts.sql
CREATE TABLE run_ocr_typed_fact_candidate_artifacts (
  run_id UUID PRIMARY KEY,
  object_id UUID NOT NULL,
  release_id TEXT NOT NULL,
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'ocr-typed-fact-candidates-v1'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  fact_count INTEGER NOT NULL CHECK (fact_count >= 0),
  snapshot_count INTEGER NOT NULL CHECK (snapshot_count >= fact_count),
  content_json JSONB NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (release_id) REFERENCES analysis_releases(release_id)
);

CREATE TRIGGER run_ocr_typed_fact_candidate_artifacts_immutable
  BEFORE UPDATE OR DELETE ON run_ocr_typed_fact_candidate_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
