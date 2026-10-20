import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { CheckRun, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { SourceAuditV4FullWorkspace, SourceAuditV4FullStatus, selectSourceAuditV4Full, selectSourceAuditV4FullStatus,
  listSourceAuditV4Full, startSourceAuditV4Full, readSourceAuditV4FullCheck } from "./SourceAuditV4FullWorkspace";
import { selectSourceAuditV3Large } from "./SourceAuditV3LargeWorkspace";

const profile = "SOURCE_AUDIT_V4_FULL_SOURCE_V1" as const;
function check(patch: Partial<CheckRun> = {}): CheckRun {
  return { id: "CHK-FULL", objectId: "OBJ-FULL", mode: "NORMAL", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: profile,
    progress: 100, status: "PARTIAL", startedAt: "2026-10-20T10:00:00Z", completedAt: "2026-10-20T10:02:00Z",
    currentStage: "Готово", modelVersion: null, rulesVersion: "test", stats: {} as CheckRun["stats"], ...patch };
}
const file: SourceFileSummary = { id: "FIL-FULL", sha256: "a".repeat(64), stages: ["RD"], name: "Source676.pdf", pageCount: 676,
  size: 1000, registeredAt: "2026-10-20T10:00:00Z", review: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps latest attempt status separate from older sealed V4 reading and historical V3", () => {
  const older = check({ id: "OLDER" }), active = check({ id: "ACTIVE", startedAt: "2026-10-20T11:00:00Z", completedAt: null, status: "PROCESSING", progress: 25 });
  const failed = check({ id: "FAILED", startedAt: "2026-10-20T12:00:00Z", completedAt: "2026-10-20T12:01:00Z", status: "FAILED" });
  const v3 = check({ id: "V3", sourceAuditProfileVersion: "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1" });
  const rows = [older, active, failed, v3, check({ objectId: "OTHER" })];
  expect(selectSourceAuditV4Full(rows, "OBJ-FULL")?.id).toBe("OLDER");
  expect(selectSourceAuditV4FullStatus(rows, "OBJ-FULL")?.id).toBe("FAILED");
  expect(selectSourceAuditV3Large(rows, "OBJ-FULL")?.id).toBe("V3");
  expect(selectSourceAuditV4Full([active, failed, v3], "OBJ-FULL")).toBeNull();
});
it("SSR exposes opt-in source-only1024, no implicit load/start/viewer or search readiness", () => {
  const list = vi.spyOn(api, "listObjectChecks"), start = vi.spyOn(api, "startSourceAuditV4Full"), read = vi.spyOn(api, "getDocumentTextV4FullPageBatch");
  const props = { objectId: "OBJ-FULL", file, reviewHash: null, canRun: true };
  const html = renderToStaticMarkup(<SourceAuditV4FullWorkspace {...props} />);
  expect(html).toContain("Полный аудит PDF до 1024 страниц"); expect(html).toContain("всех страниц пакетами");
  expect(html).toContain("Числовая вероятность не рассчитана"); expect(html).toContain("последних 100 запусков");
  expect(html).toContain("Открыть более ранний полный аудит по ID"); expect(html).not.toMatch(/<form\b|<img\b|<iframe\b/u);
  expect(html).not.toContain("Исходный текст готов"); expect(list).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  const denied = renderToStaticMarkup(<SourceAuditV4FullWorkspace {...props} canRun={false} />);
  expect(denied).toContain("нет права запускать"); expect(denied).toMatch(/<button[^>]*disabled/u);
  const node = SourceAuditV4FullWorkspace(props); expect(isValidElement(node)).toBe(true);
  expect(SourceAuditV4FullWorkspace({ ...props, reviewHash: "b".repeat(64) }).key).not.toBe(node.key);
});
it("renders actual processing, technical refusal, ready source status distinctly", () => {
  const active = renderToStaticMarkup(<SourceAuditV4FullStatus check={check({ status: "PROCESSING", progress: 41, completedAt: null, currentStage: "Чтение PDF" })} />);
  expect(active).toContain("41%"); expect(active).toContain("Чтение PDF"); expect(active).not.toContain("Исходный текст готов");
  const failed = renderToStaticMarkup(<SourceAuditV4FullStatus check={check({ status: "FAILED", failure: { code: "INPUT_LIMIT", message: "Whole source refused", jobType: "DOCUMENT_TEXT_LAYER" } })} />);
  expect(failed).toContain("INPUT_LIMIT"); expect(failed).toContain("Whole source refused"); expect(failed).not.toContain("Исходный текст готов");
  expect(renderToStaticMarkup(<SourceAuditV4FullStatus check={check()} />)).toContain("Исходный текст готов");
});
it("list validates exact V4 object identity and rejects duplicate or malformed V4 entries", async () => {
  const signal = new AbortController().signal, list = vi.spyOn(api, "listObjectChecks");
  list.mockResolvedValue({ items: [check(), check({ sourceAuditProfileVersion: "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1" })] });
  expect(await listSourceAuditV4Full("OBJ-FULL", signal)).toEqual([check()]); expect(list).toHaveBeenCalledWith("OBJ-FULL", signal);
  for (const items of [[check(), check()], [check({ objectId: "FOREIGN" })], [check({ progress: 101 })], [check({ status: "UNKNOWN" as any })]]) {
    list.mockResolvedValue({ items }); await expect(listSourceAuditV4Full("OBJ-FULL", signal)).rejects.toThrow();
  }
});
it("start/poll use scoped API and same abort signal, refusing other profile/object/id", async () => {
  const signal = new AbortController().signal;
  const start = vi.spyOn(api, "startSourceAuditV4Full").mockResolvedValue(check({ progress: 0, completedAt: null, status: "PROCESSING" }));
  expect((await startSourceAuditV4Full("OBJ-FULL", signal)).progress).toBe(0); expect(start).toHaveBeenCalledWith("OBJ-FULL", signal);
  for (const patch of [{ sourceAuditProfileVersion: undefined }, { objectId: "FOREIGN" }, { mode: "DEMO_SEED" as const }]) {
    start.mockResolvedValue(check(patch)); await expect(startSourceAuditV4Full("OBJ-FULL", signal)).rejects.toThrow();
  }
  const get = vi.spyOn(api, "getCheck").mockResolvedValue(check());
  expect((await readSourceAuditV4FullCheck("OBJ-FULL", "CHK-FULL", signal)).id).toBe("CHK-FULL");
  expect(get).toHaveBeenCalledWith("CHK-FULL", signal);
  get.mockResolvedValue(check({ id: "FOREIGN" })); await expect(readSourceAuditV4FullCheck("OBJ-FULL", "CHK-FULL", signal)).rejects.toThrow();
});
it("pre-abort and late response abort cannot publish list, start or poll state", async () => {
  const control = new AbortController(), list = vi.spyOn(api, "listObjectChecks"), start = vi.spyOn(api, "startSourceAuditV4Full"), get = vi.spyOn(api, "getCheck");
  control.abort();
  await expect(listSourceAuditV4Full("OBJ-FULL", control.signal)).rejects.toThrow();
  await expect(startSourceAuditV4Full("OBJ-FULL", control.signal)).rejects.toThrow();
  await expect(readSourceAuditV4FullCheck("OBJ-FULL", "CHK-FULL", control.signal)).rejects.toThrow();
  expect(list).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  const late = new AbortController(); start.mockImplementation(async () => { late.abort(); return check(); });
  await expect(startSourceAuditV4Full("OBJ-FULL", late.signal)).rejects.toThrow();
});
it("API uses distinct encoded V4 routes, CSRF, command idempotency, credentials and pinned continuation", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("document", { cookie: "inspector_csrf=v4-csrf" });
  const signal = new AbortController().signal;
  await api.startSourceAuditV4Full("OBJ /1", signal);
  expect(fetch.mock.calls[0]![0]).toBe("/api/objects/OBJ%20%2F1/source-audit-v4-full-source-v1");
  const command = fetch.mock.calls[0]![1] as RequestInit;
  expect(command).toMatchObject({ method: "POST", body: "{}", credentials: "include", signal });
  expect(new Headers(command.headers).get("X-CSRF-Token")).toBe("v4-csrf");
  expect(new Headers(command.headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u);
  await api.getDocumentTextV4FullPageBatch("CHK /1", "FIL /2", { startPage: 641, pageLimit: 128, expectedArtifactContentHash: "d".repeat(64) }, signal);
  const url = new URL(fetch.mock.calls[1]![0] as string, "http://local.invalid");
  expect(url.pathname).toBe("/api/checks/CHK%20%2F1/source-text-v4-full-source-v1/pages");
  expect(Object.fromEntries(url.searchParams)).toEqual({ sourceFileId: "FIL /2", startPage: "641", pageLimit: "128", expectedArtifactContentHash: "d".repeat(64) });
  expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: "include", signal });
});
it("V4 transport rejects announced oversize, invalid UTF8 and non-JSON without calling legacy routes", async () => {
  for (const response of [new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "33554433" } }),
    new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }),
    new Response("{}", { headers: { "Content-Type": "text/html" } })]) {
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
    await expect(api.getDocumentTextV4FullPageBatch("CHK", "FIL", { startPage: 1, pageLimit: 128 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
