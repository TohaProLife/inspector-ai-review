-- Reference only. Never delete run snapshots in production.
DROP TRIGGER IF EXISTS run_ocr_applicability_snapshots_immutable
  ON run_ocr_applicability_snapshots;
DROP TABLE IF EXISTS run_ocr_applicability_snapshots;
ALTER TABLE ocr_row_applicability_decisions
  DROP CONSTRAINT IF EXISTS ocr_row_applicability_decisions_origin_key;
