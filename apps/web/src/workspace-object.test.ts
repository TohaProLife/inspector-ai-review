import { describe, expect, it, vi } from "vitest";
import type { CheckRun, Finding, InspectionObject, ProtocolVersion } from "@inspector-ai/contracts";
import { createSelectionRequest, isRunningCheck, readWorkspaceObject, uploadAndStartCheck } from "./workspace-object";

function reader(object: InspectionObject) {
  return {
    getObject: vi.fn().mockResolvedValue(object),
    getCheck: vi.fn().mockResolvedValue({ id: object.activeCheckId, objectId: object.id } as CheckRun),
    getFindings: vi.fn().mockResolvedValue([{ id: "finding-current" }] as Finding[]),
    getProtocols: vi.fn().mockResolvedValue([{ id: "protocol-current" }] as ProtocolVersion[]),
  };
}

describe("workspace object selection", () => {
  it("resumes a saved draft without requesting data from another object's run", async () => {
    const object = { id: "existing-draft", activeCheckId: null, fileCount: 2 } as InspectionObject;
    const api = reader(object);
    await expect(readWorkspaceObject(api, object.id)).resolves.toEqual({ object, check: null, findings: [], protocols: [] });
    expect(api.getCheck).not.toHaveBeenCalled();
    expect(api.getFindings).not.toHaveBeenCalled();
    expect(api.getProtocols).not.toHaveBeenCalled();
  });

  it("returns object and dependent data only after the complete selection is available", async () => {
    const object = { id: "object-b", activeCheckId: "check-b" } as InspectionObject;
    const api = reader(object);
    let resolveProtocols!: (value: ProtocolVersion[]) => void;
    api.getProtocols.mockReturnValue(new Promise<ProtocolVersion[]>((resolve) => { resolveProtocols = resolve; }));
    let committed = false;
    const result = readWorkspaceObject(api, object.id).then((value) => { committed = true; return value; });
    await Promise.resolve();
    expect(committed).toBe(false);
    resolveProtocols([]);
    expect((await result).object.id).toBe("object-b");
    expect(api.getCheck).toHaveBeenCalledWith("check-b");
    expect(api.getFindings).toHaveBeenCalledWith("check-b");
  });

  it("preserves the current visible selection when a dependent read fails", async () => {
    const api = reader({ id: "object-b", activeCheckId: "check-b" } as InspectionObject);
    api.getFindings.mockRejectedValue(new Error("Connection lost"));
    await expect(readWorkspaceObject(api, "object-b")).rejects.toThrow("Connection lost");
  });

  it("rejects late responses and late failures after a newer object was selected", () => {
    const begin = createSelectionRequest();
    const first = begin();
    const second = begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    const third = begin();
    expect(second()).toBe(false);
    expect(third()).toBe(true);
  });

  it("polls validating and processing runs, and stops at failure or completed review", () => {
    expect(isRunningCheck({ status: "VALIDATING" })).toBe(true);
    expect(isRunningCheck({ status: "PROCESSING" })).toBe(true);
    expect(isRunningCheck({ status: "FAILED" })).toBe(false);
    expect(isRunningCheck({ status: "PARTIAL" })).toBe(false);
    expect(isRunningCheck(null)).toBe(false);
  });
});

describe("existing-object document upload", () => {
  it("attaches both stages and the next check to the same existing object", async () => {
    const commands = { uploadFiles: vi.fn().mockResolvedValue({}), startCheck: vi.fn().mockResolvedValue({ id: "new-run" }) };
    const pd = new File(["PD"], "pd.pdf");
    const rd = new File(["RD"], "rd.pdf");
    await uploadAndStartCheck(commands, "existing-object", { PD: [pd], RD: [rd], ID: [] });
    expect(commands.uploadFiles.mock.calls).toEqual([["existing-object", "PD", [pd]], ["existing-object", "RD", [rd]]]);
    expect(commands.startCheck).toHaveBeenCalledWith("existing-object");
    expect(commands.uploadFiles.mock.invocationCallOrder.at(-1)).toBeLessThan(commands.startCheck.mock.invocationCallOrder[0]);
  });

  it("does not start a partial upload, and allows an existing saved draft to start without new files", async () => {
    const commands = { uploadFiles: vi.fn().mockRejectedValue(new Error("Upload failed")), startCheck: vi.fn().mockResolvedValue({ id: "new-run" }) };
    await expect(uploadAndStartCheck(commands, "existing-object", { PD: [new File(["PD"], "pd.pdf")], RD: [], ID: [] })).rejects.toThrow("Upload failed");
    expect(commands.startCheck).not.toHaveBeenCalled();
    await uploadAndStartCheck(commands, "existing-object", { PD: [], RD: [], ID: [] });
    expect(commands.startCheck).toHaveBeenCalledExactlyOnceWith("existing-object");
  });
});
