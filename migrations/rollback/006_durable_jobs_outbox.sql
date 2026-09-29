-- Destructive rollback reference. Do not run automatically.
DROP TABLE IF EXISTS domain_outbox;
DROP TABLE IF EXISTS job_attempts;
DROP TABLE IF EXISTS analysis_jobs;
