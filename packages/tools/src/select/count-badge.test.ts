import { describe, expect, it } from 'vitest';

import {
  COUNT_BADGE_GAP_PX,
  COUNT_BADGE_HEIGHT_PX,
  COUNT_BADGE_MARGIN_PX,
  countBadgeLayout,
} from './count-badge.js';
import type { OrientedBox } from './oriented-box.js';

const FRAME: OrientedBox = { x: 20, y: 10, width: 238, height: 158, rotation: 0 };

/**
 * A box's corners as numbers, for exact comparison.
 *
 * @param box - The box.
 * @returns `[x, y, width, height]`.
 */
function extent(box: OrientedBox | undefined): number[] {
  return box === undefined ? [] : [box.x, box.y, box.width, box.height];
}

describe('countBadgeLayout', () => {
  it('centres the badge below the frame, sized to its digits, in CSS px at 100%', () => {
    const { badge } = countBadgeLayout(FRAME, 600, 1);
    // Three digits of 6 px, 2 px apart, 4 px padding each side: 30 × 16.
    expect(COUNT_BADGE_HEIGHT_PX).toBe(16);
    expect(extent(badge)).toEqual([124, 168 + COUNT_BADGE_GAP_PX, 30, 16]);
    expect(extent(countBadgeLayout(FRAME, 50_000, 1).badge)).toEqual([116, 180, 46, 16]);
  });

  it('draws each digit with its seven-segment strokes', () => {
    const segmentsOf = (count: number): number => countBadgeLayout(FRAME, count, 1).segments.length;
    expect([segmentsOf(1), segmentsOf(7), segmentsOf(8), segmentsOf(600)]).toEqual([2, 3, 7, 18]);
    // The 6 of 600: its top stroke is 6 × 2 at the first digit's corner, (128, 183).
    expect(extent(countBadgeLayout(FRAME, 600, 1).segments[0])).toEqual([128, 183, 6, 2]);
  });

  it('keeps one screen size at any zoom', () => {
    const { badge, segments } = countBadgeLayout(FRAME, 600, 2);
    expect(extent(badge)).toEqual([131.5, 174, 15, 8]);
    expect(segments[0]?.width).toBe(3);
  });

  it('turns with the frame, below its own bottom edge', () => {
    const turned = { ...FRAME, x: 0, y: 0, rotation: Math.PI / 2 };
    const { badge, segments } = countBadgeLayout(turned, 600, 1);
    expect(badge.rotation).toBe(Math.PI / 2);
    expect(segments.every(({ rotation }) => rotation === Math.PI / 2)).toBe(true);
    // A quarter turn clockwise maps the badge's local corner (104, 170) to the world (−170, 104).
    expect(badge.x).toBeCloseTo(-170, 9);
    expect(badge.y).toBeCloseTo(104, 9);
  });
});

describe('countBadgeLayout in a viewport', () => {
  // The badge for 600 is 30 × 16; the frame spans (20, 10) to (258, 168).
  const view = (minX: number, minY: number, maxX: number, maxY: number) => ({
    minX,
    minY,
    maxX,
    maxY,
  });

  it('stays below the frame where it fits there, 8 px inside the edges', () => {
    const { badge } = countBadgeLayout(FRAME, 600, 1, view(0, 0, 280, 204));
    expect(extent(badge)).toEqual([124, 180, 30, 16]);
    expect(COUNT_BADGE_MARGIN_PX).toBe(8);
  });

  it('goes above the frame when below would leave the viewport', () => {
    const { badge, segments } = countBadgeLayout(FRAME, 600, 1, view(0, -40, 280, 190));
    expect(extent(badge)).toEqual([124, 10 - 12 - 16, 30, 16]);
    // The digits move with it.
    expect(extent(segments[0])).toEqual([128, -15, 6, 2]);
  });

  it('slides along an unturned frame wider than the viewport to stay in view', () => {
    const { badge } = countBadgeLayout(FRAME, 600, 1, view(150, 0, 250, 250));
    expect(extent(badge)).toEqual([150 + 8, 180, 30, 16]);
  });

  it('pins to the bottom edge under the frame’s centre when neither side is in view', () => {
    // Zoomed in to 4× inside the frame: 100 × 50 CSS px of view, the margin 2 world units.
    const { badge } = countBadgeLayout(FRAME, 600, 4, view(100, 60, 125, 72.5));
    expect(extent(badge)).toEqual([125 - 2 - 7.5, 72.5 - 2 - 4, 7.5, 4]);
    expect(badge.rotation).toBe(0);
  });
});
