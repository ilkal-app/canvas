import { describe, expect, it } from 'vitest';

import { compareKeys, isValidKey } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createSiblingStore, FRAME_ID, objectId, rectangle } from './__fixtures__/sibling-board.js';
import { objectKeyTag } from './object-keys.js';
import { keysAtFront, sortedSiblings } from './sibling-order.js';

describe('sortedSiblings', () => {
  it('lists the children of a parent bottom to top by key', () => {
    const store = createSiblingStore(4, { 0: 'a3', 3: 'a0' });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s3', 's1', 's2', 's0']);
  });

  it('lists the board root for a null parent', () => {
    expect(sortedSiblings(createSiblingStore(), null)).toEqual(['frame', 'r0', 'r1']);
  });

  it('breaks a tie between equal keys by id, so the order is total on every client', () => {
    const store = createSiblingStore(3, { 0: 'a1', 1: 'a1', 2: 'a1' });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s0', 's1', 's2']);
  });

  it('is empty for a parent without children', () => {
    expect(sortedSiblings(createSiblingStore(), objectId('s0'))).toEqual([]);
  });

  it('follows the store: a reorder written to z is reflected', () => {
    const store = createSiblingStore(3);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(objectId('s0'), { z: 'a5' });
    });
    expect(sortedSiblings(store, FRAME_ID)).toEqual(['s1', 's2', 's0']);
  });
});

describe('keysAtFront', () => {
  it('places new objects above every sibling, in the order given', () => {
    const store = createSiblingStore(3);
    const [first, second] = [objectId('new-a'), objectId('new-b')];
    const keys = keysAtFront(store, FRAME_ID, [first, second]);
    expect(keys).toEqual([`a3${objectKeyTag(first)}`, `a4${objectKeyTag(second)}`]);
    for (const key of keys) expect(isValidKey(key)).toBe(true);
  });

  it('converges when two clients create objects at the front concurrently', () => {
    const ada = createSiblingStore(3, {}, 1);
    const bob = new YjsDocumentStore({ clientId: 2 });
    exchange(ada, bob);
    for (const [store, name] of [
      [ada, 'from-ada'],
      [bob, 'from-bob'],
    ] as const) {
      const [z = ''] = keysAtFront(store, FRAME_ID, [objectId(name)]);
      store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.setObject(rectangle(name, FRAME_ID, z));
      });
    }
    exchange(ada, bob);
    const order = sortedSiblings(ada, FRAME_ID);
    expect(sortedSiblings(bob, FRAME_ID)).toEqual(order);
    expect(order.slice(0, 3)).toEqual(['s0', 's1', 's2']);
    expect(new Set(order.slice(3))).toEqual(new Set(['from-ada', 'from-bob']));
    expect(ada.get(objectId('from-ada'))?.z).not.toBe(ada.get(objectId('from-bob'))?.z);
  });

  it('starts an empty parent at the first key', () => {
    const [key] = keysAtFront(new YjsDocumentStore(), null, [objectId('first')]);
    expect(key).toBe(`a0${objectKeyTag(objectId('first'))}`);
  });

  it('is above the top sibling even when that sibling was reordered to the front', () => {
    const store = createSiblingStore(2);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(rectangle('top', FRAME_ID, 'b0V'));
    });
    const [key] = keysAtFront(store, FRAME_ID, [objectId('new')]);
    expect(compareKeys(key ?? '', 'b0V')).toBeGreaterThan(0);
  });
});
