-- Destructive rollback reference. Do not run automatically.
-- Refuses rollback while cancellation history exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM job_attempts WHERE state = 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot rollback 007 while CANCELLED job attempts exist';
  END IF;
END
$$;

ALTER TABLE job_attempts
  DROP CONSTRAINT job_attempts_state_check;

ALTER TABLE job_attempts
  ADD CONSTRAINT job_attempts_state_check
  CHECK (state IN ('LEASED', 'SUCCEEDED', 'FAILED', 'EXPIRED'));
