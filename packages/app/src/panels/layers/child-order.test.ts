import { describe, expect, it } from 'vitest';

import { generateNKeysBetween, sortedSiblings } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createMemoryBoardView, memoryShape } from '../__fixtures__/memory-board.js';

import { childOrderAfter } from './child-order.js';

const KEYS = generateNKeysBetween(null, null, 100);

/**
 * A root of shapes, `s0` at the bottom, and its order top first.
 *
 * @param count - How many shapes.
 * @returns The board view, the order, and a way to re-index it after a change.
 */
function setUp(count: number) {
  const shapes = KEYS.slice(0, count).map((z, index) => memoryShape(`s${String(index)}`, z));
  const view = createMemoryBoardView(shapes);
  const order = sortedSiblings(view.board, null).reverse();
  const change = (ids: string[]) => {
    view.emit({ created: [], updated: [], deleted: [] });
    return new Set(ids as ObjectId[]);
  };
  return { view, order, change };
}

describe('childOrderAfter', () => {
  it('puts created, restacked and moved-in children back by key, ties by id', () => {
    const { view, order, change } = setUp(10);
    view.objects.set('new' as ObjectId, memoryShape('new', KEYS[4] ?? ''));
    view.objects.set('s0' as ObjectId, memoryShape('s0', KEYS[99] ?? ''));
    view.objects.set('s9' as ObjectId, memoryShape('s9', KEYS[4] ?? ''));
    const changed = change(['new', 's0', 's9']);
    const expected = sortedSiblings(view.board, null).reverse();
    expect(childOrderAfter(view.board, null, order, changed)).toEqual(expected);
    expect(expected.slice(0, 1)).toEqual(['s0']);
  });

  it('drops deleted and moved-out children', () => {
    const { view, order, change } = setUp(10);
    view.objects.delete('s3' as ObjectId);
    view.objects.set('s5' as ObjectId, memoryShape('s5', KEYS[5] ?? '', 'elsewhere'));
    const changed = change(['s3', 's5']);
    expect(childOrderAfter(view.board, null, order, changed)).toEqual(
      sortedSiblings(view.board, null).reverse(),
    );
  });

  it('sorts afresh when many changed, or when a listed sibling cannot be read', () => {
    const { view, order, change } = setUp(60);
    const moved = order.slice(0, 40);
    moved.forEach((id, index) => {
      view.objects.set(id, memoryShape(id, KEYS[99 - index] ?? ''));
    });
    const expected = sortedSiblings(view.board, null).reverse();
    expect(childOrderAfter(view.board, null, order, change(moved))).toEqual(expected);
    view.objects.set('late' as ObjectId, memoryShape('late', KEYS[0] ?? ''));
    change([]);
    const stale = [...expected, 'gone' as ObjectId];
    expect(childOrderAfter(view.board, null, stale, new Set(['late' as ObjectId]))).toEqual(
      sortedSiblings(view.board, null).reverse(),
    );
  });
});
