import { describe, expect, it } from 'vitest';

import { isValidKey, type ObjectId } from '@canvas/schema';

import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { groupCommand } from './group.js';
import { bringForwardCommand } from './reorder.js';
import { ungroupCommand } from './ungroup.js';

// Sync tests for grouping: a group and an ungroup of overlapping selections, made at
// once on two clients, converge on one valid board where every sibling has its own stacking
// key (generated keys end in their object's tag), so later placements still find gaps.

/**
 * Two stores holding the grouped board, as two synced clients would.
 *
 * @returns Ada's store and Bob's.
 */
function createPair(): [YjsDocumentStore, YjsDocumentStore] {
  const ada = createGroupedStore();
  const bob = new YjsDocumentStore();
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * Checks that both clients hold the same, valid board whose siblings have distinct, valid
 * keys under every parent.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  const board = ada.read();
  expect(new Map(bob.read().objects)).toEqual(new Map(board.objects));
  expect(board.issues).toEqual([]);
  const keysByParent = new Map<ObjectId | null, string[]>();
  for (const object of board.objects.values()) {
    expect(isValidKey(object.z)).toBe(true);
    keysByParent.set(object.parentId, [...(keysByParent.get(object.parentId) ?? []), object.z]);
  }
  for (const keys of keysByParent.values()) expect(new Set(keys).size).toBe(keys.length);
}

describe('concurrent group and ungroup', () => {
  it('converge when one client groups a group with a sibling while another ungroups it', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, groupCommand, { ids: ['group-outer', 'rect-free'], groupId: 'group-new' });
    applyCommand(bob, ungroupCommand, { ids: ['group-outer'] }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    // Bob's ungroup deleted the group Ada put in hers; its children went to the root.
    expect(mustGet(ada, 'rect-free').parentId).toBe('group-new');
    expect(mustGet(ada, 'rect-a').parentId).toBeNull();
    // Moving an object forward among the root's children still finds a gap.
    applyCommand(ada, bringForwardCommand, { ids: ['rect-a'] });
    exchange(ada, bob);
    expectConverged(ada, bob);
  });

  it('converge when one client groups children of a group while another ungroups that group', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, groupCommand, { ids: ['rect-a', 'rect-b'], groupId: 'group-new' });
    applyCommand(bob, ungroupCommand, { ids: ['group-outer'] }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    // Ada's group lost its parent: the repair moved it to the root, where the group was.
    expect(mustGet(bob, 'group-new').parentId).toBeNull();
  });

  it('converge when both clients group overlapping children of one group', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, groupCommand, { ids: ['rect-a', 'rect-b'], groupId: 'group-ada' });
    applyCommand(bob, groupCommand, { ids: ['rect-b', 'line-l'], groupId: 'group-bob' }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(ada, 'group-ada').parentId).toBe('group-outer');
    expect(mustGet(ada, 'group-bob').parentId).toBe('group-outer');
  });
});
