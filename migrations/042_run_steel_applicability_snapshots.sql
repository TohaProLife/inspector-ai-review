-- V10 run-local immutable snapshot. No change to input manifest preimages.
CREATE TABLE run_steel_applicability_snapshot_states (
  run_id UUID PRIMARY KEY,
  object_id UUID NOT NULL,
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(snapshot_json)='object'
    AND snapshot_json->>'schemaVersion'='matrix-steel-applicability-run-snapshot-v1'),
  FOREIGN KEY (run_id,object_id) REFERENCES analysis_runs(id,object_id)
);
CREATE TABLE run_steel_applicability_snapshot_entries (
  run_id UUID NOT NULL REFERENCES run_steel_applicability_snapshot_states(run_id),
  pair_key CHAR(64) NOT NULL CHECK (pair_key ~ '^[a-f0-9]{64}$'),
  decision_id UUID NOT NULL REFERENCES matrix_steel_applicability_decisions(id),
  sequence_no BIGINT NOT NULL CHECK (sequence_no>0),
  journal_content_hash CHAR(64) NOT NULL CHECK (journal_content_hash ~ '^[a-f0-9]{64}$'),
  projection_content_hash CHAR(64) NOT NULL CHECK (projection_content_hash ~ '^[a-f0-9]{64}$'),
  included BOOLEAN NOT NULL,
  PRIMARY KEY (run_id,pair_key),
  UNIQUE (run_id,decision_id)
);
CREATE TRIGGER run_steel_applicability_snapshot_states_immutable
  BEFORE UPDATE OR DELETE ON run_steel_applicability_snapshot_states
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
CREATE TRIGGER run_steel_applicability_snapshot_entries_immutable
  BEFORE UPDATE OR DELETE ON run_steel_applicability_snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
