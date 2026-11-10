import * as Y from 'yjs';

import type { DocumentStore } from '../document-store.js';
import { OBJECTS_MAP_NAME } from '../yjs-document-store.js';

import { RELAY } from './store-fixtures.js';

/**
 * The Yjs client id of the next peer that writes values: counted up from a fixed start, so that
 * runs replay exactly and no two writes share an id (Yjs warns when a client id it has seen writes
 * again from another document).
 */
let nextRemoteClientId = 9_998;

/**
 * Overwrites stored keys of an existing object the way a peer that skips validation would (a
 * buggy or hostile client): through a raw Yjs document, applied to the store as a remote update.
 * The store validates only local writes, so this is how a test puts a value on a board that the
 * schema refuses, such as `1e308` in an object's `placement` group.
 *
 * @param store - The store; it must already hold the object.
 * @param objectId - The object.
 * @param entries - The keys of the object's map to set, with their plain values. A group key
 *   (`placement`, `size`) takes the whole group.
 */
export function writeStoredEntriesRemotely(
  store: DocumentStore,
  objectId: string,
  entries: Readonly<Record<string, unknown>>,
): void {
  const peer = new Y.Doc();
  peer.clientID = nextRemoteClientId;
  nextRemoteClientId += 1;
  Y.applyUpdate(peer, store.encodeState());
  const stored = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId);
  peer.transact(() => {
    for (const [key, value] of Object.entries(entries)) stored?.set(key, value);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
}

/**
 * Reads the plain value stored under a key of an object, for a test that rewrites part of a
 * group.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param key - The key of the object's map.
 * @returns The stored value, as plain JSON.
 */
export function readStoredEntry(store: DocumentStore, objectId: string, key: string): unknown {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  return peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId)?.get(key);
}

/** A vertex or segment as a test writes it: any plain record with its id. */
export interface NetworkMemberValue {
  /** The member's id, its key in the network map. */
  readonly id: string;
}

/**
 * Overwrites one member of a path's vertices or segments the way a peer that skips validation
 * would: through a raw Yjs document, applied to the store as a remote update. The member keeps
 * its order.
 *
 * @param store - The store; it must hold the path with a member of that id.
 * @param objectId - The path.
 * @param list - `vertices` or `segments`.
 * @param member - The whole new member, with its id.
 */
export function writeNetworkMemberRemotely(
  store: DocumentStore,
  objectId: string,
  list: 'vertices' | 'segments',
  member: NetworkMemberValue,
): void {
  const peer = new Y.Doc();
  peer.clientID = nextRemoteClientId;
  nextRemoteClientId += 1;
  Y.applyUpdate(peer, store.encodeState());
  const stored = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(objectId);
  const members = stored?.get(list) as Y.Map<unknown> | undefined;
  const previous = members?.get(member.id) as readonly [number, unknown] | undefined;
  peer.transact(() => {
    members?.set(member.id, [previous?.[0] ?? 0, member]);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
}
