// Acceptance, written from the ticket's "Done means" before the fix: the poisoned-cache
// walk (cached unstamped fragment, filler, terminal `outdated`, reopen) over fake-indexeddb, the
// device cache the browser uses, against this package's fake relay. The real-relay walk is
// `tooling/e2e-sync/src/sync/poisoned-cache-relay.acceptance.test.ts` (that package has no
// fake-indexeddb, and acceptance commits add no dependency).
//
// Open decision (left to the implementer): the way out may run in the poisoned session or on the
// next open. Only the reopen's outcome is asserted; no recovery API is called (none exists).
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME, YjsDocumentStore, type DocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { ADA, sticky } from '../cache/__fixtures__/sticky-board.js';
import { openIndexedDbCache } from '../cache/indexeddb-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import {
  deviceHoldsStruct,
  deviceObjectIds,
  poisonedHistory,
  WithheldDocumentFrames,
} from './__fixtures__/poisoned-device.js';
import type { CollabClient } from './collab-client.js';

let harness: ClientHarness;
const reported: unknown[] = [];

afterEach(() => {
  harness.destroy();
  reported.splice(0);
});

/**
 * Describes where a client stands.
 *
 * @param client - The client.
 * @returns `settled` when connected, acknowledged and not refused; else its state and reason.
 */
function standing(client: CollabClient): string {
  const { state, isAcknowledged, rejectionReason } = client.status;
  if (state === 'connected' && isAcknowledged && rejectionReason === undefined) return 'settled';
  return `${state}${rejectionReason === undefined ? '' : `:${rejectionReason}`}`;
}

/**
 * Moves simulated time on (retries, backoff) and delivers everything, then reads a value.
 *
 * @param read - What to read.
 * @returns A poll body.
 */
function after<T>(read: () => T | Promise<T>): () => Promise<T> {
  return async () => {
    await harness.advanceAndSettle(1_000);
    return read();
  };
}

/**
 * The sorted object ids of a store.
 *
 * @param store - The store.
 * @returns The ids.
 */
function idsOf(store: DocumentStore): string[] {
  return [...store.read().objects.keys()].sort();
}

/**
 * Whether the relay's board holds an object entry.
 *
 * @param id - The object id.
 * @returns Whether it does.
 */
function relayHolds(id: string): boolean {
  return harness.relay.doc.getMap(OBJECTS_MAP_NAME).has(id);
}

/**
 * The ticket's sequence up to the terminal state, on fake-indexeddb: the relay holds `shared`;
 * the tab opens from a cache holding the unstamped fragment, syncs, goes offline, adds
 * `offline-sticky` and deletes `shared`; the filler reaches the relay; the tab reconnects while
 * its document frames are lost, so the relay's answer releases the fragment with both edits
 * unsent. Ends with the tab destroyed (closed).
 *
 * @returns The device and the poisoned history.
 */
async function poisonTab(): Promise<{
  readonly factory: IDBFactory;
  readonly history: ReturnType<typeof poisonedHistory>;
}> {
  harness = new ClientHarness();
  const history = poisonedHistory();
  const peer = new YjsDocumentStore();
  peer.transact(ADA, (transaction) => {
    transaction.setObject(sticky('shared'));
  });
  Y.applyUpdate(harness.relay.doc, peer.encodeState());
  peer.destroy();
  const factory = new IDBFactory();
  await (await openIndexedDbCache({ factory })).append(BOARD, history.fragment);
  const frames = new WithheldDocumentFrames(harness.relay.socketFactory);
  const store = new YjsDocumentStore();
  const client = await harness.connect({
    store,
    cache: await openIndexedDbCache({ factory }),
    socketFactory: frames.socketFactory,
    onError: (error) => reported.push(error),
  });
  await expect.poll(after(() => standing(client))).toBe('settled');
  expect(idsOf(store)).toEqual(['shared']);
  expect(store.hasPendingStructs).toBe(true);
  client.disconnect();
  store.transact(ADA, (transaction) => {
    transaction.setObject(sticky('offline-sticky', 1));
  });
  store.transact(ADA, (transaction) => {
    transaction.deleteObject('shared' as ObjectId);
  });
  Y.applyUpdate(harness.relay.doc, history.filler);
  frames.isWithholding = true;
  client.connect();
  await expect
    .poll(after(() => client.status.state === 'outdated' || !store.hasPendingStructs))
    .toBe(true);
  expect(frames.withheld).toBeGreaterThan(0);
  expect(relayHolds('offline-sticky')).toBe(false);
  await harness.settle();
  client.destroy();
  return { factory, history };
}

/**
 * Reopens the tab as a reload does: a fresh store and client over a new IndexedDB connection.
 *
 * @param factory - The device's IndexedDB.
 * @returns The client and its store.
 */
async function reopen(
  factory: IDBFactory,
): Promise<{ readonly client: CollabClient; readonly store: DocumentStore }> {
  const store = new YjsDocumentStore();
  const client = await harness.connect({
    store,
    cache: await openIndexedDbCache({ factory }),
    onError: (error) => reported.push(error),
  });
  return { client, store };
}

describe('a poisoned IndexedDB cache released by a filler, then reopened', () => {
  it('the reopened tab connects and sends its offline sticky and deletion, never the ghost', async () => {
    const { factory, history } = await poisonTab();
    const tab = await reopen(factory);
    await expect.poll(after(() => standing(tab.client))).toBe('settled');
    expect(relayHolds('offline-sticky')).toBe(true);
    expect(relayHolds('shared')).toBe(false);
    expect(relayHolds(history.ghostId)).toBe(false);
    expect(idsOf(tab.store)).toEqual(['offline-sticky']);
  });

  // Holds on main today (nothing clears the cache). Breaks if a fix clears IndexedDB on
  // `outdated` before the edits are integrated elsewhere or re-sent.
  it('the poisoned session deletes nothing from IndexedDB: fragment and both edits stay', async () => {
    const { factory, history } = await poisonTab();
    const ids = await deviceObjectIds(factory);
    expect(ids).toContain('offline-sticky');
    expect(ids).not.toContain('shared');
    expect(await deviceHoldsStruct(factory, history.writer, history.fragmentClock)).toBe(true);
  });

  it('a second reopen connects too, and IndexedDB still holds the never-sent fragment', async () => {
    const { factory, history } = await poisonTab();
    const first = await reopen(factory);
    await expect.poll(after(() => standing(first.client))).toBe('settled');
    first.client.destroy();
    const second = await reopen(factory);
    await expect.poll(after(() => standing(second.client))).toBe('settled');
    second.client.destroy();
    await harness.settle();
    expect(await deviceHoldsStruct(factory, history.writer, history.fragmentClock)).toBe(true);
  });
});
