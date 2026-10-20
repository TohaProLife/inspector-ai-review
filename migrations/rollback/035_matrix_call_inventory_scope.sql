-- Never destroy accepted immutable human review history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions WHERE call_inventory_scope IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove immutable call inventory review history';
  END IF;
END $$;
ALTER TABLE source_review_decisions DROP COLUMN call_inventory_scope;
