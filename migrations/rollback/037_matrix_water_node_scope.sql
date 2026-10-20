-- Never discard immutable water-node human review history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions WHERE water_node_scope IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove immutable water node review history';
  END IF;
END $$;
ALTER TABLE source_review_decisions DROP COLUMN water_node_scope;
