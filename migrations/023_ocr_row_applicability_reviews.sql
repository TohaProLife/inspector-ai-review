-- Append-only judgment about the subject applicability of a verified OCR row.
-- Neither this decision nor its transcription establishes a comparison or finding.
-- Rollback reference: migrations/rollback/023_ocr_row_applicability_reviews.sql

ALTER TABLE run_ocr_transcription_snapshots
  ADD CONSTRAINT run_ocr_transcription_snapshots_decision_key
  UNIQUE (run_id, source_file_id, row_fingerprint_sha256, decision_id);

ALTER TABLE run_source_review_snapshots
  ADD CONSTRAINT run_source_review_snapshots_decision_key
  UNIQUE (run_id, source_file_id, decision_id);

CREATE TABLE ocr_row_applicability_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL,
  run_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  row_fingerprint_sha256 CHAR(64) NOT NULL CHECK (row_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  transcription_decision_id UUID NOT NULL,
  source_review_decision_id UUID NOT NULL,
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (run_id, source_file_id, row_fingerprint_sha256, transcription_decision_id)
    REFERENCES run_ocr_transcription_snapshots
      (run_id, source_file_id, row_fingerprint_sha256, decision_id),
  FOREIGN KEY (run_id, source_file_id, source_review_decision_id)
    REFERENCES run_source_review_snapshots (run_id, source_file_id, decision_id),
  UNIQUE (run_id, content_hash)
);

CREATE INDEX ocr_row_applicability_decisions_history_idx
  ON ocr_row_applicability_decisions
    (run_id, source_file_id, row_fingerprint_sha256, created_at DESC, id DESC);

CREATE TRIGGER ocr_row_applicability_decisions_immutable
  BEFORE UPDATE OR DELETE ON ocr_row_applicability_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
