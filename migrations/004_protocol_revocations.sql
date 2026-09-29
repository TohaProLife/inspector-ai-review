-- Forward-only expand migration for B15 protocol revocation.
-- Adds append-only revocation records; existing protocol snapshots remain immutable.
-- Rollback reference: migrations/rollback/004_protocol_revocations.sql

CREATE TABLE protocol_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  protocol_id UUID NOT NULL UNIQUE REFERENCES inspection_protocol_versions(id),
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'SOURCE_DATA_ERROR',
    'REVIEW_DECISION_ERROR',
    'SCOPE_ERROR',
    'PROTOCOL_CONTENT_ERROR',
    'OTHER'
  )),
  comment TEXT NOT NULL CHECK (length(btrim(comment)) BETWEEN 10 AND 2000),
  replacement_protocol_id UUID NOT NULL REFERENCES inspection_protocol_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (protocol_id <> replacement_protocol_id)
);

CREATE TRIGGER protocol_revocations_immutable
  BEFORE UPDATE OR DELETE ON protocol_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX protocol_revocations_created_idx
  ON protocol_revocations (created_at, id);
CREATE INDEX protocol_revocations_replacement_idx
  ON protocol_revocations (replacement_protocol_id);
