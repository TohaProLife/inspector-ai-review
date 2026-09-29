-- Reference only. Refuse to discard human judgments during rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ocr_row_applicability_decisions) THEN
    RAISE EXCEPTION 'Cannot drop OCR applicability decisions while reviews exist';
  END IF;
END;
$$;

DROP TABLE ocr_row_applicability_decisions;
ALTER TABLE run_source_review_snapshots
  DROP CONSTRAINT run_source_review_snapshots_decision_key;
ALTER TABLE run_ocr_transcription_snapshots
  DROP CONSTRAINT run_ocr_transcription_snapshots_decision_key;
