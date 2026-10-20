-- Source-local human inventory assertions are part of the append-only decision.
-- NULL preserves every prior review hash; existing run snapshots bind this body.
ALTER TABLE source_review_decisions ADD COLUMN inventory_scope JSONB
  CHECK (inventory_scope IS NULL OR COALESCE((
    jsonb_typeof(inventory_scope) = 'object'
    AND inventory_scope->>'schemaVersion' = 'matrix-inventory-review-v1'
    AND jsonb_typeof(inventory_scope->'claims') = 'array'
    AND jsonb_array_length(inventory_scope->'claims') <= 16
  ), false));
-- API enforces8,000,000 bytes on the COMPLETE canonical decision body before
-- INSERT. jsonb::text inserts spaces and cannot measure that canonical budget.
