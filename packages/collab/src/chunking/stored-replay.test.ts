import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createLargeBoardObjects,
  SYSTEM_ORIGIN,
  UpdateStampCheck,
  YjsDocumentStore,
} from '@canvas/document';

import { planStoredReplay } from './stored-replay.js';

/** A small chunk size, so a test board of a few hundred objects needs many chunks. */
const SMALL_CHUNK_BYTES = 16 * 1024;

/** A store, its logged updates (one per transaction) and each transaction's end state. */
interface LoggedStore {
  readonly store: YjsDocumentStore;
  readonly log: Uint8Array[];
  readonly ends: Uint8Array[];
}

/**
 * A stamped store that logs every update as the cache binding does.
 *
 * @param clientId - Its Yjs client id.
 * @returns The store and its log.
 */
function loggedStore(clientId: number): LoggedStore {
  const store = new YjsDocumentStore({ clientId });
  const log: Uint8Array[] = [];
  const ends: Uint8Array[] = [];
  store.subscribeUpdates(({ update }) => {
    log.push(update);
    ends.push(store.encodeStateVector());
  });
  return { store, log, ends };
}

/**
 * Writes objects of the large-board mix in transactions.
 *
 * @param store - The store.
 * @param count - How many objects.
 * @param seed - The generator's seed.
 * @param perTransaction - Objects per transaction.
 */
function writeObjects(store: YjsDocumentStore, count: number, seed: number, perTransaction = 40) {
  const objects = createLargeBoardObjects(count, seed);
  for (let start = 0; start < objects.length; start += perTransaction) {
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of objects.slice(start, start + perTransaction)) {
        transaction.setObject(object);
      }
    });
  }
}

/**
 * The relay's document after the store's state up to the given log length.
 *
 * @param log - The logged updates.
 * @param length - How many of them the relay has.
 * @returns The document.
 */
function hubWith(log: readonly Uint8Array[], length: number): Y.Doc {
  const hub = new Y.Doc();
  if (length > 0) Y.applyUpdate(hub, Y.mergeUpdates(log.slice(0, length)));
  return hub;
}

describe('planStoredReplay', { timeout: 30_000 }, () => {
  it('replays the logged transactions the relay lacks, in order, never cutting one', () => {
    const { store, log, ends } = loggedStore(201);
    writeObjects(store, 600, 201, 15);
    const hub = hubWith(log, 3);
    const remote = Y.encodeStateVector(hub);
    const replay = planStoredReplay(log, remote, store.encodeStateVector(), SMALL_CHUNK_BYTES);
    expect(replay).toBeDefined();
    const chunks = replay?.chunks ?? [];
    expect(chunks.length).toBeGreaterThan(5);
    const check = new UpdateStampCheck(hub);
    const transactionEnds = new Set(ends.map((vector) => Y.decodeStateVector(vector).get(201)));
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(SMALL_CHUNK_BYTES);
      expect(check.check(chunk).kind).toBe('accepted');
      Y.applyUpdate(hub, chunk);
      expect(hub.store.pendingStructs).toBeNull();
      expect(transactionEnds.has(Y.getState(hub.store, 201))).toBe(true);
    }
    expect(Y.encodeStateVector(hub)).toEqual(store.encodeStateVector());
    expect(replay?.coveredStateVector.get(201)).toBe(Y.getState(hub.store, 201));
  });

  it('skips logged updates the relay already holds, such as relayed ones', () => {
    const { store, log } = loggedStore(202);
    writeObjects(store, 100, 202);
    const peer = new YjsDocumentStore({ clientId: 302 });
    writeObjects(peer, 100, 302);
    store.applyUpdate(peer.encodeState(), SYSTEM_ORIGIN);
    writeObjects(store, 300, 212);
    const hub = hubWith(log, 0);
    Y.applyUpdate(hub, peer.encodeState());
    const replay = planStoredReplay(
      log,
      Y.encodeStateVector(hub),
      store.encodeStateVector(),
      SMALL_CHUNK_BYTES,
    );
    for (const chunk of replay?.chunks ?? []) {
      expect(Y.parseUpdateMeta(chunk).to.has(302)).toBe(false);
      Y.applyUpdate(hub, chunk);
    }
    expect(Y.encodeStateVector(hub)).toEqual(store.encodeStateVector());
  });

  it('skips a logged update of a writer the store never held, as another tab writes', () => {
    const { store, log } = loggedStore(207);
    writeObjects(store, 200, 207, 15);
    const tab = new YjsDocumentStore({ clientId: 307 });
    writeObjects(tab, 20, 307);
    const replay = planStoredReplay(
      [...log.slice(0, 2), tab.encodeState(), ...log.slice(2)],
      Y.encodeStateVector(new Y.Doc()),
      store.encodeStateVector(),
      SMALL_CHUNK_BYTES,
    );
    expect(replay?.coveredStateVector.has(307)).toBe(false);
    expect(replay?.coveredStateVector.get(207)).toBe(
      Y.decodeStateVector(store.encodeStateVector()).get(207),
    );
  });

  it('cannot cover a store whose earlier edits are only in a snapshot', () => {
    const { store, log } = loggedStore(203);
    writeObjects(store, 300, 203);
    const compacted = log.slice(4);
    const replay = planStoredReplay(
      compacted,
      Y.encodeStateVector(new Y.Doc()),
      store.encodeStateVector(),
      SMALL_CHUNK_BYTES,
    );
    expect(replay).toBeUndefined();
  });

  it('cannot cover content of a writer the log never held', () => {
    const { store, log } = loggedStore(204);
    writeObjects(store, 200, 204);
    const other = new YjsDocumentStore({ clientId: 304 });
    writeObjects(other, 50, 304);
    const merged = new YjsDocumentStore({ clientId: 404 });
    merged.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
    merged.applyUpdate(other.encodeState(), SYSTEM_ORIGIN);
    const replay = planStoredReplay(
      log,
      Y.encodeStateVector(new Y.Doc()),
      merged.encodeStateVector(),
      SMALL_CHUNK_BYTES,
    );
    expect(replay).toBeUndefined();
  });

  it('skips logged updates past the state it answers for, leaving them to the rest', () => {
    const { store, log } = loggedStore(205);
    writeObjects(store, 300, 205);
    const answered = store.encodeStateVector();
    writeObjects(store, 100, 215);
    const replay = planStoredReplay(
      log,
      Y.encodeStateVector(new Y.Doc()),
      answered,
      SMALL_CHUNK_BYTES,
    );
    expect(replay?.coveredStateVector.get(205)).toBe(Y.decodeStateVector(answered).get(205));
  });

  it('sends a logged transaction larger than a chunk whole, and cuts it only past the whole limit', () => {
    const { store, log } = loggedStore(206);
    writeObjects(store, 300, 206, 300);
    expect(log).toHaveLength(1);
    const empty = Y.encodeStateVector(new Y.Doc());
    const whole = planStoredReplay(log, empty, store.encodeStateVector(), SMALL_CHUNK_BYTES);
    expect(whole?.chunks).toHaveLength(1);
    expect(whole?.isCut).toBe(false);
    const cut = planStoredReplay(
      log,
      empty,
      store.encodeStateVector(),
      SMALL_CHUNK_BYTES,
      64 * 1024,
    );
    expect(cut?.isCut).toBe(true);
    const hub = new Y.Doc();
    for (const chunk of cut?.chunks ?? []) {
      expect(chunk.byteLength).toBeLessThanOrEqual(SMALL_CHUNK_BYTES);
      Y.applyUpdate(hub, chunk);
    }
    expect(Y.encodeStateVector(hub)).toEqual(store.encodeStateVector());
  });
});
