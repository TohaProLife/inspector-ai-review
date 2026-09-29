-- Destructive rollback reference. Do not run automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis_releases WHERE lifecycle <> 'LEGACY') THEN
    RAISE EXCEPTION 'Cannot roll back 012 while non-legacy release manifests exist';
  END IF;
END $$;

ALTER TABLE analysis_jobs DROP CONSTRAINT analysis_jobs_release_fk;
ALTER TABLE analysis_runs DROP CONSTRAINT analysis_runs_release_fk;
DROP TRIGGER analysis_releases_immutable ON analysis_releases;
DROP TABLE analysis_releases;
