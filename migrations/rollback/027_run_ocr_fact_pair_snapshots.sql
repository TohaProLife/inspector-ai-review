-- Reference only. Never delete immutable run snapshots in production.
DROP TRIGGER IF EXISTS run_ocr_fact_pair_snapshots_immutable
  ON run_ocr_fact_pair_snapshots;
DROP TABLE IF EXISTS run_ocr_fact_pair_snapshots;
ALTER TABLE ocr_fact_pair_decisions
  DROP CONSTRAINT IF EXISTS ocr_fact_pair_decisions_origin_key;
