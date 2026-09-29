-- Reference only. Never roll back if any run used reviewed source decisions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM run_source_review_snapshots) THEN
    RAISE EXCEPTION 'source review snapshots exist; rollback is unsafe';
  END IF;
END $$;
DROP TRIGGER run_source_review_snapshots_immutable ON run_source_review_snapshots;
DROP TABLE run_source_review_snapshots;
DROP TRIGGER source_review_decisions_immutable ON source_review_decisions;
DROP TABLE source_review_decisions;
