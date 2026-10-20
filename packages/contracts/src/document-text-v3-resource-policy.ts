// Derived from document-text-v3-resource-policy.schema.json.
// Schema SHA-256: 217ca89c4ce4cbf887fcdf537d4e0c65d6e6da047fd21fd84baacd49d53a2045
export const DOCUMENT_TEXT_V3_STANDARD_RESOURCE_POLICY = "document-text-v3-standard-bounds-v1" as const;
export const DOCUMENT_TEXT_V3_LARGE_RESOURCE_POLICY = "document-text-v3-large-source-bounds-v1" as const;
export type DocumentTextV3LargeReadResult =
  | { status: "VALID"; resourcePolicyVersion: typeof DOCUMENT_TEXT_V3_LARGE_RESOURCE_POLICY; contentHash: string }
  | { status: "ABSTAIN"; resourcePolicyVersion: typeof DOCUMENT_TEXT_V3_LARGE_RESOURCE_POLICY; reasonCode: "INVALID_INPUT" | "INPUT_LIMIT" | "INVALID_TEXT_ARTIFACT" };
