import { describe, expect, it } from 'vitest';

import { placePopover, type PlacementRequest, type ScreenRect } from './placement.js';

const VIEWPORT: ScreenRect = { x: 0, y: 0, width: 1440, height: 900 };
const SIZE = { width: 200, height: 40 };

/**
 * A request for a 200 × 40 popover in a 1440 × 900 viewport, with the given overrides.
 *
 * @param overrides - What differs.
 * @returns The request.
 */
function request(
  overrides: Partial<PlacementRequest> & Pick<PlacementRequest, 'anchor'>,
): PlacementRequest {
  return { size: SIZE, viewport: VIEWPORT, side: 'top', ...overrides };
}

describe('placePopover', () => {
  it('opens on the preferred side, centred, the gap away from the anchor', () => {
    const anchor = { x: 600, y: 400, width: 100, height: 100 };
    expect(placePopover(request({ anchor, gap: 8 }))).toEqual({
      x: 550,
      y: 352,
      side: 'top',
      isClear: true,
    });
    expect(placePopover(request({ anchor, side: 'bottom', gap: 6 }))).toEqual({
      x: 550,
      y: 506,
      side: 'bottom',
      isClear: true,
    });
    expect(placePopover(request({ anchor, side: 'right' }))).toEqual({
      x: 708,
      y: 430,
      side: 'right',
      isClear: true,
    });
    expect(placePopover(request({ anchor, side: 'left' }))).toEqual({
      x: 392,
      y: 430,
      side: 'left',
      isClear: true,
    });
  });

  it('defaults to an 8 px gap and an 8 px margin', () => {
    const anchor = { x: 600, y: 48, width: 100, height: 100 };
    // 48 - 8 - 40 = 0 is inside the viewport but not its 8 px margin: it flips below.
    expect(placePopover(request({ anchor }))).toMatchObject({ y: 156, side: 'bottom' });
    expect(placePopover(request({ anchor: { ...anchor, y: 56 } }))).toMatchObject({
      y: 8,
      side: 'top',
    });
  });

  it('flips to the opposite side when the preferred one has no room', () => {
    const nearTop = { x: 600, y: 20, width: 100, height: 60 };
    expect(placePopover(request({ anchor: nearTop }))).toMatchObject({ side: 'bottom', y: 88 });
    const nearBottom = { x: 600, y: 840, width: 100, height: 40 };
    expect(placePopover(request({ anchor: nearBottom, side: 'bottom' }))).toMatchObject({
      side: 'top',
      y: 792,
    });
    const nearRight = { x: 1300, y: 400, width: 100, height: 100 };
    expect(placePopover(request({ anchor: nearRight, side: 'right' }))).toMatchObject({
      side: 'left',
      x: 1092,
    });
  });

  it('tries the other axis when neither the side nor its opposite has room', () => {
    // As tall as the viewport: nothing above or below, room on the right.
    const anchor = { x: 200, y: 0, width: 100, height: 900 };
    expect(placePopover(request({ anchor }))).toMatchObject({
      side: 'right',
      x: 308,
      isClear: true,
    });
  });

  it('slides along the side to stay inside the viewport margin', () => {
    const atLeft = { x: 0, y: 400, width: 40, height: 40 };
    expect(placePopover(request({ anchor: atLeft }))).toMatchObject({ x: 8, side: 'top' });
    const atRight = { x: 1420, y: 400, width: 20, height: 40 };
    expect(placePopover(request({ anchor: atRight, margin: 16 }))).toMatchObject({
      x: 1224,
      side: 'top',
    });
  });

  it('lines up start and end edges, mirrored in a right-to-left page', () => {
    const anchor = { x: 600, y: 400, width: 100, height: 100 };
    expect(placePopover(request({ anchor, align: 'start' })).x).toBe(600);
    expect(placePopover(request({ anchor, align: 'end' })).x).toBe(500);
    expect(placePopover(request({ anchor, align: 'start', direction: 'rtl' })).x).toBe(500);
    expect(placePopover(request({ anchor, align: 'end', direction: 'rtl' })).x).toBe(600);
    // Beside the anchor, start is the top in either direction.
    expect(
      placePopover(request({ anchor, side: 'right', align: 'start', direction: 'rtl' })).y,
    ).toBe(400);
  });

  it('slides clear of a reserved area on the same side', () => {
    // The dock: 360 wide at the bottom centre.
    const dock = { x: 540, y: 820, width: 360, height: 64 };
    const anchor = { x: 650, y: 700, width: 100, height: 100 };
    const placed = placePopover(request({ anchor, side: 'bottom', reserved: [dock] }));
    // Below there is 808 - 892: inside the margin, but the dock is there; on top there is room.
    expect(placed).toMatchObject({ side: 'top', y: 652, isClear: true });
    // A reserved area beside the aligned spot: slide along the side to just clear it.
    const card = { x: 560, y: 340, width: 60, height: 60 };
    const slid = placePopover(
      request({ anchor: { x: 600, y: 400, width: 100, height: 100 }, reserved: [card] }),
    );
    expect(slid).toEqual({ x: 620, y: 352, side: 'top', isClear: true });
  });

  it('prefers the nearest clear spot along a side to flipping', () => {
    const anchor = { x: 600, y: 400, width: 100, height: 100 };
    // Covers the right part of the aligned spot (550-750): just before it (500-700) is still
    // beside the anchor; just after it (760-960) is not, so it is no candidate.
    const right = { x: 700, y: 300, width: 60, height: 100 };
    expect(placePopover(request({ anchor, reserved: [right] }))).toEqual({
      x: 500,
      y: 352,
      side: 'top',
      isClear: true,
    });
  });

  it('flips rather than slide away from the anchor', () => {
    const anchor = { x: 600, y: 400, width: 100, height: 100 };
    // Covers every spot above that is beside the anchor.
    const above = { x: 400, y: 300, width: 500, height: 100 };
    expect(placePopover(request({ anchor, reserved: [above] }))).toMatchObject({
      side: 'bottom',
      x: 550,
      y: 508,
      isClear: true,
    });
  });

  it('when nothing fits, says so and stays inside the viewport', () => {
    const tiny = { x: 0, y: 0, width: 120, height: 60 };
    const anchor = { x: 40, y: 20, width: 40, height: 20 };
    const placed = placePopover({ anchor, size: SIZE, viewport: tiny, side: 'top' });
    expect(placed.isClear).toBe(false);
    // Wider than the room: its start edge stays on screen at the margin.
    expect(placed.x).toBe(8);
    expect(placed.y).toBeGreaterThanOrEqual(8);
  });

  it('when every side with room is reserved, takes the least covered spot', () => {
    const anchor = { x: 600, y: 400, width: 100, height: 100 };
    const everywhere = { x: 0, y: 0, width: 1440, height: 900 };
    const placed = placePopover(request({ anchor, reserved: [everywhere] }));
    expect(placed).toMatchObject({ side: 'top', isClear: false, x: 550, y: 352 });
  });

  it('leaves its inputs alone', () => {
    const anchor = Object.freeze({ x: 1, y: 2, width: 3, height: 4 });
    const reserved = Object.freeze([Object.freeze({ x: 0, y: 0, width: 10, height: 10 })]);
    const frozen = Object.freeze(request({ anchor, reserved }));
    expect(() => placePopover(frozen)).not.toThrow();
  });
});
