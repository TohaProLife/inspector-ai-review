-- Reference only. Never delete reviewed evidence in a production rollback.
DROP TRIGGER IF EXISTS ocr_row_transcription_decisions_immutable ON ocr_row_transcription_decisions;
DROP TABLE IF EXISTS ocr_row_transcription_decisions;
