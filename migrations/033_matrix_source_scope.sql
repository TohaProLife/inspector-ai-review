-- Optional authenticated context lives in the existing append-only source review.
-- Hashing includes this field only when present, preserving all old snapshots.
-- Rollback reference: migrations/rollback/033_matrix_source_scope.sql
ALTER TABLE source_review_decisions ADD COLUMN matrix_scope JSONB
  CHECK (matrix_scope IS NULL OR jsonb_typeof(matrix_scope) = 'object');
