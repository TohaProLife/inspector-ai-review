-- Only before inventory reviews exist; preserving accepted decision history is mandatory.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions WHERE inventory_scope IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove immutable inventory review history';
  END IF;
END $$;
ALTER TABLE source_review_decisions DROP COLUMN inventory_scope;
