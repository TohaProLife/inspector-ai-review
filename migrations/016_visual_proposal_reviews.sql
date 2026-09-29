-- Human review of geometric proposals is separate from machine results and findings.
-- Rollback reference: migrations/rollback/016_visual_proposal_reviews.sql

CREATE TABLE visual_proposal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id),
  artifact_id UUID NOT NULL REFERENCES analysis_stage_artifacts(id),
  artifact_hash CHAR(64) NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  proposal_ordinal INTEGER NOT NULL CHECK (proposal_ordinal >= 0),
  proposal_hash CHAR(64) NOT NULL CHECK (proposal_hash ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action IN ('KEEP_FOR_REVIEW', 'REJECT', 'UNSURE')),
  note TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 8 AND 1000),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  review_hash CHAR(64) NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id)
);

CREATE INDEX visual_proposal_reviews_history_idx
  ON visual_proposal_reviews (artifact_id, source_file_id, proposal_ordinal, created_at DESC, id DESC);

CREATE TRIGGER visual_proposal_reviews_immutable
  BEFORE UPDATE OR DELETE ON visual_proposal_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
