import { describe, expect, it } from 'vitest';

import type { ScreenRect } from '../controls/placement.js';

import { placeSelectionPopover, type SelectionPlacementRequest } from './selection-placement.js';

const VIEWPORT = { x: 25, y: 35, width: 900, height: 600 };
const SIZE = { width: 170, height: 40 };

/**
 * The shared area of two screen rectangles.
 *
 * @param first - One rectangle.
 * @param second - Another rectangle.
 * @returns Their overlap area.
 */
function coveredArea(first: ScreenRect, second: ScreenRect): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

/**
 * A fixed sequence of repeatable whole numbers.
 *
 * @param seed - The initial state.
 * @returns A function yielding the next number.
 */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

describe('selection placement acceptance', () => {
  it('keeps every clear placement 14 px from its selection, inside the margin and off reserved chrome', () => {
    const next = sequence(625);
    let clearCount = 0;
    for (let index = 0; index < 300; index += 1) {
      const selection = {
        x: 25 + (next() % 820),
        y: 35 + (next() % 520),
        width: 35 + (next() % 45),
        height: 25 + (next() % 45),
      };
      const reserved = [{ x: 25 + (next() % 700), y: 35 + (next() % 500), width: 80, height: 55 }];
      const result = placeSelectionPopover({
        selection,
        size: SIZE,
        viewport: VIEWPORT,
        objects: [],
        reserved,
      });
      if (!result.isClear) continue;
      clearCount += 1;
      const box = { x: result.x, y: result.y, ...SIZE };
      expect(box.x).toBeGreaterThanOrEqual(VIEWPORT.x + 8);
      expect(box.y).toBeGreaterThanOrEqual(VIEWPORT.y + 8);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.x + VIEWPORT.width - 8);
      expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.y + VIEWPORT.height - 8);
      for (const zone of reserved) expect(coveredArea(box, zone)).toBe(0);
      const gap =
        result.side === 'top'
          ? selection.y - box.y - box.height
          : result.side === 'bottom'
            ? box.y - selection.y - selection.height
            : result.side === 'left'
              ? selection.x - box.x - box.width
              : box.x - selection.x - selection.width;
      expect(gap).toBe(14);
    }
    expect(clearCount).toBeGreaterThan(200);
  });

  it('selects the less covered vertical candidate before considering distance from centre', () => {
    const selection = { x: 440, y: 350, width: 80, height: 60 };
    const above = { x: 395, y: 296, ...SIZE };
    const below = { x: 395, y: 424, ...SIZE };
    const next = sequence(12625);
    for (let index = 0; index < 100; index += 1) {
      const objects = Array.from({ length: 5 }, () => ({
        x: 25 + (next() % 850),
        y: 35 + (next() % 560),
        width: 20 + (next() % 100),
        height: 20 + (next() % 90),
      }));
      const request: SelectionPlacementRequest = {
        selection,
        size: SIZE,
        viewport: VIEWPORT,
        objects,
        reserved: [],
      };
      const result = placeSelectionPopover(request);
      const topCost = objects.reduce((sum, object) => sum + coveredArea(above, object), 0);
      const bottomCost = objects.reduce((sum, object) => sum + coveredArea(below, object), 0);
      expect(result.side).toBe(topCost <= bottomCost ? 'top' : 'bottom');
    }
  });

  it('weighs left and right when reserved bands block both vertical sides', () => {
    const selection = { x: 440, y: 280, width: 80, height: 60 };
    const reserved = [
      { x: 25, y: 35, width: 900, height: 231 },
      { x: 25, y: 354, width: 900, height: 281 },
    ];
    const objects = [{ x: 534, y: 250, width: 170, height: 100 }];
    const result = placeSelectionPopover({
      selection,
      size: SIZE,
      viewport: VIEWPORT,
      reserved,
      objects,
    });
    expect(result).toMatchObject({ side: 'left', isClear: true, x: 256 });
  });

  it('does not mutate a frozen request and marks an impossible placement unclear but on screen', () => {
    const selection = Object.freeze({ x: 25, y: 35, width: 900, height: 600 });
    const request = Object.freeze({
      selection,
      size: Object.freeze(SIZE),
      viewport: Object.freeze(VIEWPORT),
      objects: Object.freeze([]),
      reserved: Object.freeze([]),
    });
    const result = placeSelectionPopover(request);
    expect(result.isClear).toBe(false);
    expect(result.x).toBeGreaterThanOrEqual(33);
    expect(result.y).toBeGreaterThanOrEqual(43);
    expect(result.x + SIZE.width).toBeLessThanOrEqual(917);
    expect(result.y + SIZE.height).toBeLessThanOrEqual(627);
  });
});
