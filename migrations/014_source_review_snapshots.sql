-- Human source decisions are append-only. Each run snapshots the exact decisions
-- used by its immutable input manifest; later review cannot change an active run.
-- Rollback reference: migrations/rollback/014_source_review_snapshots.sql

CREATE TABLE source_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  revision_status TEXT NOT NULL CHECK (revision_status IN ('CURRENT', 'SUPERSEDED', 'UNKNOWN')),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('APPROVED', 'UNAPPROVED', 'UNKNOWN')),
  link_group_id TEXT CHECK (link_group_id IS NULL OR length(btrim(link_group_id)) BETWEEN 1 AND 120),
  page_stages JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(page_stages) = 'object'),
  basis_reference TEXT NOT NULL CHECK (length(btrim(basis_reference)) BETWEEN 8 AND 1000),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  UNIQUE (id, source_file_id)
);

CREATE INDEX source_review_decisions_latest_idx
  ON source_review_decisions (source_file_id, created_at DESC, id DESC);

CREATE TRIGGER source_review_decisions_immutable
  BEFORE UPDATE OR DELETE ON source_review_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TABLE run_source_review_snapshots (
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  source_file_id UUID NOT NULL,
  decision_id UUID NOT NULL,
  decision_hash CHAR(64) NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (run_id, source_file_id),
  FOREIGN KEY (decision_id, source_file_id)
    REFERENCES source_review_decisions(id, source_file_id)
);

CREATE TRIGGER run_source_review_snapshots_immutable
  BEFORE UPDATE OR DELETE ON run_source_review_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
