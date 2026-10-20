/** Fixed full-source profile; no caller supplied budget. */
export const DOCUMENT_TEXT_V4_FULL_RESOURCE_POLICY = "document-text-v4-full-source-bounds-v1" as const;
export type DocumentTextV4FullReadResult = {status:"VALID";resourcePolicyVersion:typeof DOCUMENT_TEXT_V4_FULL_RESOURCE_POLICY;contentHash:string}|{status:"ABSTAIN";resourcePolicyVersion:typeof DOCUMENT_TEXT_V4_FULL_RESOURCE_POLICY;reasonCode:"INVALID_INPUT"|"INPUT_LIMIT"|"INVALID_TEXT_ARTIFACT"};
