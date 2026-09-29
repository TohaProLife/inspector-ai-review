-- Append-only human judgment about an exact pair of verified OCR_ROW fact candidates.
-- A confirmed pair is still review-only; no comparison, finding, or coverage is written.
-- Rollback reference: migrations/rollback/026_ocr_fact_pair_reviews.sql
CREATE TABLE ocr_fact_pair_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL,
  run_id UUID NOT NULL,
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  artifact_hash CHAR(64) NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  parameter_code TEXT NOT NULL,
  attribute TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  pd_fact_id CHAR(64) NOT NULL CHECK (pd_fact_id ~ '^[a-f0-9]{64}$'),
  rd_fact_id CHAR(64) NOT NULL CHECK (rd_fact_id ~ '^[a-f0-9]{64}$'),
  pd_locator_hash CHAR(64) NOT NULL CHECK (pd_locator_hash ~ '^[a-f0-9]{64}$'),
  rd_locator_hash CHAR(64) NOT NULL CHECK (rd_locator_hash ~ '^[a-f0-9]{64}$'),
  pd_source_file_id UUID NOT NULL,
  rd_source_file_id UUID NOT NULL,
  pd_source_review_decision_id UUID NOT NULL,
  rd_source_review_decision_id UUID NOT NULL,
  review_json JSONB NOT NULL CHECK (jsonb_typeof(review_json) = 'object'),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  FOREIGN KEY (run_id) REFERENCES run_ocr_typed_fact_candidate_artifacts(run_id),
  FOREIGN KEY (pd_source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (rd_source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (run_id, pd_source_file_id, pd_source_review_decision_id)
    REFERENCES run_source_review_snapshots(run_id, source_file_id, decision_id),
  FOREIGN KEY (run_id, rd_source_file_id, rd_source_review_decision_id)
    REFERENCES run_source_review_snapshots(run_id, source_file_id, decision_id),
  CHECK (pd_source_file_id <> rd_source_file_id),
  CHECK (pd_fact_id <> rd_fact_id),
  UNIQUE (run_id, content_hash)
);

CREATE INDEX ocr_fact_pair_decisions_history_idx
  ON ocr_fact_pair_decisions
    (run_id, parameter_code, attribute, entity_key, pd_fact_id, rd_fact_id,
     created_at DESC, id DESC);

CREATE TRIGGER ocr_fact_pair_decisions_immutable
  BEFORE UPDATE OR DELETE ON ocr_fact_pair_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
