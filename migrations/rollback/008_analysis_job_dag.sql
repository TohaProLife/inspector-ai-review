-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis_job_dependencies)
     OR EXISTS (
       SELECT 1
       FROM analysis_jobs
       WHERE job_type = 'ANALYSIS_INVENTORY'
          OR state = 'BLOCKED'
     ) THEN
    RAISE EXCEPTION 'Cannot roll back 008 while persisted DAG data exists';
  END IF;
END $$;

DROP TABLE analysis_job_dependencies;

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_id_run_unique;

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN ('ANALYSIS_SEAL_UNSUPPORTED'));

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_state_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_state_check
  CHECK (state IN (
    'READY', 'LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED'
  ));

ALTER TABLE analysis_runs
  DROP COLUMN event_version;
