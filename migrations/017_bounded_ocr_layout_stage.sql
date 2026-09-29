-- Expand-only disposition for immutable, bounded OCR of OCR_REQUIRED pages.
-- Rollback reference: migrations/rollback/017_bounded_ocr_layout_stage.sql

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS', 'RULES_EVALUATED',
    'VISUAL_PROPOSAL_SCAN', 'OCR_LAYOUT_BOUNDED'
  ));
