import * as Y from 'yjs';

import { stampDocument } from '../../meta/stamp-document.js';
import type { DocumentStore } from '../document-store.js';
import { OBJECTS_MAP_NAME } from '../yjs-document-store.js';

import { RELAY } from './store-fixtures.js';

/** The Yjs client id of the peer that writes the keys, fixed so that runs replay exactly. */
const REMOTE_CLIENT_ID = 9_999;

/**
 * Writes `z` keys into existing objects the way a peer that skips validation would (a client on
 * an older build, say): through a raw Yjs document, applied to the store as a remote update. The
 * store validates only local writes and the schema rejects a `z` that is not a fractional-index
 * key, so this is how a test puts such a key on a board.
 *
 * @param store - The store; it must already hold every object named.
 * @param keys - The new key of each object, by id.
 */
export function writeKeysRemotely(
  store: DocumentStore,
  keys: Readonly<Record<string, string>>,
): void {
  if (Object.keys(keys).length === 0) return;
  const peer = new Y.Doc();
  peer.clientID = REMOTE_CLIENT_ID;
  Y.applyUpdate(peer, store.encodeState());
  const objects = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
  peer.transact(() => {
    for (const [objectId, key] of Object.entries(keys)) objects.get(objectId)?.set('z', key);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
}

/**
 * Stores a line the way a board written before its ends had a key each holds it (boards
 * written before fix round 1, which carry the same layout version): the whole pair under `points`, and no `points.0` or `points.1`.
 * The line's entry is replaced through a raw Yjs document and applied to the store as a remote
 * update, so the store reads the line from the old key.
 *
 * @param store - The store; it must hold the line.
 * @param lineId - The line's id.
 */
export function storeLineUnsplit(store: DocumentStore, lineId: string): void {
  const peer = new Y.Doc();
  peer.clientID = REMOTE_CLIENT_ID;
  Y.applyUpdate(peer, store.encodeState());
  const objects = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
  // A line holds only plain values, so its stored entries copy as JSON.
  const stored = objects.get(lineId)?.toJSON() as Record<string, unknown>;
  const entries = Object.entries(stored).filter(([key]) => !key.startsWith('points.'));
  const points = [stored['points.0'], stored['points.1']];
  peer.transact(() => {
    // A writer that replaces an object entry stamps first, as every build since does.
    stampDocument(peer);
    objects.set(lineId, new Y.Map<unknown>([...entries, ['points', points]]));
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
}
