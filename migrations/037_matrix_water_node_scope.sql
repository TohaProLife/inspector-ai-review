-- Named cold-water inlet node review assertions; NULL leaves historical hashes unchanged.
ALTER TABLE source_review_decisions ADD COLUMN water_node_scope JSONB
  CHECK (water_node_scope IS NULL OR COALESCE((
    jsonb_typeof(water_node_scope) = 'object'
    AND water_node_scope->>'schemaVersion' = 'matrix-zu129-water-node-review-v1'
    AND jsonb_typeof(water_node_scope->'claims') = 'array'
    AND jsonb_array_length(water_node_scope->'claims') <= 16
  ), false));
-- Complete request/materialized decision budgets and reconstructed source associations
-- are enforced by the API. jsonb::text is not the canonical hash preimage.
