-- V12 immutable KR-060 run snapshot. No backfill or writes to prior domain tables.
-- Full canonical hashes, retained history and reverse entry completeness remain
-- protected application validation/atomic transaction responsibilities.
CREATE TABLE run_column_pylon_section_snapshot_states (
  run_id UUID PRIMARY KEY,
  object_id UUID NOT NULL,
  object_api_id TEXT NOT NULL,
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  snapshot_json JSONB NOT NULL,
  UNIQUE (run_id,object_id),
  FOREIGN KEY (run_id,object_id) REFERENCES analysis_runs(id,object_id),
  CHECK ((jsonb_typeof(snapshot_json)='object'
    AND snapshot_json->>'schemaVersion'='matrix-kr060-column-pylon-run-snapshot-v1'
    AND snapshot_json->>'objectId'=object_id::text
    AND snapshot_json->>'objectApiId'=object_api_id
    AND snapshot_json->>'inputManifestHash'=input_manifest_hash
    AND snapshot_json->>'contentHash'=content_hash
    AND CASE WHEN jsonb_typeof(snapshot_json->'entries')='array'
      THEN jsonb_array_length(snapshot_json->'entries')<=16 ELSE false END) IS TRUE)
);
CREATE TABLE run_column_pylon_section_snapshot_entries (
  run_id UUID NOT NULL,
  object_id UUID NOT NULL,
  pair_key CHAR(64) NOT NULL CHECK (pair_key ~ '^[a-f0-9]{64}$'),
  decision_id UUID NOT NULL,
  sequence_no BIGINT NOT NULL CHECK (sequence_no>0),
  journal_content_hash CHAR(64) NOT NULL CHECK (journal_content_hash ~ '^[a-f0-9]{64}$'),
  projection_content_hash CHAR(64) NOT NULL CHECK (projection_content_hash ~ '^[a-f0-9]{64}$'),
  included BOOLEAN NOT NULL,
  exclusion_reason TEXT,
  PRIMARY KEY (run_id,pair_key),
  UNIQUE (run_id,decision_id),
  FOREIGN KEY (run_id,object_id) REFERENCES run_column_pylon_section_snapshot_states(run_id,object_id),
  FOREIGN KEY (decision_id,journal_content_hash,object_id,pair_key)
    REFERENCES matrix_column_pylon_section_v2_decisions(id,content_hash,object_id,pair_key),
  CHECK (((included AND exclusion_reason IS NULL)
    OR (NOT included AND exclusion_reason IN ('SOURCE_NOT_IN_MANIFEST','SOURCE_REVIEW_REFERENCE_CHANGED'))) IS TRUE)
);
CREATE FUNCTION verify_column_pylon_snapshot_state_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_object UUID;
  actual_api TEXT;
  actual_manifest CHAR(64);
BEGIN
  IF jsonb_typeof(NEW.snapshot_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid column/pylon snapshot header' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(NEW.snapshot_json))<>6 THEN
    RAISE EXCEPTION 'Invalid column/pylon snapshot header keys' USING ERRCODE='23514';
  END IF;
  SELECT run.object_id, object.api_id, manifest.sha256
    INTO actual_object,actual_api,actual_manifest
    FROM analysis_runs run
    JOIN objects object ON object.id=run.object_id
    JOIN input_manifests manifest ON manifest.id=run.manifest_id AND manifest.inspection_id=run.inspection_id
    WHERE run.id=NEW.run_id;
  IF (actual_object=NEW.object_id AND actual_api=NEW.object_api_id
      AND actual_manifest=NEW.input_manifest_hash) IS NOT TRUE THEN
    RAISE EXCEPTION 'Column/pylon snapshot run binding mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION verify_column_pylon_snapshot_entry_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actual_sequence BIGINT;
  actual_projection TEXT;
  body JSONB;
  expected_entry JSONB;
BEGIN
  IF (((NEW.included AND NEW.exclusion_reason IS NULL)
    OR (NOT NEW.included AND NEW.exclusion_reason IN ('SOURCE_NOT_IN_MANIFEST','SOURCE_REVIEW_REFERENCE_CHANGED')))) IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid column/pylon snapshot inclusion' USING ERRCODE='23514';
  END IF;
  SELECT journal.sequence_no,journal.projection_json->>'contentHash'
    INTO actual_sequence,actual_projection
    FROM matrix_column_pylon_section_v2_decisions journal
    WHERE journal.id=NEW.decision_id AND journal.object_id=NEW.object_id
      AND journal.pair_key=NEW.pair_key AND journal.content_hash=NEW.journal_content_hash;
  IF (actual_sequence=NEW.sequence_no AND actual_projection=NEW.projection_content_hash) IS NOT TRUE THEN
    RAISE EXCEPTION 'Column/pylon snapshot journal binding mismatch' USING ERRCODE='23514';
  END IF;
  SELECT snapshot_json INTO body FROM run_column_pylon_section_snapshot_states
    WHERE run_id=NEW.run_id AND object_id=NEW.object_id;
  expected_entry=jsonb_build_object('pairKey',NEW.pair_key::text,'decisionId',NEW.decision_id::text,
    'sequenceNo',NEW.sequence_no::text,'journalContentHash',NEW.journal_content_hash::text,
    'projectionContentHash',NEW.projection_content_hash::text,'included',NEW.included,
    'exclusionReason',NEW.exclusion_reason);
  IF body IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(body->'entries') entry WHERE entry=expected_entry
    ) THEN
    RAISE EXCEPTION 'Column/pylon snapshot entry absent from header' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_column_pylon_section_snapshot_state_binding
  BEFORE INSERT ON run_column_pylon_section_snapshot_states
  FOR EACH ROW EXECUTE FUNCTION verify_column_pylon_snapshot_state_binding();
CREATE TRIGGER run_column_pylon_section_snapshot_entry_binding
  BEFORE INSERT ON run_column_pylon_section_snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION verify_column_pylon_snapshot_entry_binding();
CREATE TRIGGER run_column_pylon_section_snapshot_states_immutable
  BEFORE UPDATE OR DELETE ON run_column_pylon_section_snapshot_states
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
CREATE TRIGGER run_column_pylon_section_snapshot_entries_immutable
  BEFORE UPDATE OR DELETE ON run_column_pylon_section_snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
