-- Refuse rollback once any new-policy immutable artifact exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM analysis_text_artifacts WHERE resource_policy_version IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot roll back large source audit while marked artifacts exist';
  END IF;
END $$;
ALTER TABLE analysis_text_artifacts DROP CONSTRAINT analysis_text_artifacts_byte_size_check;
ALTER TABLE analysis_text_artifacts DROP COLUMN resource_policy_version;
ALTER TABLE analysis_text_artifacts ADD CONSTRAINT analysis_text_artifacts_byte_size_check
  CHECK (byte_size > 0 AND byte_size <= 8388608);
