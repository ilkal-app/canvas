import { describe, expect, it } from 'vitest';

import type { Board, BoardObject, ObjectId } from '@canvas/schema';

import { nestedFrameObjects } from './__fixtures__/nested-frames.js';
import { comparePaintOrder } from './paint-order.js';

const board: Board = {
  objects: new Map(nestedFrameObjects().map((object) => [object.id, object])),
};

function get(id: string): BoardObject {
  const object = board.objects.get(id as ObjectId);
  if (object === undefined) throw new Error(`no object "${id}"`);
  return object;
}

describe('comparePaintOrder', () => {
  it('orders siblings by key, then id', () => {
    expect(comparePaintOrder(board, get('rect-inner'), get('rect-inner-2'))).toBeLessThan(0);
    expect(comparePaintOrder(board, get('rect-inner-2'), get('rect-inner'))).toBeGreaterThan(0);
  });

  it('orders objects in different parents by their parents, not their own keys', () => {
    // rect-side (a5) sits in frame-side (a1), below rect-free (a2) on the root.
    expect(comparePaintOrder(board, get('rect-side'), get('rect-free'))).toBeLessThan(0);
    expect(comparePaintOrder(board, get('rect-free'), get('rect-side'))).toBeGreaterThan(0);
  });

  it('paints an ancestor below what it holds, and an object level with itself', () => {
    expect(comparePaintOrder(board, get('frame-outer'), get('rect-inner'))).toBeLessThan(0);
    expect(comparePaintOrder(board, get('rect-inner'), get('frame-outer'))).toBeGreaterThan(0);
    expect(comparePaintOrder(board, get('rect-free'), get('rect-free'))).toBe(0);
  });

  it('stops at a parent cycle', () => {
    const loopA = {
      ...get('frame-side'),
      id: 'loop-a' as ObjectId,
      parentId: 'loop-b' as ObjectId,
    };
    const loopB = {
      ...get('frame-side'),
      id: 'loop-b' as ObjectId,
      parentId: 'loop-a' as ObjectId,
    };
    const looped: Board = {
      objects: new Map([
        [loopA.id, loopA],
        [loopB.id, loopB],
      ]),
    };
    expect(comparePaintOrder(looped, loopA, loopB)).not.toBeNaN();
  });
});
