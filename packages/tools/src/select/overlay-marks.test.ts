import { describe, expect, it } from 'vitest';

import type { Rgba } from '@canvas/schema';

import {
  dashedOutlineOf,
  dashWindowOf,
  MAX_LOCKED_DASHES,
  GAP_TICK_PX,
  gapRunOf,
  LOCKED_DASH_GAP_PX,
  LOCKED_DASH_PX,
  outlineOf,
} from './overlay-marks.js';

const GREY: Rgba = [0.4, 0.4, 0.4, 1];
const BOX = { x: 40, y: 40, width: 100, height: 60, rotation: 0 };

describe('dashedOutlineOf', () => {
  it('cuts each outline strip into dashes from its start, the corners drawn', () => {
    const dashes = dashedOutlineOf(BOX, 1, 1, GREY);
    const period = LOCKED_DASH_PX + LOCKED_DASH_GAP_PX;
    // The top strip runs 102 px from x 39: dashes at 39, 46, …, 4 px each, the last cut short.
    const top = dashes.filter(({ box }) => box.y === 39);
    expect(top).toHaveLength(Math.ceil(102 / period));
    expect(top[0]?.box).toEqual({ x: 39, y: 39, width: LOCKED_DASH_PX, height: 1, rotation: 0 });
    expect(top[1]?.box.x).toBe(39 + period);
    expect(top.at(-1)?.box).toMatchObject({ x: 39 + 14 * period, width: 4 });
    // The left strip runs down the side, 60 px from y 40.
    const left = dashes.filter(({ box }) => box.x === 39 && box.width === 1);
    expect(left).toHaveLength(Math.ceil(60 / period));
    expect(left[0]?.box).toMatchObject({ y: 40, height: LOCKED_DASH_PX });
    expect(dashes.every(({ color }) => color === GREY)).toBe(true);
  });

  it('keeps the dash pattern one screen size at another zoom, turned with the box', () => {
    const turned = { ...BOX, rotation: 0.3 };
    const dashes = dashedOutlineOf(turned, 0.5, 2, GREY);
    expect(dashes[0]?.box).toMatchObject({ width: LOCKED_DASH_PX / 2, height: 0.5, rotation: 0.3 });
    expect(dashes.length).toBeGreaterThan(outlineOf(turned, 0.5, GREY).length);
  });
});

describe('dashedOutlineOf in a window', () => {
  const big = { x: 0, y: 0, width: 1000, height: 1000, rotation: 0 };
  // At 32×, a 1280 × 800 view on the frame's top-left corner shows 40 × 25 world units.
  const view = { minX: -10, minY: -10, maxX: 30, maxY: 15 };

  it('cuts only the dashes in the window, not the ~18,300 of a 1,000-unit box’s whole outline at 32×', () => {
    const window = dashWindowOf(view);
    const dashes = dashedOutlineOf(big, 1 / 32, 32, GREY, window);
    expect(dashes.length).toBeGreaterThan(0);
    // At most the window's two crossing edges on screen, a dash every 7 px.
    const span = window.maxX - window.minX + (window.maxY - window.minY);
    expect(dashes.length).toBeLessThanOrEqual(Math.ceil((span * 32) / 7) + 4);
    expect(dashes.length).toBeLessThan(600);
    for (const { box } of dashes) {
      expect(box.x + box.width).toBeGreaterThanOrEqual(window.minX);
      expect(box.x).toBeLessThanOrEqual(window.maxX);
      expect(box.y + box.height).toBeGreaterThanOrEqual(window.minY);
      expect(box.y).toBeLessThanOrEqual(window.maxY);
    }
    // The pattern keeps its phase from the strip's start: the top strip's dashes start at
    // −1/32 + k × 7/32.
    const top = dashes.filter(({ box }) => box.height === 1 / 32 && box.y < 0);
    for (const { box } of top) expect(((box.x + 1 / 32) * 32) % 7).toBeCloseTo(0, 6);
  });

  it('draws the outline solid past the cap rather than every dash', () => {
    const whole = dashedOutlineOf(big, 1 / 32, 32, GREY);
    expect(whole).toEqual(outlineOf(big, 1 / 32, GREY));
    expect(MAX_LOCKED_DASHES).toBeLessThan((4 * 1000 * 32) / 7);
  });

  it('cuts nothing for a box outside the window', () => {
    expect(
      dashedOutlineOf(BOX, 1, 1, GREY, { minX: 500, minY: 500, maxX: 600, maxY: 600 }),
    ).toEqual([]);
  });
});

describe('dashWindowOf', () => {
  it('holds the view with a margin, snapped so a small pan keeps the same window', () => {
    const view = { minX: 3, minY: 5, maxX: 43, maxY: 30 };
    const window = dashWindowOf(view);
    expect(window.minX).toBeLessThanOrEqual(view.minX - 10);
    expect(window.maxX).toBeGreaterThanOrEqual(view.maxX + 10);
    expect(window.maxX - window.minX).toBeLessThanOrEqual(80);
    expect(window.maxY - window.minY).toBeLessThanOrEqual(50);
    expect(dashWindowOf({ minX: 4, minY: 6, maxX: 44, maxY: 31 })).toEqual(window);
  });
});

describe('gapRunOf', () => {
  it('draws a run across the gap with a tick at each end, one screen size', () => {
    const run = gapRunOf({ axis: 'x', from: 404, to: 428, position: 184 }, 0.5, 2, GREY);
    const tick = GAP_TICK_PX / 2;
    expect(run.map(({ box }) => box)).toEqual([
      { x: 404, y: 183.75, width: 24, height: 0.5, rotation: 0 },
      { x: 403.75, y: 184 - tick / 2, width: 0.5, height: tick, rotation: 0 },
      { x: 427.75, y: 184 - tick / 2, width: 0.5, height: tick, rotation: 0 },
    ]);
    const vertical = gapRunOf({ axis: 'y', from: 10, to: 30, position: 5 }, 1, 1, GREY);
    expect(vertical[0]?.box).toEqual({ x: 4.5, y: 10, width: 1, height: 20, rotation: 0 });
    expect(vertical[2]?.box).toEqual({
      x: 0.5,
      y: 29.5,
      width: GAP_TICK_PX,
      height: 1,
      rotation: 0,
    });
  });
});
