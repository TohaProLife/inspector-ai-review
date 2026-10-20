-- Explicit large v3 source audit; NULL rows retain the historical 8 MiB ceiling.
-- No defaults, backfill, rewrite or change to historical migration checksums.
ALTER TABLE analysis_text_artifacts ADD COLUMN resource_policy_version TEXT NULL;
ALTER TABLE analysis_text_artifacts DROP CONSTRAINT analysis_text_artifacts_byte_size_check;
ALTER TABLE analysis_text_artifacts ADD CONSTRAINT analysis_text_artifacts_byte_size_check
  CHECK (byte_size > 0 AND CASE WHEN resource_policy_version IS NULL
    THEN byte_size <= 8388608
    ELSE resource_policy_version = 'document-text-v3-large-source-bounds-v1'
      AND schema_version = 'document-text-v3' AND byte_size <= 32000000
    END);
