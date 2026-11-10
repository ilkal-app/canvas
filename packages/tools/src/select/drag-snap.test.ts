import { describe, expect, it } from 'vitest';

import { context, move } from './__fixtures__/drag-snap-steps.js';
import { snapMove } from './drag-snap.js';
import type { OrientedBox } from './oriented-box.js';

/** A 40 × 20 box right of the neighbour, 10 away. */
const START: OrientedBox = { x: 110, y: 200, width: 40, height: 20, rotation: 0 };

describe('snapMove', () => {
  it('adds the snap to the drag, so the box lands on the neighbour’s edge, with a guide', () => {
    const { intent, guides } = snapMove(move(-7, 0), START, context());
    expect(intent.delta).toEqual({ x: -10, y: 0 });
    expect(guides).toEqual([{ axis: 'x', position: 100, from: 0, to: 220 }]);
  });

  it('queries candidates around the moved box', () => {
    const snapping = context();
    snapMove(move(-7, 5), START, snapping);
    expect(snapping.asked).toEqual([{ minX: 103, minY: 205, maxX: 143, maxY: 225 }]);
  });

  it('snaps a Shift-locked move along its own axis only', () => {
    // Unlocked, y would snap from 97 to 100 as well.
    expect(snapMove(move(-7, -103), START, context()).intent.delta).toEqual({ x: -10, y: -100 });
    const locked = snapMove(move(-7, 0, true), { ...START, y: 97 }, context());
    expect(locked.intent.delta).toEqual({ x: -10, y: 0 });
    // Locked vertically, x stays even though 107 is 7 from nothing and 3 from nothing either way.
    const vertical = snapMove(move(0, -103, true), { ...START, x: 97 }, context());
    expect(vertical.intent.delta).toEqual({ x: 0, y: -100 });
  });

  it('snaps to the grid when no object is near', () => {
    const far = { ...START, x: 1000, y: 1000 };
    // Moved to x 1003–1043, y 1005–1025: the right edge 1043 → 1040 and the bottom 1025 → 1024
    // are the nearest grid lines.
    const { intent, guides } = snapMove(move(3, 5), far, context({ spacing: 16 }));
    expect(intent.delta).toEqual({ x: 0, y: 4 });
    expect(guides).toEqual([]);
  });

  it('snaps a turned selection by the bounds of its corners', () => {
    const turned = { x: 150, y: 200, width: 40, height: 20, rotation: Math.PI / 2 };
    // Turned a quarter about its top-left corner, it covers x 130–150: its left edge is 130.
    const { intent } = snapMove(move(-27, 0), turned, context());
    expect(intent.delta.x).toBeCloseTo(-30, 9);
  });
});
