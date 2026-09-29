-- Snapshot the latest reviewer transcription for a source row into the next run.
-- A transcription is not a parameter fact, source approval, or finding.
-- Rollback reference: migrations/rollback/021_run_ocr_transcription_snapshots.sql

-- The composite key makes the origin run, object, and source of a decision
-- enforceable by the snapshot FK, rather than trusting copied UUID columns.
ALTER TABLE ocr_row_transcription_decisions
  ADD CONSTRAINT ocr_row_transcription_decisions_origin_key
  UNIQUE (id, run_id, source_file_id, object_id);

CREATE TABLE run_ocr_transcription_snapshots (
  run_id UUID NOT NULL,
  object_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  row_fingerprint_sha256 CHAR(64) NOT NULL CHECK (row_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  decision_id UUID NOT NULL,
  decision_content_hash CHAR(64) NOT NULL CHECK (decision_content_hash ~ '^[a-f0-9]{64}$'),
  origin_run_id UUID NOT NULL,
  ocr_stage_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  rule_stage_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, source_file_id, row_fingerprint_sha256),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (origin_run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (decision_id, origin_run_id, source_file_id, object_id)
    REFERENCES ocr_row_transcription_decisions(id, run_id, source_file_id, object_id)
);

CREATE INDEX run_ocr_transcription_snapshots_history_idx
  ON run_ocr_transcription_snapshots
  (source_file_id, row_fingerprint_sha256, run_id);

CREATE TRIGGER run_ocr_transcription_snapshots_immutable
  BEFORE UPDATE OR DELETE ON run_ocr_transcription_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
