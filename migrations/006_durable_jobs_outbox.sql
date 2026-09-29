-- Forward migration. Apply through the deployment migration gate; do not edit after deployment.
-- Rollback reference: migrations/rollback/006_durable_jobs_outbox.sql

CREATE TABLE analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  object_id UUID NOT NULL,
  inspection_id UUID NOT NULL,
  run_id UUID NOT NULL,
  queue_name TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('ANALYSIS_SEAL_UNSUPPORTED')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ANALYSIS')),
  state TEXT NOT NULL CHECK (state IN (
    'READY', 'LEASED', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED'
  )),
  semantic_key CHAR(64) NOT NULL CHECK (semantic_key ~ '^[a-f0-9]{64}$'),
  input_manifest_hash CHAR(64) NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  release_id TEXT NOT NULL,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  current_attempt_id UUID,
  lease_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result_json JSONB CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object'),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (object_id, organization_id) REFERENCES objects(id, organization_id),
  FOREIGN KEY (run_id, inspection_id) REFERENCES analysis_runs(id, inspection_id),
  FOREIGN KEY (run_id, object_id) REFERENCES analysis_runs(id, object_id),
  UNIQUE (run_id, semantic_key)
);

CREATE TABLE job_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES analysis_jobs(id),
  attempt_number SMALLINT NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  fencing_token BIGINT NOT NULL CHECK (fencing_token > 0),
  worker_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('LEASED', 'SUCCEEDED', 'FAILED', 'EXPIRED')),
  lease_until TIMESTAMPTZ NOT NULL,
  result_json JSONB CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object'),
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (job_id, attempt_number),
  UNIQUE (job_id, fencing_token)
);

CREATE TABLE domain_outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL CHECK (aggregate_version > 0),
  exchange_name TEXT NOT NULL,
  routing_key TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'DEAD')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lock_token UUID,
  lock_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX analysis_jobs_dispatch_idx
  ON analysis_jobs (state, next_attempt_at, created_at, id)
  WHERE state IN ('READY', 'RETRY_WAIT', 'LEASED');

CREATE INDEX analysis_jobs_run_state_idx
  ON analysis_jobs (run_id, state, created_at, id);

CREATE INDEX job_attempts_job_started_idx
  ON job_attempts (job_id, started_at, id);

CREATE INDEX domain_outbox_pending_idx
  ON domain_outbox (available_at, created_at, id)
  WHERE state IN ('PENDING', 'PUBLISHING');

CREATE INDEX domain_outbox_published_idx
  ON domain_outbox (published_at, id)
  WHERE state = 'PUBLISHED';
