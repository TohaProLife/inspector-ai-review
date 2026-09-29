import { describe, expect, it } from "vitest";
import { CLOUD_ASSEMBLY_DURATION, cloudMayAnimate, cloudPosition, cloudProgress, sampleBuildingPoints } from "./architecturalPointCloud";

describe("image-sampled architectural point cloud", () => {
  const data = new Uint8ClampedArray(24 * 24 * 4);
  for (let y = 3; y < 21; y++) for (let x = 4; x < 20; x++) {
    if (x > 10 && x < 15 && y < 18) continue;
    const i = (y * 24 + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = x % 4 ? 120 : 230;
    data[i + 3] = 255;
  }
  const source = { width: 24, height: 24, data };

  it("samples opaque architectural surfaces but retains the transparent cutaway", () => {
    const points = sampleBuildingPoints(source, 2);
    expect(points).toEqual(sampleBuildingPoints(source, 2));
    expect(points.filter(point => !point.guide).length).toBeGreaterThan(50);
    expect(points.filter(point => !point.guide && Math.abs(point.x) < .04 && point.y < .2)).toHaveLength(0);
    expect(points.some(point => point.guide)).toBe(true);
  });
  it("finishes every point at its image position with no idle loop required", () => {
    for (const point of sampleBuildingPoints(source, 2)) {
      expect(cloudProgress(point, 0)).toBe(0);
      expect(cloudProgress(point, CLOUD_ASSEMBLY_DURATION)).toBe(1);
      expect(cloudPosition(point, 1)).toEqual({ x: point.x, y: point.y });
      for (const progress of [0, .25, .45, .75, 1]) {
        const position = cloudPosition(point, progress);
        expect(Object.values(position).every(Number.isFinite)).toBe(true);
        expect(Math.abs(position.y)).toBeLessThan(.52);
      }
    }
  });
  it("stops motion offscreen, while hidden or for reduced-motion users", () => {
    expect(cloudMayAnimate(true, false, false, false)).toBe(true);
    expect(cloudMayAnimate(false, false, false, false)).toBe(false);
    expect(cloudMayAnimate(true, true, false, false)).toBe(false);
    expect(cloudMayAnimate(true, false, true, false)).toBe(false);
  });
});
