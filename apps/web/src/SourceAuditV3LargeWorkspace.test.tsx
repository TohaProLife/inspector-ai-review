/** Frozen before UI implementation. Node/SSR projection evidence, not browser/extraction proof. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { CheckRun, DocumentTextV3LargeAuditSourceRead, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { buildSourceTextV3Index, buildSourceTextV3LargeIndex, loadSearchableSourceText, searchSourceText, sourceTextEvidence } from "./source-text-explorer";
import { SourceTextSearchResults } from "./SourceTextExplorer";
import { selectLightingSourceAudit } from "./LightingTechnologyReviewWorkspace";
import { SourceAuditV3LargeWorkspace, SourceAuditV3LargeStatus, selectSourceAuditV3Large, listSourceAuditV3Large, startSourceAuditV3Large, readSourceAuditV3LargeCheck } from "./SourceAuditV3LargeWorkspace";

const profile = "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1" as const;
const resource = "document-text-v3-large-source-bounds-v1" as const;
const manual = JSON.parse(readFileSync(new URL("../../../fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json", import.meta.url), "utf8"));
function fixture() {
  const artifact = structuredClone(manual.cases[0].artifact);
  const file: SourceFileSummary = { id: artifact.sourceFileId, sha256: artifact.inputSha256, stages: ["PD"], name: "Вертикальный PDF",
    pageCount: artifact.pageCount, size: 100, registeredAt: "2026-10-18T00:00:00Z", review: null };
  const identity = { objectId: "OBJ-LARGE", checkId: "CHK-LARGE", file, reviewHash: null };
  const data: DocumentTextV3LargeAuditSourceRead = { schemaVersion: "document-text-v3-large-source-read-v1", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: profile, resourcePolicyVersion: resource, checkId: identity.checkId, sourceFileId: file.id, sourceSha256: file.sha256,
    inputManifestHash: "b".repeat(64), textStageContentHash: "c".repeat(64), textArtifactByteSha256: "c".repeat(64), textArtifactContentHash: "d".repeat(64),
    extractorProfileHash: artifact.extractorProfileHash, stage: "PD", pageStages: {}, latestReviewHash: null,
    authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact };
  return { identity, data };
}
function check(change: Partial<CheckRun> = {}): CheckRun {
  return { id: "CHK-LARGE", objectId: "OBJ-LARGE", mode: "NORMAL", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: profile,
    progress: 100, status: "PARTIAL", startedAt: "2026-10-18T00:00:00Z", completedAt: "2026-10-18T00:01:00Z", currentStage: "Готово",
    modelVersion: null, rulesVersion: "test", stats: {} as CheckRun["stats"], ...change };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("selects newest sealed exact large audit and keeps ordinary lighting audits separate", () => {
  const old = check({ id: "OLD", sourceAuditProfileVersion: undefined });
  const latest = check({ id: "LATEST", startedAt: "2026-10-18T00:02:00Z" });
  const rows = [old, check(), latest, check({ id: "ACTIVE", progress: 22, completedAt: null, startedAt: "2026-10-18T00:06:00Z" }),
    check({ id: "FAILED", status: "FAILED", startedAt: "2026-10-18T00:07:00Z" }), check({ objectId: "OTHER", startedAt: "2026-10-18T00:08:00Z" }),
    check({ sourceAuditProfileVersion: "UNKNOWN" as any, startedAt: "2026-10-18T00:09:00Z" })];
  expect(selectSourceAuditV3Large(rows, "OBJ-LARGE")?.id).toBe("LATEST");
  expect(selectLightingSourceAudit(rows, "OBJ-LARGE")?.id).toBe("OLD");
  expect(selectSourceAuditV3Large([old], "OBJ-LARGE")).toBeNull();
});
it("SSR exposes explicit opt-in outside a form, source-only limits and no implicit completion", () => {
  const { identity } = fixture(); const fetch = vi.spyOn(api, "listObjectChecks");
  const html = renderToStaticMarkup(<SourceAuditV3LargeWorkspace {...identity} canRun disabled={false} />);
  expect(html).toContain("Большой PDF и вертикальный текст"); expect(html).toContain("Подготовка выполняется в фоне; состояние обновляется автоматически.");
  expect(html).toContain("Числовая вероятность не рассчитана"); expect(html).toContain("32 000 000");
  expect(html).not.toContain("<form"); expect(html).not.toContain("Исходный текст готов"); expect(fetch).not.toHaveBeenCalled();
  const denied = renderToStaticMarkup(<SourceAuditV3LargeWorkspace {...identity} canRun={false} disabled={false} />);
  expect(denied).toContain("disabled"); expect(denied).toContain("нет права запускать");
});
it("renders queue progress, terminal failure and ready state distinctly", () => {
  const queued = renderToStaticMarkup(<SourceAuditV3LargeStatus check={check({ progress: 22, completedAt: null, currentStage: "Очередь" })} />);
  expect(queued).toContain("22%"); expect(queued).toContain("Очередь"); expect(queued).not.toContain("Исходный текст готов");
  const failed = renderToStaticMarkup(<SourceAuditV3LargeStatus check={check({ status: "FAILED", failure: { jobType: "DOCUMENT_TEXT_LAYER", code: "INPUT_LIMIT", message: "Whole input rejected" } })} />);
  expect(failed).toContain("INPUT_LIMIT"); expect(failed).toContain("Whole input rejected"); expect(failed).not.toContain("Исходный текст готов");
  expect(renderToStaticMarkup(<SourceAuditV3LargeStatus check={check()} />)).toContain("Исходный текст готов");
});
it("projects whole independent vertical manual with exact raw/path/geometry, detached identity and no v2 facade", () => {
  const { identity, data } = fixture(), before = structuredClone(data), index = buildSourceTextV3LargeIndex(identity, data);
  expect(index.lines.map(r => [r.sourcePath, r.rawText, r.bboxMilliPoints])).toEqual([
    [[0, 0], "500\n", [112070, 30000, 122070, 46680]], [[1, 0], "500\n", [32070, 30000, 42070, 46680]],
    [[2, 0], "H\n", [20000, 107930, 27220, 117930]], [[3, 0, 0, 0], "1500\n", [72070, 30000, 82070, 52240]]]);
  expect(index.lines.every(r => r.blockIndex === undefined && r.lineIndex === undefined)).toBe(true);
  expect(index.origin).toMatchObject({ sourceAuditProfileVersion: profile, resourcePolicyVersion: resource, calibratedProbability: null });
  expect(index.identity).not.toBe(identity); expect(data).toEqual(before); expect(searchSourceText(index, "1500").total).toBe(1);
  expect(sourceTextEvidence(index, index.lines[3]!).bbox).toEqual([72070 / 160000, 1 - 52240 / 140000, 82070 / 160000, 1 - 30000 / 140000]);
  const html = renderToStaticMarkup(<SourceTextSearchResults index={index} query="1500" onSelect={() => {}} />);
  expect(html).toContain("3 / 0 / 0 / 0"); expect(html).toContain("1500\n"); expect(html).toContain("Видимость строки на PDF не подтверждена");
});
it("retains immutable source stage when current source metadata changes; review and source identity remain exact", () => {
  const { identity, data } = fixture(); identity.file.stages = ["RD"];
  expect(buildSourceTextV3LargeIndex(identity, data).origin.stage).toBe("PD");
  expect(() => buildSourceTextV3LargeIndex({ ...identity, reviewHash: "e".repeat(64) }, data)).toThrow();
  expect(() => buildSourceTextV3LargeIndex({ ...identity, file: { ...identity.file, sha256: "e".repeat(64) } }, data)).toThrow();
});
it.each(["schema", "profile", "resource", "purpose", "stageHash", "profileHash", "traversal", "calibration", "visibility", "path", "duplicate", "page", "extra"])("rejects detached or unsupported new source %s", kind => {
  const { identity, data } = fixture(), value = data as any;
  if (kind === "schema") value.schemaVersion = "document-text-v3-source-read-v1";
  if (kind === "profile") value.sourceAuditProfileVersion = "UNKNOWN";
  if (kind === "resource") value.resourcePolicyVersion = "document-text-v3-standard-bounds-v1";
  if (kind === "purpose") value.purpose = "ENGINEERING";
  if (kind === "stageHash") value.textStageContentHash = "f".repeat(64);
  if (kind === "profileHash") value.extractorProfileHash = "f".repeat(64);
  if (kind === "traversal") value.textArtifact.extractorProfile.traversalPolicyVersion = "pdfminer-analyzed-figures-boxes-flow-none-v1";
  if (kind === "calibration") value.calibratedProbability = 0.99;
  if (kind === "visibility") value.renderedVisibility = "VERIFIED";
  if (kind === "path") value.textArtifact.pages[0].locatedLines[0].sourcePath = [32768];
  if (kind === "duplicate") value.textArtifact.pages[0].locatedLines[1].sourcePath = [0, 0];
  if (kind === "page") value.textArtifact.pageCount = 513;
  if (kind === "extra") value.extra = null;
  expect(() => buildSourceTextV3LargeIndex(identity, data)).toThrow();
});
it("accepts synthetic UTF8 capacity above8M only in explicit new index; no correctness/producer claim", () => {
  const { identity, data } = fixture();
  for (const row of data.textArtifact.pages[0]!.locatedLines.slice(0, 3)) row.rawText = "Я".repeat(1500000);
  expect(Buffer.byteLength(JSON.stringify(data.textArtifact))).toBeGreaterThan(8000000);
  expect(buildSourceTextV3LargeIndex(identity, data).lines).toHaveLength(4);
  const old = { ...data, schemaVersion: "document-text-v3-source-read-v1" } as any;
  delete old.sourceAuditProfileVersion; delete old.resourcePolicyVersion;
  expect(() => buildSourceTextV3Index(identity, old)).toThrow();
}, 30000);
it("whole native guard rejects excess bytes, nodes, depth, container and strings including unrelated siblings", () => {
  const mutate = [
    (x: any) => { x.textArtifact.padding = Array(17).fill("x".repeat(1999999)); },
    (x: any) => { x.textArtifact.padding = Array.from({ length: 45 }, () => Array(32000).fill(null)); },
    (x: any) => { let v: any = null; for (let i = 0; i < 70; i++) v = { child: v }; x.textArtifact.padding = v; },
    (x: any) => { x.textArtifact.padding = Array(32769).fill(null); },
    (x: any) => { x.textArtifact.pages[0].locatedLines[0].rawText = "x".repeat(2000001); }
  ];
  for (const change of mutate) { const { identity, data } = fixture(); change(data); expect(() => buildSourceTextV3LargeIndex(identity, data)).toThrow(); }
}, 30000);
it("does not execute getters/toJSON and rejects cycles, unsafe integers and malformed Unicode", () => {
  let calls = 0;
  for (const kind of ["getter", "toJSON", "cycle", "unsafe", "unicode"]) {
    const { identity, data } = fixture(), value = data as any;
    if (kind === "getter") Object.defineProperty(value.textArtifact.pages[0], "unknown", { enumerable: true, get() { calls++; throw Error("getter"); } });
    if (kind === "toJSON") value.textArtifact.toJSON = () => { calls++; throw Error("toJSON"); };
    if (kind === "cycle") value.textArtifact.padding = value.textArtifact;
    if (kind === "unsafe") value.textArtifact.pageCount = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "unicode") value.textArtifact.pages[0].locatedLines[0].rawText = "\ud800";
    expect(() => buildSourceTextV3LargeIndex(identity, data)).toThrow();
  }
  expect(calls).toBe(0);
});
it("authenticates check before exact large route and never probes old source routes", async () => {
  const { identity, data } = fixture(), signal = new AbortController().signal;
  const get = vi.spyOn(api, "getCheck").mockResolvedValue(check());
  const old = vi.spyOn(api, "getSourceInventoryPages"), v3 = vi.spyOn(api, "getDocumentTextV3Source");
  const large = vi.spyOn(api, "getDocumentTextV3LargeSource").mockResolvedValue(data);
  expect((await loadSearchableSourceText(identity, signal)).lines).toHaveLength(4);
  expect(get).toHaveBeenCalledWith(identity.checkId, signal); expect(large).toHaveBeenCalledWith(identity.checkId, identity.file.id, signal);
  expect(get.mock.invocationCallOrder[0]).toBeLessThan(large.mock.invocationCallOrder[0]!); expect(old).not.toHaveBeenCalled(); expect(v3).not.toHaveBeenCalled();
});
it("does not downgrade new404/403 or unknown markers, foreign checks, unsealed runs or aborted requests", async () => {
  const { identity } = fixture(); const get = vi.spyOn(api, "getCheck").mockResolvedValue(check());
  const old = vi.spyOn(api, "getSourceInventoryPages"), v3 = vi.spyOn(api, "getDocumentTextV3Source"), large = vi.spyOn(api, "getDocumentTextV3LargeSource");
  for (const status of [404, 403]) { large.mockRejectedValue(Object.assign(Error(`large${status}`), { status })); await expect(loadSearchableSourceText(identity, new AbortController().signal)).rejects.toThrow(`large${status}`); }
  large.mockClear();
  for (const change of [{ sourceAuditProfileVersion: "UNKNOWN" as any }, { objectId: "OTHER" }, { progress: 20, completedAt: null }, { purpose: undefined }]) {
    get.mockResolvedValue(check(change)); await expect(loadSearchableSourceText(identity, new AbortController().signal)).rejects.toThrow();
  }
  expect(large).not.toHaveBeenCalled(); expect(old).not.toHaveBeenCalled(); expect(v3).not.toHaveBeenCalled();
  get.mockResolvedValue(check()); const controller = new AbortController(); get.mockImplementationOnce(async () => { controller.abort(); return check(); });
  await expect(loadSearchableSourceText(identity, controller.signal)).rejects.toThrow(); expect(large).not.toHaveBeenCalled();
});
it("authenticated list/start/poll reject wrong profile and object; use same abort signal", async () => {
  const signal = new AbortController().signal;
  const list = vi.spyOn(api, "listObjectChecks").mockResolvedValue({ items: [check(), check({ sourceAuditProfileVersion: undefined }), check({ objectId: "OTHER" })] });
  expect(await listSourceAuditV3Large("OBJ-LARGE", signal)).toEqual([check()]); expect(list).toHaveBeenCalledWith("OBJ-LARGE", signal);
  const start = vi.spyOn(api, "startSourceAuditV3LargeVertical").mockResolvedValue(check({ progress: 0, completedAt: null }));
  expect((await startSourceAuditV3Large("OBJ-LARGE", signal)).progress).toBe(0); expect(start).toHaveBeenCalledWith("OBJ-LARGE", signal);
  start.mockResolvedValue(check({ sourceAuditProfileVersion: undefined })); await expect(startSourceAuditV3Large("OBJ-LARGE", signal)).rejects.toThrow();
  const get = vi.spyOn(api, "getCheck").mockResolvedValue(check()); expect((await readSourceAuditV3LargeCheck("OBJ-LARGE", "CHK-LARGE", signal)).id).toBe("CHK-LARGE");
  get.mockResolvedValue(check({ id: "OTHER" })); await expect(readSourceAuditV3LargeCheck("OBJ-LARGE", "CHK-LARGE", signal)).rejects.toThrow();
});
it("new API uses distinct encoded versioned routes, cookie credentials, signal, empty body and command idempotency", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal; await api.getDocumentTextV3LargeSource("CHK /1", "SRC /2", signal);
  expect(fetch.mock.calls[0]![0]).toBe("/api/checks/CHK%20%2F1/source-text-v3-large-v1?sourceFileId=SRC%20%2F2");
  expect(fetch.mock.calls[0]![1]).toMatchObject({ signal, credentials: "include" });
  fetch.mockResolvedValue(new Response("{}", { status: 200 })); await api.startSourceAuditV3LargeVertical("OBJ /1", signal);
  expect(fetch.mock.calls[1]![0]).toBe("/api/objects/OBJ%20%2F1/source-audit-v3-large-vertical-v1");
  expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "POST", body: "{}", credentials: "include", signal });
  expect(new Headers(fetch.mock.calls[1]![1].headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u);
});
