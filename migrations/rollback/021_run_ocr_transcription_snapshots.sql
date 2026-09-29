-- Reference only. Never delete a run's reviewed evidence in production.
DROP TRIGGER IF EXISTS run_ocr_transcription_snapshots_immutable ON run_ocr_transcription_snapshots;
DROP TABLE IF EXISTS run_ocr_transcription_snapshots;
ALTER TABLE ocr_row_transcription_decisions
  DROP CONSTRAINT IF EXISTS ocr_row_transcription_decisions_origin_key;
