-- Rehearsal only. Accepted run history must not be destroyed by rollback.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM run_column_pylon_section_snapshot_states)
    OR EXISTS (SELECT 1 FROM run_column_pylon_section_snapshot_entries) THEN
    RAISE EXCEPTION 'Refusing rollback of populated column/pylon run snapshots';
  END IF;
END $$;
DROP TABLE run_column_pylon_section_snapshot_entries;
DROP TABLE run_column_pylon_section_snapshot_states;
DROP FUNCTION verify_column_pylon_snapshot_entry_binding();
DROP FUNCTION verify_column_pylon_snapshot_state_binding();
