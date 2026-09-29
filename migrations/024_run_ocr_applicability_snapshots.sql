-- Carry the latest verified subject judgment into a later immutable run.
-- Snapshot is a review decision, not a typed fact, comparison, or finding.
-- Rollback reference: migrations/rollback/024_run_ocr_applicability_snapshots.sql

ALTER TABLE ocr_row_applicability_decisions
  ADD CONSTRAINT ocr_row_applicability_decisions_origin_key
  UNIQUE (id, run_id, object_id, source_file_id,
          transcription_decision_id, source_review_decision_id);

CREATE TABLE run_ocr_applicability_snapshots (
  run_id UUID NOT NULL,
  object_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  row_fingerprint_sha256 CHAR(64) NOT NULL CHECK (row_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  parameter_code TEXT NOT NULL,
  attribute TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('PD', 'RD')),
  entity_key TEXT NOT NULL,
  decision_id UUID NOT NULL,
  decision_content_hash CHAR(64) NOT NULL CHECK (decision_content_hash ~ '^[a-f0-9]{64}$'),
  origin_run_id UUID NOT NULL,
  transcription_decision_id UUID NOT NULL,
  source_review_decision_id UUID NOT NULL,
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  eligible_for_fact_review BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, source_file_id, row_fingerprint_sha256,
               parameter_code, attribute, stage, entity_key),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (decision_id, origin_run_id, object_id, source_file_id,
               transcription_decision_id, source_review_decision_id)
    REFERENCES ocr_row_applicability_decisions
      (id, run_id, object_id, source_file_id,
       transcription_decision_id, source_review_decision_id),
  FOREIGN KEY (run_id, source_file_id, row_fingerprint_sha256,
               transcription_decision_id)
    REFERENCES run_ocr_transcription_snapshots
      (run_id, source_file_id, row_fingerprint_sha256, decision_id),
  FOREIGN KEY (run_id, source_file_id, source_review_decision_id)
    REFERENCES run_source_review_snapshots (run_id, source_file_id, decision_id)
);

CREATE INDEX run_ocr_applicability_snapshots_decision_idx
  ON run_ocr_applicability_snapshots (decision_id, run_id);

CREATE TRIGGER run_ocr_applicability_snapshots_immutable
  BEFORE UPDATE OR DELETE ON run_ocr_applicability_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
