DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions WHERE section_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop reviewed source sections while decisions exist';
  END IF;
END;
$$;

ALTER TABLE source_review_decisions DROP COLUMN section_code;
