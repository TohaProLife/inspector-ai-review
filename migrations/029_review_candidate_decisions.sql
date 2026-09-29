-- Inspector triage of run-local suggestions. No finding or coverage side effects.
CREATE TABLE review_candidate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id),
  run_id UUID NOT NULL,
  rule_stage_artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  rule_stage_hash CHAR(64) NOT NULL CHECK (rule_stage_hash ~ '^[a-f0-9]{64}$'),
  candidate_id CHAR(64) NOT NULL CHECK (candidate_id ~ '^[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('ACCEPT_FOR_REVIEW', 'REJECT')),
  note TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 8 AND 1000),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  decision_hash CHAR(64) NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  UNIQUE (run_id, decision_hash)
);
CREATE INDEX review_candidate_decisions_history_idx
  ON review_candidate_decisions (run_id, candidate_id, created_at DESC, id DESC);
CREATE TRIGGER review_candidate_decisions_immutable
  BEFORE UPDATE OR DELETE ON review_candidate_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
