-- Forward-only expand migration for B05 identity, scope and audit foundations.
-- Contains schema only: no users, credentials or memberships are seeded.
-- Rollback reference: migrations/rollback/003_identity_scope_audit.sql

CREATE TABLE IF NOT EXISTS inspector_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL UNIQUE CHECK (login = lower(login) AND length(login) BETWEEN 3 AND 120),
  provider_subject TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 180),
  enabled BOOLEAN NOT NULL DEFAULT true,
  auth_version BIGINT NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (password_hash IS NOT NULL OR provider_subject IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES inspector_users(id),
  role TEXT NOT NULL CHECK (role IN (
    'INSPECTOR', 'SUPERVISOR', 'ADMIN', 'ML_ENGINEER', 'CURATOR', 'INTEGRATION_SERVICE'
  )),
  capabilities TEXT[] NOT NULL DEFAULT '{}'::text[],
  granted_by UUID REFERENCES inspector_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, user_id, role),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS object_memberships (
  object_id UUID NOT NULL REFERENCES objects(id),
  user_id UUID NOT NULL REFERENCES inspector_users(id),
  permission_set TEXT[] NOT NULL,
  granted_by UUID REFERENCES inspector_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (object_id, user_id),
  CHECK (cardinality(permission_set) > 0),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES inspector_users(id),
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash CHAR(64) NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  auth_version BIGINT NOT NULL CHECK (auth_version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES inspector_users(id),
  operation TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_json JSONB NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (actor_user_id, operation, target_type, target_id, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  object_id UUID REFERENCES objects(id),
  inspection_id UUID REFERENCES inspections(id),
  actor_user_id UUID REFERENCES inspector_users(id),
  service_principal TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_ref JSONB,
  after_ref JSONB,
  reason TEXT,
  request_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  previous_event_hash CHAR(64) CHECK (
    previous_event_hash IS NULL OR previous_event_hash ~ '^[a-f0-9]{64}$'
  ),
  event_hash CHAR(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(actor_user_id, service_principal) = 1),
  CHECK (before_ref IS NULL OR jsonb_typeof(before_ref) = 'object'),
  CHECK (after_ref IS NULL OR jsonb_typeof(after_ref) = 'object')
);

CREATE TRIGGER command_receipts_immutable
  BEFORE UPDATE OR DELETE ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_domain_mutation();

CREATE INDEX inspector_users_enabled_login_idx
  ON inspector_users (enabled, login);
CREATE INDEX organization_memberships_user_active_idx
  ON organization_memberships (user_id, organization_id)
  WHERE revoked_at IS NULL;
CREATE INDEX object_memberships_user_active_idx
  ON object_memberships (user_id, object_id)
  WHERE revoked_at IS NULL;
CREATE INDEX user_sessions_user_active_idx
  ON user_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX command_receipts_expiry_idx
  ON command_receipts (expires_at);
CREATE INDEX audit_events_scope_time_idx
  ON audit_events (organization_id, object_id, created_at, id);
CREATE INDEX audit_events_target_time_idx
  ON audit_events (target_type, target_id, created_at, id);
