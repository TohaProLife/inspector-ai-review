-- Additive full-source audit only. Historical v1/v2/v3 rows and ceilings unchanged.
ALTER TABLE analysis_text_artifacts DROP CONSTRAINT analysis_text_artifacts_schema_version_check;
ALTER TABLE analysis_text_artifacts ADD CONSTRAINT analysis_text_artifacts_schema_version_check
  CHECK (schema_version IN ('document-text-v1','document-text-v2','document-text-v3','document-text-v4'));
ALTER TABLE analysis_text_artifacts DROP CONSTRAINT analysis_text_artifacts_byte_size_check;
ALTER TABLE analysis_text_artifacts ADD CONSTRAINT analysis_text_artifacts_byte_size_check
  CHECK (byte_size > 0 AND CASE
    WHEN resource_policy_version IS NULL
      THEN schema_version <> 'document-text-v4' AND byte_size <= 8388608
    WHEN resource_policy_version = 'document-text-v3-large-source-bounds-v1'
      THEN schema_version = 'document-text-v3' AND byte_size <= 32000000
    WHEN resource_policy_version = 'document-text-v4-full-source-bounds-v1'
      THEN schema_version = 'document-text-v4' AND byte_size <= 32000000
    ELSE false END);
