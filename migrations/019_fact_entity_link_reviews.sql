-- Reviewer-authored fact links and immutable run snapshots.
-- Rollback reference: migrations/rollback/019_fact_entity_link_reviews.sql

CREATE TABLE fact_entity_link_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id),
  proposal_run_id UUID NOT NULL REFERENCES analysis_runs(id),
  proposal_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  proposal_content_hash CHAR(64) NOT NULL CHECK (proposal_content_hash ~ '^[a-f0-9]{64}$'),
  parameter_code TEXT NOT NULL,
  attribute TEXT NOT NULL,
  actual_stage TEXT NOT NULL CHECK (actual_stage IN ('RD', 'ID')),
  pd_source_file_id UUID NOT NULL,
  actual_source_file_id UUID NOT NULL,
  pd_source_review_id UUID NOT NULL,
  actual_source_review_id UUID NOT NULL,
  link_json JSONB NOT NULL CHECK (jsonb_typeof(link_json) = 'object'),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (pd_source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (actual_source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (pd_source_review_id, pd_source_file_id)
    REFERENCES source_review_decisions(id, source_file_id),
  FOREIGN KEY (actual_source_review_id, actual_source_file_id)
    REFERENCES source_review_decisions(id, source_file_id),
  UNIQUE (proposal_run_id, content_hash)
);

CREATE INDEX fact_entity_link_decisions_latest_idx
  ON fact_entity_link_decisions
  (object_id, parameter_code, attribute, actual_stage, created_at DESC, id DESC);

CREATE TRIGGER fact_entity_link_decisions_immutable
  BEFORE UPDATE OR DELETE ON fact_entity_link_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TABLE run_fact_entity_link_snapshots (
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  decision_id UUID NOT NULL REFERENCES fact_entity_link_decisions(id),
  decision_hash CHAR(64) NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (run_id, decision_id)
);

CREATE TRIGGER run_fact_entity_link_snapshots_immutable
  BEFORE UPDATE OR DELETE ON run_fact_entity_link_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
