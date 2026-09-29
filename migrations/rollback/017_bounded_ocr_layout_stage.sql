-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis_stage_artifacts
             WHERE disposition = 'OCR_LAYOUT_BOUNDED') THEN
    RAISE EXCEPTION 'Cannot roll back 017 while bounded OCR artifacts exist';
  END IF;
END $$;

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS', 'RULES_EVALUATED',
    'VISUAL_PROPOSAL_SCAN'
  ));
