-- Derived source-only comparisons. No rule_results, review decisions or coverage mutations.
CREATE TABLE native_airflow_comparisons (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  object_id UUID NOT NULL REFERENCES objects(id),
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  pd_source_file_id UUID NOT NULL REFERENCES source_files(id),
  rd_source_file_id UUID NOT NULL REFERENCES source_files(id),
  policy_version TEXT NOT NULL CHECK (policy_version = 'native-selected-system-airflow-v1'),
  selection_hash CHAR(64) NOT NULL CHECK (selection_hash ~ '^[a-f0-9]{64}$'),
  selection_text TEXT NOT NULL CHECK (octet_length(selection_text) BETWEEN 1 AND 4096),
  CHECK (encode(digest(selection_text,'sha256'),'hex') = selection_hash),
  CHECK ((selection_text::jsonb = content_json->'input'->'selection') IS TRUE),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_text TEXT NOT NULL CHECK (octet_length(content_text) BETWEEN 1 AND 16777216),
  content_json JSONB NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id,pd_source_file_id,rd_source_file_id,policy_version,selection_hash),
  CHECK (pd_source_file_id <> rd_source_file_id),
  CHECK (content_json = content_text::jsonb),
  CHECK (encode(digest(content_text,'sha256'),'hex') = content_hash),
  CHECK ((content_json->>'schemaVersion' = 'native-airflow-record-v1') IS TRUE),
  CHECK ((content_json->'comparison' @> '{"schemaVersion":"native-airflow-comparison-v1","purpose":"SOURCE_ONLY","factEligible":false,"coverageDelta":0,"p":null,"calibratedProbability":null,"engineeringQualification":false,"completeConfiguration":false}'::jsonb) IS TRUE)
);
CREATE FUNCTION verify_native_airflow_comparison_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM analysis_runs run JOIN objects object ON object.id=run.object_id
    JOIN input_manifests manifest ON manifest.id=run.manifest_id
    JOIN manifest_items pd ON pd.manifest_id=run.manifest_id AND pd.source_file_id=NEW.pd_source_file_id
    JOIN source_files pds ON pds.id=pd.source_file_id AND pds.object_id=run.object_id
    JOIN manifest_items rd ON rd.manifest_id=run.manifest_id AND rd.source_file_id=NEW.rd_source_file_id
    JOIN source_files rds ON rds.id=rd.source_file_id AND rds.object_id=run.object_id
    JOIN analysis_releases release ON release.release_id=run.release_id
    JOIN analysis_text_artifacts pdt ON pdt.run_id=run.id AND pdt.source_file_id=pds.id
      AND pdt.schema_version='document-text-v4' AND pdt.resource_policy_version='document-text-v4-full-source-bounds-v1'
    JOIN analysis_text_artifacts rdt ON rdt.run_id=run.id AND rdt.source_file_id=rds.id
      AND rdt.schema_version='document-text-v4' AND rdt.resource_policy_version='document-text-v4-full-source-bounds-v1'
    WHERE run.id=NEW.run_id AND object.id=NEW.object_id AND object.organization_id=NEW.organization_id
      AND run.mode='NORMAL' AND run.sealed_at IS NOT NULL AND run.run_state IN ('SUCCEEDED','PARTIAL')
      AND release.content_json->'textLayer'->>'sourceAuditProfileVersion'='SOURCE_AUDIT_V4_FULL_SOURCE_V1'
      AND NEW.content_json->>'id'=NEW.id::text AND NEW.content_json->>'objectId'=object.api_id
      AND NEW.content_json->>'checkId'=run.api_id AND NEW.content_json->>'createdBy'=NEW.actor_user_id::text
      AND NEW.content_json->'input'->>'pdSourceFileId'=pds.api_id
      AND NEW.content_json->'input'->>'rdSourceFileId'=rds.api_id
      AND NEW.content_json->'bindings'->>'inputManifestHash'=manifest.sha256
      AND NEW.content_json->'bindings'->>'releaseId'=run.release_id
      AND NEW.content_json->'bindings'->>'selectionHash'=NEW.selection_hash
      AND (NEW.content_json->'comparison'->>'status'='ABSTAIN'
        OR NEW.content_json->'comparison'->'selection'=NEW.content_json->'input'->'selection')
      AND NEW.content_json->'bindings'->>'pdSourceSha256'=pd.blob_sha256
      AND NEW.content_json->'bindings'->>'rdSourceSha256'=rd.blob_sha256
      AND NEW.content_json->'bindings'->>'pdTextArtifactHash'=pdt.content_hash
      AND NEW.content_json->'bindings'->>'rdTextArtifactHash'=rdt.content_hash
      AND (NEW.content_json->>'createdAt')::timestamptz=NEW.created_at
      AND pd.blob_sha256 <> rd.blob_sha256
      AND NEW.content_json->'comparison'->>'policyVersion'=NEW.policy_version
  ) THEN RAISE EXCEPTION 'Native airflow source binding mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER native_airflow_comparisons_binding BEFORE INSERT ON native_airflow_comparisons
  FOR EACH ROW EXECUTE FUNCTION verify_native_airflow_comparison_binding();
CREATE TRIGGER native_airflow_comparisons_immutable BEFORE UPDATE OR DELETE ON native_airflow_comparisons
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
