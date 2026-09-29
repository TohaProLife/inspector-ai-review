-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis_text_artifacts)
     OR EXISTS (SELECT 1 FROM analysis_jobs WHERE job_type = 'DOCUMENT_TEXT_LAYER') THEN
    RAISE EXCEPTION 'Cannot roll back 009 while document text-layer data exists';
  END IF;
END $$;

DROP TRIGGER analysis_text_artifacts_immutable ON analysis_text_artifacts;
DROP TABLE analysis_text_artifacts;

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN ('ANALYSIS_INVENTORY', 'ANALYSIS_SEAL_UNSUPPORTED'));
