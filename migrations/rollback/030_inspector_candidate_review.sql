-- Test-only rollback; preserve append-only human review history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM review_candidate_decisions WHERE inherited_from IS NOT NULL OR review_details IS NOT NULL
    OR has_expected_decision_hash OR decision NOT IN ('ACCEPT_FOR_REVIEW','REJECT')) THEN
    RAISE EXCEPTION 'Export and preserve new review history before rollback';
  END IF;
END $$;
ALTER TABLE review_candidate_decisions DROP CONSTRAINT review_candidate_decisions_decision_check;
ALTER TABLE review_candidate_decisions ADD CONSTRAINT review_candidate_decisions_decision_check
  CHECK (decision IN ('ACCEPT_FOR_REVIEW','REJECT'));
ALTER TABLE review_candidate_decisions DROP COLUMN inherited_from, DROP COLUMN review_details,
  DROP COLUMN expected_decision_hash, DROP COLUMN has_expected_decision_hash;

ALTER TABLE analysis_jobs DROP COLUMN visual_progress;
