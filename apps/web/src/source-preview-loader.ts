// Match the server's two-render limit across all viewers in this browser tab.
// Do not cache or share authenticated responses. A started render retains its
// slot until its response finishes: aborting fetch does not stop server work.
const pending: Array<() => void> = [];
let active = 0;
const aborted = () => new DOMException("Preview no longer selected", "AbortError");
function drain() { while (active < 2 && pending.length) pending.shift()!(); }
export function loadSourcePreview(src: string, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const cancel = () => {
      const index = pending.indexOf(start);
      if (index >= 0) pending.splice(index, 1);
      reject(aborted());
    };
    const start = () => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) { reject(aborted()); return; }
      active++;
      void (async () => {
        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (signal.aborted) throw aborted();
            const response = await fetch(src, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(100000) });
            if (response.ok && response.headers.get("content-type")?.includes("image/png")) {
              const blob = await response.blob();
              if (signal.aborted) throw aborted();
              resolve(blob); return;
            }
            // Consume the body before releasing the network/render slot.
            await response.arrayBuffer();
            if (![429, 503].includes(response.status) || attempt === 4) throw Error(`Preview HTTP ${response.status}`);
            await new Promise(done => setTimeout(done, 400 * (attempt + 1)));
          }
        } catch (error) { reject(error); }
        finally { active--; drain(); }
      })();
    };
    signal.addEventListener("abort", cancel, { once: true });
    pending.push(start);
    // React StrictMode's immediate setup/cleanup cancels before starting I/O.
    queueMicrotask(drain);
  });
}
