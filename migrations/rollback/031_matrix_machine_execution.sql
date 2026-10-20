DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM machine_prediction_snapshots)
    OR EXISTS (SELECT 1 FROM parameter_coverage WHERE atomic_summary IS NOT NULL
      OR execution_rollup NOT IN ('UNSUPPORTED', 'PARTIAL')) THEN
    RAISE EXCEPTION 'Rollback would discard immutable machine execution data';
  END IF;
END $$;
DROP TABLE machine_prediction_snapshots;
ALTER TABLE parameter_coverage DROP COLUMN atomic_summary;
ALTER TABLE parameter_coverage DROP CONSTRAINT parameter_coverage_execution_rollup_check;
ALTER TABLE parameter_coverage ADD CONSTRAINT parameter_coverage_execution_rollup_check
  CHECK (execution_rollup IN ('UNSUPPORTED', 'PARTIAL'));
