import { afterEach, expect, it, vi } from "vitest";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { pairSearchCheck } from "./DocumentPairWorkspace";
const file = { id:"F0201", pageCount:676 } as SourceFileSummary;
const audit = {id:"FULL",objectId:"OBJ",mode:"NORMAL",purpose:"SOURCE_AUDIT_ONLY",sourceAuditProfileVersion:"SOURCE_AUDIT_V4_FULL_SOURCE_V1",
  status:"PARTIAL",progress:100,currentStage:"SOURCE_AUDIT_ONLY",startedAt:"2026-10-20T10:00:00Z",completedAt:"2026-10-20T10:01:00Z"};
afterEach(() => vi.restoreAllMocks());
it("uses the full saved source audit for a large PDF while preserving the comparison check", async () => {
  vi.spyOn(api,"listObjectChecks").mockResolvedValue({items:[audit] as any});
  expect(await pairSearchCheck("OBJ","COMPARISON",file,new AbortController().signal)).toBe("FULL");
});
it("refuses another object's audit and offers preparation when no complete source exists", async () => {
  const list = vi.spyOn(api,"listObjectChecks").mockResolvedValue({items:[{...audit,objectId:"OTHER"}] as any});
  await expect(pairSearchCheck("OBJ","COMPARISON",file,new AbortController().signal)).rejects.toThrow();
  list.mockResolvedValue({items:[]});
  await expect(pairSearchCheck("OBJ","COMPARISON",file,new AbortController().signal)).rejects.toThrow("подготовьте полный аудит");
});
it("retains current historical search for small PDFs without reading another check", async () => {
  const list = vi.spyOn(api,"listObjectChecks");
  expect(await pairSearchCheck("OBJ","COMPARISON",{...file,pageCount:177},new AbortController().signal)).toBe("COMPARISON");
  expect(list).not.toHaveBeenCalled();
});
