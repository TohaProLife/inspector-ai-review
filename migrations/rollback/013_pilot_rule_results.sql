-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM analysis_stage_artifacts
    WHERE schema_version = 'analysis-stage-result-v2'
  ) OR EXISTS (
    SELECT 1 FROM parameter_coverage WHERE execution_rollup = 'PARTIAL'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back 013 while pilot rule artifacts or partial coverage exist';
  END IF;
END $$;

ALTER TABLE analysis_stage_artifacts DROP CONSTRAINT analysis_stage_artifacts_schema_version_check;
ALTER TABLE analysis_stage_artifacts ADD CONSTRAINT analysis_stage_artifacts_schema_version_check
  CHECK (schema_version = 'analysis-stage-result-v1');
ALTER TABLE analysis_stage_artifacts DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS'
  ));
ALTER TABLE analysis_stage_artifacts DROP CONSTRAINT analysis_stage_artifacts_byte_size_check;
ALTER TABLE analysis_stage_artifacts ADD CONSTRAINT analysis_stage_artifacts_byte_size_check
  CHECK (byte_size > 0 AND byte_size <= 65536);
ALTER TABLE parameter_coverage DROP CONSTRAINT parameter_coverage_execution_rollup_check;
ALTER TABLE parameter_coverage ADD CONSTRAINT parameter_coverage_execution_rollup_check
  CHECK (execution_rollup IN ('UNSUPPORTED'));
