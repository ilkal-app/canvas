import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createNetworkMap,
  deleteNetworkItem,
  readNetworkMap,
  syncNetworkMap,
  upsertNetworkItem,
  type NetworkItem,
} from './network-codec.js';

/**
 * Creates a network map integrated in a fresh document.
 *
 * @param items - The members.
 * @returns The integrated map.
 */
function integratedMap(items: { id: string; x: number }[]): Y.Map<unknown> {
  const root = new Y.Doc().getMap<unknown>('objects');
  root.set('network', createNetworkMap(items));
  return root.get('network') as Y.Map<unknown>;
}

/**
 * Makes a test member.
 *
 * @param id - Its id.
 * @param x - Its one field.
 * @returns The member.
 */
function member(id: string, x: number): NetworkItem {
  return { id, x } as NetworkItem;
}

describe('network maps', () => {
  it('store one entry per member, keyed by id, and read them back in written order', () => {
    const network = integratedMap([
      { id: 'b', x: 1 },
      { id: 'a', x: 2 },
    ]);
    expect(network.get('b')).toEqual([0, { id: 'b', x: 1 }]);
    expect(readNetworkMap(network)).toEqual([
      { id: 'b', x: 1 },
      { id: 'a', x: 2 },
    ]);
  });

  it('upsert in place, append new members, and delete by id', () => {
    const network = integratedMap([{ id: 'a', x: 1 }]);
    const changed: string[] = [];
    network.observe((event) => changed.push(...event.keysChanged));
    upsertNetworkItem(network, member('a', 1));
    expect(changed).toEqual([]);
    upsertNetworkItem(network, member('c', 3));
    upsertNetworkItem(network, member('a', 5));
    expect(readNetworkMap(network)).toEqual([
      { id: 'a', x: 5 },
      { id: 'c', x: 3 },
    ]);
    expect(deleteNetworkItem(network, 'a')).toBe(true);
    expect(deleteNetworkItem(network, 'a')).toBe(false);
    expect(readNetworkMap(network)).toEqual([{ id: 'c', x: 3 }]);
  });

  it('sync to a new member set, writing only members that changed', () => {
    const network = integratedMap([
      { id: 'a', x: 1 },
      { id: 'b', x: 2 },
      { id: 'c', x: 3 },
    ]);
    const changed: string[] = [];
    network.observe((event) => changed.push(...event.keysChanged));
    syncNetworkMap(network, [member('d', 4), member('c', 3), member('b', 9)]);
    expect([...changed].sort()).toEqual(['a', 'b', 'd']);
    expect(readNetworkMap(network)).toEqual([
      { id: 'b', x: 9 },
      { id: 'c', x: 3 },
      { id: 'd', x: 4 },
    ]);
  });

  it('order members appended concurrently with the same order by id, on every peer', () => {
    const network = integratedMap([{ id: 'a', x: 1 }]);
    network.set('z', [1, { id: 'z', x: 0 }]);
    network.set('q', [1, { id: 'q', x: 0 }]);
    network.set('m', [1, { id: 'm', x: 0 }]);
    expect(readNetworkMap(network)).toEqual([
      { id: 'a', x: 1 },
      { id: 'm', x: 0 },
      { id: 'q', x: 0 },
      { id: 'z', x: 0 },
    ]);
  });

  it('report a network that is not a Y.Map of [order, member] entries', () => {
    expect(readNetworkMap([])).toBe('the network is not a Y.Map');
    const network = integratedMap([]);
    network.set('a', { id: 'a' });
    expect(readNetworkMap(network)).toBe('member "a" is not [order, member]');
    network.set('a', [0, { id: 'b' }]);
    expect(readNetworkMap(network)).toBe('member "a" holds another id');
    network.set('a', ['first', { id: 'a' }]);
    expect(readNetworkMap(network)).toBe('member "a" is not [order, member]');
  });

  it('replace a malformed entry when writing its member', () => {
    const network = integratedMap([]);
    network.set('a', 'broken');
    syncNetworkMap(network, [member('a', 1)]);
    expect(readNetworkMap(network)).toEqual([{ id: 'a', x: 1 }]);
  });
});
