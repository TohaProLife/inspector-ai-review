-- Optional, reviewer-selected source section. NULL preserves legacy decisions.
-- Rollback reference: migrations/rollback/018_source_review_section_code.sql

ALTER TABLE source_review_decisions
  ADD COLUMN section_code TEXT CHECK (section_code IN (
    'PZ', 'SPZU', 'AR', 'KR', 'IOS1', 'IOS2', 'IOS3', 'IOS4', 'IOS5',
    'POS', 'POD', 'OOS', 'PPM', 'ODI', 'ZU', 'SM'
  ));
