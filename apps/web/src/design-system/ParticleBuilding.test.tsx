import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ refs: [] as unknown[], effect: undefined as undefined | (() => void | (() => void)) }));
const renderer = vi.hoisted(() => ({ draw: vi.fn(), dispose: vi.fn() }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: () => ({ current: hooks.refs.shift() }),
  useState: (value: unknown) => [value, () => undefined],
  useEffect: (effect: typeof hooks.effect) => { hooks.effect = effect; },
}));
vi.mock("./pointCloudRenderer", () => ({ createCloudRenderer: () => renderer }));
import { ParticleBuilding } from "./ParticleBuilding";

afterEach(() => { vi.unstubAllGlobals(); renderer.draw.mockClear(); renderer.dispose.mockClear(); });

async function fixture(reduced = false) {
  const media = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const canvas = { dataset: {} as Record<string, string>, width: 0, height: 0 };
  const region = { clientWidth: 390, getBoundingClientRect: () => ({ width: 390, height: 290, left: 0, top: 0 }), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(180);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  const doc = {
    hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ width: 16, height: 16, data: pixels }) }) })),
  };
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  let enter: (entries: { isIntersecting: boolean }[]) => void;
  const intersection = { observe: vi.fn(), disconnect: vi.fn() };
  const resize = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal("matchMedia", (query: string) => query.includes("reduced") ? media : { matches: true });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("devicePixelRatio", 3);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextId; callbacks.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof enter) { enter = callback; } observe = intersection.observe; disconnect = intersection.disconnect; });
  vi.stubGlobal("ResizeObserver", class { observe = resize.observe; disconnect = resize.disconnect; });
  vi.stubGlobal("Image", class {
    naturalWidth = 16; naturalHeight = 16;
    onload: null | (() => void) = null; onerror: null | (() => void) = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  hooks.refs = [canvas, region, null];
  ParticleBuilding();
  const cleanup = hooks.effect!() as () => void;
  await Promise.resolve();
  const frame = (time: number) => {
    const frames = [...callbacks.values()]; callbacks.clear(); frames.forEach(callback => callback(time));
  };
  return { media, canvas, region, doc, callbacks, intersection, resize, cleanup, frame, enter: (visible: boolean) => enter([{ isIntersecting: visible }]) };
}

describe("particle animation lifecycle", () => {
  it("ships the source image needed to assemble the building", () => {
    const image = readFileSync(new URL("../../public/images/architecture-cutout.svg", import.meta.url), "utf8");
    expect(image).toContain("<svg");
    expect(image).toContain("Architectural frame");
  });
  it("samples the building image and keeps a static complete model for reduced motion", async () => {
    const f = await fixture(true); f.enter(true);
    expect(Number(f.canvas.dataset.pointCount)).toBeGreaterThan(0);
    expect(renderer.draw).toHaveBeenCalledWith(5800, 0, 0, 390, 290, 1.5);
    expect(f.callbacks.size).toBe(0);
    expect(f.canvas.width).toBe(585);
    f.cleanup();
  });
  it("starts only when visible and stops offscreen or in a hidden tab", async () => {
    const f = await fixture();
    expect(f.callbacks.size).toBe(0);
    f.enter(true); expect(f.callbacks.size).toBe(1);
    f.frame(16); expect(f.callbacks.size).toBe(1);
    f.enter(false); expect(f.callbacks.size).toBe(0);
    f.enter(true); expect(f.callbacks.size).toBe(1);
    f.doc.hidden = true;
    f.doc.addEventListener.mock.calls.find(([name]) => name === "visibilitychange")![1]();
    expect(f.callbacks.size).toBe(0);
    f.cleanup();
  });
  it("stops requesting frames when assembled", async () => {
    const f = await fixture(); f.enter(true);
    for (let time = 16; time < 6800; time += 48) f.frame(time);
    expect(f.callbacks.size).toBe(0);
    f.cleanup();
  });
  it("cleans up all observers and the renderer", async () => {
    const f = await fixture(); f.enter(true);
    f.media.matches = true; f.media.addEventListener.mock.calls[0][1]();
    expect(f.callbacks.size).toBe(0);
    f.cleanup();
    expect(f.intersection.disconnect).toHaveBeenCalledOnce();
    expect(f.resize.disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(f.region.removeEventListener).toHaveBeenCalledTimes(2);
    expect(f.doc.removeEventListener).toHaveBeenCalledOnce();
    expect(f.media.removeEventListener).toHaveBeenCalledOnce();
  });
});
