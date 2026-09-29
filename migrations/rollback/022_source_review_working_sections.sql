DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM source_review_decisions
             WHERE section_code IN ('EOM', 'GP', 'GSV', 'KJ', 'KM', 'NVK',
                                    'OV', 'PP', 'PPR', 'SS', 'VK')) THEN
    RAISE EXCEPTION 'Cannot narrow reviewed source sections while RD decisions exist';
  END IF;
END;
$$;

ALTER TABLE source_review_decisions
  DROP CONSTRAINT source_review_decisions_section_code_check;

ALTER TABLE source_review_decisions
  ADD CONSTRAINT source_review_decisions_section_code_check CHECK (section_code IN (
    'PZ', 'SPZU', 'AR', 'KR', 'IOS1', 'IOS2', 'IOS3', 'IOS4', 'IOS5',
    'POS', 'POD', 'OOS', 'PPM', 'ODI', 'ZU', 'SM'
  ));
