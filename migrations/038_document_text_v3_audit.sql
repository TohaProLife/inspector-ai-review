-- Forward-only expand: immutable historical v1/v2 bytes and constraints remain valid.
-- text_page_count maps explicitly to locatedTextPageCount for document-text-v3.
-- content_hash retains SHA256 of canonical artifact bytes, not its semantic domain hash.
ALTER TABLE analysis_text_artifacts
  DROP CONSTRAINT analysis_text_artifacts_schema_version_check;

ALTER TABLE analysis_text_artifacts
  ADD CONSTRAINT analysis_text_artifacts_schema_version_check
  CHECK (schema_version IN ('document-text-v1', 'document-text-v2', 'document-text-v3'));
