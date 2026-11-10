import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { zKeyAt } from '../__fixtures__/scene-objects.js';

import { paintOrderOf, paintOrderOfSiblings } from './paint-order.js';
import { SiblingLists, type StackedObject } from './sibling-lists.js';

// The paint order after one reorder among 50k root siblings (the frame-time budgets'
// board size): the full rebuild, which sorts the siblings again, against the sibling
// lists `ZOrderSegments` keeps sorted from change sets, which move one object by binary search
// and walk. Slot owners and the segment plan, rebuilt after either, are in
// z-order-segments.bench.ts.

const SIBLING_COUNT = 50_000;
const objects: StackedObject[] = [...Array(SIBLING_COUNT).keys()].map((index) => ({
  id: `o${String(index)}` as ObjectId,
  z: zKeyAt(index),
  parentId: null,
}));
const lists = SiblingLists.of(objects);
let moved: StackedObject = { id: 'o0' as ObjectId, z: zKeyAt(0), parentId: null };
let step = 0;

describe(`paint order after bringing one of ${String(SIBLING_COUNT)} root siblings to front`, () => {
  bench('full rebuild: paintOrderOf, every sibling sorted again', () => {
    step += 1;
    objects[0] = { ...moved, z: `c${String(step).padStart(9, '0')}` };
    paintOrderOf(objects);
  });

  bench('incremental: one binary-search move in the sibling lists, then the walk', () => {
    step += 1;
    const next = { ...moved, z: `c${String(step).padStart(9, '0')}` };
    lists.replace(moved, next);
    moved = next;
    paintOrderOfSiblings(lists);
  });
});
