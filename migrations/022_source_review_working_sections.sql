-- Allow reviewer-selected RD sections named by the pinned 47-code candidate policy.
-- This changes vocabulary only; no source receives a section automatically.
-- Rollback reference: migrations/rollback/022_source_review_working_sections.sql

ALTER TABLE source_review_decisions
  DROP CONSTRAINT source_review_decisions_section_code_check;

ALTER TABLE source_review_decisions
  ADD CONSTRAINT source_review_decisions_section_code_check CHECK (section_code IN (
    'PZ', 'SPZU', 'AR', 'KR', 'IOS1', 'IOS2', 'IOS3', 'IOS4', 'IOS5',
    'POS', 'POD', 'OOS', 'PPM', 'ODI', 'ZU', 'SM',
    'EOM', 'GP', 'GSV', 'KJ', 'KM', 'NVK', 'OV', 'PP', 'PPR', 'SS', 'VK'
  ));
