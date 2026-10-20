import type { NativeCapacityComparison } from "./native-capacity-comparison.js";

export interface NativeCapacityCompareInput {
  schemaVersion: "native-capacity-command-v1";
  pdSourceFileId: string;
  rdSourceFileId: string;
}
export interface NativeCapacityRecord {
  schemaVersion: "native-capacity-record-v1";
  id: string; objectId: string; checkId: string; createdAt: string; createdBy: string;
  input: NativeCapacityCompareInput;
  bindings: { inputManifestHash: string; releaseId: string; pdSourceSha256: string; rdSourceSha256: string;
    pdTextArtifactHash: string; rdTextArtifactHash: string };
  comparison: NativeCapacityComparison;
  contentHash: string;
}
export interface NativeCapacityWorkspace {
  schemaVersion: "native-capacity-workspace-v1";
  checkId: string;
  canCompare: boolean;
  availability: "READY" | "SEALED_SOURCE_AUDIT_V4_REQUIRED";
  items: NativeCapacityRecord[];
}
