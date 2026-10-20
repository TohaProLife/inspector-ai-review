import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSourcePreview } from "./source-preview-loader";
afterEach(() => vi.unstubAllGlobals());
const image = () => new Response(new Blob(["png"], { type: "image/png" }), { headers: { "content-type": "image/png" } });
describe("bounded authenticated preview loading", () => {
  it("skips StrictMode cleanup before I/O and never shares or caches authenticated bodies", async () => {
    const fetch = vi.fn(async () => image()); vi.stubGlobal("fetch", fetch);
    const stale = new AbortController(), current = new AbortController();
    const first = loadSourcePreview("/preview", stale.signal); stale.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await loadSourcePreview("/preview", current.signal);
    await loadSourcePreview("/preview", current.signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]).toMatchObject(["/preview", { credentials: "include", cache: "no-store" }]);
  });
  it("retains two active slots after navigation and cancels queued stale pages", async () => {
    const releases: Array<() => void> = [];
    const fetch = vi.fn((_url: string) => new Promise<Response>(resolve => releases.push(() => resolve(image())))); vi.stubGlobal("fetch", fetch);
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const reads = controllers.map((controller, index) => loadSourcePreview(`/page/${index}`, controller.signal));
    const outcomes = Promise.allSettled(reads);
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(2);
    controllers[0].abort(); controllers[2].abort();
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(2);
    releases[0]();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["/page/0", "/page/1", "/page/3"]);
    releases[1](); releases[2]();
    expect((await outcomes).map(value => value.status)).toEqual(["rejected", "fulfilled", "rejected", "fulfilled"]);
  });
});
