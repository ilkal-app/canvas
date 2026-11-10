import { describe, expect, it } from 'vitest';

import {
  pickTileLevel,
  tileLevelSize,
  tilesCovering,
  visibleImageRect,
  type UnitRect,
} from './tiles.js';

const NATURAL = { width: 8000, height: 6000 };
const TILES = { tileSizePx: 256, levels: 6 } as const;
const IDENTITY = { x: 0, y: 0, cos: 1, sin: 0 };
const WHOLE = { x: 0, y: 0, width: 1, height: 1 };

describe('tileLevelSize', () => {
  it('is the original at the top level and halves per level below', () => {
    expect(tileLevelSize(NATURAL, TILES, 5)).toEqual({ width: 8000, height: 6000 });
    expect(tileLevelSize(NATURAL, TILES, 4)).toEqual({ width: 4000, height: 3000 });
    expect(tileLevelSize(NATURAL, TILES, 0)).toEqual({ width: 250, height: 188 });
  });
});

describe('pickTileLevel', () => {
  it('picks the coarsest level whose long edge meets the requirement', () => {
    expect(pickTileLevel(3000, NATURAL, TILES)).toBe(4);
    expect(pickTileLevel(4001, NATURAL, TILES)).toBe(5);
    expect(pickTileLevel(100, NATURAL, TILES)).toBe(0);
  });

  it('stops at the original', () => {
    expect(pickTileLevel(50_000, NATURAL, TILES)).toBe(5);
  });

  it('keeps the tile level it showed while the need wobbles across a level edge', () => {
    // Level 4's long edge is 4000 px: 4200 is within its 10% slack, 4500 is not.
    expect(pickTileLevel(4200, NATURAL, TILES, 4)).toBe(4);
    expect(pickTileLevel(4500, NATURAL, TILES, 4)).toBe(5);
    // Down from level 5 (8000 px) only once level 4 would be at most 80% used.
    expect(pickTileLevel(3500, NATURAL, TILES, 5)).toBe(5);
    expect(pickTileLevel(3000, NATURAL, TILES, 5)).toBe(4);
  });
});

describe('tilesCovering', () => {
  it('lists every tile under a region of the image, row by row', () => {
    // Level 4 is 4000 × 3000: 16 × 12 tiles. The region spans x 0.1–0.2, y 0–0.05.
    const region: UnitRect = { minU: 0.1, minV: 0, maxU: 0.2, maxV: 0.05 };
    const tiles = tilesCovering(region, NATURAL, TILES, 4);

    // x: 400–800 px → columns 1–3; y: 0–150 px → row 0.
    expect(tiles.map(({ column, row }) => [column, row])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  it('gives each tile its rectangle in the unit square, narrower at the last column', () => {
    const region: UnitRect = { minU: 0.99, minV: 0.99, maxU: 1, maxV: 1 };
    const [corner] = tilesCovering(region, NATURAL, TILES, 4);

    // Level 4 is 4000 px wide: the last column starts at 3840 and is 160 px wide.
    expect(corner).toMatchObject({ level: 4, column: 15, row: 11, widthPx: 160, heightPx: 184 });
    expect(corner?.rect.minU).toBeCloseTo(3840 / 4000);
    expect(corner?.rect.maxU).toBe(1);
    expect(corner?.rect.minV).toBeCloseTo(2816 / 3000);
  });

  it('covers nothing for an empty region', () => {
    expect(
      tilesCovering({ minU: 0.5, minV: 0.5, maxU: 0.5, maxV: 0.6 }, NATURAL, TILES, 4),
    ).toEqual([]);
  });
});

describe('visibleImageRect', () => {
  const box = { x: 0, y: 0, width: 800, height: 600 };

  it('is the whole image when the box is inside the viewport', () => {
    const viewport = { minX: -100, minY: -100, maxX: 1000, maxY: 1000 };

    expect(visibleImageRect(box, IDENTITY, WHOLE, viewport)).toEqual({
      minU: 0,
      minV: 0,
      maxU: 1,
      maxV: 1,
    });
  });

  it('is the part of the image the viewport shows', () => {
    const viewport = { minX: 400, minY: 0, maxX: 1000, maxY: 150 };

    expect(visibleImageRect(box, IDENTITY, WHOLE, viewport)).toEqual({
      minU: 0.5,
      minV: 0,
      maxU: 1,
      maxV: 0.25,
    });
  });

  it('maps through the crop into the source image', () => {
    const rightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 };
    const viewport = { minX: 0, minY: 0, maxX: 400, maxY: 600 };

    expect(visibleImageRect(box, IDENTITY, rightHalf, viewport)).toEqual({
      minU: 0.5,
      minV: 0,
      maxU: 0.75,
      maxV: 1,
    });
  });

  it('follows a rotated box through the bounds of the viewport in its own frame', () => {
    // Rotated a quarter turn about its origin at (1000, 0): local x runs down the screen.
    const turned = { x: 1000, y: 0, cos: 0, sin: 1 };
    const viewport = { minX: 0, minY: 0, maxX: 1000, maxY: 400 };

    const rect = visibleImageRect(box, turned, WHOLE, viewport);

    expect(rect?.minU).toBeCloseTo(0);
    expect(rect?.maxU).toBeCloseTo(0.5);
    expect(rect?.minV).toBeCloseTo(0);
    expect(rect?.maxV).toBeCloseTo(1);
  });

  it('measures from where a crop fitted inside its box is drawn', () => {
    // Drawn 400 × 600 from x = 200: the viewport's left 400 units show its left half.
    const fitted = { x: 200, y: 0, width: 400, height: 600 };
    const viewport = { minX: 0, minY: 0, maxX: 400, maxY: 600 };

    expect(visibleImageRect(fitted, IDENTITY, WHOLE, viewport)).toEqual({
      minU: 0,
      minV: 0,
      maxU: 0.5,
      maxV: 1,
    });
  });

  it('is null when the image is off screen', () => {
    const viewport = { minX: 900, minY: 0, maxX: 1000, maxY: 100 };

    expect(visibleImageRect(box, IDENTITY, WHOLE, viewport)).toBeNull();
  });
});
