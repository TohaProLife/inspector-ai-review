-- Local, relative drawing registration decisions. No findings or coverage are changed.
-- Rollback reference refuses to discard authenticated decisions.
CREATE TABLE local_document_registration_reviews (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  object_id UUID NOT NULL,
  inspection_id UUID NOT NULL,
  run_id UUID NOT NULL,
  source_file_id UUID NOT NULL,
  target_file_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  registration_sha256 CHAR(64) NOT NULL CHECK (registration_sha256 ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  previous_review_hash CHAR(64) CHECK (previous_review_hash IS NULL OR previous_review_hash ~ '^[a-f0-9]{64}$'),
  packet_json JSONB NOT NULL CHECK (jsonb_typeof(packet_json) = 'object'),
  result_json JSONB NOT NULL CHECK (jsonb_typeof(result_json) = 'object'
    AND result_json->>'status' IS NOT DISTINCT FROM 'REGISTERED_RELATIVE'
    AND result_json->>'absoluteGeoreference' IS NOT DISTINCT FROM 'false'),
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (object_id, organization_id) REFERENCES objects(id, organization_id),
  FOREIGN KEY (inspection_id, object_id) REFERENCES inspections(id, object_id),
  FOREIGN KEY (run_id, inspection_id) REFERENCES analysis_runs(id, inspection_id),
  FOREIGN KEY (source_file_id, object_id) REFERENCES source_files(id, object_id),
  FOREIGN KEY (target_file_id, object_id) REFERENCES source_files(id, object_id),
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, content_hash)
);
CREATE INDEX local_document_registration_reviews_scope_idx
  ON local_document_registration_reviews (organization_id, object_id, run_id, sequence DESC);
CREATE TRIGGER local_document_registration_reviews_immutable
  BEFORE UPDATE OR DELETE ON local_document_registration_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
