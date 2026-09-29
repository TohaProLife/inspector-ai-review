-- Freeze the latest verified human judgment per exact OCR pair subject in a later run.
-- An unavailable target fact keeps origin lineage but is never eligible for comparison.
-- Rollback reference: migrations/rollback/027_run_ocr_fact_pair_snapshots.sql
ALTER TABLE ocr_fact_pair_decisions
  ADD CONSTRAINT ocr_fact_pair_decisions_origin_key
  UNIQUE (id, run_id, object_id, pd_source_file_id, rd_source_file_id,
          pd_source_review_decision_id, rd_source_review_decision_id);

CREATE TABLE run_ocr_fact_pair_snapshots (
  run_id UUID NOT NULL,
  object_id UUID NOT NULL,
  subject_hash CHAR(64) NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  decision_id UUID NOT NULL,
  decision_content_hash CHAR(64) NOT NULL CHECK (decision_content_hash ~ '^[a-f0-9]{64}$'),
  origin_run_id UUID NOT NULL,
  pd_source_file_id UUID NOT NULL,
  rd_source_file_id UUID NOT NULL,
  pd_source_sha256 CHAR(64) NOT NULL CHECK (pd_source_sha256 ~ '^[a-f0-9]{64}$'),
  rd_source_sha256 CHAR(64) NOT NULL CHECK (rd_source_sha256 ~ '^[a-f0-9]{64}$'),
  pd_row_fingerprint CHAR(64) NOT NULL CHECK (pd_row_fingerprint ~ '^[a-f0-9]{64}$'),
  rd_row_fingerprint CHAR(64) NOT NULL CHECK (rd_row_fingerprint ~ '^[a-f0-9]{64}$'),
  pd_source_review_decision_id UUID NOT NULL,
  rd_source_review_decision_id UUID NOT NULL,
  target_artifact_hash CHAR(64) NOT NULL CHECK (target_artifact_hash ~ '^[a-f0-9]{64}$'),
  origin_review_json JSONB NOT NULL CHECK (jsonb_typeof(origin_review_json) = 'object'),
  target_review_json JSONB CHECK (
    target_review_json IS NULL OR jsonb_typeof(target_review_json) = 'object'),
  target_review_hash CHAR(64) CHECK (
    target_review_hash IS NULL OR target_review_hash ~ '^[a-f0-9]{64}$'),
  eligible_for_pair_review BOOLEAN NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('REBOUND', 'TARGET_FACT_UNAVAILABLE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, subject_hash),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (run_id) REFERENCES run_ocr_typed_fact_candidate_artifacts(run_id),
  FOREIGN KEY (decision_id, origin_run_id, object_id,
               pd_source_file_id, rd_source_file_id,
               pd_source_review_decision_id, rd_source_review_decision_id)
    REFERENCES ocr_fact_pair_decisions
      (id, run_id, object_id, pd_source_file_id, rd_source_file_id,
       pd_source_review_decision_id, rd_source_review_decision_id),
  CHECK (
    (reason_code = 'REBOUND' AND target_review_json IS NOT NULL
      AND target_review_hash IS NOT NULL)
    OR (reason_code = 'TARGET_FACT_UNAVAILABLE' AND target_review_json IS NULL
      AND target_review_hash IS NULL AND eligible_for_pair_review = false)
  )
);

CREATE INDEX run_ocr_fact_pair_snapshots_decision_idx
  ON run_ocr_fact_pair_snapshots (decision_id, run_id);

CREATE TRIGGER run_ocr_fact_pair_snapshots_immutable
  BEFORE UPDATE OR DELETE ON run_ocr_fact_pair_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
