DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions WHERE matrix_scope IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove authenticated matrix source scopes';
  END IF;
END $$;
ALTER TABLE source_review_decisions DROP COLUMN matrix_scope;
