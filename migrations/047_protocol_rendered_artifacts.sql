-- Derived download cache only. Historical protocol snapshots/JSON artifacts remain unchanged.
CREATE TABLE protocol_rendered_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES inspection_protocol_versions(id),
  source_artifact_id UUID NOT NULL REFERENCES protocol_artifacts(id),
  format TEXT NOT NULL CHECK (format IN ('pdf', 'docx', 'xml')),
  template_version TEXT NOT NULL CHECK (template_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  snapshot_hash CHAR(64) NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 16777216),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (protocol_id, format, template_version, snapshot_hash),
  CHECK (octet_length(content_bytes) = byte_size),
  CHECK (encode(digest(content_bytes, 'sha256'), 'hex') = content_hash),
  CHECK (media_type = CASE format
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'xml' THEN 'application/xml' END)
);

CREATE FUNCTION verify_protocol_rendered_artifact_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM protocol_artifacts artifact
    JOIN inspection_protocol_versions protocol ON protocol.id = artifact.protocol_id
    WHERE artifact.id = NEW.source_artifact_id AND protocol.id = NEW.protocol_id
      AND artifact.format = 'JSON' AND artifact.canonicalization_version = 'inspector-c14n-v1'
      AND protocol.snapshot_hash = NEW.snapshot_hash AND artifact.content_hash = NEW.snapshot_hash
      AND artifact.byte_size = octet_length(artifact.content_bytes)
      AND encode(digest(artifact.content_bytes, 'sha256'), 'hex') = NEW.snapshot_hash
  ) THEN
    RAISE EXCEPTION 'Rendered artifact source does not match frozen canonical snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protocol_rendered_artifacts_source_binding
  BEFORE INSERT ON protocol_rendered_artifacts
  FOR EACH ROW EXECUTE FUNCTION verify_protocol_rendered_artifact_source();

CREATE TRIGGER protocol_rendered_artifacts_immutable
  BEFORE UPDATE OR DELETE ON protocol_rendered_artifacts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
