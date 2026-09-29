-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM analysis_text_artifacts
    WHERE schema_version = 'document-text-v2'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back 010 while document-text-v2 artifacts exist';
  END IF;
END $$;

ALTER TABLE analysis_text_artifacts
  DROP CONSTRAINT analysis_text_artifacts_schema_version_check;

ALTER TABLE analysis_text_artifacts
  ADD CONSTRAINT analysis_text_artifacts_schema_version_check
  CHECK (schema_version = 'document-text-v1');
