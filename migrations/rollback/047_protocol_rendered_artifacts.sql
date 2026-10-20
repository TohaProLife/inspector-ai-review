-- Rehearsal only. Accepted rendered bytes must never be destroyed by rollback.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM protocol_rendered_artifacts) THEN
    RAISE EXCEPTION 'Refusing rollback of populated protocol rendered artifacts';
  END IF;
END $$;
DROP TABLE protocol_rendered_artifacts;
DROP FUNCTION verify_protocol_rendered_artifact_source();
