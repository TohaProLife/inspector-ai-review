-- Local rollback rehearsal only; preserve every committed human decision.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM matrix_column_pylon_section_v2_decisions) THEN
    RAISE EXCEPTION 'Cannot roll back KR060 v2 while immutable review decisions exist';
  END IF;
END $$;
DROP TABLE matrix_column_pylon_section_v2_decisions;
