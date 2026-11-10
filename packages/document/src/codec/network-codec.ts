import * as Y from 'yjs';

import { describeValue } from './describe-value.js';
import { isSamePlainValue } from './plain-value.js';

// A path's `vertices` and `segments` (the vector network) are each a
// `Y.Map` from member id to `[order, member]`: one Yjs item per member. Concurrent
// edits to different members merge, and two edits of one member keep one of them whole (last
// writer wins over the member). Keying by id also means a merge can never leave two members
// with one id, which the per-member `Y.Map`s in a `Y.Array` of allowed. The order of a
// network carries no meaning, but a decoded path keeps the order it was written in, so members
// are read by `order`, then id: kept members keep their order, new ones are appended.

/** A member of a vector network (a vertex or a segment): a plain record with an `id`. */
export interface NetworkItem {
  /** The member's id, unique within its network list. */
  readonly id: string;
}

/** The stored value of one member: its order, then the member itself. */
export type StoredMember = readonly [order: number, member: NetworkItem];

/**
 * Reads a stored member value.
 *
 * @param value - The value stored under a member id.
 * @returns The member and its order, or `undefined` when the value is malformed.
 */
export function readStoredMember(value: unknown): StoredMember | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [order, member] = value as readonly unknown[];
  if (typeof order !== 'number' || typeof member !== 'object' || member === null) return undefined;
  return [order, member as NetworkItem];
}

/**
 * The largest order stored in a network map.
 *
 * @param map - The network map.
 * @returns The largest order, or -1 when the map is empty.
 */
function lastOrder(map: Y.Map<unknown>): number {
  let last = -1;
  for (const value of map.values()) last = Math.max(last, readStoredMember(value)?.[0] ?? -1);
  return last;
}

/**
 * Creates the shared map of a path's `vertices` or `segments`, one entry per member, ordered
 * as given.
 *
 * @param items - The validated members, in order.
 * @returns A new, not yet integrated, map.
 */
export function createNetworkMap(items: readonly NetworkItem[]): Y.Map<unknown> {
  return new Y.Map<unknown>(items.map((item, order) => [item.id, [order, item]]));
}

/**
 * Reads a path's `vertices` or `segments` map as plain records, by order and then id. Member
 * fields are not checked (remote updates are trusted, see the README).
 *
 * @param value - The stored value.
 * @returns The members, or a message saying why the map cannot be read.
 */
export function readNetworkMap(value: unknown): Record<string, unknown>[] | string {
  if (!(value instanceof Y.Map)) return 'the network is not a Y.Map';
  const members: [number, string, Record<string, unknown>][] = [];
  for (const [id, stored] of (value as Y.Map<unknown>).entries()) {
    const member = readStoredMember(stored);
    if (member === undefined) return `member ${describeValue(id)} is not [order, member]`;
    if (member[1].id !== id) return `member ${describeValue(id)} holds another id`;
    members.push([member[0], id, member[1] as unknown as Record<string, unknown>]);
  }
  members.sort(([order, id], [otherOrder, otherId]) =>
    order === otherOrder ? (id < otherId ? -1 : 1) : order - otherOrder,
  );
  return members.map(([, , member]) => member);
}

/**
 * Adds a member, or replaces the member with its id when it changed (keeping its order).
 *
 * @param map - The network map, integrated in a document.
 * @param item - The validated member; stored by reference, so pass a value the caller owns.
 */
export function upsertNetworkItem(map: Y.Map<unknown>, item: NetworkItem): void {
  const stored = readStoredMember(map.get(item.id));
  if (stored === undefined) {
    map.set(item.id, [lastOrder(map) + 1, item]);
  } else if (!isSamePlainValue(stored[1], item)) {
    map.set(item.id, [stored[0], item]);
  }
}

/**
 * Deletes a member by id.
 *
 * @param map - The network map, integrated in a document.
 * @param id - The member id.
 * @returns `true` when a member was deleted.
 */
export function deleteNetworkItem(map: Y.Map<unknown>, id: string): boolean {
  if (!map.has(id)) return false;
  map.delete(id);
  return true;
}

/**
 * Brings a network map to a new set of members by id: members no longer present are deleted
 * (except those in `kept`), changed members are replaced in their order, and new members are
 * appended in the given order. Unchanged members are not written, so concurrent edits to them
 * survive.
 *
 * @param map - The network map, integrated in a document.
 * @param items - The validated members.
 * @param kept - Ids never deleted: members a read left out (`network-visibility.ts`), which the
 *   decoded path the caller edited could not list.
 */
export function syncNetworkMap(
  map: Y.Map<unknown>,
  items: readonly NetworkItem[],
  kept: ReadonlySet<unknown> = new Set(),
): void {
  const wanted = new Set(items.map((item) => item.id));
  for (const id of [...map.keys()]) if (!wanted.has(id) && !kept.has(id)) map.delete(id);
  let next = lastOrder(map) + 1;
  for (const item of items) {
    const stored = readStoredMember(map.get(item.id));
    if (stored === undefined) {
      map.set(item.id, [next, item]);
      next += 1;
    } else if (!isSamePlainValue(stored[1], item)) {
      map.set(item.id, [stored[0], item]);
    }
  }
}
