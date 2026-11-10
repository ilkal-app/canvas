import { describe, expect, it } from 'vitest';

import { gridSpacingAt } from '@canvas/engine';

import { indexOf, mapSource, rect } from '../select/__fixtures__/select-board.js';

import { snapCreationPoint } from './creation-snap.js';

const NEIGHBOUR = rect('n', null, { x: 0, y: 0, width: 100, height: 100 });
const SNAP = { index: indexOf([NEIGHBOUR]), source: mapSource([NEIGHBOUR]) };
const ON = { isEnabled: true, isGridVisible: false };

describe('snapCreationPoint', () => {
  it("snaps a drag's corner to a neighbour's edges within 6 CSS px, with guides", () => {
    const request = { settings: ON, snap: SNAP, zoom: 1, viewport: undefined };
    const snapped = snapCreationPoint({ x: 104, y: 48 }, request);
    expect(snapped.point).toEqual({ x: 100, y: 50 });
    expect(snapped.guides.length).toBe(2);
  });

  it('snaps to the grid while it shows, and to nothing while snapping is off', () => {
    const grid = { isEnabled: true, isGridVisible: true };
    const spacing = gridSpacingAt(1);
    const far = { x: 5 * spacing + 1, y: 7 * spacing - 1 };
    const request = { settings: grid, snap: undefined, zoom: 1, viewport: undefined };
    expect(snapCreationPoint(far, request).point).toEqual({ x: 5 * spacing, y: 7 * spacing });
    const off = { ...request, settings: { isEnabled: false, isGridVisible: true } };
    expect(snapCreationPoint(far, off)).toEqual({ point: far, guides: [] });
  });

  it('looks for neighbours only on screen when given the viewport', () => {
    const viewport = { minX: 500, minY: 500, maxX: 900, maxY: 900 };
    const request = { settings: ON, snap: SNAP, zoom: 1, viewport };
    expect(snapCreationPoint({ x: 104, y: 48 }, request).point).toEqual({ x: 104, y: 48 });
  });
});
