-- Optional original-backed steel review. Historical omissions retain their digest.
ALTER TABLE source_review_decisions ADD COLUMN steel_comparison_scope JSONB
  CHECK (steel_comparison_scope IS NULL OR COALESCE((
    jsonb_typeof(steel_comparison_scope) = 'object'
    AND steel_comparison_scope->>'schemaVersion' = 'matrix-kr056-steel-review-v1'
    AND jsonb_typeof(steel_comparison_scope->'claims') = 'array'
    AND jsonb_array_length(steel_comparison_scope->'claims') <= 16
  ), false));
-- Complete original reconstruction and native budgets are enforced by API.
