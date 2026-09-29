CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS inspection_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL,
  input_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES inspection_objects(id),
  source_file_id TEXT,
  stage TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  page_count INTEGER,
  revision TEXT,
  approval_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (object_id, sha256)
);

CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES inspection_objects(id),
  pd_file_id UUID REFERENCES document_files(id),
  rd_file_id UUID REFERENCES document_files(id),
  id_file_id UUID REFERENCES document_files(id),
  link_type TEXT NOT NULL,
  confidence NUMERIC(5,4),
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parameter_catalog (
  id INTEGER PRIMARY KEY,
  parameter_code TEXT UNIQUE NOT NULL,
  pd_section TEXT,
  parameter_name TEXT NOT NULL,
  unit TEXT,
  source_pd TEXT,
  source_rd TEXT,
  source_id TEXT,
  trigger_text TEXT,
  criticality TEXT,
  matrix_row INTEGER,
  mapping_status TEXT
);

CREATE TABLE IF NOT EXISTS check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES inspection_objects(id),
  status TEXT NOT NULL,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES check_runs(id),
  parameter_id INTEGER REFERENCES parameter_catalog(id),
  parameter_code TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence NUMERIC(5,4),
  comparison_result TEXT,
  expected_value TEXT,
  actual_value TEXT,
  id_value TEXT,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_fragments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES findings(id),
  file_id UUID REFERENCES document_files(id),
  source_file_id TEXT,
  pdf_page_number INTEGER NOT NULL,
  document_sheet_number INTEGER,
  bbox NUMERIC[4],
  object_key TEXT,
  source_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspector_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES findings(id),
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS protocol_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES check_runs(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  object_key TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (check_id, version)
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID REFERENCES check_runs(id),
  queue_name TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  object_id UUID REFERENCES inspection_objects(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_check_status_idx ON findings(check_id, status);
CREATE INDEX IF NOT EXISTS files_object_stage_idx ON document_files(object_id, stage);
CREATE INDEX IF NOT EXISTS audit_object_time_idx ON audit_log(object_id, created_at DESC);
