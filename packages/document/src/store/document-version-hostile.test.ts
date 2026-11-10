// The stored layout metadata is whatever a peer wrote. A `bigint` in it threw a
// `TypeError` out of `applyUpdate` (the error's message ran `JSON.stringify` on it) instead of
// the `DocumentVersionError` every unreadable stamp gets, and a huge value went into the message
// whole. Real remote updates.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { DocumentVersionError } from '../meta/document-version-error.js';

import { ADA, createFixtureStore, id, RELAY } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

/**
 * An update from a peer that stored `meta` as the document's layout stamp.
 *
 * @param meta - The value the peer stored.
 * @returns The update.
 */
function updateStoring(meta: unknown): Uint8Array {
  const peer = new Y.Doc();
  peer.transact(() => {
    peer.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, meta);
  });
  return Y.encodeStateAsUpdate(peer);
}

/**
 * Applies an update and returns what it threw.
 *
 * @param store - The receiver.
 * @param update - The update.
 * @returns The thrown value, or `undefined`.
 */
function thrownBy(store: YjsDocumentStore, update: Uint8Array): unknown {
  try {
    store.applyUpdate(update, RELAY);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('a layout stamp a peer chose', () => {
  it.each([
    ['a bigint', 5n],
    ['a bigint layout version', { schemaVersion: 1, layoutVersion: 2n }],
    ['a bigint schema version', { schemaVersion: 2n ** 62n, layoutVersion: 2 }],
    ['binary data', new Uint8Array([1, 2, 3])],
    ['an object with no prototype', JSON.parse('{"__proto__":null}') as unknown],
    ['a 500,000-character string', 'v'.repeat(500_000)],
    ['a huge object', { layoutVersion: 99, note: 'n'.repeat(500_000) }],
    ['a number', 7],
  ] as const)('%s is an unreadable version, with a bounded message', (kind, meta) => {
    const store = new YjsDocumentStore();
    const error = thrownBy(store, updateStoring(meta));
    expect(error).toBeInstanceOf(DocumentVersionError);
    expect((error as DocumentVersionError).problem).toBe('unreadable-version');
    expect((error as DocumentVersionError).message.length).toBeLessThan(600);
  });

  it('leaves the store that received it refusing writes with the documented error', () => {
    const doc = new Y.Doc();
    const store = new YjsDocumentStore();
    doc.transact(() => {
      doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, new Y.Map());
    });
    expect(thrownBy(store, Y.encodeStateAsUpdate(doc))).toBeInstanceOf(DocumentVersionError);
    expect(() => store.read()).not.toThrow();
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow(DocumentVersionError);
  });

  it('does not touch another, healthy document', () => {
    const healthy = createFixtureStore();
    thrownBy(new YjsDocumentStore(), updateStoring(5n));
    healthy.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-plan'), { x: 42 });
    });
    expect(healthy.get(id('frame-plan'))?.x).toBe(42);
  });

  it('keeps the readable form of an ordinary stamp in the message', () => {
    const error = thrownBy(
      new YjsDocumentStore(),
      updateStoring({ schemaVersion: 1, layoutVersion: 99 }),
    );
    expect((error as DocumentVersionError).message).toContain(
      '{"schemaVersion":1,"layoutVersion":99}',
    );
  });
});
