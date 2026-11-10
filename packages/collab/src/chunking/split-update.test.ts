import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createLargeBoardObjects,
  SYSTEM_ORIGIN,
  UpdateStampCheck,
  YjsDocumentStore,
} from '@canvas/document';

import { OUTBOUND_CHUNK_BYTES, splitUpdate } from './split-update.js';

/** A small chunk size, so a test board of a few hundred objects splits into many chunks. */
const SMALL_CHUNK_BYTES = 16 * 1024;

/**
 * A stamped store holding `count` objects of the large-board mix, written in transactions of
 * `perTransaction` objects.
 *
 * @param count - How many objects.
 * @param clientId - The store's Yjs client id.
 * @param perTransaction - Objects per transaction.
 * @returns The store.
 */
function storeWithObjects(count: number, clientId: number, perTransaction = 50): YjsDocumentStore {
  const store = new YjsDocumentStore({ clientId });
  const objects = createLargeBoardObjects(count, clientId);
  for (let start = 0; start < objects.length; start += perTransaction) {
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of objects.slice(start, start + perTransaction)) {
        transaction.setObject(object);
      }
    });
  }
  return store;
}

/**
 * Applies chunks one by one to a document, as the relay does, checking each the way the relay's
 * layout gate does first and that Yjs leaves nothing pending after it.
 *
 * @param hub - The relay's document.
 * @param chunks - The chunks, in order.
 * @returns One line per chunk the gate would not accept or Yjs left pending.
 */
function applyAsRelay(hub: Y.Doc, chunks: readonly Uint8Array[]): string[] {
  const check = new UpdateStampCheck(hub);
  const problems: string[] = [];
  chunks.forEach((chunk, index) => {
    const verdict = check.check(chunk);
    if (verdict.kind !== 'accepted') problems.push(`chunk ${String(index)}: ${verdict.kind}`);
    Y.applyUpdate(hub, chunk);
    if (hub.store.pendingStructs !== null || hub.store.pendingDs !== null) {
      problems.push(`chunk ${String(index)}: pending`);
    }
  });
  return problems;
}

