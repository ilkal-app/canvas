import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME, SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { findUnsentChanges } from './unsent-changes.js';

/**
 * A store holding the given stickies, written by one client.
 *
 * @param clientId - The store's Yjs client id.
 * @param ids - The stickies' ids.
 * @returns The store.
 */
function storeWith(clientId: number, ids: readonly string[]): YjsDocumentStore {
  const store = new YjsDocumentStore({ clientId });
  store.transact(ADA, (transaction) => {
    ids.forEach((id, index) => {
      transaction.setObject(sticky(id, index));
    });
  });
  return store;
}

/**
 * A copy of a store, made from its full state.
 *
 * @param store - The store.
 * @param clientId - The copy's own Yjs client id.
 * @returns The copy.
 */
function copyOf(store: YjsDocumentStore, clientId: number): YjsDocumentStore {
  const copy = new YjsDocumentStore({ clientId });
  copy.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
  return copy;
}

describe('findUnsentChanges', () => {
  it('finds nothing lacking when the synced store holds every cached record', () => {
    const relay = storeWith(1, ['a']);
    const cached = { snapshot: relay.encodeState(), updates: [] };
    expect(findUnsentChanges(cached, copyOf(relay, 101))).toEqual({ count: 0, update: undefined });
  });

  it('finds an offline edit the relay lacks, and only the records carrying one', () => {
    const relay = storeWith(1, ['a']);
    const device = copyOf(relay, 102);
    const before = device.encodeStateVector();
    device.transact(ADA, (transaction) => {
      transaction.setObject(sticky('offline', 3));
    });
    const offline = device.encodeState(before);
    const cached = { snapshot: relay.encodeState(), updates: [offline] };
    const unsent = findUnsentChanges(cached, relay);
    expect(unsent.count).toBe(1);
    const synced = copyOf(relay, 103);
    if (unsent.update === undefined) throw new Error('an update was expected');
    synced.applyUpdate(unsent.update, SYSTEM_ORIGIN);
    expect(synced.read().objects.has('offline' as ObjectId)).toBe(true);
  });

  it('finds an offline deletion, which leaves the state vector as it was', () => {
    const relay = storeWith(1, ['a', 'b']);
    const device = new Y.Doc();
    Y.applyUpdate(device, relay.encodeState());
    const before = Y.encodeStateVector(device);
    device.getMap(OBJECTS_MAP_NAME).delete('b');
    const deletion = Y.encodeStateAsUpdate(device, before);
    expect(Y.encodeStateVector(device)).toEqual(before);
    device.destroy();
    const unsent = findUnsentChanges({ snapshot: undefined, updates: [deletion] }, relay);
    expect(unsent.count).toBe(1);
    if (unsent.update === undefined) throw new Error('an update was expected');
    relay.applyUpdate(unsent.update, SYSTEM_ORIGIN);
    expect(relay.read().objects.has('b' as ObjectId)).toBe(false);
    expect(findUnsentChanges({ snapshot: undefined, updates: [deletion] }, relay).count).toBe(0);
  });

  it('counts a compacted snapshot holding unsent edits as one change', () => {
    const relay = storeWith(1, ['a']);
    const device = copyOf(relay, 104);
    device.transact(ADA, (transaction) => {
      transaction.setObject(sticky('x', 4));
      transaction.setObject(sticky('y', 5));
    });
    const unsent = findUnsentChanges({ snapshot: device.encodeState(), updates: [] }, relay);
    expect(unsent.count).toBe(1);
  });

  it('never mutates the cached records', () => {
    const relay = storeWith(1, ['a']);
    const device = storeWith(2, ['z']);
    const record = device.encodeState();
    const copy = new Uint8Array(record);
    findUnsentChanges({ snapshot: undefined, updates: [record] }, relay);
    expect(record).toEqual(copy);
  });

  it('throws on bytes it cannot read, so the caller keeps them', () => {
    const relay = storeWith(1, ['a']);
    expect(() =>
      findUnsentChanges({ snapshot: undefined, updates: [new Uint8Array([255, 255])] }, relay),
    ).toThrow();
  });
});
