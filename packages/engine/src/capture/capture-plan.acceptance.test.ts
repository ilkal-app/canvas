// Acceptance: written before the capture implementation.
// CONTRACT: plan finite board rectangles into exact, bounded pixel tiles and cameras.
// Deliberately not asserted: app export UI, file encoding, PDF, or browser GPU output.
import { describe, expect, it } from 'vitest';

import { captureSizeOf, DEFAULT_CAPTURE_LIMITS, fitsCapture, planCapture } from './capture-plan.js';

describe('capture plan acceptance', () => {
  it('uses one tile with the rectangle origin and scale as its camera', () => {
    const rect = Object.freeze({ x: -17, y: 23, width: 100, height: 80 });
    const plan = planCapture(rect, 1.5);
    expect(plan).toEqual({
      widthPx: 150,
      heightPx: 120,
      scale: 1.5,
      tiles: [
        {
          xPx: 0,
          yPx: 0,
          widthPx: 150,
          heightPx: 120,
          camera: { x: -17, y: 23, zoom: 1.5, viewportWidthPx: 150, viewportHeightPx: 120, dpr: 1 },
        },
      ],
    });
  });

  it('splits a 10000 by 5000 image into six row-major tiles and refuses an oversized scale', () => {
    const rect = { x: -12, y: 31, width: 10_000, height: 5_000 };
    const plan = planCapture(rect, 1);
    expect(
      plan.tiles.map(({ xPx, yPx, widthPx, heightPx }) => [xPx, yPx, widthPx, heightPx]),
    ).toEqual([
      [0, 0, 4096, 4096],
      [4096, 0, 4096, 4096],
      [8192, 0, 1808, 4096],
      [0, 4096, 4096, 904],
      [4096, 4096, 4096, 904],
      [8192, 4096, 1808, 904],
    ]);
    for (const tile of plan.tiles) {
      expect(tile.camera).toEqual({
        x: rect.x + tile.xPx,
        y: rect.y + tile.yPx,
        zoom: 1,
        viewportWidthPx: tile.widthPx,
        viewportHeightPx: tile.heightPx,
        dpr: 1,
      });
    }
    expect(fitsCapture(rect, 1)).toBe(true);
    expect(fitsCapture(rect, 2)).toBe(false);
    expect(() => planCapture(rect, 2)).toThrow(RangeError);
    expect(() => planCapture(rect, 2)).toThrow(/20000.*16384/i);
  });

  it('enforces the pixel budget even when both edges fit', () => {
    const rect = { x: 0, y: 0, width: 12_000, height: 12_000 };
    expect(fitsCapture(rect, 1)).toBe(false);
    expect(() => planCapture(rect, 1)).toThrow(RangeError);
    expect(() => planCapture(rect, 1)).toThrow(/12000/i);
    expect(() => planCapture(rect, 1)).toThrow(/134217728|128\s*MP/i);
  });

  it('rounds fractional dimensions up and gives tiny positive rectangles one pixel', () => {
    expect(captureSizeOf({ x: 0, y: 0, width: 100.2, height: 4.01 }, 1)).toEqual({
      widthPx: 101,
      heightPx: 5,
    });
    expect(captureSizeOf({ x: 0, y: 0, width: 0.001, height: 0.001 }, 0.1)).toEqual({
      widthPx: 1,
      heightPx: 1,
    });
  });

  it('covers each seeded image exactly once without gaps or overlap', () => {
    let seed = 612;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let caseIndex = 0; caseIndex < 24; caseIndex += 1) {
      const rect = Object.freeze({
        x: next() * 20 - 10,
        y: next() * 20 - 10,
        width: 1 + next() * 40,
        height: 1 + next() * 40,
      });
      const scale = 0.2 + next() * 2;
      const maxTilePx = 1 + Math.floor(next() * 13);
      const limits = Object.freeze({ ...DEFAULT_CAPTURE_LIMITS, maxTilePx });
      const plan = planCapture(rect, scale, limits);
      const covered = new Uint8Array(plan.widthPx * plan.heightPx);
      let area = 0;
      for (const tile of plan.tiles) {
        expect(tile.widthPx).toBeGreaterThan(0);
        expect(tile.heightPx).toBeGreaterThan(0);
        expect(tile.widthPx).toBeLessThanOrEqual(maxTilePx);
        expect(tile.heightPx).toBeLessThanOrEqual(maxTilePx);
        expect(tile.xPx + tile.widthPx).toBeLessThanOrEqual(plan.widthPx);
        expect(tile.yPx + tile.heightPx).toBeLessThanOrEqual(plan.heightPx);
        expect(tile.camera.x).toBe(rect.x + tile.xPx / scale);
        expect(tile.camera.y).toBe(rect.y + tile.yPx / scale);
        area += tile.widthPx * tile.heightPx;
        for (let y = tile.yPx; y < tile.yPx + tile.heightPx; y += 1) {
          for (let x = tile.xPx; x < tile.xPx + tile.widthPx; x += 1) {
            const index = y * plan.widthPx + x;
            covered[index] = (covered[index] ?? 0) + 1;
          }
        }
      }
      expect(area).toBe(plan.widthPx * plan.heightPx);
      expect(covered.every((count) => count === 1)).toBe(true);
    }
  });

  it('rejects invalid dimensions, scales and tile limits without changing frozen inputs', () => {
    const rect = Object.freeze({ x: 3, y: 4, width: 5, height: 6 });
    const limits = Object.freeze({ ...DEFAULT_CAPTURE_LIMITS, maxTilePx: 2 });
    planCapture(rect, 2, limits);
    expect(rect).toEqual({ x: 3, y: 4, width: 5, height: 6 });
    expect(limits.maxTilePx).toBe(2);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => planCapture({ ...rect, width: invalid }, 1)).toThrow(RangeError);
      expect(() => planCapture({ ...rect, height: invalid }, 1)).toThrow(RangeError);
      expect(() => planCapture(rect, invalid)).toThrow(RangeError);
    }
    for (const maxTilePx of [0, 1.5]) {
      expect(() => planCapture(rect, 1, { ...limits, maxTilePx })).toThrow(RangeError);
    }
  });
});
