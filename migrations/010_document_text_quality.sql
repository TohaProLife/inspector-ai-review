-- Expand accepted immutable document text artifacts with deterministic page qualification.
-- Existing document-text-v1 rows remain valid and unchanged.
-- Rollback reference: migrations/rollback/010_document_text_quality.sql

ALTER TABLE analysis_text_artifacts
  DROP CONSTRAINT analysis_text_artifacts_schema_version_check;

ALTER TABLE analysis_text_artifacts
  ADD CONSTRAINT analysis_text_artifacts_schema_version_check
  CHECK (schema_version IN ('document-text-v1', 'document-text-v2'));
