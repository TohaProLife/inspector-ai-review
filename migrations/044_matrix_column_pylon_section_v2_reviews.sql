-- New KR-060 v2 journal only. No backfill or mutation of source reviews/runs.
CREATE TABLE matrix_column_pylon_section_v2_decisions (
  id UUID PRIMARY KEY,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY,
  object_id UUID NOT NULL REFERENCES objects(id),
  pair_key CHAR(64) NOT NULL CHECK (pair_key ~ '^[a-f0-9]{64}$'),
  expected_source_file_id UUID NOT NULL,
  actual_source_file_id UUID NOT NULL,
  expected_review_decision_id UUID NOT NULL,
  actual_review_decision_id UUID NOT NULL,
  previous_decision_id UUID,
  previous_review_hash CHAR(64) CHECK (previous_review_hash IS NULL OR previous_review_hash ~ '^[a-f0-9]{64}$'),
  projection_json JSONB NOT NULL CHECK ((jsonb_typeof(projection_json)='object'
    AND projection_json->>'schemaVersion'='matrix-kr060-column-pylon-pair-projection-v2'
    AND projection_json->>'status' IN ('UNKNOWN','APPROVED','WITHDRAWN')) IS TRUE),
  actor_id UUID NOT NULL REFERENCES inspector_users(id),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT matrix_column_pylon_v2_sequence_key UNIQUE (sequence_no),
  CONSTRAINT matrix_column_pylon_v2_predecessor_key UNIQUE (id,content_hash,object_id,pair_key),
  FOREIGN KEY (expected_source_file_id,object_id) REFERENCES source_files(id,object_id),
  FOREIGN KEY (actual_source_file_id,object_id) REFERENCES source_files(id,object_id),
  FOREIGN KEY (expected_review_decision_id,expected_source_file_id) REFERENCES source_review_decisions(id,source_file_id),
  FOREIGN KEY (actual_review_decision_id,actual_source_file_id) REFERENCES source_review_decisions(id,source_file_id),
  FOREIGN KEY (previous_decision_id,previous_review_hash,object_id,pair_key)
    REFERENCES matrix_column_pylon_section_v2_decisions(id,content_hash,object_id,pair_key),
  CHECK (expected_source_file_id<>actual_source_file_id),
  CHECK ((previous_decision_id IS NULL)=(previous_review_hash IS NULL)),
  CHECK (previous_decision_id IS DISTINCT FROM id),
  CHECK ((projection_json->>'status'<>'WITHDRAWN' OR previous_decision_id IS NOT NULL) IS TRUE)
);
CREATE UNIQUE INDEX matrix_column_pylon_v2_initial_pair_idx
  ON matrix_column_pylon_section_v2_decisions(object_id,pair_key) WHERE previous_decision_id IS NULL;
CREATE UNIQUE INDEX matrix_column_pylon_v2_next_decision_idx
  ON matrix_column_pylon_section_v2_decisions(previous_decision_id) WHERE previous_decision_id IS NOT NULL;
CREATE INDEX matrix_column_pylon_v2_pair_latest_idx
  ON matrix_column_pylon_section_v2_decisions(object_id,pair_key,sequence_no DESC);
CREATE INDEX matrix_column_pylon_v2_object_sequence_idx
  ON matrix_column_pylon_section_v2_decisions(object_id,sequence_no DESC);
CREATE TRIGGER matrix_column_pylon_section_v2_decisions_immutable
  BEFORE UPDATE OR DELETE ON matrix_column_pylon_section_v2_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
