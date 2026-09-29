-- Expand-only schema for bounded, append-only configured rule results.
-- Existing scaffold artifacts and UNSUPPORTED coverage remain valid.
-- Rollback reference: migrations/rollback/013_pilot_rule_results.sql

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_schema_version_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_schema_version_check
  CHECK (schema_version IN ('analysis-stage-result-v1', 'analysis-stage-result-v2'));

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_disposition_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_disposition_check
  CHECK (disposition IN (
    'PROVIDER_NOT_CONFIGURED', 'POLICY_NOT_CONFIGURED',
    'UNSUPPORTED_RULESET', 'NO_MACHINE_RESULTS', 'RULES_EVALUATED'
  ));

ALTER TABLE analysis_stage_artifacts
  DROP CONSTRAINT analysis_stage_artifacts_byte_size_check;
ALTER TABLE analysis_stage_artifacts
  ADD CONSTRAINT analysis_stage_artifacts_byte_size_check
  CHECK (byte_size > 0 AND byte_size <= 8388608);

ALTER TABLE parameter_coverage
  DROP CONSTRAINT parameter_coverage_execution_rollup_check;
ALTER TABLE parameter_coverage
  ADD CONSTRAINT parameter_coverage_execution_rollup_check
  CHECK (execution_rollup IN ('UNSUPPORTED', 'PARTIAL'));
