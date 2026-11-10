import { describe, expect, it } from 'vitest';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { BOB, exchange, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { setStyleCommand } from './set-style.js';
import { ungroupCommand } from './ungroup.js';

// Sync tests for the group resize: a group resize rewrites every
// descendant, so it meets concurrent edits of those descendants; both clients must converge on
// one valid board.

/**
 * Two stores holding the grouped board, as two synced clients would.
 *
 * @param clientIds - Optional fixed ids for both merge winners.
 * @returns Ada's store and Bob's.
 */
function createPair(clientIds?: readonly [number, number]): [YjsDocumentStore, YjsDocumentStore] {
  const ada = createGroupedStore(clientIds?.[0]);
  const bob = new YjsDocumentStore(clientIds === undefined ? {} : { clientId: clientIds[1] });
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * Checks that both clients hold the same, valid board.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
}

const RESIZE = {
  resizes: [{ id: 'group-outer', by: { width: 100, height: 40 }, origin: { x: 80, y: 40 } }],
};

describe('concurrent group resizes', () => {
  it('converge when one client resizes a group while another moves one of its children', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, resizeObjectsCommand, RESIZE);
    const resizedGroup = mustGet(ada, 'group-outer');
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: 'rect-b', by: { x: 30, y: 0 } }] }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    // The child is still in the group, and the group kept the resize.
    expect(mustGet(bob, 'rect-b').parentId).toBe('group-outer');
    expect(mustGet(bob, 'group-outer')).toMatchObject({ x: resizedGroup.x, y: resizedGroup.y });
  });

  it('keep both a group resize and a concurrent restyle of a child, which are different fields', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, resizeObjectsCommand, RESIZE);
    const resized = mustGet(ada, 'rect-a');
    applyCommand(
      bob,
      setStyleCommand,
      { changes: [{ id: 'rect-a', style: { fill: [0, 1, 0, 1] } }] },
      BOB,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(ada, 'rect-a')).toMatchObject({
      x: resized.x,
      y: resized.y,
      width: 'width' in resized ? resized.width : Number.NaN,
      fill: [0, 1, 0, 1],
    });
  });

  it.each([
    [1, 2],
    [2, 1],
  ] as const)(
    'converge when one client resizes a group while another ungroups it (%i/%i)',
    (adaId, bobId) => {
      const [ada, bob] = createPair([adaId, bobId]);
      applyCommand(ada, resizeObjectsCommand, RESIZE);
      applyCommand(bob, ungroupCommand, { ids: ['group-outer'] }, BOB);
      exchange(ada, bob);
      expectConverged(ada, bob);
      expect(ada.get(id('group-outer'))).toBeUndefined();
      expect(mustGet(ada, 'rect-a').parentId).toBeNull();
    },
  );

  it('undo of a group resize restores only what the undoing principal alone changed', () => {
    // The two clients write rect-b's placement at once; which write wins follows the Yjs client
    // ids, so they are fixed and swapped to exercise both winners.
    const winners = new Set<string>();
    for (const [adaClient, bobClient] of [
      [1, 2],
      [2, 1],
    ] as const) {
      const ada = createGroupedStore(adaClient);
      const bob = new YjsDocumentStore({ clientId: bobClient });
      exchange(ada, bob);
      const history = createHistory(ada, ADA_ID);
      const before = new Map(ada.read().objects);
      const original = mustGet(ada, 'rect-b');
      applyCommand(ada, resizeObjectsCommand, RESIZE);
      const resized = mustGet(ada, 'rect-b');
      expect('width' in resized && 'width' in original && resized.width !== original.width).toBe(
        true,
      );
      applyCommand(
        bob,
        moveObjectsCommand,
        { moves: [{ id: 'rect-b', by: { x: 30, y: 0 } }] },
        BOB,
      );
      exchange(ada, bob);
      const merged = mustGet(ada, 'rect-b');
      winners.add(merged.x === resized.x ? 'ada' : 'bob');
      expect(history.undo()).toBe(true);
      exchange(ada, bob);
      expectConverged(ada, bob);
      // Ada's own writes are undone: the group and the children only she changed are back.
      for (const objectId of ['group-outer', 'rect-a', 'line-l', 'path-p', 'rect-c']) {
        expect(mustGet(bob, objectId)).toMatchObject({
          ...before.get(id(objectId)),
          updatedAt: expect.any(Number) as number,
        });
      }
      // rect-b: its size only Ada wrote, so undo takes it back; its placement both wrote at
      // once, and it stays as merged: when Bob's move won there is nothing of Ada's left to
      // undo, and when her resize won, undo never removes a field's current value (the store's
      // field guard), so it does not bring back a value from before a concurrent write.
      const after = mustGet(bob, 'rect-b');
      expect(after).toMatchObject({ x: merged.x, y: merged.y });
      expect('width' in after && 'width' in original && [after.width, after.height]).toEqual(
        'width' in original && [original.width, original.height],
      );
      history.destroy();
    }
    expect([...winners].sort()).toEqual(['ada', 'bob']);
  });
});
