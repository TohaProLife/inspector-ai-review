import type { CheckRun, Finding, InspectionObject, ProtocolVersion, UploadStage } from "@inspector-ai/contracts";

interface ObjectReader {
  getObject: (id: string) => Promise<InspectionObject>;
  getCheck: (id: string) => Promise<CheckRun>;
  getFindings: (id: string) => Promise<Finding[]>;
  getProtocols: (id: string) => Promise<ProtocolVersion[]>;
}

/** Read the complete selection before replacing the visible object and its data. */
export async function readWorkspaceObject(reader: ObjectReader, id: string) {
  const object = await reader.getObject(id);
  if (!object.activeCheckId) return { object, check: null, findings: [], protocols: [] };
  const [check, findings, protocols] = await Promise.all([
    reader.getCheck(object.activeCheckId), reader.getFindings(object.activeCheckId), reader.getProtocols(object.activeCheckId),
  ]);
  return { object, check, findings, protocols };
}

export function isRunningCheck(check: Pick<CheckRun, "status"> | null): boolean {
  return check?.status === "PROCESSING" || check?.status === "VALIDATING";
}

/** A newer selection invalidates any response still in flight. */
export function createSelectionRequest() {
  let current = 0;
  return () => {
    const request = ++current;
    return () => request === current;
  };
}

interface UploadCommands {
  uploadFiles: (id: string, stage: UploadStage, files: File[]) => Promise<unknown>;
  startCheck: (id: string) => Promise<CheckRun>;
}

/** Keep every stage and the new run attached to the selected object, including resumed drafts. */
export async function uploadAndStartCheck(commands: UploadCommands, objectId: string, stageFiles: Record<UploadStage, File[]>) {
  for (const [stage, files] of Object.entries(stageFiles) as [UploadStage, File[]][]) {
    if (files.length) await commands.uploadFiles(objectId, stage, files);
  }
  return commands.startCheck(objectId);
}
