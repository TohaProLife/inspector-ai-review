-- Optional original-backed lighting review; omission preserves historical review digests.
ALTER TABLE source_review_decisions ADD COLUMN lighting_technology_scope JSONB
  CHECK (lighting_technology_scope IS NULL OR COALESCE((
    jsonb_typeof(lighting_technology_scope) = 'object'
    AND lighting_technology_scope->>'schemaVersion' = 'matrix-zu130-lighting-technology-review-v1'
    AND jsonb_typeof(lighting_technology_scope->'claims') = 'array'
    AND jsonb_array_length(lighting_technology_scope->'claims') <= 16
  ), false));
-- Full native budgets, current-source eligibility and original reconstruction belong to API.
