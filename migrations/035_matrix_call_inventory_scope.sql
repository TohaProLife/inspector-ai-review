-- Source-local human room mapping and call-inventory assertions. NULL keeps
-- legacy source-review preimages unchanged; decisions remain append-only.
ALTER TABLE source_review_decisions ADD COLUMN call_inventory_scope JSONB
  CHECK (call_inventory_scope IS NULL OR COALESCE((
    jsonb_typeof(call_inventory_scope) = 'object'
    AND call_inventory_scope->>'schemaVersion' = 'matrix-odi123-call-inventory-review-v1'
    AND jsonb_typeof(call_inventory_scope->'claims') = 'array'
    AND jsonb_array_length(call_inventory_scope->'claims') <= 16
  ), false));
-- API validates the TOTAL canonical decision envelope at 8,000,000 bytes.
-- jsonb::text adds spaces and is not the canonical byte representation.
