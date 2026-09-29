-- Reviewer transcriptions of OCR table rows are append-only evidence annotations.
-- They do not establish a parameter fact, source approval, or finding.
-- Rollback reference: migrations/rollback/020_ocr_row_transcription_reviews.sql

CREATE TABLE ocr_row_transcription_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id),
  run_id UUID NOT NULL,
  ocr_stage_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  rule_stage_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  row_fingerprint_sha256 CHAR(64) NOT NULL CHECK (row_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  UNIQUE (run_id, content_hash)
);

CREATE INDEX ocr_row_transcription_decisions_history_idx
  ON ocr_row_transcription_decisions
  (run_id, row_fingerprint_sha256, created_at DESC, id DESC);

CREATE TRIGGER ocr_row_transcription_decisions_immutable
  BEFORE UPDATE OR DELETE ON ocr_row_transcription_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
