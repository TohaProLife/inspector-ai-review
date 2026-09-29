-- Expand the append-only stage disposition set for proposal-only vector scans.
-- Rollback reference: migrations/rollback/015_visual_proposal_stage.sql

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS', 'RULES_EVALUATED',
    'VISUAL_PROPOSAL_SCAN'
  ));
