-- Forward-only expand migration for immutable canonical protocol artifacts.
-- Stores exact inspector-c14n-v1 JSON bytes created with each new protocol snapshot.
-- Rollback reference: migrations/rollback/005_protocol_canonical_artifacts.sql

CREATE TABLE protocol_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL UNIQUE,
  protocol_id UUID NOT NULL REFERENCES inspection_protocol_versions(id),
  format TEXT NOT NULL CHECK (format = 'JSON'),
  media_type TEXT NOT NULL CHECK (media_type = 'application/json'),
  canonicalization_version TEXT NOT NULL CHECK (canonicalization_version = 'inspector-c14n-v1'),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (protocol_id, format, canonicalization_version),
  CHECK (octet_length(content_bytes) = byte_size)
);

CREATE TRIGGER protocol_artifacts_immutable
  BEFORE UPDATE OR DELETE ON protocol_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX protocol_artifacts_protocol_created_idx
  ON protocol_artifacts (protocol_id, created_at, id);
