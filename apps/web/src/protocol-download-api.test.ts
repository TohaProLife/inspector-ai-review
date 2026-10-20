import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => { vi.unstubAllGlobals(); });
describe("bounded protocol download client", () => {
  it("escapes protocol identity in the local IAIS pull link", () => {
    expect(api.iaisPullUrl("PR/escape")).toBe("/api/integrations/iais/protocols/PR%2Fescape");
  });
  it("uses authenticated scoped download and verifies response bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("%PDF-test", { headers: { "Content-Type": "application/pdf", "X-Content-SHA256": "3c87d37f1dbea6909f917ce437c390fb8e655a774387d9e69301c0b2283d5b63" } }));
    vi.stubGlobal("fetch", fetch);
    const { blob } = await api.downloadProtocolArtifact("PR/escape", "pdf");
    expect(await blob.text()).toBe("%PDF-test");
    expect(fetch).toHaveBeenCalledWith("/api/protocols/PR%2Fescape/artifacts/pdf", expect.objectContaining({ credentials: "include" }));
  });
  it.each(["text/html", "application/json"])("rejects successful but wrong %s content", async mediaType => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not a report", { headers: { "Content-Type": mediaType } })));
    await expect(api.downloadProtocolArtifact("PR-1", "pdf")).rejects.toThrow("неподдерживаемый");
  });
  it("rejects announced oversize and empty downloads", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("short", { headers: { "Content-Type": "application/xml", "Content-Length": "16777217" } }))
      .mockResolvedValueOnce(new Response("", { headers: { "Content-Type": "application/xml" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.downloadProtocolArtifact("PR-1", "xml")).rejects.toThrow("слишком большой");
    await expect(api.downloadProtocolArtifact("PR-1", "xml")).rejects.toThrow("пустой");
  });
  it("rejects tampered hashes and preserves explicit server errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("%PDF-test", { headers: { "Content-Type": "application/pdf", "X-Content-SHA256": "0".repeat(64) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "PROTOCOL_RENDER_BUSY", message: "Формируются другие протоколы" }), { status: 503, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.downloadProtocolArtifact("PR-1", "pdf")).rejects.toThrow("Контрольная сумма");
    await expect(api.downloadProtocolArtifact("PR-1", "pdf")).rejects.toThrow("Формируются другие протоколы");
  });
});
