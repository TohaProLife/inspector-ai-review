-- Source-local human room mapping and rail-inventory assertions. NULL keeps
-- legacy source-review preimages unchanged; decisions remain append-only.
ALTER TABLE source_review_decisions ADD COLUMN rail_inventory_scope JSONB
  CHECK (rail_inventory_scope IS NULL OR COALESCE((
    jsonb_typeof(rail_inventory_scope) = 'object'
    AND rail_inventory_scope->>'schemaVersion' = 'matrix-odi120-rail-inventory-review-v1'
    AND jsonb_typeof(rail_inventory_scope->'claims') = 'array'
    AND jsonb_array_length(rail_inventory_scope->'claims') <= 16
  ), false));
-- API validates the TOTAL canonical decision envelope at 8,000,000 bytes.
-- jsonb::text adds spaces and is not the canonical byte representation.
