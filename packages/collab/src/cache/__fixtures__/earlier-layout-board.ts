import type { IDBFactory } from 'fake-indexeddb';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { openIndexedDbCache } from '../indexeddb-cache.js';

import { ADA, sticky } from './sticky-board.js';

/** A relay's board and an offline edit a device made on a copy of it. */
export interface EarlierLayoutBoardFixture {
  /** The relay's board: one sticky, `a`, written by client 1. */
  readonly relay: YjsDocumentStore;
  /** The device's unsent edit, adding the sticky `offline` (client 2). */
  readonly offline: Uint8Array;
}

/**
 * Builds a relay board and an offline edit the relay lacks.
 *
 * @returns The relay's store and the offline update.
 */
export function earlierLayoutBoard(): EarlierLayoutBoardFixture {
  const relay = new YjsDocumentStore({ clientId: 1 });
  relay.transact(ADA, (transaction) => {
    transaction.setObject(sticky('a', 0));
  });
  const device = new YjsDocumentStore({ clientId: 2 });
  device.applyUpdate(relay.encodeState(), SYSTEM_ORIGIN);
  const before = device.encodeStateVector();
  device.transact(ADA, (transaction) => {
    transaction.setObject(sticky('offline', 1));
  });
  const offline = device.encodeState(before);
  device.destroy();
  return { relay, offline };
}

/**
 * Caches a board as the build writing `layout` would have: the relay's state, then `extra`.
 *
 * @param factory - The IndexedDB factory.
 * @param layout - That build's writer layout.
 * @param boardId - The board's key.
 * @param relay - The relay's board.
 * @param extra - More updates that build cached.
 */
export async function cacheAtLayout(
  factory: IDBFactory,
  layout: number,
  boardId: string,
  relay: YjsDocumentStore,
  extra: readonly Uint8Array[],
): Promise<void> {
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: layout });
  for (const update of [relay.encodeState(), ...extra]) await cache.append(boardId, update);
  cache.close();
}

/**
 * Whether a board's store holds an object.
 *
 * @param store - The store.
 * @param id - The object's id.
 * @returns Whether it does.
 */
export function holdsObject(store: Pick<YjsDocumentStore, 'read'>, id: string): boolean {
  return store.read().objects.has(id as ObjectId);
}
