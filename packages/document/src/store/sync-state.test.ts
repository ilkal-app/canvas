import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { updateOf } from '../meta/__fixtures__/stamp-check-fixtures.js';
import { UpdateStampCheck } from '../meta/update-stamp-check.js';

import { ADA, createFixtureStore, id, RELAY } from './__fixtures__/store-fixtures.js';
import { internalsOf } from './internal.js';
import { encodeSyncState } from './sync-state.js';
import { YjsDocumentStore } from './yjs-document-store.js';

// Transport recovery must not modify the persistence snapshot or discard pending deletes.
describe('sync state with incomplete cached history', () => {
  it('sends integrated offline edits while preserving incomplete structs for later dependencies', () => {
    const store = createFixtureStore();
    const writer = new Y.Doc();
    const dependency = updateOf(writer, () => {
      writer.getText('note').insert(0, 'a');
    });
    const fragment = updateOf(writer, () => {
      writer.getText('note').insert(1, 'b');
    });
    store.applyUpdate(fragment, RELAY);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), { x: 123 });
    });
    const persisted = store.encodeState();
    const pending = internalsOf(store).doc.store.pendingStructs;
    const relay = new Y.Doc();
    expect(new UpdateStampCheck(relay).check(persisted).kind).toBe('unprovable');
    const sync = store.encodeSyncState();
    expect(new UpdateStampCheck(relay).check(sync).kind).toBe('accepted');
    Y.applyUpdate(relay, sync);
    expect(relay.store.pendingStructs).toBeNull();
    const receiver = new YjsDocumentStore();
    receiver.applyUpdate(sync, RELAY);
    expect(receiver.get(id('sticky-idea'))).toMatchObject({ x: 123 });
    receiver.destroy();
    expect(store.encodeState()).toEqual(persisted);
    expect(internalsOf(store).doc.store.pendingStructs).toBe(pending);
    store.applyUpdate(dependency, RELAY);
    Y.applyUpdate(relay, store.encodeSyncState(Y.encodeStateVector(relay)));
    expect(relay.getText('note').toJSON()).toBe('ab');
    store.destroy();
    writer.destroy();
    relay.destroy();
  });

  it('includes standalone pending deletes and restores pending structs after an encoding error', () => {
    const store = createFixtureStore();
    const writer = new Y.Doc();
    const dependency = updateOf(writer, () => {
      writer.getText('note').insert(0, 'a');
    });
    const fragment = updateOf(writer, () => {
      writer.getText('note').insert(1, 'b');
    });
    const deletion = updateOf(writer, () => {
      writer.getText('note').delete(0, 1);
    });
    store.applyUpdate(fragment, RELAY);
    store.applyUpdate(deletion, RELAY);
    const pending = internalsOf(store).doc.store.pendingStructs;
    const persisted = store.encodeState();
    expect(() => store.encodeSyncState(new Uint8Array([255]))).toThrow();
    expect(internalsOf(store).doc.store.pendingStructs).toBe(pending);
    const relay = new Y.Doc();
    Y.applyUpdate(relay, store.encodeSyncState());
    expect(relay.store.pendingDs).not.toBeNull();
    expect(relay.store.pendingStructs).toBeNull();
    expect(store.encodeState()).toEqual(persisted);
    store.applyUpdate(dependency, RELAY);
    Y.applyUpdate(relay, store.encodeSyncState(Y.encodeStateVector(relay)));
    expect(relay.getText('note').toJSON()).toBe('b');
    store.destroy();
    writer.destroy();
    relay.destroy();
  });
  it('keeps pending state visible to nested persistence encoding during struct serialization', () => {
    const doc = new Y.Doc();
    const writer = new Y.Doc();
    writer.getText('gap').insert(0, 'a');
    const vector = Y.encodeStateVector(writer);
    writer.getText('gap').insert(1, 'b');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(writer, vector));
    doc.getText('safe').insert(0, 'visible');
    const content = doc.getText('safe')._start?.content;
    if (content === undefined) throw new Error('fixture text has no content');
    const pending = doc.store.pendingStructs;
    const original = content.write.bind(content);
    let isNested = false;
    let nested: Uint8Array | undefined;
    const spy = vi.spyOn(content, 'write').mockImplementation((encoder, offset) => {
      if (!isNested) {
        isNested = true;
        expect(doc.store.pendingStructs).toBe(pending);
        nested = Y.encodeStateAsUpdate(doc);
      }
      original(encoder, offset);
    });
    try {
      encodeSyncState(doc);
      const restored = new Y.Doc();
      if (nested === undefined) throw new Error('nested encoder did not run');
      Y.applyUpdate(restored, nested);
      expect(restored.store.pendingStructs).not.toBeNull();
      expect(doc.store.pendingStructs).toBe(pending);
      restored.destroy();
    } finally {
      spy.mockRestore();
      doc.destroy();
      writer.destroy();
    }
  });
  it('retains incomplete bytes through repeated sync and persistence reopen without dependencies', () => {
    const writer = new Y.Doc();
    writer.getText('note').insert(0, 'missing');
    const vector = Y.encodeStateVector(writer);
    writer.getText('note').insert(7, 'retained');
    let store = createFixtureStore();
    store.applyUpdate(Y.encodeStateAsUpdate(writer, vector), RELAY);
    const persisted = store.encodeState();
    for (let round = 0; round < 3; round += 1) {
      store.encodeSyncState();
      expect(store.encodeState()).toEqual(persisted);
      const next = new YjsDocumentStore();
      next.applyUpdate(store.encodeState(), RELAY);
      expect(next.hasPendingStructs).toBe(true);
      expect(next.read().objects).toEqual(store.read().objects);
      store.destroy();
      store = next;
    }
    store.destroy();
    writer.destroy();
  });
});
