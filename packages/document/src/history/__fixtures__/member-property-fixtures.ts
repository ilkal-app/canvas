import type * as Y from 'yjs';

import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import type { DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';

import { membersOf, PATH_ID } from './network-member-fixtures.js';

// The property test's small map: vertices of the fixture path that no segment joins, their ids
// starting with `p`, so any of them can be added, moved or deleted at any time and the network
// stays well formed.

/** A small set of vertex ids the property test adds, moves and deletes, reusing ids. */
export const MEMBER_KEYS = ['p0', 'p1', 'p2'] as const;

/**
 * Tells whether a vertex id is one the property test writes.
 *
 * @param key - A vertex id.
 * @returns `true` for an id starting with `p`.
 */
function isMemberKey(key: string): boolean {
  return key.startsWith('p');
}

/** A seeded source of numbers in [0, 1). */
export type Random = () => number;

/**
 * Creates a seeded random source (mulberry32), so a failing sequence replays from its seed.
 *
 * @param seed - The seed, a 32-bit integer.
 * @returns The source.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Picks one element of a non-empty list.
 *
 * @param random - The random source.
 * @param items - The list.
 * @returns One of its elements.
 */
export function pick<Item>(random: Random, items: readonly Item[]): Item {
  return items[Math.floor(random() * items.length)] as Item;
}

/**
 * The property keys' values as stored, as `key@x,y` lines. Read from the network map, not the
 * decoded path: a read leaves out a vertex no segment touches ('s network visibility),
 * which every property key is, so a decoded read would show none of them.
 *
 * @param store - The store.
 * @returns The lines.
 */
function storedMemberLines(store: DocumentStore): string[] {
  return membersOf(store).filter((line) => line.includes('@') && isMemberKey(line));
}

/**
 * The property keys a store's path holds now.
 *
 * @param store - The store.
 * @returns The present keys, sorted.
 */
export function presentKeys(store: DocumentStore): string[] {
  return storedMemberLines(store)
    .map((line) => line.slice(0, line.indexOf('@')))
    .sort();
}

/**
 * The property keys' values in a store, as `key@x,y` lines (a missing key is left out).
 *
 * @param store - The store.
 * @param prefix - Only keys starting with it; all property keys by default.
 * @returns The lines, sorted.
 */
export function memberValues(store: DocumentStore, prefix = 'p'): string[] {
  return storedMemberLines(store)
    .filter((line) => line.startsWith(prefix))
    .sort();
}

/**
 * Writes a property key: adds the vertex, or overwrites it.
 *
 * @param store - The store.
 * @param origin - Who writes.
 * @param key - The key.
 * @param x - The value's x; the test makes every write's value unique.
 * @param y - The value's y.
 */
export function writeMember(
  store: DocumentStore,
  origin: TransactionOrigin,
  key: string,
  x: number,
  y: number,
): void {
  store.transact(origin, (transaction) => {
    transaction.setVertex(PATH_ID, { id: key, x, y, mirror: 'none' });
  });
}

/**
 * Deletes a property key.
 *
 * @param store - The store.
 * @param origin - Who deletes it.
 * @param key - The key.
 */
export function deleteMember(store: DocumentStore, origin: TransactionOrigin, key: string): void {
  store.transact(origin, (transaction) => {
    transaction.deleteVertex(PATH_ID, key);
  });
}

/**
 * The Yjs items holding the property keys' current values that a given client wrote itself:
 * not a copy another client's undo or redo made of it, which is that client's item.
 *
 * @param store - The store to look in.
 * @param clientId - The writer's Yjs client id.
 * @returns The live items by key.
 */
export function valuesWrittenBy(store: DocumentStore, clientId: number): Map<string, Y.Item> {
  const written = new Map<string, Y.Item>();
  for (const [key, item] of verticesOf(store)._map) {
    if (isMemberKey(key) && !item.deleted && item.id.client === clientId) written.set(key, item);
  }
  return written;
}

/**
 * The path's vertices map in a store.
 *
 * @param store - The store.
 * @returns The map from vertex id to its stored member.
 */
function verticesOf(store: DocumentStore): Y.Map<unknown> {
  const path = internalsOf(store).objects.get(PATH_ID) as Y.Map<unknown>;
  return path.get('vertices') as Y.Map<unknown>;
}

/**
 * The Yjs clock of the item holding a key's current value, for telling whether another client
 * has seen that write (its state for the writer is above the clock).
 *
 * @param store - The writer's store, right after the write.
 * @param key - The key.
 * @returns The clock, or `undefined` when the key has no value.
 */
export function valueClockOf(store: DocumentStore, key: string): number | undefined {
  const item = verticesOf(store)._map.get(key);
  return item === undefined || item.deleted ? undefined : item.id.clock;
}
