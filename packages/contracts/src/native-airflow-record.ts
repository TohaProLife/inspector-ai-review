import type { NativeAirflowComparison, NativeAirflowSelection } from "./native-airflow-comparison.js";

export interface NativeAirflowCompareInput {
  schemaVersion: "native-airflow-command-v1";
  pdSourceFileId: string;
  rdSourceFileId: string;
  selection: NativeAirflowSelection;
}
export interface NativeAirflowRecord {
  schemaVersion: "native-airflow-record-v1";
  id: string; objectId: string; checkId: string; createdAt: string; createdBy: string;
  input: NativeAirflowCompareInput;
  bindings: { inputManifestHash: string; releaseId: string; pdSourceSha256: string; rdSourceSha256: string;
    pdTextArtifactHash: string; rdTextArtifactHash: string; selectionHash: string };
  comparison: NativeAirflowComparison;
  contentHash: string;
}
export interface NativeAirflowWorkspace {
  schemaVersion: "native-airflow-workspace-v1";
  checkId: string;
  canCompare: boolean;
  availability: "READY" | "SEALED_SOURCE_AUDIT_V4_REQUIRED";
  items: NativeAirflowRecord[];
}
