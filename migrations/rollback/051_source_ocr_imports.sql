DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM source_ocr_imports) OR EXISTS(SELECT 1 FROM source_ocr_reviews) THEN
    RAISE EXCEPTION 'Refusing to remove populated source OCR history';
  END IF;
END $$;
DROP TABLE source_ocr_reviews;
DROP FUNCTION verify_source_ocr_review_binding();
DROP TABLE source_ocr_imports;
DROP FUNCTION verify_source_ocr_import_binding();
