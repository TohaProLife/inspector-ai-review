import { useEffect, useRef, useState } from "react";
import { CLOUD_ASSEMBLY_DURATION, cloudMayAnimate, sampleBuildingPoints } from "./architecturalPointCloud";
import { createCloudRenderer, type CloudRenderer } from "./pointCloudRenderer";
import { RefreshCw } from "./icons";

export function ParticleBuilding() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const controller = useRef<{ replay: () => void } | null>(null);
  const [reduced, setReduced] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current, region = regionRef.current;
    if (!canvas || !region) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = matchMedia("(hover: hover) and (pointer: fine)");
    let width = 0, height = 0, ratio = 1, visible = false, loaded = false, raf = 0, elapsed = 0, last = 0;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    let renderer: CloudRenderer | null = null;
    let disposed = false;
    let isReduced = motion.matches;
    setReduced(isReduced);
    const running = () => loaded && cloudMayAnimate(visible, document.hidden, isReduced, false);
    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };

    const draw = () => { if (width && height) renderer?.draw(isReduced ? CLOUD_ASSEMBLY_DURATION : elapsed, x, y, width, height, ratio); };
    const tick = (now: number) => {
      raf = 0;
      if (!running()) { last = 0; return; }
      const delta = last ? Math.min(now - last, 48) : 16;
      last = now;
      elapsed = Math.min(CLOUD_ASSEMBLY_DURATION, elapsed + delta);
      const damping = 1 - Math.exp(-delta / 180);
      x += (targetX - x) * damping; y += (targetY - y) * damping;
      draw();
      if (elapsed < CLOUD_ASSEMBLY_DURATION || Math.abs(targetX - x) + Math.abs(targetY - y) > .001) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const start = () => { if (!raf && running()) raf = requestAnimationFrame(tick); };
    const resize = () => {
      const bounds = region.getBoundingClientRect();
      width = bounds.width; height = bounds.height;
      ratio = Math.min(devicePixelRatio || 1, width < 600 ? 1.5 : 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      draw(); start();
    };
    const changeMotion = () => {
      isReduced = motion.matches; setReduced(isReduced);
      targetX = targetY = x = y = 0;
      stop(); draw(); start();
    };
    const changeVisibility = () => { if (document.hidden) stop(); else start(); };
    const move = (event: PointerEvent) => {
      if (!pointer.matches || !running()) return;
      const bounds = region.getBoundingClientRect();
      targetX = (event.clientX - bounds.left) / bounds.width * 2 - 1;
      targetY = (event.clientY - bounds.top) / bounds.height * 2 - 1;
      start();
    };
    const leave = () => { targetX = targetY = 0; start(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: .05 });
    const sizeObserver = new ResizeObserver(resize);
    controller.current = {
      replay() { elapsed = 0; stop(); draw(); start(); },
    };
    const sourceImage = new Image();
    sourceImage.onload = () => {
      if (disposed) return;
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = sourceImage.naturalWidth; sourceCanvas.height = sourceImage.naturalHeight;
      const source = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!source) { setAvailable(false); return; }
      source.drawImage(sourceImage, 0, 0);
      const spacing = region.clientWidth < 600 ? 6 : region.clientWidth < 900 ? 5 : 4;
      const points = sampleBuildingPoints(source.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height), spacing);
      canvas.dataset.pointCount = String(points.length);
      renderer = createCloudRenderer(canvas, points);
      if (!renderer) { setAvailable(false); return; }
      loaded = true;
      resize();
    };
    sourceImage.onerror = () => { if (!disposed) setAvailable(false); };
    sourceImage.src = "/images/architecture-cutout.svg";
    motion.addEventListener("change", changeMotion);
    document.addEventListener("visibilitychange", changeVisibility);
    region.addEventListener("pointermove", move, { passive: true });
    region.addEventListener("pointerleave", leave);
    observer.observe(region); sizeObserver.observe(region); resize();
    return () => {
      disposed = true; sourceImage.onload = sourceImage.onerror = null;
      stop(); observer.disconnect(); sizeObserver.disconnect(); renderer?.dispose(); controller.current = null;
      motion.removeEventListener("change", changeMotion);
      document.removeEventListener("visibilitychange", changeVisibility);
      region.removeEventListener("pointermove", move); region.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <figure className="particle-building">
    <div className="particle-building__stage" ref={regionRef}>
      <canvas ref={canvasRef} role="img" aria-label="Точечная иллюстрация здания: проявляются фасад, перекрытия и лестница." />
      <div className="particle-building__atmosphere" aria-hidden="true"><div className="particle-building__halo" /></div>
      {!available && <img className="particle-building__fallback" src="/images/architecture-cutout.svg" alt="Архитектурный разрез здания" />}
    </div>
    {available && !reduced && <button type="button" className="particle-building__replay" aria-label="Повторить сборку дома" title="Повторить анимацию" onClick={() => controller.current?.replay()}><RefreshCw size={18} /></button>}
  </figure>;
}
