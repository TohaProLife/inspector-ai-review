-- Destructive rollback reference. Never run automatically in production.

DROP TRIGGER IF EXISTS protocol_artifacts_immutable ON protocol_artifacts;
DROP TABLE IF EXISTS protocol_artifacts;
