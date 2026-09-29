-- Destructive rollback reference. Never run automatically in production.

DROP TRIGGER IF EXISTS protocol_revocations_immutable ON protocol_revocations;
DROP TABLE IF EXISTS protocol_revocations;
