-- Destructive rollback reference. Never run automatically in production.

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
DROP TRIGGER IF EXISTS command_receipts_immutable ON command_receipts;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS object_memberships;
DROP TABLE IF EXISTS organization_memberships;
DROP TABLE IF EXISTS inspector_users;
