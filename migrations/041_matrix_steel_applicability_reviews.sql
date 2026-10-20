-- Independent append-only applicability journal. Source review digests are unchanged.
CREATE TABLE matrix_steel_applicability_decisions (
  id UUID PRIMARY KEY,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY,
  object_id UUID NOT NULL REFERENCES objects(id),
  pair_key CHAR(64) NOT NULL CHECK (pair_key ~ '^[a-f0-9]{64}$'),
  expected_source_file_id UUID NOT NULL,
  actual_source_file_id UUID NOT NULL,
  expected_review_decision_id UUID NOT NULL,
  actual_review_decision_id UUID NOT NULL,
  previous_decision_id UUID REFERENCES matrix_steel_applicability_decisions(id),
  previous_review_hash CHAR(64) CHECK (previous_review_hash IS NULL OR previous_review_hash ~ '^[a-f0-9]{64}$'),
  projection_json JSONB NOT NULL CHECK (jsonb_typeof(projection_json)='object'
    AND projection_json->>'schemaVersion'='matrix-kr056-steel-applicability-decision-v1'
    AND projection_json->>'status' IN ('UNKNOWN','APPROVED','WITHDRAWN')),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT matrix_steel_applicability_sequence_key UNIQUE (sequence_no),
  FOREIGN KEY (expected_source_file_id,object_id) REFERENCES source_files(id,object_id),
  FOREIGN KEY (actual_source_file_id,object_id) REFERENCES source_files(id,object_id),
  FOREIGN KEY (expected_review_decision_id,expected_source_file_id) REFERENCES source_review_decisions(id,source_file_id),
  FOREIGN KEY (actual_review_decision_id,actual_source_file_id) REFERENCES source_review_decisions(id,source_file_id),
  CHECK (expected_source_file_id<>actual_source_file_id),
  CHECK ((previous_decision_id IS NULL)=(previous_review_hash IS NULL))
);
CREATE INDEX matrix_steel_applicability_pair_latest_idx
  ON matrix_steel_applicability_decisions(object_id,pair_key,sequence_no DESC);
CREATE INDEX matrix_steel_applicability_object_sequence_idx
  ON matrix_steel_applicability_decisions(object_id,sequence_no DESC);
CREATE TRIGGER matrix_steel_applicability_decisions_immutable
  BEFORE UPDATE OR DELETE ON matrix_steel_applicability_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
