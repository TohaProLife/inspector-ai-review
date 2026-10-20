-- This repair does not store previous mutable active pointers. Guessing one
-- from audit creation time could reopen the wrong engineering aggregate.
-- FINAL versions and immutable audit histories were never changed.
-- Restore an explicitly reviewed database backup if a rollback is required.
DO $$ BEGIN
  RAISE EXCEPTION '052_source_audit_side_lane has no automatic rollback; restore a reviewed backup, never infer prior active pointers';
END $$;
