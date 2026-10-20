import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import type { DocumentCoordinatePreviewInput } from "@inspector-ai/contracts";
afterEach(() => vi.unstubAllGlobals());
it("loads exact current-check frame with encoded identity, credentials and cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sourceFileId: "FIL" })));
  vi.stubGlobal("fetch", fetch); const signal = new AbortController().signal;
  expect(await api.getDocumentCoordinateFrame("OBJ /", "FIL /", 13, "CHK /", signal)).toEqual({ sourceFileId: "FIL" });
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/objects/OBJ%20%2F/files/FIL%20%2F/pages/13/document-coordinate-frame?checkId=CHK+%2F");
  expect(init.credentials).toBe("include"); expect(init.signal).toBe(signal); expect(init.body).toBeUndefined();
  expect((init.headers as Headers).has("Idempotency-Key")).toBe(false);
});
it("previews exact request without an idempotency command, autosave or retry", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "PREVIEW_ONLY" })));
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("document", { cookie: "inspector_csrf=coordinate%20csrf" });
  const input = { schemaVersion: "document-coordinate-preview-v1", checkId: "CHK" } as DocumentCoordinatePreviewInput;
  const before = JSON.stringify(input), signal = new AbortController().signal;
  await api.previewDocumentCoordinates("OBJ /", input, signal);
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/objects/OBJ%20%2F/document-coordinates/preview");
  expect(init.method).toBe("POST"); expect(init.credentials).toBe("include"); expect(init.signal).toBe(signal);
  expect(JSON.parse(init.body as string)).toEqual(input); expect(JSON.stringify(input)).toBe(before);
  expect((init.headers as Headers).get("X-CSRF-Token")).toBe("coordinate csrf");
  expect((init.headers as Headers).has("Idempotency-Key")).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([401,403,409])("surfaces HTTP%i directly without rebasing source identity", async status => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Explicit source reload required" }), { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(api.getDocumentCoordinateFrame("OBJ", "FIL", 1, "CHK", new AbortController().signal)).rejects.toThrow("Explicit source reload required");
  expect(fetch).toHaveBeenCalledTimes(1);
});
