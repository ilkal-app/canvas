// An imported board's objects as createObjects takes them: stacking order, document
// indexes, and the fields the command sets left out.
import { describe, expect, it } from 'vitest';

import { createBoard, type BoardObject } from '@canvas/schema';

import { importedObjectsInStackOrder } from './imported-objects.js';

/**
 * A group as a portable document holds it.
 *
 * @param id - Its id.
 * @param z - Its stacking key.
 * @param parentId - Its parent, or null.
 * @returns The group.
 */
function group(id: string, z: string, parentId: string | null = null): BoardObject {
  return {
    id,
    type: 'group',
    parentId,
    pageId: parentId === null ? 'page-1' : null,
    x: 1,
    y: 2,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1,
    updatedAt: 2,
  } as unknown as BoardObject;
}

describe('importedObjectsInStackOrder', () => {
  it('orders by stacking key, then document order, keeping each document index', () => {
    const board = createBoard([group('top', 'a2'), group('tie-1', 'a1'), group('tie-2', 'a1')]);
    const entries = importedObjectsInStackOrder(board);
    expect(entries.map(({ object, index }) => [object.id, index])).toEqual([
      ['tie-1', 1],
      ['tie-2', 2],
      ['top', 0],
    ]);
  });

  it('sorts a document listed out of stacking order, either way round', () => {
    const board = createBoard([
      group('c', 'a3'),
      group('a', 'a1'),
      group('d', 'a4'),
      group('b', 'a2'),
      group('z', 'a0'),
    ]);
    expect(importedObjectsInStackOrder(board).map(({ object }) => object.id)).toEqual([
      'z',
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves out the fields the command sets and keeps references and the board as they were', () => {
    const board = createBoard([group('parent', 'a0'), group('child', 'a0', 'parent')]);
    const before = structuredClone([...board.objects.values()]);
    const [first, second] = importedObjectsInStackOrder(board);
    for (const entry of [first, second]) {
      for (const field of ['createdBy', 'createdAt', 'updatedAt', 'z', 'pageId']) {
        expect(entry?.object).not.toHaveProperty(field);
      }
    }
    expect(second?.object).toMatchObject({ id: 'child', parentId: 'parent', x: 1, y: 2 });
    expect([...board.objects.values()]).toEqual(before);
  });
});
