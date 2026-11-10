import { describe, expect, it } from 'vitest';

import { HANDLE_HIT_SIZE_PX, HANDLE_SIZE_PX, handleLayout, hitHandle } from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';

const FRAME: OrientedBox = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };

describe('handleLayout', () => {
  it('places eight resize handles on the corners and edges, and no rotate handle', () => {
    const layout = handleLayout(FRAME, 1, true);
    expect(layout.map(({ handle, centre }) => [handle, centre.x, centre.y])).toEqual([
      ['nw', 100, 100],
      ['ne', 300, 100],
      ['se', 300, 200],
      ['sw', 100, 200],
      ['n', 200, 100],
      ['e', 300, 150],
      ['s', 200, 200],
      ['w', 100, 150],
    ]);
    expect(layout.every(({ size }) => size === HANDLE_SIZE_PX)).toBe(true);
  });

  it('keeps handles a constant screen size: world size shrinks as zoom grows', () => {
    const layout = handleLayout(FRAME, 4, true);
    expect(layout[0]?.size).toBe(HANDLE_SIZE_PX / 4);
    expect(layout[0]?.centre).toEqual({ x: 100, y: 100 });
  });

  it('turns with a rotated frame: the "n" handle stays on the frame’s own top edge', () => {
    const turned = { ...FRAME, rotation: Math.PI / 2 };
    const north = handleLayout(turned, 1, true).find(({ handle }) => handle === 'n');
    // Local x of a quarter-turned frame is world +y: local (100, 0) is world (100, 200).
    expect(north?.centre.x).toBeCloseTo(100, 9);
    expect(north?.centre.y).toBeCloseTo(200, 9);
  });

  it('offers no handles when the selection cannot be resized', () => {
    expect(handleLayout(FRAME, 1, false)).toEqual([]);
  });
});

describe('hitHandle', () => {
  it('finds the handle within half its hit size of the point, in screen pixels', () => {
    const reach = HANDLE_HIT_SIZE_PX / 2;
    expect(hitHandle(FRAME, 1, { x: 300 + reach, y: 200 - reach }, true)).toBe('se');
    expect(hitHandle(FRAME, 1, { x: 300 + reach + 0.5, y: 200 }, true)).toBeUndefined();
    expect(hitHandle(FRAME, 2, { x: 300 + reach / 2, y: 200 }, true)).toBe('se');
    expect(hitHandle(FRAME, 2, { x: 300 + reach, y: 200 }, true)).toBeUndefined();
  });

  it('finds edge handles, and nothing in the frame’s middle or where the rotate handle was', () => {
    expect(hitHandle(FRAME, 1, { x: 200, y: 76 }, true)).toBeUndefined();
    expect(hitHandle(FRAME, 1, { x: 100, y: 150 }, true)).toBe('w');
    expect(hitHandle(FRAME, 1, { x: 200, y: 150 }, true)).toBeUndefined();
  });

  it('hits handles of a rotated frame where they are drawn', () => {
    const turned = { ...FRAME, rotation: Math.PI / 2 };
    // The frame's local (200, 100) corner, "se", is at world (0, 300).
    expect(hitHandle(turned, 1, { x: 1, y: 299 }, true)).toBe('se');
  });

  it('prefers a corner over an edge when a tiny frame makes them overlap', () => {
    const tiny = { ...FRAME, width: 4, height: 4 };
    expect(hitHandle(tiny, 1, { x: 101, y: 101 }, true)).toBe('nw');
  });

  it('ignores resize handles when the selection cannot be resized', () => {
    expect(hitHandle(FRAME, 1, { x: 300, y: 200 }, false)).toBeUndefined();
  });

  it('offers only one axis’s edge handles when asked (a group with no length along the other)', () => {
    const frame = { x: 0, y: 0, width: 0, height: 100, rotation: 0 };
    expect(handleLayout(frame, 1, 'y').map(({ handle }) => handle)).toEqual(['n', 's']);
    expect(handleLayout(frame, 1, 'x').map(({ handle }) => handle)).toEqual(['e', 'w']);
    expect(hitHandle(frame, 1, { x: 0, y: 100 }, 'y')).toBe('s');
    expect(hitHandle(frame, 1, { x: 0, y: 50 }, 'y')).toBeUndefined();
  });
});
