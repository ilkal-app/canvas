// Nightly hunt seed 48: `placeObjects` was refused `unorderable-neighbours` in the plain
// sync fuzz. A detach copied each main child's stacking key onto its copy, against the rule that
// no command copies another object's key: when two people detach the same instance at
// once, both sets of copies land in the one frame the instance became, pairwise on the same key,
// and nothing can be placed between two tied siblings. A detach now gives its copies keys of
// their own, in the main's order, so concurrent detaches merge into a total order.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import type { DetachInstanceResult } from './detach-instance.js';

/**
 * Syncs two stores both ways.
 *
 * @param first - One store.
 * @param second - The other.
 */
function sync(first: YjsDocumentStore, second: YjsDocumentStore): void {
  second.applyUpdate(first.encodeState(second.encodeStateVector()), SYSTEM_ORIGIN);
  first.applyUpdate(second.encodeState(first.encodeStateVector()), SYSTEM_ORIGIN);
}

describe('detachInstance keys', () => {
  it('gives its copies keys of their own, in the order of the main', () => {
    const store = new YjsDocumentStore();
    const card = seedMainWithChildren(store);
    const instanceId = placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: instanceId });
    const { idMap } = result as DetachInstanceResult;
    const mainOrder = sortedSiblings(store, card.mainId as ObjectId);
    const copyOrder = sortedSiblings(store, instanceId);
    expect(copyOrder).toEqual(mainOrder.map((id) => idMap[id]));
    for (const id of mainOrder) {
      expect(mustGet(store, idMap[id] ?? '').z).not.toBe(mustGet(store, id).z);
    }
  });

  it('merges two people detaching one instance at once into a total order', () => {
    const ada = new YjsDocumentStore();
    const card = seedMainWithChildren(ada);
    const instanceId = placeInstance(ada, card.mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const bob = new YjsDocumentStore();
    sync(ada, bob);
    const detach = mustFindCommand('detachInstance');
    applyCommand(ada, detach, { id: instanceId });
    applyCommand(bob, detach, { id: instanceId }, BOB, testEnvironment(11));
    sync(ada, bob);
    const children = sortedSiblings(ada, instanceId).map((id) => mustGet(ada, id));
    expect(children.length).toBe(8);
    for (const [index, child] of children.entries()) {
      const next = children[index + 1];
      if (next !== undefined) expect(child.z < next.z, `${child.id} below ${next.id}`).toBe(true);
    }
    // So any of them can go between two others.
    const [, second, third] = children;
    applyCommand(ada, mustFindCommand('placeObjects'), {
      ids: [children.at(-1)?.id ?? ''],
      parentId: instanceId,
      belowId: third?.id ?? '',
    });
    expect(sortedSiblings(ada, instanceId).slice(1, 3)).toEqual([second?.id, children.at(-1)?.id]);
  });
});
