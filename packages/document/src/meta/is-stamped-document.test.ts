import { describe, expect, it } from 'vitest';

import { ADA, createFixtureStore, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { isStampedDocument } from './is-stamped-document.js';

describe('isStampedDocument', () => {
  it('is false for a document nobody has written, and true once a store writes to it', () => {
    expect(isStampedDocument(new YjsDocumentStore())).toBe(false);
    expect(isStampedDocument(createFixtureStore())).toBe(true);
  });

  it('stays true after every object is deleted: a cleared board is not a new one', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      for (const objectId of store.read().objects.keys()) transaction.deleteObject(objectId);
    });
    expect(store.read().objects.size).toBe(0);
    expect(isStampedDocument(store)).toBe(true);
  });

  it('is true for a store that received a stamped peer’s updates', () => {
    const empty = new YjsDocumentStore();
    exchange(createFixtureStore(), empty);
    expect(isStampedDocument(empty)).toBe(true);
  });
});
