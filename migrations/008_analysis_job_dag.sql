-- Forward-only expand migration for the persisted analysis job DAG.
-- Rollback reference: migrations/rollback/008_analysis_job_dag.sql

ALTER TABLE analysis_runs
  ADD COLUMN event_version BIGINT NOT NULL DEFAULT 0
  CHECK (event_version >= 0);

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN ('ANALYSIS_INVENTORY', 'ANALYSIS_SEAL_UNSUPPORTED'));

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_state_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_state_check
  CHECK (state IN (
    'BLOCKED', 'READY', 'LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED'
  ));

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_id_run_unique UNIQUE (id, run_id);

CREATE TABLE analysis_job_dependencies (
  job_id UUID NOT NULL,
  prerequisite_job_id UUID NOT NULL,
  run_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, prerequisite_job_id),
  FOREIGN KEY (job_id, run_id) REFERENCES analysis_jobs(id, run_id),
  FOREIGN KEY (prerequisite_job_id, run_id) REFERENCES analysis_jobs(id, run_id),
  CHECK (job_id <> prerequisite_job_id)
);

CREATE INDEX analysis_job_dependencies_prerequisite_idx
  ON analysis_job_dependencies (prerequisite_job_id, job_id);
