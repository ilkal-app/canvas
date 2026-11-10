import { describe, expect, it } from 'vitest';

import { placePopover, type PlacementRequest, type ScreenRect } from './placement.js';

/**
 * Returns the positive area shared by two screen rectangles, in square pixels.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns Their overlap area.
 */
function sharedArea(a: ScreenRect, b: ScreenRect): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/**
 * Advances a fixed seed to make the geometry sweep repeatable.
 *
 * @param seed - Current unsigned seed.
 * @returns The next unsigned seed.
 */
function next(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

describe('placePopover acceptance', () => {
  it('keeps every clear seeded placement adjacent, inside the margin and off obstructions', () => {
    let seed = 608;
    for (let index = 0; index < 240; index += 1) {
      const draw = (limit: number): number => {
        seed = next(seed);
        return seed % limit;
      };
      const viewport = { x: 11, y: 23, width: 300 + draw(700), height: 240 + draw(500) };
      const anchor = {
        x: viewport.x + 8 + draw(viewport.width - 36),
        y: viewport.y + 8 + draw(viewport.height - 36),
        width: 8 + draw(20),
        height: 8 + draw(20),
      };
      const size = { width: 25 + draw(viewport.width - 40), height: 20 + draw(90) };
      const reserved = [
        {
          x: viewport.x + draw(viewport.width - 45),
          y: viewport.y + draw(viewport.height - 45),
          width: 45,
          height: 45,
        },
      ];
      const sides = ['top', 'bottom', 'left', 'right'] as const;
      const request: PlacementRequest = {
        anchor,
        size,
        viewport,
        reserved,
        side: sides[draw(4)] ?? 'top',
      };
      const result = placePopover(request);
      if (!result.isClear) continue;
      const box = { x: result.x, y: result.y, ...size };
      const context = JSON.stringify({ index, request, result });
      expect(box.x, context).toBeGreaterThanOrEqual(viewport.x + 8);
      expect(box.y, context).toBeGreaterThanOrEqual(viewport.y + 8);
      expect(box.x + box.width, context).toBeLessThanOrEqual(viewport.x + viewport.width - 8);
      expect(box.y + box.height, context).toBeLessThanOrEqual(viewport.y + viewport.height - 8);
      expect(sharedArea(box, anchor), context).toBe(0);
      expect(sharedArea(box, reserved[0] ?? viewport), context).toBe(0);
      if (result.side === 'top' || result.side === 'bottom') {
        const expectedY =
          result.side === 'top' ? anchor.y - 8 - size.height : anchor.y + anchor.height + 8;
        expect(box.y, context).toBe(expectedY);
        expect(
          Math.min(box.x + box.width, anchor.x + anchor.width) - Math.max(box.x, anchor.x),
          context,
        ).toBeGreaterThan(0);
      } else {
        const expectedX =
          result.side === 'left' ? anchor.x - 8 - size.width : anchor.x + anchor.width + 8;
        expect(box.x, context).toBe(expectedX);
        expect(
          Math.min(box.y + box.height, anchor.y + anchor.height) - Math.max(box.y, anchor.y),
          context,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('tries the preferred side, then its opposite, then the perpendicular sides', () => {
    const viewport = { x: 0, y: 0, width: 400, height: 300 };
    const size = { width: 90, height: 30 };
    const anchor = { x: 160, y: 100, width: 80, height: 80 };
    expect(placePopover({ anchor, size, viewport, side: 'top' }).side).toBe('top');
    expect(placePopover({ anchor: { ...anchor, y: 12 }, size, viewport, side: 'top' }).side).toBe(
      'bottom',
    );
    const tallAnchor = { x: 160, y: 0, width: 80, height: 300 };
    expect(placePopover({ anchor: tallAnchor, size, viewport, side: 'top' }).side).toBe('right');
  });

  it('mirrors horizontal start and end in RTL but keeps vertical start at the top', () => {
    const base = {
      anchor: { x: 150, y: 120, width: 70, height: 60 },
      size: { width: 40, height: 25 },
      viewport: { x: 0, y: 0, width: 500, height: 400 },
      direction: 'rtl' as const,
    };
    expect(placePopover({ ...base, side: 'top', align: 'start' }).x).toBe(180);
    expect(placePopover({ ...base, side: 'top', align: 'end' }).x).toBe(150);
    expect(placePopover({ ...base, side: 'left', align: 'start' }).y).toBe(120);
    expect(placePopover({ ...base, side: 'left', align: 'end' }).y).toBe(155);
  });

  it('slides beside part of the anchor to clear a reservation, and flips when that is impossible', () => {
    const base = {
      anchor: { x: 150, y: 120, width: 70, height: 60 },
      size: { width: 80, height: 30 },
      viewport: { x: 0, y: 0, width: 500, height: 400 },
      side: 'top' as const,
    };
    expect(
      placePopover({ ...base, reserved: [{ x: 145, y: 70, width: 50, height: 50 }] }),
    ).toMatchObject({ side: 'top', x: 195, isClear: true });
    expect(
      placePopover({ ...base, reserved: [{ x: 60, y: 70, width: 250, height: 50 }] }),
    ).toMatchObject({ side: 'bottom', isClear: true });
  });

  it('reports obstruction when all sides are blocked and leaves frozen inputs unchanged', () => {
    const viewport = Object.freeze({ x: 0, y: 0, width: 300, height: 200 });
    const anchor = Object.freeze({ x: 130, y: 80, width: 40, height: 40 });
    const reserved = Object.freeze([Object.freeze({ ...viewport })]);
    const request = Object.freeze({
      anchor,
      size: Object.freeze({ width: 60, height: 30 }),
      viewport,
      side: 'top' as const,
      reserved,
    });
    const before = JSON.stringify(request);
    const result = placePopover(request);
    expect(result.isClear).toBe(false);
    expect(result.x).toBeGreaterThanOrEqual(8);
    expect(result.y).toBeGreaterThanOrEqual(8);
    expect(result.x + request.size.width).toBeLessThanOrEqual(292);
    expect(result.y + request.size.height).toBeLessThanOrEqual(192);
    expect(JSON.stringify(request)).toBe(before);
  });
});
