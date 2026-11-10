import { describe, expect, it } from 'vitest';

import {
  followSelectionPopover,
  placeSelectionPopover,
  type SelectionPlacementRequest,
} from './selection-placement.js';

const VIEWPORT = { x: 0, y: 0, width: 1440, height: 900 };
const SIZE = { width: 370, height: 40 };

/**
 * A request for the design's 370 × 40 sticky popover in a 1440 × 900 viewport.
 *
 * @param overrides - What differs.
 * @returns The request.
 */
function request(
  overrides: Partial<SelectionPlacementRequest> & Pick<SelectionPlacementRequest, 'selection'>,
): SelectionPlacementRequest {
  return { size: SIZE, viewport: VIEWPORT, objects: [], reserved: [], ...overrides };
}

describe('placeSelectionPopover', () => {
  it('sits 14 px from the selection, centred on it', () => {
    // A selection below the centre: above is nearer the centre.
    const below = placeSelectionPopover(
      request({ selection: { x: 600, y: 500, width: 100, height: 100 } }),
    );
    expect(below).toEqual({ x: 465, y: 446, side: 'top', isClear: true });
    // Above the centre: below is nearer it.
    const above = placeSelectionPopover(
      request({ selection: { x: 600, y: 200, width: 100, height: 100 } }),
    );
    expect(above).toEqual({ x: 465, y: 314, side: 'bottom', isClear: true });
  });

  it('chooses the side that covers less of the board, even when it is farther from centre', () => {
    const selection = { x: 600, y: 500, width: 100, height: 100 };
    // Stickies right above the selection: the popover goes below instead.
    const objects = [{ x: 450, y: 420, width: 400, height: 60 }];
    expect(placeSelectionPopover(request({ selection, objects }))).toMatchObject({
      side: 'bottom',
      y: 614,
    });
    // Less covered above than below: above.
    const both = [
      { x: 450, y: 450, width: 100, height: 30 },
      { x: 450, y: 620, width: 400, height: 30 },
    ];
    expect(placeSelectionPopover(request({ selection, objects: both }))).toMatchObject({
      side: 'top',
    });
  });

  it('on a tie of coverage, takes the side nearer the screen centre', () => {
    const selection = { x: 600, y: 500, width: 100, height: 100 };
    const same = [
      { x: 465, y: 446, width: 10, height: 10 },
      { x: 465, y: 614, width: 10, height: 10 },
    ];
    expect(placeSelectionPopover(request({ selection, objects: same })).side).toBe('top');
    // Exactly centred: the first, above.
    const centred = { x: 600, y: 400, width: 100, height: 100 };
    expect(placeSelectionPopover(request({ selection: centred })).side).toBe('top');
  });

  it('never covers a reserved area: the dock below sends it above', () => {
    const selection = { x: 600, y: 700, width: 100, height: 80 };
    const dock = { x: 482, y: 834, width: 476, height: 50 };
    // Below (794–834) would touch only; move the selection so below overlaps the dock.
    const lower = { ...selection, y: 740 };
    expect(placeSelectionPopover(request({ selection: lower, reserved: [dock] }))).toMatchObject({
      side: 'top',
      y: 686,
      isClear: true,
    });
  });

  it('clamps inside the viewport when the selection is near an edge', () => {
    const selection = { x: 10, y: 500, width: 60, height: 60 };
    expect(placeSelectionPopover(request({ selection }))).toMatchObject({ x: 8, side: 'top' });
  });

  it('falls back to left or right when neither above nor below fits', () => {
    // As tall as the viewport, at its left: only the right has room.
    const selection = { x: 20, y: 0, width: 200, height: 900 };
    const placed = placeSelectionPopover(request({ selection }));
    expect(placed).toMatchObject({ side: 'right', x: 234, isClear: true });
    // Above and below reserved everywhere: left or right, whichever covers less.
    const middle = { x: 500, y: 300, width: 100, height: 100 };
    const bands = [
      { x: 0, y: 0, width: 1440, height: 290 },
      { x: 0, y: 410, width: 1440, height: 490 },
    ];
    const objects = [{ x: 600, y: 300, width: 500, height: 100 }];
    expect(
      placeSelectionPopover(request({ selection: middle, reserved: bands, objects })),
    ).toMatchObject({ side: 'left', isClear: true });
  });

  it('when nothing fits, says so and stays on screen', () => {
    const selection = { x: 0, y: 0, width: 1440, height: 900 };
    const placed = placeSelectionPopover(request({ selection }));
    expect(placed.isClear).toBe(false);
    expect(placed.x).toBeGreaterThanOrEqual(8);
    expect(placed.y).toBeGreaterThanOrEqual(8);
  });

  it('leaves its inputs alone', () => {
    const frozen = Object.freeze(
      request({
        selection: Object.freeze({ x: 600, y: 500, width: 100, height: 100 }),
        objects: Object.freeze([Object.freeze({ x: 0, y: 0, width: 10, height: 10 })]),
        reserved: Object.freeze([]),
      }),
    );
    expect(() => placeSelectionPopover(frozen)).not.toThrow();
  });
});

describe('followSelectionPopover (item 4)', () => {
  const follow = {
    size: SIZE,
    viewport: VIEWPORT,
    reserved: [],
  };

  it('keeps the side it was placed on, 14 px off and centred, as the selection moves', () => {
    const selection = { x: 300, y: 200, width: 100, height: 100 };
    expect(followSelectionPopover({ ...follow, selection, side: 'top' })).toEqual({
      x: 165,
      y: 146,
      side: 'top',
      isClear: true,
    });
    // Above the centre, where a new placement would choose below: it stays on top while moving.
    const moved = { ...selection, x: 340, y: 120 };
    expect(followSelectionPopover({ ...follow, selection: moved, side: 'top' })).toEqual({
      x: 205,
      y: 66,
      side: 'top',
      isClear: true,
    });
    expect(followSelectionPopover({ ...follow, selection: moved, side: 'bottom' })).toMatchObject({
      x: 205,
      y: 234,
      side: 'bottom',
    });
  });

  it('takes another side when its own has no room, and stays clear of reserved areas', () => {
    const nearTop = { x: 600, y: 20, width: 100, height: 100 };
    expect(followSelectionPopover({ ...follow, selection: nearTop, side: 'top' })).toMatchObject({
      side: 'bottom',
      y: 134,
    });
    const reserved = [{ x: 0, y: 420, width: 1440, height: 60 }];
    const selection = { x: 600, y: 500, width: 100, height: 100 };
    expect(followSelectionPopover({ ...follow, reserved, selection, side: 'top' })).toMatchObject({
      side: 'bottom',
    });
  });

  it('gives no place once the selection is off screen, and one while any of it shows', () => {
    for (const selection of [
      { x: -300, y: 400, width: 100, height: 100 },
      { x: 1500, y: 400, width: 100, height: 100 },
      { x: 600, y: -200, width: 100, height: 100 },
      { x: 600, y: 950, width: 100, height: 100 },
    ]) {
      expect(followSelectionPopover({ ...follow, selection, side: 'top' })).toBeUndefined();
    }
    const edge = { x: -90, y: 400, width: 100, height: 100 };
    expect(followSelectionPopover({ ...follow, selection: edge, side: 'top' })).toBeDefined();
  });
});