describe('splitUpdate', { timeout: 30_000 }, () => {
  it('returns an update within the limit as it is', () => {
    const store = storeWithObjects(20, 101);
    const update = store.encodeState();
    const chunks = splitUpdate(update, OUTBOUND_CHUNK_BYTES);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(update);
  });

  it('splits a large offline batch into chunks within the limit that the relay accepts in order', () => {
    const store = storeWithObjects(400, 102);
    const update = store.encodeState();
    const copy = update.slice();
    const chunks = splitUpdate(update, SMALL_CHUNK_BYTES);
    expect(update).toEqual(copy);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.byteLength).toBeLessThanOrEqual(SMALL_CHUNK_BYTES);
    const hub = new Y.Doc();
    expect(applyAsRelay(hub, chunks)).toEqual([]);
    expect(isSameBytes(Y.encodeStateAsUpdate(hub), Y.encodeStateAsUpdate(applyWhole(update)))).toBe(
      true,
    );
  });

  it('puts every writer stamp in the first chunk that carries that writer', () => {
    const store = storeWithObjects(300, 103);
    const chunks = splitUpdate(store.encodeState(), SMALL_CHUNK_BYTES);
    const first = new Y.Doc();
    Y.applyUpdate(first, chunks[0] ?? new Uint8Array());
    expect(first.getMap('meta').has('document')).toBe(true);
  });

  it('orders structs of one client after the structs of another they depend on', () => {
    // The writer with the larger id comes first in an update's encoding; its items sit between
    // the other writer's, so they can only be applied once those have arrived.
    const early = new Y.Doc();
    early.clientID = 1;
    const late = new Y.Doc();
    late.clientID = 2;
    const text = 'x'.repeat(200);
    for (let index = 0; index < 60; index += 1) early.getArray<string>('list').push([text]);
    Y.applyUpdate(late, Y.encodeStateAsUpdate(early));
    for (let index = 0; index < 60; index += 1)
      late.getArray<string>('list').insert(index * 2, [text]);
    const update = Y.encodeStateAsUpdate(late);
    expect(Y.decodeUpdate(update).structs[0]?.id.client).toBe(2);
    const chunks = splitUpdate(update, 2048);
    expect(chunks.length).toBeGreaterThan(3);
    const hub = new Y.Doc();
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(2048);
      Y.applyUpdate(hub, chunk);
      expect(hub.store.pendingStructs).toBeNull();
    }
    expect(hub.getArray('list').toJSON()).toEqual(late.getArray('list').toJSON());
  });

  it('sends a large delete set in delete-only chunks after the structs', () => {
    const store = storeWithObjects(300, 104);
    const hub = new Y.Doc();
    Y.applyUpdate(hub, store.encodeState());
    const before = Y.encodeStateVector(hub);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const [id] of store.read().objects) {
        if (id.charCodeAt(id.length - 1) % 2 === 0) transaction.deleteObject(id);
      }
    });
    const update = store.encodeSyncState(before);
    const chunks = splitUpdate(update, 256);
    const deleteOnly = chunks.filter((chunk) => Y.parseUpdateMeta(chunk).to.size === 0);
    expect(deleteOnly.length).toBeGreaterThan(1);
    expect(chunks.slice(-deleteOnly.length)).toEqual(deleteOnly);
    for (const chunk of deleteOnly) expect(chunk.byteLength).toBeLessThanOrEqual(256);
    expect(applyAsRelay(hub, chunks)).toEqual([]);
    const expected = applyWhole(store.encodeState());
    expect(hub.getMap('objects').size).toBe(expected.getMap('objects').size);
  });

  it('splits structs that depend on a client the update does not carry', () => {
    const early = new Y.Doc();
    early.clientID = 11;
    for (let index = 0; index < 50; index += 1)
      early.getMap('values').set(`k${String(index)}`, index);
    const late = new Y.Doc();
    late.clientID = 12;
    Y.applyUpdate(late, Y.encodeStateAsUpdate(early));
    for (let index = 0; index < 50; index += 1)
      late.getMap('values').set(`k${String(index)}`, -index);
    const update = Y.encodeStateAsUpdate(late, Y.encodeStateVector(early));
    const chunks = splitUpdate(update, 128);
    expect(chunks.length).toBeGreaterThan(1);
    const hub = new Y.Doc();
    Y.applyUpdate(hub, Y.encodeStateAsUpdate(early));
    for (const chunk of chunks) {
      Y.applyUpdate(hub, chunk);
      expect(hub.store.pendingStructs).toBeNull();
    }
    expect(hub.getMap('values').toJSON()).toEqual(late.getMap('values').toJSON());
  });

  it('carries collected ranges, which depend on nothing', () => {
    const doc = new Y.Doc();
    const nested = new Y.Map<number>();
    doc.getMap('outer').set('nested', nested);
    for (let index = 0; index < 40; index += 1) nested.set(`k${String(index)}`, index);
    doc.getMap('outer').delete('nested');
    doc.getMap('outer').set('after', 1);
    const update = Y.encodeStateAsUpdate(doc);
    expect(Y.decodeUpdate(update).structs.some((struct) => struct instanceof Y.GC)).toBe(true);
    const hub = new Y.Doc();
    for (const chunk of splitUpdate(update, 32)) Y.applyUpdate(hub, chunk);
    expect(Y.encodeStateVector(hub)).toEqual(Y.encodeStateVector(doc));
    expect(hub.getMap('outer').toJSON()).toEqual({ after: 1 });
  });

  it('keeps a struct larger than the limit whole, alone in its chunk', () => {
    const doc = new Y.Doc();
    doc.getMap('small').set('a', 1);
    doc.getText('note').insert(0, 'y'.repeat(5000));
    doc.getMap('small').set('b', 2);
    const chunks = splitUpdate(Y.encodeStateAsUpdate(doc), 1024);
    const oversized = chunks.filter((chunk) => chunk.byteLength > 1024);
    expect(oversized).toHaveLength(1);
    const hub = new Y.Doc();
    for (const chunk of chunks) Y.applyUpdate(hub, chunk);
    expect(hub.getText('note').toJSON()).toBe('y'.repeat(5000));
    expect(hub.getMap('small').toJSON()).toEqual({ a: 1, b: 2 });
  });
});

/**
 * A document with one update applied whole.
 *
 * @param update - The update.
 * @returns The document.
 */
function applyWhole(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

/**
 * Whether two byte arrays hold the same bytes (`toEqual` on megabytes is slow).
 *
 * @param first - One array.
 * @param second - The other.
 * @returns `true` when equal.
 */
function isSameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength && first.every((value, index) => value === second[index])
  );
}
