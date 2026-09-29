-- Append-only human quantity-comparability judgment for an exact immutable
-- next-run OCR_ROW pair snapshot. No comparison, finding, or coverage is written.
-- Rollback reference: migrations/rollback/028_ocr_fact_pair_quantity_reviews.sql
ALTER TABLE run_ocr_fact_pair_snapshots
  ADD CONSTRAINT run_ocr_fact_pair_snapshots_quantity_key
  UNIQUE (run_id, decision_id, subject_hash, target_review_hash);

CREATE TABLE ocr_fact_pair_quantity_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL,
  run_id UUID NOT NULL,
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  artifact_hash CHAR(64) NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  pair_decision_id UUID NOT NULL,
  pair_subject_hash CHAR(64) NOT NULL CHECK (pair_subject_hash ~ '^[a-f0-9]{64}$'),
  target_review_hash CHAR(64) NOT NULL CHECK (target_review_hash ~ '^[a-f0-9]{64}$'),
  pd_fact_id CHAR(64) NOT NULL CHECK (pd_fact_id ~ '^[a-f0-9]{64}$'),
  rd_fact_id CHAR(64) NOT NULL CHECK (rd_fact_id ~ '^[a-f0-9]{64}$'),
  pd_locator_hash CHAR(64) NOT NULL CHECK (pd_locator_hash ~ '^[a-f0-9]{64}$'),
  rd_locator_hash CHAR(64) NOT NULL CHECK (rd_locator_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash CHAR(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (run_id) REFERENCES run_ocr_typed_fact_candidate_artifacts(run_id),
  FOREIGN KEY (run_id, pair_decision_id, pair_subject_hash, target_review_hash)
    REFERENCES run_ocr_fact_pair_snapshots
      (run_id, decision_id, subject_hash, target_review_hash),
  UNIQUE (run_id, content_hash)
);

CREATE INDEX ocr_fact_pair_quantity_decisions_history_idx
  ON ocr_fact_pair_quantity_decisions
    (run_id, pair_decision_id, created_at DESC, id DESC);

CREATE TRIGGER ocr_fact_pair_quantity_decisions_immutable
  BEFORE UPDATE OR DELETE ON ocr_fact_pair_quantity_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
