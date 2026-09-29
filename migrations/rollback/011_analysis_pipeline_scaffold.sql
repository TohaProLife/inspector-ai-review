-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis_stage_artifacts)
     OR EXISTS (
       SELECT 1
       FROM analysis_jobs
       WHERE job_type IN (
         'DOCUMENT_RENDER',
         'DOCUMENT_OCR_LAYOUT',
         'DOCUMENT_METADATA',
         'DOCUMENT_LINKING',
         'ENTITY_EXTRACTION',
         'RULE_EVALUATION',
         'EVIDENCE_VALIDATION'
       )
     ) THEN
    RAISE EXCEPTION 'Cannot roll back 011 while pipeline scaffold data exists';
  END IF;
END $$;

DROP TRIGGER analysis_stage_artifacts_immutable ON analysis_stage_artifacts;
DROP TABLE analysis_stage_artifacts;

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_id_run_type_unique;

ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_job_type_check;

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_job_type_check
  CHECK (job_type IN (
    'ANALYSIS_INVENTORY', 'DOCUMENT_TEXT_LAYER', 'ANALYSIS_SEAL_UNSUPPORTED'
  ));
