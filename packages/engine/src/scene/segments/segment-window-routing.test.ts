import { expect, it } from 'vitest';

import type { SegmentPlanInput } from './segment-plan.js';
import { mergingWindows, type RoutedChanges } from './segment-window-routing.js';
import { SegmentWindow } from './segment-window.js';

const owners = { rankOfSlot: Int32Array.of(0, -1, 2), recordOfSlot: new Int32Array(3) };
const passes = [{ name: 'text', owners }];
const input: SegmentPlanInput = { passes, visible: [], isOccluderByRank: new Uint8Array(4) };

/**
 * A window over one rank with no draws, never built.
 *
 * @param rank - Its rank.
 * @returns The window.
 */
function windowAt(rank: number): SegmentWindow {
  const cut = {
    entries: [],
    segmentCount: 0,
    hasSpatialMerges: false,
    build: () => {
      throw new Error('not built in this test');
    },
  };
  return new SegmentWindow(rank, rank + 1, rank, cut, input, () => []);
}

it("re-plans a hidden rank's window with its neighbours, skipping unowned slots", () => {
  const windows = [0, 1, 2, 3].map(windowAt);
  const routed: RoutedChanges = new Map();
  // Slot 1 has no owner: it names no window. Slot 2 is rank 2's.
  const merging = mergingWindows(new Map([['text', [1, 2]]]), windows, passes, routed);
  expect([...merging]).toEqual([windows[1], windows[2], windows[3]]);
  expect([...routed.keys()]).toEqual([windows[1], windows[2], windows[3]]);
  expect([...routed.values()].every((deltas) => deltas.size === 0)).toBe(true);
});

it('takes no neighbour past either end', () => {
  const windows = [0, 1].map(windowAt);
  const routed: RoutedChanges = new Map();
  const merging = mergingWindows(new Map([['text', [0]]]), windows, passes, routed);
  expect([...merging]).toEqual([windows[0], windows[1]]);
});
