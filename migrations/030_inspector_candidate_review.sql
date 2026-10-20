-- Expand append-only triage with human review and evidence versions.
-- Rollback refuses to discard new review events; see rollback/030.
ALTER TABLE review_candidate_decisions
  DROP CONSTRAINT review_candidate_decisions_decision_check;
ALTER TABLE review_candidate_decisions
  ADD CONSTRAINT review_candidate_decisions_decision_check CHECK
    (decision IN ('ACCEPT_FOR_REVIEW','REJECT','CONFIRM','CLARIFY','PARTIAL_CONFIRM','CORRECT_EVIDENCE')),
  ADD COLUMN review_details JSONB,
  ADD COLUMN expected_decision_hash CHAR(64),
  ADD COLUMN has_expected_decision_hash BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT review_details_shape CHECK (review_details IS NULL OR jsonb_typeof(review_details) = 'object'),
  ADD CONSTRAINT expected_candidate_hash_shape CHECK
    (expected_decision_hash IS NULL OR expected_decision_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE review_candidate_decisions ADD COLUMN inherited_from JSONB
  CHECK (inherited_from IS NULL OR jsonb_typeof(inherited_from) = 'object');

ALTER TABLE analysis_jobs ADD COLUMN visual_progress JSONB
  CHECK (visual_progress IS NULL OR (job_type = 'ENTITY_EXTRACTION' AND jsonb_typeof(visual_progress) = 'object'));
