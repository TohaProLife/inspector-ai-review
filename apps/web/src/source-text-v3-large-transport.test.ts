/** Node fetch-stream unit cases, frozen before bounded new-route transport. No DOM/browser. */
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("rejects advertised oversized source body before JSON parse and cancels stream", async () => {
  const response = new Response("{}", { headers: { "Content-Length": "33554433" } });
  const cancel = vi.spyOn(response.body!, "cancel"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(api.getDocumentTextV3LargeSource("CHK", "SRC")).rejects.toThrow(/предел/u); expect(cancel).toHaveBeenCalledOnce();
});
it("bounds actual bytes without trusting Content-Length or response.json", async () => {
  let reads = 0; const cancel = vi.fn().mockResolvedValue(undefined), json = vi.fn().mockResolvedValue({});
  const read = vi.fn(async () => { reads++; return { done: false, value: new Uint8Array(2000000).fill(32) }; });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json,
    body: { getReader: () => ({ read, cancel, releaseLock() {} }) } }));
  await expect(api.getDocumentTextV3LargeSource("CHK", "SRC")).rejects.toThrow(/предел/u);
  expect(reads).toBe(17); expect(cancel).toHaveBeenCalledOnce(); expect(json).not.toHaveBeenCalled();
});
it("decodes split valid UTF8 exactly and rejects malformed UTF8 instead of replacing characters", async () => {
  const bytes = new TextEncoder().encode('{"rawText":"Я\\n"}');
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }))));
  expect(await api.getDocumentTextV3LargeSource("CHK", "SRC")).toEqual({ rawText: "Я\n" });
  const prefix = new TextEncoder().encode('{"rawText":"'), suffix = new TextEncoder().encode('"}');
  const invalid = new Uint8Array([...prefix, 0xc3, 0x28, ...suffix]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(invalid)));
  await expect(api.getDocumentTextV3LargeSource("CHK", "SRC")).rejects.toThrow();
});
it("aborts while streaming and discards partial response", async () => {
  const controller = new AbortController(), cancel = vi.fn().mockResolvedValue(undefined), json = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json,
    body: { getReader: () => ({ read: async () => { controller.abort(); return { done: false, value: new Uint8Array([123]) }; }, cancel, releaseLock() {} }) } }));
  await expect(api.getDocumentTextV3LargeSource("CHK", "SRC", controller.signal)).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce(); expect(json).not.toHaveBeenCalled();
});
