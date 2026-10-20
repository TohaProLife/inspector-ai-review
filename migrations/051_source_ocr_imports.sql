-- OCR imports are separate derivatives. A sealed source audit and its native artifact remain immutable.
CREATE TABLE source_ocr_imports (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  object_id UUID NOT NULL REFERENCES objects(id),
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  source_file_id UUID NOT NULL REFERENCES source_files(id),
  policy_version TEXT NOT NULL CHECK (policy_version='source-ocr-import-v1'),
  bundle_hash CHAR(64) NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_text TEXT NOT NULL CHECK (octet_length(content_text) BETWEEN 1 AND 16777216),
  content_json JSONB NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(run_id,source_file_id,policy_version,bundle_hash),
  CHECK (content_json=content_text::jsonb),
  CHECK (encode(digest(content_text,'sha256'),'hex')=content_hash),
  CHECK ((content_json->>'schemaVersion'='source-ocr-import-record-v1') IS TRUE),
  CHECK ((content_json->'derived' @> '{"schemaVersion":"source-ocr-import-derived-v1","status":"IMPORTED_OCR_UNVERIFIED","policyVersion":"source-ocr-import-v1","p":null,"factEligible":false,"coverageDelta":0,"providerExecutionVerified":false,"renderDerivationVerified":false}'::jsonb) IS TRUE),
  CHECK ((content_json->'bindings'->'originalBytesVerified'='true'::jsonb) IS TRUE)
);
CREATE FUNCTION verify_source_ocr_import_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM analysis_runs run JOIN objects object ON object.id=run.object_id
    JOIN input_manifests manifest ON manifest.id=run.manifest_id
    JOIN manifest_items item ON item.manifest_id=run.manifest_id AND item.source_file_id=NEW.source_file_id
    JOIN source_files source ON source.id=item.source_file_id AND source.object_id=run.object_id
    JOIN analysis_releases release ON release.release_id=run.release_id
    JOIN analysis_text_artifacts text ON text.run_id=run.id AND text.source_file_id=source.id
      AND text.schema_version='document-text-v4' AND text.resource_policy_version='document-text-v4-full-source-bounds-v1'
    WHERE run.id=NEW.run_id AND object.id=NEW.object_id AND object.organization_id=NEW.organization_id
      AND run.mode='NORMAL' AND run.sealed_at IS NOT NULL AND run.run_state IN ('SUCCEEDED','PARTIAL')
      AND release.content_json->'textLayer'->>'sourceAuditProfileVersion'='SOURCE_AUDIT_V4_FULL_SOURCE_V1'
      AND NEW.content_json->>'id'=NEW.id::text AND NEW.content_json->>'objectId'=object.api_id
      AND NEW.content_json->>'checkId'=run.api_id AND NEW.content_json->>'sourceFileId'=source.api_id
      AND NEW.content_json->>'createdBy'=NEW.actor_user_id::text
      AND (NEW.content_json->>'createdAt')::timestamptz=NEW.created_at
      AND NEW.content_json->'bindings'->>'releaseId'=run.release_id
      AND NEW.content_json->'bindings'->>'inputManifestHash'=manifest.sha256
      AND NEW.content_json->'bindings'->>'sourceSha256'=item.blob_sha256
      AND NEW.content_json->'bindings'->>'textArtifactByteSha256'=text.content_hash
      AND NEW.content_json->'derived'->>'sourceSha256'=item.blob_sha256
      AND NEW.content_json->'derived'->>'bundleHash'=NEW.bundle_hash
      AND NEW.content_json->'derived'->>'policyVersion'=NEW.policy_version
  ) THEN RAISE EXCEPTION 'Source OCR import binding mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_ocr_imports_binding BEFORE INSERT ON source_ocr_imports
  FOR EACH ROW EXECUTE FUNCTION verify_source_ocr_import_binding();
CREATE TRIGGER source_ocr_imports_immutable BEFORE UPDATE OR DELETE ON source_ocr_imports
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TABLE source_ocr_reviews (
  id UUID PRIMARY KEY,
  sequence BIGSERIAL UNIQUE,
  import_id UUID NOT NULL REFERENCES source_ocr_imports(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  object_id UUID NOT NULL REFERENCES objects(id),
  run_id UUID NOT NULL REFERENCES analysis_runs(id),
  page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 1024),
  line_ordinal INTEGER NOT NULL CHECK (line_ordinal BETWEEN 0 AND 9999),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_text TEXT NOT NULL CHECK (octet_length(content_text) BETWEEN 1 AND 16384),
  content_json JSONB NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (content_json=content_text::jsonb),
  CHECK (encode(digest(content_text,'sha256'),'hex')=content_hash),
  CHECK ((content_json @> '{"schemaVersion":"source-ocr-review-record-v1","humanTranscriptionOnly":true,"p":null,"factEligible":false,"coverageDelta":0}'::jsonb) IS TRUE),
  CHECK ((content_json->>'decision' IN ('CONFIRMED','REJECTED')) IS TRUE),
  CHECK ((length(content_json->>'basis') BETWEEN 3 AND 2000) IS TRUE)
);
CREATE FUNCTION verify_source_ocr_review_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_hash TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM source_ocr_imports parent,
      LATERAL jsonb_array_elements(parent.content_json->'derived'->'pages') AS pages(page),
      LATERAL jsonb_array_elements(page->'lines') AS lines(line)
    WHERE parent.id=NEW.import_id AND parent.organization_id=NEW.organization_id
      AND parent.object_id=NEW.object_id AND parent.run_id=NEW.run_id
      AND (page->>'pageNumber')::int=NEW.page_number AND (line->>'ordinal')::int=NEW.line_ordinal
      AND NEW.content_json->>'id'=NEW.id::text AND NEW.content_json->>'createdBy'=NEW.actor_user_id::text
      AND (NEW.content_json->>'createdAt')::timestamptz=NEW.created_at
      AND NEW.content_json->>'importId'=parent.id::text
      AND NEW.content_json->>'importContentHash'=parent.content_hash
      AND NEW.content_json->>'objectId'=parent.content_json->>'objectId'
      AND NEW.content_json->>'checkId'=parent.content_json->>'checkId'
      AND NEW.content_json->>'sourceFileId'=parent.content_json->>'sourceFileId'
      AND (NEW.content_json->>'pageNumber')::int=NEW.page_number
      AND (NEW.content_json->>'ordinal')::int=NEW.line_ordinal
      AND NEW.content_json->>'lineHash'=line->>'lineHash'
  ) THEN RAISE EXCEPTION 'Source OCR review binding mismatch' USING ERRCODE='23514'; END IF;
  SELECT content_hash INTO previous_hash FROM source_ocr_reviews
    WHERE import_id=NEW.import_id AND page_number=NEW.page_number AND line_ordinal=NEW.line_ordinal
    ORDER BY sequence DESC LIMIT 1;
  IF (NEW.content_json->>'expectedReviewHash') IS DISTINCT FROM previous_hash THEN
    RAISE EXCEPTION 'Source OCR review predecessor mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_ocr_reviews_binding BEFORE INSERT ON source_ocr_reviews
  FOR EACH ROW EXECUTE FUNCTION verify_source_ocr_review_binding();
CREATE TRIGGER source_ocr_reviews_immutable BEFORE UPDATE OR DELETE ON source_ocr_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();
