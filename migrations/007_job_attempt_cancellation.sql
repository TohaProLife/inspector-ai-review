-- Forward-only expand migration for explicit worker-attempt cancellation.
-- Rollback reference: migrations/rollback/007_job_attempt_cancellation.sql

ALTER TABLE job_attempts
  DROP CONSTRAINT job_attempts_state_check;

ALTER TABLE job_attempts
  ADD CONSTRAINT job_attempts_state_check
  CHECK (state IN ('LEASED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'));
