import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { OrientedBox } from './oriented-box.js';
import { MAX_OUTLINED_OBJECTS, selectionOutlinesOf } from './selection-outlines.js';

/**
 * `count` object ids.
 *
 * @param count - How many.
 * @returns The ids, `o0`, `o1`, ….
 */
function ids(count: number): ObjectId[] {
  return [...Array(count).keys()].map((index) => `o${String(index)}` as ObjectId);
}

/**
 * Each object's box: 10 × 10 at (index × 20, 0).
 *
 * @param id - The object, `o<index>`.
 * @returns Its box.
 */
function boxOf(id: ObjectId): OrientedBox {
  return { x: Number(id.slice(1)) * 20, y: 0, width: 10, height: 10, rotation: 0 };
}

describe('selectionOutlinesOf', () => {
  it('outlines nothing and counts nothing for one object or none', () => {
    const none = { outlines: [], countBadge: undefined };
    expect(selectionOutlinesOf([], boxOf)).toEqual(none);
    expect(selectionOutlinesOf(ids(1), boxOf)).toEqual(none);
  });

  it('outlines each object of a multi-selection, skipping ids without a box', () => {
    const boxes = selectionOutlinesOf(ids(3), (id) => (id === 'o1' ? undefined : boxOf(id)));
    expect(boxes).toEqual({
      outlines: [boxOf('o0' as ObjectId), boxOf('o2' as ObjectId)],
      countBadge: undefined,
    });
  });

  it('still outlines every object at the cap', () => {
    const { outlines, countBadge } = selectionOutlinesOf(ids(MAX_OUTLINED_OBJECTS), boxOf);
    expect([outlines.length, countBadge]).toEqual([MAX_OUTLINED_OBJECTS, undefined]);
  });

  it('above the cap, counts the selection instead of outlining it, without reading a box', () => {
    const lookUp = vi.fn(boxOf);
    const count = MAX_OUTLINED_OBJECTS + 1;
    expect(selectionOutlinesOf(ids(count), lookUp)).toEqual({ outlines: [], countBadge: count });
    expect(selectionOutlinesOf(ids(50_000), lookUp).countBadge).toBe(50_000);
    expect(lookUp).not.toHaveBeenCalled();
  });
});
