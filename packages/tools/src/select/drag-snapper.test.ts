import { describe, expect, it } from 'vitest';

import type { SpatialSearch } from '@canvas/engine';

import { move } from './__fixtures__/drag-snap-steps.js';
import { id, indexOf, mapSource, selectBoardObjects } from './__fixtures__/select-board.js';
import { DragSnapper, type SnapView } from './drag-snapper.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectPointer } from './select-input.js';

const OBJECTS = selectBoardObjects();
const SOURCE = mapSource(OBJECTS);
/** rect-a's frame: it moves by 47 to put its right edge 3 short of rect-b's turned left edge. */
const RECT_A: OrientedBox = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
const VIEW: SnapView = {
  settings: { isEnabled: true, isGridVisible: false },
  viewport: { minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 },
};

function pointer(isSnapSuspended = false): SelectPointer {
  const point = { x: 97, y: 25 };
  return {
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    isSnapSuspended,
  };
}

/**
 * An index that counts its queries.
 *
 * @returns The index and its query count.
 */
function countingIndex(): { index: SpatialSearch; queries: () => number } {
  const inner = indexOf(OBJECTS);
  let count = 0;
  return {
    index: {
      searchRect: (rect) => {
        count += 1;
        return inner.searchRect(rect);
      },
    },
    queries: () => count,
  };
}

describe('DragSnapper', () => {
  it('snaps with the view the last input brought and keeps the guides until cleared', () => {
    const snapper = new DragSnapper(indexOf(OBJECTS), SOURCE);
    snapper.follow(pointer(), 1, VIEW);
    const intent = snapper.snap(move(47, 0), [id('rect-a')], RECT_A);
    expect(intent).toMatchObject({ delta: { x: 50, y: 0 } });
    expect(snapper.guides.length).toBeGreaterThan(0);
    snapper.clear();
    expect(snapper.guides).toEqual([]);
  });

  it('leaves the intent as it is, with no guides, when the input brought no view', () => {
    const snapper = new DragSnapper(indexOf(OBJECTS), SOURCE);
    snapper.follow(pointer(), 1, VIEW);
    snapper.snap(move(47, 0), [id('rect-a')], RECT_A);
    snapper.follow(pointer(), 1, undefined);
    const raw = move(47, 0);
    expect(snapper.snap(raw, [id('rect-a')], RECT_A)).toBe(raw);
    expect(snapper.guides).toEqual([]);
  });

  it('does not snap while the input holds the snap modifier', () => {
    const snapper = new DragSnapper(indexOf(OBJECTS), SOURCE);
    snapper.follow(pointer(true), 1, VIEW);
    const raw = move(47, 0);
    expect(snapper.snap(raw, [id('rect-a')], RECT_A)).toBe(raw);
    expect(snapper.guides).toEqual([]);
  });

  it('queries the index on every step, but works out each neighbour’s box once per gesture', () => {
    const { index, queries } = countingIndex();
    let reads = 0;
    const source = {
      get: (objectId: Parameters<typeof SOURCE.get>[0]) => {
        reads += 1;
        return SOURCE.get(objectId);
      },
      childrenOf: (objectId: Parameters<typeof SOURCE.childrenOf>[0]) =>
        SOURCE.childrenOf(objectId),
    };
    const snapper = new DragSnapper(index, source);
    snapper.follow(pointer(), 1, VIEW);
    snapper.snap(move(47, 0), [id('rect-a')], RECT_A);
    const firstReads = reads;
    snapper.snap(move(48, 0), [id('rect-a')], RECT_A);
    // Six strips a step.
    expect(queries()).toBe(12);
    expect(reads - firstReads).toBeLessThan(firstReads);
  });
});
