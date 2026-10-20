-- Expand coverage; preserve historical pilot rows and their interpretation.
ALTER TABLE parameter_coverage DROP CONSTRAINT parameter_coverage_execution_rollup_check;
ALTER TABLE parameter_coverage ADD CONSTRAINT parameter_coverage_execution_rollup_check
  CHECK (execution_rollup IN ('UNSUPPORTED', 'PARTIAL', 'PENDING', 'EVALUATED', 'TECHNICAL_FAILURE'));
ALTER TABLE parameter_coverage ADD COLUMN atomic_summary jsonb;

CREATE TABLE machine_prediction_snapshots (
  run_id uuid PRIMARY KEY REFERENCES analysis_runs(id),
  schema_version text NOT NULL CHECK (schema_version = 'machine-predictions-v1'),
  execution_hash char(64) NOT NULL CHECK (execution_hash ~ '^[a-f0-9]{64}$'),
  submission_hash char(64) NOT NULL CHECK (submission_hash ~ '^[a-f0-9]{64}$'),
  submission_bytes bytea NOT NULL CHECK (octet_length(submission_bytes) <= 8388608),
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER machine_prediction_snapshots_immutable
  BEFORE UPDATE OR DELETE ON machine_prediction_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
