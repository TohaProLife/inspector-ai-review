/** Deterministic sampling of the project's transparent architectural render. */
export interface PixelSource { width: number; height: number; data: Uint8ClampedArray }
export interface CloudPoint { x: number; y: number; shade: number; seed: number; depth: number; guide: number }
export const CLOUD_ASSEMBLY_DURATION = 5800;
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

function hash(x: number, y: number) {
  let value = (Math.imul(x + 17, 374761393) + Math.imul(y + 31, 668265263)) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function sampleBuildingPoints(source: PixelSource, spacing = 4): CloudPoint[] {
  const points: CloudPoint[] = [];
  const { width, height, data } = source;
  const sample = (x: number, y: number) => {
    const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  for (let y = 0; y < height; y += spacing) {
    for (let x = 0; x < width; x += spacing) {
      const pixel = sample(x, y);
      if (pixel.a < 115) continue;
      const next = sample(x + spacing, y), below = sample(x, y + spacing);
      const luminance = (pixel.r * .2126 + pixel.g * .7152 + pixel.b * .0722) / 255;
      const contrast = (Math.abs(pixel.r - next.r) + Math.abs(pixel.g - below.g)) / 510;
      const edge = next.a < 115 || below.a < 115 ? .27 : 0;
      points.push({
        x: (x + (hash(x, y) - .5) * spacing * .18 - width / 2) / height,
        y: (y + (hash(y, x) - .5) * spacing * .18 - height / 2) / height,
        shade: clamp01(.27 + luminance * .65 + contrast * .24 + edge),
        seed: hash(x + 53, y + 101),
        depth: clamp01((1 - luminance) * .45 + hash(x, y + 67) * .12),
        guide: 0,
      });
    }
  }
  // Sparse datum marks frame the cutaway without making another wireframe box.
  const addGuide = (x: number, y: number, seed: number) => points.push({ x, y, shade: .65, seed, depth: .15, guide: 1 });
  for (let side = -1; side <= 1; side += 2) {
    for (let index = 0; index <= 74; index++) {
      const t = index / 74;
      if (t > .2 && t < .78 && index % 4 !== 0) continue;
      addGuide(side * (.8 + Math.sin(t * Math.PI) * .035), -.43 + t * .86, hash(index, side + 4));
    }
  }
  for (let index = 0; index < 128; index++) {
    const angle = index / 128 * Math.PI * 2;
    addGuide(Math.cos(angle) * .74, Math.sin(angle) * .43, hash(index, 999));
  }
  return points;
}

export function cloudProgress(point: CloudPoint, elapsed: number): number {
  const delay = point.guide ? 480 : 360 + (.5 - point.y) * 1500 + point.seed * 660;
  return smooth((elapsed - delay) / (point.guide ? 2400 : 3150));
}

export function cloudPosition(point: CloudPoint, progress: number) {
  const spread = 1 - progress;
  const angle = point.seed * Math.PI * 10 + spread * 2.4;
  // Begin inside the canvas, not around the target position. A dispersed point
  // outside the stage would be clipped at its top edge beneath the hero copy.
  const originX = Math.cos(angle) * (.18 + point.seed * .3) + point.x * .15;
  const originY = Math.sin(angle) * (.12 + point.seed * .2) + point.y * .12;
  return {
    x: originX * spread + point.x * progress,
    y: originY * spread + point.y * progress,
  };
}

export function cloudMayAnimate(visible: boolean, hidden: boolean, reduced: boolean, paused: boolean) {
  return visible && !hidden && !reduced && !paused;
}
