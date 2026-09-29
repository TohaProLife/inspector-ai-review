-- Forward-only expand migration for immutable analysis release manifests.
-- Rollback reference: migrations/rollback/012_analysis_release_manifests.sql

CREATE TABLE analysis_releases (
  release_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version IN (
    'analysis-release-legacy-v1', 'analysis-release-v1'
  )),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN (
    'LEGACY', 'SCAFFOLD', 'DRAFT', 'EVALUATED', 'APPROVED',
    'DEPLOYED', 'RETIRED', 'REJECTED'
  )),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 262144),
  content_json JSONB NOT NULL CHECK (jsonb_typeof(content_json) = 'object'),
  external_network_allowed BOOLEAN NOT NULL CHECK (NOT external_network_allowed),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH release_ids AS (
  SELECT release_id FROM analysis_runs
  UNION
  SELECT release_id FROM analysis_jobs
), payloads AS (
  SELECT
    release_id,
    jsonb_build_object(
      'schemaVersion', 'analysis-release-legacy-v1',
      'releaseId', release_id,
      'lifecycle', 'LEGACY',
      'externalNetworkAllowed', false
    ) AS content_json
  FROM release_ids
)
INSERT INTO analysis_releases (
  release_id, schema_version, lifecycle, content_hash, byte_size,
  content_json, external_network_allowed
)
SELECT
  release_id,
  'analysis-release-legacy-v1',
  'LEGACY',
  encode(digest(convert_to(content_json::text, 'UTF8'), 'sha256'), 'hex'),
  octet_length(convert_to(content_json::text, 'UTF8')),
  content_json,
  false
FROM payloads;

ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_release_fk
  FOREIGN KEY (release_id) REFERENCES analysis_releases(release_id);

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_release_fk
  FOREIGN KEY (release_id) REFERENCES analysis_releases(release_id);

CREATE TRIGGER analysis_releases_immutable
  BEFORE UPDATE OR DELETE ON analysis_releases
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX analysis_releases_lifecycle_created_idx
  ON analysis_releases (lifecycle, created_at, release_id);
