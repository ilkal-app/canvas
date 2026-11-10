import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { HANDLE_HIT_SIZE_PX } from './handle-layout.js';
import { boxPointToWorld, type OrientedBox } from './oriented-box.js';
import { hitRotationBand, ROTATION_BAND_WIDTH_PX } from './rotation-band.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

/** Where the band starts and ends at 100%, CSS px from the corner: 6 and 18. */
const INNER = HANDLE_HIT_SIZE_PX / 2;
const OUTER = INNER + ROTATION_BAND_WIDTH_PX;

/**
 * A point straight out from a corner along its diagonal.
 *
 * @param corner - The corner, world units.
 * @param sx - −1 or +1: which way is out along x.
 * @param sy - −1 or +1: which way is out along y.
 * @param distance - How far out, world units.
 * @returns The point.
 */
function diagonal(corner: Point, sx: number, sy: number, distance: number): Point {
  const step = distance / Math.SQRT2;
  return { x: corner.x + sx * step, y: corner.y + sy * step };
}

describe('hitRotationBand', () => {
  it('finds each corner’s band just outside it, along the diagonal', () => {
    expect(hitRotationBand(FRAME, 1, diagonal({ x: 100, y: 100 }, -1, -1, 12))).toBe('nw');
    expect(hitRotationBand(FRAME, 1, diagonal({ x: 300, y: 100 }, 1, -1, 12))).toBe('ne');
    expect(hitRotationBand(FRAME, 1, diagonal({ x: 300, y: 200 }, 1, 1, 12))).toBe('se');
    expect(hitRotationBand(FRAME, 1, diagonal({ x: 100, y: 200 }, -1, 1, 12))).toBe('sw');
  });

  it('starts at the corner handle’s pickable edge and reaches 12 px beyond it', () => {
    const corner = { x: 300, y: 200 };
    expect(hitRotationBand(FRAME, 1, diagonal(corner, 1, 1, INNER - 0.5))).toBeUndefined();
    expect(hitRotationBand(FRAME, 1, diagonal(corner, 1, 1, INNER + 0.5))).toBe('se');
    expect(hitRotationBand(FRAME, 1, diagonal(corner, 1, 1, OUTER - 0.5))).toBe('se');
    expect(hitRotationBand(FRAME, 1, diagonal(corner, 1, 1, OUTER + 0.5))).toBeUndefined();
  });

  it('is a quarter ring: straight out along either edge’s line, but not beside an edge', () => {
    expect(hitRotationBand(FRAME, 1, { x: 300 + 10, y: 200 })).toBe('se');
    expect(hitRotationBand(FRAME, 1, { x: 300, y: 200 + 10 })).toBe('se');
    // Right of the right edge, 5 px above the corner: beside the edge, not past the corner.
    expect(hitRotationBand(FRAME, 1, { x: 300 + 10, y: 200 - 5 })).toBeUndefined();
    // Below the bottom edge, 5 px left of the corner.
    expect(hitRotationBand(FRAME, 1, { x: 300 - 5, y: 200 + 10 })).toBeUndefined();
  });

  it('never fires inside the box or far from a corner', () => {
    expect(hitRotationBand(FRAME, 1, { x: 290, y: 190 })).toBeUndefined();
    expect(hitRotationBand(FRAME, 1, { x: 200, y: 150 })).toBeUndefined();
    expect(hitRotationBand(FRAME, 1, { x: 200, y: 90 })).toBeUndefined();
  });

  it('keeps one screen size at every zoom: world reach is divided by the zoom', () => {
    const corner = { x: 100, y: 100 };
    for (const zoom of [0.25, 0.5, 2, 8]) {
      const at = (screenPx: number) => diagonal(corner, -1, -1, screenPx / zoom);
      expect(hitRotationBand(FRAME, zoom, at(INNER - 0.5))).toBeUndefined();
      expect(hitRotationBand(FRAME, zoom, at(INNER + 0.5))).toBe('nw');
      expect(hitRotationBand(FRAME, zoom, at(OUTER - 0.5))).toBe('nw');
      expect(hitRotationBand(FRAME, zoom, at(OUTER + 0.5))).toBeUndefined();
    }
  });

  it('follows a rotated box: the band sits outside the box’s own corner', () => {
    for (const rotation of [Math.PI / 2, Math.PI / 6, -2.5]) {
      const turned = { ...FRAME, rotation };
      const local = (x: number, y: number) => boxPointToWorld(turned, { x, y });
      expect(hitRotationBand(turned, 1, local(-8, -8))).toBe('nw');
      expect(hitRotationBand(turned, 1, local(208, -8))).toBe('ne');
      expect(hitRotationBand(turned, 1, local(208, 108))).toBe('se');
      expect(hitRotationBand(turned, 1, local(-8, 108))).toBe('sw');
      expect(hitRotationBand(turned, 1, local(8, 8))).toBeUndefined();
      expect(hitRotationBand(turned, 1, local(-8, 8))).toBeUndefined();
    }
    // A quarter turn: the unturned box's "nw" band, up and left of (100, 100), is now beside
    // the turned box's left edge, clear of every corner.
    expect(hitRotationBand({ ...FRAME, rotation: Math.PI / 2 }, 1, { x: 92, y: 92 })).toBe(
      undefined,
    );
  });
});
