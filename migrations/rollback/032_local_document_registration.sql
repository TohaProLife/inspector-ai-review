DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM local_document_registration_reviews LIMIT 1) THEN
    RAISE EXCEPTION 'Rollback would discard authenticated local registration decisions';
  END IF;
END $$;
DROP TABLE local_document_registration_reviews;
