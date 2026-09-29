-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM analysis_stage_artifacts
    WHERE disposition = 'VISUAL_PROPOSAL_SCAN'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back 015 while visual proposal artifacts exist';
  END IF;
END $$;

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS', 'RULES_EVALUATED'
  ));
